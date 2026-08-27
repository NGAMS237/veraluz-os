# RECOVERY LOT D — TESTS CIBLES DOCUMENTS/SSOT (v3)

**Statut** : PRET — migration et Edge Function prets pour deploiement PROD
**Auteur** : Claude (agent) — 2026-08-27

> **Legende des statuts de test :**
> - `[STATIQUE — analyse du code]` : verifie par lecture du code source uniquement, sans execution
> - `[DRY-RUN SQL — execute en sandbox]` : SQL execute dans une transaction BEGIN/ROLLBACK hors PROD
> - `[POST-DEPLOIEMENT — a executer apres deploy]` : requiert que la migration et/ou l EF soit deployee en PROD
> - `[MANUEL — checklist Blaise]` : verification humaine dans le navigateur

---

## 1. Edge Function : documents-secure

### 1.1 reviewed_by rejete en creation et modification [STATIQUE — analyse du code]

Verification par lecture de `supabase/functions/documents-secure/index.ts` :

- `CREATE_ALLOWED` ne contient pas `reviewed_by` → tout body de creation incluant `reviewed_by` retourne `unexpected_fields` (400)
- `UPDATE_ALLOWED` ne contient pas `reviewed_by` → tout body de modification incluant `reviewed_by` retourne `unexpected_fields` (400)
- `uploaded_by` et `storage_bucket` absents des deux listes → toujours rejetes du client
- `storage_bucket` et `uploaded_by` calcules cote serveur uniquement (`actor.id`, `CAT_BUCKETS[category]`)

**Resultat** : PASS (statique)

### 1.2 session_token dans le body refuse [STATIQUE — analyse du code]

```typescript
if ('session_token' in body) {
  return json({ ok: false, error: 'session_token_in_body_forbidden' }, 400, origin);
}
```

**Resultat** : PASS (statique)

### 1.3 Erreurs sans detail PostgreSQL [STATIQUE — analyse du code]

Verification : aucun `detail: error.message` ni `error.message` retourne au client.
Reponses stables : `create_failed` / `update_failed` / `archive_failed` (500).
Logs serveur uniquement : `console.error('[documents-secure] ... code=%s msg=%s', ...)`.

**Resultat** : PASS (statique)

### 1.4 Validation UUID avant requete DB [STATIQUE — analyse du code]

```typescript
function isValidUUID(v: unknown): boolean {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
```

Applique aux actions `get`, `update`, `archive` avant tout appel DB.
ID invalide → `{ ok: false, error: 'invalid_id' }` (400).

**Resultat** : PASS (statique)

### 1.5 Validation des dates [STATIQUE — analyse du code]

`parseDate()` retourne :
- `{ ok: true, value: null }` pour null / undefined / chaine vide (efface la date)
- `{ ok: true, value: 'YYYY-MM-DD' }` pour format valide
- `{ ok: false }` → 400 `invalid_date` pour tout autre format

Les dates invalides ne sont jamais silencieusement mises a null.

**Resultat** : PASS (statique)

### 1.6 Test fonctionnel EF — list, create, update, archive [POST-DEPLOIEMENT — a executer apres deploy]

```bash
# Remplacer SESSION_TOKEN par un token gerant valide
# Remplacer PROJECT_REF par la reference du projet Supabase

BASE="https://<PROJECT_REF>.supabase.co/functions/v1/documents-secure"
TOKEN="<SESSION_TOKEN>"

# LIST
curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"list"}' | jq .ok
# Attendu : true

# CREATE
DOC_ID=$(curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"create","title":"TEST_LOT_D_v3","category":"other"}' \
  | jq -r .document.id)
echo "created: $DOC_ID"
# Attendu : UUID valide

# CREATE avec reviewed_by (doit echouer)
curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"create","title":"T","category":"other","reviewed_by":"hacker"}' | jq .error
# Attendu : "unexpected_fields"

# UPDATE avec date invalide (doit echouer)
curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"update\",\"id\":\"$DOC_ID\",\"expiry_date\":\"not-a-date\"}" | jq .error
# Attendu : "invalid_date"

# UPDATE avec date nulle (doit effacer)
curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"update\",\"id\":\"$DOC_ID\",\"expiry_date\":null}" | jq .ok
# Attendu : true

# UUID invalide (doit echouer)
curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"get","id":"pas-un-uuid"}' | jq .error
# Attendu : "invalid_id"

# ARCHIVE
curl -s -X POST "$BASE" \
  -H "x-veraluz-session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"archive\",\"id\":\"$DOC_ID\"}" | jq .document.status
# Attendu : "archived"
```

**Statut** : EN ATTENTE — a executer apres `supabase functions deploy documents-secure`

### 1.7 Acces REST direct bloque (anon) [POST-DEPLOIEMENT — a executer apres deploy]

```bash
# Remplacer ANON_KEY et PROJECT_REF
curl -s \
  "https://<PROJECT_REF>.supabase.co/rest/v1/veraluz_documents?limit=1" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>"
# Attendu : [] ou erreur 401/403 (RLS DENY ALL pour anon)
```

**Statut** : EN ATTENTE — a executer apres application de la migration

