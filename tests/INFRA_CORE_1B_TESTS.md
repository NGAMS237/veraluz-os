# INFRA-CORE-1B + INFRA-COMMS-1B — Tests & Cas de validation
Branche : `claude/settings-ssot-1a` | Lot : INFRA-CORE-1B | Date : 2026-08-21

---

## Pré-requis
- Migrations INFRA-CORE-1B appliquées dans l'ordre :
  1. `20260821_infra_ops_1_events.sql`
  2. `20260821_infra_ops_1r_schema.sql`
  3. `20260821_infra_comms_1a.sql`
- EF déployées : `event-worker`, `comms-worker`, `infra-health`, `communications-secure`
- `veraluz_comm_templates` contient les seeds pour `booking_confirmation/internal`, `checkin_welcome/guest_portal`

---

## SA-1 — Migration 1 : schéma veraluz_events canonique

**Objectif :** Les colonnes correspondent au contrat canonique (pas de tenant_id, emitted_at, source_fn).

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'veraluz_events' ORDER BY ordinal_position;
```

**Attendu :** Colonnes : id, event_type, payload, source, entity_type, entity_id,
reservation_id, unit_id, actor_type, actor_id, created_at.
AUCUNE des colonnes tenant_id / emitted_at / source_fn.

---

## SA-2 — Migration 1 : veraluz_event_jobs — updated_at + RLS

**Objectif :** La table a `updated_at` et RLS ENABLED.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'veraluz_event_jobs';

SELECT rowsecurity FROM pg_tables WHERE tablename = 'veraluz_event_jobs';
```

**Attendu :** `updated_at` présent. `rowsecurity = true`.

---

## SA-3 — Migration 1 : veraluz_housekeeping — colonnes ajoutées, RLS actif

**Objectif :** Seules les colonnes `reservation_id` et `source_event_id` sont ajoutées.
Aucune erreur de conflit de schéma (la table préexistante est préservée).

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'veraluz_housekeeping';
SELECT rowsecurity FROM pg_tables WHERE tablename = 'veraluz_housekeeping';
```

**Attendu :** `reservation_id` (text) et `source_event_id` (uuid) présents. `rowsecurity = true`.

---

## SA-4 — Migration 2 : claim_event_jobs incrémente attempt

**Objectif :** `claim_event_jobs` passe `status='processing'` ET incrémente `attempt`.

```sql
-- Insérer un job manuel
INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts)
VALUES ('<valid_event_uuid>', 'test_handler', 'pending', 0, 4)
RETURNING id;

-- Réclamer
SELECT * FROM claim_event_jobs(1);
```

**Attendu :** Le job retourné a `status='processing'` et `attempt=1`.

---

## SA-5 — Trigger vz_emit_reservation_event : client_name (pas veraluz_guests)

**Objectif :** Le trigger utilise `NEW.client_name` directement (pas de JOIN sur une table inexistante).

**Procédure :**
1. Mettre à jour une réservation : `status = 'confirmed'`
2. Vérifier `veraluz_events` :

```sql
SELECT payload FROM veraluz_events
WHERE event_type = 'reservation_confirmed'
ORDER BY created_at DESC LIMIT 1;
```

**Attendu :**
- `payload.guest_name` = valeur de `veraluz_reservations.client_name` (pas NULL, pas d'erreur de JOIN)
- `payload.client_email` présent
- `payload.guest_id` = valeur de `client_id`

---

## SA-6 — Trigger vz_emit_service_request_event : guest_session_id + note

**Objectif :** Le trigger utilise `NEW.guest_session_id` (pas `NEW.guest_id`) et `NEW.note` (pas `NEW.notes`).

**Procédure :**
1. Insérer une demande de service (checkedin)
2. Vérifier :

```sql
SELECT payload FROM veraluz_events
WHERE event_type = 'guest_service_requested'
ORDER BY created_at DESC LIMIT 1;
```

**Attendu :**
- `actor_id` = `guest_session_id` de la demande
- `payload.note` = contenu de la note (pas `notes`)
- Pas d'erreur `column guest_id does not exist`

---

## SA-7 — veraluz_communication_templates N'EXISTE PAS

**Objectif :** La migration ne crée PAS de table doublon. La SSOT est `veraluz_comm_templates`.

```sql
SELECT to_regclass('public.veraluz_communication_templates');
```

**Attendu :** Retourne `NULL` (table inexistante). Seule `veraluz_comm_templates` existe.

---

## SA-8 — veraluz_communication_jobs utilise template_key

**Objectif :** La table a la colonne `template_key` (pas `template_code`).

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'veraluz_communication_jobs';
```

**Attendu :** `template_key` présent. `template_code` absent.
UNIQUE sur `(event_id, template_key, channel, recipient_ref)` présent.

