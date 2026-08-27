# RECOVERY LOT D.1 — TESTS

## Périmètre
- Edge Function `veraluz-document-upload` (nouvelle)
- Action `get_signed_url` dans `documents-secure`
- `window.veraluzUploadDocument` dans `VERALUZ_OS_CORE.html`
- UI upload/consult dans `DOCUMENTS_EMBEDDED.html`

---

## T-01 — Auth : 401 sans session
**Méthode** : POST `/functions/v1/veraluz-document-upload` sans header `X-Veraluz-Session`  
**Attendu** : `{ ok: false, error: "unauthorized" }` HTTP 401

## T-02 — Auth : 403 rôle insuffisant
**Méthode** : POST avec session valide d'un utilisateur sans `documents.manage`  
**Attendu** : `{ ok: false, error: "documents_manage_forbidden" }` HTTP 403

## T-03 — Type MIME invalide
**Méthode** : Upload d'un fichier `.txt` avec Content-Type `text/plain` + session gérant  
**Attendu** : `{ ok: false, error: "invalid_file_type" }` HTTP 415

## T-04 — Extension incohérente avec MIME
**Méthode** : Fichier renommé `.pdf` mais Content-Type `image/jpeg`  
**Attendu** : `{ ok: false, error: "invalid_file_type" }` HTTP 415

## T-05 — Magic bytes invalides
**Méthode** : Fichier `.pdf` dont les 4 premiers octets ne sont pas `%PDF`  
**Attendu** : `{ ok: false, error: "invalid_file_content" }` HTTP 415

## T-06 — Taille dépassée (standard)
**Méthode** : Upload JPEG > 10 MB pour une catégorie non-étendue  
**Attendu** : `{ ok: false, error: "file_too_large" }` HTTP 413

## T-07 — Taille dépassée (étendue)
**Méthode** : Upload PDF > 20 MB pour catégorie `legal`  
**Attendu** : `{ ok: false, error: "file_too_large" }` HTTP 413

## T-08 — document_id inexistant
**Méthode** : Upload valide avec `document_id` qui n'existe pas en DB  
**Attendu** : `{ ok: false, error: "document_not_found" }` HTTP 404

## T-09 — Upload valide (première fois)
**Méthode** : Upload PDF valide pour une fiche sans fichier existant  
**Attendu** : HTTP 200, `{ ok: true, document_id, file_name, file_size, file_type, storage_path, bucket }`  
**Vérification DB** : `veraluz_documents.storage_path` et `storage_bucket` mis à jour

## T-10 — Remplacement (retry sans doublon)
**Méthode** : Re-upload d'un nouveau fichier pour la même fiche (déjà un fichier)  
**Attendu** : HTTP 200, ancien fichier supprimé du bucket, nouveau `storage_path` en DB  
**Vérification** : L'ancien path ne répond plus dans Storage

## T-11 — get_signed_url : URL valide
**Méthode** : `docsRequest('get_signed_url', { id })` via broker CORE  
**Attendu** : `{ ok: true, url, expires_in: 900, file_name, file_type }`  
**Vérification** : URL accessible (GET) pendant < 15 min

## T-12 — get_signed_url : 404 si pas de fichier
**Méthode** : `get_signed_url` sur une fiche sans `storage_path`  
**Attendu** : `{ ok: false, error: "no_file_attached" }` HTTP 404

## T-13 — get_signed_url : 403 sans documents.read
**Méthode** : Session sans `documents.read`  
**Attendu** : `{ ok: false, error: "documents_read_forbidden" }` HTTP 403

## T-14 — Rollback Storage si DB échoue
**Méthode** : Simuler erreur DB après upload (ex: contrainte violée)  
**Attendu** : fichier supprimé du bucket, HTTP 500, aucun orphelin Storage

## T-15 — Aucun secret dans le navigateur
**Méthode** : Inspecter les requêtes réseau depuis DOCUMENTS_EMBEDDED.html  
**Attendu** : Aucune clé `service_role`, aucun `storage_path` brut exposé, upload via `window.parent.veraluzUploadDocument` seulement

## T-16 — 11 fiches PROD intactes
**Méthode** : `docsRequest('list')` avant et après déploiement  
**Attendu** : même count, même IDs, aucune donnée modifiée

## T-17 — Bucket non public
**Méthode** : Accès direct via URL publique du bucket  
**Attendu** : 403 ou 400 — aucun accès anonyme

---

## Résultats attendus (pré-déploiement)
Tous les tests T-01 à T-17 doivent passer avant merge vers main.
