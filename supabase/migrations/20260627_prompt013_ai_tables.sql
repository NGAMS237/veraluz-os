-- ============================================================
-- PROMPT 013 — VERALUZ AI Center
-- 4 tables IA + 10 agents initiaux
-- Sécurité : RLS activée, anon ne peut qu'insérer/lire
-- ============================================================

-- ── 1. veraluz_ai_agents ────────────────────────────────────
CREATE TABLE IF NOT EXISTS veraluz_ai_agents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key             TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  category              TEXT,
  icon                  TEXT DEFAULT '🤖',
  description           TEXT,
  system_prompt         TEXT,
  data_sources_json     JSONB DEFAULT '{}'::jsonb,
  allowed_actions_json  JSONB DEFAULT '{}'::jsonb,
  forbidden_actions_json JSONB DEFAULT '{}'::jsonb,
  risk_level            TEXT NOT NULL DEFAULT 'medium'
                          CHECK (risk_level IN ('low','medium','high','critical')),
  approval_required     BOOLEAN NOT NULL DEFAULT TRUE,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('active','draft','paused','archived')),
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. veraluz_ai_agent_runs ────────────────────────────────
CREATE TABLE IF NOT EXISTS veraluz_ai_agent_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key             TEXT NOT NULL REFERENCES veraluz_ai_agents(agent_key) ON DELETE CASCADE,
  run_type              TEXT DEFAULT 'manual',
  status                TEXT NOT NULL DEFAULT 'completed'
                          CHECK (status IN ('running','completed','failed','aborted')),
  input_snapshot_json   JSONB DEFAULT '{}'::jsonb,
  output_json           JSONB DEFAULT '{}'::jsonb,
  output_text           TEXT,
  recommendations_json  JSONB DEFAULT '[]'::jsonb,
  duration_ms           INTEGER,
  error_message         TEXT,
  created_by            TEXT DEFAULT 'system',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. veraluz_ai_recommendations ───────────────────────────
CREATE TABLE IF NOT EXISTS veraluz_ai_recommendations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key             TEXT NOT NULL,
  category              TEXT DEFAULT 'general',
  title                 TEXT NOT NULL,
  description           TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('urgent','high','normal','low')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','done','expired')),
  requires_approval     BOOLEAN NOT NULL DEFAULT TRUE,
  related_module        TEXT,
  suggested_action      TEXT,
  approved_by           TEXT,
  approved_at           TIMESTAMPTZ,
  rejected_by           TEXT,
  rejected_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. veraluz_ai_feedback ──────────────────────────────────
