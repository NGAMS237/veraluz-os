-- AUTH-R2B1.2 — Révocation globale atomique (sessions + resume tokens)
-- RPC SECURITY DEFINER, service_role uniquement.
--
-- Garantie : les deux UPDATE (employee_sessions + resume_tokens) s'exécutent
-- dans le même bloc PL/pgSQL. Si l'un échoue, le savepoint implicite de
-- l'EXCEPTION handler annule les deux → jamais ok:true partiel.

CREATE OR REPLACE FUNCTION public.veraluz_revoke_employee_sessions(
  p_target_employee_id  uuid
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
  -- jamais ok:true partiel.
  RAISE WARNING 'veraluz_revoke_employee_sessions: %', SQLERRM;
  RETURN jsonb_build_object('ok', false, 'error', 'server_error');
END;
$$;

-- Droits : service_role uniquement — ni anon, ni authenticated, ni PUBLIC
REVOKE ALL     ON FUNCTION public.veraluz_revoke_employee_sessions(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.veraluz_revoke_employee_sessions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.veraluz_revoke_employee_sessions(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.veraluz_revoke_employee_sessions(uuid) TO service_role;
