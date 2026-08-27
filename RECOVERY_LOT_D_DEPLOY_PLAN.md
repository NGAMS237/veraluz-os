# RECOVERY LOT D — PLAN DE DÉPLOIEMENT DOCUMENTS/SSOT

**Statut** : PRÊT POUR DÉPLOIEMENT CIBLÉ  
**Auteur** : Claude (agent) — autorisé par Blaise 2026-08-27  
**Branche** : `claude/recovery-lot-d-documents-ssot`  
**Base** : `main @ 0afdb5c`

---

## Contexte

La table `veraluz_documents` existe en PROD depuis le prompt 019 mais n'a jamais été capturée dans le système de migrations Git. Elle contient 11 documents réels. Les 3 policies RLS portent le préfixe `dev_anon_*`, indiquant leur caractère provisoire de développement. La policy UPDATE a un `with_check = true` sans validation de données.

**Table canonique retenue** : `veraluz_documents`  
**Raison** : seule table avec des données réelles (11 lignes), utilisée par `DOCUMENTS_EMBEDDED.html` en production active.

---

## Fichier de migration

```
supabase/migrations/20260827_recovery_lot_d_documents_ssot.sql
```

### Ce que fait la migration (idempotente)

| Action | Mécanisme |
|---|---|
| Crée `veraluz_documents` si absente | `CREATE TABLE IF NOT EXISTS` |
| Ajoute les 4 index si absents | `CREATE INDEX IF NOT EXISTS` |
| Recrée la trigger function | `CREATE OR REPLACE FUNCTION` |
| Recrée le trigger | `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` |
| Active RLS | `ALTER TABLE ENABLE ROW LEVEL SECURITY` |
| Supprime les 3 policies `dev_anon_*` | `DROP POLICY IF EXISTS` |
| Crée 3 policies `prod_staff_*` | `CREATE POLICY` |
| Assure les GRANTs | `GRANT SELECT, INSERT, UPDATE` |

### Accès post-migration

**Aucune policy RLS anon ou authenticated.** RLS ON + zéro policy = default DENY ALL.
Tout accès passe par l'Edge Function `documents-secure` (service_role côté serveur).

| Canal | Résultat |
|---|---|
| REST direct anon key | 401 / 403 (REVOKE + RLS deny) |
| documents-secure sans session | 401 session_required |
| documents-secure session invalide | 401 invalid_or_expired_session |
| documents-secure non-gérant | 403 documents_access_forbidden |
| documents-secure gérant valide | 200 OK |

---

## Procédure de déploiement

### Prérequis

- [ ] Blaise autorise explicitement le déploiement PROD du Lot D
- [ ] `main` est à `0afdb5c` ou postérieur

### Étapes

```bash
# 1. Vérifier HEAD main avant déploiement
git ls-remote origin main

# 2. Appliquer la migration (sans BEGIN/COMMIT — fichier idempotent)
# Via Supabase MCP apply_migration depuis l'agent :
#   apply_migration(project_id='dfdmasejsoibxrvubegu',
#                  name='recovery_lot_d_documents_ssot',
#                  query=<contenu 20260827_recovery_lot_d_documents_ssot.sql>)

# 3b. Déployer documents-secure Edge Function
# Via Supabase MCP deploy_edge_function depuis l'agent :
#   deploy_edge_function(project_id='dfdmasejsoibxrvubegu',
#                        name='documents-secure',
#                        files=[index.ts, ../_shared/_rbac.ts])

# 3. Vérifier post-migration
# → COUNT(*) FROM veraluz_documents doit rester 11
# → pg_policies doit lister 3 policies prod_staff_* et 0 dev_anon_*
# → Trigger trg_veraluz_documents_updated_at doit exister
# → Les 4 index doivent exister

# 4. Test fonctionnel manuel (voir RECOVERY_LOT_D_TESTS.md)

# 5. Pas de déploiement Edge Function nécessaire
#    veraluz-document-upload reste placeholder (503) — inchangé
```

---

## Rollback

En cas de problème post-déploiement :

```sql
-- Restaure les 3 policies dev_anon_* et regrant anon (état PROD avant Lot D)
GRANT SELECT, INSERT, UPDATE ON public.veraluz_documents TO anon;

CREATE POLICY dev_anon_read_documents_metadata ON public.veraluz_documents
  FOR SELECT TO anon USING (true);

CREATE POLICY dev_anon_insert_documents ON public.veraluz_documents
  FOR INSERT TO anon WITH CHECK (
    confidentiality_level IN ('public','internal','confidential','restricted')
    AND status IN ('active','expired','archived','missing','pending_review')
  );

CREATE POLICY dev_anon_update_documents ON public.veraluz_documents
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Déployer l'ancienne version de DOCUMENTS_EMBEDDED.html via git revert
-- git revert <commit_bc8c9eb> --no-commit
```

Le rollback est rapide (DDL policies uniquement). Aucune donnée n'est affectée dans les deux sens.

---

## Hors périmètre Lot D

- `project_documents` — module Chantier/Appro, hors scope
- `veraluz_hr_documents` — module RH, couvert par Lot A
- Storage policies pour les buckets privés — dépend de l'activation de `veraluz-document-upload` (PROMPT 020+)
- Edge Function `veraluz-document-upload` — reste placeholder
- Toute fonctionnalité OCR, scan IA, QR code, bon de livraison, reçu thermique

---

## Compatibilité future

La colonne `related_record_id text` accepte déjà un identifiant libre. Quand `tenant_id` / `property_id` sera ajouté, ajouter une colonne nullable sans migration destructive.
