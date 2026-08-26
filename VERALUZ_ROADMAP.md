# VERALUZ OS — Feuille de route canonique

Dernière mise à jour : 2026-08-26

Ce document conserve l'ordre de travail entre les conversations et les agents.
Le dépôt GitHub et l'état PROD vérifié restent les vérités techniques.

## Méthode obligatoire

`audit → petit lot → tests → merge ciblé → déploiement ciblé → smoke live → validation humaine → lot suivant`

- Aucun big-bang merge ou déploiement.
- Aucun merge vers `main` sans autorisation explicite de Blaise.
- Aucun déploiement PROD sans autorisation explicite de Blaise.
- Préserver les flux déjà validés en production.
- Une donnée = une source canonique ; ne pas créer de système parallèle.

## Lots de récupération

### RECOVERY LOT A — TERMINÉ ET VALIDÉ LIVE

Auth, sessions, RH, pointage, Analytics, Livreur et anciens caches/frontends.

### RECOVERY LOT B / B.1 — TERMINÉ ET VALIDÉ LIVE

Réservations, Planning, overstay, occupation basée sur `status=checkedin`, checkout manuel et ménage atomique/idempotent.

### RECOVERY LOT C — ACTIF

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

Aligner la migration Documents avec la table canonique existante. Aucun système Documents parallèle.
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
