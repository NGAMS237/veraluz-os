# Neutralisation des comptes TEST009 en PRODUCTION (§2 de 009B) — preuve avant/après

Projet : `dfdmasejsoibxrvubegu` (PRODUCTION). Action réalisée en priorité absolue,
avant tout autre travail de 009B, conformément à l'instruction du prompt.

## AVANT (constat initial, confirmé par requête directe)

```
id                    | full_name                      | role          | status
TEST009_BARMAN        | TEST009 Barman Validation       | barman        | actif
TEST009_DIRECTION     | TEST009 Direction Validation     | gerant        | actif
TEST009_EMPLOYE       | TEST009 Employe Validation       | receptionniste| actif
TEST009_TECHNICIEN    | TEST009 Technicien Validation    | technicien    | actif
```

Sessions actives au moment du constat : `TEST009_DIRECTION` = 3 sessions actives,
`TEST009_EMPLOYE` = 1 session active (sur 4 sessions au total, 3 déjà révoquées par
les tests §14 précédents). `TEST009_BARMAN`/`TEST009_TECHNICIEN` : 0 ligne de
session trouvée (aucune session persistée malgré une connexion navigateur
observée lors du test §15 — anomalie mineure non expliquée, sans conséquence sur
la neutralisation puisque le compte est de toute façon supprimé).

## Étape A — neutralisation immédiate (avant tout autre travail)

Exécuté en une seule transaction SQL :
1. Révocation de toutes les sessions actives des 4 comptes
   (`revoked_reason = 'security_correction_009B_prod_fixture_neutralization'`).
2. Consommation de tout `change_token` non utilisé des 4 comptes.
3. `status = 'inactif'` sur les 4 lignes `veraluz_employees`.
4. `pin_status = 'disabled'` sur leurs 4 lignes `veraluz_employee_auth_secrets`.

**Preuve live (avant suppression), tentative de connexion avec les PIN connus :**

```
TEST009_DIRECTION / 482913  -> {"ok":false,"error":"employee_inactive"}
TEST009_EMPLOYE   / 391847  -> {"ok":false,"error":"employee_inactive"}
TEST009_BARMAN    / 224466  -> {"ok":false,"error":"employee_inactive"}
TEST009_TECHNICIEN/ 335577  -> {"ok":false,"error":"employee_inactive"}
```

Aucune connexion possible dès l'étape A, avant même toute décision de suppression.

## Étape B — dependency inventory puis suppression propre

Recherche des identifiants `TEST009_*` dans toutes les tables métier liées par
clé étrangère à `veraluz_employees` (`veraluz_advances`, `veraluz_attendance`,
`veraluz_contracts`, `veraluz_housekeeping`, `veraluz_hr_documents`,
`veraluz_hr_tasks`, `veraluz_payroll`, `veraluz_schedules`,
`veraluz_auth_attempts`) : **0 ligne dans chacune**. `veraluz_auth_events` (27
lignes à ce stade) n'a **aucune** contrainte de clé étrangère vers
`veraluz_employees` — ce ne sont que des lignes d'audit texte, pas une référence
bloquante.

Conclusion : aucune donnée métier ni référence nécessaire ne bloque la
suppression → suppression propre effectuée (`veraluz_employee_change_tokens`,
`veraluz_employee_sessions`, `veraluz_employee_auth_secrets`, puis
`veraluz_employees`, dans cet ordre).

## APRÈS (constat final, confirmé par requête directe)

```
employees_after_delete       : 0
sessions_after_delete        : 0
auth_secrets_after_delete    : 0
change_tokens_after_delete   : 0
auth_events (audit, orphelin, non bloquant) : 31
```

**Preuve live (après suppression), nouvelle tentative de connexion :**

```
TEST009_DIRECTION -> {"ok":false,"error":"invalid_credentials"}
TEST009_EMPLOYE   -> {"ok":false,"error":"invalid_credentials"}
TEST009_BARMAN    -> {"ok":false,"error":"invalid_credentials"}
TEST009_TECHNICIEN-> {"ok":false,"error":"invalid_credentials"}
```

Le code d'erreur passe de `employee_inactive` (compte existant mais désactivé) à
`invalid_credentials` (compte inexistant) — confirmation indépendante que les 4
comptes n'existent plus du tout dans PRODUCTION.

Vérification supplémentaire (tests automatisés, voir `tests/TESTS.md` de 009B) :
`test009-production-fixtures-disabled.test.mjs` (4/4) et
`test009-production-sessions-revoked.test.mjs` (2/2, rejeu de deux vrais jetons de
session émis pendant les tests §14 du lot 009, tous deux rejetés `unauthorized`).

## Conclusion

Aucun compte `TEST009_*` avec PIN connu ne reste connectable en PRODUCTION.
Décision retenue : **suppression complète** (pas seulement désactivation), car le
dependency inventory n'a trouvé aucune donnée métier ni référence nécessaire.
