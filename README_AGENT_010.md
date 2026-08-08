# VERALUZ OS — PROMPT_010 : Équipe IA Complète + Chat Générique

**Commit :** `240b515`  
**Date :** 2026-08-08  
**Supabase PRODUCTION :** `dfdmasejsoibxrvubegu`  
**GitHub Pages :** https://ngams237.github.io/mako-city_suivis_ok/

---

## Ce qui a été livré

### 1. Registre dynamique — 10 agents opérationnels

Le champ `runner_function` dans `veraluz_ai_agents` élimine tout hardcoding frontend/dispatcher.  
Le champ `supervisor_agent_key` permet à Chloé de découvrir ses spécialistes dynamiquement.

| agent_key | Display | Runner | Rôles autorisés |
|-----------|---------|--------|-----------------|
| `chloe_director_v1` | Directrice Chloé | agent-chloe-run | gerant, admin, superadmin |
| `maya_restaurant_v1` | Maya | agent-restaurant-run | + barman |
| `nora_reservations_v1` | Nora | agent-reservations-run | + receptionniste |
| `techops_v1` | TechOps | agent-techops-run | + technicien |
| `sonia_hr_v1` | Sonia | agent-hr-run | gerant, admin, superadmin |
| `lexa_legal_v1` | Lexa | agent-legal-run | gerant, admin, superadmin |
| `finance_v1` | Finance | agent-finance-run | gerant, admin, superadmin |
| `commercial_v1` | Commercial | agent-commercial-run | + receptionniste |
| `maintenance_v1` | Maintenance | agent-maintenance-run | + technicien |
| `security_v1` | Sécurité | agent-security-run | gerant, admin, superadmin |

### 2. Mode opérationnel

Table `veraluz_operational_config` — valeur initiale : `construction_simulation`.  
Le badge ⚙️ SIMULATION CONSTRUCTION s'affiche dans le header de l'AI Center.  
La coupure vers `production` se fait via `production_cutover_at` (timestamp).  
Toutes les données mémoire et conversations sont taguées avec le mode actif.

### 3. Edge Functions déployées en PRODUCTION

| Fonction | Version | Rôle |
|----------|---------|------|
| `agent-run` | v3 | Dispatcher dynamique + action `list_agents` |
| `agent-chat` | v1 | Chat générique — toutes les IA en un endpoint |
| `agent-hr-run` | v1 (enhanced) | Sonia — attendance, contracts, payroll, hr_tasks |
| `agent-legal-run` | v1 (enhanced) | Lexa — contracts, documents, hr_documents |
| `agent-finance-run` | v1 (enhanced) | Finance — reservations, expenses, advances, payroll |
| `agent-commercial-run` | v1 (enhanced) | Commercial — reservations, units, clients |
| `agent-maintenance-run` | v1 | Maintenance — units, housekeeping |
| `agent-security-run` | v1 | Sécurité — auth_events, employee_sessions |

**Sécurité :** tous les runners n'acceptent que `x-internal-secret`. Jamais exposés directement.

### 4. Tables SQL créées en PRODUCTION

- `veraluz_operational_config` — mode opérationnel + timestamp de bascule
- `veraluz_agent_conversations` — sessions de chat par employé + agent
- `veraluz_agent_messages` — messages utilisateur + assistant avec sources
- `veraluz_agent_usage_logs` — tracking tokens, latence, coût estimé
- `veraluz_agent_memories` — mémoire opérationnelle + expérience supervisée
- `veraluz_agent_chat_feedback` — retours 👍/👎 sur les réponses

### 5. Frontend AI_CENTER_EMBEDDED.html

**Nouveautés :**
- **Badge mode opérationnel** — affiché dans le header, met à jour dynamiquement
- **Onglet 💬 Chat IA** — sélecteur d'agent + thread conversationnel + input
- **Quick actions** — boutons de suggestion au démarrage d'un chat
- **Feedback 👍/👎** — sur chaque réponse assistant
- **loadAgents() v010** — appelle `agent-run action:list_agents`, fallback `agent-foundation-read`
- **manifestFromRow()** — gère les deux formats : legacy (manifest_version) + nouveau (runner_function)
- **DEMO_AGENT_ROWS** — mis à jour avec les 10 agents et les bons agent_keys
- **Workspace** — bouton "Ouvrir le chat" câblé sur l'onglet Chat

### 6. LLM Provider

Statut actuel : `KEY_REQUIRED` — aucune clé API configurée.  
Fallback structurel actif : détection d'intent par mots-clés + requêtes déterministes Supabase.  
Toutes les réponses sont préfixées `[DONNÉES CONSTRUCTION]` en mode simulation.  
L'architecture est prête pour brancher OpenAI/Anthropic/Mistral sans modifier le frontend.

---

## Architecture de sécurité

```
Browser (AI Center iframe)
    ↓ window.parent.veraluzSecureRequest()
CORE.html (broker — ajoute session_token)
    ↓ fetch() avec Authorization header
agent-run (dispatcher — valide session, lit runner_function depuis DB)
    ↓ fetch() avec x-internal-secret UNIQUEMENT
agent-hr-run / agent-finance-run / ... (runners — jamais exposés directement)
    ↓ createClient(SB_URL, SERVICE_ROLE_KEY) — server-side only
Supabase PostgreSQL (RLS + service_role côté serveur uniquement)
```

**Règles immuables respectées :**
- Aucune clé `service_role` dans le frontend ou GitHub
- Aucune URL arbitraire acceptée du navigateur
- Aucun accès direct table depuis le client anon
- Aucun force-push, aucune suppression de données

---

## Tests

**25/25 ✅** (exécutés en CI le 2026-08-08)

- T01–T05 : agent-run dispatcher (list_agents, erreurs, sécurité)
- T06–T07 : intégrité registre DB (runner_function, supervisor_agent_key)
- T08–T09 : agent-chat endpoint (activation, protection session)
- T10–T15 : 6 runners protégés par INTERNAL_SECRET
- T16–T20 : cohérence DB (operational_config, conversations, ui_metadata)
- T21–T25 : GitHub (sec-chat, mode badge, renderChat, sendChatMessage)
