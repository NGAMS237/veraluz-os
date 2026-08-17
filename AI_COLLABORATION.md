# Protocole de collaboration Claude–Codex

Ce document définit les règles communes de travail sur `NGAMS237/veraluz-os`.

## Principe général

- `main` reste la branche stable et protégée; aucun agent ne pousse directement dessus.
- Claude travaille uniquement sur des branches `claude/*` et Codex sur des branches `codex/*`.
- Les deux agents ne travaillent jamais simultanément sur la même branche.
- Toute tâche commence par la lecture de ce fichier, du dernier état de `AI_HANDOFF.md` et des LOCK actifs.
- Claude et Codex ne doivent pas implémenter simultanément le même lot, sauf demande explicite de Blaise.

Le fonctionnement normal est : `Agent A implémente → tests → handoff → Agent B review seulement si demandé`.

Une review ne doit pas réimplémenter le lot, sauf si un défaut est confirmé.

## Push et fusion

- Après ses tests et son handoff, Claude peut pousser normalement sa branche `claude/*`.
- Après ses tests et son handoff, Codex peut pousser normalement sa branche `codex/*`.
- Aucune nouvelle autorisation de Blaise n'est nécessaire pour un push normal sur la branche propre de l'agent.
- `git push --force` et toute réécriture de l'historique partagé sont interdits.
- La suppression d'une branche distante exige l'autorisation explicite de Blaise.
- Toute fusion vers `main` exige toujours l'autorisation explicite de Blaise.
- Une autorisation de travailler sur une tâche ne constitue jamais une autorisation de fusionner dans `main`.

## Cycle d'une tâche

1. Synchroniser le dépôt et partir de la version validée la plus récente.
2. Vérifier les LOCK actifs et créer une branche dédiée sur le préfixe de l'agent.
3. Ajouter un LOCK avant de modifier les fichiers ou zones concernés.
4. Apporter des changements ciblés sans écraser les travaux non liés.
5. Exécuter les tests et contrôles adaptés au risque.
6. Mettre à jour `AI_HANDOFF.md`, puis retirer le LOCK lorsque la tâche est terminée et poussée, ou abandonnée.
7. Pousser normalement la branche propre de l'agent; ne jamais pousser ni fusionner directement dans `main`.

## Réservation de fichiers et zones

Un LOCK actif utilise ce format :

`LOCK | agent | branche | tâche | fichiers/zones`

Exemple :

`LOCK | Codex | codex/guest-4a2 | GUEST-4A.2 | GUEST_PORTAL_EMBEDDED.html`

Règles :

- vérifier les LOCK actifs avant toute modification;
- ne jamais modifier une zone verrouillée par l'autre agent;
- si un conflit est nécessaire, arrêter et signaler le problème;
- retirer le LOCK quand la tâche est terminée et poussée, ou abandonnée;
- ne pas conserver un LOCK inactif dans la section des LOCK actifs.

## Répartition indicative

### Codex

- implémentation ciblée;
- corrections UI;
- bugs bien identifiés;
- tests;
- modifications répétitives ou mécaniques;
- commits et branches de travail.

### Claude

- architecture complexe;
- sécurité;
- Supabase ou SQL délicat;
- analyse de bugs difficiles;
- review ciblée des changements Codex lorsque nécessaire.

Cette répartition n'est pas absolue. Elle sert à éviter les doublons et à confier chaque lot à un seul agent responsable.

## Handoff court et opérationnel

Chaque transmission tient normalement sur une ligne au format :

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

`AI_HANDOFF.md` conserve principalement les transmissions actives et environ 10 transmissions récentes. Ne jamais effacer une information encore nécessaire à une tâche active. Lorsque l'historique devient trop long, déplacer les anciennes transmissions dans `docs/ai-history/AI_HANDOFF_ARCHIVE.md`; créer ce dossier et ce fichier seulement lorsque l'archivage devient nécessaire.

## Sécurité

- Ne jamais enregistrer de mot de passe, jeton, clé API ou identifiant privé dans Git.
- Ne jamais ajouter les fichiers locaux de secrets, notamment `token github.txt`, `token operation.txt` ou `credentiels emailjs.txt`.
- Ne jamais désactiver un contrôle de sécurité ou un test uniquement pour obtenir un résultat positif.
- En cas de conflit, de LOCK adverse ou de changement incompris, arrêter la modification et documenter le blocage.
