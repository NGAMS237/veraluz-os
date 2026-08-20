# veraluz-collab

Protocole de collaboration multi-agent pour le projet Résidence Veraluz.

## Agents participants

- **Claude** (Anthropic Cowork) — développement backend, EFs, sécurité, intégration.
- **Codex** (OpenAI) — développement frontend, patches HTML, tests statiques.
- **Blaise** (propriétaire) — autorisation merge/déploiement, validation humaine.

## Fichiers de coordination

- `AI_HANDOFF.md` — transmissions actives, LOCKs, lots en cours.
- `AI_COLLABORATION.md` — règles de collaboration et protocoles.

## Règles LOCK

- Un agent prend un LOCK sur une zone avant de modifier.
- LOCK déclaré dans AI_HANDOFF.md sous `## LOCK actifs`.
- Retirer le LOCK après commit + push.
- Ne jamais modifier une zone LOCKée par un autre agent.

## Format transmission

```
date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action
```

## Principe de non-interférence

- Chaque agent travaille sur des zones distinctes.
- Conflits résolus par Blaise uniquement.
- Aucun agent ne merge main sans autorisation explicite.
