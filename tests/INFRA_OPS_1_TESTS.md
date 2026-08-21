# INFRA-OPS-1 — Tests & Cas de validation
Branche : `claude/settings-ssot-1a` | Commit : `INFRA-OPS-1` | Date : 2026-08-21

---

## Pré-requis
- Migration `20260821_infra_ops_1_events.sql` appliquée (veraluz_events + veraluz_event_jobs + veraluz_housekeeping)
- EF déployées : `event-worker`, `infra-health`
- EF mises à jour : `guest-access`, `reservation-workflow`

---

## Cas IO-1 — Migration idempotente

**Objectif :** Appliquer la migration deux fois sans erreur.

**Procédure :**
1. Appliquer `20260821_infra_ops_1_events.sql`
2. Réappliquer la même migration

**Attendu :** Aucune erreur SQL (toutes les tables et index utilisent `IF NOT EXISTS`).

---

## Cas IO-2 — emitEvent guest_service_requested (happy path)

**Objectif :** Un appel `create_service_request` via guest-access inscrit un événement et un job.

**Procédure :**
1. Client invité connecté (checkedin), appelle `create_service_request` avec `service_type='housekeeping'`
2. Vérifier la table `veraluz_events`

**Attendu :**
- 1 ligne dans `veraluz_events` avec `event_type='guest_service_requested'` et payload `{service_type:'housekeeping',...}`
- 1 ligne dans `veraluz_event_jobs` avec `handler='create_staff_notification'` et `status='pending'`
- La réponse HTTP `create_service_request` reste `201` (emit fire-and-forget, ne bloque pas)

---

## Cas IO-3 — Idempotence UNIQUE (event_id + handler)

**Objectif :** Un second `upsert` job avec le même `(event_id, handler)` est ignoré.

**Procédure :**
1. Déclencher `create_service_request` → event_id A créé, job J1 créé
2. Appeler `emitEvent` manuellement avec le même event_id A et handler `create_staff_notification` (ou via un retry manuel)

**Attendu :** Toujours 1 seul job pour (event_id=A, handler='create_staff_notification') — la contrainte UNIQUE absorbe le doublon.

---

## Cas IO-4 — event-worker : create_staff_notification (Proof #2)

**Objectif :** Le worker traite un job `create_staff_notification` et insère un message interne.

**Procédure :**
1. S'assurer qu'un job `{handler:'create_staff_notification', status:'pending'}` existe
2. Appeler `event-worker` en HTTP POST avec header `Authorization: Bearer <service_role_key>`
3. Vérifier `veraluz_internal_messages`

**Attendu :**
- Le job passe à `status='completed'`
- 1 ligne dans `veraluz_internal_messages` avec `recipient_type='department'`, `department='housekeeping'` (pour service_type='housekeeping'), `subject` contenant 'Demande de service'
- Réponse event-worker : `{ok:true, processed:1, completed:1}`

---

## Cas IO-5 — event-worker : create_housekeeping_task (Proof #1)

**Objectif :** Le checkout d'une réservation crée exactement une tâche ménage.

**Procédure :**
1. Staff appelle `reservation-workflow` avec `action='checkout'` sur une réservation en `checkedin`
2. Vérifier `veraluz_events`
3. Appeler `event-worker`
4. Vérifier `veraluz_housekeeping`

**Attendu :**
- `veraluz_events` : 1 ligne `event_type='guest_checked_out'` avec `unit_id` et `guest_name`
- `veraluz_event_jobs` : 1 job `handler='create_housekeeping_task'` → après worker : `status='completed'`
- `veraluz_housekeeping` : 1 ligne `task_type='checkout_clean'`, `priority='high'`, `source_event_id` = event_id ci-dessus
- Relancer le worker : aucun job supplémentaire créé (idempotent — UNIQUE constraint)

---

## Cas IO-6 — Idempotence checkout double

**Objectif :** Appeler deux fois le worker sur le même job ne crée pas deux tâches ménage.

**Procédure :**
1. Déclencher checkout → job pending
2. Appeler event-worker → job completed, 1 tâche ménage créée
3. Appeler event-worker une seconde fois

**Attendu :** Aucun nouveau job traité (le job est `completed`, non `pending`). Toujours 1 seule tâche ménage.

---

