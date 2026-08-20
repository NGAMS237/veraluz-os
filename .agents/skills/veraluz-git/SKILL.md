# veraluz-git

Protocole Git pour le projet Résidence Veraluz.

## Règles absolues

- Ne jamais merger dans main sans autorisation explicite de Blaise.
- NE PAS déployer sans autorisation explicite.
- Ne demander aucune commande Git à Blaise.
- Ne pas utiliser Computer Use pour Git — utiliser bash uniquement.
- Ne pas créer de branche depuis main sans instruction.
- Le token GitHub ne doit JAMAIS être stocké dans l'URL remote permanente (`git remote set-url` avec token est interdit).
- Le token est éphémère : utilisé dans la commande push inline, jamais commité, jamais loggué.

## Workflow standard

1. Lire AI_HANDOFF.md pour connaître l'état actuel et la branche du lot courant.
2. Travailler sur la branche désignée par AI_HANDOFF (lots actifs).
3. Commit atomique par fonctionnalité, message en français structuré.
4. Push via token éphémère (voir ci-dessous).
5. Mettre à jour AI_HANDOFF.md avec le nouveau HEAD.
6. Ne jamais merger dans main sans autorisation explicite.

## Clone

```bash
git clone https://github.com/NGAMS237/veraluz-os.git /tmp/veraluz-os
cd /tmp/veraluz-os
# Checkout la branche du lot courant (voir AI_HANDOFF.md)
```

## Push authentifié (token éphémère — ne jamais modifier l'URL remote)

```bash
TOKEN=$(cat "/tmp/veraluz-os/token operation.txt" | tr -d '[:space:]')
git -C /tmp/veraluz-os push "https://x-access-token:${TOKEN}@github.com/NGAMS237/veraluz-os.git" <branche>
# L'URL avec token n'est JAMAIS stockée — elle est passée directement à git push.
# Après le push, vérifier que origin ne contient pas le token :
git -C /tmp/veraluz-os remote get-url origin  # doit être https://github.com/NGAMS237/veraluz-os.git
```

## État repo

main @ cd30985 (AUTH PHASE CLOSED — 2026-08-20)
Lire AI_HANDOFF.md pour l'état courant et la branche active.
