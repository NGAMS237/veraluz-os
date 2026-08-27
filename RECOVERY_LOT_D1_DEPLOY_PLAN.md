# RECOVERY LOT D.1 — PLAN DE DÉPLOIEMENT

**Branche** : `claude/recovery-lot-d1-document-files`  
**Base main** : `02ee59e72a0cb01d84455d2573ebcca7820c2f08`  
**Contraintes** : Aucun merge vers main. Aucun déploiement PROD sans autorisation explicite.

---

## Périmètre des changements

| Fichier | Type | Description |
|---|---|---|
| `supabase/functions/veraluz-document-upload/index.ts` | Nouveau | EF upload fichiers |
| `supabase/functions/documents-secure/index.ts` | Modifié | + action `get_signed_url` |
| `VERALUZ_OS_CORE.html` | Modifié | + `window.veraluzUploadDocument` |
| `DOCUMENTS_EMBEDDED.html` | Modifié | UI upload/consult complet |

---

## Pré-requis

- [ ] 4 buckets privés créés dans Supabase Storage :
  - `veraluz-legal-private`
  - `veraluz-bank-private`
  - `veraluz-hr-private`
  - `veraluz-documents-private`
- [ ] Tous sans accès public (`allowedMimeTypes` non nul, `public: false`)
- [ ] `service_role` peut lire/écrire dans tous les buckets (par défaut)
- [ ] RLS `veraluz_documents` : DENY ALL confirme (pas de policy anon/authenticated)

## Étapes de déploiement (Blaise exécute en PROD)

### Étape 1 — Déployer `veraluz-document-upload`
```bash
supabase functions deploy veraluz-document-upload --project-ref dfdmasejsoibxrvubegu
```
Vérification : `GET /functions/v1/veraluz-document-upload` → HTTP 405 ou 401 (pas 404)

### Étape 2 — Déployer `documents-secure` (version mise à jour)
```bash
supabase functions deploy documents-secure --project-ref dfdmasejsoibxrvubegu
```
Vérification : `docsRequest('get_signed_url', {id: '<uuid-valide>'})` → `{ ok: false, error: 'no_file_attached' }` (attendu si pas de fichier)

### Étape 3 — Créer les buckets (si absents)
Via Supabase Dashboard > Storage :
- Créer chaque bucket listé ci-dessus
- Désactiver l'accès public pour chacun

### Étape 4 — Fast-forward branche vers main
```bash
# Vérifier main = 02ee59e7
git fetch origin
git log origin/main --oneline -1
# Fast-forward uniquement
git push origin claude/recovery-lot-d1-document-files:main --no-force
```

### Étape 5 — Vérification post-déploiement
- [ ] GitHub Pages build succeed (vérifier Actions)
- [ ] `docsRequest('list')` : 11 fiches toujours présentes
- [ ] Test upload fichier PDF via UI
- [ ] Test Consulter → URL signée s'ouvre
- [ ] Test remplacement fichier → pas de doublon
- [ ] Buckets : aucun accès public direct

---

## Rollback

Si erreur après déploiement EF :
```bash
supabase functions deploy veraluz-document-upload --project-ref dfdmasejsoibxrvubegu
# Re-déployer depuis le commit précédent ou restaurer le placeholder 503
```

Si erreur frontend :
```bash
git revert HEAD --no-edit
git push origin main
```

## Périmètre interdit (ne pas toucher)
- Migrations SQL (aucune migration dans ce lot)
- RLS policies existantes
- Données PROD (aucun INSERT/UPDATE/DELETE manuel)
- Buckets autres que les 4 listés
