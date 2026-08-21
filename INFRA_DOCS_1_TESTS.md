# INFRA-DOCS-1 — Plan de tests

> Branche : `claude/settings-ssot-1a`  
> Migration : `20260821_infra_docs_1.sql`  
> Fonctions Edge : `document-worker`, mise à jour `infra-scheduler`, `infra-health`, `guest-access`  
> Aucun déploiement Supabase — tests à effectuer sur branche de dev ou preview.

---

## DOC — Tests document-worker

### DOC-1 : Auth service_role obligatoire
**Précondition** : document-worker déployé sur env dev  
**Action** : `POST /functions/v1/document-worker` sans header `Authorization`  
**Attendu** : `HTTP 403`, `{ ok: false, error: "service_role_required" }`

### DOC-2 : Auth rejetée si token quelconque (pas service_role exact)
**Action** : `POST /functions/v1/document-worker` avec `Authorization: Bearer fake_token`  
**Attendu** : `HTTP 403`, `{ ok: false, error: "service_role_required" }`

### DOC-3 : Batch vide — aucun job pending
**Précondition** : `veraluz_document_jobs` vide ou tous `completed`  
**Action** : `POST /functions/v1/document-worker` avec service_role  
**Attendu** : `HTTP 200`, `{ ok: true, processed: 0, completed: 0, failed: 0, dead: 0 }`

### DOC-4 : Génération payment_receipt — succès
**Précondition** :  
- Réservation confirmée avec `client_email`  
- Paiement `validated` existant sur la réservation  
- `payment_recorded` event déclenche `vz_emit_payment_event()` → job `payment_receipt` inséré  
**Action** : `POST /functions/v1/document-worker` avec service_role  
**Attendu** :  
- `{ ok: true, processed: 1, completed: 1 }`  
- Ligne créée dans `veraluz_documents` : `document_type='payment_receipt'`, `status='completed'`, `storage_path='payment_receipt/{payment_id}.pdf'`, `file_size_bytes > 0`  
- Objet PDF présent dans bucket `veraluz-documents-private`  
- Job dans `veraluz_document_jobs` : `status='completed'`, `worker_id` non null

### DOC-5 : Génération stay_folio — succès
**Précondition** :  
- Réservation `checkedout` → trigger `vz_emit_reservation_event()` crée job `stay_folio`  
- `veraluz_room_charges` avec charges restaurant sur la réservation  
- Paiements `validated` sur la réservation  
**Action** : `POST /functions/v1/document-worker` avec service_role  
**Attendu** :  
- `{ ok: true, processed: 1, completed: 1 }`  
- `veraluz_documents` : `document_type='stay_folio'`, `status='completed'`  
- PDF dans bucket : `stay_folio/{reservation_id}.pdf`

### DOC-6 : Formule financière SSOT — lodging = reservation.total
**Précondition** : Réservation avec `total = 75000`, charges restaurant = 5000, paiements = 80000  
**Attendu dans le PDF stay_folio** :  
- Hébergement : 75 000 XAF  
- Restaurant : 5 000 XAF  
- Total brut : 80 000 XAF  
- Total payé : 80 000 XAF  
- Solde : 0 XAF  
- **INTERDIT** : recalculer `total` depuis les paramètres fiscaux actuels

### DOC-7 : Idempotence — re-génération sur même related_record_id
**Précondition** : `veraluz_documents` a déjà une ligne `payment_receipt` pour ce payment_id  
**Action** : `vz_emit_payment_event()` déclenche un second job (cas re-trigger) → document-worker tourne  
**Attendu** : `UPSERT` sur `(document_type, related_record_id)` — pas de doublon, `status='completed'`, PDF écrasé avec `upsert: true`

### DOC-8 : Paiement introuvable — job passe à failed
**Précondition** : Job `payment_receipt` avec `related_record_id` UUID qui n'existe pas dans `veraluz_payments`  
**Attendu** :  
- `veraluz_document_jobs.status = 'failed'`, `last_error` contient `payment_not_found`  
- `veraluz_documents.status = 'failed'`, `error_message` renseigné

### DOC-9 : Retry et dead — max_attempts atteint
**Précondition** : Job en échec, `attempt >= max_attempts`  
**Action** : document-worker traite ce job  
**Attendu** : `veraluz_document_jobs.status = 'dead'`  
- infra-health : `alert_level = 'CRITICAL'`, `documents.job_counts.dead > 0`

### DOC-10 : claim_document_jobs — FOR UPDATE SKIP LOCKED
**Précondition** : Deux appels simultanés à document-worker  
**Attendu** : Chaque job traité exactement une fois — pas de doublon PDF, pas de conflit

### DOC-11 : worker_id propagé — traçabilité scheduler→worker→job
**Précondition** : infra-scheduler déclenche document-worker avec `worker_id = run_id`  
**Attendu** : `veraluz_document_jobs.worker_id = run_id` pour tous les jobs claimés pendant ce run

