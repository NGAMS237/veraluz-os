# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Claude | claude/auth-r3a-pin-reset | AUTH-R3A.1 — veraluz_reset_employee_pin atomique (bcrypt+revoke sessions+resumes en 1 tx) + EF v7 + tests Q→X | supabase/functions/reset-employee-pin/index.ts, supabase/migrations/*_auth_r3a1_reset_pin_atomic.sql, tests/auth_r3a_pin_reset.sh`

## Lots actifs

AUTH-R3A.1 | claude/auth-r3a-pin-reset | En cours — RPC atomique + EF v7 + 8 tests
AUTH-R2 | main | PUBLIÉ — e2f4629 sur main; en attente validation humaine F5

## Transmissions récentes

`2026-08-19 | Claude | AUTH-R3A.1 LOCK | claude/auth-r3a-pin-reset | 7a20a99 | blocker review: v6 appelle reset_pin RPC puis revoke_sessions RPC séparément, révocation non-bloquante — inacceptable; solution: réécrire veraluz_reset_employee_pin pour inclure révocation sessions+resumes dans la même transaction PL/pgSQL; EF v7 appelle une seule RPC atomique, erreur bloquante | LOCK AUTH-R3A.1 pris | migration+EF+tests | migration atomique + EF v7 + tests Q→X + push`

`2026-08-19 | Claude | AUTH-R3A | claude/auth-r3a-pin-reset | 7a20a99 | reset-employee-pin v6: révocation atomique sessions+resumes via veraluz_revoke_employee_sessions RPC; tests A→P 16/16 PASS | poussé READY FOR DEPLOY REVIEW; aucun déploiement sans autorisation Blaise | LOCK AUTH-R3A retiré | autorisation Blaise pour déployer`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS; backend ACTIVE | PUBLIÉ | aucun LOCK actif | validation humaine F5`

`2026-08-19 | Claude | AUTH-R2D INTÉGRATION | claude/auth-r2-integration | e2f4629 | 126/126 tests; contrat vérifié | poussé READY FOR MERGE REVIEW | LOCK retiré | autorisation Blaise`

`2026-08-19 | Claude | AUTH-R2B1 BACKEND | claude/auth-r2b1 | 1b162fb | 4 EF ACTIVE; tests live 13/13 PASS; Phase E régression PASS | LIVE VALIDATED | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; éligibilité 13/13 | poussé READY FOR REVIEW | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R1D PHASE C / AUTH-R1 | main | 6c76f8f66770cec5a49ddc672263fc4570e4990c | containment LIVE VALIDÉ; Pages 7/7 exacts | COMPLET | LOCK retiré | aucune`

`2026-08-19 | Codex | AUTH-R1D-H1 | main (source codex/auth-r1-containment) | 6c76f8f66770cec5a49ddc672263fc4570e4990c | H1 10/10; AUTH suites PASS; Pages blob exact | READY FOR HUMAN RETEST | LOCK Phase B conservé | Blaise reteste Restaurant`

`2026-08-19 | Codex | AUTH-R1D PHASE B | main | e7206fcde199548dc699a18eb3b1132d264525dc | suites PASS; live 200/403/204; navigateur sans erreur | READY FOR HUMAN VALIDATION | LOCK Phase B conservé | validation humaine`

`2026-08-19 | Codex | AUTH-R1D PHASE A | codex/auth-r1-containment | e7206fcde199548dc699a18eb3b1132d264525dc | employees-secure ACTIVE; live Edge 401/profil 200 | READY FOR FRONTEND RELEASE | LOCK conservé | publier frontends dans phase autorisée`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
