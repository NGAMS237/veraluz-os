# VERALUZ OS — Feuille de route canonique

Dernière mise à jour : 2026-08-27

Ce document conserve l'ordre de travail entre les conversations et les agents.
Le dépôt GitHub et l'état PROD vérifié restent les vérités techniques.

## Méthode obligatoire

`audit → petit lot → tests → merge ciblé → déploiement ciblé → smoke live → validation humaine → lot suivant`

- Aucun big-bang merge ou déploiement.
- Aucun merge vers `main` sans autorisation explicite de Blaise.
- Aucun déploiement PROD sans autorisation explicite de Blaise.
- Préserver les flux déjà validés en production.
- Une donnée = une source canonique ; ne pas créer de système parallèle.

## Fondation transversale de design

### UI-0 — VERALUZ Signature UI — AUDIT COMPLET 2026-08-27

Identité propre adoptée : **VERALUZ Signature UI System** (dérivée du paquet Horizon, personnalisée VERALUZ).

- Atlantique profond / Nuit de Kribi pour la structure
- Océan Veraluz pour l'interaction et l'information
- Or Veraluz comme accent rare
- Ivoire sable / Blanc coquillage pour les surfaces claires
- Cartes signature asymétriques uniquement sur les grandes synthèses
- Interfaces opérationnelles Restaurant, KDS, Livreur et Planning plus sobres
- CSS-first, accessibilité, mobile et performance obligatoires
- Aucun changement métier, DB, RLS, Auth ou API dans les lots UI

Autorité documentaire : `docs/design/veraluz-signature/`

**Résultats audit UI-0 (2026-08-27) :**
- 5 systèmes CSS parallèles, 100+ variables concurrentes, 0 token `--vlz-*` présent
- Guest Portal : le plus proche VERALUZ Signature
- Livreur : `--gold:#c9a84c` correspondance exacte avec `--vlz-gold`
- Restaurant/KDS : 170 couleurs hardcodées — migration la plus lourde
- Livrables : `VERALUZ_UI_AUDIT.md` et `VERALUZ_UI_PILOT_PLAN.md` dans `docs/design/veraluz-signature/`

Prochain : **UI-1** pilote sur Dashboard, profil client/séjour et folio — sur autorisation explicite de Blaise.

## Lots de récupération

### RECOVERY LOT A — TERMINÉ ET VALIDÉ LIVE

Auth, sessions, RH, pointage, Analytics, Livreur et anciens caches/frontends.

### RECOVERY LOT B / B.1 — TERMINÉ ET VALIDÉ LIVE

Réservations, Planning, overstay, occupation basée sur `status=checkedin`, checkout manuel et ménage atomique/idempotent.

### RECOVERY LOT C — TERMINÉ ET VALIDÉ LIVE
**Déployé LIVE le 2026-08-27 :**
- Migration `20260826_recovery_lot_c_room_service_folio.sql` appliquée PROD
- `room-service` v4 ACTIVE
- `guest-access` v11 ACTIVE
- `post-restaurant-folio` v4 ACTIVE
- Smoke test 4/4 PASS — nettoyage complet
- Branche `claude/recovery-lot-c-room-service-folio` → `7fa2c5a` sur GitHub

**Reliquats :** 3 commandes orphelines antérieures (b73bdef9, 0bc946c0, 6e09572d) — décision humaine requise, non backfillées.



Guest Portal ↔ Restaurant ↔ Livreur ↔ Room Charge ↔ Folio.

Invariants :

- un seul `order_id` de bout en bout ;
- `veraluz_food_orders` est opérationnel ;
- les room charges sont la source financière du restaurant dans le folio ;
- ne jamais compter à la fois food order et room charge comme revenus ;
- synchronisation des statuts Guest, Restaurant et Livreur ;
- room charge créée exactement une fois ;
- Guest Portal et Finance affichent les mêmes montants.

### RECOVERY LOT D — Documents alignés sur le SSOT existant ✅ CLOS

**Branche** : `claude/recovery-lot-d-documents-ssot` — mergée dans `main` @ `24c3ee7` — 2026-08-27
**Statut** : DÉPLOYÉ ET VALIDÉ EN PROD

