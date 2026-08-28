# RECOVERY LOT D.1 — TESTS (v2 hardened)

Quatre catégories : STATIQUE (exécuté en CI-like), PRÉ-DÉPLOIEMENT (avant mise en PROD),
POST-DÉPLOIEMENT (après EF déployées), MANUEL (à exécuter par Blaise).

Aucun résultat PASS live revendiqué avant déploiement réel.

---

## STATIQUE — vérifications sans déploiement

Ces vérifications ont été exécutées sur la branche `claude/recovery-lot-d1-hardening`
et les résultats sont réels.

| # | Vérification | Résultat |
|---|---|---|
| S-01 | `git diff --check` : aucun espace blanc parasite | PASS |
| S-02 | `storage_path` / `storage_bucket` absents de `DOCUMENTS_EMBEDDED.html` | PASS |
| S-03 | `SUPA_KEY` dans CORE = clé anon (`role:anon`), pas `service_role` | PASS |
| S-04 | `crypto.randomUUID()` utilisé pour le chemin Storage (upload EF) | PASS |
| S-05 | `revoked_at IS NULL` présent dans l'auth upload EF | PASS |
| S-06 | `expires_at > now` présent dans l'auth upload EF | PASS |
| S-07 | `ACTIVE_STATUSES` check employé présent dans upload EF | PASS |
| S-08 | Origine non autorisée → 403 dans upload EF | PASS (code) |
| S-09 | Ordre atomique : upload → DB CAS → rollback nouveau → suppression ancien | PASS (code) |
| S-10 | Réponse finale upload : pas de `storage_path` / `storage_bucket` | PASS |
| S-11 | `sanitizeDoc` retire `storage_path`/`storage_bucket` dans list/get | PASS |
| S-12 | Limites par bucket : legal=20 MB, bank=5 MB, hr/documents=10 MB | PASS (code) |
| S-13 | `hasOfficeSignature` vérifie DOCX (`wordprocessingml`) | PASS (code) |
| S-14 | `hasOfficeSignature` vérifie XLSX (`spreadsheetml`) | PASS (code) |
| S-15 | `has_file` utilisé dans DOCUMENTS_EMBEDDED.html (remplace `storage_path`) | PASS |

---

## PRÉ-DÉPLOIEMENT — à valider avant `supabase functions deploy`

Ces tests doivent passer en PROD avant tout déploiement EF.

| # | Vérification | Méthode |
|---|---|---|
| P-01 | 4 buckets privés existent : `veraluz-legal-private`, `veraluz-bank-private`, `veraluz-hr-private`, `veraluz-documents-private` | Supabase Dashboard > Storage |
| P-02 | Aucun bucket n'est en accès public | Vérifier `Public` = OFF pour chacun |
| P-03 | Colonne `revoked_at` présente dans `veraluz_employee_sessions` | `\d veraluz_employee_sessions` ou list_tables |
| P-04 | Colonne `status` présente dans `veraluz_employees` | idem |
| P-05 | `veraluz_documents` a les colonnes : `storage_bucket`, `storage_path`, `file_name`, `file_type`, `file_size` | idem |
| P-06 | 11 fiches PROD intactes : `SELECT count(*) FROM veraluz_documents` = 11 | SQL |
| P-07 | Aucune fiche a `status = 'synthétique'` ou données de test | SQL : `SELECT id FROM veraluz_documents WHERE title LIKE '%test%'` |

---

## POST-DÉPLOIEMENT — à exécuter après `supabase functions deploy`

Ces tests nécessitent les EF vivantes en PROD. Résultats à renseigner par Blaise.

| # | Test | Attendu | Résultat |
|---|---|---|---|
| D-01 | POST `/veraluz-document-upload` sans `X-Veraluz-Session` | HTTP 401 `{"ok":false,"error":"unauthorized"}` | — |
| D-02 | POST avec session révoquée (`revoked_at` non null) | HTTP 401 | — |
| D-03 | POST avec session expirée (`expires_at` passé) | HTTP 401 | — |
| D-04 | POST avec employé inactif (`status` ≠ actif/active) | HTTP 401 | — |
| D-05 | POST avec session valide, rôle sans `documents.manage` | HTTP 403 `documents_manage_forbidden` | — |
| D-06 | POST origin `https://evil.com` avec session valide | HTTP 403 `forbidden_origin` | — |
| D-07 | Upload fichier `.txt` (MIME `text/plain`) | HTTP 415 `invalid_file_type` | — |
| D-08 | Upload `.pdf` avec magic bytes non-PDF | HTTP 415 `invalid_file_content` | — |
| D-09 | Upload `.docx` sans chaîne `wordprocessingml` interne | HTTP 415 `invalid_file_content` | — |
| D-10 | Upload `.xlsx` sans chaîne `spreadsheetml` interne | HTTP 415 `invalid_file_content` | — |
| D-11 | Upload JPEG > 5 MB dans bucket `veraluz-bank-private` (cat `bank`) | HTTP 413 `file_too_large` | — |
| D-12 | Upload PDF valide, première fois, fiche sans fichier | HTTP 200 `{ok:true, has_file:true, file_name, file_type, file_size}` — pas de `storage_path` dans réponse | — |
| D-13 | `get_signed_url` sur la fiche D-12 | HTTP 200 `{ok:true, url, expires_in:900}` — URL accessible | — |
| D-14 | Remplacement : upload nouveau PDF sur même fiche | HTTP 200, ancien path absent du bucket, nouveau path en DB | — |
| D-15 | URL signée de l'ancien fichier (D-12) → inaccessible après D-14 | HTTP 400 ou 403 depuis Storage | — |
| D-16 | Accès public direct au bucket (URL sans signature) | HTTP 400/403 — bucket non public | — |
| D-17 | `docsRequest('list')` : réponse ne contient PAS `storage_path` ni `storage_bucket` | Champs absents des objets JSON | — |
| D-18 | `docsRequest('get', {id})` : même vérification | Champs absents | — |
| D-19 | 11 fiches PROD toujours présentes après tous tests | `SELECT count(*) FROM veraluz_documents` = 11 | — |

---

## MANUEL — à vérifier visuellement par Blaise

| # | Scénario | Attendu |
|---|---|---|
| M-01 | Ouvrir une fiche sans fichier dans DOCUMENTS_EMBEDDED.html | Bouton "Uploader un fichier" visible, "Consulter" absent |
| M-02 | Uploader un PDF valide | Barre de progression, message "Fichier enregistré ✓", "Consulter" apparaît |
| M-03 | Cliquer "Consulter" | Nouvel onglet avec le fichier (URL signée valide ≤ 15 min) |
| M-04 | Uploader un fichier trop grand | Message d'erreur clair, aucun crash UI |
| M-05 | Uploader un type non autorisé | Message d'erreur clair |
| M-06 | Inspecter les requêtes réseau | Aucun appel Storage direct depuis iframe, aucune clé visible |
| M-07 | Inspecter la réponse JSON du list | `storage_path` / `storage_bucket` absents |
