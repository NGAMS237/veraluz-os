# Audit des écritures PRODUCTION — lots 009 et 009B (§13)

Projet : `dfdmasejsoibxrvubegu` (PRODUCTION). Tout ce que les lots 009 et 009B ont
réellement écrit dans cette base est listé ci-dessous, sans rien minimiser, séparé en
trois catégories : CODE/SCHEMA, TEST FIXTURES, BUSINESS DATA.

## CODE / SCHEMA (lot 009, conservé par 009B — voir §1 de 009B)

- 6 Edge Functions déployées/mises à jour : `reset-employee-pin` (v4→v5),
  `verify-employee-pin` (v5→v6), `change-employee-pin` (v3→v4),
  `logout-employee-session` (v1→v2), et 2 nouvelles : `complete-forced-pin-change` (v1),
  `revoke-employee-sessions` (v1), `get-employee-access-status` (v1).
- 1 migration SQL appliquée : `20260808_prompt009_auth_change_tokens_and_reset_rpc.sql`
  — crée la table `veraluz_employee_change_tokens` (RLS activé, zéro policy = deny-all)
  et la fonction `veraluz_reset_employee_pin(employee_id, new_pin, reset_by)`.
- Aucune colonne existante modifiée ou supprimée sur une table métier.

## TEST FIXTURES (créées par 009, entièrement neutralisées puis supprimées par 009B §2)

- `TEST009_DIRECTION` (role `gerant`), `TEST009_EMPLOYE` (role `receptionniste`),
  `TEST009_BARMAN` (role `barman`), `TEST009_TECHNICIEN` (role `technicien`) —
  4 lignes dans `veraluz_employees`, avec lignes associées dans
  `veraluz_employee_auth_secrets`, `veraluz_employee_sessions`,
  `veraluz_employee_change_tokens`.
- **État après 009B** : les 4 lignes `veraluz_employees` et toutes leurs lignes
  associées (`auth_secrets`, `sessions`, `change_tokens`) ont été **supprimées**
  (voir `evidence/test009-production-fixtures-neutralization.md` pour la preuve
  avant/après complète). Seules restent, dans `veraluz_auth_events`, les lignes
  d'audit historiques de ces tests (31 lignes) — conservées intentionnellement
  comme trace d'audit ; cette table n'a aucune contrainte de clé étrangère vers
  `veraluz_employees`, donc ces lignes ne bloquent rien et n'exposent aucun secret
  (jamais de PIN ni de hash dans `veraluz_auth_events`).
- Aucune nouvelle fixture n'a été créée dans PRODUCTION par 009B (conforme à
  l'interdiction explicite du §8) — au contraire, 009B a nettoyé celles du lot 009.

## BUSINESS DATA (données métier réelles)

**Aucune donnée métier réelle n'a été modifiée par le lot 009 ni par 009B.**
Vérifié explicitement par un inventaire de dépendances (§2 Étape B de 009B) avant
toute suppression : recherche des identifiants `TEST009_*` dans toutes les tables
liées par clé étrangère à `veraluz_employees` — `veraluz_advances`,
`veraluz_attendance`, `veraluz_contracts`, `veraluz_housekeeping`,
`veraluz_hr_documents`, `veraluz_hr_tasks`, `veraluz_payroll`,
`veraluz_schedules`, `veraluz_auth_attempts` — résultat : **0 ligne** dans chacune
de ces tables. Aucun client réel, aucune réservation réelle, aucun employé réel
n'a été touché par ce lot.

## Résumé

| Catégorie | Modifié ? | Détail |
|---|---|---|
| Code / schéma AUTH | Oui | 7 Edge Functions (5 modifiées + 2 nouvelles), 1 migration — conservés (voir §1 de 009B) |
| Fixtures de test | Oui, puis nettoyées | 4 comptes `TEST009_*` créés par 009, entièrement supprimés par 009B §2 |
| Données métier réelles | **Non** | 0 ligne touchée dans toutes les tables métier vérifiées |