---

## SA-9 — veraluz_comm_templates channel étendu à guest_portal

**Objectif :** On peut insérer des templates avec `channel='guest_portal'`.

```sql
INSERT INTO veraluz_comm_templates
  (tenant_id, template_key, name, audience, event_type, channel, locale,
   subject_template, body_template, active)
VALUES ('veraluz-001','test_portal','Test','guest','test','guest_portal','fr','Sujet','Corps',false)
ON CONFLICT DO NOTHING;
```

**Attendu :** Insertion réussie, pas d'erreur CHECK constraint.
Nettoyer après test : `DELETE FROM veraluz_comm_templates WHERE template_key='test_portal';`

---

## SA-10 — veraluz_guest_messages : source_event_job UNIQUE

**Objectif :** La colonne `source_event_job` existe et est protégée par un index UNIQUE partiel.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'veraluz_guest_messages';

SELECT indexname FROM pg_indexes
WHERE tablename = 'veraluz_guest_messages'
  AND indexname = 'uq_guest_messages_source_event_job';
```

**Attendu :** Colonne présente. Index UNIQUE présent.

---

## SA-11 — vz_emit_reservation_event (version comms) crée les comm_jobs

**Objectif :** La confirmation crée bien un comm_job `booking_confirmation/internal`.

**Procédure :**
1. Mettre `status='confirmed'` sur une réservation
2. Vérifier :

```sql
SELECT * FROM veraluz_communication_jobs
WHERE template_key = 'booking_confirmation' AND channel = 'internal'
ORDER BY created_at DESC LIMIT 1;
```

**Attendu :**
- 1 ligne avec `status='pending'`, `recipient_ref='department:reception'`
- Lié à un `event_id` existant dans `veraluz_events` avec `event_type='reservation_confirmed'`

---

## SA-12 — Guest session lookup : schéma réel (pas checked_out_at)

**Objectif :** Le trigger utilise `status='active' AND revoked_at IS NULL AND expires_at > now()`.

**Procédure :**
1. S'assurer qu'une session active existe pour une réservation
2. Passer cette réservation à `status='checkedin'`
3. Vérifier le comm_job créé :

```sql
SELECT * FROM veraluz_communication_jobs
WHERE template_key = 'checkin_welcome' AND channel = 'guest_portal'
ORDER BY created_at DESC LIMIT 1;
```

**Attendu :** `recipient_ref` = `guest_session_id` de la session active. Pas d'erreur `column checked_out_at does not exist`.

---

## EF-1 — event-worker : claim_event_jobs atomique avec attempt++

**Objectif :** Après un cycle event-worker, le job a `attempt=1` et `status='processing'` ou `'completed'`.

**Procédure :**
1. Déclencher un `guest_checked_out`
2. Lancer event-worker
3. Vérifier :

```sql
SELECT handler, status, attempt FROM veraluz_event_jobs
WHERE event_id = '<event_id>' AND handler = 'create_housekeeping_task';
```

**Attendu :** `attempt >= 1`. Pas `attempt=0` après traitement.

---

## EF-2 — event-worker : create_housekeeping_task écrit dans veraluz_housekeeping

**Objectif :** Un checkout crée bien une tâche de ménage avec les bonnes colonnes.

**Procédure :**
1. Après un checkout, lancer event-worker
2. Vérifier :

```sql
SELECT * FROM veraluz_housekeeping
WHERE source_event_id = '<event_job_event_id>'
ORDER BY created_at DESC LIMIT 1;
```

**Attendu :** Ligne présente avec `type='cleaning'` (pas `task_type`), `source_event_id` renseigné.

---

## EF-3 — comms-worker : resolveContext clés settings correctes

**Objectif :** `property_name` est résolu depuis la clé settings `property.name` (pas `branding.hotel_name`).

**Procédure :**
1. S'assurer que `veraluz_settings` contient `key='property'` avec `value.name = 'Mon hôtel test'`
2. Lancer comms-worker sur un job `internal` et vérifier le message créé dans `veraluz_internal_messages`

**Attendu :** `message` contient `'Mon hôtel test'` si `{{property_name}}` est dans le template.

---

## EF-4 — comms-worker : unit lookup via .eq('id', unit_id)

**Objectif :** Le nom de l'unité est résolu correctement (PK réel = `id`, pas `unit_id`).

**Procédure :**
1. Déclencher un comm_job lié à un événement avec `unit_id` valide dans le payload
2. Vérifier que le message interne contient le nom de l'unité (pas l'UUID brut)

**Attendu :** `{{unit_name}}` remplacé par le nom lisible (ex : `'Studio 1'`), pas par l'UUID.

---

## EF-5 — comms-worker : template depuis veraluz_comm_templates

**Objectif :** comms-worker ne cherche PAS dans `veraluz_communication_templates`.

**Procédure :** Consulter les logs Supabase du comms-worker.
Aucune requête vers `veraluz_communication_templates` ne doit apparaître.

**Attendu :** Requêtes uniquement vers `veraluz_comm_templates`.

---

## EF-6 — comms-worker : email dispatché via dispatch_worker_email

**Objectif :** Un comm_job `channel='email'` appelle `communications-secure` (pas de RESEND_API_KEY dans comms-worker).

**Procédure :**
1. Insérer un comm_job `template_key='reservation_confirmed'`, `channel='email'`, `status='pending'`
2. Lancer comms-worker
3. Vérifier :

```sql
SELECT status FROM veraluz_communication_jobs WHERE id = '<id>';
SELECT status, error_code FROM veraluz_comm_log
WHERE event_type = 'reservation_confirmed' ORDER BY created_at DESC LIMIT 1;
```

**Attendu :**
- comm_job : `status='completed'`
- comm_log : entrée créée par `communications-secure` (pas par comms-worker directement)
- RESEND_API_KEY absent des logs comms-worker

---

## EF-7 — comms-worker : guest_portal écrit dans veraluz_guest_messages

**Objectif :** Un comm_job `channel='guest_portal'` insère dans `veraluz_guest_messages` (pas `veraluz_messages`).

**Procédure :**
1. Insérer un comm_job `template_key='checkin_welcome'`, `channel='guest_portal'`, `recipient_ref='<session_uuid>'`
2. Lancer comms-worker
3. Vérifier :

```sql
SELECT * FROM veraluz_guest_messages
WHERE source_event_job = 'comms:<comm_job_id>';
```

**Attendu :** Ligne dans `veraluz_guest_messages` avec `sender_type='staff'`, `staff_id='system'`, `channel='reception'`, `source_event_job` renseigné.
AUCUNE ligne dans `veraluz_messages` (table inexistante ou mauvaise cible).

---

## EF-8 — comms-worker : internal idempotence via source_event_job

**Objectif :** Appeler comms-worker deux fois sur le même job ne crée pas deux messages internes.

**Procédure :**
1. Passer un comm_job `internal` à `status='pending'` deux fois (simuler retry)
2. Lancer comms-worker deux fois

**Attendu :**
- `COUNT(*) = 1` dans `veraluz_internal_messages` pour ce `source_event_job`

---

## EF-9 — dispatch_worker_email : service_role requis

**Objectif :** Un appel sans service_role est rejeté avec 403.

**Procédure :**
1. Appeler `communications-secure` avec `action='dispatch_worker_email'` et un JWT employé normal → 403
2. Sans Authorization → 403

**Attendu :** `{ok:false, error:'service_role_required'}` dans les deux cas.
La session employé n'est PAS vérifiée pour cette action.

---

## EF-10 — dispatch_worker_email : recipient résolu depuis DB

**Objectif :** Le destinataire email est résolu depuis `veraluz_reservations.client_email` (jamais depuis le payload ou le frontend).

**Procédure :**
1. Créer un événement avec `payload.client_email='mallory@evil.com'` mais `veraluz_reservations.client_email='alice@real.com'`
2. Appeler `dispatch_worker_email` avec `event_id` + `template_key`

**Attendu :** L'email est envoyé à `alice@real.com` (source DB), jamais à `mallory@evil.com`.

---

## EF-11 — infra-health : section comms visible et sans données sensibles

**Objectif :** La réponse inclut `data.comms` avec comptages et jobs récents, sans recipient ni body.

**Procédure :**
1. Appeler `infra-health` avec un token gérant (X-Veraluz-Session)
2. Examiner `data.comms`

**Attendu :**
- `comms.counts` = `{pending:N, processing:N, completed:N, failed:N, dead:N}`
- `comms.recent` = liste de `{id, template_key, channel, status, attempt, processed_at, created_at}`
- AUCUN champ `recipient_ref`, `last_error` contenant un email, `body`

---

## EF-12 — comms-worker absent de BROKER_ALLOWED

**Objectif :** `comms-worker` n'est plus accessible via le broker utilisateur du CORE.

**Procédure :**
1. Inspecter `VERALUZ_BROKER_ALLOWED_ENDPOINTS` dans `VERALUZ_OS_CORE.html`
2. Tenter d'appeler `comms-worker` via le broker JavaScript (`veraluzBroker('comms-worker', ...)`)

**Attendu :** `comms-worker` absent de la liste. Appel rejeté par le broker (erreur `endpoint_not_allowed`).

---

## E2E-1 — Preuve #1 : reservation_confirmed → comm_jobs

**Objectif :** La confirmation d'une réservation déclenche les deux comm_jobs attendus.

**Procédure :**
1. Réservation sans email : `UPDATE veraluz_reservations SET status='confirmed' WHERE id='<id_sans_email>'`
2. Réservation avec email : `UPDATE veraluz_reservations SET status='confirmed' WHERE id='<id_avec_email>'`

**Attendu réservation sans email :**
- 1 comm_job `booking_confirmation/internal/department:reception` (pending)
- 0 comm_job email

**Attendu réservation avec email :**
- 1 comm_job `booking_confirmation/internal/department:reception`
- 1 comm_job `reservation_confirmed/email/<client_email>`

---

## E2E-2 — Preuve #2 : guest_checked_in → comm_jobs

**Objectif :** Le check-in crée les comm_jobs selon la présence de session et d'email.

**Procédure :**
1. Check-in avec session active + email : `UPDATE veraluz_reservations SET status='checkedin' WHERE id='<id>'`
2. Vérifier :

```sql
SELECT template_key, channel, recipient_ref, status
FROM veraluz_communication_jobs
WHERE event_id = (
  SELECT id FROM veraluz_events
  WHERE event_type='guest_checked_in' AND reservation_id='<id>'
  ORDER BY created_at DESC LIMIT 1
);
```

**Attendu :**
- `checkin_welcome/guest_portal/<session_id>` (pending) si session active
- `checkin_welcome/email/<client_email>` (pending) si email renseigné

---

## E2E-3 — Idempotence UNIQUE comm_jobs

**Objectif :** Le trigger ne crée jamais deux comm_jobs identiques.

**Procédure :**
1. Passer une réservation à `confirmed` deux fois (via reset + re-confirm)
2. Compter les jobs :

```sql
SELECT COUNT(*) FROM veraluz_communication_jobs
WHERE event_type IS NULL
  AND template_key='booking_confirmation'
  AND channel='internal';
