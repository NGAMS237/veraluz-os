# INFRA-OPS-1R — Tests & Cas de validation (Real Schema Hardening)
Branche : `claude/settings-ssot-1a` | Lot : INFRA-OPS-1R | Date : 2026-08-21

---

## Pré-requis
- Migration `20260821_infra_ops_1_events.sql` (INFRA-OPS-1) déjà appliquée
- Migration `20260821_infra_ops_1r_schema.sql` appliquée (ce lot)
- EF redéployées : `event-worker` (v1R), `infra-health` (v1R), `guest-access` (sans emitEvent), `reservation-workflow` (sans emitEvent)

---

## Cas IR-1 — Migration idempotente

**Objectif :** Appliquer `20260821_infra_ops_1r_schema.sql` deux fois sans erreur.

**Procédure :**
1. Appliquer la migration
2. Réappliquer

**Attendu :** Aucune erreur SQL (`IF NOT EXISTS`, `DO $$`, `ON CONFLICT DO NOTHING`, `DROP TRIGGER IF EXISTS`).

---

## Cas IR-2 — veraluz_events : schéma canonique

**Objectif :** Vérifier que les colonnes canoniques existent et les colonnes prototype ont disparu.

**Procédure :**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'veraluz_events' ORDER BY ordinal_position;
```

**Attendu :**
- Présent : `id`, `event_type`, `source`, `entity_type`, `entity_id`, `reservation_id`, `unit_id`, `actor_type`, `actor_id`, `payload`, `created_at`
- Absent : `tenant_id`, `source_fn`, `emitted_at`

---

## Cas IR-3 — RLS activé sur veraluz_events et veraluz_event_jobs

**Objectif :** Les tables ne sont pas accessibles directement via JWT invité ou employé standard.

**Procédure :**
1. Appeler Supabase avec un JWT JWT non service_role :
```sql
SELECT count(*) FROM veraluz_events;
SELECT count(*) FROM veraluz_event_jobs;
```

**Attendu :** Les deux requêtes retournent 0 lignes ou une erreur d'accès (politique `no_direct_access_*` restrictive).

---

## Cas IR-4 — claim_event_jobs : verrou atomique

**Objectif :** Deux appels simultanés à `claim_event_jobs` ne réclament pas les mêmes jobs.

**Procédure :**
1. Insérer 5 jobs `status='pending'` manuellement
2. Appeler `claim_event_jobs(5)` dans deux transactions concurrentes (ou deux appels HTTP simultanés à event-worker)
3. Compter le total de jobs réclamés

**Attendu :**
- Total réclamé = 5 (pas 10)
- Chaque job `status='processing'` exactement une fois
- Aucun doublon de `job.id` entre les deux résultats

---

## Cas IR-5 — claim_event_jobs : 0 jobs → worker ne traite rien

**Objectif :** Sans jobs pending, le worker retourne immédiatement.

**Procédure :**
1. S'assurer qu'il n'y a aucun job `status='pending'`
2. Appeler event-worker HTTP POST

**Attendu :** `{ok:true, processed:0}` sans erreur.

---

## Cas IR-6 — Trigger checkout → événement + job (atomique)

**Objectif :** Un checkout via reservation-workflow crée automatiquement un événement et un job sans emitEvent().

**Procédure :**
1. Staff appelle `reservation-workflow` action=`checkout` sur une réservation `checkedin`
2. Vérifier immédiatement :

```sql
SELECT * FROM veraluz_events WHERE event_type='guest_checked_out' ORDER BY created_at DESC LIMIT 1;
SELECT * FROM veraluz_event_jobs WHERE handler='create_housekeeping_task' ORDER BY created_at DESC LIMIT 1;
```

**Attendu :**
- 1 ligne `veraluz_events` : colonnes `source='reservation-workflow'`, `entity_type='reservation'`, `unit_id` renseigné
- 1 ligne `veraluz_event_jobs` : `handler='create_housekeeping_task'`, `status='pending'`
- Aucun import `emitEvent` côté EF (vérifiable dans le code déployé)

---

## Cas IR-7 — Trigger service request → événement + job (atomique)

**Objectif :** Un create_service_request via guest-access crée automatiquement l'événement via trigger.

**Procédure :**
1. Invité connecté (checkedin) appelle `create_service_request` avec `service_type='housekeeping'`
2. Vérifier :

```sql
SELECT * FROM veraluz_events WHERE event_type='guest_service_requested' ORDER BY created_at DESC LIMIT 1;
SELECT * FROM veraluz_event_jobs WHERE handler='create_staff_notification' ORDER BY created_at DESC LIMIT 1;
```

**Attendu :**
- 1 ligne `veraluz_events` : `source='guest-access'`, `actor_type='guest'`
- 1 ligne `veraluz_event_jobs` : `status='pending'`
- Réponse HTTP `201` (le trigger ne bloque pas le retour)

---

## Cas IR-8 — Idempotence housekeeping (source_event_id UNIQUE)

**Objectif :** Appeler event-worker deux fois sur le même job complété ne crée pas deux tâches ménage.

**Procédure :**
1. Déclencher checkout → 1 job pending
2. Appeler event-worker → job completed, 1 tâche créée dans `veraluz_housekeeping`
3. Insérer manuellement le même job avec `status='pending'` (même event_id, handler='create_housekeeping_task')
4. Appeler event-worker à nouveau

**Attendu :**
- Toujours 1 seule ligne dans `veraluz_housekeeping` pour cet `event_id`
- Le second upsert est absorbé par `ON CONFLICT (source_event_id) DO NOTHING`

---

## Cas IR-9 — Idempotence notification staff (source_event_job UNIQUE)

**Objectif :** Appeler event-worker deux fois pour `create_staff_notification` ne crée pas deux messages.

**Procédure :**
1. Déclencher service request → 1 job pending
2. Appeler event-worker → job completed, 1 message dans `veraluz_internal_messages`
3. Réinitialiser le job à `pending` manuellement
4. Appeler event-worker à nouveau

**Attendu :**
- Toujours 1 seule ligne dans `veraluz_internal_messages` avec le même `source_event_job`
- Le second upsert est absorbé par `ON CONFLICT (source_event_job) DO NOTHING`

---

## Cas IR-10 — event-worker : routing service_type

**Objectif :** Vérifier que `reception` et `other` mappent sur `reception` (pas `direction`).

**Procédure :**
1. Créer des demandes de service avec `service_type` = `reception` et `other`
2. Laisser event-worker traiter les jobs
3. Vérifier `department` dans `veraluz_internal_messages`

**Attendu :**
- `reception` → `department='reception'`
- `other` → `department='reception'`
- `housekeeping` → `department='housekeeping'`
- `maintenance` → `department='maintenance'`

---

## Cas IR-11 — infra-health : auth SHA-256 token_hash

**Objectif :** infra-health rejette une session invalide et accepte une session valide.

**Procédure :**
1. Appeler `infra-health` sans header X-Veraluz-Session → 401
2. Appeler avec un token invalide → 401
3. Appeler avec un token valide gérant → 200

**Attendu :**
- Sans token : `{ok:false, error:'auth_required'}` 401
- Token invalide : `{ok:false, error:'invalid_session'}` 401
- Token expiré : `{ok:false, error:'session_expired'}` 401
- Token révoqué : `{ok:false, error:'session_revoked'}` 401
- Gérant valide : `{ok:true, checked_at:..., jobs:{...}, events:{...}}` 200

---

## Cas IR-12 — infra-health : colonnes canoniques dans la réponse

**Objectif :** La réponse utilise `created_at` et `source` (pas `emitted_at`/`source_fn`).

**Procédure :**
1. Appeler `infra-health` en tant que gérant valide
2. Inspecter `events.recent[0]`

**Attendu :**
- Champs présents : `id`, `event_type`, `source`, `created_at`
- Champs absents : `emitted_at`, `source_fn`, `tenant_id`, `payload`, `session_token`, `api_key`

---

## Cas IR-13 — veraluz_housekeeping : colonnes canoniques

**Objectif :** L'insertion via event-worker utilise `type='cleaning'` (pas `task_type`).

**Procédure :**
1. Déclencher un checkout
2. Lancer event-worker
3. `SELECT type, task_label, scheduled_for FROM veraluz_housekeeping WHERE source_event_id = '<event_id>';`

**Attendu :**
- `type = 'cleaning'`
- `task_label = 'Nettoyage départ'`
- `scheduled_for` = date du jour (ISO)
- Pas de colonne `task_type`

---

## Récapitulatif

| ID    | Cas                                           | Statut |
|-------|-----------------------------------------------|--------|
| IR-1  | Migration idempotente                         | HUMAN  |
| IR-2  | veraluz_events schéma canonique               | HUMAN  |
| IR-3  | RLS activé events + event_jobs                | HUMAN  |
| IR-4  | claim_event_jobs verrou atomique              | HUMAN  |
| IR-5  | claim_event_jobs 0 jobs → no-op               | HUMAN  |
| IR-6  | Trigger checkout → événement + job            | HUMAN  |
| IR-7  | Trigger service request → événement + job     | HUMAN  |
| IR-8  | Idempotence housekeeping source_event_id      | HUMAN  |
| IR-9  | Idempotence notification source_event_job     | HUMAN  |
| IR-10 | Routing service_type → department correct     | HUMAN  |
| IR-11 | infra-health auth SHA-256 token_hash          | HUMAN  |
| IR-12 | infra-health réponse colonnes canoniques      | HUMAN  |
| IR-13 | Housekeeping type='cleaning' schéma réel      | HUMAN  |

**HUMAN RETEST — Tous les cas nécessitent une validation humaine avec Supabase réel.**
