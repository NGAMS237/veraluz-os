-- AUTH-R2B1.1 — RPC atomique pour rotation du resume_token
-- Appelée uniquement par service_role via Edge Function resume-employee-session.
-- Jamais exposée à anon/authenticated.
--
-- Garantie transactionnelle (ACID) :
--   1. FOR UPDATE SKIP LOCKED sur l'ancien token (verrouillage concurrent sûr)
--   2. INSERT nouveau resume_token
--   3. REVOKE ancien resume_token
--   4. INSERT nouvelle employee_session
--   Si une étape échoue → ROLLBACK total → ancien token intact → pas de lockout.
--
-- Sécurité :
--   - Seuls des hashes SHA-256 traversent la fonction (jamais de raw token).
--   - Raw tokens générés dans l'Edge Function et jamais stockés.
--   - SECURITY DEFINER pour accès service_role uniquement.
--   - REVOKE sur PUBLIC/anon/authenticated.

CREATE OR REPLACE FUNCTION public.veraluz_rotate_resume_token(
  p_old_resume_hash    text,          -- SHA-256 du token entrant (déjà validé par l'EF)
  p_new_resume_hash    text,          -- SHA-256 du nouveau resume_token généré côté EF
  p_new_session_hash   text,          -- SHA-256 du nouveau session_token généré côté EF
  p_device_hint        text,
  p_resume_expires_at  timestamptz,
  p_session_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rt  record;
  v_emp record;
  v_now timestamptz := now();
BEGIN
  -- ── 1. Verrouiller et consommer l'ancien resume_token ─────────────────────
  --   FOR UPDATE SKIP LOCKED : si un autre appel concurrent tente la même
  --   rotation, il ne trouvera pas la ligne (SKIP LOCKED → NOT FOUND) et
  --   retournera token_invalid_or_expired sans bloquer.
  SELECT rt.id, rt.employee_id
  INTO   v_rt
  FROM   public.veraluz_resume_tokens rt
  WHERE  rt.token_hash  = p_old_resume_hash
    AND  rt.revoked_at  IS NULL
    AND  rt.expires_at  > v_now
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalid_or_expired');
  END IF;

  -- ── 2. Vérifier l'employé actif ──────────────────────────────────────────
  SELECT e.id, e.full_name, e.role, e.department, e.public_display_name
  INTO   v_emp
  FROM   public.veraluz_employees e
  WHERE  e.id     = v_rt.employee_id
    AND  e.status IN ('actif', 'active');

  IF NOT FOUND THEN
    -- Pas de rollback explicite nécessaire : FOR UPDATE libère le lock.
    RETURN jsonb_build_object('ok', false, 'error', 'employee_inactive');
  END IF;

  -- ── 3. Insérer le nouveau resume_token ───────────────────────────────────
  INSERT INTO public.veraluz_resume_tokens
         (employee_id, token_hash, device_hint, expires_at)
  VALUES (v_rt.employee_id, p_new_resume_hash, p_device_hint, p_resume_expires_at);

  -- ── 4. Révoquer l'ancien resume_token ────────────────────────────────────
  UPDATE public.veraluz_resume_tokens
  SET    revoked_at     = v_now,
         revoked_reason = 'rotated',
         rotated_at     = v_now,
         last_used_at   = v_now
  WHERE  id = v_rt.id;

  -- ── 5. Insérer la nouvelle employee_session ──────────────────────────────
  INSERT INTO public.veraluz_employee_sessions
         (employee_id, token_hash, expires_at, last_seen_at)
  VALUES (v_rt.employee_id, p_new_session_hash, p_session_expires_at, v_now);

  -- ── 6. Retourner l'identité fraîche ─────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',                 true,
    'employee_id',        v_emp.id,
    'role',               v_emp.role,
    'full_name',          v_emp.full_name,
    'department',         COALESCE(v_emp.department, ''),
    'public_display_name', COALESCE(v_emp.public_display_name, v_emp.full_name)
  );

EXCEPTION WHEN OTHERS THEN
  -- Toute erreur non prévue → ROLLBACK automatique PostgreSQL
  RAISE WARNING '[veraluz_rotate_resume_token] unexpected error: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'server_error');
END;
$$;

-- ── Droits : service_role uniquement ─────────────────────────────────────────
REVOKE ALL ON FUNCTION public.veraluz_rotate_resume_token FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.veraluz_rotate_resume_token FROM anon;
REVOKE EXECUTE ON FUNCTION public.veraluz_rotate_resume_token FROM authenticated;
GRANT EXECUTE ON FUNCTION public.veraluz_rotate_resume_token TO service_role;
