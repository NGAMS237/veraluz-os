-- AUTH-R1 — containment securite employes / credentials
--
-- Objectifs:
--   * aucune lecture/ecriture directe de veraluz_employees par les roles API;
--   * conserver le service_role utilise par les Edge Functions;
--   * garder un selecteur de login public limite a quatre champs non secrets.
--
-- La vue reste volontairement executee avec les droits de son proprietaire:
-- anon ne recoit aucun privilege sur la table interne et ne peut lire que la
-- projection explicite de la vue. Le security_barrier evite les reecritures
-- de requete susceptibles de contourner le filtre de statut.

ALTER TABLE public.veraluz_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rh_anon_all ON public.veraluz_employees;

REVOKE ALL PRIVILEGES ON TABLE public.veraluz_employees FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.veraluz_employees FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.veraluz_employees FROM authenticated;

-- Les RPC de credentials sont des fonctions SECURITY DEFINER. Elles restent
-- appelees exclusivement par les Edge Functions au moyen du service_role;
-- aucun client Data API ne peut les invoquer directement.
REVOKE ALL PRIVILEGES ON FUNCTION public.change_employee_pin_hash(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.check_employee_pin_hash(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.generate_temp_pin()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.reset_employee_pin_hash(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.veraluz_reset_employee_pin(text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.veraluz_set_employee_pin(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.veraluz_verify_employee_pin(text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.change_employee_pin_hash(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_employee_pin_hash(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_temp_pin() TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_employee_pin_hash(text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.veraluz_reset_employee_pin(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.veraluz_set_employee_pin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.veraluz_verify_employee_pin(text, text) TO service_role;

DROP VIEW IF EXISTS public.veraluz_employees_public;

CREATE VIEW public.veraluz_employees_public
WITH (security_barrier = true)
AS
SELECT
  e.id,
  e.full_name,
  e.role,
  e.status
FROM public.veraluz_employees AS e
WHERE e.status IN ('actif', 'active');

COMMENT ON VIEW public.veraluz_employees_public IS
  'AUTH-R1: projection publique minimale du selecteur employe. Aucun credential, contact, donnee RH ou token.';

REVOKE ALL PRIVILEGES ON TABLE public.veraluz_employees_public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.veraluz_employees_public FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.veraluz_employees_public FROM authenticated;

GRANT SELECT ON TABLE public.veraluz_employees_public TO anon;
GRANT SELECT ON TABLE public.veraluz_employees_public TO authenticated;
GRANT SELECT ON TABLE public.veraluz_employees_public TO service_role;

DO $$
DECLARE
  exposed_columns text[];
  credential_function regprocedure;
BEGIN
  IF has_table_privilege('anon', 'public.veraluz_employees', 'SELECT')
     OR has_table_privilege('anon', 'public.veraluz_employees', 'INSERT')
     OR has_table_privilege('anon', 'public.veraluz_employees', 'UPDATE')
     OR has_table_privilege('anon', 'public.veraluz_employees', 'DELETE') THEN
    RAISE EXCEPTION 'AUTH-R1: anon conserve un privilege direct sur veraluz_employees';
  END IF;

  IF has_table_privilege('authenticated', 'public.veraluz_employees', 'SELECT')
     OR has_table_privilege('authenticated', 'public.veraluz_employees', 'INSERT')
     OR has_table_privilege('authenticated', 'public.veraluz_employees', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.veraluz_employees', 'DELETE') THEN
    RAISE EXCEPTION 'AUTH-R1: authenticated conserve un privilege direct sur veraluz_employees';
  END IF;

  IF NOT has_table_privilege('anon', 'public.veraluz_employees_public', 'SELECT') THEN
    RAISE EXCEPTION 'AUTH-R1: le selecteur public ne peut plus lire la vue minimale';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position)
    INTO exposed_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'veraluz_employees_public';

  IF exposed_columns IS DISTINCT FROM ARRAY['id', 'full_name', 'role', 'status']::text[] THEN
    RAISE EXCEPTION 'AUTH-R1: colonnes inattendues dans veraluz_employees_public: %', exposed_columns;
  END IF;

  FOREACH credential_function IN ARRAY ARRAY[
    'public.change_employee_pin_hash(text,text)'::regprocedure,
    'public.check_employee_pin_hash(text,text)'::regprocedure,
    'public.generate_temp_pin()'::regprocedure,
    'public.reset_employee_pin_hash(text,text,timestamp with time zone,text)'::regprocedure,
    'public.veraluz_reset_employee_pin(text,text,text)'::regprocedure,
    'public.veraluz_set_employee_pin(text,text)'::regprocedure,
    'public.veraluz_verify_employee_pin(text,text)'::regprocedure
  ]
  LOOP
    IF has_function_privilege('anon', credential_function, 'EXECUTE')
       OR has_function_privilege('authenticated', credential_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'AUTH-R1: execution client encore permise sur %', credential_function;
    END IF;

    IF NOT has_function_privilege('service_role', credential_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'AUTH-R1: service_role ne peut plus executer %', credential_function;
    END IF;
  END LOOP;
END
$$;
