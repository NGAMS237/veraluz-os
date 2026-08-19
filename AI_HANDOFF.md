# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Codex | codex/auth-r1-containment | AUTH-R1C2.1 | LIVREUR.html, supabase/functions/employees-secure/index.ts, supabase/migrations/20260819_auth_r1c2_delivery_login_public.sql, tests/auth-r1c1-employees-secure.test.mjs, tests/auth-r1c2-livreur-session.test.mjs, tests/auth-r1c2-1-delivery-eligibility.test.mjs`

## Lots actifs

`AUTH-R1C2.1 | Codex | codex/auth-r1-containment | Éligibilité Livreur par affectation canonique à l'équipe Livreurs, sélection publique minimale et contrôle serveur | en cours sur 3935057; aucun déploiement; LOCK conservé`

## Transmissions récentes

`2026-08-18 | Codex | AUTH-R1C2 | codex/auth-r1-containment | 39350571064a96d85d5587186d6081cc8b4889a9 | DB read-back rôles staff/technicien dans l'équipe Livreurs; R1C2 13/13; R1C1 44/44; AUTH-R1 15/15; broker Auth 11/11; runtime Contacts 16/16; syntaxe HTML/JS et diff PASS | poussé, READY FOR REVIEW; aucun déploiement | LIVREUR.html, employees-secure, tests R1C1/R1C2: LOCK conservé selon demande | review ciblée; AUTH-R2 gérera resume/F5 et résilience logout; aucune fusion main`

`2026-08-18 | Codex | AUTH-R1C1.1 | codex/auth-r1-containment | 8c0aed8 | automatisé/statique AUTH-R1C1 40/40 dont 11 scénarios Edge simulés; AUTH-R1 15/15; broker Auth 11/11; runtime Contacts 16/16; diff et secrets contrôlés | poussé, READY FOR REVIEW; aucun déploiement | employees-secure + test: LOCK conservé selon demande | review sécurité ciblée; aucune fusion main`

`2026-08-18 | Codex | AUTH-R1C1 | codex/auth-r1-containment | 12bdace46d37cf2cbb93a92371be2fdaa4b9a038 | statique AUTH-R1C1 27/27; AUTH-R1 15/15; broker Auth 11/11; runtime Contacts 16/16; syntaxe des 5 interfaces et diff vérifiés | poussé, READY FOR REVIEW; migration et Edge Function non déployées | aucun: LOCK retiré | review ciblée; AUTH-R1C2 traitera LIVREUR; aucune fusion main`

`2026-08-18 | Codex | AUTH-R1 | codex/auth-r1-containment | 04b164da8867189cfdeb4fceb3c2d98d61711f87 | statique AUTH-R1 15/15; broker Auth 11/11; read-back anon vue minimale HTTP 200 avec id/full_name/role/status seulement; aucun secret | poussé, non déployé, attente review | mêmes zones: LOCK conservé | reviewer migration/RPC; 6 anciens appels frontend directs seront bloqués; aucune fusion main`

`2026-08-18 | Codex | GUEST-4A / GUEST-4A.P1 | main | 38786d67a486afa3a7fa5dddb02df7d56c762ad1 | test utilisateur final PASS: identité, checked-in, SSID, mot de passe masqué, Afficher/Copier et mobile validés | COMPLET | aucun: LOCK retiré | aucune; ne démarrer aucun autre lot dans cette action`

`2026-08-18 | Codex | GUEST-4A.P1 | main (source codex/guest-4a-p1) | 38786d67a486afa3a7fa5dddb02df7d56c762ad1 | Pages sert exactement CORE/Guest/Réservations; tests ciblés 11/11; browser CORE/Réservations/Guest sans erreur console; settings-secure wifi non configuré sans password; checkedout Folio 200, séjour/Wi-Fi et Room Service 401; session temporaire supprimée | produit publié; aucun autre lot commencé; attente test humain Wi-Fi | mêmes fichiers: LOCK conservé | Blaise saisit le Wi-Fi depuis CORE puis valide; retirer le LOCK seulement après son verdict`

`2026-08-18 | Codex | GUEST-4A.P1 | codex/guest-4a-p1 | 38786d67a486afa3a7fa5dddb02df7d56c762ad1 | RLS anon/auth wifi=0 ligne; settings public sans password; update sans session=401; Direction no-op PASS; confirmed sans password; checkedout refusé; logs propres; fixtures temporaires supprimées | backend déployé: migration active, settings-secure v2, guest-access v10; interfaces non publiées; aucun merge | mêmes fichiers: LOCK conservé | autorisation séparée requise avant merge main et publication interfaces`

`2026-08-18 | Codex | GUEST-4A.2 | codex/guest-4a2-validation | 196aa8f | test ciblé PASS; DB/API/UI identiques; desktop 1440×900 PASS; mobile 390×844 PASS; checkout Folio autorisé, stay/Wi-Fi/Room Service refusés; guest-access v9; session test supprimée | poussé, non fusionné; GUEST-4A complet | aucun: LOCK retiré | review/fusion main uniquement avec autorisation de Blaise`

`2026-08-18 | Codex | SKILLS-001 | codex/setup-veraluz-skills | 22845357f7580056f82f8f5cf40903a6c0d117b6 | quick_validate 4/4 PASS; frontmatter, diff, secrets et cohérence contrôlés | poussé, non fusionné | aucun: LOCK retiré | review si demandée; fusion main uniquement avec autorisation de Blaise`

`2026-08-18 | Codex | COORD-003 | codex/setup-ai-coordination | HEAD local | contrôle Markdown + git diff | prêt à pousser, non fusionné | aucun | pousser la branche de travail; préparer ai/coordination; fusion dans main uniquement avec autorisation de Blaise`

`2026-08-17 | Codex | COORD-002 | codex/setup-ai-coordination | 0779e75 | contrôle Markdown + git diff | remplacé par COORD-003 | aucun | aucune`

`2026-08-17 | Codex | COORD-001 | codex/setup-ai-coordination | a5c4d9b | contrôle Markdown | remplacé par COORD-002 | aucun | aucune`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
