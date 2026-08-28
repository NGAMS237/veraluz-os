# RECOVERY LOT E — Plan de déploiement

**Branche:** `claude/recovery-lot-e-settings-events-comms-scheduler`
**Statut:** PRÊT POUR REVUE — aucun déploiement sans autorisation explicite de Blaise

---

## Séparation automatisé / manuel / non-opérationnel

### ✅ Automatisé (tests CI locaux)
- 49 tests Node.js — PASS
- Validation migration (Python dry-run)
- Vérification absence de `.select('name, number')`, EmailJS direct, localStorage SSOT

### 🔍 Dry-run SQL (à exécuter manuellement dans Supabase SQL Editor)
Fichier: `supabase/migrations/20260828_dry_run_preview.sql`

```sql
-- Coller dans l'éditeur SQL Supabase Studio
-- Vérifier les RAISE NOTICE dans l'onglet "Messages"
-- Le ROLLBACK final annule tout — aucun changement persisté
```

Résultats attendus:
- `[DRY-RUN] TABLE OK: notification_reads`
- `[DRY-RUN] TABLE OK: veraluz_event_processing`
- `[DRY-RUN] UNIQUE idempotency_key OK`
- `[DRY-RUN] UNIQUE notification_reads(notification_id,employee_id) OK`
- `[DRY-RUN] claim_job_lease refuse (job disabled) OK: job_disabled`
- `[DRY-RUN] UNIQUE violation idempotency_key OK`
- `[DRY-RUN] TOUTES LES VERIFICATIONS PASS`

### 📋 Post-déploiement (manuel, après autorisation)
1. **Migration SQL** — appliquer `20260828_recovery_lot_e_events_notifications_jobs.sql`
2. **Edge Functions** — déployer `notifications-secure`
3. **Edge Functions** — redéployer `guest-access` (fix `.select('name')`)
4. **Edge Functions** — redéployer `settings-secure` si WRITABLE_KEYS modifiés
5. **Whitelist CORE** — déjà dans la branche (`notifications-secure` ajouté)
6. **GitHub Pages** — push vers main uniquement après validation

### 🏗️ Foundation-ready, non-opérationnel
Les composants suivants sont présents dans le schéma mais **non actifs** en PROD :
- `veraluz_jobs` — `enabled=false`, `dry_run=true`, aucun cron
- `claim_job_lease()` / `release_job_lease()` / `recover_expired_job_leases()` — déployées mais non appelées
- `notifications-secure` — EF prête, `_NOTIF_DEMO_MODE=true` dans le frontend jusqu'à validation
- `veraluz_event_processing` — schéma prêt, aucun worker actif (pg_cron absent)

---

## Clé admin — documentation

**Localisation:** `VERALUZ_OS_CORE.html` — variable `SUPA_KEY` (clé anon publique)
**Rôle actuel:** anon (lecture publique limitée par RLS)
**Usage:** appels REST depuis le navigateur via le broker CORE
**Risque:** exposition normale d'une clé anon — contrôlée par RLS
**PAS service_role:** `service_role` n'est jamais dans le frontend ✅
**Plan de migration:** La clé anon peut être rotée dans les paramètres Supabase si compromise. Les Edge Functions utilisent `SUPABASE_SERVICE_ROLE_KEY` via `Deno.env` uniquement.

---

## Ordre de déploiement recommandé

```
1. Revue de code branche (Blaise)
2. Dry-run SQL (Supabase Editor)
3. Autorisation explicite de Blaise
4. Migration SQL → PROD
5. Deploy notifications-secure EF
6. Redeploy guest-access EF
7. Fast-forward branche → main (GitHub Pages)
8. Tests visuels desktop/mobile clair/sombre (Blaise)
9. Activer notifications-secure en frontend (_NOTIF_DEMO_MODE = false) après validation
```

---

## Contraintes permanentes (verbatim)
- aucun déploiement Supabase sans autorisation
- aucune migration PROD sans autorisation
- aucun merge ou fast-forward vers main sans autorisation
- aucune donnée cliente modifiée
- aucune communication réelle envoyée
- aucun cron activé
- service_role JAMAIS dans le frontend
- session transmise uniquement par le broker CORE
- Blaise effectuera les tests visuels desktop/mobile/clair/sombre
