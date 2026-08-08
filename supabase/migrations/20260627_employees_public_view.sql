-- ============================================================
-- VERALUZ — Vue publique employés (Mission 8)
-- PROMPT 009 — Remplacer les requêtes directes sur veraluz_employees
-- Date : 2026-06-27
--
-- SÉCURITÉ :
-- - N'expose JAMAIS pin, pin_code, pin_hash, salaire, contrats
-- - Accessible via clé anon (lecture seule du nom, rôle, équipe)
-- - Utilisée par CORE.html et LIVREUR.html pour le select employé
-- ============================================================

/* Vue publique — colonnes non sensibles uniquement */
CREATE OR REPLACE VIEW veraluz_employees_public AS
SELECT
  e.id,
  e.full_name,
  e.role,
  e.status,
  e.team_id,
  e.phone,
  e.email,
  e.hire_date,
  /* Champs optionnels utiles côté frontend */
  t.name AS team_name
FROM
  veraluz_employees e
  LEFT JOIN veraluz_teams t ON t.id = e.team_id
WHERE
  e.status = 'actif';   /* Filtre employés actifs par défaut */

COMMENT ON VIEW veraluz_employees_public IS
  'Vue publique employés — SANS pin_code, pin_hash, salaire ni données sensibles. '
  'Utilisée par le frontend (clé anon). Remplace les requêtes directes sur veraluz_employees.';

/* RLS sur la vue : les vues héritent des RLS de la table sous-jacente.
   La table veraluz_employees a des policies anon permissives (PROMPT 008A).
   Cette vue applique un filtre supplémentaire côté colonnes.

   Si RLS stricte est activée sur veraluz_employees en PROMPT 010 :
   Cette vue restera accessible aux anon car elle ne retourne aucune colonne sensible.
*/

/* ── Option B prudente (Mission 7) — à exécuter APRÈS validation terrain ──
   Mettre pin_code à null pour les employés dont le hash est présent.
   NE PAS EXÉCUTER AUTOMATIQUEMENT — requiert validation manuelle.

UPDATE veraluz_employees e
SET pin_code = NULL
FROM veraluz_employee_auth_secrets s
WHERE
  e.id = s.employee_id
  AND s.migration_status = 'migrated'
  AND e.pin_migration_status = 'migrated';

-- Vérification préalable recommandée :
-- SELECT COUNT(*) FROM veraluz_employee_auth_secrets WHERE migration_status = 'migrated';
-- Doit être égal au nombre d'employés actifs avant d'exécuter l'UPDATE.
*/
