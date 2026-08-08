-- ============================================================
-- VERALUZ — Migration PIN Hash (non destructive)
-- PROMPT 008B — Préparation migration sécurisée
-- Date : 2026-06-27
--
-- IMPORTANT :
-- - Cette migration est NON DESTRUCTIVE
-- - pin_code N'EST PAS supprimé
-- - L'application continue de fonctionner pendant la transition
-- - Stratégie en 4 phases (voir commentaires ci-dessous)
-- ============================================================

-- ── Phase 1 (MAINTENANT) : ajouter colonnes migration ──────
-- L'Edge Function verify-employee-pin vérifie encore pin_code
-- côté serveur. Ces colonnes préparent la phase 2.

ALTER TABLE veraluz_employees
  ADD COLUMN IF NOT EXISTS pin_hash              TEXT         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_updated_at        TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_migration_status  TEXT         DEFAULT 'legacy'
    CHECK (pin_migration_status IN ('legacy', 'migrated', 'force_reset'));

COMMENT ON COLUMN veraluz_employees.pin_code IS
  'Legacy PIN en clair — à supprimer après migration complète vers pin_hash (PROMPT 009)';
COMMENT ON COLUMN veraluz_employees.pin_hash IS
  'PIN hashé avec bcrypt/argon2 — remplacera pin_code en Phase 2';
COMMENT ON COLUMN veraluz_employees.pin_updated_at IS
  'Date de dernière mise à jour du PIN (pour forcer renouvellement périodique)';
COMMENT ON COLUMN veraluz_employees.pin_migration_status IS
  'legacy: pin_code utilisé | migrated: pin_hash utilisé | force_reset: PIN expiré';

-- Index pour accélérer les requêtes de migration
CREATE INDEX IF NOT EXISTS idx_veraluz_employees_pin_status
  ON veraluz_employees(pin_migration_status)
  WHERE pin_migration_status = 'legacy';

-- ── Phase 2 (PROMPT 009) : migrer PIN vers hash ─────────────
-- À exécuter après avoir déployé la Edge Function avec bcrypt :
--
-- UPDATE veraluz_employees
-- SET
--   pin_hash             = crypt(pin_code, gen_salt('bf', 10)),
--   pin_updated_at       = NOW(),
--   pin_migration_status = 'migrated'
-- WHERE pin_migration_status = 'legacy'
--   AND pin_code IS NOT NULL
--   AND pin_code != '0000';
--
-- Nécessite l'extension pgcrypto :
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Phase 3 (LONG TERME) : RLS par employee_id ──────────────
-- Après migration vers Supabase Auth :
--
-- ALTER TABLE veraluz_employees ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "Employé lit ses propres données"
--   ON veraluz_employees FOR SELECT
--   USING (auth.uid()::text = id::text);
--
-- CREATE POLICY "Seul le service_role modifie"
--   ON veraluz_employees FOR ALL
--   USING (auth.role() = 'service_role');

-- ── Phase 4 (VERSION FINALE) : supprimer pin_code ───────────
-- Seulement après :
--   1. Tous les employés ont pin_migration_status = 'migrated'
--   2. L'Edge Function utilise exclusivement pin_hash
--   3. RLS bloque l'accès anon aux colonnes PIN
--   4. Validation par l'équipe terrain que le login fonctionne
--
-- ALTER TABLE veraluz_employees DROP COLUMN pin_code;

-- ── RLS sur les tables sensibles (à activer en Phase 3) ─────
-- À appliquer sur veraluz_payroll, veraluz_hr_tasks,
-- veraluz_attendance pour restreindre par employee_id.
--
-- Exemple pour veraluz_payroll :
-- ALTER TABLE veraluz_payroll ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Employé voit sa propre paie"
--   ON veraluz_payroll FOR SELECT
--   USING (employee_id::text = auth.uid()::text);

-- ── Vérification post-migration ──────────────────────────────
-- SELECT
--   COUNT(*) FILTER (WHERE pin_migration_status = 'legacy')    AS encore_legacy,
--   COUNT(*) FILTER (WHERE pin_migration_status = 'migrated')  AS migres,
--   COUNT(*) FILTER (WHERE pin_migration_status = 'force_reset') AS expires
-- FROM veraluz_employees;
