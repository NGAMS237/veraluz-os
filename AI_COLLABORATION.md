# Protocole de collaboration Claude–Codex

Ce document définit les règles communes de travail sur `NGAMS237/veraluz-os`.

## Principe général

- `main` reste la branche stable et protégée; aucun agent ne pousse directement dessus.
- Claude travaille uniquement sur des branches `claude/*` et Codex sur des branches `codex/*`.
- Les deux agents ne travaillent jamais simultanément sur la même branche.
- Toute tâche métier commence par la lecture de ce fichier et par la consultation de l'état partagé sur `ai/coordination`.
- Claude et Codex ne doivent pas implémenter simultanément le même lot, sauf demande explicite de Blaise.

Le fonctionnement normal est : `Agent A implémente → tests → handoff → Agent B review seulement si demandé`.

Une review ne doit pas réimplémenter le lot, sauf si un défaut est confirmé.

## Push et fusion

- Après ses tests, Claude peut pousser normalement sa branche `claude/*`, puis finaliser le handoff sur `ai/coordination`.
- Après ses tests, Codex peut pousser normalement sa branche `codex/*`, puis finaliser le handoff sur `ai/coordination`.
- Aucune nouvelle autorisation de Blaise n'est nécessaire pour un push normal sur la branche propre de l'agent.
- Claude et Codex peuvent aussi pousser les seules métadonnées de coordination sur `ai/coordination` sans autorisation supplémentaire.
- Aucun push direct vers `main` n'est autorisé.
- `git push --force` et toute réécriture de l'historique partagé sont interdits.
- La suppression d'une branche distante exige l'autorisation explicite de Blaise.
- Aucune fusion vers `main` n'est autorisée sans l'autorisation explicite de Blaise.
- Une autorisation de travailler sur une tâche ne constitue jamais une autorisation de fusionner dans `main`.

## Branche partagée de coordination

La branche commune `ai/coordination` contient uniquement les métadonnées nécessaires à la coordination :

- les LOCK actifs;
- `AI_HANDOFF.md`;
- l'état des lots actifs.

Aucun code métier ne doit être développé sur `ai/coordination`. Le droit de pousser cette branche ne donne aucune autorisation de pousser ou de fusionner dans `main`.

## Procédure obligatoire avant modification métier

1. Fetch la branche distante `ai/coordination` et récupérer son dernier état.
2. Lire les LOCK actifs et l'état des lots dans `AI_HANDOFF.md` sur cette branche.
3. Vérifier que les fichiers ou zones nécessaires sont libres.
4. Ajouter le LOCK sur `ai/coordination`.
5. Pousser le LOCK sur la branche distante `ai/coordination`.
6. Commencer les modifications métier seulement après la réussite de ce push.

Un LOCK uniquement local n'est pas valide. Si le push échoue ou si la branche distante a changé, l'agent récupère le nouvel état, revérifie tous les LOCK et arrête en cas de conflit.

Le code métier reste sur la branche de travail `claude/*` ou `codex/*`, jamais sur `ai/coordination`.

## Fin de lot

Après les tests et le push de la branche de travail :

1. mettre à jour `AI_HANDOFF.md` et l'état du lot sur `ai/coordination`;
2. retirer le LOCK du lot terminé ou abandonné;
3. pousser la mise à jour sur la branche distante `ai/coordination`.

Un LOCK abandonné ne doit jamais rester actif.

## Réservation de fichiers et zones

Un LOCK actif utilise ce format :

`LOCK | agent | branche | tâche | fichiers/zones`

Exemple :

`LOCK | Codex | codex/guest-4a2 | GUEST-4A.2 | GUEST_PORTAL_EMBEDDED.html`

Règles :

- vérifier les LOCK actifs avant toute modification;
- ne jamais modifier une zone verrouillée par l'autre agent;
- si un conflit est nécessaire, arrêter et signaler le problème;
- considérer uniquement un LOCK poussé sur `ai/coordination` comme valide;
- retirer le LOCK après les tests et le push de la branche de travail, ou dès l'abandon du lot;
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

La version de référence de `AI_HANDOFF.md` se trouve sur `ai/coordination`. Elle conserve principalement les tâches actives et environ 10 transmissions récentes. Ne jamais effacer une information encore nécessaire à une tâche active. Lorsque l'historique devient trop long, déplacer les anciennes transmissions dans `docs/ai-history/AI_HANDOFF_ARCHIVE.md`; créer ce dossier et ce fichier seulement lorsque l'archivage devient nécessaire.

## Sécurité

- Ne jamais enregistrer de mot de passe, jeton, clé API ou identifiant privé dans Git.
- Ne jamais ajouter les fichiers locaux de secrets, notamment `token github.txt`, `token operation.txt` ou `credentiels emailjs.txt`.
- Ne jamais désactiver un contrôle de sécurité ou un test uniquement pour obtenir un résultat positif.
- En cas de conflit, de LOCK adverse ou de changement incompris, arrêter la modification et documenter le blocage.
