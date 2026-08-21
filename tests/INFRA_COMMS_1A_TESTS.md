# INFRA-COMMS-1A — Tests & Cas de validation
Branche : `claude/settings-ssot-1a` | Lot : INFRA-COMMS-1A | Date : 2026-08-21

---

## Pré-requis
- Migrations INFRA-OPS-1 + INFRA-OPS-1R + INFRA-COMMS-1A appliquées
- EF déployées : `comms-worker`
- _shared/templates.ts disponible (importé par comms-worker)

---

## Cas IC-1 — Migration idempotente

**Objectif :** Appliquer `20260821_infra_comms_1a.sql` deux fois sans erreur.

**Procédure :**
1. Appliquer
2. Réappliquer

**Attendu :** Aucune erreur SQL (IF NOT EXISTS, ON CONFLICT DO NOTHING, OR REPLACE).

---

## Cas IC-2 — Schéma veraluz_communication_templates

**Objectif :** La table existe avec les bonnes colonnes et contraintes.

**Procédure :**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'veraluz_communication_templates'
ORDER BY ordinal_position;

SELECT code, channel FROM veraluz_communication_templates ORDER BY code;
```

**Attendu :**
- Colonnes présentes : id, code, channel, name, subject, body, active, created_at, updated_at
- UNIQUE sur code
- CHECK channel IN ('email','internal','guest_portal')
- Seed : booking_confirmation (internal), booking_confirmation_guest (guest_portal), checkin_welcome (guest_portal), payment_confirmation (guest_portal), checkout_thank_you (guest_portal)

---

## Cas IC-3 — Schéma veraluz_communication_jobs

**Objectif :** La table existe avec UNIQUE(event_id, template_code, channel, recipient_ref).

**Procédure :**
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'veraluz_communication_jobs';
```

**Attendu :**
- Index UNIQUE sur (event_id, template_code, channel, recipient_ref)
- Index sur (status, created_at) WHERE status='pending'
- RLS activé, accès direct refusé

---

## Cas IC-4 — Proof #1 : reservation_confirmed → booking_confirmation (internal)

**Objectif :** Une réservation confirmée crée exactement un comm_job interne.

**Procédure :**
1. Mettre à jour une réservation : `status = 'confirmed'`
2. Vérifier immédiatement :

```sql
SELECT * FROM veraluz_communication_jobs
WHERE template_code = 'booking_confirmation'
  AND channel = 'internal'
ORDER BY created_at DESC LIMIT 1;
```

3. Lancer comms-worker
4. Vérifier `veraluz_internal_messages`

**Attendu :**
- 1 ligne comm_job `status='pending'` avec `recipient_ref='department:reception'`
- Après comms-worker : job `status='completed'`
- 1 message dans `veraluz_internal_messages` avec `department='reception'`
- Subject contenant le nom du client (`{{guest_name}}` remplacé)

---

## Cas IC-5 — Proof #2 : guest_checked_in → checkin_welcome (guest_portal)

**Objectif :** Un check-in crée exactement un comm_job guest_portal.

**Procédure :**
1. Mettre à jour une réservation : `status = 'checkedin'` (depuis pending ou confirmed)
2. Vérifier qu'une session invité active existe pour cette réservation
3. Vérifier :

```sql
SELECT * FROM veraluz_communication_jobs
WHERE template_code = 'checkin_welcome'
  AND channel = 'guest_portal'
ORDER BY created_at DESC LIMIT 1;
```

4. Lancer comms-worker

**Attendu :**
- 1 ligne comm_job `status='pending'` avec `recipient_ref` = guest_session_id
- Après comms-worker : job `status='completed'`
- 1 message dans `veraluz_messages` avec `channel='reception'`, `sender_type='staff'`
- Contenu du message : subject + body avec variables remplacées (nom client, dates)

---

## Cas IC-6 — Idempotence UNIQUE comm_jobs

**Objectif :** Le même événement ne crée pas deux comm_jobs identiques.

**Procédure :**
1. Déclencher une confirmation de réservation → 1 comm_job créé
2. Appeler manuellement le trigger ou réappliquer ON CONFLICT DO NOTHING avec les mêmes paramètres

**Attendu :** Toujours 1 seule ligne comm_job pour (event_id, template_code, channel, recipient_ref).

---

