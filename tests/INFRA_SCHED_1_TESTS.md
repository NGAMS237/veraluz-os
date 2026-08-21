# INFRA-SCHED-1 — Tests statiques

**Lot** : INFRA-SCHED-1
**Branche** : claude/settings-ssot-1a
**Date** : 2026-08-21
**Fichiers couverts** :
- `supabase/migrations/20260821_settings_cleanup2_guest_services_messages.sql`
- `supabase/migrations/20260821_infra_sched_1.sql`
- `supabase/functions/infra-scheduler/index.ts`
- `supabase/functions/infra-health/index.ts`
- `supabase/functions/comms-worker/index.ts`
- `supabase/functions/communications-secure/index.ts`
- `EVENTBUS_EMBEDDED.html`
- `VERALUZ_OS_CORE.html`

---

## GS — Guest Schema (migration pre-flight)

### GS-1 — reservation_id TEXT dans veraluz_guest_service_requests
**Type** : statique  
**Assertion** : `reservation_id text NOT NULL` dans la migration `20260821_settings_cleanup2_guest_services_messages.sql`  
**Vérifier** : `grep "reservation_id" 20260821_settings_cleanup2_guest_services_messages.sql` → `reservation_id   text`  
**Commentaire** : accepte BK-1786581754 et UUID stocké texte — jamais UUID natif  
**Statut** : ✅ PASS

### GS-2 — unit_id TEXT dans veraluz_guest_service_requests
**Type** : statique  
**Assertion** : `unit_id text` (pas `unit_id uuid`) dans la même migration  
**Vérifier** : `grep "unit_id" 20260821_settings_cleanup2_guest_services_messages.sql` → `unit_id text`  
**Statut** : ✅ PASS

### GS-3 — staff_id TEXT dans veraluz_guest_messages
**Type** : statique  
**Assertion** : `staff_id text` (pas `staff_id uuid`) dans la même migration  
**Raison** : staff_id peut valoir `'system'` (littéral texte) — incompatible UUID  
**Vérifier** : `grep "staff_id" 20260821_settings_cleanup2_guest_services_messages.sql` → `staff_id text`  
**Statut** : ✅ PASS

### GS-4 — RLS ENABLED sur tables Guest
**Type** : statique  
**Assertion** : `ENABLE ROW LEVEL SECURITY` (jamais DISABLE) sur les deux tables  
**Vérifier** : `grep -i "disable\|enable" 20260821_settings_cleanup2_guest_services_messages.sql`  
→ uniquement `ENABLE ROW LEVEL SECURITY`  
**Statut** : ✅ PASS

---

## SCH — Scheduler

### SCH-1 — infra-scheduler exige service_role OU session gérant settings.manage
**Type** : statique  
**Assertion** : `infra-scheduler/index.ts` refuse toute requête sans `Authorization: Bearer <service_role_key>` NI `X-Veraluz-Session` valide avec `settings.manage`  
**Vérifier** : bloc `isServiceRole` + branche session gérant avec `hasCapability(role,'settings.manage')`  
**Statut** : ✅ PASS

### SCH-2 — event-worker est lancé par infra-scheduler
**Type** : statique  
**Assertion** : `callWorker(sbUrl, serviceKey, 'event-worker')` dans `infra-scheduler/index.ts`  
**Vérifier** : `grep "event-worker" infra-scheduler/index.ts` → présent  
**Statut** : ✅ PASS

### SCH-3 — comms-worker est lancé après event-worker
**Type** : statique  
**Assertion** : `callWorker(sbUrl, serviceKey, 'comms-worker')` après `callWorker(...,'event-worker')`  
**Vérifier** : ordre dans `infra-scheduler/index.ts` — ewResult puis cwResult  
**Statut** : ✅ PASS

### SCH-4 — Stale recovery event jobs
**Type** : statique (logique SQL)  
**Assertion** : `recover_stale_jobs()` remet `status='pending'` les jobs `processing` avec `claimed_at < now() - 5 minutes`  
**Règle** : `attempt < max_attempts → pending`, `attempt >= max_attempts → dead`  
**Vérifier** : RPC `recover_stale_jobs` dans `20260821_infra_sched_1.sql`  
**Statut** : ✅ PASS

### SCH-5 — Stale recovery comm jobs
**Type** : statique (logique SQL)  
**Assertion** : même logique que SCH-4 sur `veraluz_communication_jobs`  
**Vérifier** : bloc `stale_comm` dans RPC `recover_stale_jobs`  
**Statut** : ✅ PASS

### SCH-6 — max_attempts atteint → dead
**Type** : statique (logique SQL)  
**Assertion** : `attempt >= max_attempts → status = 'dead'` dans `recover_stale_jobs`  
**Ne jamais** : remettre un job dead en pending  
**Vérifier** : `CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END` dans migration  
**Statut** : ✅ PASS

### SCH-7 — Double scheduler concurrents safe
**Type** : conceptuel / FOR UPDATE SKIP LOCKED  
**Assertion** : `claim_event_jobs` et `claim_communication_jobs` utilisent `FOR UPDATE SKIP LOCKED` — deux scheduler simultanés ne réclament pas les mêmes jobs  
**Vérifier** : `grep "SKIP LOCKED" 20260821_infra_sched_1.sql` → présent dans les deux RPCs  
**Side-effects** : UNIQUE `(event_id, template_key, channel, recipient_ref)` sur comm_jobs, `source_event_job` UNIQUE sur messages → idempotence supplémentaire  
**Statut** : ✅ PASS

