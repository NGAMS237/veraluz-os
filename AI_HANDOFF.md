# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. Skills : `.agents/skills/veraluz-*`.
Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

Aucun LOCK actif.

## Lots actifs

UI-0 | `claude/ui-0-veraluz-signature-audit` | Audit documentaire VERALUZ Signature — aucun écran, code métier ou déploiement

RECOVERY LOT D | à démarrer après clôture documentaire UI-0 | Documents/SSOT — prochain lot métier

## Transmissions récentes

`2026-08-27 | Claude | UI-0 VERALUZ SIGNATURE AUDIT | claude/ui-0-veraluz-signature-audit | EN COURS | docs/design/veraluz-signature/ installé; VERALUZ_UI_AUDIT.md + VERALUZ_UI_PILOT_PLAN.md écrits; 5 systèmes CSS identifiés; 100+ variables concurrentes; RESTAURANT 170 couleurs hardcodées; Guest Portal le plus proche Signature; Livreur --gold exact; aucun --vlz-* encore présent | AUDIT COMPLET — aucun écran modifié | aucun LOCK | pousser branche, attendre autorisation UI-1`

`2026-08-27 | Claude | RECOVERY LOT C DEPLOYED, VALIDATED & MERGED | main | 893c861 | migration appliquée PROD; room-service v4 ACTIVE; guest-access v11 ACTIVE; post-restaurant-folio v4 ACTIVE; smoke test 4/4 PASS; nettoyage complet; fast-forward main confirmé; 3 orphelins intacts (b73bdef9, 0bc946c0, 6e09572d) | LOT C CLOS — aucun LOCK | décision humaine requise pour les 3 commandes orphelines avant tout backfill | prochain lot métier : RECOVERY LOT D (Documents/SSOT)`

`2026-08-26 | Codex → Claude | RECOVERY LOT C WIP | codex/recovery-lot-c-room-service-folio | base be3b6ff | tests dédiés 22/22 | HANDOFF — aucun merge/deploy | aucun LOCK`

`2026-08-24 | Codex | RECOVERY LOT B.1 ATOMIC | codex/recovery-lot-b-reservation-overstay | 32a5f00 | Lot B 34/34; B.1 14/14; AUTH-R1 15/15; dry-run 4/4 | READY FOR REVIEW`

`2026-08-20 | Claude | AUTH CLOSED + MERGE MAIN | main | merge claude/auth-final-integration | AUTH PHASE TERMINÉE | AUTH CLOSED | aucun LOCK`

`2026-08-19 | Claude | AUTH-R5 | main | 7ead666 | _rbac.ts; employees-secure v3; room-service v3; reservation-workflow v2 | COMPLET`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE | claude/auth-r3a-pin-reset | b40ebc7 | migration PROD appliquée; EF v8 ACTIVE | LIVE VALIDATED`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS | PUBLIÉ`

`2026-08-19 | Codex | AUTH-R1D PHASE C | main | 6c76f8f | containment LIVE VALIDÉ; Pages 7/7 | COMPLET`

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
