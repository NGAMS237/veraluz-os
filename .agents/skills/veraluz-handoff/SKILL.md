---
name: veraluz-handoff
description: Clôturer, abandonner ou transmettre un micro-lot VERALUZ après le travail de Claude ou Codex. Utiliser pour publier un état opérationnel court dans `AI_HANDOFF.md`, transmettre les preuves de validation et libérer le LOCK partagé sur `ai/coordination`.
---

# Transmettre un micro-lot VERALUZ

Lire `AGENTS.md`, `AI_COLLABORATION.md` et le dernier `AI_HANDOFF.md` de `ai/coordination`.

Après les tests et le push de la branche de travail :

1. récupérer le dernier état distant de `ai/coordination` et revérifier les LOCK;
2. ajouter ou mettre à jour une transmission courte;
3. retirer le LOCK du lot terminé, poussé ou abandonné;
4. pousser la mise à jour sur `ai/coordination`.

Utiliser le format :

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

Ajouter seulement lorsque pertinent : tests live effectués, DB read-back, problèmes connus et éléments restant non validés. Ne jamais laisser actif le LOCK d'un lot terminé ou abandonné.

Conserver les tâches actives et environ 10 transmissions récentes; suivre la règle d'archivage du protocole. Éviter les longs rapports sauf anomalie importante. Ce handoff n'autorise jamais une fusion vers `main`.