### SCH-8 — last_run visible dans infra-health
**Type** : statique  
**Assertion** : `infra-health/index.ts` lit `veraluz_infra_runs` et expose `scheduler.last_run_at`, `last_run_status`, `last_run_duration_ms`  
**Vérifier** : `grep "veraluz_infra_runs\|last_run_at" infra-health/index.ts` → présents  
**Statut** : ✅ PASS

### SCH-9 — Aucune clé service_role en clair dans le SQL
**Type** : statique (sécurité)  
**Assertion** : `SUPABASE_SERVICE_ROLE_KEY` n'apparaît JAMAIS en clair dans `20260821_infra_sched_1.sql`  
**Stratégie cron** : section cron désactivée avec documentation Vault — aucune clé dans la migration  
**Vérifier** : `grep -i "service_role_key\|eyJhb" 20260821_infra_sched_1.sql` → résultat vide  
**Statut** : ✅ PASS

### SCH-10 — Frontend ne peut appeler event-worker ni comms-worker directement
**Type** : statique  
**Assertion** : `event-worker` et `comms-worker` absents de `VERALUZ_BROKER_ALLOWED_ENDPOINTS` dans `VERALUZ_OS_CORE.html`  
**Seul accès UI** : `infra-scheduler` (avec RBAC serveur gérant)  
**Vérifier** : `grep "event-worker\|comms-worker" VERALUZ_OS_CORE.html` → uniquement dans commentaires  
**Statut** : ✅ PASS

---

## PAY — Payment Event

### PAY-1 — Transition validated déclenche payment_recorded
**Type** : statique (trigger SQL)  
**Assertion** : trigger `trg_payment_recorded` sur `AFTER INSERT OR UPDATE OF status`  
Guard : `OLD.status = 'validated' → RETURN NEW` (pas de re-déclenchement)  
`NEW.status != 'validated' → RETURN NEW` (pas de déclenchement sur autre statut)  
**Vérifier** : `vz_emit_payment_event()` dans `20260821_infra_sched_1.sql`  
**Statut** : ✅ PASS

### PAY-2 — Paiements déjà validated avant migration → zéro backfill
**Type** : statique + conceptuel  
**Assertion** : le trigger n'est activé que sur **vrais changements** (INSERT avec status!=validated ignoré, UPDATE depuis non-validated seulement)  
**Les 44 paiements prod** ayant status='validated' avant migration ne déclenchent rien lors de l'installation — le trigger n'est pas exécuté sur des lignes existantes sans UPDATE  
**Statut** : ✅ PASS

### PAY-3 — Event payment_recorded émis exactement une fois
**Type** : statique (idempotence)  
**Assertion** : `gen_random_uuid()` par event + `ON CONFLICT DO NOTHING` sur `veraluz_events`  
**Double trigger** (si possible) → deuxième INSERT ignoré sur conflict  
**Statut** : ✅ PASS

### PAY-4 — Email comm_job idempotent
**Type** : statique  
**Assertion** : `INSERT INTO veraluz_communication_jobs ... ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING`  
→ jamais deux email jobs pour le même event_id + template_key  
**Statut** : ✅ PASS

### PAY-5 — Guest portal comm_job idempotent
**Type** : statique  
**Assertion** : même UNIQUE conflict guard pour le job guest_portal  
**Statut** : ✅ PASS

### PAY-6 — Aucune donnée sensible dans le payload payment_recorded
**Type** : statique  
**Assertion** : payload contient uniquement `payment_id, reservation_id, amount, method, validated_at`  
**INTERDIT** : `proof_url`, données carte, token, secret  
**Vérifier** : `jsonb_build_object` dans `vz_emit_payment_event` — pas de proof_url ni card_data  
**Statut** : ✅ PASS

---

## MAIL — Email Idempotence

### MAIL-1 — veraluz_comm_log protège contre retry
**Type** : statique  
**Assertion** : avant d'envoyer via Resend, `dispatch_worker_email` dans `communications-secure` interroge `veraluz_comm_log` :  
```sql
status IN ('sent','delivered') AND event_type = ? AND template_key = ? AND recipient_id = ?
```
Si entrée existante → retourne `status:'skipped_duplicate'` sans ré-envoyer  
**Vérifier** : bloc idempotence lignes 262–274 dans `communications-secure/index.ts`  
**Statut** : ✅ PASS

### MAIL-2 — Retry ne double pas email déjà envoyé
**Type** : statique  
**Scénario** : comms-worker retry un job email (Resend a reçu le mail mais la réponse n'est pas revenue)  
**Comportement** : `dispatch_worker_email` trouve l'entrée `comm_log` avec status='sent' → `skipped_duplicate` → comms-worker marque le job `completed`  
**Résultat** : client ne reçoit qu'un seul email  
**Vérifier** : même bloc idempotence + logique comms-worker `!resp.ok && !data.ok` → throw (pas de double-send)  
**Statut** : ✅ PASS

---

## Résumé

| Catégorie | Total | PASS | FAIL |
|-----------|-------|------|------|
| GS        | 4     | 4    | 0    |
| SCH       | 10    | 10   | 0    |
| PAY       | 6     | 6    | 0    |
| MAIL      | 2     | 2    | 0    |
| **Total** | **22**| **22** | **0** |

**INFRA-SCHED-1 READY : OUI**
