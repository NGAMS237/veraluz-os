-- ═══════════════════════════════════════════════════════════════════════════════
-- INFRA-SCHED-1 : Scheduler automatique + Stale recovery + Run tracking
-- Date     : 2026-08-21
-- Branche  : claude/settings-ssot-1a
-- ═══════════════════════════════════════════════════════════════════════════════
-- INTERDIT : SUPABASE_SERVICE_ROLE_KEY en clair ici
-- INTERDIT : DISABLE RLS
-- INTERDIT : merge main / déploiement direct
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colonnes de suivi sur veraluz_event_jobs
--    claimed_at : timestamp du dernier claim (stale recovery)
--    worker_id  : identifiant d'invocation (run_id UUID)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_event_jobs
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id   text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Colonnes de suivi sur veraluz_communication_jobs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_communication_jobs
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id   text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Mise à jour des RPCs claim — inclure claimed_at + worker_id
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_event_jobs(
  p_batch     int  DEFAULT 20,
  p_worker_id text DEFAULT NULL
)
RETURNS SETOF veraluz_event_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE veraluz_event_jobs ej
  SET    status     = 'processing',
         attempt    = ej.attempt + 1,
         claimed_at = now(),
         worker_id  = p_worker_id,
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

CREATE OR REPLACE FUNCTION claim_communication_jobs(
  p_batch     int  DEFAULT 20,
  p_worker_id text DEFAULT NULL
)
RETURNS SETOF veraluz_communication_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE veraluz_communication_jobs cj
  SET    status     = 'processing',
         attempt    = cj.attempt + 1,
         claimed_at = now(),
         worker_id  = p_worker_id,
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
-- 4. RPC recover_stale_jobs
--    Remet en 'pending' les jobs bloqués en 'processing' depuis > p_threshold_minutes.
--    JAMAIS completed / dead rebasculés.
--    Atomique (transaction implicite RPC).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recover_stale_jobs(
  p_threshold_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff     timestamptz := now() - (p_threshold_minutes || ' minutes')::interval;
  v_ev_count   int;
  v_comm_count int;
BEGIN
  -- ── Event jobs ────────────────────────────────────────────────
  WITH stale_ev AS (
    UPDATE veraluz_event_jobs
    SET    status     = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
           last_error = CASE WHEN attempt >= max_attempts
                             THEN 'recovered_dead_stale'
                             ELSE 'recovered_stale_processing'
                        END,
           updated_at = now()
    WHERE  status     = 'processing'
      AND  claimed_at < v_cutoff   -- utiliser claimed_at pour la détection stale
      AND  status NOT IN ('completed','dead')
    RETURNING id
  )
  SELECT count(*) INTO v_ev_count FROM stale_ev;

  -- ── Communication jobs ────────────────────────────────────────
  WITH stale_comm AS (
    UPDATE veraluz_communication_jobs
    SET    status     = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
           last_error = CASE WHEN attempt >= max_attempts
                             THEN 'recovered_dead_stale'
                             ELSE 'recovered_stale_processing'
                        END,
           updated_at = now()
    WHERE  status     = 'processing'
      AND  claimed_at < v_cutoff
      AND  status NOT IN ('completed','dead')
    RETURNING id
  )
  SELECT count(*) INTO v_comm_count FROM stale_comm;

  RETURN jsonb_build_object(
    'recovered_event_jobs', v_ev_count,
    'recovered_comm_jobs',  v_comm_count,
    'threshold_minutes',    p_threshold_minutes,
    'cutoff',               v_cutoff
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. veraluz_infra_runs — journal minimal des passages scheduler
--    Pas de payload métier.  RLS activé.  service_role write.
--    Lecture gérant via infra-health uniquement.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veraluz_infra_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text        NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','completed','partial','failed')),
  trigger_source   text        NOT NULL DEFAULT 'cron'
    CHECK (trigger_source IN ('cron','manual')),
  event_processed  int         NOT NULL DEFAULT 0,
  event_completed  int         NOT NULL DEFAULT 0,
  event_failed     int         NOT NULL DEFAULT 0,
  event_dead       int         NOT NULL DEFAULT 0,
  comm_processed   int         NOT NULL DEFAULT 0,
  comm_completed   int         NOT NULL DEFAULT 0,
  comm_failed      int         NOT NULL DEFAULT 0,
  comm_dead        int         NOT NULL DEFAULT 0,
  recovered_jobs   int         NOT NULL DEFAULT 0,
  duration_ms      int,
  error_message    text
);

ALTER TABLE veraluz_infra_runs ENABLE ROW LEVEL SECURITY;

-- Aucune politique = deny-all pour rôles non-service_role
-- service_role bypass RLS automatiquement

-- Index pour infra-health (dernière run)
CREATE INDEX IF NOT EXISTS idx_infra_runs_started_at
  ON veraluz_infra_runs (started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. veraluz_payments — trigger payment_recorded
--    Uniquement sur VRAIE TRANSITION : OLD.status != 'validated' ET
--    NEW.status = 'validated'
--    Les 44 paiements déjà validated en PROD ne déclenchent RIEN.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_payment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eid          uuid;
  v_reservation  text;
  v_client_email text;
  v_gs_id        text;
BEGIN
  -- Guard : uniquement UPDATE avec vraie transition vers validated
  IF TG_OP = 'INSERT' AND NEW.status != 'validated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Si OLD.status était déjà validated : rien (évite re-déclenchement)
    IF OLD.status = 'validated' THEN
      RETURN NEW;
    END IF;
    IF NEW.status != 'validated' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Récupérer reservation_id (TEXT) et client_email depuis veraluz_reservations
  SELECT r.id::text, r.client_email
  INTO   v_reservation, v_client_email
  FROM   veraluz_reservations r
  WHERE  r.id::text = NEW.reservation_id::text
  LIMIT  1;

  -- Payload minimal — JAMAIS proof_url, données carte, token, secret
  v_eid := gen_random_uuid();
  INSERT INTO veraluz_events (
    id, event_type, payload, source,
    entity_type, entity_id,
    reservation_id, actor_type, actor_id, created_at
  ) VALUES (
    v_eid,
    'payment_recorded',
    jsonb_build_object(
      'payment_id',    NEW.id,
      'reservation_id', COALESCE(v_reservation, NEW.reservation_id::text),
      'amount',        NEW.amount,
      'method',        NEW.method,
      'validated_at',  now()
      -- INTERDIT : proof_url, card_data, token, secret
    ),
    'db_trigger',
    'payment',  NEW.id::text,
    COALESCE(v_reservation, NEW.reservation_id::text),
    'system',   'payment_trigger',
    now()
  )
  ON CONFLICT DO NOTHING;  -- guard idempotence (ne devrait pas se produire)

  -- ── Communication job : email si client_email existe ─────────
  IF v_client_email IS NOT NULL AND v_client_email != '' THEN
    INSERT INTO veraluz_communication_jobs
      (event_id, template_key, channel, recipient_ref,
       status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid, 'payment_confirmed', 'email', v_client_email,
       'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
  END IF;

  -- ── Communication job : guest_portal si session active existe ─
  SELECT gs.id::text INTO v_gs_id
  FROM   veraluz_guest_sessions gs
  WHERE  gs.reservation_id = COALESCE(v_reservation, NEW.reservation_id::text)
    AND  gs.status       = 'active'
    AND  gs.revoked_at   IS NULL
    AND  gs.expires_at   >  now()
  ORDER  BY gs.created_at DESC
  LIMIT  1;

  IF v_gs_id IS NOT NULL THEN
    INSERT INTO veraluz_communication_jobs
      (event_id, template_key, channel, recipient_ref,
       status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid, 'payment_confirmed', 'guest_portal', v_gs_id,
       'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Attacher le trigger UNIQUEMENT sur UPDATE (pas INSERT pour éviter backfill)
-- Les paiements créés directement validated utiliseraient INSERT, mais la
-- contrainte guard ci-dessus protège aussi ce cas.
DROP TRIGGER IF EXISTS trg_payment_recorded ON veraluz_payments;
CREATE TRIGGER trg_payment_recorded
  AFTER INSERT OR UPDATE OF status ON veraluz_payments
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_payment_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed template payment_confirmed dans veraluz_comm_templates (SSOT)
-- ─────────────────────────────────────────────────────────────────────────────

-- payment_confirmed — email : confirmation paiement au client
INSERT INTO veraluz_comm_templates
  (tenant_id, template_key, name, audience, event_type, channel, locale,
   subject_template, body_template, variables_schema, active)
VALUES (
  'veraluz-001',
  'payment_confirmed',
  'Paiement confirmé — Client',
  'guest',
  'payment_recorded',
  'email',
  'fr',
  'Paiement reçu — {{property_name}}',
  'Bonjour {{guest_name}},' || E'\n\n' ||
  'Nous avons bien reçu votre paiement pour votre réservation.' || E'\n\n' ||
  'N° réservation : {{reservation_id}}' || E'\n' ||
  'Logement       : {{unit_name}}' || E'\n' ||
  'Arrivée        : {{check_in}}' || E'\n' ||
  'Départ         : {{check_out}}' || E'\n\n' ||
  'Merci de votre confiance.' || E'\n\n' ||
  'L''équipe {{property_name}}' || E'\n' ||
  '{{reception_phone}}',
  ARRAY['guest_name', 'reservation_id', 'unit_name', 'check_in', 'check_out'],
  true
)
ON CONFLICT DO NOTHING;

-- payment_confirmed — guest_portal : confirmation paiement dans le portail
INSERT INTO veraluz_comm_templates
  (tenant_id, template_key, name, audience, event_type, channel, locale,
   subject_template, body_template, variables_schema, active)
VALUES (
  'veraluz-001',
  'payment_confirmed',
  'Paiement confirmé — Portail invité',
  'guest',
  'payment_recorded',
  'guest_portal',
  'fr',
  'Votre paiement a été reçu',
  'Bonjour {{guest_name}},' || E'\n\n' ||
  'Votre paiement a bien été enregistré pour la réservation {{reservation_id}}.' || E'\n\n' ||
  'Merci et à bientôt !' || E'\n' ||
  'L''équipe {{property_name}}',
  ARRAY['guest_name', 'reservation_id'],
  true
)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. pg_cron — schedule infra-scheduler (DÉSACTIVÉ par défaut)
--    SUPABASE_SERVICE_ROLE_KEY n'est JAMAIS mis en clair ici.
--    Utiliser Supabase Vault (vault.secrets) ou la variable d'env serveur.
--    Activer manuellement dans le dashboard Supabase après configuration Vault.
--    Cadence : toutes les minutes.
-- ─────────────────────────────────────────────────────────────────────────────

-- DÉCOMMENTEZ ET ADAPTEZ après avoir configuré Vault :
--
-- SELECT cron.schedule(
--   'veraluz-infra-scheduler',                        -- job name
--   '* * * * *',                                      -- toutes les minutes
--   $$
--   SELECT net.http_post(
--     url     := current_setting('app.supabase_url') || '/functions/v1/infra-scheduler',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret
--                                      FROM   vault.decrypted_secrets
--                                      WHERE  name = 'supabase_service_role_key'
--                                      LIMIT  1),
--       'Content-Type', 'application/json'
--     ),
--     body    := '{"source":"cron"}'::jsonb
--   );
--   $$
-- );
--
-- PROCÉDURE DE DÉPLOIEMENT SÛRE :
-- 1. Stocker la clé dans Vault : INSERT INTO vault.secrets (name, secret) VALUES ('supabase_service_role_key', '<votre_clé>');
-- 2. Vérifier que pg_net et pg_cron sont activés dans le projet Supabase.
-- 3. Définir app.supabase_url dans la configuration du projet.
-- 4. Décommenter et exécuter le SELECT cron.schedule(...) ci-dessus.
-- 5. Vérifier avec : SELECT * FROM cron.job WHERE jobname = 'veraluz-infra-scheduler';
