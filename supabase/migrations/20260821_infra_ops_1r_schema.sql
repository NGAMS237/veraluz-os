-- =============================================================================
-- INFRA-OPS-1R : Alignement schéma canonique production
-- Migration    : 20260821_infra_ops_1r_schema.sql  (CORRIGÉ IN PLACE — INFRA-CORE-1B)
-- Branche      : claude/settings-ssot-1a
-- =============================================================================
-- INTERDIT : veraluz_guests JOIN (table inexistante) / NEW.guest_id (colonne inexistante)
-- INTERDIT : DISABLE ROW LEVEL SECURITY
-- COLONNES RÉELLES veraluz_reservations : client_id, client_name, client_email
-- COLONNES RÉELLES veraluz_guest_sessions : status, revoked_at, expires_at (pas checked_out_at)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. veraluz_events — colonnes canoniques (idempotent, migrations précédentes safe)
-- ─────────────────────────────────────────────────────────────────────────────
-- Safe no-ops si migration 1 corrigée a déjà créé les bonnes colonnes.

ALTER TABLE veraluz_events
  DROP COLUMN IF EXISTS tenant_id,
  DROP COLUMN IF EXISTS source_fn,
  DROP COLUMN IF EXISTS emitted_at;

ALTER TABLE veraluz_events
  ADD COLUMN IF NOT EXISTS source         text,
  ADD COLUMN IF NOT EXISTS entity_type    text,
  ADD COLUMN IF NOT EXISTS entity_id      text,
  ADD COLUMN IF NOT EXISTS reservation_id text,
  ADD COLUMN IF NOT EXISTS unit_id        text,
  ADD COLUMN IF NOT EXISTS actor_type     text,
  ADD COLUMN IF NOT EXISTS actor_id       text,
  ADD COLUMN IF NOT EXISTS created_at     timestamptz NOT NULL DEFAULT now();

ALTER TABLE veraluz_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. veraluz_event_jobs — updated_at + RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_event_jobs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE veraluz_event_jobs ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. veraluz_housekeeping — colonnes traçabilité + RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_housekeeping
  ADD COLUMN IF NOT EXISTS reservation_id  text,
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

ALTER TABLE veraluz_housekeeping ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_housekeeping_source_event
  ON veraluz_housekeeping (source_event_id)
  WHERE source_event_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. veraluz_internal_messages — colonne idempotence
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_internal_messages
  ADD COLUMN IF NOT EXISTS source_event_job text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_messages_source_event_job
  ON veraluz_internal_messages (source_event_job)
  WHERE source_event_job IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC claim_event_jobs — verrou atomique + incrément attempt
-- ─────────────────────────────────────────────────────────────────────────────
-- CORRIGÉ : attempt = ej.attempt + 1 obligatoire pour le retry logic.

CREATE OR REPLACE FUNCTION claim_event_jobs(p_batch int DEFAULT 20)
RETURNS SETOF veraluz_event_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE veraluz_event_jobs ej
  SET    status     = 'processing',
         attempt    = ej.attempt + 1,
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
--    CORRIGÉ : utilise NEW.client_name / NEW.client_email / NEW.client_id
--              (pas de JOIN veraluz_guests — table inexistante en prod)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id   uuid := gen_random_uuid();
  v_guest_name text;
BEGIN
  -- Résolution locale : client_name vient directement de veraluz_reservations
  v_guest_name := COALESCE(NEW.client_name, 'Client');

  -- ── Checkout ──────────────────────────────────────────────────────────────
  IF (OLD.status = 'checkedin' AND NEW.status = 'checkedout') THEN

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
        'guest_id',       NEW.client_id,
        'guest_name',     v_guest_name,
        'checkout_time',  now()
      ),
      now()
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, updated_at, created_at)
    VALUES (v_event_id, 'create_housekeeping_task', 'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, handler) DO NOTHING;

  END IF;

  -- ── Check-in ──────────────────────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'checkedin' AND NEW.status = 'checkedin') THEN

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
        'guest_id',       NEW.client_id,
        'guest_name',     v_guest_name,
        'client_email',   NEW.client_email,
        'check_in',       NEW.check_in,
        'check_out',      NEW.check_out
      ),
      now()
    )
    ON CONFLICT DO NOTHING;

  END IF;

  -- ── Reservation confirmed ─────────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed') THEN

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
        'guest_id',       NEW.client_id,
        'guest_name',     v_guest_name,
        'client_email',   NEW.client_email,
        'check_in',       NEW.check_in,
        'check_out',      NEW.check_out
      ),
      now()
    )
    ON CONFLICT DO NOTHING;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_reservation_event ON veraluz_reservations;

CREATE TRIGGER trg_emit_reservation_event
  AFTER UPDATE OF status ON veraluz_reservations
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_reservation_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Trigger vz_emit_service_request_event
--    CORRIGÉ : actor_id = NEW.guest_session_id (pas NEW.guest_id inexistant)
--              note = NEW.note (pas NEW.notes)
--              reservation_id TEXT, unit_id TEXT (schéma réel)
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
    'guest', NEW.guest_session_id::text,
    jsonb_build_object(
      'service_request_id', NEW.id,
      'service_type',       NEW.service_type,
      'reservation_id',     NEW.reservation_id,
      'unit_id',            NEW.unit_id,
      'note',               NEW.note
    ),
    now()
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, updated_at, created_at)
  VALUES (v_event_id, 'create_staff_notification', 'pending', 0, 4, now(), now())
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
