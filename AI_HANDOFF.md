# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

*(aucun LOCK actif)*

## Lots actifs

AUTH-R3A.1 | claude/auth-r3a-pin-reset | PRÊT POUR DEPLOY REVIEW — en attente autorisation Blaise
AUTH-R2 | main | PUBLIÉ — e2f4629 sur main; en attente validation humaine F5

## Transmissions récentes

`2026-08-19 | Claude | AUTH-R3A.1 | claude/auth-r3a-pin-reset | b40ebc7 | veraluz_reset_employee_pin atomique: bcrypt+must_change_pin+révocation sessions+resume_tokens dans 1 transaction PL/pgSQL (EXCEPTION→ROLLBACK); EF v7: appel unique RPC, erreur bloquante si ok:false/RPC error, journal APRÈS succès seulement; tests A→X 24/24 PASS (16 statiques + 5 live + 8 R3A.1); migration 20260819_auth_r3a1_reset_pin_atomic.sql; LOCK retiré | poussé READY FOR DEPLOY REVIEW; aucun déploiement sans autorisation Blaise | LOCK AUTH-R3A.1 retiré | autorisation Blaise pour appliquer migration + déployer EF v7 + merger main`

`2026-08-19 | Claude | AUTH-R3A | claude/auth-r3a-pin-reset | 7a20a99 | reset-employee-pin v6: révocation atomique via 2e RPC; tests A→P 16/16 PASS | SUPERSÉDÉ par AUTH-R3A.1 (b40ebc7) | LOCK retiré | AUTH-R3A.1`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS; backend ACTIVE | PUBLIÉ | aucun LOCK | validation humaine F5`

`2026-08-19 | Claude | AUTH-R2D INTÉGRATION | claude/auth-r2-integration | e2f4629 | 126/126 tests; contrat vérifié | poussé READY FOR MERGE REVIEW | LOCK retiré | autorisation Blaise`

`2026-08-19 | Claude | AUTH-R2B1 BACKEND | claude/auth-r2b1 | 1b162fb | 4 EF ACTIVE; tests live 13/13 PASS | LIVE VALIDATED | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; éligibilité 13/13 | poussé READY FOR REVIEW | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R1D PHASE C / AUTH-R1 | main | 6c76f8f66770cec5a49ddc672263fc4570e4990c | containment LIVE VALIDÉ; Pages 7/7 | COMPLET | LOCK retiré | aucune`

`2026-08-19 | Codex | AUTH-R1D-H1 | main (source codex/auth-r1-containment) | 6c76f8f66770cec5a49ddc672263fc4570e4990c | H1 10/10; AUTH PASS; Pages blob exact | READY FOR HUMAN RETEST | LOCK Phase B conservé | Blaise reteste Restaurant`

`2026-08-19 | Codex | AUTH-R1D PHASE B | main | e7206fcde199548dc699a18eb3b1132d264525dc | suites PASS; live 200/403/204 | READY FOR HUMAN VALIDATION | LOCK Phase B conservé | validation humaine`

`2026-08-19 | Codex | AUTH-R1D PHASE A | codex/auth-r1-containment | e7206fcde199548dc699a18eb3b1132d264525dc | employees-secure ACTIVE | READY FOR FRONTEND RELEASE | LOCK conservé | publier frontends dans phase autorisée`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
