-- ════════════════════════════════════════════════════════════════════════════
-- SETTINGS-SSOT-1A  —  Supabase Storage bucket "logos"
-- Branche : claude/settings-ssot-1a  —  2026-08-20
--
-- PRÉ-REQUIS :
--   Créer le bucket "logos" (public) via Supabase Dashboard :
--     Storage → New bucket → name: logos → Public bucket: ON
--   Ou via CLI : supabase storage create logos --project-ref dfdmasejsoibxrvubegu --public
--
-- Ce fichier configure uniquement les politiques RLS sur storage.objects.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Politique SELECT (lecture publique) ──────────────────────────────────────
-- Déjà couverte par le bucket public — documentée pour référence.

-- ── Politique INSERT (upload anon avec apikey) ───────────────────────────────
-- Autorise les requêtes authentifiées avec la clé anon à uploader dans logos/.
-- La clé anon est validée par Supabase (verify_jwt) avant que cette politique s'applique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'logos_anon_insert'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY logos_anon_insert ON storage.objects
        FOR INSERT TO anon
        WITH CHECK (bucket_id = 'logos')
    $pol$;
  END IF;
END $$;

-- ── Politique UPDATE (remplacement via x-upsert: true) ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'logos_anon_update'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY logos_anon_update ON storage.objects
        FOR UPDATE TO anon
        USING (bucket_id = 'logos')
    $pol$;
  END IF;
END $$;
