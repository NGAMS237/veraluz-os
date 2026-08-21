-- =============================================================================
-- INFRA-OPS-1R : Alignement schéma canonique production
-- Migration    : 20260821_infra_ops_1r_schema.sql
-- Branche      : claude/settings-ssot-1a
-- =============================================================================
-- Ordre d'opérations :
--   1. Évolutions schéma veraluz_events (colonnes + RLS)
--   2. Évolutions schéma veraluz_event_jobs (RLS)
--   3. Colonnes additionnelles veraluz_housekeeping (RLS déjà ACTIVE)
--   4. Colonne idempotence veraluz_internal_messages
--   5. RPC claim_event_jobs (FOR UPDATE SKIP LOCKED)
--   6. Trigger vz_emit_reservation_event (checkout → guest_checked_out)
--   7. Trigger vz_emit_service_request_event (INSERT → guest_service_requested)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. veraluz_events — évolutions du contrat d'événement
-- ─────────────────────────────────────────────────────────────────────────────

-- Supprimer les colonnes du prototype INFRA-OPS-1 qui n'existent pas en prod
ALTER TABLE veraluz_events
  DROP COLUMN IF EXISTS tenant_id,
  DROP COLUMN IF EXISTS source_fn,
  DROP COLUMN IF EXISTS emitted_at;

-- Ajouter les colonnes du contrat canonique (IF NOT EXISTS = idempotent)
ALTER TABLE veraluz_events
  ADD COLUMN IF NOT EXISTS source       text,
  ADD COLUMN IF NOT EXISTS entity_type  text,
  ADD COLUMN IF NOT EXISTS entity_id    text,
  ADD COLUMN IF NOT EXISTS reservation_id text,
  ADD COLUMN IF NOT EXISTS unit_id      text,
  ADD COLUMN IF NOT EXISTS actor_type   text,
  ADD COLUMN IF NOT EXISTS actor_id     text,
  ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

-- RLS : la table doit être protégée (lecture service_role seulement via SECURITY DEFINER)
ALTER TABLE veraluz_events ENABLE ROW LEVEL SECURITY;