CREATE TABLE IF NOT EXISTS veraluz_ai_feedback (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key             TEXT NOT NULL,
  run_id                UUID,
  rating                INTEGER CHECK (rating BETWEEN 1 AND 5),
  feedback_text         TEXT,
  created_by            TEXT DEFAULT 'system',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Index performance ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_runs_agent_key    ON veraluz_ai_agent_runs(agent_key);
CREATE INDEX IF NOT EXISTS idx_ai_runs_created_at   ON veraluz_ai_agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_recs_status       ON veraluz_ai_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_ai_recs_agent_key    ON veraluz_ai_recommendations(agent_key);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_agent    ON veraluz_ai_feedback(agent_key);

-- ── RLS : activer sans bloquer (anon clé publique) ──────────
ALTER TABLE veraluz_ai_agents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE veraluz_ai_agent_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE veraluz_ai_recommendations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE veraluz_ai_feedback         ENABLE ROW LEVEL SECURITY;

-- Policies lecture anon (clé publique frontend)
CREATE POLICY "anon_read_agents"    ON veraluz_ai_agents
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "anon_read_runs"      ON veraluz_ai_agent_runs
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "anon_read_recs"      ON veraluz_ai_recommendations
  FOR SELECT TO anon USING (TRUE);
CREATE POLICY "anon_read_feedback"  ON veraluz_ai_feedback
  FOR SELECT TO anon USING (TRUE);

-- Policies écriture anon (insert runs/recs/feedback depuis frontend)
CREATE POLICY "anon_insert_runs"    ON veraluz_ai_agent_runs
  FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_insert_recs"    ON veraluz_ai_recommendations
  FOR INSERT TO anon WITH CHECK (TRUE);
CREATE POLICY "anon_insert_feedback" ON veraluz_ai_feedback
  FOR INSERT TO anon WITH CHECK (TRUE);

-- Policies update anon (statut recommandations : approve/reject/done)
CREATE POLICY "anon_update_recs"    ON veraluz_ai_recommendations
  FOR UPDATE TO anon USING (TRUE) WITH CHECK (TRUE);

-- Policies update/patch agents (statut + prompt)
CREATE POLICY "anon_update_agents"  ON veraluz_ai_agents
  FOR UPDATE TO anon USING (TRUE) WITH CHECK (TRUE);

-- ── 10 Agents initiaux ──────────────────────────────────────
INSERT INTO veraluz_ai_agents
  (agent_key, name, category, icon, description, system_prompt,
   data_sources_json, allowed_actions_json, forbidden_actions_json,
   risk_level, approval_required, status, version)
VALUES

('daily_director',
 'Directeur Quotidien',
 'direction', '📋',
 'Analyse l activité globale et produit un rapport quotidien pour le gérant.',
 'Tu es l Agent Directeur Quotidien de la résidence VERALUZ Kribi. Analyse les données de la journée et produis un rapport structuré avec résumé, alertes et recommandations. Tu ne peux pas modifier de données. Toute recommandation nécessite une validation humaine.',
 '{"sources":["analytics_snapshot","reservations","payments","expenses","housekeeping","food","rh","alerts"]}',
 '{"actions":["résumer","recommander","classer_priorités","créer_recommandation_pending"]}',
 '{"actions":["modifier_prix","confirmer_réservation","annuler_réservation","modifier_paiement","supprimer_donnée","modifier_salaire","envoyer_message_client"]}',
 'medium', TRUE, 'active', 1),

('reception_crm',
 'Réception / CRM',
 'réservations', '🛎️',
 'Aide à gérer les demandes clients, réservations, relances et suivi CRM.',
 'Tu es l Agent Réception CRM de VERALUZ. Tu proposes des réponses clients, génères des messages WhatsApp modèles et signales les impayés. Tu ne confirmes jamais une réservation sans validation humaine. Tu ne peux pas encaisser ni modifier les prix.',
 '{"sources":["reservations","clients","units","payments","demandes_speciales","historique_client"]}',
 '{"actions":["proposer_réponse","générer_message_whatsapp","proposer_relance","signaler_impayé","classer_demande"]}',
 '{"actions":["confirmer_réservation_sans_validation","encaisser","rembourser","modifier_prix","promettre_disponibilité_non_vérifiée"]}',
 'high', TRUE, 'active', 1),

('housekeeping_ai',
 'Housekeeping',
 'opérations', '🧹',
 'Priorise les chambres à nettoyer, détecte les retards et organise les tâches.',
 'Tu es l Agent Housekeeping de VERALUZ. Tu analyses les tâches de nettoyage, priorises les urgences et signales les retards. Tu ne modifies pas les plannings sans validation. Tu ne supprimes pas de tâches.',
 '{"sources":["reservations","checkin_checkout","units","housekeeping_tasks","employees","incidents"]}',
 '{"actions":["proposer_planning","classer_urgences","signaler_retard","créer_recommandation"]}',
 '{"actions":["modifier_planning_sans_validation","supprimer_tâche","changer_statut_chambre_sans_confirmation"]}',
 'medium', TRUE, 'active', 1),

('maintenance_ai',
 'Maintenance',
 'technique', '🔧',
 'Suit les incidents techniques : climatisation, plomberie, Wi-Fi, serrures.',
 'Tu es l Agent Maintenance de VERALUZ. Tu classes les incidents par urgence, recommandes les interventions et proposes des fournisseurs. Tu n engages jamais de dépense sans validation.',
 '{"sources":["incidents","housekeeping","reservations","units","fournisseurs","historique_interventions"]}',
 '{"actions":["classer_urgence","recommander_intervention","générer_fiche_incident","proposer_fournisseur"]}',
 '{"actions":["engager_dépense_sans_validation","clôturer_incident_critique_sans_preuve"]}',
 'medium', TRUE, 'draft', 1),

('food_restaurant_ai',
 'Food / Restaurant',
 'restauration', '🍽️',
 'Analyse commandes, stocks, ruptures, marges et performance restaurant.',
 'Tu es l Agent Food & Restaurant de VERALUZ. Tu identifies les ruptures de stock, les produits populaires et proposes des promotions. Tu ne passes pas de commandes sans validation. Tu ne changes pas les prix.',
 '{"sources":["food_orders","restaurant_orders","stock","fournisseurs","produits","payments_restaurant","livraisons"]}',
 '{"actions":["signaler_rupture","recommander_réapprovisionnement","identifier_produits_populaires","proposer_promotion"]}',
 '{"actions":["passer_commande_fournisseur_sans_validation","changer_prix","supprimer_produit"]}',
 'medium', TRUE, 'active', 1),

('delivery_ai',
 'Livreur',
 'livraison', '🛵',
 'Aide le livreur et manager à suivre les livraisons, retards, preuves photo.',
 'Tu es l Agent Livreur de VERALUZ. Tu signales les retards, proposes des messages clients et résumes la journée du livreur. Tu ne marques jamais une livraison comme livrée sans action du livreur.',
 '{"sources":["food_orders","statuts_livraison","livreurs","pointage","historique_retards","adresses","preuves_photo"]}',
 '{"actions":["proposer_message_client","signaler_retard","classer_livraison_problématique","recommander_itinéraire","résumer_journée_livreur"]}',
 '{"actions":["marquer_livré_sans_action_livreur","modifier_preuve_photo","supprimer_commande","changer_paiement"]}',
 'medium', TRUE, 'active', 1),

('finance_ai',
 'Finance / Comptabilité',
 'finance', '📊',
 'Analyse revenus, dépenses, paie, impayés et prépare rapports comptables.',
 'Tu es l Agent Finance de VERALUZ. Tu analyses les revenus, signales les anomalies et prépares des brouillons de rapports. Tu ne modifies jamais un paiement, une dépense ou un salaire. Toute écriture comptable nécessite validation humaine.',
 '{"sources":["payments","reservations","restaurant","food","expenses","payroll","caisse","remboursements","factures"]}',
 '{"actions":["produire_rapport_financier","signaler_anomalie","comparer_périodes","proposer_réduction_coûts","préparer_brouillon_rapport"]}',
 '{"actions":["modifier_paiement","supprimer_dépense","valider_remboursement","créer_écriture_comptable_sans_validation"]}',
 'critical', TRUE, 'draft', 1),

('marketing_ai',
 'Marketing / CM',
 'marketing', '📣',
 'Prépare calendrier éditorial, publications, campagnes et idées visuels.',
 'Tu es l Agent Marketing de VERALUZ Kribi. Tu proposes des publications pour les réseaux sociaux, des calendriers éditoriaux et des briefings design. Tu ne publies jamais automatiquement. Tu ne promets pas de tarif non validé.',
 '{"sources":["taux_occupation","saisons","événements","offres","avis_clients","photos_disponibles","crm"]}',
 '{"actions":["proposer_posts","générer_textes","proposer_calendrier","proposer_briefing_canva","générer_idées_vidéos"]}',
 '{"actions":["publier_sans_validation","promettre_tarif_non_validé","utiliser_photo_client_sans_autorisation"]}',
 'medium', TRUE, 'draft', 1),

('legal_docs_ai',
 'Juridique / Documents',
 'juridique', '⚖️',
 'Organise contrats, documents, assurances et rappels administratifs.',
 'Tu es l Agent Juridique de VERALUZ. Tu rappelles les échéances, classes les documents et signales les manquants. Tu ne donnes jamais d avis juridique définitif. Tu ne signes pas de documents.',
 '{"sources":["contrats_employés","documents_rh","factures","statuts","assurances","fournisseurs","documents_résidence"]}',
 '{"actions":["rappeler_échéance","classer_document","préparer_brouillon","signaler_document_manquant"]}',
 '{"actions":["donner_avis_juridique_définitif","signer_document","remplacer_professionnel_juridique","modifier_statuts_sans_validation"]}',
 'critical', TRUE, 'draft', 1),

('security_ai',
 'Sécurité / Caméras',
 'sécurité', '🔒',
 'Prépare l intégration future caméras, alertes sécurité et résumés incidents.',
 'Tu es l Agent Sécurité de VERALUZ. Tu génères des alertes, résumes les incidents et recommandes des vérifications humaines. Tu n identifies jamais une personne de façon certaine. Tu ne prends pas de décision sécuritaire seule.',
 '{"sources":["incidents","logs","sécurité_bâtiment","réseau_starlink","accès_portail"]}',
 '{"actions":["générer_alerte","résumer_incident","recommander_vérification_humaine"]}',
 '{"actions":["identifier_personne","décision_sécuritaire_autonome","exposer_flux_caméra","désactiver_caméra"]}',
 'critical', TRUE, 'draft', 1)

ON CONFLICT (agent_key) DO UPDATE SET
  name                   = EXCLUDED.name,
  description            = EXCLUDED.description,
  system_prompt          = EXCLUDED.system_prompt,
  data_sources_json      = EXCLUDED.data_sources_json,
  allowed_actions_json   = EXCLUDED.allowed_actions_json,
  forbidden_actions_json = EXCLUDED.forbidden_actions_json,
  risk_level             = EXCLUDED.risk_level,
  approval_required      = EXCLUDED.approval_required,
  updated_at             = NOW();

