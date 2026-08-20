# AI_COLLABORATION.md — Résidence Veraluz

Règles de collaboration entre agents IA et propriétaire (Blaise).

## Principe général

Claude et Codex travaillent en parallèle sur des zones distinctes.
Blaise est l'unique autorité pour les merges et déploiements en production.

## Fichiers de coordination

| Fichier | Rôle |
|---------|------|
| `AI_HANDOFF.md` | Transmissions actives, LOCKs, lots en cours |
| `AI_COLLABORATION.md` | Ce fichier — règles permanentes |
| `.agents/skills/veraluz-dev` | Contexte projet + principes archi |
| `.agents/skills/veraluz-git` | Protocole Git |
| `.agents/skills/veraluz-collab` | Protocole collaboration |

## Protocole LOCK

Un agent prend un LOCK avant de modifier une zone critique :

```
LOCK | agent | branche | tâche | fichiers/zones
```

- Déclaré dans `AI_HANDOFF.md > ## LOCK actifs`
- Retiré après commit + push confirmé
- Pas de modification d'une zone LOCKée par un autre agent

## Protocole de transmission

Format dans `AI_HANDOFF.md > ## Transmissions récentes` :

```
date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action
```

Conserver les 10 transmissions les plus récentes.

## Zones de responsabilité

### Claude
- Edge Functions (supabase/functions/)
- Backend SQL (migrations)
- AUTH_EMBEDDED.html (sécurité/RBAC)
- Intégration multi-modules

### Codex
- Patches frontend HTML/JS
- Tests statiques
- UI non-sécurité

### Blaise
- Autorisation merge main
- Autorisation déploiement production
- Validation humaine

## Règles de sécurité partagées

- Aucun PIN réel dans les tests, fixtures ou logs
- Aucun hash de PIN affiché dans l'UI
- Aucune impersonation d'employé
- Sessions validées côté serveur uniquement (X-Veraluz-Session header)
- Le broker CORE injecte session_token dans le body — les EFs doivent le supprimer

## État courant (2026-08-20)

Branche active : `claude/auth-final-integration` @ `167d400`
Base : main @ `76e618d`
EF active : employees-secure v4 (ACTIVE, dfdmasejsoibxrvubegu)
