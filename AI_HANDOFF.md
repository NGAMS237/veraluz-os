# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Codex | codex/recovery-lot-b-reservation-overstay | RECOVERY LOT B.1 — checkout side-effect durability | supabase/functions/reservation-workflow/index.ts, RESERVATIONS_EMBEDDED.html, RECOVERY_LOT_B_TESTS.md, RECOVERY_LOT_B_DEPLOY_PLAN.md, tests/recovery-lot-b*.test.mjs`

## Lots actifs

`RECOVERY LOT B.1 | Codex | checkout durable + housekeeping idempotent + retry réparateur + date Africa/Douala | en cours`

## Transmissions récentes

`2026-08-24 | Codex | RECOVERY LOT B — reservation lifecycle / planning / overstay | codex/recovery-lot-b-reservation-overstay | 9e0ae136c6861b6598d9718a77146f90b5912347 | Lot B 34/34; A.1 16/16; A.2 15/15; navigateur desktop/mobile PASS; aucune erreur console; DB lue sans écriture | READY FOR HUMAN REVIEW / TARGETED MERGE — aucun déploiement | aucun: LOCK retiré | review des 9 fichiers puis déploiement migration → reservation-workflow → frontends → smoke live contrôlé`

`2026-08-24 | Codex | RECOVERY LOT A.2 — live frontend cleanup | main | f772ebd618500712f26478df367bd75b2f4351b5 | 137/137 PASS; validation humaine Pointage/Logout/F5 PASS; Pages built depuis main | CLOS / LIVE VALIDÉ | aucun: LOCK A.2 retiré | RECOVERY LOT B` 

`2026-08-24 | Codex | RECOVERY LOT A.2 — live frontend cleanup | codex/recovery-lot-a2-live-cleanup | f772ebd618500712f26478df367bd75b2f4351b5 | Lot A/A.1 122/122 + A.2 15/15 = 137/137 PASS; JS/SW/diff PASS; list-login-employees live 200 projection id+display_name | READY FOR TARGETED MERGE — Pages sert encore un ancien CORE daté 2026-08-20 | VERALUZ_OS_CORE.html, sw.js, tests Auth/A.2 | review puis merge ciblé; republier Pages avant retest live` 

`2026-08-24 | Codex | RECOVERY LOT A — publication ciblée | main (source codex/recovery-lot-a1-rh-consumers) | f7ff2ce2da108a38bd63ba89c50f303d44d3da8c | 6 fichiers exacts; JS 4/4 et TS/import PASS; parent main 0e6158b vérifié | MAIN POUSSÉ — migration Supabase NON appliquée | aucun: LOCK retiré | ChatGPT applique ensuite la migration et réalise les smokes autorisés`

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

`2026-08-20 | Claude | ROOM-SERVICE-OPS-1A | claude/room-service-ops-1a | 26e6bc1 | veraluz_attendance source canonique; todayDouala(); list_on_duty_employees session-gated; assign re-vérifie check_in/check_out/status/rôle serveur; 11/11 tests live PASS | READY FOR HUMAN TEST | aucun LOCK | push GitHub (credentials manquants sandbox)`
