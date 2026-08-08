-- ============================================================
-- VERALUZ — Table secrets PIN employé (Mission 2)
-- PROMPT 009 — Séparation stricte credentials vs données métier
-- Date : 2026-06-27
--
-- SÉCURITÉ :
-- - Aucun accès direct anon ou authenticated
-- - Uniquement Edge Function via service_role
-- - RLS active dès création
-- ============================================================

/* Activer pgcrypto si pas encore fait */
CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* Table secrets — séparée de veraluz_employees */
CREATE TABLE IF NOT EXISTS veraluz_employee_auth_secrets (
  employee_id       UUID          PRIMARY KEY
                    REFERENCES veraluz_employees(id) ON DELETE CASCADE,
  pin_hash          TEXT          NOT NULL,
  hash_algo         TEXT          NOT NULL  DEFAULT 'bcrypt-bf-10',
  pin_updated_at    TIMESTAMPTZ   NOT NULL  DEFAULT NOW(),
  migration_status  TEXT          NOT NULL  DEFAULT 'migrated'
                    CHECK (migration_status IN ('migrated','force_reset','pending')),
  created_at        TIMESTAMPTZ   NOT NULL  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL  DEFAULT NOW()
);

COMMENT ON TABLE veraluz_employee_auth_secrets IS
  'Stocke les PINs hashés des employés. Accès uniquement via Edge Function service_role.';
COMMENT ON COLUMN veraluz_employee_auth_secrets.pin_hash IS
  'Hash bcrypt du PIN employé — JAMAIS stocker le PIN en clair';
COMMENT ON COLUMN veraluz_employee_auth_secrets.hash_algo IS
  'Algorithme : bcrypt-bf-10 = crypt(pin, gen_salt(bf, 10)) via pgcrypto';

/* Index */
CREATE INDEX IF NOT EXISTS idx_veraluz_emp_auth_migration
  ON veraluz_employee_auth_secrets(migration_status);

/* ── RLS : accès UNIQUEMENT service_role ─────────────────────
   anon et authenticated ne peuvent ni lire ni écrire cette table */
ALTER TABLE veraluz_employee_auth_secrets ENABLE ROW LEVEL SECURITY;

/* Blocage total anon */
CREATE POLICY "Bloquer anon — veraluz_employee_auth_secrets"
  ON veraluz_employee_auth_secrets FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

/* Bloquer authenticated (employés connectés via Supabase Auth) */
CREATE POLICY "Bloquer authenticated — veraluz_employee_auth_secrets"
  ON veraluz_employee_auth_secrets FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

/* service_role contourne automatiquement RLS — pas de policy nécessaire */
/* L'Edge Function utilise service_role → accès total garanti */

/* ── Table rate limiting auth attempts (Mission 5) ──────────────── */
CREATE TABLE IF NOT EXISTS veraluz_auth_attempts (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT          NOT NULL DEFAULT 'pin',
  employee_id   UUID          NULL REFERENCES veraluz_employees(id) ON DELETE SET NULL,
  identifier    TEXT          NULL,   /* employee_id ou username en clair — jamais PIN */
  ip            TEXT          NULL,
  user_agent    TEXT          NULL,
  success       BOOLEAN       NOT NULL DEFAULT FALSE,
  error_code    TEXT          NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE veraluz_auth_attempts IS
  'Journal des tentatives auth PIN et admin. JAMAIS stocker le PIN saisi.';
COMMENT ON COLUMN veraluz_auth_attempts.identifier IS
  'employee_id en texte ou username admin — jamais le PIN, jamais le mot de passe';

/* Index pour requêtes rate-limiting (récents par employee_id et IP) */
CREATE INDEX IF NOT EXISTS idx_vlz_auth_attempts_emp_time
  ON veraluz_auth_attempts(employee_id, created_at DESC)
  WHERE success = false;

CREATE INDEX IF NOT EXISTS idx_vlz_auth_attempts_ip_time
  ON veraluz_auth_attempts(ip, created_at DESC)
  WHERE success = false;

/* RLS sur auth_attempts : anon ne peut PAS lire les tentatives des autres */
ALTER TABLE veraluz_auth_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bloquer anon lecture — veraluz_auth_attempts"
  ON veraluz_auth_attempts FOR SELECT
  TO anon
  USING (false);

CREATE POLICY "Bloquer anon insertion — veraluz_auth_attempts"
  ON veraluz_auth_attempts FOR INSERT
  TO anon
  WITH CHECK (false);

/* ── Table admin auth sécurisée (Mission 9) ──────────────────── */
CREATE TABLE IF NOT EXISTS veraluz_admin_auth (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  hash_algo       TEXT        NOT NULL DEFAULT 'bcrypt-bf-12',
  role            TEXT        NOT NULL DEFAULT 'manager'
                  CHECK (role IN ('superadmin','manager')),
  name            TEXT        NOT NULL,
  allowed_modules JSONB       NOT NULL DEFAULT '[]',
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE veraluz_admin_auth IS
  'Identifiants admin hashés — remplace DEFAULT_USERS dans le HTML. Accès service_role uniquement.';
COMMENT ON COLUMN veraluz_admin_auth.password_hash IS
  'Hash bcrypt du mot de passe — JAMAIS stocker en clair';

ALTER TABLE veraluz_admin_auth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bloquer anon — veraluz_admin_auth"
  ON veraluz_admin_auth FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Bloquer authenticated — veraluz_admin_auth"
  ON veraluz_admin_auth FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

/* ── Vérification post-migration ─────────────────────────────── */
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('veraluz_employee_auth_secrets','veraluz_auth_attempts','veraluz_admin_auth');