-- Politique : aucun accès utilisateur direct (les fonctions SECURITY DEFINER passent outre)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'veraluz_events'
      AND policyname = 'no_direct_access_events'
  ) THEN
    CREATE POLICY no_direct_access_events ON veraluz_events
      AS RESTRICTIVE FOR ALL TO public USING (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. veraluz_event_jobs — RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_event_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'veraluz_event_jobs'
      AND policyname = 'no_direct_access_event_jobs'
  ) THEN
    CREATE POLICY no_direct_access_event_jobs ON veraluz_event_jobs
      AS RESTRICTIVE FOR ALL TO public USING (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. veraluz_housekeeping — colonnes additionnelles (schéma réel TEXT IDs)
-- ─────────────────────────────────────────────────────────────────────────────
-- La table existe déjà avec son schéma canonique (id text, type text, RLS ACTIVE).
-- On ajoute uniquement les colonnes nécessaires au bus d'événements.

ALTER TABLE veraluz_housekeeping
  ADD COLUMN IF NOT EXISTS reservation_id   text,
  ADD COLUMN IF NOT EXISTS source_event_id  uuid;

-- Index UNIQUE pour idempotence : un seul job par événement source
CREATE UNIQUE INDEX IF NOT EXISTS uq_housekeeping_source_event
  ON veraluz_housekeeping (source_event_id)
  WHERE source_event_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. veraluz_internal_messages — colonne idempotence
-- ─────────────────────────────────────────────────────────────────────────────
-- Format : '<event_id>:<handler_name>'

ALTER TABLE veraluz_internal_messages
  ADD COLUMN IF NOT EXISTS source_event_job text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_messages_source_event_job
  ON veraluz_internal_messages (source_event_job)
  WHERE source_event_job IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC claim_event_jobs — verrou atomique FOR UPDATE SKIP LOCKED
-- ─────────────────────────────────────────────────────────────────────────────
-- Retourne les jobs réclamés ; le worker ne fait rien si 0 lignes retournées.

CREATE OR REPLACE FUNCTION claim_event_jobs(p_batch int DEFAULT 20)
RETURNS SETOF veraluz_event_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE veraluz_event_jobs ej
  SET    status     = 'processing',
         updated_at = now()
  FROM (
    SELECT id
    FROM   veraluz_event_jobs
    WHERE  status = 'pending'
    ORDER  BY created_at
    LIMIT  p_batch
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE  ej.id = sub.id
  RETURNING ej.*;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Trigger vz_emit_reservation_event
--    Déclenché : AFTER UPDATE sur veraluz_reservations
--    Condition  : status passe de 'checkedin' à 'checkedout'
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
  v_guest_name text;
BEGIN
  -- ── Checkout ──────────────────────────────────────────────────────────────
  IF (OLD.status = 'checkedin' AND NEW.status = 'checkedout') THEN

    -- Résoudre le nom du client
    SELECT COALESCE(g.full_name, g.first_name || ' ' || g.last_name, 'Inconnu')
    INTO   v_guest_name
    FROM   veraluz_guests g
    WHERE  g.id = NEW.guest_id;

    -- Émettre l'événement
    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_event_id, 'guest_checked_out', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'unit_id',        NEW.unit_id,
        'guest_id',       NEW.guest_id,
        'guest_name',     v_guest_name,
        'checkout_time',  now()
      ),
      now()
    )
    ON CONFLICT DO NOTHING;

    -- Inscrire les jobs handlers
    INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, created_at)
    VALUES
      (v_event_id, 'create_housekeeping_task', 'pending', 0, 4, now())
    ON CONFLICT (event_id, handler) DO NOTHING;

  END IF;

  -- ── Check-in ──────────────────────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'checkedin' AND NEW.status = 'checkedin') THEN

    SELECT COALESCE(g.full_name, g.first_name || ' ' || g.last_name, 'Inconnu')
    INTO   v_guest_name
    FROM   veraluz_guests g
    WHERE  g.id = NEW.guest_id;

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      gen_random_uuid(), 'guest_checked_in', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'unit_id',        NEW.unit_id,
        'guest_id',       NEW.guest_id,
        'guest_name',     v_guest_name,
        'check_in',       NEW.check_in,
        'check_out',      NEW.check_out
      ),
      now()
    )
    ON CONFLICT DO NOTHING;

    -- Pas de job event-worker pour checkin (géré par comms-worker INFRA-COMMS-1A)

  END IF;

  -- ── Confirmed (nouvelle réservation confirmée) ────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed') THEN

    SELECT COALESCE(g.full_name, g.first_name || ' ' || g.last_name, 'Inconnu')
    INTO   v_guest_name
    FROM   veraluz_guests g
    WHERE  g.id = NEW.guest_id;

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      gen_random_uuid(), 'reservation_confirmed', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'unit_id',        NEW.unit_id,
        'guest_id',       NEW.guest_id,
        'guest_name',     v_guest_name,
        'check_in',       NEW.check_in,
        'check_out',      NEW.check_out
      ),
      now()
    )
    ON CONFLICT DO NOTHING;

    -- Pas de job event-worker pour confirmed (géré par comms-worker INFRA-COMMS-1A)

  END IF;

  RETURN NEW;
END;
$$;

-- Supprimer et recréer le trigger (idempotent)
DROP TRIGGER IF EXISTS trg_emit_reservation_event ON veraluz_reservations;

CREATE TRIGGER trg_emit_reservation_event
  AFTER UPDATE OF status ON veraluz_reservations
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_reservation_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Trigger vz_emit_service_request_event
--    Déclenché : AFTER INSERT sur veraluz_guest_service_requests
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_service_request_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO veraluz_events (
    id, event_type, source,
    entity_type, entity_id,
    reservation_id, unit_id,
    actor_type, actor_id,
    payload, created_at
  ) VALUES (
    v_event_id, 'guest_service_requested', 'guest-access',
    'service_request', NEW.id::text,
    NEW.reservation_id::text, NEW.unit_id::text,
    'guest', NEW.guest_id::text,
    jsonb_build_object(
      'service_request_id', NEW.id,
      'service_type',       NEW.service_type,
      'reservation_id',     NEW.reservation_id,
      'unit_id',            NEW.unit_id,
      'notes',              NEW.notes
    ),
    now()
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, created_at)
  VALUES
    (v_event_id, 'create_staff_notification', 'pending', 0, 4, now())
  ON CONFLICT (event_id, handler) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_service_request_event ON veraluz_guest_service_requests;

CREATE TRIGGER trg_emit_service_request_event
  AFTER INSERT ON veraluz_guest_service_requests
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_service_request_event();

-- =============================================================================
-- FIN 20260821_infra_ops_1r_schema.sql
-- =============================================================================
