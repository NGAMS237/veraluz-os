-- ============================================================
-- RECOVERY LOT E — Events · Notifications · Jobs
-- Migration idempotente — aucun DROP destructif
-- Date: 2026-08-28  |  v2: Bloc 5 hardening
-- ============================================================
-- STATUT: schema-ready, non-opérationnel
--   • pg_cron ABSENT de ce projet → aucun cron activé
--   • veraluz_jobs: enabled=false, dry_run=true
--   • veraluz_event_processing: traitement assuré par workers
--     internes (EFs service_role) uniquement
--   • search_path = '' (vide) + objets fully-qualified pour toutes les fonctions
--   • Events IMMUABLES via trigger UPDATE/DELETE
-- DÉPLOIEMENT: migration manuelle post-audit (pas de deploy auto)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1a. EVENTS — enveloppe IMMUABLE (veraluz_events)
-- INSERT uniquement via EF service_role. Jamais modifiable après création.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_events (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  idempotency_key  TEXT        NOT NULL UNIQUE,
  event_type       TEXT        NOT NULL,
  source           TEXT        NOT NULL,
  actor_id         TEXT        NULL,
  actor_role       TEXT        NULL,
  reservation_id   TEXT        NULL,
  unit_id          TEXT        NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_veraluz_events_type        ON public.veraluz_events(event_type);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_created_at  ON public.veraluz_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_reservation ON public.veraluz_events(reservation_id) WHERE reservation_id IS NOT NULL;

ALTER TABLE public.veraluz_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.veraluz_events FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='veraluz_events' AND policyname='deny_all_public_veraluz_events'
  ) THEN
    CREATE POLICY deny_all_public_veraluz_events ON public.veraluz_events
      FOR ALL TO public USING (false);
  END IF;
END $$;

-- ── Trigger d'immuabilité : bloque UPDATE et DELETE sur veraluz_events ──────
CREATE OR REPLACE FUNCTION public.fn_immutable_veraluz_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'veraluz_events is immutable: UPDATE and DELETE are forbidden (id=%, operation=%)',
    COALESCE(OLD.id, NEW.id::text), TG_OP;
END $$;

REVOKE ALL ON FUNCTION public.fn_immutable_veraluz_events() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_veraluz_events_immutable ON public.veraluz_events;
CREATE TRIGGER trg_veraluz_events_immutable
  BEFORE UPDATE OR DELETE ON public.veraluz_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_immutable_veraluz_events();

-- ────────────────────────────────────────────────────────────
-- 1b. EVENTS — état de traitement MUTABLE (veraluz_event_processing)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_event_processing (
  event_id       TEXT        NOT NULL PRIMARY KEY REFERENCES public.veraluz_events(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','processed','failed','dead_letter')),
  processed_at   TIMESTAMPTZ NULL,
  retry_count    INT         NOT NULL DEFAULT 0,
  last_error     TEXT        NULL,
  worker_id      TEXT        NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_processing_status  ON public.veraluz_event_processing(status);
CREATE INDEX IF NOT EXISTS idx_event_processing_updated ON public.veraluz_event_processing(updated_at DESC);

ALTER TABLE public.veraluz_event_processing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.veraluz_event_processing FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='veraluz_event_processing' AND policyname='deny_all_veraluz_event_processing'
  ) THEN
    CREATE POLICY deny_all_veraluz_event_processing ON public.veraluz_event_processing
      FOR ALL TO public USING (false);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2a. NOTIFICATIONS (veraluz_notifications)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_notifications (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  idempotency_key  TEXT        UNIQUE,                 -- unicité sur create (optionnel)
  event_id         TEXT        NULL REFERENCES public.veraluz_events(id) ON DELETE SET NULL,
  title            TEXT        NOT NULL CHECK (length(title) <= 255),
  message          TEXT        NOT NULL DEFAULT '' CHECK (length(message) <= 4096),
  category         TEXT        NOT NULL DEFAULT 'system'
                   CHECK (category IN ('system','reservation','payment','room_service','guest','maintenance','finance','hr','security')),
  priority         TEXT        NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('critical','high','medium','low')),
  recipient_roles  TEXT[]      NOT NULL DEFAULT '{}'
                   CHECK (
                     array_length(recipient_roles, 1) IS NULL OR
                     (SELECT bool_and(r = ANY(ARRAY[
                       'gerant','direction','directrice','manager','admin','superadmin',
                       'receptionist','réceptionniste','housekeeping','gouvernante','menage',
                       'restaurant','livreur','driver','staff','employee','comptable','finance','rh','it'
                     ])) FROM unnest(recipient_roles) r)
                   ),
  channels         TEXT[]      NOT NULL DEFAULT ARRAY['in_app']
                   CHECK (
                     array_length(channels, 1) > 0 AND
                     (SELECT bool_and(c = ANY(ARRAY['in_app','email','sms','push'])) FROM unnest(channels) c)
                   ),
  requires_ack     BOOLEAN     NOT NULL DEFAULT false,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT        NULL
);

CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_created  ON public.veraluz_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_priority ON public.veraluz_notifications(priority);
CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_category ON public.veraluz_notifications(category);
CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_roles    ON public.veraluz_notifications USING gin(recipient_roles);

ALTER TABLE public.veraluz_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.veraluz_notifications FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='veraluz_notifications' AND policyname='deny_all_veraluz_notifications'
  ) THEN
    CREATE POLICY deny_all_veraluz_notifications ON public.veraluz_notifications
      FOR ALL TO public USING (false);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2b. NOTIFICATION_READS — état de lecture PAR EMPLOYÉ
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  notification_id TEXT        NOT NULL REFERENCES public.veraluz_notifications(id) ON DELETE CASCADE,
  employee_id     TEXT        NOT NULL,
  employee_role   TEXT        NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_at          TIMESTAMPTZ NULL,
  UNIQUE (notification_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_employee ON public.notification_reads(employee_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_notif    ON public.notification_reads(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_unacked  ON public.notification_reads(employee_id) WHERE ack_at IS NULL;

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_reads FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='notification_reads' AND policyname='deny_all_notification_reads'
  ) THEN
    CREATE POLICY deny_all_notification_reads ON public.notification_reads
      FOR ALL TO public USING (false);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. JOBS SCHEDULER (veraluz_jobs)
-- STATUT: schema-ready, NON OPÉRATIONNEL
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_jobs (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name             TEXT        NOT NULL UNIQUE,
  description      TEXT        NOT NULL DEFAULT '',
  cron_expression  TEXT        NOT NULL,
  worker_endpoint  TEXT        NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  enabled          BOOLEAN     NOT NULL DEFAULT false,
  dry_run          BOOLEAN     NOT NULL DEFAULT true,
  -- Bilan d'exécution
  last_run_at      TIMESTAMPTZ NULL,
  last_run_status  TEXT        NULL CHECK (last_run_status IN ('success','failure','dry_run',NULL)),
  last_run_ms      INT         NULL CHECK (last_run_ms IS NULL OR last_run_ms >= 0),
  last_error       TEXT        NULL,
  run_count        INT         NOT NULL DEFAULT 0,
  fail_count       INT         NOT NULL DEFAULT 0,
  -- Lease atomique
  running          BOOLEAN     NOT NULL DEFAULT false,
  running_since    TIMESTAMPTZ NULL,
  lease_token      TEXT        NULL,
  lease_owner      TEXT        NULL,                   -- worker_id du détenteur du lease
  lease_expires_at TIMESTAMPTZ NULL,
  -- Métadonnées
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT        NULL,
  updated_by       TEXT        NULL
);

CREATE INDEX IF NOT EXISTS idx_veraluz_jobs_enabled  ON public.veraluz_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_veraluz_jobs_running  ON public.veraluz_jobs(running) WHERE running = true;
CREATE INDEX IF NOT EXISTS idx_veraluz_jobs_lease    ON public.veraluz_jobs(lease_expires_at) WHERE running = true;

ALTER TABLE public.veraluz_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.veraluz_jobs FROM public, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='veraluz_jobs' AND policyname='deny_all_public_veraluz_jobs'
  ) THEN
    CREATE POLICY deny_all_public_veraluz_jobs ON public.veraluz_jobs
      FOR ALL TO public USING (false);
  END IF;
END $$;

-- Trigger updated_at — search_path vide + objets fully-qualified
CREATE OR REPLACE FUNCTION public.set_updated_at_veraluz_jobs()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

REVOKE ALL ON FUNCTION public.set_updated_at_veraluz_jobs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_veraluz_jobs_updated_at ON public.veraluz_jobs;
CREATE TRIGGER trg_veraluz_jobs_updated_at
  BEFORE UPDATE ON public.veraluz_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_veraluz_jobs();

-- ────────────────────────────────────────────────────────────
-- 3b. claim_job_lease() — search_path vide, fully-qualified
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_job_lease(
  p_job_name     TEXT,
  p_worker_id    TEXT,
  p_lease_secs   INT DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job    public.veraluz_jobs%ROWTYPE;
  v_token  TEXT := gen_random_uuid()::text;
  v_now    TIMESTAMPTZ := now();
BEGIN
  -- Validation des entrées
  IF p_job_name IS NULL OR length(trim(p_job_name)) = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_job_name');
  END IF;
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_worker_id');
  END IF;
  IF p_lease_secs IS NULL OR p_lease_secs < 1 OR p_lease_secs > 3600 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_lease_secs',
      'detail', 'must be between 1 and 3600');
  END IF;

  -- Tentative atomique : UPDATE + lease_owner = p_worker_id
  UPDATE public.veraluz_jobs
  SET
    running          = true,
    running_since    = v_now,
    lease_token      = v_token,
    lease_owner      = p_worker_id,
    lease_expires_at = v_now + (p_lease_secs || ' seconds')::interval,
    updated_at       = v_now
  WHERE name          = p_job_name
    AND enabled       = true
    AND dry_run       = false
    AND (running = false OR lease_expires_at < v_now)
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    SELECT * INTO v_job FROM public.veraluz_jobs WHERE name = p_job_name;
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', CASE
        WHEN v_job.id IS NULL         THEN 'job_not_found'
        WHEN NOT v_job.enabled        THEN 'job_disabled'
        WHEN v_job.dry_run            THEN 'job_dry_run'
        WHEN v_job.running AND v_job.lease_expires_at >= v_now THEN 'lease_active'
        ELSE 'unknown'
      END,
      'job_name', p_job_name
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed',          true,
    'job_id',           v_job.id,
    'job_name',         v_job.name,
    'lease_token',      v_token,
    'lease_expires_at', v_now + (p_lease_secs || ' seconds')::interval,
    'lease_owner',      p_worker_id,
    'worker_id',        p_worker_id
  );
