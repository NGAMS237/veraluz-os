# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Codex | codex/recovery-audit-1 | RECOVERY-AUDIT-1 — réconciliation Git/DB/EF/frontend | VERALUZ_RECOVERY_MATRIX.md, VERALUZ_RECOVERY_PLAN.md, VERALUZ_ROADMAP.md (uniquement si présent)`

## Lots actifs

RECOVERY-AUDIT-1 | codex/recovery-audit-1 | En cours — audit et plan uniquement; aucun déploiement/merge/refactor

## Transmissions récentes

`2026-08-19 | Claude | AUTH-R3A CLOSED | main | 76e618d | merge ff-only claude/auth-r3a-pin-reset→main; Pages built; smoke PASS: CORE 200, AUTH_EMBEDDED 200, bouton Reset PIN ×14, EF v9 ACTIVE, OPTIONS CORS x-veraluz-session PASS | MERGED / PUBLISHED / HUMAN VALIDATED | aucun LOCK | prochain lot`

`2026-08-19 | Claude | AUTH-R3A.2 CORS FIX | claude/auth-r3a-pin-reset | 76e618d | x-veraluz-session ajouté Access-Control-Allow-Headers; EF v9 ACTIVE; OPTIONS+POST vérifiés; reset fonctionnel | BROWSER LIVE READY FOR HUMAN RETEST | aucun LOCK | merge main`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE VALIDATED | claude/auth-r3a-pin-reset | b40ebc7 | migration atomique PROD; EF v8; 13/13 E2E PASS | LIVE VALIDATED | aucun LOCK | AUTH-R3A.2`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS; backend ACTIVE | PUBLIÉ | aucun LOCK | validation humaine F5`

`2026-08-19 | Claude | AUTH-R2D INTÉGRATION | claude/auth-r2-integration | e2f4629 | 126/126 tests; contrat vérifié | poussé READY FOR MERGE REVIEW | LOCK retiré | autorisation Blaise`

`2026-08-19 | Claude | AUTH-R2B1 BACKEND | claude/auth-r2b1 | 1b162fb | 4 EF ACTIVE; tests live 13/13 PASS | LIVE VALIDATED | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; éligibilité 13/13 | poussé READY FOR REVIEW | LOCK retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R1D PHASE C / AUTH-R1 | main | 6c76f8f66770cec5a49ddc672263fc4570e4990c | containment LIVE VALIDÉ; Pages 7/7 | COMPLET | LOCK retiré | aucune`

`2026-08-19 | Codex | AUTH-R1D-H1 | main (source codex/auth-r1-containment) | 6c76f8f66770cec5a49ddc672263fc4570e4990c | H1 10/10; AUTH PASS; Pages blob exact | READY FOR HUMAN RETEST | LOCK Phase B conservé | Blaise reteste Restaurant`

`2026-08-19 | Codex | AUTH-R1D PHASE B | main | e7206fcde199548dc699a18eb3b1132d264525dc | suites PASS; live 200/403/204 | READY FOR HUMAN VALIDATION | LOCK Phase B conservé | validation humaine`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`

`2026-08-19 | Claude | RBAC-C1 CONTAINMENT | claude/rbac-c1-containment | a1ac14d | loadDashboardData dispatché par rôle: restaurant→_loadDashRestaurant (commandes/stock), housekeeping→_loadDashHousekeeping (tâches), global→_loadDashGlobal (finance gated); revenus/paiements masqués non-finance; noms clients protection; 15/15 tests statiques PASS | READY FOR HUMAN TEST | aucun LOCK | push GitHub (credentials manquants sandbox)`

`2026-08-20 | Claude | ROOM-SERVICE-OPS-1A | claude/room-service-ops-1a | 26e6bc1 | veraluz_attendance source canonique; todayDouala(); list_on_duty_employees session-gated; assign re-vérifie check_in/check_out/status/rôle serveur; 11/11 tests live PASS | READY FOR HUMAN TEST | aucun LOCK | push GitHub (credentials manquants sandbox)`