## Cas IO-7 — event-worker : retry + dead après max_attempts

**Objectif :** Un job qui échoue est retryé, puis marqué `dead` après 4 tentatives.

**Procédure :**
1. Insérer manuellement un job avec `handler='unknown_handler_xyz'`
2. Appeler event-worker 4 fois

**Attendu :**
- Tentatives 1–3 : `status='failed'` (revenu à `pending` entre chaque cycle pour retry)
- Tentative 4 : `status='dead'` (attempt=4, max_attempts=4 atteint)
- `last_error` contient `unknown_handler`

---

## Cas IO-8 — Sécurité event-worker : service_role requis

**Objectif :** L'invocation sans service_role est rejetée.

**Procédure :**
1. Appeler `event-worker` sans header `Authorization`
2. Appeler avec un JWT invité normal

**Attendu :** `{ok:false, error:'service_role_required'}` HTTP 403 dans les deux cas.

---

## Cas IO-9 — infra-health : accès gérant uniquement

**Objectif :** Un non-gérant ne peut pas accéder à l'observabilité.

**Procédure :**
1. Appeler `infra-health` avec un JWT employé dont le rôle est `receptionist`
2. Appeler avec un JWT gérant valide

**Attendu :**
- Réceptionniste : `{ok:false, error:'access_denied', hint:'gerant_only'}` HTTP 403
- Gérant : `{ok:true, checked_at:..., jobs:{counts:{...}}, events:{...}}`

---

## Cas IO-10 — infra-health : données lues sans secrets

**Objectif :** La réponse infra-health ne contient aucune donnée sensible.

**Procédure :**
1. Appeler `infra-health` en tant que gérant
2. Inspecter la réponse complète

**Attendu :**
- Présent : `jobs.counts`, `jobs.recent[].{id,handler,status,attempt,last_error,created_at}`, `events.recent[].{id,event_type,emitted_at,source_fn}`, `events.by_type`
- Absent : `payload` des événements (non sélectionné), `session_token`, `api_key`, `secret`, `password`, toute donnée guest personnelle non nécessaire au monitoring

---

## Cas IO-11 — EVENTBUS_EMBEDDED : onglet Durables DB

**Objectif :** L'onglet "Durables DB" affiche les données temps réel pour un gérant.

**Procédure :**
1. Ouvrir VERALUZ OS en tant que gérant
2. Naviguer vers Event Bus → onglet "Durables DB"

**Attendu :**
- KPI cards : pending / processing / completed / failed / dead avec valeurs réelles DB
- Tableau "Événements (24h) par type"
- Tableau "Jobs récents" (statuts colorés)
- Alerte rouge si des jobs dead existent
- Bouton "Rafraîchir" recharge les données

---

## Cas IO-12 — EVENTBUS_EMBEDDED : accès refusé non-gérant

**Objectif :** Un non-gérant voit un message d'accès refusé sur l'onglet Durables DB.

**Procédure :**
1. Ouvrir VERALUZ OS en tant que réceptionniste
2. Naviguer Event Bus → Durables DB

**Attendu :** Message "🔒 Accès réservé aux gérants." (pas d'erreur JS, pas de fuite de données)

---

## Récapitulatif

| ID   | Cas                                          | Statut |
|------|----------------------------------------------|--------|
| IO-1 | Migration idempotente                        | HUMAN  |
| IO-2 | emitEvent service_requested happy path       | HUMAN  |
| IO-3 | Idempotence UNIQUE (event_id + handler)      | HUMAN  |
| IO-4 | Worker create_staff_notification (Proof #2)  | HUMAN  |
| IO-5 | Worker create_housekeeping_task (Proof #1)   | HUMAN  |
| IO-6 | Idempotence checkout double                  | HUMAN  |
| IO-7 | Retry + dead après max_attempts              | HUMAN  |
| IO-8 | Sécurité event-worker service_role           | HUMAN  |
| IO-9 | infra-health RBAC gérant only                | HUMAN  |
| IO-10| infra-health pas de secrets                  | HUMAN  |
| IO-11| UI Durables DB affichage gérant              | HUMAN  |
| IO-12| UI accès refusé non-gérant                   | HUMAN  |

**HUMAN RETEST — Tous les cas nécessitent une validation humaine avec Supabase réel.**
