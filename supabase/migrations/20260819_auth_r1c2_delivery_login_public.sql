-- AUTH-R1C2.1 — candidats publics et eligibilite Livreur
--
-- La permission Livreur ne depend jamais du role generique de l'employe.
-- Elle vient exclusivement de l'affectation canonique:
-- veraluz_employees.team_id -> veraluz_teams.id -> nom "Livreurs".
--
-- Cette vue est volontairement une API publique a projection et lignes
-- strictement limitees. Elle s'execute avec les droits de son proprietaire,
-- car anon ne possede aucun privilege sur les tables internes protegees.

DROP VIEW IF EXISTS public.veraluz_delivery_login_public;

CREATE VIEW public.veraluz_delivery_login_public
WITH (security_barrier = true)
AS
SELECT
  e.id,
  e.full_name,
  e.status
FROM public.veraluz_employees AS e
INNER JOIN public.veraluz_teams AS t
  ON t.id = e.team_id
WHERE lower(btrim(t.name)) = 'livreurs'
  AND lower(btrim(e.status)) IN ('actif', 'active');

COMMENT ON VIEW public.veraluz_delivery_login_public IS
  'AUTH-R1C2.1: candidats actifs du selecteur Livreur. Aucun role, contact, donnee RH, credential ou token.';

REVOKE ALL PRIVILEGES ON TABLE public.veraluz_delivery_login_public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.veraluz_delivery_login_public FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.veraluz_delivery_login_public FROM authenticated;

GRANT SELECT ON TABLE public.veraluz_delivery_login_public TO anon;
GRANT SELECT ON TABLE public.veraluz_delivery_login_public TO service_role;

DO $$
DECLARE
  exposed_columns text[];
BEGIN
  IF NOT has_table_privilege('anon', 'public.veraluz_delivery_login_public', 'SELECT') THEN
    RAISE EXCEPTION 'AUTH-R1C2.1: anon ne peut pas alimenter le selecteur Livreur';
  END IF;

  IF has_table_privilege('anon', 'public.veraluz_delivery_login_public', 'INSERT')
     OR has_table_privilege('anon', 'public.veraluz_delivery_login_public', 'UPDATE')
     OR has_table_privilege('anon', 'public.veraluz_delivery_login_public', 'DELETE') THEN
    RAISE EXCEPTION 'AUTH-R1C2.1: anon conserve un privilege d''ecriture sur le selecteur Livreur';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position)
    INTO exposed_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'veraluz_delivery_login_public';

  IF exposed_columns IS DISTINCT FROM ARRAY['id', 'full_name', 'status']::text[] THEN
    RAISE EXCEPTION 'AUTH-R1C2.1: colonnes publiques inattendues: %', exposed_columns;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.veraluz_delivery_login_public AS candidate
    JOIN public.veraluz_employees AS employee ON employee.id = candidate.id
    LEFT JOIN public.veraluz_teams AS team ON team.id = employee.team_id
    WHERE lower(btrim(coalesce(team.name, ''))) <> 'livreurs'
       OR lower(btrim(coalesce(employee.status, ''))) NOT IN ('actif', 'active')
  ) THEN
    RAISE EXCEPTION 'AUTH-R1C2.1: le selecteur expose un employe non eligible';
  END IF;
END
$$;
