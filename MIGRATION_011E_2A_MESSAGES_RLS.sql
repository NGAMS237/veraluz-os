-- ============================================================
-- MIGRATION 011E-2A — Messages RLS : bloquer accès anon direct
-- Veraluz OS · À appliquer dans Supabase SQL Editor
-- ============================================================
-- CONTEXTE :
--   Toutes les opérations messages passent désormais par
--   l'Edge Function messages-secure (service_role, bypass RLS).
--   La clé anon ne doit plus pouvoir accéder à ces tables directement.
--
-- PRINCIPE :
--   - RLS activé → anon bloqué sur toutes opérations
--   - service_role bypass RLS → Edge Function fonctionne
--   - Pas de politique anon/authenticated → aucun accès direct
--
-- IMPORTANT : N'exécuter qu'après déploiement de messages-secure.
-- ============================================================

-- ── 1. veraluz_internal_messages : supprimer politiques héritées ──────
ALTER TABLE veraluz_internal_messages ENABLE ROW LEVEL SECURITY;

-- Supprimer toutes les politiques existantes
DROP POLICY IF EXISTS "vim_select_own"    ON veraluz_internal_messages;
DROP POLICY IF EXISTS "vim_insert_own"    ON veraluz_internal_messages;
DROP POLICY IF EXISTS "vim_update_own"    ON veraluz_internal_messages;
DROP POLICY IF EXISTS "vim_delete_own"    ON veraluz_internal_messages;
DROP POLICY IF EXISTS "admin_voir_tout"   ON veraluz_internal_messages;
DROP POLICY IF EXISTS "employe_ses_messages" ON veraluz_internal_messages;
DROP POLICY IF EXISTS "dept_ses_messages" ON veraluz_internal_messages;

-- Aucune politique → toutes les opérations anon/authenticated bloquées.
-- service_role (Edge Functions) bypass RLS et reste pleinement opérationnel.

-- ── 2. veraluz_delivery_messages : même principe ─────────────────────
ALTER TABLE veraluz_delivery_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livreur_ses_messages"    ON veraluz_delivery_messages;
DROP POLICY IF EXISTS "update_ses_messages"      ON veraluz_delivery_messages;
DROP POLICY IF EXISTS "insert_messages_autorises" ON veraluz_delivery_messages;

-- ── 3. veraluz_message_threads : même principe ───────────────────────
ALTER TABLE veraluz_message_threads ENABLE ROW LEVEL SECURITY;

-- ── 4. Vérification (exécuter après pour confirmer) ──────────────────
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE tablename IN (
--   'veraluz_internal_messages',
--   'veraluz_delivery_messages',
--   'veraluz_message_threads'
-- );
-- → rowsecurity doit être TRUE pour les 3 tables.

-- ============================================================
-- FIN MIGRATION 011E-2A
-- ============================================================
-- RÉSUMÉ :
--   RLS activé sur 3 tables messages.
--   Aucune politique pour anon/authenticated → accès direct bloqué.
--   service_role (Edge Function messages-secure) bypass RLS → OK.
--   REVOKE anon SELECT/INSERT/UPDATE/DELETE effectif par défaut avec RLS.
-- ============================================================
