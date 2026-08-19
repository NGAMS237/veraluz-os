# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Claude | claude/auth-r2b1 | AUTH-R2B1.1 — RPC atomique rotate_resume + hardening session backend | supabase/functions/resume-employee-session/index.ts, supabase/functions/issue-resume-token/index.ts, supabase/functions/logout-employee-session/index.ts, supabase/functions/revoke-employee-sessions/index.ts, supabase/migrations/*_auth_r2b1*.sql, tests/auth_r2b1_backend.sh`

## Lots actifs

AUTH-R2B1.1 | claude/auth-r2b1 | En cours — branche locale prête, push en attente auth Git

## Transmissions récentes

`2026-08-19 | Codex | AUTH-R1D PHASE C / AUTH-R1 | main | 6c76f8f66770cec5a49ddc672263fc4570e4990c | migration 20260819180919; table anon 4/4 refusée 401/42501; authenticated sans privilèges; vues 200/projections exactes; RPC credentials refusées; employees-secure profil/RH/annuaire/analytics/roster/Livreur PASS; Pages 7/7 exactes; browser sans erreur bloquante; 3 sessions test supprimées | COMPLET — CONTAINMENT LIVE VALIDÉ; rollback non utilisé | aucun: LOCK AUTH-R1 retiré | aucune; ne pas commencer AUTH-R2 sans nouveau lot`

`2026-08-19 | Codex | AUTH-R1D-H1 | main (source codex/auth-r1-containment) | 6c76f8f66770cec5a49ddc672263fc4570e4990c | fast-forward 0/1; H1 10/10 + AUTH 11+15+52+13+14+16 PASS; Pages blob exact; navigateur Aujourd'hui/Historique/Livreurs/détail PASS sans erreur console; REST canonique et lookup livreur_id 200 | publié, READY FOR HUMAN RETEST; containment absent et rh_anon_all présent | LOCK AUTH-R1 Phase B conservé | Blaise reteste Restaurant; aucune Phase C/AUTH-R2 sans autorisation`

`2026-08-19 | Codex | AUTH-R1D-H1 | codex/auth-r1-containment | 6c76f8f | DB: seules colonnes livreur_id/assigned_to présentes; ciblé 10/10; AUTH 11+15+52+13+14+16 PASS; REST live Aujourd’hui/Historique/Détail/message 200; regroupement réel lu sans écriture | poussé, READY FOR REVIEW; aucun déploiement/merge | LOCK AUTH-R1 Phase B conservé | review puis autorisation séparée requise avant merge main; containment interdit`

`2026-08-19 | Codex | AUTH-R1D PHASE B | main (source codex/auth-r1-containment) | e7206fcde199548dc699a18eb3b1132d264525dc | fast-forward 5/0; suites 11+15+52+13+14+16 PASS; Pages 7/7 blobs exacts; live profil/RH/Contacts/Analytics/Restaurant 200; Livreur équipe 200 et hors-équipe 403; CORS 204; navigateur sans erreur bloquante; 3 sessions test supprimées | publié, READY FOR HUMAN VALIDATION; rh_anon_all présent et containment non appliqué | mêmes zones Phase B: LOCK conservé | validation humaine puis autorisation séparée requise avant Phase C; ne pas démarrer AUTH-R2`

`2026-08-19 | Codex | AUTH-R1D PHASE A | codex/auth-r1-containment | e7206fcde199548dc699a18eb3b1132d264525dc | live: Edge 401 sans/invalide, profil 200, Livreur 200, hors-équipe 403, photo croisée 400; vue anon 200, 2 lignes/3 colonnes, écritures refusées 55000; employés directs 200; logs sans secret; 2 sessions test supprimées | employees-secure v1 ACTIVE + migration auth_r1c2_delivery_login_public appliquée; READY FOR FRONTEND RELEASE | mêmes zones: LOCK conservé | publier les frontends dans une phase autorisée séparée; ne pas appliquer containment avant Phase C`

`2026-08-19 | Codex | AUTH-R1C2.1 | codex/auth-r1-containment | e7206fcde199548dc699a18eb3b1132d264525dc | DB read-back FK team_id→teams et équipe Livreurs; R1C2.1 13/13; R1C2 14/14; R1C1/R1C1.1 52/52; AUTH-R1 15/15; broker 11/11; Contacts 16/16; diff/secrets/syntaxe PASS | poussé, READY FOR FINAL R1 REVIEW; aucun déploiement | vue delivery publique, LIVREUR, employees-secure et tests: LOCK conservé selon demande | review finale R1; déploiement et fusion main exigent une autorisation séparée`

`2026-08-18 | Codex | AUTH-R1C2 | codex/auth-r1-containment | 39350571064a96d85d5587186d6081cc8b4889a9 | DB read-back rôles staff/technicien dans l'équipe Livreurs; R1C2 13/13; R1C1 44/44; AUTH-R1 15/15; broker Auth 11/11; runtime Contacts 16/16; syntaxe HTML/JS et diff PASS | poussé, READY FOR REVIEW; aucun déploiement | LIVREUR.html, employees-secure, tests R1C1/R1C2: LOCK conservé selon demande | review ciblée; AUTH-R2 gérera resume/F5 et résilience logout; aucune fusion main`

`2026-08-18 | Codex | AUTH-R1C1.1 | codex/auth-r1-containment | 8c0aed8 | automatisé/statique AUTH-R1C1 40/40 dont 11 scénarios Edge simulés; AUTH-R1 15/15; broker Auth 11/11; runtime Contacts 16/16; diff et secrets contrôlés | poussé, READY FOR REVIEW; aucun déploiement | employees-secure + test: LOCK conservé selon demande | review sécurité ciblée; aucune fusion main`

`2026-08-18 | Codex | AUTH-R1C1 | codex/auth-r1-containment | 12bdace46d37cf2cbb93a92371be2fdaa4b9a038 | statique AUTH-R1C1 27/27; AUTH-R1 15/15; broker Auth 11/11; runtime Contacts 16/16; syntaxe des 5 interfaces et diff vérifiés | poussé, READY FOR REVIEW; migration et Edge Function non déployées | aucun: LOCK retiré | review ciblée; AUTH-R1C2 traitera LIVREUR; aucune fusion main`

`2026-08-18 | Codex | AUTH-R1 | codex/auth-r1-containment | 04b164da8867189cfdeb4fceb3c2d98d61711f87 | statique AUTH-R1 15/15; broker Auth 11/11; read-back anon vue minimale HTTP 200 avec id/full_name/role/status seulement; aucun secret | poussé, non déployé, attente review | mêmes zones: LOCK conservé | reviewer migration/RPC; 6 anciens appels frontend directs seront bloqués; aucune fusion main`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