---

## 2. Migration SQL

### 2.1 Ordre CREATE TABLE avant pre-flight [STATIQUE — analyse du code]

Structure verifiee dans `20260827_recovery_lot_d_documents_ssot.sql` :
1. `CREATE TABLE IF NOT EXISTS` (section 1)
2. `DO $$ ... IF tbl_exists THEN ... END IF; $$` pre-flight (section 2)
3. `ADD CONSTRAINT IF NOT EXISTS` (section 3)
4. Indexes, trigger, RLS, REVOKE, GRANT (sections 4-8)

**Resultat** : PASS (statique)

### 2.2 Dry-run PROD (11 docs) [DRY-RUN SQL — execute en sandbox]

```sql
BEGIN;
-- Simuler l etat PROD : table existante avec 11 lignes (toutes valides)
\i supabase/migrations/20260827_recovery_lot_d_documents_ssot.sql
SELECT COUNT(*) AS total FROM public.veraluz_documents; -- attendu : 11
SELECT COUNT(*) AS anon_can_select
FROM pg_policies
WHERE tablename='veraluz_documents' AND roles::text LIKE '%anon%'; -- attendu : 0
ROLLBACK;
```

**Resultat** : PASS — execute en dry-run, 11 lignes intactes, 0 policies anon

### 2.3 Dry-run install fraiche (table absente) [STATIQUE — analyse du code]

Sur base vierge (table absente avant migration) :
- `CREATE TABLE IF NOT EXISTS` cree la table
- Le pre-flight lit `tbl_exists = true` (table vient d etre creee) mais `COUNT=0` sur toutes les verifications → aucune exception
- Contraintes, indexes, trigger, RLS, REVOKE/GRANT appliques normalement

**Resultat** : PASS (statique — logique verifiee dans le DO block)

### 2.4 Idempotence (2e execution) [STATIQUE — analyse du code]

- `CREATE TABLE IF NOT EXISTS` → no-op
- Pre-flight `COUNT=0` sur table vide (ou donnees valides) → pas d exception
- `ADD CONSTRAINT IF NOT EXISTS` → no-op
- `CREATE INDEX IF NOT EXISTS` → no-op
- `CREATE OR REPLACE FUNCTION` → remplace proprement
- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` → idempotent
- `ALTER TABLE ENABLE ROW LEVEL SECURITY` → idempotent
- `DROP POLICY IF EXISTS` → no-op si absente
- `REVOKE` / `GRANT` → idempotents

**Resultat** : PASS (statique)

### 2.5 Pas de BEGIN/COMMIT interne [STATIQUE — analyse du code]

Aucun `BEGIN` ni `COMMIT` dans le fichier de migration.
Le dry-run externe peut envelopper avec `BEGIN; ... ROLLBACK;` sans conflit.

**Resultat** : PASS (statique)

---

## 3. DOCUMENTS_EMBEDDED.html

### 3.1 Aucun appel REST direct [STATIQUE — analyse du code + grep confirme]

```bash
grep -c "sbGet\|sbPost\|sbPatch\|apikey.*SB_KEY\|Authorization.*Bearer.*SB_KEY" DOCUMENTS_EMBEDDED.html
# Resultat : 0

grep -n "SB_KEY\|SB_URL\|sbGet\|sbPost\|sbPatch" DOCUMENTS_EMBEDDED.html
# Seul resultat : commentaire ligne 877
# "Plus de cle anon ni d appel REST direct a veraluz_documents"
```

Tout passe par `window.parent.veraluzSecureRequest('documents-secure', ...)`.

**Resultat** : PASS (grep execute, 0 occurrence)

### 3.2 VERALUZ Signature tokens presents [STATIQUE — analyse du code]

`:root` contient `--vlz-ocean`, `--vlz-gold`, `--vlz-radius-md`, etc.

**Resultat** : PASS (statique)

---

## 4. git diff --check [STATIQUE — a executer avant push]

```bash
cd /path/to/veraluz-os
git diff --check claude/recovery-lot-d-documents-ssot
# Attendu : aucune sortie (pas de whitespace errors)
```

---

## 5. Checklist manuelle post-deploiement [MANUEL — checklist Blaise]

A effectuer dans le navigateur apres deploiement complet (migration + EF) :

- [ ] Ouvrir `DOCUMENTS_EMBEDDED.html` — le module charge sans erreur 401/403
- [ ] Vérifier affichage desktop et mobile
- [ ] Basculer entre theme clair et sombre
- [ ] Ajouter un document synthetique (titre, categorie, date expiration)
  - [ ] Confirmer apparition dans "Tous les documents" et "Recents"
- [ ] Modifier le document (changer statut ou notes)
  - [ ] Confirmer que `updated_at` est mis a jour
- [ ] Archiver le document synthetique
  - [ ] Confirmer statut `archived`
- [ ] Confirmer absence du bouton Supprimer
- [ ] Supprimer manuellement la donnee synthetique :
  ```sql
  DELETE FROM public.veraluz_documents WHERE title ILIKE '%synthetique%' OR title ILIKE '%test%';
  ```
- [ ] Confirmer que les 11 documents originaux sont toujours presents
