-- ============================================================
-- VERALUZ — Migration PINs legacy vers bcrypt (Mission 3)
-- PROMPT 009 — Hash des PINs existants via pgcrypto
-- Date : 2026-06-27
--
-- PRÉREQUIS :
-- 1. Avoir exécuté 20260627_employee_pin_secrets.sql
-- 2. pgcrypto activé (inclus dans le script précédent)
--
-- SÉCURITÉ :
-- - pin_code N'EST PAS supprimé — migration non destructive
-- - En cas d'échec, rollback automatique (transaction)
-- - Seuls les PINs valides (non null, non vide, non '0000') sont migrés
-- ============================================================

BEGIN;

/* Extension nécessaire (idempotent) */
CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ── Migrer les PINs vers veraluz_employee_auth_secrets ────── */
/* Utilise bcrypt coût 10 (bf=blowfish) via pgcrypto           */
/* pin_code reste intact — fallback si migration échoue        */

INSERT INTO veraluz_employee_auth_secrets
  (employee_id, pin_hash, hash_algo, pin_updated_at, migration_status)
SELECT
  id,
  crypt(pin_code, gen_salt('bf', 10)) AS pin_hash,
  'bcrypt-bf-10'                       AS hash_algo,
  NOW()                                AS pin_updated_at,
  'migrated'                           AS migration_status
FROM veraluz_employees
WHERE
  pin_code IS NOT NULL
  AND pin_code != ''
  AND pin_code != '0000'   /* éviter de hasher le PIN par défaut non personnalisé */
  AND status = 'actif'
ON CONFLICT (employee_id) DO UPDATE
  SET
    pin_hash          = EXCLUDED.pin_hash,
    hash_algo         = EXCLUDED.hash_algo,
    pin_updated_at    = NOW(),
    migration_status  = 'migrated',
    updated_at        = NOW()
  WHERE
    veraluz_employee_auth_secrets.migration_status != 'migrated';
    /* Ne pas écraser un hash déjà migré sans raison */

/* Marquer les employés comme migrés si la colonne existe */
UPDATE veraluz_employees e
SET
  pin_migration_status = 'migrated',
  pin_updated_at       = NOW()
FROM veraluz_employee_auth_secrets s
WHERE
  e.id = s.employee_id
  AND s.migration_status = 'migrated'
  AND e.pin_migration_status IS DISTINCT FROM 'migrated';

/* ── Rapport de migration ─────────────────────────────────── */
DO $$
DECLARE
  total_employees    INT;
  migrated_pins      INT;
  skipped_default    INT;
  already_migrated   INT;
BEGIN
  SELECT COUNT(*)  INTO total_employees FROM veraluz_employees WHERE status = 'actif';
  SELECT COUNT(*)  INTO migrated_pins   FROM veraluz_employee_auth_secrets WHERE migration_status = 'migrated';
  SELECT COUNT(*)  INTO skipped_default FROM veraluz_employees
    WHERE status = 'actif' AND (pin_code IS NULL OR pin_code = '' OR pin_code = '0000');

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'VERALUZ — Rapport migration PIN hash';
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Employés actifs total  : %', total_employees;
  RAISE NOTICE 'PINs migrés (bcrypt)   : %', migrated_pins;
  RAISE NOTICE 'Ignorés (PIN par défaut / null) : %', skipped_default;
  RAISE NOTICE 'PINs legacy restants   : %', total_employees - migrated_pins - skipped_default;
  RAISE NOTICE 'Méthode : crypt(pin_code, gen_salt(bf, 10)) via pgcrypto';
  RAISE NOTICE '════════════════════════════════════════';
END $$;

COMMIT;

/* ── Vue de vérification (à exécuter manuellement si besoin) ─
SELECT
  e.id,
  LEFT(e.full_name, 20) AS nom,
  e.role,
  e.pin_migration_status,
  CASE WHEN s.employee_id IS NOT NULL THEN '✅ Hash présent' ELSE '⚠️ Legacy' END AS hash_statut
FROM veraluz_employees e
LEFT JOIN veraluz_employee_auth_secrets s ON e.id = s.employee_id
WHERE e.status = 'actif'
ORDER BY hash_statut, e.full_name;
*/
