-- ═══════════════════════════════════════════════════════════════
-- INFRA-OPS-1 — Events durables + Jobs + Housekeeping table
-- Date: 2026-08-21
-- Branche: claude/settings-ssot-1a
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. veraluz_events — outbox canonical ─────────────────────
-- Chaque événement métier est inscrit ici avant traitement.
-- Les Edge Functions écrivent via emitEvent() dans _shared/events.ts.
CREATE TABLE IF NOT EXISTS veraluz_events (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}',
  emitted_at   timestamptz DEFAULT now(),
  source_fn    text,                             -- EF source (ex: 'guest-access')
  tenant_id    text        NOT NULL DEFAULT 'veraluz-001'
);

-- Aucun RLS : accès exclusivement via service_role dans les EF
ALTER TABLE veraluz_events DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ve_event_type  ON veraluz_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ve_emitted_at  ON veraluz_events (emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ve_tenant      ON veraluz_events (tenant_id);

-- ─── 2. veraluz_event_jobs — exécution idempotente par handler ─
-- Contrainte UNIQUE (event_id, handler) : empêche double insertion
-- même si emitEvent() est appelé deux fois (déduplication niveau DB).
CREATE TABLE IF NOT EXISTS veraluz_event_jobs (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id     uuid        NOT NULL REFERENCES veraluz_events(id) ON DELETE CASCADE,
  handler      text        NOT NULL,             -- 'create_housekeeping_task' | 'create_staff_notification'
  status       text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','dead')),
  attempt      int         NOT NULL DEFAULT 0,
  max_attempts int         NOT NULL DEFAULT 4,   -- dead après 4 échecs
  last_error   text,
  processed_at timestamptz,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (event_id, handler)                     -- clé d'idempotence
);

ALTER TABLE veraluz_event_jobs DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vej_status_pending ON veraluz_event_jobs (status)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_vej_event_id       ON veraluz_event_jobs (event_id);
CREATE INDEX IF NOT EXISTS idx_vej_created_at     ON veraluz_event_jobs (created_at DESC);

-- ─── 3. veraluz_housekeeping (IF NOT EXISTS — peut exister en prod) ──
-- Tâches de ménage créées automatiquement par event-worker
-- après chaque guest_checked_out.
CREATE TABLE IF NOT EXISTS veraluz_housekeeping (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id         uuid,
  reservation_id  uuid,
  task_type       text        NOT NULL DEFAULT 'checkout_clean'
    CHECK (task_type IN ('checkout_clean','standard_clean','deep_clean','touch_up','inspection')),
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','cancelled')),
  priority        text        NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to     uuid,                          -- employee id, nullable
  notes           text,
  source_event_id uuid,                          -- traçabilité vers veraluz_events.id
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE veraluz_housekeeping DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vh_status      ON veraluz_housekeeping (status);
CREATE INDEX IF NOT EXISTS idx_vh_unit_id     ON veraluz_housekeeping (unit_id);
CREATE INDEX IF NOT EXISTS idx_vh_created_at  ON veraluz_housekeeping (created_at DESC);
