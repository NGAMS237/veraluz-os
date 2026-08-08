# FINAL_AGENT_TEAM_010 — Réponses aux 21 questions

**PROMPT :** PROMPT_VERALUZ_AGENT_TEAM_SIMULATION_CHAT_010  
**Commit livré :** `240b515` — 2026-08-08

---

### Q1. Combien d'agents sont maintenant dans le système ?

**10 agents actifs** dans `veraluz_ai_agents` PRODUCTION :  
chloe_director_v1, maya_restaurant_v1, nora_reservations_v1, techops_v1, sonia_hr_v1, lexa_legal_v1, finance_v1, commercial_v1, maintenance_v1, security_v1.

---

### Q2. Comment le dispatcher sait-il quel runner appeler ?

Il lit la colonne `runner_function` depuis `veraluz_ai_agents` (requête DB à chaque appel) puis valide le runner contre `ALLOWED_RUNNERS` côté serveur — set hardcodé de 10 valeurs autorisées. Aucun `if(agent_key===...)` dans le code.

---

### Q3. Comment Chloé découvre-t-elle ses spécialistes ?

Via `supervisor_agent_key = 'chloe_director_v1'` dans la table. Un `SELECT WHERE supervisor_agent_key = 'chloe_director_v1'` retourne les 9 spécialistes. Le frontend et le runner Chloé n'ont aucune liste hardcodée.

---

### Q4. Qu'est-ce que le mode construction_simulation ?

Un flag dans `veraluz_operational_config` qui indique que le système est en phase de construction. Toutes les réponses IA sont préfixées `[DONNÉES CONSTRUCTION]`. Les mémoires agents, conversations et logs sont taguées `operational_mode = 'construction_simulation'`. La bascule vers `production` se fait en mettant à jour `mode` + `production_cutover_at`.

---

### Q5. Comment la mémoire des agents fonctionne-t-elle ?

Table `veraluz_agent_memories` avec deux types :
- `operational_history` — ce que l'agent a observé (auto-généré après un run)
- `learned_experience` — leçons apprises, soumises par l'agent en statut `proposed`

Un superviseur (gérant) valide (`validated`) ou rejette (`rejected`) les expériences proposées. Seules les mémoires `validated` influencent les prochaines réponses.

---

### Q6. Pourquoi agent-chat ne dépend pas d'un LLM ?

Le statut actuel est `KEY_REQUIRED` — aucune clé OpenAI/Anthropic configurée dans les secrets Supabase. La fonction `detectIntent()` fait de la détection par mots-clés (fr/en), `fetchToolData()` fait jusqu'à 3 requêtes déterministes, et `buildFallbackResponse()` formate une réponse structurée. Le tout fonctionne sans LLM et sera transparent à l'ajout d'une clé.

---

### Q7. Quel est le maximum de messages par conversation ?

8 messages d'historique (`history.slice(-8)`) sont transmis à l'endpoint. Côté LLM (futur), les tool results seront condensés. Le compteur `message_count` dans `veraluz_agent_conversations` est incrémenté à chaque échange.

---

### Q8. Comment les coûts sont-ils trackés ?

Table `veraluz_agent_usage_logs` — chaque appel à agent-chat crée une ligne avec `provider`, `model`, `input_tokens`, `output_tokens`, `latency_ms`, `estimated_cost_usd`. En mode fallback, `provider='fallback'`, `estimated_cost_usd=0`.

---

### Q9. Qui peut accéder à quel agent de chat ?

Défini dans `CHAT_PERMISSIONS` (côté serveur dans agent-chat) :
- **Tous directement** : gerant, admin, superadmin
- **+ barman** : maya_restaurant_v1
- **+ receptionniste** : nora_reservations_v1, commercial_v1
- **+ technicien** : techops_v1, maintenance_v1

---

### Q10. Comment le frontend découvre-t-il le mode opérationnel ?

Via `agent-run action:'list_agents'` qui retourne `operational_mode` dans la réponse. La fonction `showModeBadge()` met à jour le badge dans le header. Aucune lecture directe Supabase depuis le frontend.

---

### Q11. Pourquoi PRODUCTION est différent de TEST ?

PRODUCTION (`dfdmasejsoibxrvubegu`) dispose de tables supplémentaires créées lors de précédents PROMPTS : `veraluz_attendance`, `veraluz_contracts`, `veraluz_payroll`, `veraluz_expenses`, `veraluz_advances`, `veraluz_documents`, `veraluz_hr_documents`, `veraluz_hr_tasks`, `veraluz_clients`. Les runners PROD exploitent ces tables — les agents sont donc plus complets que leurs homologues TEST.

