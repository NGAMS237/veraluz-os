# veraluz-git

Protocole Git pour le projet Résidence Veraluz.

## Règles absolues

- NE PAS MERGER claude/auth-final-integration dans main sans autorisation Blaise.
- NE PAS déployer sans autorisation explicite.
- Ne demander aucune commande Git à Blaise.
- Ne pas utiliser Computer Use pour Git — utiliser bash uniquement.
- Ne pas créer de branche depuis main sans instruction.
- Le token GitHub ne doit JAMAIS être stocké dans l'URL remote permanente (`git remote set-url` avec token est interdit).
- Le token est éphémère : utilisé dans la commande push inline, jamais commité, jamais loggué.

## Workflow standard

1. Lire AI_HANDOFF.md pour connaître l'état actuel.
2. Travailler sur la branche désignée (actuellement `claude/auth-final-integration`).
3. Commit atomique par fonctionnalité, message en français structuré.
4. Push via token éphémère (voir ci-dessous).
5. Mettre à jour AI_HANDOFF.md avec le nouveau HEAD.
6. Ne jamais merger sans autorisation explicite.

## Clone (si index.lock bloqué sur OneDrive)

```bash
git clone --no-local https://github.com/NGAMS237/veraluz-os.git /tmp/veraluz-os
cd /tmp/veraluz-os
git checkout claude/auth-final-integration
```

## Push authentifié (token éphémère — ne jamais modifier l'URL remote)

```bash
TOKEN=$(cat "/tmp/veraluz-os/token operation.txt" | tr -d '[:space:]')
git -C /tmp/veraluz-os push "https://x-access-token:${TOKEN}@github.com/NGAMS237/veraluz-os.git" <branche>
# L'URL avec token n'est JAMAIS stockée — elle est passée directement à git push.
# Après le push, vérifier que origin ne contient pas le token :
git -C /tmp/veraluz-os remote get-url origin  # doit être https://github.com/NGAMS237/veraluz-os.git
```

## État actuel

Branche : claude/auth-final-integration
HEAD : à mettre à jour dans AI_HANDOFF.md après chaque push
Base : main @ 76e618d (merge AUTH-FINAL-INTEGRATION)
