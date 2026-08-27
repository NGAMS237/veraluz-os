-- =============================================================================
-- RECOVERY LOT D — DOCUMENTS SSOT (v2 — corrigé après revue sécurité)
-- Migration : 20260827_recovery_lot_d_documents_ssot.sql
-- Auteur    : Claude (agent) — autorisé par Blaise 2026-08-27
-- Objectif  : Aligner veraluz_documents (créée en PROD hors migration) avec
--             le dépôt Git. Fermer l'accès anon. Tout accès passe désormais
--             par l'Edge Function documents-secure.
-- Dry-run   : envelopper dans BEGIN / ROLLBACK en dehors de ce fichier.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. PRÉ-FLIGHT : vérifier que les 11 lignes existantes sont propres
--    avant d'ajouter les contraintes.
--    En cas de violation le DO lèvera une exception et arrêtera la migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad_confidentiality integer;
  bad_status          integer;
  bad_bucket          integer;
BEGIN
  SELECT COUNT(*) INTO bad_confidentiality
  FROM public.veraluz_documents
  WHERE confidentiality_level NOT IN ('public','internal','confidential','restricted');

  SELECT COUNT(*) INTO bad_status
  FROM public.veraluz_documents
  WHERE status NOT IN ('active','expired','archived','missing','pending_review');

  SELECT COUNT(*) INTO bad_bucket
  FROM public.veraluz_documents
  WHERE storage_bucket IS NOT NULL
    AND storage_bucket NOT IN (
      'veraluz-documents-private','veraluz-bank-private',
      'veraluz-legal-private','veraluz-hr-private','veraluz-payslips-private'
    );

  IF bad_confidentiality > 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: % row(s) with invalid confidentiality_level', bad_confidentiality;
  END IF;
  IF bad_status > 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: % row(s) with invalid status', bad_status;
  END IF;
  IF bad_bucket > 0 THEN
    RAISE EXCEPTION 'PRE-FLIGHT FAILED: % row(s) with unauthorized storage_bucket', bad_bucket;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. TABLE CANONIQUE (installation vierge — no-op si la table existe déjà)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.veraluz_documents (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  title                 text        NOT NULL,
  category              text        NOT NULL,
  document_type         text,
  related_module        text,
  related_record_id     text,
  confidentiality_level text        NOT NULL DEFAULT 'internal',
  status                text        NOT NULL DEFAULT 'active',
  storage_bucket        text,
  storage_path          text,
  file_name             text,
  file_type             text,
  file_size             integer,
  expiry_date           date,
  reminder_date         date,
  uploaded_by           text,
  reviewed_by           text,
  notes                 text,
  tags                  text[]      DEFAULT '{}',
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT veraluz_documents_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.veraluz_documents IS
  'Table canonique SSOT des métadonnées documentaires VERALUZ. '
  'Accès exclusivement via Edge Function documents-secure (service_role). '
  'Aucun accès anon ni authenticated direct.';

-- ---------------------------------------------------------------------------
-- 2. CONTRAINTES CHECK — ajoutées séparément (table existante en PROD)
--    Chaque DO $$ vérifie l'existence avant d'ajouter.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'veraluz_documents'
      AND constraint_name = 'veraluz_documents_confidentiality_check'
  ) THEN
    ALTER TABLE public.veraluz_documents
      ADD CONSTRAINT veraluz_documents_confidentiality_check
      CHECK (confidentiality_level IN ('public','internal','confidential','restricted'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'veraluz_documents'
      AND constraint_name = 'veraluz_documents_status_check'
  ) THEN
    ALTER TABLE public.veraluz_documents
      ADD CONSTRAINT veraluz_documents_status_check
      CHECK (status IN ('active','expired','archived','missing','pending_review'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'veraluz_documents'
      AND constraint_name = 'veraluz_documents_storage_bucket_check'
  ) THEN
    ALTER TABLE public.veraluz_documents
      ADD CONSTRAINT veraluz_documents_storage_bucket_check
      CHECK (
        storage_bucket IS NULL
        OR storage_bucket IN (
          'veraluz-documents-private',
          'veraluz-bank-private',
          'veraluz-legal-private',
          'veraluz-hr-private',
          'veraluz-payslips-private'
        )
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. INDEXES (idempotents)
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
-- 4. TRIGGER updated_at
--    Fonction SECURITY INVOKER (pas de SECURITY DEFINER — pas de privilège
--    élevé requis, aucun risque d'exposition à PUBLIC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_veraluz_documents_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  -- SECURITY INVOKER est la valeur par défaut et la plus sûre ici
  SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Pas d'exposition de la fonction à PUBLIC
REVOKE ALL ON FUNCTION public.update_veraluz_documents_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_veraluz_documents_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_veraluz_documents_updated_at ON public.veraluz_documents;
CREATE TRIGGER trg_veraluz_documents_updated_at
  BEFORE UPDATE ON public.veraluz_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_veraluz_documents_updated_at();

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.veraluz_documents ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. SUPPRIMER TOUTES LES POLICIES ANON (dev et prod)
--    Plus aucune policy anon ou authenticated — seul service_role accède.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS dev_anon_read_documents_metadata ON public.veraluz_documents;
DROP POLICY IF EXISTS dev_anon_insert_documents        ON public.veraluz_documents;
DROP POLICY IF EXISTS dev_anon_update_documents        ON public.veraluz_documents;
DROP POLICY IF EXISTS prod_staff_read_documents        ON public.veraluz_documents;
DROP POLICY IF EXISTS prod_staff_insert_documents      ON public.veraluz_documents;
DROP POLICY IF EXISTS prod_staff_update_documents      ON public.veraluz_documents;

-- Aucune nouvelle policy anon/authenticated.
-- RLS ON + zéro policy = default DENY ALL pour anon et authenticated.
-- service_role bypass RLS par définition Supabase (pas de policy nécessaire).

-- ---------------------------------------------------------------------------
-- 7. RÉVOQUER LES ACCÈS DIRECTS
--    Retire tous les droits REST directs à anon et authenticated.
--    Ne touche pas service_role (bypass RLS natif Supabase).
-- ---------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.veraluz_documents FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.veraluz_documents FROM authenticated;

-- service_role : droit complet (accès via Edge Function côté serveur uniquement)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.veraluz_documents TO service_role;

-- =============================================================================
-- DRY-RUN EXTERNE (recommandé avant déploiement réel) :
--   BEGIN;
--   \i supabase/migrations/20260827_recovery_lot_d_documents_ssot.sql
--   SELECT COUNT(*) FROM public.veraluz_documents; -- doit rester 11
--   ROLLBACK;
-- =============================================================================
