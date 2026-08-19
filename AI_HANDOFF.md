# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. La version partagée de référence vit sur `ai/coordination`. Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

`LOCK | Codex | codex/guest-4a-p1 | GUEST-4A.P1 | GUEST_PORTAL.html; RESERVATIONS_EMBEDDED.html; supabase/functions/guest-access/index.ts; supabase/functions/settings-secure/index.ts; supabase/migrations/20260818_guest_wifi_privacy.sql; tests/guest-portal-correctness.test.mjs`

## Lots actifs

`GUEST-4A.P1 | Codex | backend sécurité déployé et validé; interfaces non publiées | migration RLS active; settings-secure v2; guest-access v10; en attente d'autorisation main; LOCK conservé`

## Transmissions récentes

`2026-08-18 | Codex | GUEST-4A.P1 | codex/guest-4a-p1 | 38786d67a486afa3a7fa5dddb02df7d56c762ad1 | RLS anon/auth wifi=0 ligne; settings public sans password; update sans session=401; Direction no-op PASS; confirmed sans password; checkedout refusé; logs propres; fixtures temporaires supprimées | backend déployé: migration active, settings-secure v2, guest-access v10; interfaces non publiées; aucun merge | mêmes fichiers: LOCK conservé | autorisation séparée requise avant merge main et publication interfaces`

`2026-08-18 | Codex | GUEST-4A.2 | codex/guest-4a2-validation | 196aa8f | test ciblé PASS; DB/API/UI identiques; desktop 1440×900 PASS; mobile 390×844 PASS; checkout Folio autorisé, stay/Wi-Fi/Room Service refusés; guest-access v9; session test supprimée | poussé, non fusionné; GUEST-4A complet | aucun: LOCK retiré | review/fusion main uniquement avec autorisation de Blaise`

`2026-08-18 | Codex | SKILLS-001 | codex/setup-veraluz-skills | 22845357f7580056f82f8f5cf40903a6c0d117b6 | quick_validate 4/4 PASS; frontmatter, diff, secrets et cohérence contrôlés | poussé, non fusionné | aucun: LOCK retiré | review si demandée; fusion main uniquement avec autorisation de Blaise`

`2026-08-18 | Codex | COORD-003 | codex/setup-ai-coordination | HEAD local | contrôle Markdown + git diff | prêt à pousser, non fusionné | aucun | pousser la branche de travail; préparer ai/coordination; fusion dans main uniquement avec autorisation de Blaise`

`2026-08-17 | Codex | COORD-002 | codex/setup-ai-coordination | 0779e75 | contrôle Markdown + git diff | remplacé par COORD-003 | aucun | aucune`

`2026-08-17 | Codex | COORD-001 | codex/setup-ai-coordination | a5c4d9b | contrôle Markdown | remplacé par COORD-002 | aucun | aucune`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
