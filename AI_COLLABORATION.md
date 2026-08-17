# Protocole de collaboration Claude–Codex

Ce document définit les règles communes de travail sur `NGAMS237/veraluz-os`.

## Principe général

- `main` reste la branche stable et protégée.
- Claude travaille sur des branches préfixées par `claude/`.
- Codex travaille sur des branches préfixées par `codex/`.
- Les deux agents ne travaillent jamais simultanément sur la même branche.
- Toute nouvelle tâche commence par la lecture de ce fichier et de `AI_HANDOFF.md`.
- Avant de modifier un fichier, l'agent vérifie les changements récents et les zones réservées par l'autre agent.

## Cycle obligatoire d'une tâche

1. Synchroniser le dépôt et partir de la version validée la plus récente.
2. Créer ou utiliser une branche dédiée à une seule tâche clairement nommée.
3. Examiner les fichiers concernés avant toute modification.
4. Apporter des changements ciblés sans écraser les travaux non liés.
5. Exécuter les tests et contrôles adaptés au risque.
6. Mettre à jour `AI_HANDOFF.md` avec le résultat et les prochaines étapes.
7. Présenter au propriétaire les changements, les tests, les risques et les fichiers touchés.
8. Demander l'autorisation explicite du propriétaire avant tout push vers GitHub.
9. Demander une nouvelle autorisation explicite avant toute fusion dans `main`.

Une autorisation de modifier localement ne vaut pas autorisation de pousser ou de fusionner.

## Règles de sécurité

- Ne jamais enregistrer de mot de passe, jeton, clé API ou identifiant privé dans Git.
- Ne jamais ajouter les fichiers locaux de secrets, notamment `token github.txt`, `token operation.txt` ou `credentiels emailjs.txt`.
- Ne jamais forcer un push, réécrire l'historique partagé ou supprimer une branche sans autorisation explicite.
- Ne jamais désactiver un contrôle de sécurité ou un test uniquement pour obtenir un résultat positif.
- En cas de conflit ou de changement incompris, arrêter la modification et documenter le blocage.

## Transmission entre agents

Chaque transmission dans `AI_HANDOFF.md` précise au minimum :

- la date et l'agent;
- la branche et la tâche;
- le statut (`en cours`, `prêt pour validation`, `poussé`, `fusionné` ou `bloqué`);
- les fichiers modifiés;
- les tests exécutés et leurs résultats;
- les risques ou problèmes connus;
- la prochaine action recommandée;
- les fichiers ou zones à ne pas modifier pendant une tâche en cours.

L'agent suivant lit la dernière transmission avant de commencer et ajoute une nouvelle entrée sans effacer l'historique utile.
