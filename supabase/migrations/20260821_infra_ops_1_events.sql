-- ═══════════════════════════════════════════════════════════════
-- INFRA-OPS-1 — Events durables + Jobs + Housekeeping columns
-- Date: 2026-08-21  (CORRIGÉ IN PLACE — INFRA-CORE-1B)
-- Branche: claude/settings-ssot-1a
-- ═══════════════════════════════════════════════════════════════
-- INTERDIT : tenant_id / emitted_at / source_fn (schéma legacy)
-- INTERDIT : DISABLE ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. veraluz_events — outbox canonique ─────────────────────
-- Contrat canonique : pas de tenant_id, pas d'emitted_at.
-- Toutes les colonnes correspondent au schéma réel de production.
CREATE TABLE IF NOT EXISTS veraluz_events (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type     text        NOT NULL,
  payload        jsonb       NOT NULL DEFAULT '{}',
  source         text,                          -- EF source (ex: 'guest-access')
  entity_type    text,                          -- 'reservation' | 'service_request' | ...
  entity_id      text,
  reservation_id text,
  unit_id        text,
  actor_type     text,                          -- 'guest' | 'employee' | 'system'
  actor_id       text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE veraluz_events ENABLE ROW LEVEL SECURITY;
-- Aucune politique → accès refusé à tous sauf service_role (BYPASSRLS)

CREATE INDEX IF NOT EXISTS idx_ve_event_type  ON veraluz_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ve_created_at  ON veraluz_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ve_reservation ON veraluz_events (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- ─── 2. veraluz_event_jobs — exécution idempotente par handler ─
-- UNIQUE (event_id, handler) : empêche double traitement.
-- updated_at : suivi des transitions de statut.
CREATE TABLE IF NOT EXISTS veraluz_event_jobs (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id     uuid        NOT NULL REFERENCES veraluz_events(id) ON DELETE CASCADE,
  handler      text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','dead')),
  attempt      int         NOT NULL DEFAULT 0,
  max_attempts int         NOT NULL DEFAULT 4,
  last_error   text,
  processed_at timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (event_id, handler)
);

ALTER TABLE veraluz_event_jobs ENABLE ROW LEVEL SECURITY;
-- Aucune politique → accès refusé à tous sauf service_role (BYPASSRLS)

CREATE INDEX IF NOT EXISTS idx_vej_pending   ON veraluz_event_jobs (status, created_at)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_vej_event_id  ON veraluz_event_jobs (event_id);
CREATE INDEX IF NOT EXISTS idx_vej_created   ON veraluz_event_jobs (created_at DESC);

-- ─── 3. veraluz_housekeeping — colonnes de traçabilité seulement ─
-- La table EXISTE en production avec son propre schéma (TEXT IDs, colonne `type`).
-- On n'essaie JAMAIS de la recréer ; on ajoute uniquement les colonnes manquantes.
ALTER TABLE veraluz_housekeeping
  ADD COLUMN IF NOT EXISTS reservation_id  text,
  ADD COLUMN IF NOT EXISTS source_event_id uuid;

ALTER TABLE veraluz_housekeeping ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vh_status     ON veraluz_housekeeping (status);
CREATE INDEX IF NOT EXISTS idx_vh_created_at ON veraluz_housekeeping (created_at DESC);
