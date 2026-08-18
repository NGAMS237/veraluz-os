---
name: veraluz-live-validation
description: Valider réellement un micro-lot VERALUZ lorsque les tests statiques ou automatisés ne suffisent pas. Utiliser pour une fonctionnalité UI, un flux authentifié, une permission, une écriture Supabase ou tout comportement nécessitant une observation navigateur, mobile, backend ou base de données.
---

# Valider un lot VERALUZ en réel

Lire `AGENTS.md`, confirmer le scope et ne tester que les surfaces concernées.

Règle fondamentale : `tests automatisés PASS ≠ validation live PASS`.

Selon le lot, vérifier réellement :

- le parcours dans un navigateur réel;
- desktop et mobile lorsque pertinent;
- le DB read-back Supabase après une écriture autorisée;
- la cohérence backend ↔ UI;
- la cohérence entre deux modules lorsque le lot les relie;
- l'authentification, la session et les permissions;
- les états loading, error et empty lorsqu'ils sont concernés.

Ne jamais déclarer une fonctionnalité visuelle terminée sans test visuel ou navigateur lorsqu'il est requis. Ne pas confondre présence du code, test automatisé et observation réelle.

## Rapport

Indiquer brièvement : environnement testé, étapes exécutées, comportement réellement observé, preuves disponibles, écarts constatés et éléments non validés. Signaler un blocage au lieu de transformer une absence de preuve en PASS.
