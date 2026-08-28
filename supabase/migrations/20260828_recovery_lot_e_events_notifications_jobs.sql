-- ============================================================
-- RECOVERY LOT E — Events · Notifications · Jobs
-- Migration idempotente — aucun DROP destructif
-- Date: 2026-08-28
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. EVENTS CANONIQUES (veraluz_events)
-- Événements métier immuables. État de traitement séparé.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_events (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  idempotency_key  TEXT        NOT NULL UNIQUE,         -- clé côté émetteur
  event_type       TEXT        NOT NULL,                -- allowlisté par EF
  source           TEXT        NOT NULL,                -- EF ou worker, jamais iframe
  actor_id         TEXT        NULL,                    -- employee_id ou 'system'
  actor_role       TEXT        NULL,
  reservation_id   TEXT        NULL,
  unit_id          TEXT        NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- horodatage serveur
  -- Traitement (mutable)
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','processed','failed','dead_letter')),
  processed_at     TIMESTAMPTZ NULL,
  retry_count      INT         NOT NULL DEFAULT 0,
  last_error       TEXT        NULL,
  worker_id        TEXT        NULL
);

-- Index
CREATE INDEX IF NOT EXISTS idx_veraluz_events_type        ON public.veraluz_events(event_type);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_status      ON public.veraluz_events(status);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_created_at  ON public.veraluz_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_veraluz_events_reservation ON public.veraluz_events(reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_veraluz_events_idem        ON public.veraluz_events(idempotency_key);

-- RLS
ALTER TABLE public.veraluz_events ENABLE ROW LEVEL SECURITY;

-- Aucune policy anon ni public : lecture/écriture réservées au service_role (EFs)
-- Les EFs utilisent le service_role key côté serveur uniquement.
-- Aucun SELECT/INSERT/UPDATE/DELETE pour anon ou authenticated depuis le navigateur.
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
-- 2. NOTIFICATIONS (veraluz_notifications)
-- Notifications lisibles par les employés selon leur rôle.
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
  recipient_roles TEXT[]      NOT NULL DEFAULT '{}',   -- [] = toutes les rôles autorisées
  channels        TEXT[]      NOT NULL DEFAULT ARRAY['in_app'],
  requires_ack    BOOLEAN     NOT NULL DEFAULT false,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT        NULL,                    -- actor_id (system ou employee_id)
  -- État par destinataire géré côté EF (pas de table junction pour l'instant)
  read_at         TIMESTAMPTZ NULL,                    -- simplifié : marqué read par 1er lecteur
  ack_at          TIMESTAMPTZ NULL,
  ack_by          TEXT        NULL
);

CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_created  ON public.veraluz_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_priority ON public.veraluz_notifications(priority);
CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_category ON public.veraluz_notifications(category);
CREATE INDEX IF NOT EXISTS idx_veraluz_notifications_unread   ON public.veraluz_notifications(read_at) WHERE read_at IS NULL;

ALTER TABLE public.veraluz_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='veraluz_notifications' AND policyname='deny_anon_veraluz_notifications'
  ) THEN
    CREATE POLICY deny_anon_veraluz_notifications ON public.veraluz_notifications
      FOR ALL TO anon USING (false);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. JOBS SCHEDULER (veraluz_jobs)
-- Piloté par configuration DB. Workers internes uniquement.
-- Jamais appelable directement depuis une iframe.
-- Commence désactivé (enabled=false).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.veraluz_jobs (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  name            TEXT        NOT NULL UNIQUE,
  description     TEXT        NOT NULL DEFAULT '',
  cron_expression TEXT        NOT NULL,               -- ex: '0 6 * * *'
  worker_endpoint TEXT        NOT NULL,               -- nom de l'EF (pas d'URL externe)
  payload         JSONB       NOT NULL DEFAULT '{}',
  enabled         BOOLEAN     NOT NULL DEFAULT false, -- désactivé par défaut
  dry_run         BOOLEAN     NOT NULL DEFAULT true,  -- dry_run par défaut
  -- État d'exécution
  last_run_at     TIMESTAMPTZ NULL,
  last_run_status TEXT        NULL CHECK (last_run_status IN ('success','failure','dry_run',NULL)),
  last_run_ms     INT         NULL,
  last_error      TEXT        NULL,
  run_count       INT         NOT NULL DEFAULT 0,
  fail_count      INT         NOT NULL DEFAULT 0,
  -- Concurrence
  running         BOOLEAN     NOT NULL DEFAULT false,
  running_since   TIMESTAMPTZ NULL,
  -- Métadonnées
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT        NULL,
  updated_by      TEXT        NULL
);

CREATE INDEX IF NOT EXISTS idx_veraluz_jobs_enabled    ON public.veraluz_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_veraluz_jobs_running    ON public.veraluz_jobs(running) WHERE running = true;

ALTER TABLE public.veraluz_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='veraluz_jobs' AND policyname='deny_all_public_veraluz_jobs'
  ) THEN
    CREATE POLICY deny_all_public_veraluz_jobs ON public.veraluz_jobs
      FOR ALL TO public USING (false);
  END IF;
END $$;

-- Trigger updated_at pour veraluz_jobs
CREATE OR REPLACE FUNCTION public.set_updated_at_veraluz_jobs()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_veraluz_jobs_updated_at ON public.veraluz_jobs;
CREATE TRIGGER trg_veraluz_jobs_updated_at
  BEFORE UPDATE ON public.veraluz_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_veraluz_jobs();

-- ────────────────────────────────────────────────────────────
-- 4. GRANTS minimaux — service_role uniquement
-- ────────────────────────────────────────────────────────────
GRANT ALL ON public.veraluz_events        TO service_role;
GRANT ALL ON public.veraluz_notifications TO service_role;
GRANT ALL ON public.veraluz_jobs          TO service_role;

REVOKE ALL ON public.veraluz_events        FROM anon, authenticated;
REVOKE ALL ON public.veraluz_notifications FROM anon, authenticated;
REVOKE ALL ON public.veraluz_jobs          FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- FIN MIGRATION LOT E
-- ────────────────────────────────────────────────────────────
