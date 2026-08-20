-- AUTH-R4 — Identité structurée employé
-- Colonnes additives nullable — full_name conservé pour compatibilité

ALTER TABLE veraluz_employees
  ADD COLUMN IF NOT EXISTS civility   text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

-- Backfill prudent : séparation simple "Prénom Nom" uniquement si full_name
-- contient exactement 2 mots séparés par un espace
UPDATE veraluz_employees
SET
  first_name = split_part(full_name, ' ', 1),
  last_name  = split_part(full_name, ' ', 2)
WHERE
  full_name IS NOT NULL
  AND full_name <> ''
  AND first_name IS NULL
  AND last_name  IS NULL
  AND array_length(string_to_array(trim(full_name), ' '), 1) = 2;

-- Index utile pour les lookups par session (déjà indexé via PK id, pas besoin d'ajout)