### DOC-12 : recover_stale_jobs couvre les document_jobs
**Précondition** : Job `document_jobs` en `processing` depuis > 5 min (simuler `claimed_at = now() - interval '6 min'`)  
**Action** : `SELECT recover_stale_jobs(5)`  
**Attendu** : Job repassé en `pending`, `recovered_comm_jobs` (ou `recovered_doc_jobs`) incrémenté

### DOC-13 : Bucket private — aucun accès public
**Action** : Construire l'URL publique `{SUPABASE_URL}/storage/v1/object/public/veraluz-documents-private/stay_folio/{id}.pdf`  
**Attendu** : `HTTP 400` ou `403` — aucune URL publique ne fonctionne

### DOC-14 : get_my_documents — isolation reservation_id
**Précondition** : Guest A et Guest B ont chacun un document  
**Action** : Guest A appelle `get_my_documents`  
**Attendu** : Seuls les documents `WHERE reservation_id = session_A.reservation_id` sont retournés

### DOC-15 : get_my_document_url — document_id d'une autre réservation
**Précondition** : Guest A tente de télécharger le document de Guest B (`document_id` de la réservation B)  
**Action** : `{ action: 'get_my_document_url', document_id: docBId }`  
**Attendu** : `HTTP 403`, `{ ok: false, error: "access_denied" }`

### DOC-16 : get_my_document_url — document en préparation
**Précondition** : `veraluz_documents` existe mais `status = 'processing'`  
**Attendu** : `HTTP 202`, `{ ok: false, error: "document_not_ready", status: "processing", message: "Document en préparation…" }`  
**GUEST_PORTAL** : affiche "Document en préparation — revenez dans quelques instants"

### DOC-17 : get_my_document_url — URL signée valide 15 min
**Précondition** : Document `status='completed'`, `storage_path` valide  
**Action** : `{ action: 'get_my_document_url', document_id: validDocId }`  
**Attendu** : `HTTP 200`, `{ ok: true, signed_url: "https://...", expires_in: 900 }`  
- URL accessible dans les 15 minutes  
- URL expirée après 15 min → `HTTP 400/403`

### DOC-18 : infra-health — section documents
**Action** : `GET /functions/v1/infra-health` (gérant authentifié)  
**Attendu** :  
- Champ `documents.job_counts` avec tous les statuts  
- `documents.last_generated` : dernier doc généré  
- `documents.has_failed` : `true` si au moins un doc en `failed`  
- `alert_level = 'WARNING'` si `has_failed = true`  
- `alert_level = 'CRITICAL'` si `job_counts.dead > 0`

---

## COM — Tests communications (vérification rétrocompatibilité)

### COM-1 : blocked_provider — pas de retry consommé
**Précondition** : `dispatch_worker_email` retourne `{ status: 'pending_channel' }` (Resend non configuré)  
**Attendu** :  
- `veraluz_communication_jobs.status = 'blocked_provider'`  
- `attempt` reste inchangé (pas incrémenté par l'erreur)  
- infra-health : `comms.has_blocked_provider = true`, `alert_level ≥ 'WARNING'`

### COM-2 : blocked_provider visible dans infra-health
**Action** : `GET /functions/v1/infra-health`  
**Attendu** : `comms.counts.blocked_provider > 0`, `comms.blocked_provider_count > 0`

### COM-3 : Auth comms-worker — exact Bearer match
**Action** : `POST /functions/v1/comms-worker` avec `Authorization: Bearer fake_suffix_service_key`  
**Attendu** : `HTTP 403` — match exact, pas `endsWith`

### COM-4 : Auth event-worker — exact Bearer match
**Action** : `POST /functions/v1/event-worker` avec token partial match  
**Attendu** : `HTTP 403`

---

## RUN — Tests infra-scheduler

### RUN-1 : Pipeline scheduler — recover → event → document → comms
**Action** : Appel manuel ou automatique à infra-scheduler  
**Attendu** :  
- Réponse contient `event_worker`, `document_worker`, `comms_worker`  
- `veraluz_infra_runs` : colonnes `doc_processed`, `doc_completed`, `doc_failed`, `doc_dead` renseignées  
- `status = 'completed'` si aucune erreur

### RUN-2 : run_id propagé aux trois workers
**Précondition** : Un job dans chaque queue  
**Action** : infra-scheduler s'exécute  
**Attendu** :  
- `veraluz_event_jobs.worker_id = run_id`  
- `veraluz_document_jobs.worker_id = run_id`  
- `veraluz_communication_jobs.worker_id = run_id` (si colonne présente)

### RUN-3 : Partial run — document-worker en erreur HTTP
**Précondition** : document-worker retourne erreur (simuler EF down)  
**Attendu** :  
- `veraluz_infra_runs.status = 'partial'`  
- `error_message` contient l'erreur document-worker  
- event-worker et comms-worker ont quand même tourné  
- infra-health reflète l'état réel

---

*Document généré : 2026-08-21 — INFRA-DOCS-1 branche claude/settings-ssot-1a*
