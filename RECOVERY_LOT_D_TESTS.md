# RECOVERY LOT D — TESTS CIBLÉS DOCUMENTS/SSOT

**Statut** : PRÊT (à exécuter après déploiement en PROD)  
**Auteur** : Claude (agent) — 2026-08-27

---

## 1. Tests techniques post-migration (SQL)

### 1.1 Table et structure

```sql
-- Vérifie que la table existe avec toutes les colonnes attendues
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='veraluz_documents'
ORDER BY ordinal_position;
-- Attendu : 21 colonnes (id → updated_at)

-- Vérifie les contraintes CHECK
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_schema='public'
  AND constraint_name IN ('veraluz_documents_confidentiality_check','veraluz_documents_status_check','veraluz_documents_storage_bucket_check');
-- Attendu : 3 contraintes présentes
```

### 1.2 Intégrité des données (aucune perte)

```sql
SELECT COUNT(*) AS total FROM public.veraluz_documents;
-- Attendu : 11 (inchangé)

-- Aucun document avec bucket non autorisé
SELECT COUNT(*) FROM public.veraluz_documents
WHERE storage_bucket IS NOT NULL
  AND storage_bucket NOT IN (
    'veraluz-documents-private','veraluz-bank-private',
    'veraluz-legal-private','veraluz-hr-private','veraluz-payslips-private'
  );
-- Attendu : 0
```

### 1.3 RLS — policies de production

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename='veraluz_documents'
ORDER BY policyname;
-- Attendu : 3 policies prod_staff_* uniquement
-- Aucune ligne dev_anon_*
```

### 1.4 Trigger

```sql
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table='veraluz_documents';
-- Attendu : trg_veraluz_documents_updated_at, UPDATE, BEFORE
```

### 1.5 Indexes

```sql
SELECT indexname FROM pg_indexes WHERE tablename='veraluz_documents' ORDER BY indexname;
-- Attendu : 5 index (pkey + 4 idx_veraluz_documents_*)
```

### 1.6 Test INSERT valide (nettoyer après)

```sql
BEGIN;
INSERT INTO public.veraluz_documents (title, category, confidentiality_level, status)
VALUES ('TEST_LOT_D_SYNTHETIQUE', 'test', 'internal', 'active')
RETURNING id;
-- Attendu : 1 ligne retournée avec UUID

SELECT COUNT(*) FROM public.veraluz_documents WHERE title='TEST_LOT_D_SYNTHETIQUE';
-- Attendu : 1
ROLLBACK;
-- Données synthétiques supprimées par ROLLBACK
```

### 1.7 Test INSERT avec bucket non autorisé (doit échouer)

```sql
BEGIN;
INSERT INTO public.veraluz_documents (title, category, storage_bucket)
VALUES ('TEST_BUCKET_INVALIDE', 'test', 'bucket-public-non-autorise');
-- Attendu : ERROR — violates check constraint veraluz_documents_storage_bucket_check
ROLLBACK;
```

### 1.8 Test UPDATE avec valeur invalide (doit échouer)

```sql
BEGIN;
UPDATE public.veraluz_documents
SET status = 'statut_inexistant'
WHERE id = (SELECT id FROM public.veraluz_documents LIMIT 1);
-- Attendu : ERROR — new row for relation violates check constraint
ROLLBACK;
```

### 1.9 Test DELETE bloqué par RLS

```sql
BEGIN;
SET ROLE anon;
DELETE FROM public.veraluz_documents WHERE id = (SELECT id FROM public.veraluz_documents LIMIT 1);
-- Attendu : 0 rows affected (bloqué par RLS — aucune policy DELETE)
RESET ROLE;
ROLLBACK;
```

---

## 2. Non-régressions relations (RH / Finance / Réservations)

Ces tables ne sont PAS touchées par Lot D. Vérification rapide :

```sql
-- Aucune FK depuis/vers veraluz_documents — normal
SELECT COUNT(*) FROM information_schema.referential_constraints
WHERE constraint_schema='public'
  AND (unique_constraint_name ILIKE '%document%' OR constraint_name ILIKE '%document%');
-- Attendu : 0 (couplage souple par related_module + related_record_id)

-- veraluz_hr_documents inchangé (Lot A)
SELECT relrowsecurity FROM pg_class WHERE relname='veraluz_hr_documents';
-- Attendu : true (RLS ON, 0 policies = default deny — correct)

-- project_documents inchangé (module Chantier)
SELECT COUNT(*) FROM public.project_documents;
-- Attendu : 0 (aucune donnée)
```

---

## 3. Checklist manuelle (Blaise)

À effectuer dans le navigateur après déploiement :

- [ ] Ouvrir `DOCUMENTS_EMBEDDED.html` — le module charge sans erreur 401/403
- [ ] Vérifier affichage desktop et mobile
- [ ] Basculer entre thème clair et sombre
- [ ] Ajouter un document synthétique (titre, catégorie, date expiration)
  - [ ] Confirmer qu'il apparaît dans "Tous les documents" et "Récents"
- [ ] Modifier le document synthétique (changer statut ou notes)
  - [ ] Confirmer que `updated_at` est mis à jour
- [ ] Archiver le document synthétique
  - [ ] Confirmer qu'il passe au statut `archived`
- [ ] Vérifier que le bouton Supprimer est absent ou bloqué
- [ ] Supprimer manuellement la donnée synthétique via l'interface ou SQL
  ```sql
  DELETE FROM public.veraluz_documents WHERE title ILIKE '%synthétique%' OR title ILIKE '%test%';
  ```
- [ ] Confirmer que les 11 documents originaux sont toujours présents

---

## 4. git diff --check

```bash
cd /path/to/veraluz-os
git diff --check claude/recovery-lot-d-documents-ssot
# Attendu : aucune sortie (pas de whitespace errors)
```
