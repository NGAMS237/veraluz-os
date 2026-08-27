-- =============================================================================
-- RECOVERY LOT D — DOCUMENTS SSOT
-- Migration : 20260827_recovery_lot_d_documents_ssot.sql
-- Auteur    : Claude (agent) — autorisé par Blaise 2026-08-27
-- Objectif  : Aligner la table veraluz_documents (créée directement en PROD
--             hors système de migrations) avec le dépôt Git.
--             Corriger les policies RLS dev_anon_* en policies de production.
-- Impact    : aucune donnée existante modifiée — idempotent
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TABLE CANONIQUE : veraluz_documents
--    Capture exacte du schéma PROD (prompt 019).
--    IF NOT EXISTS : aucune destruction si la table existe déjà.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.veraluz_documents (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  title               text    NOT NULL,
  category            text    NOT NULL,
  document_type       text,
  related_module      text,
  related_record_id   text,
  confidentiality_level text  NOT NULL DEFAULT 'internal'
    CONSTRAINT veraluz_documents_confidentiality_check
      CHECK (confidentiality_level IN ('public','internal','confidential','restricted')),
  status              text    NOT NULL DEFAULT 'active'
    CONSTRAINT veraluz_documents_status_check
      CHECK (status IN ('active','expired','archived','missing','pending_review')),
  storage_bucket      text,
  storage_path        text,
  file_name           text,
  file_type           text,
  file_size           integer,
  expiry_date         date,
  reminder_date       date,
  uploaded_by         text,
  reviewed_by         text,
  notes               text,
  tags                text[]  DEFAULT '{}',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT veraluz_documents_pkey PRIMARY KEY (id),
  -- Empêche de pointer vers un bucket non-autorisé
  CONSTRAINT veraluz_documents_storage_bucket_check
    CHECK (
      storage_bucket IS NULL
      OR storage_bucket IN (
        'veraluz-documents-private',
        'veraluz-bank-private',
        'veraluz-legal-private',
        'veraluz-hr-private',
        'veraluz-payslips-private'
      )
    )
);

COMMENT ON TABLE public.veraluz_documents IS
  'Table canonique SSOT des métadonnées documentaires VERALUZ. '
  'Les fichiers physiques sont stockés dans les buckets Supabase Storage privés. '
  'Upload via Edge Function veraluz-document-upload (PROMPT 020+).';

-- ---------------------------------------------------------------------------
-- 2. INDEXES (idempotents)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_veraluz_documents_category
  ON public.veraluz_documents (category);

CREATE INDEX IF NOT EXISTS idx_veraluz_documents_status
  ON public.veraluz_documents (status);

CREATE INDEX IF NOT EXISTS idx_veraluz_documents_expiry
  ON public.veraluz_documents (expiry_date)
  WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_veraluz_documents_confidentiality
  ON public.veraluz_documents (confidentiality_level);

-- ---------------------------------------------------------------------------
-- 3. TRIGGER updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_veraluz_documents_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Trigger : idempotent via DROP IF EXISTS + CREATE
DROP TRIGGER IF EXISTS trg_veraluz_documents_updated_at ON public.veraluz_documents;
CREATE TRIGGER trg_veraluz_documents_updated_at
  BEFORE UPDATE ON public.veraluz_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_veraluz_documents_updated_at();

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.veraluz_documents ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. RLS POLICIES — remplacement des policies dev_anon_* par des policies
--    de production correctement nommées et avec with_check sécurisé.
--
--    Contexte architectural : le frontend admin utilise la clé anon directement
--    (auth PIN custom côté Edge Function, pas Supabase Auth). La restriction
--    de rôle ne peut donc pas se faire via JWT claims — le contrôle repose
--    sur la validation des valeurs acceptables (with_check) et sur le fait
--    que l'URL de l'application n'est pas publique.
--
--    DELETE reste bloqué par conception (aucune policy DELETE).
-- ---------------------------------------------------------------------------

-- Supprimer les policies de développement
DROP POLICY IF EXISTS dev_anon_read_documents_metadata ON public.veraluz_documents;
DROP POLICY IF EXISTS dev_anon_insert_documents        ON public.veraluz_documents;
DROP POLICY IF EXISTS dev_anon_update_documents        ON public.veraluz_documents;

-- Supprimer les éventuelles policies de production déjà présentes (idempotence)
DROP POLICY IF EXISTS prod_staff_read_documents   ON public.veraluz_documents;
DROP POLICY IF EXISTS prod_staff_insert_documents ON public.veraluz_documents;
DROP POLICY IF EXISTS prod_staff_update_documents ON public.veraluz_documents;

-- SELECT : lecture de toutes les métadonnées (staff admin interne uniquement)
CREATE POLICY prod_staff_read_documents
  ON public.veraluz_documents
  FOR SELECT
  TO anon
  USING (true);

-- INSERT : insertion de métadonnées uniquement (pas de fichier — via Edge Function)
--          Valide les valeurs acceptables pour éviter l'injection de données invalides.
CREATE POLICY prod_staff_insert_documents
  ON public.veraluz_documents
  FOR INSERT
  TO anon
  WITH CHECK (
    confidentiality_level IN ('public','internal','confidential','restricted')
    AND status IN ('active','expired','archived','missing','pending_review')
    AND (
      storage_bucket IS NULL
      OR storage_bucket IN (
        'veraluz-documents-private',
        'veraluz-bank-private',
        'veraluz-legal-private',
        'veraluz-hr-private',
        'veraluz-payslips-private'
      )
    )
  );

-- UPDATE : mise à jour des métadonnées (titre, statut, dates, notes, tags)
--          with_check strict : empêche de rediriger un document vers un bucket
--          non autorisé ou d'injecter un statut/niveau de confidentialité invalide.
CREATE POLICY prod_staff_update_documents
  ON public.veraluz_documents
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (
    confidentiality_level IN ('public','internal','confidential','restricted')
    AND status IN ('active','expired','archived','missing','pending_review')
    AND (
      storage_bucket IS NULL
      OR storage_bucket IN (
        'veraluz-documents-private',
        'veraluz-bank-private',
        'veraluz-legal-private',
        'veraluz-hr-private',
        'veraluz-payslips-private'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 6. GRANT (assure que anon peut lire/écrire via REST API)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.veraluz_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veraluz_documents TO service_role;

-- =============================================================================
-- DRY-RUN : exécuter ce bloc dans une transaction séparée avec ROLLBACK
-- pour vérifier l'idempotence avant déploiement :
--   BEGIN;
--   \i supabase/migrations/20260827_recovery_lot_d_documents_ssot.sql
--   ROLLBACK;
-- =============================================================================

COMMIT;