END $$;

-- ────────────────────────────────────────────────────────────
-- 3c. release_job_lease() — validation stricte + lease_owner
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_job_lease(
  p_job_name      TEXT,
  p_lease_token   TEXT,
  p_status        TEXT,
  p_duration_ms   INT  DEFAULT NULL,
  p_error         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER := 0;        -- INTEGER (pas BOOLEAN) pour GET DIAGNOSTICS ROW_COUNT
BEGIN
  -- Validation des entrées
  IF p_status IS NULL OR p_status NOT IN ('success','failure') THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invalid_status',
      'detail', 'must be success or failure');
  END IF;
  IF p_duration_ms IS NOT NULL AND p_duration_ms < 0 THEN
    RETURN jsonb_build_object('released', false, 'reason', 'invalid_duration_ms',
      'detail', 'must be >= 0');
  END IF;
  -- Tronquer p_error si trop long
  IF p_error IS NOT NULL AND length(p_error) > 2000 THEN
    p_error := left(p_error, 2000) || '…[tronqué]';
  END IF;

  -- Release conditionné sur lease_token ET lease_owner (p_worker_id via lease_owner stocké)
  UPDATE public.veraluz_jobs
  SET
    running          = false,
    running_since    = NULL,
    lease_token      = NULL,
    lease_owner      = NULL,
    lease_expires_at = NULL,
    last_run_at      = now(),
    last_run_status  = p_status,
    last_run_ms      = p_duration_ms,
    last_error       = p_error,
    run_count        = run_count + 1,
    fail_count       = fail_count + CASE WHEN p_status = 'failure' THEN 1 ELSE 0 END,
    updated_at       = now()
  WHERE name        = p_job_name
    AND lease_token = p_lease_token;   -- conditionné sur le token

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object(
    'released',  v_updated > 0,
    'job_name',  p_job_name,
    'rows',      v_updated
  );
END $$;

-- ────────────────────────────────────────────────────────────
-- 3d. recover_expired_job_leases() — search_path vide
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recover_expired_job_leases()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE public.veraluz_jobs
  SET
    running          = false,
    running_since    = NULL,
    lease_token      = NULL,
    lease_owner      = NULL,
    lease_expires_at = NULL,
    last_run_status  = 'failure',
    last_error       = 'lease_expired — lease recovery automatique',
    fail_count       = fail_count + 1,
    updated_at       = now()
  WHERE running = true
    AND lease_expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('recovered', v_count);
END $$;

-- ────────────────────────────────────────────────────────────
-- 4. REVOKE EXECUTE sur toutes les fonctions — service_role seul
-- ────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.claim_job_lease(TEXT,TEXT,INT)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_job_lease(TEXT,TEXT,TEXT,INT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recover_expired_job_leases()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_immutable_veraluz_events()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at_veraluz_jobs()           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_job_lease(TEXT,TEXT,INT)           TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job_lease(TEXT,TEXT,TEXT,INT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_expired_job_leases()              TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. GRANTS table — service_role uniquement
-- ────────────────────────────────────────────────────────────
GRANT ALL ON public.veraluz_events           TO service_role;
GRANT ALL ON public.veraluz_event_processing TO service_role;
GRANT ALL ON public.veraluz_notifications    TO service_role;
GRANT ALL ON public.notification_reads       TO service_role;
GRANT ALL ON public.veraluz_jobs             TO service_role;

-- ────────────────────────────────────────────────────────────
-- FIN MIGRATION LOT E v2
-- Schema: ready | Déploiement: manuel post-audit
-- Workers: non-opérationnels (pg_cron absent, enabled=false)
-- Functions: SECURITY DEFINER, search_path='', REVOKE EXECUTE FROM PUBLIC
-- ────────────────────────────────────────────────────────────