```

Ou via ON CONFLICT : vérifier que le count n'augmente pas après la deuxième confirmation.

**Attendu :** COUNT = 1 par `(event_id, template_key, channel, recipient_ref)`. Jamais de doublons.

---

## Récapitulatif

| ID    | Cas                                                        | Statut |
|-------|------------------------------------------------------------|--------|
| SA-1  | veraluz_events schéma canonique (pas tenant_id/emitted_at) | HUMAN  |
| SA-2  | veraluz_event_jobs updated_at + RLS                        | HUMAN  |
| SA-3  | veraluz_housekeeping colonnes ajoutées + RLS               | HUMAN  |
| SA-4  | claim_event_jobs incrémente attempt                        | HUMAN  |
| SA-5  | Trigger checkout/checkin/confirmed : client_name           | HUMAN  |
| SA-6  | Trigger service request : guest_session_id + note          | HUMAN  |
| SA-7  | veraluz_communication_templates N'EXISTE PAS               | HUMAN  |
| SA-8  | veraluz_communication_jobs template_key                    | HUMAN  |
| SA-9  | veraluz_comm_templates channel étendu guest_portal         | HUMAN  |
| SA-10 | veraluz_guest_messages source_event_job UNIQUE             | HUMAN  |
| SA-11 | Trigger confirmed → comm_job booking_confirmation/internal | HUMAN  |
| SA-12 | Guest session lookup status/revoked_at/expires_at          | HUMAN  |
| EF-1  | event-worker claim attempt++                               | HUMAN  |
| EF-2  | event-worker create_housekeeping_task colonnes réelles     | HUMAN  |
| EF-3  | comms-worker resolveContext clé property                   | HUMAN  |
| EF-4  | comms-worker unit lookup .eq('id', unit_id)                | HUMAN  |
| EF-5  | comms-worker template depuis veraluz_comm_templates        | HUMAN  |
| EF-6  | comms-worker email → dispatch_worker_email                 | HUMAN  |
| EF-7  | comms-worker guest_portal → veraluz_guest_messages         | HUMAN  |
| EF-8  | comms-worker internal idempotence source_event_job         | HUMAN  |
| EF-9  | dispatch_worker_email service_role requis                  | HUMAN  |
| EF-10 | dispatch_worker_email recipient résolu depuis DB           | HUMAN  |
| EF-11 | infra-health section comms sans données sensibles          | HUMAN  |
| EF-12 | comms-worker absent BROKER_ALLOWED                         | HUMAN  |
| E2E-1 | reservation_confirmed → comm_jobs (avec/sans email)        | HUMAN  |
| E2E-2 | guest_checked_in → comm_jobs (session + email)             | HUMAN  |
| E2E-3 | Idempotence UNIQUE comm_jobs                               | HUMAN  |

**HUMAN RETEST — Tous les cas nécessitent une validation humaine avec Supabase réel.**
