# RECOVERY LOT E — Plan de déploiement
## Settings · Guest · Events · Communications · Scheduler

**Branche** : `claude/recovery-lot-e-settings-events-comms-scheduler`
**Commit final** : `f4e8cfb` (Phases 2-9) + `7c4c01d` (Gate 0)
**Base main** : `3d2d97d9fedbc04f1cd66d591cefb179e2ee2580`

---

## ORDRE DE DÉPLOIEMENT RECOMMANDÉ

### Étape 1 — Migration DB (OBLIGATOIRE EN PREMIER)
**Autorisation requise de Blaise avant toute action.**

```sql
-- Appliquer: 20260828_recovery_lot_e_events_notifications_jobs.sql
-- Tables créées: veraluz_events, veraluz_notifications, veraluz_jobs
-- RLS ON, REVOKE anon/authenticated, GRANT service_role
-- Idempotente (IF NOT EXISTS)
```

Vérifications post-migration :
```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('veraluz_events','veraluz_notifications','veraluz_jobs');
-- Attendu: rowsecurity=true pour les 3

SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_name IN ('veraluz_events','veraluz_notifications','veraluz_jobs')
AND grantee NOT IN ('service_role','postgres','supabase_admin');
-- Attendu: 0 lignes (aucune permission publique)
```

### Étape 2 — Edge Functions
Déployer uniquement si migration STEP 1 confirmée :

```bash
# guest-access v12 (fix checkout_time 12:00 + roomNumber sans .number)
supabase functions deploy guest-access --project-ref dfdmasejsoibxrvubegu --no-verify-jwt

# communications-secure (retire body.session_token fallback)
supabase functions deploy communications-secure --project-ref dfdmasejsoibxrvubegu --no-verify-jwt
```

### Étape 3 — Frontend (GitHub Pages)
Fast-forward `claude/recovery-lot-e-settings-events-comms-scheduler` → `main`
Déclenche automatiquement le build GitHub Pages.

Fichiers modifiés :
- `VERALUZ_OS_CORE.html` — whitelist documents-secure
- `SETTINGS_EMBEDDED.html` — SSOT DB, no localStorage settings
- `NOTIFICATIONS_EMBEDDED.html` — pas de REST anon, mode démo
- `sw.js` — cache v037-lot-e

---

## CONTRAINTES PERMANENTES

- Aucun Cron PROD activé dans ce lot (pg_cron absent sur ce projet)
- `veraluz_jobs.enabled = false` par défaut — activation séparée autorisée
- `_NOTIF_DEMO_MODE = true` — désactiver manuellement après déploiement de `notifications-secure`
- Commandes orphelines Lot C : ne pas toucher (b73bdef9, 0bc946c0, 6e09572d)
- Aucun envoi email réel pendant les tests

---

## SSOT RETENUS

| Domaine | SSOT | Authority |
|---------|------|-----------|
| Settings métier | `veraluz_settings` | `settings-secure` EF |
| Guest sessions | `veraluz_guest_sessions` | `guest-access` EF |
| Events métier | `veraluz_events` (nouveau) | EFs internes (service_role) |
| Notifications | `veraluz_notifications` (nouveau) | `notifications-secure` (à créer Lot F) |
| Jobs/Scheduler | `veraluz_jobs` (nouveau) | `infra-scheduler` EF |
| Communications | `veraluz_comm_templates` + `veraluz_comm_log` | `communications-secure` EF |
| Documents | `veraluz_documents` | `documents-secure` EF |

---

## DÉFAUTS PROD TROUVÉS ET TRAITÉS

| Défaut | Gravité | Traitement |
|--------|---------|-----------|
| `documents-secure` absent de la whitelist broker | CRITIQUE | Corrigé Gate 0 (`7c4c01d`) |
| `loadSettings()` lisait localStorage comme SSOT | MOYEN | Corrigé Phase 2 |
| `saveAll()` écrivait les settings dans localStorage | MOYEN | Corrigé Phase 2 |
| `importSettings()` persistait en localStorage | FAIBLE | Corrigé Phase 2 |
| DEFAULTS checkout `11:00` ≠ PROD DB `12:00` | FAIBLE | Corrigé Phase 2 |
| `guest-access` checkout_time default `11:00` | FAIBLE | Corrigé Phase 3 |
| `guest-access` référence `unitRow?.number` (inexistant) | FAIBLE | Corrigé Phase 3 |
| `communications-secure` acceptait `session_token` en body | MOYEN | Corrigé Phase 5 |
| NOTIFICATIONS_EMBEDDED : REST anon direct | CRITIQUE | Supprimé Phase 6 |
| NOTIFICATIONS_EMBEDDED : simulation auto en prod | MOYEN | Désactivé Phase 6 |
| `veraluz_notifications` absente en DB | BLOQUANT | Migration Phase 6 |
| `veraluz_events` absente en DB | BLOQUANT | Migration Phase 4 |
| `veraluz_jobs` absente en DB | BLOQUANT | Migration Phase 7 |
| Clé `admin` en clair dans veraluz_settings | À TRAITER | Documenté — décision Blaise requise |

---

## DONNÉES PROD MODIFIÉES
**NON** — Aucune donnée modifiée. Audit strictement en lecture seule.

## COMMUNICATIONS RÉELLES ENVOYÉES
**NON**

## CRON PROD ACTIVÉ
**NON** — pg_cron absent sur le projet. veraluz_jobs.enabled=false par défaut.

---

## CHECKLIST MANUELLE BLAISE (courte)

- [ ] Vérifier 11 fiches documents visibles (test Blaise Gate D.1)
- [ ] Vérifier boutons Uploader/Remplacer dans liste et cartes
- [ ] Vérifier checkout 12:00 dans Guest Portal
- [ ] Vérifier Wi-Fi masqué pour séjour confirmed, visible pour checkedin
- [ ] Vérifier bannière démo dans Notifications (attendu)
- [ ] Vérifier Settings charge depuis DB (pas localStorage)
- [ ] Autoriser déploiement migration + EFs si tout OK
- [ ] Décision sur clé `admin` dans veraluz_settings (mot de passe en clair)

---

## RELIQUATS / PROCHAINS LOTS

- `notifications-secure` EF à créer (Lot F) pour raccorder NOTIFICATIONS_EMBEDDED
- Design VERALUZ Signature : Settings, Events, Notifications (Phase 8 non appliquée — périmètre des changements non finalisé)
- AUTH-R1C1 : 31 tests pré-existants en échec → analyse séparée
- Clé `admin` dans veraluz_settings : à migrer vers une table dédiée ou supprimer
