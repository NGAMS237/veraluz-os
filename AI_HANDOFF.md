# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. Skills : `.agents/skills/veraluz-*`.
Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

Aucun LOCK actif.

## Lots actifs

RECOVERY LOT D | à démarrer | Documents/SSOT — prochain lot autorisé après validation humaine Lot C

## Transmissions récentes

`2026-08-27 | Claude | RECOVERY LOT C DEPLOYED & VALIDATED LIVE | claude/recovery-lot-c-room-service-folio | 7fa2c5a | migration appliquée PROD; room-service v4 ACTIVE; guest-access v11 ACTIVE; post-restaurant-folio v4 ACTIVE; smoke test 4/4 PASS; nettoyage complet; 3 orphelins intacts (b73bdef9, 0bc946c0, 6e09572d) | LOT C CLOS — aucun LOCK | décision humaine requise pour les 3 commandes orphelines avant tout backfill | prochain lot : RECOVERY LOT D (Documents/SSOT)`

`2026-08-26 | Codex → Claude | RECOVERY LOT C WIP | codex/recovery-lot-c-room-service-folio | base be3b6ff | tests dédiés 22/22; diff --check PASS | HANDOFF — aucun merge/deploy | aucun LOCK | appliquer le patch WIP, relire le diff, exécuter non-régressions + contrôle TypeScript + dry-run SQL rollback, corriger si nécessaire, pousser la branche seulement puis arrêter au gate`

`2026-08-26 | Codex | RECOVERY LOT C START | codex/recovery-lot-c-room-service-folio | base be3b6ff | smoke Lot B nettoyé; audit Guest Portal → Restaurant → Livreur → Room Charge → Folio ouvert | EN COURS — aucun merge/deploy | LOCK Lot C actif | établir SSOT order_id/statuts/charge exactement une fois puis petit lot testé`

`2026-08-24 | Codex | RECOVERY LOT B.1 ATOMIC | codex/recovery-lot-b-reservation-overstay | 32a5f00 | Lot B 34/34; B.1 14/14; AUTH-R1 15/15; A.2 15/15; dry-run PROD transactionnel + rollback 4/4 | READY FOR REVIEW — aucun merge/deploy | aucun LOCK | revue finale puis autorisation explicite pour déploiement ciblé`

`2026-08-20 | Claude | AUTH CLOSED + MERGE MAIN | main | merge claude/auth-final-integration | AUTH PHASE TERMINÉE — anomalie UI AUTH-UI-1 en backlog (Profil/Users vue croisée, non bloquante sécurité). Livrés : profil serveur, team_name, PIN/reset/forced change, sessions/F5, multi-session, RBAC serveur, Sessions/Audit/Sécurité réels, IP/UA tracking, security settings SSOT, X-Veraluz-Session header only, session_token hors body. Prochaine phase : SETTINGS-SSOT-1 | AUTH CLOSED | aucun LOCK | démarrer SETTINGS-SSOT-1`

`2026-08-20 | Claude | AUTH UI BLOCKERS FINAL | claude/auth-final-integration | 363797a | settings-secure v4: WRITABLE_KEYS+security, SECURITY_ALLOWED_FIELDS whitelist 5 champs, SECRET_PATTERNS dans else seulement — resume_token_days sauvegardable. AUTH_EMBEDDED: _renderGen counter + renderProfil(gen)/_renderGen!==gen double-guard + renderUsers(gen)/loadSBEmployees double-guard + renderProfilReload guard. 15/15 tests PASS. EF déployé ACTIVE | AUTH LAST HUMAN RETEST READY | aucun LOCK | tester: Settings→Sécurité save 12→13→reload→13 puis 12→reload→12 | Profil/Users navigation rapide sans pollution croisée`

`2026-08-20 | Claude | AUTH UI POLISH | claude/auth-final-integration | eaa1b05 | AUTH_EMBEDDED: loadSBEmployees cb guarded (currentTabId==='users'); renderProfil .then() guarded (currentTabId!=='profil'); Sessions affiche IP réelle / 'Non disponible' si null; statusBadge dupliqué supprimé. SETTINGS_EMBEDDED: card imbriquée retirée renderSysteme; renderSecuriteCard() réécriture classes natives .row/.toggle-info/.toggle-label/.toggle-track/.row-hint. 17/17 tests PASS | AUTH UI FINAL RETEST READY | aucun LOCK | tester: Profil≠Utilisateurs, Sessions affiche IP, Settings Sécurité lisible et champs éditables`

`2026-08-19 | Claude | AUTH-R5 | main | 7ead666 | _rbac.ts; employees-secure v3; room-service v3; reservation-workflow v2; AUTH_EMBEDDED matrice read-only; 11/11 tests | COMPLET | aucun LOCK | AUTH-R6`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE | claude/auth-r3a-pin-reset | b40ebc7 | migration PROD appliquée; EF v8 ACTIVE; flux complet validé (reset→must_change_pin→change_token→session) | LIVE VALIDATED | aucun LOCK | AUTH-R5`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS | PUBLIÉ | aucun LOCK | validation humaine`

## Commandes orphelines Lot C — décision humaine requise

Trois commandes `delivered` sans `room_charge` actif, antérieures au Lot C.
**Ne pas modifier, ne pas refacturer, ne pas backfiller sans autorisation explicite de Blaise.**

| order_id (préfixe) | order_number | status |
|---|---|---|
| b73bdef9 | RS-MSSGCPA7-081 | delivered (delivered_at=NULL) |
| 0bc946c0 | RS-MST8FLB0-342 | delivered |
| 6e09572d | RS-MSSC8UNX-378 | delivered |

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
