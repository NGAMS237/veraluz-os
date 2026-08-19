# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Codex | codex/auth-r1-containment | AUTH-R1 | veraluz_employees RLS, veraluz_employees_public, employee credential RPC privileges, VERALUZ_OS_CORE.html, AUTH_EMBEDDED.html, supabase/migrations/*auth_r1*, tests/*auth-r1*`

## Lots actifs

`AUTH-R1 | Codex | codex/auth-r1-containment | containment sécurité employés/credentials | commit poussé, attente review; aucun déploiement autorisé; LOCK conservé`

## Transmissions récentes

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
