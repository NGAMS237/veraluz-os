# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. Skills : `.agents/skills/veraluz-*`.
Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

*(aucun LOCK actif)*

## Lots actifs

AUTH-FINAL-FIX | claude/auth-final-integration | PRÊT POUR HUMAN RETEST — 2 bugs corrigés (167d400)

## Transmissions récentes

`2026-08-20 | Claude | AUTH-FINAL-FIX | claude/auth-final-integration | 167d400 | fix(auth): team_name résolu depuis veraluz_teams, dept filtre ID techniques; employees-secure v4 déployé (strip session_token + team_name lookup); AUTH_EMBEDDED.html L701-703 patchés; metadata skills ajoutés (.agents/skills/, .claude/skills/, CLAUDE.md, AGENTS.md, AI_COLLABORATION.md) | PRÊT POUR HUMAN RETEST | aucun LOCK | Blaise reteste: Profil→Modifier→Enregistrer (plus invalid_profile_fields) + Équipe affiche nom réel (plus team-005)`

`2026-08-19 | Claude | AUTH SyntaxError fixes | claude/auth-final-integration | d7486e2 | AUTH_EMBEDDED 3 apostrophes + SETTINGS_EMBEDDED 2 apostrophes corrigés via GitHub web editor | COMPLET | aucun LOCK | AUTH-FINAL-FIX`

`2026-08-19 | Claude | AUTH FINAL INTEGRATION | claude/auth-final-integration | 0e57dc8 | cherry-pick R6 (288ce19); conflit CORE résolu; 35/35 tests PASS | COMPLET | aucun LOCK | SyntaxError fixes`

`2026-08-19 | Claude | AUTH-R6 | claude/auth-r6 | 288ce19 | auth-admin-secure EF; DEMO supprimés; sessions réelles; audit events; 16/16 tests | COMPLET | aucun LOCK | FINAL INTEGRATION`

`2026-08-19 | Claude | AUTH-R5 | main | 7ead666 | _rbac.ts; employees-secure v3; room-service v3; reservation-workflow v2; AUTH_EMBEDDED matrice read-only; 11/11 tests | COMPLET | aucun LOCK | AUTH-R6`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE | claude/auth-r3a-pin-reset | b40ebc7 | migration PROD appliquée; EF v8 ACTIVE; flux complet validé (reset→must_change_pin→change_token→session) | LIVE VALIDATED | aucun LOCK | AUTH-R5`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS | PUBLIÉ | aucun LOCK | validation humaine`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; éligibilité 13/13 | READY FOR REVIEW | aucun LOCK | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R1D PHASE C | main | 6c76f8f | containment LIVE VALIDÉ; Pages 7/7 | COMPLET | aucun LOCK | aucune`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`

## Retest humain requis (2026-08-20)

1. AUTH → Profil → Modifier mes infos → Enregistrer → doit retourner OK (plus `invalid_profile_fields`)
2. AUTH → Profil → Équipe → doit afficher nom réel (ex: "Livraisons") et jamais `team-005`
3. AUTH → Profil → Département → ne doit pas afficher un ID `team-*`
4. F5 après save → données conservées
