# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

LOCK | Codex | main (intégration ciblée autorisée) | RECOVERY LOT A — publication ciblée | VERALUZ_OS_CORE.html, RH_EMBEDDED.html, ANALYTICS_EMBEDDED.html, LIVREUR.html, supabase/functions/employees-secure/index.ts, supabase/migrations/20260824_recovery_lot_a_rh_privacy.sql

## Lots actifs

RECOVERY LOT A — publication ciblée | source codex/recovery-lot-a1-rh-consumers | base main 0e6158b | EN COURS — migration Supabase non appliquée

## Transmissions récentes

`2026-08-24 | Codex | RECOVERY LOT A.1 — RH RLS consumer compatibility | codex/recovery-lot-a1-rh-consumers | 3b99e5224db533c91de209f032749c791be6433e | Lot A 106/106 + A.1 16/16 = 122/122 PASS; JS/TS/diff PASS; DB lue sans écriture | READY FOR HUMAN REVIEW / TARGETED DEPLOYMENT après autorisation | aucun: LOCK retiré | review puis déploiement ordonné EF → frontends → migration RLS → smokes`

`2026-08-24 | Codex | RECOVERY LOT A — CORE/AUTH/RH session security | codex/recovery-lot-a-auth-rh | 1c2efd1acafd05a7af1ec7cea7a43eaef2b0f161 | 106/106 assertions ciblées PASS; JS/TS et diff PASS; aucun test production | READY FOR HUMAN REVIEW — migration RLS locale bloquée par consommateurs Analytics/Livreur | aucun: LOCK retiré | review humaine puis compatibilité des consommateurs avant déploiement ciblé`

`2026-08-24 | Codex | RECOVERY-AUDIT-1 | codex/recovery-audit-1 | 725a0cc | Git/bundle vérifiés; DB/EF/Pages lus sans écriture; 13 suites statiques: 8 PASS, 5 FAIL documentées | AUDIT COMPLET — progressive recovery NON prête | LOCK retiré | review matrice/plan puis autoriser Lot A`

`2026-08-19 | Claude | AUTH-R3A CLOSED | main | 76e618d | merge ff-only claude/auth-r3a-pin-reset→main; Pages built; smoke PASS: CORE 200, AUTH_EMBEDDED 200, bouton Reset PIN ×14, EF v9 ACTIVE, OPTIONS CORS x-veraluz-session PASS | MERGED / PUBLISHED / HUMAN VALIDATED | aucun LOCK | prochain lot`

`2026-08-19 | Claude | AUTH-R3A.2 CORS FIX | claude/auth-r3a-pin-reset | 76e618d | x-veraluz-session ajouté Access-Control-Allow-Headers; EF v9 ACTIVE; OPTIONS+POST vérifiés; reset fonctionnel | BROWSER LIVE READY FOR HUMAN RETEST | aucun LOCK | merge main`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE VALIDATED | claude/auth-r3a-pin-reset | b40ebc7 | migration atomique PROD; EF v8; 13/13 E2E PASS | LIVE VALIDATED | aucun LOCK | AUTH-R3A.2`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS; backend ACTIVE | PUBLIÉ | aucun LOCK | validation humaine F5`

`2026-08-19 | Claude | AUTH-R2D INTÉGRATION | claude/auth-r2-integration | e2f4629 | 126/126 tests; contrat vérifié | poussé READY FOR MERGE REVIEW | LOCK retiré | autorisation Blaise`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`

`2026-08-19 | Claude | RBAC-C1 CONTAINMENT | claude/rbac-c1-containment | a1ac14d | loadDashboardData dispatché par rôle: restaurant→_loadDashRestaurant (commandes/stock), housekeeping→_loadDashHousekeeping (tâches), global→_loadDashGlobal (finance gated); revenus/paiements masqués non-finance; noms clients protection; 15/15 tests statiques PASS | READY FOR HUMAN TEST | aucun LOCK | push GitHub (credentials manquants sandbox)`

`2026-08-20 | Claude | ROOM-SERVICE-OPS-1A | claude/room-service-ops-1a | 26e6bc1 | veraluz_attendance source canonique; todayDouala(); list_on_duty_employees session-gated; assign re-vérifie check_in/check_out/status/rôle serveur; 11/11 tests live PASS | READY FOR HUMAN TEST | aucun LOCK | push GitHub (credentials manquants sandbox)`
