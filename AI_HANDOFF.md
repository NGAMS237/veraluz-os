# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

*(aucun LOCK actif)*

## Lots actifs

AUTH-R3A.2 | claude/auth-r3a-pin-reset | BROWSER LIVE READY FOR HUMAN RETEST — en attente autorisation Blaise pour merger main
AUTH-R2 | main | PUBLIÉ — e2f4629 sur main; en attente validation humaine F5

## Transmissions récentes

`2026-08-19 | Claude | AUTH-R3A.2 CORS FIX | claude/auth-r3a-pin-reset | 76e618d | reset-employee-pin v8→v9 EF: ajout x-veraluz-session dans Access-Control-Allow-Headers; OPTIONS 204 + Allow-Headers confirmé; POST navigateur non-bloqué; reset fonctionnel vérifié (EF v9); emp-001 restauré; aucune modification logique atomique/PIN/DB | BROWSER LIVE READY FOR HUMAN RETEST | aucun LOCK | autorisation Blaise pour merger main`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE VALIDATED | claude/auth-r3a-pin-reset | b40ebc7 | migration atomique appliquée PROD; EF v8 ACTIVE; tests live E2E 13/13 PASS; emp-001 restauré | LIVE VALIDATED | aucun LOCK | AUTH-R3A.2 CORS FIX`

`2026-08-19 | Claude | AUTH-R3A.1 | claude/auth-r3a-pin-reset | b40ebc7 | veraluz_reset_employee_pin atomique: 1 tx PL/pgSQL; EF v7: appel unique RPC bloquant; tests A→X 24/24 PASS | DÉPLOYÉ | aucun LOCK | tests live`

`2026-08-19 | Claude | AUTH-R3A | claude/auth-r3a-pin-reset | 7a20a99 | reset-employee-pin v6: révocation atomique via 2e RPC; tests A→P 16/16 PASS | SUPERSÉDÉ par AUTH-R3A.1 | LOCK retiré | AUTH-R3A.1`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS; backend ACTIVE | PUBLIÉ | aucun LOCK | validation humaine F5`

`2026-08-19 | Claude | AUTH-R2D INTÉGRATION | claude/auth-r2-integration | e2f4629 | 126/126 tests; contrat vérifié | poussé READY FOR MERGE REVIEW | LOCK retiré | autorisation Blaise`

`2026-08-19 | Claude | AUTH-R2B1 BACKEND | claude/auth-r2b1 | 1b162fb | 4 EF ACTIVE; tests live 13/13 PASS | LIVE VALIDATED | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; éligibilité 13/13 | poussé READY FOR REVIEW | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R1D PHASE C / AUTH-R1 | main | 6c76f8f66770cec5a49ddc672263fc4570e4990c | containment LIVE VALIDÉ; Pages 7/7 | COMPLET | LOCK retiré | aucune`

`2026-08-19 | Codex | AUTH-R1D-H1 | main (source codex/auth-r1-containment) | 6c76f8f66770cec5a49ddc672263fc4570e4990c | H1 10/10; AUTH PASS; Pages blob exact | READY FOR HUMAN RETEST | LOCK Phase B conservé | Blaise reteste Restaurant`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
