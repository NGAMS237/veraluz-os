-- =============================================================================
-- INFRA-COMMS-1A : File de communication centralisée
-- Migration : 20260821_infra_comms_1a.sql
-- Branche   : claude/settings-ssot-1a
-- =============================================================================
-- Ordre d'opérations :
--   1. veraluz_communication_templates (code UNIQUE, channels whitelist)
--   2. veraluz_communication_jobs (UNIQUE event_id+template_code+channel+recipient_ref)
--   3. RPC claim_communication_jobs (FOR UPDATE SKIP LOCKED)
--   4. Seed templates canoniques
--   5. OR REPLACE vz_emit_reservation_event — ajouter comm_jobs pour confirmed+checked_in
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. veraluz_communication_templates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veraluz_communication_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  channel     text        NOT NULL CHECK (channel IN ('email', 'internal', 'guest_portal')),
  name        text        NOT NULL,
  subject     text        NOT NULL DEFAULT '',
  body        text        NOT NULL DEFAULT '',
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE veraluz_communication_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'veraluz_communication_templates'
      AND policyname = 'no_direct_access_comm_templates'
  ) THEN
    CREATE POLICY no_direct_access_comm_templates ON veraluz_communication_templates
      AS RESTRICTIVE FOR ALL TO public USING (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. veraluz_communication_jobs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veraluz_communication_jobs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid        NOT NULL REFERENCES veraluz_events(id),
  template_code  text        NOT NULL,
  channel        text        NOT NULL CHECK (channel IN ('email', 'internal', 'guest_portal')),
  recipient_ref  text        NOT NULL,   -- email, guest_session_id, ou employee_id
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processing','completed','failed','dead','email_not_configured')),
  attempt        int         NOT NULL DEFAULT 0,
  max_attempts   int         NOT NULL DEFAULT 4,
  last_error     text,
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, template_code, channel, recipient_ref)
);

