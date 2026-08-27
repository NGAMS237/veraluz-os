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

### RECOVERY LOT D — Documents alignés sur le SSOT existant

**Branche** : `claude/recovery-lot-d-documents-ssot` — BASE : `0afdb5c`
**Statut** : PRÊT POUR DÉPLOIEMENT CIBLÉ — en attente autorisation Blaise

Table canonique : `veraluz_documents` (11 lignes réelles). Migration v2 écrite, dry-run PASS (ROLLBACK propre, anon_can_select=false confirmé).
Correctif : capture schéma PROD dans Git; accès anon fermé (REVOKE + zéro policy RLS); Edge Function `documents-secure` (validateSession + gerant uniquement); `DOCUMENTS_EMBEDDED.html` migré vers broker CORE; tokens VERALUZ Signature injectés.
Aucun système Documents parallèle. Aucune donnée modifiée.
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
