# RECOVERY LOT D — TESTS CIBLÉS DOCUMENTS/SSOT (v2 — post revue sécurité)

**Statut** : PRÊT (à exécuter après déploiement en PROD)
**Auteur** : Claude (agent) — 2026-08-27

---

## 1. Tests SQL post-migration

### 1.1 Intégrité des données (aucune perte)

```sql
SELECT COUNT(*) AS total FROM public.veraluz_documents;
-- Attendu : 11 (inchangé)
```

### 1.2 Policies : zéro policy anon/authenticated

```sql
SELECT policyname, roles, cmd
FROM pg_policies WHERE tablename='veraluz_documents'
ORDER BY policyname;
-- Attendu : 0 lignes (RLS ON + default DENY ALL)
```

### 1.3 Privileges directs : anon bloqué

```sql
SELECT has_table_privilege('anon','public.veraluz_documents','SELECT') AS anon_select;
SELECT has_table_privilege('anon','public.veraluz_documents','INSERT') AS anon_insert;
SELECT has_table_privilege('anon','public.veraluz_documents','UPDATE') AS anon_update;
-- Attendu : false / false / false
```

### 1.4 Constraints check

```sql
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_schema='public' AND table_name='veraluz_documents'
  AND constraint_name IN (
    'veraluz_documents_confidentiality_check',
    'veraluz_documents_status_check',
    'veraluz_documents_storage_bucket_check');
-- Attendu : 3 lignes
```

### 1.5 Trigger

```sql
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers WHERE event_object_table='veraluz_documents';
-- Attendu : trg_veraluz_documents_updated_at, UPDATE, BEFORE
```

### 1.6 Indexes

```sql
SELECT indexname FROM pg_indexes WHERE tablename='veraluz_documents' ORDER BY indexname;
-- Attendu : 5 (pkey + 4 idx_*)
```

---

## 2. Tests comportementaux : REST anon direct fermé

### 2.1 Lire sans session (doit échouer 401/403)

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  "https://dfdmasejsoibxrvubegu.supabase.co/rest/v1/veraluz_documents?select=id"
# Attendu : 401 ou 403
```

### 2.2 Insérer sans session (doit échouer)

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"title":"TEST","category":"other"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/rest/v1/veraluz_documents"
# Attendu : 401 ou 403
```

---

## 3. Tests documents-secure (session réelle)

### 3.1 Session absente → 401

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"action":"list"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":false,"error":"session_required"}
```

### 3.2 Session invalide → 401

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: tok_invalide_00000000" \
  -d '{"action":"list"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":false,"error":"invalid_or_expired_session"}
```

### 3.3 session_token dans le body → 400

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_VALIDE>" \
  -d '{"action":"list","session_token":"foo"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":false,"error":"session_token_in_body_forbidden"}
```

### 3.4 Employé non-gérant → 403

```bash
# Utiliser un token d'employé non-gérant (livreur, barman, etc.)
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_NON_GERANT>" \
  -d '{"action":"list"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":false,"error":"documents_access_forbidden"}
```

### 3.5 Gérant valide → liste

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_GERANT>" \
  -d '{"action":"list"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":true,"documents":[...]} avec 11 entrées
```

### 3.6 Gérant — créer un document synthétique

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_GERANT>" \
  -d '{"action":"create","title":"TEST_LOT_D_SYNTHÉTIQUE","category":"other"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":true,"document":{"id":"...","title":"TEST_LOT_D_SYNTHÉTIQUE",...}}
# Vérifier : storage_bucket = "veraluz-documents-private" (dérivé serveur-side)
# Vérifier : uploaded_by = actor.id (jamais fourni par le client)
```

### 3.7 Champs non autorisés rejetés

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_GERANT>" \
  -d '{"action":"create","title":"T","category":"other","uploaded_by":"hacker","storage_bucket":"bucket-public"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":false,"error":"unexpected_fields","fields":["uploaded_by","storage_bucket"]}
```

### 3.8 Aucune suppression définitive

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_GERANT>" \
  -d '{"action":"delete","id":"<UUID>"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":false,"error":"unknown_action","action":"delete"}
```

### 3.9 Modifier + vérifier updated_at

```bash
# update action sur l'ID du document synthétique créé en 3.6
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_GERANT>" \
  -d '{"action":"update","id":"<UUID>","notes":"test note"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":true,"document":{"updated_at":"..."}}
# Vérifier : updated_at > created_at
```

### 3.10 Archiver le document synthétique

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -H "x-veraluz-session: <TOKEN_GERANT>" \
  -d '{"action":"archive","id":"<UUID>"}' \
  "https://dfdmasejsoibxrvubegu.supabase.co/functions/v1/documents-secure"
# Attendu : {"ok":true,"document":{"status":"archived"}}
```

### 3.11 Nettoyer la donnée synthétique (service_role ou via test SQL)

```sql
DELETE FROM public.veraluz_documents WHERE title='TEST_LOT_D_SYNTHÉTIQUE';
SELECT COUNT(*) FROM public.veraluz_documents;
-- Attendu : 11 documents originaux intacts
```

---

## 4. Vrai dry-run ROLLBACK — migration externe

```sql
BEGIN;
\i supabase/migrations/20260827_recovery_lot_d_documents_ssot.sql
SELECT COUNT(*) FROM public.veraluz_documents; -- doit être 11
ROLLBACK;
-- Vérifier post-ROLLBACK que les 3 policies dev_anon_* sont revenues
SELECT COUNT(*) FROM pg_policies WHERE tablename='veraluz_documents';
-- Attendu : 3 (dev_anon_* restaurées par le ROLLBACK)
```

---

## 5. Non-régressions relations

```sql
-- Aucune FK depuis/vers veraluz_documents — couplage souple correct
SELECT COUNT(*) FROM information_schema.referential_constraints
WHERE constraint_schema='public' AND constraint_name ILIKE '%document%';
-- Attendu : 0

-- veraluz_hr_documents : RLS ON, 0 policy (default deny) — inchangé
SELECT relrowsecurity FROM pg_class WHERE relname='veraluz_hr_documents';
-- Attendu : true

-- project_documents : hors scope Lot D — inchangé
SELECT COUNT(*) FROM public.project_documents;
-- Attendu : 0
```

---

## 6. Checklist manuelle (Blaise)

- [ ] Ouvrir `DOCUMENTS_EMBEDDED.html` depuis VERALUZ_OS_CORE — module charge sans erreur
- [ ] Vérifier desktop et mobile
- [ ] Tester clair et sombre
- [ ] Ajouter un document synthétique — vérifier que `uploaded_by` et `storage_bucket` sont correctement définis côté serveur
- [ ] Modifier le document (changer statut ou notes)
- [ ] Archiver le document synthétique
- [ ] Vérifier que DELETE est absent ou bloqué
- [ ] Ouvrir `DOCUMENTS_EMBEDDED.html` en dehors du CORE (onglet direct) — doit afficher le message d'indisponibilité
- [ ] Supprimer la donnée synthétique
- [ ] Confirmer que les 11 documents originaux sont intacts

---

## 7. git diff --check

```bash
git diff --check claude/recovery-lot-d-documents-ssot
# Attendu : aucune sortie (pas de whitespace errors)
```
