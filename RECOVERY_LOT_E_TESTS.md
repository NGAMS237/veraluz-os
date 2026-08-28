# RECOVERY LOT E — Rapport de Tests

**Branche:** `claude/recovery-lot-e-settings-events-comms-scheduler`
**Date:** 2026-08-28
**Résultat:** 49/49 PASS (tests automatisés Node)

---

## Statut des tests

```
node --test tests/recovery-lot-e-settings-events-comms-scheduler.test.mjs
# tests 49 | pass 49 | fail 0
```

## Couverture par bloc

### Bloc 1 — Whitelist & Sécurité navigateur (E-01 → E-03b)
- E-01: `documents-secure` dans la whitelist CORE (non-régression Gate 0)
- E-02: endpoint inconnu bloqué (`endpoint_not_whitelisted`)
- E-03: `event-worker` et `comms-worker` absents de la whitelist navigateur
- E-03b: `notifications-secure` dans la whitelist CORE ✅ NOUVEAU

### Bloc 2 — Settings localStorage → DB (E-04 → E-06f)
- E-04: `loadSettings()` sans localStorage SSOT
- E-04b: `loadDbCanonical()` via broker CORE, pas de fetch direct ✅ NOUVEAU
- E-05: pas d'envoi EmailJS direct (`api.emailjs.com` absent du code exécutable)
- E-06: `saveAll()` ne stocke pas dans localStorage(LS_KEY)
- E-06b: `saveAll()` appelle `veraluzSecureRequest(settings-secure)` + succès après `d.ok` ✅ NOUVEAU
- E-06c: `discardChanges()` restaure depuis `_dbSett` (valeurs DB), pas depuis DEFAULTS ✅ NOUVEAU
- E-06d: historique email via `_emailLog` en mémoire (pas localStorage SSOT) ✅ NOUVEAU
- E-06e: campagnes email sans localStorage SSOT ✅ NOUVEAU
- E-06f: `testEmail()` via broker `communications-secure` ✅ NOUVEAU

### Bloc 3 — Settings-secure EF (E-07)
- E-07: `wifi.password` masqué dans `get_settings`

### Bloc 4 — Guest access (E-08 → E-11)
- E-08: mot de passe Wi-Fi uniquement pour `checkedin`
- E-09: `checkout_time` défaut 12:00 dans Settings et guest-access
- E-09b: **CRITIQUE** — `.select('name, number')` absent (`veraluz_units.number` n'existe pas) ✅ NOUVEAU
- E-10: `confirmed` ≠ `checkedin` (pas de promotion automatique)
- E-11: `reservation_id` depuis session validée côté serveur

### Bloc 5 — Events: immutabilité (E-12 → E-13)
- E-12: `idempotency_key UNIQUE` dans `veraluz_events`
- E-12b: enveloppe immuable — pas de `status` dans `veraluz_events` ✅ NOUVEAU
- E-12c: `veraluz_event_processing` séparée pour l'état mutable ✅ NOUVEAU
- E-12d: pas d'index redondant sur `idempotency_key` ✅ NOUVEAU
- E-13: `REVOKE ALL FROM public, anon, authenticated` sur toutes les tables ✅ NOUVEAU

### Bloc 6 — Notifications (E-14 → E-15f)
- E-14: pas de REST anon direct dans NOTIFICATIONS_EMBEDDED
- E-14b: NOTIFICATIONS_EMBEDDED utilise broker `notifications-secure` ✅ NOUVEAU
- E-15: `_NOTIF_DEMO_MODE = true` par défaut
- E-15b: `notification_reads` — état de lecture indépendant par employé ✅ NOUVEAU
- E-15c: `notifications-secure` EF a les 4 actions (list/create/mark_read/acknowledge) ✅ NOUVEAU
- E-15d: filtrage par rôle côté serveur (pas côté client) ✅ NOUVEAU
- E-15e: pas de `session_token` dans le body — header `x-veraluz-session` uniquement ✅ NOUVEAU
- E-15f: retourne 401/403 correctement ✅ NOUVEAU

### Bloc 7 — Communications (E-16 → E-17)
- E-16: `communications-secure` sans `session_token` dans le body
- E-17: logique d'idempotence (comm_log)

### Bloc 8 — Scheduler (E-18 → E-20)
- E-18: colonnes `running`, `running_since`, `lease_token`, `lease_expires_at` dans `veraluz_jobs`
- E-19: `enabled=false` et `dry_run=true` par défaut
- E-19b: claim atomique — deux workers ne peuvent pas prendre le même job ✅ NOUVEAU
- E-19c: `release_job_lease` et `recover_expired_job_leases` existent ✅ NOUVEAU
- E-19d: fonctions SECURITY DEFINER + `search_path = public` ✅ NOUVEAU
- E-20: workers absents de la whitelist navigateur

### Bloc 9 — Sécurité générale (E-21 → E-22b)
- E-21: pas de stack traces retournées au client
- E-22: `service_role` absent du code exécutable CORE et SETTINGS
- E-22b: REVOKE sur les fonctions scheduler ✅ NOUVEAU

### Bloc 10 — Non-régression (E-23 → E-28)
- E-23: thème clair/sombre conservé dans SETTINGS
- E-24: media queries responsive conservées dans SETTINGS
- E-25: DOCUMENTS_EMBEDDED utilise le broker unwrap `{status,body}`
- E-26: fichiers critiques Lots B/C/Auth présents (+ `notifications-secure`) ✅ NOUVEAU
- E-27: `notifications-secure` utilise `service_role` uniquement ✅ NOUVEAU
- E-28: `veraluz_event_processing.event_id` = PK unique ✅ NOUVEAU

---

## Tests visuels (à effectuer par Blaise)
- [ ] SETTINGS desktop/mobile clair/sombre — bouton Enregistrer → spinner → succès DB confirmé
- [ ] SETTINGS — Annuler restaure les valeurs DB, pas les DEFAULTS
- [ ] SETTINGS — email test → passe par broker (pas api.emailjs.com direct)
- [ ] NOTIFICATIONS — bannière démo visible
- [ ] GUEST_PORTAL — room number correct (pas d'erreur .number)

## Dry-run SQL
Fichier: `supabase/migrations/20260828_dry_run_preview.sql`
À exécuter dans l'éditeur SQL Supabase avec BEGIN/ROLLBACK — aucun changement PROD.

## Contraintes respectées
- aucun déploiement Supabase
- aucune migration PROD
- aucun merge ou fast-forward vers main
- aucune donnée cliente modifiée
- aucune communication réelle envoyée
- aucun cron activé
- service_role jamais dans le frontend
