-- =============================================================================
-- INFRA-COMMS-1B : File de communication — SSOT veraluz_comm_templates
-- Migration : 20260821_infra_comms_1a.sql  (CORRIGÉ IN PLACE — INFRA-CORE-1B)
-- Branche   : claude/settings-ssot-1a
-- =============================================================================
-- INTERDIT : CREATE TABLE veraluz_communication_templates (doublon avec SSOT)
-- INTERDIT : tenant_id / veraluz_guests JOIN / NEW.guest_id / checked_out_at
-- INTERDIT : template_code (renommé template_key — cohérence veraluz_comm_templates)
-- SOURCE CANONIQUE TEMPLATES : veraluz_comm_templates (déjà en prod)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Étendre veraluz_comm_templates — canal guest_portal
--    La table SSOT existe en prod. On étend le CHECK channel uniquement.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE v_con text;
BEGIN
  -- Supprimer l'ancienne contrainte channel si elle existe (quel que soit son nom)
  SELECT conname INTO v_con
  FROM   pg_constraint
  WHERE  conrelid = 'veraluz_comm_templates'::regclass
    AND  contype  = 'c'
    AND  pg_get_constraintdef(oid) ILIKE '%channel%'
  LIMIT 1;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE veraluz_comm_templates DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE veraluz_comm_templates
  ADD CONSTRAINT vct_channel_check
  CHECK (channel IN ('email', 'internal', 'guest_portal', 'future_whatsapp', 'future_sms'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. veraluz_guest_messages — colonne idempotence comms
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_guest_messages
  ADD COLUMN IF NOT EXISTS source_event_job text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_messages_source_event_job
  ON veraluz_guest_messages (source_event_job)
  WHERE source_event_job IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS sur tables invités (jamais d'accès direct non authentifié)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_guest_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE veraluz_guest_messages         ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. veraluz_communication_jobs
--    template_key (pas template_code) — cohérence SSOT veraluz_comm_templates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veraluz_communication_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid        NOT NULL REFERENCES veraluz_events(id),
  template_key  text        NOT NULL,        -- clé SSOT dans veraluz_comm_templates
  channel       text        NOT NULL
    CHECK (channel IN ('email', 'internal', 'guest_portal')),
  recipient_ref text        NOT NULL,        -- email, guest_session_id::text, ou 'department:xxx'
  status        text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead', 'blocked_provider')),
  attempt       int         NOT NULL DEFAULT 0,
  max_attempts  int         NOT NULL DEFAULT 4,
  last_error    text,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, template_key, channel, recipient_ref)
);

CREATE INDEX IF NOT EXISTS idx_comm_jobs_status_created
  ON veraluz_communication_jobs (status, created_at)
  WHERE status = 'pending';

-- Index séparé pour blocked_provider → visibilité opérationnelle (infra-health, dashboard)
CREATE INDEX IF NOT EXISTS idx_comm_jobs_blocked_provider
  ON veraluz_communication_jobs (created_at)
  WHERE status = 'blocked_provider';

ALTER TABLE veraluz_communication_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'veraluz_communication_jobs'
      AND policyname = 'no_direct_access_comm_jobs'
  ) THEN
    CREATE POLICY no_direct_access_comm_jobs ON veraluz_communication_jobs
      AS RESTRICTIVE FOR ALL TO public USING (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC claim_communication_jobs — verrou atomique + incrément attempt
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_communication_jobs(p_batch int DEFAULT 20)
RETURNS SETOF veraluz_communication_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE veraluz_communication_jobs cj
  SET    status     = 'processing',
         attempt    = cj.attempt + 1,
         updated_at = now()
  FROM (
    SELECT id
    FROM   veraluz_communication_jobs
    WHERE  status = 'pending'
    ORDER  BY created_at
    LIMIT  p_batch
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE  cj.id = sub.id
  RETURNING cj.*;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Seeds templates canoniques → veraluz_comm_templates (SSOT prod)
--    Canaux internal + guest_portal (les templates email existent déjà en prod)
-- ─────────────────────────────────────────────────────────────────────────────

-- booking_confirmation — internal : notification staff à la confirmation
INSERT INTO veraluz_comm_templates
  (tenant_id, template_key, name, audience, event_type, channel, locale,
   subject_template, body_template, variables_schema, active)
VALUES
  (
    'veraluz-001',
    'booking_confirmation',
    'Confirmation réservation — Staff',
    'staff',
    'reservation_confirmed',
    'internal',
    'fr',
    'Nouvelle réservation confirmée — {{guest_name}}',
    'Une nouvelle réservation a été confirmée.' || E'\n\n' ||
    'Client : {{guest_name}}' || E'\n' ||
    'Logement : {{unit_name}}' || E'\n' ||
    'Arrivée : {{check_in}}' || E'\n' ||
    'Départ : {{check_out}}' || E'\n' ||
    'N° réservation : {{reservation_id}}',
    ARRAY['guest_name'],
    true
  )
ON CONFLICT DO NOTHING;

-- checkin_welcome — guest_portal : message de bienvenue sur le portail client
INSERT INTO veraluz_comm_templates
  (tenant_id, template_key, name, audience, event_type, channel, locale,
   subject_template, body_template, variables_schema, active)
VALUES
  (
    'veraluz-001',
    'checkin_welcome',
    'Bienvenue — Portail client',
    'guest',
    'guest_checked_in',
    'guest_portal',
    'fr',
    'Bienvenue à {{property_name}}, {{guest_name}} !',
    'Bonjour {{guest_name}},' || E'\n\n' ||
    'Nous sommes ravis de vous accueillir à {{property_name}}.' || E'\n\n' ||
    'Votre logement : {{unit_name}}' || E'\n' ||
    'Départ prévu : {{check_out}}' || E'\n\n' ||
    'N''hésitez pas à nous contacter à la réception : {{reception_phone}}',
    ARRAY['guest_name', 'property_name'],
    true
  )
ON CONFLICT DO NOTHING;

-- booking_confirmation_guest — guest_portal : confirmation au client
INSERT INTO veraluz_comm_templates
  (tenant_id, template_key, name, audience, event_type, channel, locale,
   subject_template, body_template, variables_schema, active)
VALUES
  (
    'veraluz-001',
    'booking_confirmation_guest',
    'Confirmation réservation — Client portail',
    'guest',
    'reservation_confirmed',
    'guest_portal',
    'fr',
    'Votre réservation à {{property_name}} est confirmée',
    'Bonjour {{guest_name}},' || E'\n\n' ||
    'Votre réservation est confirmée à {{property_name}}.' || E'\n\n' ||
    'Logement : {{unit_name}}' || E'\n' ||
    'Arrivée : {{check_in}}' || E'\n' ||
    'Départ : {{check_out}}' || E'\n' ||
    'N° réservation : {{reservation_id}}' || E'\n\n' ||
    'Pour toute question, contactez la réception : {{reception_phone}}',
    ARRAY['guest_name', 'property_name'],
    true
  )
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OR REPLACE vz_emit_reservation_event
--    Ajoute les comm_jobs pour reservation_confirmed + guest_checked_in
--    CORRIGÉ : client_name/client_email/client_id (pas veraluz_guests JOIN)
--              status='active' AND revoked_at IS NULL AND expires_at>now()
--              template_key (pas template_code)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_name  text;
  v_gs_id       text;    -- guest_session id pour canal guest_portal
  v_eid_out     uuid;    -- event_id checkout
  v_eid_in      uuid;    -- event_id checkin
  v_eid_conf    uuid;    -- event_id confirmed
BEGIN
  -- Résolution locale — pas de JOIN externe
  v_guest_name := COALESCE(NEW.client_name, 'Client');

  -- ── Checkout ──────────────────────────────────────────────────────────────
  IF (OLD.status = 'checkedin' AND NEW.status = 'checkedout') THEN
    v_eid_out := gen_random_uuid();

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_eid_out, 'guest_checked_out', 'reservation-workflow',
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
    ) ON CONFLICT DO NOTHING;

    INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, updated_at, created_at)
    VALUES (v_eid_out, 'create_housekeeping_task', 'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, handler) DO NOTHING;

  END IF;

  -- ── Check-in ──────────────────────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'checkedin' AND NEW.status = 'checkedin') THEN
    v_eid_in := gen_random_uuid();

    -- Session invité active (schéma réel : status, revoked_at, expires_at)
    SELECT id::text INTO v_gs_id
    FROM   veraluz_guest_sessions
    WHERE  reservation_id = NEW.id
      AND  status     = 'active'
      AND  revoked_at IS NULL
      AND  expires_at > now()
    ORDER  BY created_at DESC
    LIMIT  1;

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_eid_in, 'guest_checked_in', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id',  NEW.id,
        'unit_id',         NEW.unit_id,
        'guest_id',        NEW.client_id,
        'guest_name',      v_guest_name,
        'client_email',    NEW.client_email,
        'check_in',        NEW.check_in,
        'check_out',       NEW.check_out,
        'guest_session_id', v_gs_id
      ),
      now()
    ) ON CONFLICT DO NOTHING;

    -- Comm job portail client (si session active)
    IF v_gs_id IS NOT NULL THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
      VALUES
        (v_eid_in, 'checkin_welcome', 'guest_portal', v_gs_id, 'pending', 0, 4, now(), now())
      ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
    END IF;

    -- Comm job email (si adresse email connue)
    IF NEW.client_email IS NOT NULL AND NEW.client_email <> '' THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
      VALUES
        (v_eid_in, 'checkin_welcome', 'email', NEW.client_email, 'pending', 0, 4, now(), now())
      ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
    END IF;

  END IF;

  -- ── Reservation confirmed ─────────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed') THEN
    v_eid_conf := gen_random_uuid();

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_eid_conf, 'reservation_confirmed', 'reservation-workflow',
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
    ) ON CONFLICT DO NOTHING;

    -- Comm job staff interne
    INSERT INTO veraluz_communication_jobs
      (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid_conf, 'booking_confirmation', 'internal', 'department:reception', 'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;

    -- Comm job email client (si adresse email connue)
    IF NEW.client_email IS NOT NULL AND NEW.client_email <> '' THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
      VALUES
        (v_eid_conf, 'reservation_confirmed', 'email', NEW.client_email, 'pending', 0, 4, now(), now())
      ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Trigger déjà créé dans INFRA-OPS-1R — la OR REPLACE ci-dessus suffit.
-- DROP/CREATE trigger si besoin de recréer la liaison :
DROP TRIGGER IF EXISTS trg_emit_reservation_event ON veraluz_reservations;
CREATE TRIGGER trg_emit_reservation_event
  AFTER UPDATE OF status ON veraluz_reservations
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_reservation_event();

-- =============================================================================
-- FIN 20260821_infra_comms_1a.sql (INFRA-COMMS-1B)
-- =============================================================================