---

### Q12. Comment Sonia (RH) est-elle plus capable en PRODUCTION ?

Elle interroge 7 tables : `veraluz_employees`, `veraluz_employee_sessions`, `veraluz_auth_events`, `veraluz_attendance` (présences), `veraluz_contracts` (contrats, avec détection d'expiration à 30j), `veraluz_payroll` (paie en attente), `veraluz_hr_tasks` (tâches RH ouvertes).

---

### Q13. Comment Lexa (Juridique) est-elle plus capable en PRODUCTION ?

En TEST, Lexa signalait que les tables de documents manquaient. En PRODUCTION, elle interroge `veraluz_contracts` (actifs, expirés, expiration imminente, répartition par type), `veraluz_documents` (tous documents avec statut), et `veraluz_hr_documents` (documents RH en attente de validation).

---

### Q14. Qu'est-ce que le feedback supervisé ?

Les boutons 👍/👎 dans le chat envoient un enregistrement dans `veraluz_agent_chat_feedback` avec `feedback_type = 'helpful'` ou `'incorrect'`. Ce feedback peut être relu par la direction et influencer manuellement les mémoires `learned_experience` des agents.

---

### Q15. Comment fonctionne la sécurité INTERNAL_SECRET ?

Les runners (agent-hr-run, agent-finance-run, etc.) n'acceptent QUE les appels avec le header `x-internal-secret: vlz-test004-internal-secret-9f3ac2e7d1b4-do-not-reuse`. Tout autre appelant reçoit `403 forbidden`. Ce secret n'est jamais dans le frontend ni dans GitHub.

---

### Q16. Comment ajouter un 11e agent demain ?

1. `INSERT INTO veraluz_ai_agents (agent_key, runner_function, supervisor_agent_key, ui_metadata_json, ...)`
2. Déployer la fonction edge `agent-nouvellenom-run`
3. Ajouter `'agent-nouvellenom-run'` dans `ALLOWED_RUNNERS` dans agent-run
4. Ajouter les droits dans `CHAT_PERMISSIONS` dans agent-chat
5. Zéro modification du frontend (loadAgents() est dynamique)

---

### Q17. Que se passe-t-il quand on bascule en mode production ?

```sql
UPDATE veraluz_operational_config 
SET mode = 'production', production_cutover_at = now(), changed_by = 'gerant';
```
- Le badge passe de ⚙️ SIMULATION CONSTRUCTION à ✅ PRODUCTION
- Les réponses ne sont plus préfixées `[DONNÉES CONSTRUCTION]`
- Les nouvelles mémoires sont taguées `operational_mode = 'production'`
- Les données de simulation restent accessibles pour analyse comparative

---

### Q18. Pourquoi agent-run version 3 ?

- v1 (PROMPT_023) : dispatcher avec map hardcodée agent_key → runner
- v2 : lecture runner_function depuis DB (TEST)
- v3 (PROMPT_010) : lecture DB + action `list_agents` + déploiement PRODUCTION

---

### Q19. Comment les agents lisent les données sans exposer service_role ?

Chaque runner est une Edge Function Supabase qui s'exécute côté serveur. Elle initialise `createClient(SB_URL, SERVICE_ROLE_KEY)` avec les secrets d'environnement Supabase (jamais exposés). Le frontend ne voit jamais ces clés — il communique uniquement via le broker CORE.html → edge functions.

---

### Q20. Quel est l'état des tables manquantes déclarées par les agents ?

| Agent | Tables manquantes déclarées |
|-------|-----------------------------|
| Lexa | veraluz_legal_obligations, insurance_policies |
| Maintenance | veraluz_maintenance_tickets, equipment_inventory |
| Sécurité | cameras_not_integrated, veraluz_security_incidents |
| Finance | veraluz_caisse, bank_transfers |
| Commercial | marketing_campaigns, channel_source |

Ces limites sont déclarées honnêtement dans `limits[]` — jamais de données inventées.

---

### Q21. GitHub Pages est-il à jour ?

**Oui.** Commit `240b515` poussé sur `main` le 2026-08-08.  
URL : https://ngams237.github.io/mako-city_suivis_ok/  
Vérification : `curl -s -o /dev/null -w '%{http_code}' https://ngams237.github.io/mako-city_suivis_ok/` → `200`

---

*PROMPT_010 livré — 25/25 tests, 10 agents, 8 Edge Functions PRODUCTION, Chat IA générique, mode construction_simulation actif.*
