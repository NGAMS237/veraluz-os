# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Claude | claude/auth-r3a-pin-reset | AUTH-R3A — reset-employee-pin atomique + tests A→P | supabase/functions/reset-employee-pin/index.ts, tests/auth_r3a_pin_reset.sh`

## Lots actifs

AUTH-R3A | claude/auth-r3a-pin-reset | En cours — reset atomique (sessions+resumes), 16 tests A→P
AUTH-R2 | main | PUBLIÉ — e2f4629 sur main; en attente validation humaine F5

## Transmissions récentes

`2026-08-19 | Claude | AUTH-R3A LOCK | claude/auth-r3a-pin-reset | — | preflight: EFs verify/complete/reset déjà implémentées PROMPT 009; DB change_tokens+must_change_pin OK; seul gap: reset-employee-pin revoque sessions mais PAS resume_tokens — doit utiliser veraluz_revoke_employee_sessions RPC atomique | LOCK AUTH-R3A pris | supabase/functions/reset-employee-pin/index.ts, tests/auth_r3a_pin_reset.sh | implémenter fix + 16 tests + push`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only 6c76f8f→e2f4629; 126/126 statiques PASS; live 6/6 PASS; backend EF ACTIVE; Pages build déclenché | PUBLIÉ — en attente validation humaine F5 login/resume/logout | aucun LOCK actif | Blaise valide F5 CORE + LIVREUR live avec PIN réel`

`2026-08-19 | Claude | AUTH-R2D INTÉGRATION | claude/auth-r2-integration | e2f4629 | AUTH-R2C 18/18; AUTH-R2B1 14/14; AUTH-R1C2 14/14; AUTH-R1C2.1 13/13; AUTH-R1 15/15; AUTH-R1C1 52/52; syntaxe CORE/LIVREUR 0 erreur; live 6/6 PASS; contrat backend/frontend vérifié; main 6c76f8f inchangé | poussé, READY FOR MERGE REVIEW; NE PAS merger main sans autorisation | LOCK AUTH-R2D retiré | autorisation Blaise pour merger main ou poursuivre`

`2026-08-19 | Claude | AUTH-R2B1 BACKEND | claude/auth-r2b1 | 1b162fb | 4 EF déployées ACTIVE; migrations rotate_resume + revoke_sessions appliquées; tests live D1-D14 13/13 PASS; Phase E régression PASS | LIVE VALIDATED — READY FOR INTEGRATION | LOCK AUTH-R2B1 retiré | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; R1C2 14/14; éligibilité 13/13; broker 11/11; employees-secure 52/52; containment 15/15; syntaxe CORE/Livreur | poussé, READY FOR REVIEW; aucun backend/déploiement/merge | LOCK AUTH-R2C retiré — handed off à Claude AUTH-R2D | intégration AUTH-R2D par Claude`

`2026-08-19 | Codex | AUTH-R1D PHASE C / AUTH-R1 | main | 6c76f8f66770cec5a49ddc672263fc4570e4990c | migration 20260819180919; table anon 4/4 refusée 401/42501; authenticated sans privilèges; vues 200/projections exactes; RPC credentials refusées; employees-secure profil/RH/annuaire/analytics/roster/Livreur PASS; Pages 7/7 exactes | COMPLET — CONTAINMENT LIVE VALIDÉ | aucun: LOCK AUTH-R1 retiré | aucune; ne pas commencer AUTH-R2 sans nouveau lot`

`2026-08-19 | Codex | AUTH-R1D-H1 | main (source codex/auth-r1-containment) | 6c76f8f66770cec5a49ddc672263fc4570e4990c | fast-forward 0/1; H1 10/10 + AUTH 11+15+52+13+14+16 PASS; Pages blob exact; navigateur Aujourd'hui/Historique/Livreurs/détail PASS sans erreur console | publié, READY FOR HUMAN RETEST | LOCK AUTH-R1 Phase B conservé | Blaise reteste Restaurant; aucune Phase C/AUTH-R2 sans autorisation`

`2026-08-19 | Codex | AUTH-R1D PHASE B | main (source codex/auth-r1-containment) | e7206fcde199548dc699a18eb3b1132d264525dc | fast-forward 5/0; suites 11+15+52+13+14+16 PASS; Pages 7/7 blobs exacts; live profil/RH/Contacts/Analytics/Restaurant 200; Livreur équipe 200 et hors-équipe 403; CORS 204 | publié, READY FOR HUMAN VALIDATION | mêmes zones Phase B: LOCK conservé | validation humaine puis autorisation séparée requise avant Phase C; ne pas démarrer AUTH-R2`

`2026-08-19 | Codex | AUTH-R1D PHASE A | codex/auth-r1-containment | e7206fcde199548dc699a18eb3b1132d264525dc | live: Edge 401 sans/invalide, profil 200, Livreur 200, hors-équipe 403; vue anon 200, 2 lignes/3 colonnes, écritures refusées 55000 | employees-secure v1 ACTIVE + migration auth_r1c2_delivery_login_public appliquée; READY FOR FRONTEND RELEASE | mêmes zones: LOCK conservé | publier les frontends dans une phase autorisée séparée`

`2026-08-19 | Codex | AUTH-R1C2.1 | codex/auth-r1-containment | e7206fcde199548dc699a18eb3b1132d264525dc | DB read-back FK team_id→teams; R1C2.1 13/13; R1C2 14/14; R1C1 52/52; AUTH-R1 15/15; Contacts 16/16 | poussé, READY FOR FINAL R1 REVIEW; aucun déploiement | LOCK conservé | review finale R1`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
