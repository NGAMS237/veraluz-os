-- AUTH-R3A.1 — veraluz_reset_employee_pin atomique
-- Remplace la version PROMPT 009 qui retournait {ok:true} sans révoquer les sessions/resumes.
-- Cette version effectue dans UNE SEULE TRANSACTION PL/pgSQL (SECURITY DEFINER) :
--   1. Format du PIN (6 chiffres)
--   2. Existence de la cible
--   3. Écriture bcrypt + must_change_pin=true + temporary_pin_expires_at + reset counters
--   4. Révocation TOUTES les employee_sessions actives de la cible
--   5. Révocation TOUS les resume_tokens actifs de la cible
-- Si une étape lève une EXCEPTION → ROLLBACK automatique de toutes les étapes précédentes.
-- Retourne : { ok: true, revoked_sessions: N, revoked_resumes: M }
-- L'Edge Function NE FAIT PLUS appel à veraluz_revoke_employee_sessions séparément.
--
-- Sécurité :
--   SECURITY DEFINER — search_path fixe (public, extensions)
--   REVOKE ALL FROM PUBLIC, anon, authenticated
--   GRANT EXECUTE TO service_role uniquement
--   employee_id TEXT (non UUID) — cohérent avec le reste du système
--   Aucun PIN/hash dans les logs

CREATE OR REPLACE FUNCTION public.veraluz_reset_employee_pin(
  p_employee_id  text,
  p_new_pin      text,
  p_reset_by     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_now              timestamptz := now();
  v_expires_at       timestamptz := now() + interval '24 hours';
  v_sess_count       int         := 0;
  v_resume_count     int         := 0;
BEGIN
  -- Étape 1 : validation format PIN
  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin_format');
  END IF;

  -- Étape 2 : cible existe
  IF NOT EXISTS (
    SELECT 1 FROM public.veraluz_employees WHERE id = p_employee_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_not_found');
  END IF;

  -- Étape 3 : écriture bcrypt + must_change_pin=true + reset counters
  -- (si une erreur survient ici, toute la fonction lève une EXCEPTION → ROLLBACK)
  INSERT INTO public.veraluz_employee_auth_secrets
    (employee_id, pin_hash, hash_algo, pin_updated_at, migration_status,
     must_change_pin, temporary_pin_expires_at, pin_status,
     failed_change_count, last_reset_at, last_reset_by)
  VALUES (
    p_employee_id,
    extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
    'bcrypt-bf-10',
    v_now,
    'migrated',
    TRUE,
    v_expires_at,
    'active',
    0,
    v_now,
    p_reset_by
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    pin_hash                = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
    hash_algo               = 'bcrypt-bf-10',
    pin_updated_at          = v_now,
    migration_status        = 'migrated',
    must_change_pin         = TRUE,
    temporary_pin_expires_at = v_expires_at,
    pin_status              = 'active',
    failed_change_count     = 0,
    last_reset_at           = v_now,
    last_reset_by           = p_reset_by;

  -- Reset brute-force côté veraluz_employees
  UPDATE public.veraluz_employees
     SET failed_pin_attempts = 0,
         pin_locked_until    = NULL
   WHERE id = p_employee_id;

  -- Étape 4 : révoquer TOUTES les employee_sessions actives de la cible
  WITH revoked AS (
    UPDATE public.veraluz_employee_sessions
       SET revoked_at     = v_now,
           revoked_reason = 'pin_reset'
     WHERE employee_id = p_employee_id
       AND revoked_at  IS NULL
     RETURNING id
  )
  SELECT count(*) INTO v_sess_count FROM revoked;

  -- Étape 5 : révoquer TOUS les resume_tokens actifs de la cible
  WITH revoked AS (
    UPDATE public.veraluz_resume_tokens
       SET revoked_at     = v_now,
           revoked_reason = 'pin_reset'
     WHERE employee_id = p_employee_id
       AND revoked_at  IS NULL
     RETURNING id
  )
  SELECT count(*) INTO v_resume_count FROM revoked;

  -- Succès total — toutes les étapes dans la même transaction
  RETURN jsonb_build_object(
    'ok',               TRUE,
    'revoked_sessions', v_sess_count,
    'revoked_resumes',  v_resume_count
  );

EXCEPTION WHEN OTHERS THEN
  -- Toute erreur inattendue → ROLLBACK automatique PL/pgSQL + log (jamais de données sensibles)
  RAISE WARNING '[veraluz_reset_employee_pin] EXCEPTION: % %', SQLERRM, SQLSTATE;
  RETURN jsonb_build_object('ok', false, 'error', 'transaction_failed', 'code', SQLSTATE);
END;
$function$;

COMMENT ON FUNCTION public.veraluz_reset_employee_pin(text, text, text) IS
  'AUTH-R3A.1 — Réinitialisation atomique PIN Direction : bcrypt + must_change_pin + révocation '
  'sessions + révocation resume_tokens dans une seule transaction PL/pgSQL. '
  'Si une étape échoue → ROLLBACK total. Jamais de ok:true partiel. '
  'Retourne {ok, revoked_sessions, revoked_resumes}.';

-- Permissions — identiques à la version PROMPT 009 (SECURITY DEFINER + service_role only)
REVOKE ALL ON FUNCTION public.veraluz_reset_employee_pin(text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.veraluz_reset_employee_pin(text, text, text)
  TO service_role;
