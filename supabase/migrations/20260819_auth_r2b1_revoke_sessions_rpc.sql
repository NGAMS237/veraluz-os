-- AUTH-R2B1.2 (corrigé R2B1.3) — Révocation globale atomique
-- employee_id est TEXT dans veraluz_employees, veraluz_employee_sessions,
-- veraluz_resume_tokens (ex: 'emp-001', 'mqy690xvhqju2').
-- Paramètre p_target_employee_id TEXT (non uuid) pour compatibilité réelle.

CREATE OR REPLACE FUNCTION public.veraluz_revoke_employee_sessions(
  p_target_employee_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now          timestamptz := now();
  v_sess_count   int         := 0;
  v_resume_count int         := 0;
BEGIN
  -- Garde-fou : paramètre non vide
  IF p_target_employee_id IS NULL OR trim(p_target_employee_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_id_required');
  END IF;

  -- Étape 1 : révoquer toutes les employee_sessions actives de la cible
  WITH r AS (
    UPDATE veraluz_employee_sessions
    SET    revoked_at     = v_now,
           revoked_reason = 'admin_revoke'
    WHERE  employee_id = p_target_employee_id
      AND  revoked_at  IS NULL
    RETURNING id
  )
  SELECT count(*) INTO v_sess_count FROM r;

  -- Étape 2 : révoquer tous les resume_tokens actifs de la cible
  -- Si cette UPDATE lève une exception → ROLLBACK de l'étape 1 (savepoint PL/pgSQL)
  WITH r AS (
    UPDATE veraluz_resume_tokens
    SET    revoked_at     = v_now,
           revoked_reason = 'admin_revoke'
    WHERE  employee_id = p_target_employee_id
      AND  revoked_at  IS NULL
    RETURNING id
  )
  SELECT count(*) INTO v_resume_count FROM r;

  RETURN jsonb_build_object(
    'ok',               true,
    'revoked_sessions', v_sess_count,
    'revoked_resumes',  v_resume_count
  );

EXCEPTION WHEN OTHERS THEN
  -- Toute erreur → rollback implicite des deux étapes.
  -- Jamais ok:true partiel.
  RAISE WARNING 'veraluz_revoke_employee_sessions: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'server_error');
END;
$$;

-- Droits : service_role uniquement — ni anon, ni authenticated, ni PUBLIC
REVOKE ALL     ON FUNCTION public.veraluz_revoke_employee_sessions(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.veraluz_revoke_employee_sessions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.veraluz_revoke_employee_sessions(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.veraluz_revoke_employee_sessions(text) TO service_role;
