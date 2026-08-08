/* ════════════════════════════════════════════════════════════════════════════
   VERALUZ — PROMPT 010 Migration SQL
   Cycle de vie PIN + audit events + RPCs
   Date : 2026-06-27
   ═══════════════════════════════════════════════════════════════════════════ */

-- Mission 3 : Extensions veraluz_employee_auth_secrets
ALTER TABLE veraluz_employee_auth_secrets
  ADD COLUMN IF NOT EXISTS must_change_pin           BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS temporary_pin_expires_at  TIMESTAMPTZ          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_status                TEXT        NOT NULL DEFAULT 'active'
    CHECK (pin_status IN ('active','temporary','force_reset','disabled')),
  ADD COLUMN IF NOT EXISTS last_reset_at             TIMESTAMPTZ          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_reset_by             TEXT                 DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS failed_change_count       INT         NOT NULL DEFAULT 0;

-- Mission 4 : Table audit auth events
CREATE TABLE IF NOT EXISTS veraluz_auth_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT        NOT NULL,
  employee_id       TEXT                    DEFAULT NULL,
  admin_username    TEXT                    DEFAULT NULL,
  performed_by      TEXT                    DEFAULT NULL,
  performed_by_role TEXT                    DEFAULT NULL,
  success           BOOLEAN     NOT NULL    DEFAULT TRUE,
  ip                TEXT                    DEFAULT NULL,
  user_agent        TEXT                    DEFAULT NULL,
  details_json      JSONB       NOT NULL    DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vlz_auth_events_type_time
  ON veraluz_auth_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vlz_auth_events_emp_time
  ON veraluz_auth_events(employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;

ALTER TABLE veraluz_auth_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bloquer anon — veraluz_auth_events"
  ON veraluz_auth_events FOR ALL TO anon USING (false) WITH CHECK (false);

-- RPC : générer PIN temporaire fort
CREATE OR REPLACE FUNCTION generate_temp_pin() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pin TEXT;
  v_weak TEXT[] := ARRAY['000000','111111','222222','333333','444444','555555',
                          '666666','777777','888888','999999','123456','654321',
                          '012345','543210','111222','123123','456456','789789'];
  v_attempts INT := 0;
BEGIN
  LOOP
    v_pin := LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0');
    IF NOT (v_pin = ANY(v_weak)) THEN RETURN v_pin; END IF;
    v_attempts := v_attempts + 1;
    IF v_attempts > 50 THEN RAISE EXCEPTION 'generate_temp_pin: trop de tentatives'; END IF;
  END LOOP;
END;
$$;

-- RPC : reset PIN (upsert hash + flags temporaire)
CREATE OR REPLACE FUNCTION reset_employee_pin_hash(
  p_employee_id TEXT, p_plain_pin TEXT, p_expires_at TIMESTAMPTZ, p_reset_by TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO veraluz_employee_auth_secrets (
    employee_id, pin_hash, hash_algo, pin_updated_at, migration_status,
    pin_status, must_change_pin, temporary_pin_expires_at, last_reset_at, last_reset_by, updated_at
  ) VALUES (
    p_employee_id, crypt(p_plain_pin, gen_salt('bf', 10)), 'bcrypt-bf-10', NOW(), 'migrated',
    'temporary', TRUE, p_expires_at, NOW(), p_reset_by, NOW()
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    pin_hash = crypt(p_plain_pin, gen_salt('bf', 10)),
    hash_algo = 'bcrypt-bf-10', pin_updated_at = NOW(), migration_status = 'migrated',
    pin_status = 'temporary', must_change_pin = TRUE,
    temporary_pin_expires_at = p_expires_at, last_reset_at = NOW(),
    last_reset_by = p_reset_by, updated_at = NOW();
END;
$$;

-- RPC : changer PIN (clear flags temporaire)
CREATE OR REPLACE FUNCTION change_employee_pin_hash(
  p_employee_id TEXT, p_new_plain TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE veraluz_employee_auth_secrets SET
    pin_hash = crypt(p_new_plain, gen_salt('bf', 10)),
    hash_algo = 'bcrypt-bf-10', pin_updated_at = NOW(),
    pin_status = 'active', must_change_pin = FALSE,
    temporary_pin_expires_at = NULL, failed_change_count = 0, updated_at = NOW()
  WHERE employee_id = p_employee_id;
END;
$$;

-- RPC : changer mot de passe admin (bcrypt-12)
CREATE OR REPLACE FUNCTION update_admin_password_hash(
  p_username TEXT, p_new_plain TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE veraluz_admin_auth SET
    password_hash = crypt(p_new_plain, gen_salt('bf', 12)),
    hash_algo = 'bcrypt-bf-12', updated_at = NOW()
  WHERE username = p_username AND active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admin non trouvé : %', p_username; END IF;
END;
$$;
