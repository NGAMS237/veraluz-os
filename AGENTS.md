# AGENTS.md — Résidence Veraluz

Règles et protocoles pour tous les agents IA travaillant sur ce repo.

## Agents autorisés

- **Claude** (Anthropic) — backend, Edge Functions, sécurité, intégration
- **Codex** (OpenAI) — frontend, patches HTML/JS, tests

## Règles universelles

1. Lire `AI_HANDOFF.md` avant toute action.
2. Respecter les LOCKs actifs — ne pas toucher une zone réservée.
3. NE PAS MERGER main sans autorisation Blaise.
4. NE PAS déployer sans autorisation Blaise.
5. Pas de PIN partagé/hardcodé/plaintext. Pas de hash affiché.
6. Aucune impersonation d'employé réel.
7. Mettre à jour AI_HANDOFF.md après chaque commit/push.

## Skills disponibles

- `.agents/skills/veraluz-dev` — contexte projet + principes archi
- `.agents/skills/veraluz-git` — protocole Git
- `.agents/skills/veraluz-collab` — protocole collaboration multi-agent

## Format de commit

```
type(scope): description courte en français

- détail 1
- détail 2
```

Types : feat, fix, refactor, test, docs, chore
