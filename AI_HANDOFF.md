# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. Skills : `.agents/skills/veraluz-*`.
Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

Aucun LOCK actif.

## Lots actifs

Aucun lot actif.

## Transmissions récentes
`2026-08-28 | Claude | RECOVERY LOT E IN PROGRESS | claude/recovery-lot-e-settings-events-comms-scheduler | 7c4c01d+f4e8cfb | Gate0 8/8 + LotE 26/26 PASS | BRANCHE POUSSÉE — en attente autorisation déploiement | aucun LOCK | documents-secure whitelist corrigée (Gate0 LIVE après fast-forward main 3d2d97d); Settings SSOT localStorage retiré; guest-access checkout 12:00 + sans .number; comms-secure no body.session_token; Notifications REST anon supprimé + mode démo; migration veraluz_events/notifications/jobs prête (DRY-RUN PASS); main avant Lot E = 3d2d97d; validation LIVE 11 fiches Documents en attente Blaise | prochain: autoriser migration + EFs + fast-forward Lot E`


`2026-08-27 | Claude | RECOVERY LOT D DEPLOYED, VALIDATED & MERGED | main | 24c3ee7 | documents-secure v1 ACTIVE (verify_jwt=false, X-Veraluz-Session, gerant uniquement); migration recovery_lot_d_documents_ssot appliquée PROD (3 constraints CHECK, 4 index, trigger updated_at, REVOKE anon, 0 policy RLS); fast-forward main 0afdb5c→24c3ee7; smoke test create/update/archive PASS; 11 documents originaux intacts; 0 données synthétiques restantes | LOT D CLOS — aucun LOCK | tests visuels desktop/mobile/thème à effectuer par Blaise | prochain lot métier : RECOVERY LOT E (Settings + Guest + Events + Comms + Scheduler)`

`2026-08-27 | Claude | LOT D CORRIGÉ v3 — PRÊT POUR DÉPLOIEMENT | claude/recovery-lot-d-documents-ssot | fb39d29→24c3ee7 | reviewed_by retiré UPDATE_ALLOWED; pre-flight après CREATE TABLE; erreurs sans detail PostgreSQL; isValidUUID + parseDate 400; tests honnêtes [STATIQUE/DRY-RUN/POST-DEPLOY/MANUEL] | GATE LOT D CLOS | aucun LOCK`

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

---

## LOT D.1 — DOCUMENT FILES (branche: claude/recovery-lot-d1-document-files)

**Statut** : COMPLÉTÉ (branche, pas encore mergée)  
**Base main** : `02ee59e72a0cb01d84455d2573ebcca7820c2f08`

### Changements
- **`supabase/functions/veraluz-document-upload/index.ts`** (nouveau, 339 lignes)  
  Auth X-Veraluz-Session, RBAC documents.manage, validation MIME+extension+magic bytes, 5 types (PDF/JPEG/PNG/DOCX/XLSX), limites 10 MB / 20 MB (legal/bank/property/identity), path opaque `{cat}/{docId}/{ts}_{rnd}_{filename}`, bucket par catégorie (4 buckets privés), mise à jour DB, rollback Storage si DB échoue, suppression ancien fichier avant re-upload.

- **`supabase/functions/documents-secure/index.ts`** (modifié)  
  + action `get_signed_url` : URL signée 15 min, require documents.read, isValidUUID check.

- **`VERALUZ_OS_CORE.html`** (modifié)  
  + `window.veraluzUploadDocument(documentId, file)` — broker upload sécurisé (token en mémoire, FormData, fetch vers EF, aucun secret exposé iframe).

- **`DOCUMENTS_EMBEDDED.html`** (modifié)  
  UI complète : bouton Consulter (URL signée), bouton Uploader/Remplacer, état "fichier présent", progression upload, rollback visuel si erreur. Aucun accès Storage direct. Aucune clé dans le browser.

### Pré-requis déploiement
4 buckets Supabase Storage privés à créer : `veraluz-legal-private`, `veraluz-bank-private`, `veraluz-hr-private`, `veraluz-documents-private`.

### Prochain lot
Lot E (à définir par Blaise). Ne pas commencer sans autorisation explicite.