CREATE INDEX IF NOT EXISTS idx_comm_jobs_status_created
  ON veraluz_communication_jobs (status, created_at)
  WHERE status = 'pending';

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
-- 3. RPC claim_communication_jobs
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
-- 4. Seed templates canoniques (INSERT … ON CONFLICT DO NOTHING = idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- booking_confirmation — canal internal (notification staff à la création)
INSERT INTO veraluz_communication_templates
  (code, channel, name, subject, body)
VALUES
  (
    'booking_confirmation',
    'internal',
    'Confirmation de réservation — Notification staff',
    'Nouvelle réservation confirmée — {{guest_name}}',
    'Une nouvelle réservation a été confirmée.' || E'\n\n' ||
    'Client : {{guest_name}}' || E'\n' ||
    'Logement : {{unit_name}}' || E'\n' ||
    'Arrivée : {{check_in}}' || E'\n' ||
    'Départ : {{check_out}}' || E'\n' ||
    'N° réservation : {{reservation_id}}'
  )
ON CONFLICT (code) DO NOTHING;

-- booking_confirmation — canal guest_portal (message au client)
INSERT INTO veraluz_communication_templates
  (code, channel, name, subject, body)
VALUES
  (
    'booking_confirmation_guest',
    'guest_portal',
    'Confirmation de réservation — Client',
    'Votre réservation à {{property_name}} est confirmée',
    'Bonjour {{guest_name}},' || E'\n\n' ||
    'Votre réservation est confirmée à {{property_name}}.' || E'\n\n' ||
    'Logement : {{unit_name}}' || E'\n' ||
    'Arrivée : {{check_in}}' || E'\n' ||
    'Départ : {{check_out}}' || E'\n' ||
    'N° réservation : {{reservation_id}}' || E'\n\n' ||
    'Pour toute question, contactez-nous : {{reception_phone}}'
  )
ON CONFLICT (code) DO NOTHING;

-- checkin_welcome — canal guest_portal
INSERT INTO veraluz_communication_templates
  (code, channel, name, subject, body)
VALUES
  (
    'checkin_welcome',
    'guest_portal',
    'Message de bienvenue — Arrivée client',
    'Bienvenue à {{property_name}}, {{guest_name}} !',
    'Bonjour {{guest_name}},' || E'\n\n' ||
    'Nous sommes ravis de vous accueillir à {{property_name}}.' || E'\n\n' ||
    'Votre logement : {{unit_name}}' || E'\n' ||
    'Départ prévu : {{check_out}}' || E'\n\n' ||
    'N''hésitez pas à nous contacter à la réception : {{reception_phone}}'
  )
ON CONFLICT (code) DO NOTHING;

-- payment_confirmation — canal guest_portal
INSERT INTO veraluz_communication_templates
  (code, channel, name, subject, body)
VALUES
  (
    'payment_confirmation',
    'guest_portal',
    'Confirmation de paiement',
    'Paiement reçu — {{property_name}}',
    'Bonjour {{guest_name}},' || E'\n\n' ||
    'Nous avons bien reçu votre paiement pour votre séjour à {{property_name}}.' || E'\n\n' ||
    'N° réservation : {{reservation_id}}' || E'\n' ||
    'Pour toute question : {{reception_phone}}'
  )
ON CONFLICT (code) DO NOTHING;

-- checkout_thank_you — canal guest_portal
INSERT INTO veraluz_communication_templates
  (code, channel, name, subject, body)
VALUES
  (
    'checkout_thank_you',
    'guest_portal',
    'Message de remerciement — Départ client',
    'Merci de votre séjour à {{property_name}}',
    'Bonjour {{guest_name}},' || E'\n\n' ||
    'Merci d''avoir séjourné à {{property_name}} ! Nous espérons vous revoir bientôt.' || E'\n\n' ||
    'N° réservation : {{reservation_id}}'
  )
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Étendre vz_emit_reservation_event pour insérer des comm_jobs
--    Proof #1 : reservation_confirmed → booking_confirmation (internal)
--    Proof #2 : guest_checked_in → checkin_welcome (guest_portal)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id    uuid := gen_random_uuid();
  v_guest_name  text;
  v_guest_email text;
  v_gs_id       text;   -- guest_session id (recipient pour guest_portal)
BEGIN

  -- ── Résoudre le profil invité ──────────────────────────────
  SELECT
    COALESCE(g.full_name, g.first_name || ' ' || g.last_name, 'Inconnu'),
    g.email
  INTO v_guest_name, v_guest_email
  FROM veraluz_guests g
  WHERE g.id = NEW.guest_id;

  -- ── Checkout ──────────────────────────────────────────────
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
        'guest_id',       NEW.guest_id,
        'guest_name',     v_guest_name,
        'checkout_time',  now()
      ),
      now()
    ) ON CONFLICT DO NOTHING;

    INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, created_at)
    VALUES (v_event_id, 'create_housekeeping_task', 'pending', 0, 4, now())
    ON CONFLICT (event_id, handler) DO NOTHING;

  END IF;

  -- ── Check-in ──────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'checkedin' AND NEW.status = 'checkedin') THEN

    -- Chercher une session invité active
    SELECT id::text INTO v_gs_id
    FROM   veraluz_guest_sessions
    WHERE  reservation_id = NEW.id
      AND  checked_out_at IS NULL
    LIMIT 1;

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_event_id, 'guest_checked_in', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'unit_id',        NEW.unit_id,
        'guest_id',       NEW.guest_id,
        'guest_name',     v_guest_name,
        'check_in',       NEW.check_in,
        'check_out',      NEW.check_out,
        'guest_session_id', v_gs_id
      ),
      now()
    ) ON CONFLICT DO NOTHING;

    -- Comm job : message de bienvenue sur le portail client
    IF v_gs_id IS NOT NULL THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_code, channel, recipient_ref, status, attempt, max_attempts, created_at)
      VALUES
        (v_event_id, 'checkin_welcome', 'guest_portal', v_gs_id, 'pending', 0, 4, now())
      ON CONFLICT (event_id, template_code, channel, recipient_ref) DO NOTHING;
    END IF;

  END IF;

  -- ── Confirmed ─────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed') THEN

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_event_id, 'reservation_confirmed', 'reservation-workflow',
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
    ) ON CONFLICT DO NOTHING;

    -- Comm job : notification staff interne
    INSERT INTO veraluz_communication_jobs
      (event_id, template_code, channel, recipient_ref, status, attempt, max_attempts, created_at)
    VALUES
      (v_event_id, 'booking_confirmation', 'internal', 'department:reception', 'pending', 0, 4, now())
    ON CONFLICT (event_id, template_code, channel, recipient_ref) DO NOTHING;

  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger existe déjà (créé dans INFRA-OPS-1R) — OR REPLACE de la fonction suffit.
-- Pas besoin de DROP/CREATE trigger.

-- =============================================================================
-- FIN 20260821_infra_comms_1a.sql
-- =============================================================================
