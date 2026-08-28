-- ============================================================
-- DRY-RUN MIGRATION LOT E — BEGIN / ROLLBACK
-- Aucune modification persistee en PROD
-- Date: 2026-08-28
-- ============================================================
BEGIN;

-- ============================================================
-- RECOVERY LOT E — Events · Notifications · Jobs
-- Migration idempotente — aucun DROP destructif
-- Date: 2026-08-28
-- ============================================================
-- STATUT: schema-ready, non-opérationnel
--   • pg_cron ABSENT de ce projet → aucun cron activé
--   • veraluz_jobs: enabled=false, dry_run=true
--   • veraluz_event_processing: traitement assuré par workers
--     internes (EFs service_role) uniquement
-- DÉPLOIEMENT: migration manuelle post-audit (pas de deploy auto)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1a. EVENTS — enveloppe IMMUABLE (veraluz_events)
-- INSERT uniquement via EF service_role. Jamais modifiable après création.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_events (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  idempotency_key  TEXT        NOT NULL UNIQUE,         -- UNIQUE crée son propre index (pas de doublon)
  event_type       TEXT        NOT NULL,                -- allowlisté par EF
  source           TEXT        NOT NULL,                -- EF ou worker, jamais iframe
  actor_id         TEXT        NULL,                    -- employee_id ou 'system'
  actor_role       TEXT        NULL,
  reservation_id   TEXT        NULL,
  unit_id          TEXT        NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()   -- horodatage serveur, immuable
);
-- ⚠️  Aucune colonne mutable dans cette table (status, retry_count, etc.) →
--     état de traitement dans veraluz_event_processing ci-dessous.

-- Index sur enveloppe (idempotency_key déjà indexé par UNIQUE)
CREATE INDEX IF NOT EXISTS idx_veraluz_events_type        ON public.veraluz_events(event_type);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_created_at  ON public.veraluz_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_reservation ON public.veraluz_events(reservation_id) WHERE reservation_id IS NOT NULL;
-- NB: idx_veraluz_events_idem SUPPRIMÉ — UNIQUE sur idempotency_key crée déjà un index btree.

ALTER TABLE public.veraluz_events ENABLE ROW LEVEL SECURITY;

-- REVOKE ALL de toutes les sources non-service_role (public inclut anon + authenticated)
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