Table canonique : `veraluz_documents` (11 lignes réelles, intactes). Migration `recovery_lot_d_documents_ssot` appliquée PROD.
Correctif v3 : capture schéma PROD dans Git; accès anon fermé (REVOKE + zéro policy RLS, 0 policy publique); Edge Function `documents-secure` v1 ACTIVE (X-Veraluz-Session, gerant uniquement, isValidUUID, parseDate 400, erreurs sans détail PostgreSQL, reviewed_by jamais accepté du client); `DOCUMENTS_EMBEDDED.html` migré vers broker CORE; tokens VERALUZ Signature injectés.
Aucun système Documents parallèle. Smoke test create/update/archive PASS. 11 documents originaux intacts.
OCR, scan, factures, bons de livraison, QR, PDF/branding et reçus thermiques 80 mm viennent après cet alignement.

### RECOVERY LOT E — Settings + Guest + Events + Comms + Scheduler

Unifier paramètres, extensions Guest, événements, communications et tâches planifiées. Déploiement progressif du Scheduler.

## Après les lots de récupération

1. Reservation Policies / Changes / No-show / Customer Credits
2. Contacts SSOT
3. RH 2.0
4. Finance Pro / SYSCOHADA
5. Rapports 2.0
6. Search / UX VERALUZ
7. Guest-7 / QR accès / PWA / polish
8. Agent Actions + approbations
9. AI Orchestrator + Ollama
10. E2E global + stabilisation
11. SaaS multi-résidences après validation réelle dans la résidence

## Dépendances conservées

- OCR / scan / factures / BL après Documents.
- QR d'accès / PWA / polish Guest après récupération du cœur métier.
- Reçus physiques / thermique 80 mm après Documents.
- Actions des agents et approbations après stabilisation métier.
- Supervision opérationnelle de Chloé après disponibilité des actions contrôlées.
- SaaS multi-résidences volontairement différé jusqu'à validation réelle de l'exploitation.

---

## LOT D.1 — DOCUMENT FILES ✅ (branche prête)

| Élément | État |
|---|---|
| EF `veraluz-document-upload` | ✅ Écrite (non déployée) |
| EF `documents-secure` + `get_signed_url` | ✅ Mise à jour (non déployée) |
| Broker `veraluzUploadDocument` dans CORE | ✅ Ajouté |
| UI upload/consult dans DOCUMENTS | ✅ Complète |
| Tests (RECOVERY_LOT_D1_TESTS.md) | ✅ Rédigés |
| Plan déploiement (RECOVERY_LOT_D1_DEPLOY_PLAN.md) | ✅ Rédigé |
| Merge vers main | ⏳ En attente autorisation Blaise |

**LOT E** : Non commencé — à définir.

## LOT E — Settings · Guest · Events · Comms · Scheduler

**Statut** : BRANCHE PRÊTE — en attente autorisation déploiement
**Branche** : `claude/recovery-lot-e-settings-events-comms-scheduler`
**Base main** : `3d2d97d9fedbc04f1cd66d591cefb179e2ee2580`
**Commits** : `7c4c01d` (Gate 0 whitelist) + `f4e8cfb` (Phases 2-9)

### Changements inclus
- **Gate 0** : `documents-secure` ajouté à `VERALUZ_BROKER_ALLOWED_ENDPOINTS` (défaut LIVE critique)
- **Settings** : localStorage retiré comme SSOT métier, DB canonical via `settings-secure`
- **Guest** : checkout_time 12:00, roomNumber sans `.number`, Wi-Fi checkedin seulement
- **Communications** : retire `body.session_token` fallback, header uniquement
- **Notifications** : supprime REST anon direct, mode démo avec bannière visible
- **Migration** : `veraluz_events` (idempotency, source, actor), `veraluz_notifications`, `veraluz_jobs` (enabled=false, dry_run=true)
- **PWA** : cache `veraluz-pwa-v037-lot-e`

### Pré-requis déploiement
1. Appliquer `20260828_recovery_lot_e_events_notifications_jobs.sql`
2. Déployer `guest-access` v12 et `communications-secure`
3. Fast-forward vers main

### Lot E — NON déployé
Validation manuelle Documents (11 fiches) encore en attente Blaise.
