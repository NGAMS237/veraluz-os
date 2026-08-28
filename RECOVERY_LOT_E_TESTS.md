# RECOVERY LOT E — Tests & Résultats
## Settings + Guest + Events + Communications + Scheduler

**Branche** : `claude/recovery-lot-e-settings-events-comms-scheduler`
**Base main** : `3d2d97d9fedbc04f1cd66d591cefb179e2ee2580`
**Commits Lot E** : `7c4c01d` (Gate 0) → `f4e8cfb` (Phases 2-9)

---

## Tests automatisés

### Gate 0 — Whitelist broker
`node --test tests/gate0-documents-whitelist.test.mjs`
**8/8 PASS**

| Test | Résultat |
|------|---------|
| G0-01 documents-secure dans whitelist | [AUTOMATISÉ — PASS] |
| G0-02 endpoint inconnu absent | [AUTOMATISÉ — PASS] |
| G0-03 event-worker/comms-worker absents | [AUTOMATISÉ — PASS] |
| G0-04 veraluz-document-upload sur broker multipart | [AUTOMATISÉ — PASS] |
| G0-05 service_role absent code exécutable CORE | [AUTOMATISÉ — PASS] |
| G0-06 logique indexOf whitelist présente | [AUTOMATISÉ — PASS] |
| G0-07 CACHE_NAME v037-lot-e | [AUTOMATISÉ — PASS] |
| G0-08 endpoints critiques non régressés | [AUTOMATISÉ — PASS] |

### Lot E — Settings + Events + Comms + Scheduler
`node --test tests/recovery-lot-e-settings-events-comms-scheduler.test.mjs`
**26/26 PASS**

| Test | Résultat |
|------|---------|
| E-01 documents-secure whitelist | [AUTOMATISÉ — PASS] |
| E-02 endpoint inconnu bloqué | [AUTOMATISÉ — PASS] |
| E-03 workers service-only absents | [AUTOMATISÉ — PASS] |
| E-04 loadSettings() sans localStorage SSOT | [AUTOMATISÉ — PASS] |
| E-05 pas d'EmailJS direct | [AUTOMATISÉ — PASS] |
| E-06 saveAll() sans localStorage(LS_KEY) | [AUTOMATISÉ — PASS] |
| E-07 wifi.password masqué (settings-secure) | [AUTOMATISÉ — PASS] |
| E-08 Wi-Fi checkedin uniquement | [AUTOMATISÉ — PASS] |
| E-09 checkout 12:00 (Settings + guest-access) | [AUTOMATISÉ — PASS] |
| E-10 confirmed ≠ checkedin (pas de promotion auto) | [AUTOMATISÉ — PASS] |
| E-11 reservation_id depuis session validée | [AUTOMATISÉ — PASS] |
| E-12 veraluz_events idempotency_key UNIQUE | [AUTOMATISÉ — PASS] |
| E-13 source/actor_id colonnes serveur | [AUTOMATISÉ — PASS] |
| E-14 REST anon direct supprimé (Notifications) | [AUTOMATISÉ — PASS] |
| E-15 _NOTIF_DEMO_MODE=true par défaut | [AUTOMATISÉ — PASS] |
| E-16 session_token body retiré (comms) | [AUTOMATISÉ — PASS] |
| E-17 anti-double-envoi via comm_log | [AUTOMATISÉ — PASS] |
| E-18 running/running_since anti-concurrence | [AUTOMATISÉ — PASS] |
| E-19 jobs: enabled=false, dry_run=true par défaut | [AUTOMATISÉ — PASS] |
| E-20 infra-scheduler autorisé, workers internes non | [AUTOMATISÉ — PASS] |
| E-21 stack traces côté serveur uniquement | [AUTOMATISÉ — PASS] |
| E-22 service_role absent scripts frontend | [AUTOMATISÉ — PASS] |
| E-23 thèmes clair/sombre conservés | [AUTOMATISÉ — PASS] |
| E-24 responsive mobile conservé | [AUTOMATISÉ — PASS] |
| E-25 broker unwrap Documents non régressé | [AUTOMATISÉ — PASS] |
| E-26 fichiers critiques B/C/Auth présents | [AUTOMATISÉ — PASS] |

### Non-régression suites existantes
| Suite | Résultat |
|-------|---------|
| hotfix-documents-broker-response (15 tests) | [AUTOMATISÉ — 15/15 PASS] |
| recovery-lot-c-room-service-folio | [AUTOMATISÉ — ALL PASS] |
| guest-portal-correctness | [AUTOMATISÉ — ALL PASS] |
| guest-folio-checkedout | [AUTOMATISÉ — PASS] |
| auth-r1-containment (15 tests) | [AUTOMATISÉ — 15/15 PASS] |
| auth-r1c1-employees-secure (52 tests) | [AUTOMATISÉ — 21/52 PASS — 31 PRÉ-EXISTANTS] |
| session-token-not-postmessaged (5 tests) | [AUTOMATISÉ — 5/5 PASS] |
| recovery-lot-b1-checkout-durability | [AUTOMATISÉ — 13/14 PASS — 1 PRÉ-EXISTANT] |
| recovery-lot-b-reservation-overstay | [AUTOMATISÉ — 34/34 PASS] |

### DRY-RUN SQL
Migration `20260828_recovery_lot_e_events_notifications_jobs.sql` — BEGIN/ROLLBACK PROD :
**[DRY-RUN SQL — PASS]** — 3 tables créées, 3 lignes insérées, ROLLBACK propre.

---

## Tests POST-DÉPLOIEMENT (après autorisation Blaise)

| Test | Type |
|------|------|
| Appliquer migration en PROD | [POST-DÉPLOIEMENT] |
| Vérifier veraluz_events, veraluz_notifications, veraluz_jobs créées | [POST-DÉPLOIEMENT] |
| Vérifier RLS ON sur les 3 tables | [POST-DÉPLOIEMENT] |
| Vérifier REVOKE anon/authenticated | [POST-DÉPLOIEMENT] |
| Tester guest-access: checkout_time = 12:00 sur séjour réel | [POST-DÉPLOIEMENT] |
| Vérifier documents-secure accessible (11 fiches visibles) | [POST-DÉPLOIEMENT] |
| Vérifier communications-secure refuse session_token dans body | [POST-DÉPLOIEMENT] |
| Déployer guest-access EF (v12) | [POST-DÉPLOIEMENT] |
| Déployer communications-secure EF | [POST-DÉPLOIEMENT] |

---

## Tests MANUELS (Blaise)

| Test | Type |
|------|------|
| Vérifier 11 fiches documents visibles dans DOCUMENTS_EMBEDDED | [MANUEL BLAISE] |
| Vérifier boutons Uploader/Remplacer visibles (desktop + mobile) | [MANUEL BLAISE] |
| Vérifier checkout 12:00 affiché dans Guest Portal | [MANUEL BLAISE] |
| Vérifier Wi-Fi visible uniquement pour séjour checkedin | [MANUEL BLAISE] |
| Vérifier bannière "Données de démonstration" dans Notifications | [MANUEL BLAISE] |
| Vérifier Settings se charge depuis DB (pas localStorage) | [MANUEL BLAISE] |
| Vérifier thème clair/sombre Settings | [MANUEL BLAISE] |
| Vérifier responsive mobile Settings | [MANUEL BLAISE] |

---

*AUTH-R1C1 21/52 et LOT-B1 13/14 : défauts pré-existants sur main, non introduits par Lot E.*