## Cas IC-7 — claim_communication_jobs : verrou atomique

**Objectif :** Deux appels simultanés à comms-worker ne traitent pas les mêmes jobs.

**Procédure :**
1. Insérer 5 comm_jobs `status='pending'`
2. Appeler comms-worker deux fois en parallèle

**Attendu :** Total traité = 5 (pas 10). Chaque job traité une seule fois.

---

## Cas IC-8 — Canal email → email_not_configured (pas d'erreur fatale)

**Objectif :** Un comm_job de canal `email` est traité sans crash et marqué `email_not_configured`.

**Procédure :**
1. Insérer manuellement un comm_job avec `channel='email'`, `status='pending'`
2. Lancer comms-worker

**Attendu :**
- Job marqué `status='email_not_configured'`
- `last_error` contient 'EmailJS non configuré'
- Le batch continue (pas d'exception non rattrapée)
- Réponse comms-worker : `{not_configured: 1}`

---

## Cas IC-9 — renderTemplate : substitution déterministe

**Objectif :** La fonction de rendu remplace correctement les variables whitelistées.

**Procédure (test manuel ou script Deno) :**
```typescript
import { renderTemplate } from './_shared/templates.ts';
const tmpl = 'Bonjour {{guest_name}}, votre logement {{unit_name}} est prêt. Inconnu: {{unknown_var}}';
const result = renderTemplate(tmpl, { guest_name: 'Marie', unit_name: 'Studio 1' });
console.assert(result === 'Bonjour Marie, votre logement Studio 1 est prêt. Inconnu: {{unknown_var}}');
```

**Attendu :**
- `{{guest_name}}` → 'Marie'
- `{{unit_name}}` → 'Studio 1'
- `{{unknown_var}}` → inchangé (non dans la whitelist)
- Aucun eval(), aucune erreur

---

## Cas IC-10 — comms-worker sécurité service_role

**Objectif :** Un appel sans service_role est rejeté.

**Procédure :**
1. Appeler comms-worker sans header Authorization → 403
2. Appeler avec un JWT employé normal → 403

**Attendu :** `{ok:false, error:'service_role_required'}` 403 dans les deux cas.

---

## Cas IC-11 — Retry + dead comm_job

**Objectif :** Un comm_job qui échoue est retryé puis marqué dead après max_attempts.

**Procédure :**
1. Insérer un comm_job avec `template_code='inexistant'`, `channel='internal'`, `status='pending'`
2. Appeler comms-worker 4 fois

**Attendu :**
- Tentatives 1–3 : job revient à `status='pending'` (retry)
- Tentative 4 : `status='dead'`, `last_error` contient `template_not_found_or_inactive`

---

## Cas IC-12 — EVENTBUS_EMBEDDED : section Comms visible

**Objectif :** L'onglet Durables DB affiche la section communications.

**Procédure :**
1. Ouvrir VERALUZ OS en tant que gérant
2. Event Bus → onglet Durables DB → faire défiler vers le bas

**Attendu :**
- Section `📨 Communications (comms-worker)` visible
- Soit des KPI cards avec les comptages réels, soit le message de dégradation gracieuse
- Aucune erreur JS en console

---

## Récapitulatif

| ID    | Cas                                               | Statut |
|-------|---------------------------------------------------|--------|
| IC-1  | Migration idempotente                             | HUMAN  |
| IC-2  | Schéma communication_templates + seed             | HUMAN  |
| IC-3  | Schéma communication_jobs UNIQUE + RLS            | HUMAN  |
| IC-4  | Proof #1 reservation_confirmed → booking_confirmation | HUMAN |
| IC-5  | Proof #2 guest_checked_in → checkin_welcome       | HUMAN  |
| IC-6  | Idempotence UNIQUE comm_jobs                      | HUMAN  |
| IC-7  | claim_communication_jobs verrou atomique          | HUMAN  |
| IC-8  | Canal email → email_not_configured                | HUMAN  |
| IC-9  | renderTemplate substitution déterministe          | HUMAN  |
| IC-10 | comms-worker sécurité service_role                | HUMAN  |
| IC-11 | Retry + dead comm_job                             | HUMAN  |
| IC-12 | UI section Comms Durables DB                      | HUMAN  |

**HUMAN RETEST — Tous les cas nécessitent une validation humaine avec Supabase réel.**
