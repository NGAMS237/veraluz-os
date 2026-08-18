---
name: veraluz-implement-lot
description: Implémenter un micro-lot VERALUZ clairement défini avec changements minimaux, tests proportionnés et coordination par LOCK. Utiliser quand Codex doit corriger un bug identifié, réaliser une petite évolution ciblée ou appliquer une modification mécanique dans le dépôt VERALUZ.
---

# Implémenter un micro-lot VERALUZ

1. Lire `AGENTS.md`, puis respecter le scope exact du lot. Ne pas lancer d'audit global.
2. Appliquer la procédure partagée : récupérer `ai/coordination`, vérifier les LOCK, poser le LOCK du lot et le pousser avant toute modification. Ne jamais travailler avec un LOCK seulement local.
3. Identifier les sources de vérité existantes avant d'éditer. Les préserver et ne pas créer une deuxième source métier concurrente.
4. Modifier uniquement ce qui est nécessaire au lot; préserver les changements non liés.
5. Ne jamais contourner une règle de sécurité, une permission ou un test pour obtenir un résultat PASS.

## Valider

- Exécuter les tests statiques ou automatisés adaptés au changement.
- Si la base est concernée, effectuer un DB read-back vérifiable après l'écriture autorisée.
- Si une fonctionnalité UI doit fonctionner réellement, effectuer un test navigateur/live; inclure le mobile lorsque le lot le requiert.
- Distinguer explicitement tests statiques, tests automatisés, DB read-back et validation live. Un PASS statique ne prouve pas le comportement réel.
- Documenter ce qui n'a pas pu être validé.

## Clôturer

Committer et pousser uniquement la branche de travail de l'agent. Ne jamais pousser directement ni autoriser soi-même une fusion vers `main`.

Après le push et les tests, utiliser le handoff VERALUZ : mettre à jour `AI_HANDOFF.md` sur `ai/coordination`, retirer le LOCK et pousser la coordination.
