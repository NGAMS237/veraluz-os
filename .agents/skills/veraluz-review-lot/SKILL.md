---
name: veraluz-review-lot
description: Examiner en lecture seule un commit, une branche ou un micro-lot VERALUZ déjà réalisé par Claude ou Codex. Utiliser pour vérifier le diff réel, le respect du scope, les preuves de test, les sources canoniques et les risques pertinents avant une décision ou une correction séparée.
---

# Revoir un micro-lot VERALUZ

Rester READ-ONLY par défaut. Une review ne devient une correction que sur demande explicite.

1. Identifier la branche, le commit de base, le commit cible et les fichiers modifiés.
2. Lire `AGENTS.md` et inspecter le vrai diff entre la base et la cible.
3. Vérifier que chaque changement appartient au scope annoncé et que les sources de vérité canoniques restent uniques.
4. Examiner uniquement les régressions, permissions et risques de sécurité pertinents au lot.
5. Vérifier les commandes et preuves des tests réellement exécutés; ne pas déduire une validation absente.

## Classer les preuves

Distinguer clairement :

- code présent;
- test automatisé;
- DB read-back;
- test navigateur/live;
- validation mobile;
- éléments non prouvés.

Présenter les constats par priorité avec leur emplacement et leur impact. Ne pas réimplémenter le lot pendant la review. Si une suite est nécessaire, proposer seulement le prochain micro-lot ciblé; corriger uniquement après demande explicite.