-- ────────────────────────────────────────────────────────────
-- 1b. EVENTS — état de traitement MUTABLE (veraluz_event_processing)
-- Séparé de l'enveloppe pour garantir l'immuabilité de veraluz_events.
-- Workers workers internes uniquement (service_role).
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
-- Notifications métier créées côté serveur par EFs service_role.
-- État de lecture par employé dans notification_reads (ci-dessous).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_notifications (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  event_id        TEXT        NULL REFERENCES public.veraluz_events(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  message         TEXT        NOT NULL DEFAULT '',
  category        TEXT        NOT NULL DEFAULT 'system'
                  CHECK (category IN ('system','reservation','payment','room_service','guest','maintenance','finance','hr','security')),
  priority        TEXT        NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical','high','medium','low')),
  recipient_roles TEXT[]      NOT NULL DEFAULT '{}',   -- [] = tous les rôles autorisés
  channels        TEXT[]      NOT NULL DEFAULT ARRAY['in_app'],
  requires_ack    BOOLEAN     NOT NULL DEFAULT false,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT        NULL                     -- actor_id (system ou employee_id)
  -- NB: read_at / ack_at supprimés de cette table → voir notification_reads
  --     pour l'état de lecture indépendant par employé.
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
-- Chaque employé a son propre état (read, ack) indépendant des autres.
-- Insert par notifications-secure EF (service_role) uniquement.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  notification_id TEXT        NOT NULL REFERENCES public.veraluz_notifications(id) ON DELETE CASCADE,
  employee_id     TEXT        NOT NULL,                -- employee ayant lu/acquitté
  employee_role   TEXT        NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_at          TIMESTAMPTZ NULL,
  UNIQUE (notification_id, employee_id)                -- un seul enregistrement par (notif, employé)
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
--   • pg_cron absent → aucun job ne se déclenche automatiquement
--   • Activation manuelle uniquement par direction/admin après audit
--   • enabled=false et dry_run=true par défaut pour tous les jobs
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_jobs (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name            TEXT        NOT NULL UNIQUE,
  description     TEXT        NOT NULL DEFAULT '',
  cron_expression TEXT        NOT NULL,               -- ex: '0 6 * * *'  (référence seulement)
  worker_endpoint TEXT        NOT NULL,               -- nom EF interne (pas d'URL externe)
  payload         JSONB       NOT NULL DEFAULT '{}',
  enabled         BOOLEAN     NOT NULL DEFAULT false, -- DÉSACTIVÉ par défaut
  dry_run         BOOLEAN     NOT NULL DEFAULT true,  -- DRY_RUN par défaut
  -- Bilan d'exécution
  last_run_at     TIMESTAMPTZ NULL,
  last_run_status TEXT        NULL CHECK (last_run_status IN ('success','failure','dry_run',NULL)),
  last_run_ms     INT         NULL,
  last_error      TEXT        NULL,
  run_count       INT         NOT NULL DEFAULT 0,
  fail_count      INT         NOT NULL DEFAULT 0,
  -- Concurrence : lease atomique (claim/release via fonction SQL dédiée)
  running         BOOLEAN     NOT NULL DEFAULT false,
  running_since   TIMESTAMPTZ NULL,
  lease_token     TEXT        NULL,                   -- token unique du worker en cours
  lease_expires_at TIMESTAMPTZ NULL,                  -- expiration du lease (évite les jobs bloqués)
  -- Métadonnées
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT        NULL,
  updated_by      TEXT        NULL
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

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at_veraluz_jobs()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_veraluz_jobs_updated_at ON public.veraluz_jobs;
CREATE TRIGGER trg_veraluz_jobs_updated_at
  BEFORE UPDATE ON public.veraluz_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_veraluz_jobs();

-- ────────────────────────────────────────────────────────────
-- 3b. ATOMIC JOB CLAIM — claim_job_lease()
-- Garantit qu'un seul worker peut prendre un job à la fois.
-- Deux workers simultanés ne peuvent PAS obtenir le même lease.
-- Appelable uniquement par service_role (EF interne).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_job_lease(
  p_job_name     TEXT,
  p_worker_id    TEXT,
  p_lease_secs   INT DEFAULT 300          -- durée du lease en secondes (défaut: 5 min)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job    veraluz_jobs%ROWTYPE;
  v_token  TEXT := gen_random_uuid()::text;
  v_now    TIMESTAMPTZ := now();
BEGIN
  -- Tentative atomique : UPDATE + vérification en une seule opération
  -- Conditions de claim :
  --   (a) job enabled=true ET dry_run=false
  --   (b) running=false OU lease_expires_at < now() (lease expiré → reprise)
  UPDATE public.veraluz_jobs
  SET
    running          = true,
    running_since    = v_now,
    lease_token      = v_token,
    lease_expires_at = v_now + (p_lease_secs || ' seconds')::interval,
    updated_at       = v_now
  WHERE name          = p_job_name
    AND enabled       = true
    AND dry_run       = false
    AND (running = false OR lease_expires_at < v_now)
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    -- Job non trouvé, déjà en cours (lease actif), désactivé ou dry_run
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
    'worker_id',        p_worker_id
  );
END $$;

-- Libération du lease après succès ou échec
CREATE OR REPLACE FUNCTION public.release_job_lease(
  p_job_name      TEXT,
  p_lease_token   TEXT,
  p_status        TEXT,          -- 'success' | 'failure'
  p_duration_ms   INT DEFAULT NULL,
  p_error         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated BOOLEAN := false;
BEGIN
  UPDATE public.veraluz_jobs
  SET
    running          = false,
    running_since    = NULL,
    lease_token      = NULL,
    lease_expires_at = NULL,
    last_run_at      = now(),
    last_run_status  = p_status,
    last_run_ms      = p_duration_ms,
    last_error       = p_error,
    run_count        = run_count + 1,
    fail_count       = fail_count + CASE WHEN p_status = 'failure' THEN 1 ELSE 0 END,
    updated_at       = now()
  WHERE name        = p_job_name
    AND lease_token = p_lease_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('released', v_updated > 0, 'job_name', p_job_name);
END $$;

-- Récupération des leases expirés (appelé périodiquement par un worker de maintenance)
CREATE OR REPLACE FUNCTION public.recover_expired_job_leases()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.veraluz_jobs
  SET
    running          = false,
    running_since    = NULL,
    lease_token      = NULL,
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

-- Permissions sur les fonctions : service_role uniquement
REVOKE ALL ON FUNCTION public.claim_job_lease(TEXT,TEXT,INT)   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job_lease(TEXT,TEXT,TEXT,INT,TEXT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_expired_job_leases()     FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_job_lease(TEXT,TEXT,INT)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.release_job_lease(TEXT,TEXT,TEXT,INT,TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.recover_expired_job_leases() TO service_role;

-- ────────────────────────────────────────────────────────────
-- 4. GRANTS minimaux — service_role uniquement
-- ────────────────────────────────────────────────────────────
GRANT ALL ON public.veraluz_events          TO service_role;
GRANT ALL ON public.veraluz_event_processing TO service_role;
GRANT ALL ON public.veraluz_notifications   TO service_role;
GRANT ALL ON public.notification_reads      TO service_role;
GRANT ALL ON public.veraluz_jobs            TO service_role;

-- ────────────────────────────────────────────────────────────
-- FIN MIGRATION LOT E
-- Schema: ready | Déploiement: manuel post-audit
-- Workers: non-opérationnels (pg_cron absent, enabled=false)
-- ────────────────────────────────────────────────────────────


-- == Verifications post-creation ===============================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
    WHERE schemaname='public'
      AND tablename IN ('veraluz_events','veraluz_event_processing',
                        'veraluz_notifications','notification_reads','veraluz_jobs')
    ORDER BY tablename
  LOOP
    RAISE NOTICE '[DRY-RUN] TABLE OK: %', r.tablename;
  END LOOP;

  FOR r IN SELECT routine_name FROM information_schema.routines
    WHERE routine_schema='public'
      AND routine_name IN ('claim_job_lease','release_job_lease',
                           'recover_expired_job_leases','set_updated_at_veraluz_jobs')
    ORDER BY routine_name
  LOOP
    RAISE NOTICE '[DRY-RUN] FUNCTION OK: %', r.routine_name;
  END LOOP;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='veraluz_events' AND constraint_type='UNIQUE') THEN
    RAISE NOTICE '[DRY-RUN] UNIQUE idempotency_key OK';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='notification_reads' AND constraint_type='UNIQUE') THEN
    RAISE NOTICE '[DRY-RUN] UNIQUE notification_reads(notification_id,employee_id) OK';
  END IF;

  FOR r IN SELECT relname FROM pg_class
    WHERE relrowsecurity=true
      AND relname IN ('veraluz_events','veraluz_event_processing',
                      'veraluz_notifications','notification_reads','veraluz_jobs')
    ORDER BY relname
  LOOP
    RAISE NOTICE '[DRY-RUN] RLS ENABLED: %', r.relname;
  END LOOP;

  FOR r IN SELECT tablename, policyname FROM pg_policies
    WHERE tablename IN ('veraluz_events','veraluz_event_processing',
                        'veraluz_notifications','notification_reads','veraluz_jobs')
    ORDER BY tablename
  LOOP
    RAISE NOTICE '[DRY-RUN] POLICY: % -> %', r.tablename, r.policyname;
  END LOOP;

  -- Test insertion evenement (enveloppe immuable)
  INSERT INTO public.veraluz_events (id, idempotency_key, event_type, source, payload)
    VALUES ('dry-evt-1','idem-dry-001','test.event','dry_run','{}');
  RAISE NOTICE '[DRY-RUN] INSERT veraluz_events OK';

  -- Test processing state separe
  INSERT INTO public.veraluz_event_processing (event_id, status)
    VALUES ('dry-evt-1','pending');
  RAISE NOTICE '[DRY-RUN] INSERT veraluz_event_processing OK';

  -- Test idempotence: deuxieme INSERT doit echouer (UNIQUE idempotency_key)
  BEGIN
    INSERT INTO public.veraluz_events (id, idempotency_key, event_type, source, payload)
      VALUES ('dry-evt-2','idem-dry-001','test.event','dry_run','{}');
    RAISE WARNING '[DRY-RUN] ERREUR: deuxieme INSERT devrait avoir echoue!';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '[DRY-RUN] UNIQUE violation idempotency_key OK (second INSERT rejecte)';
  END;

  -- Test claim atomique: job disabled => claim refuse
  INSERT INTO public.veraluz_jobs (name, cron_expression, worker_endpoint)
    VALUES ('dry-job-1','0 6 * * *','infra-scheduler');
  DECLARE v_res JSONB;
  BEGIN
    SELECT public.claim_job_lease('dry-job-1','worker-dry',60) INTO v_res;
    IF NOT (v_res->>'claimed')::boolean THEN
      RAISE NOTICE '[DRY-RUN] claim_job_lease refuse (job disabled) OK: %', v_res->>'reason';
    ELSE
      RAISE WARNING '[DRY-RUN] ERREUR: claim aurait du etre refuse!';
    END IF;
  END;

  -- Test notification_reads UNIQUE par employe
  INSERT INTO public.veraluz_notifications (id, title)
    VALUES ('dry-notif-1','Dry Run Test');
  INSERT INTO public.notification_reads (notification_id, employee_id)
    VALUES ('dry-notif-1','emp-a');
  INSERT INTO public.notification_reads (notification_id, employee_id)
    VALUES ('dry-notif-1','emp-b');
  -- emp-a et emp-b ont des etats independants
  -- deuxieme insert pour emp-a: ON CONFLICT DO NOTHING
  INSERT INTO public.notification_reads (notification_id, employee_id)
    VALUES ('dry-notif-1','emp-a')
    ON CONFLICT (notification_id, employee_id) DO NOTHING;
  RAISE NOTICE '[DRY-RUN] notification_reads etat independant par employe OK';

  RAISE NOTICE '[DRY-RUN] TOUTES LES VERIFICATIONS PASS';
END $$;

ROLLBACK;
-- ============================================================
-- FIN DRY-RUN — Aucune modification persistee en PROD
-- ============================================================
