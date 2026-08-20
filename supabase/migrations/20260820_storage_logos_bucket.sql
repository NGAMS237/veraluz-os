-- ════════════════════════════════════════════════════════════════════════════
-- SETTINGS-SSOT-1A  —  Supabase Storage bucket "logos"
-- Branche : claude/settings-ssot-1a  —  2026-08-20
--
-- Sécurité :
--   Upload uniquement via Edge Function logo-upload-secure (service_role).
--   AUCUNE écriture anon depuis le frontend — politique DELETE si elle existait.
--   Lecture publique assurée par le bucket public (pas de policy SELECT requise).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Créer le bucket "logos" s'il n'existe pas ─────────────────────────────
-- public = true  → GET /storage/v1/object/public/logos/{path} sans token
-- file_size_limit = 2 Mo  → défense en profondeur côté Storage
-- allowed_mime_types → whitelist stricte côté Storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,
  2097152,  /* 2 Mo */
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = 2097152,
      allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'],
      updated_at         = now();

-- ── 2. Supprimer les policies anon éventuelles (idempotent) ─────────────────
-- Sécurité : aucune écriture Storage directe depuis frontend anon.
-- L'upload passe UNIQUEMENT par logo-upload-secure EF (service_role).
DROP POLICY IF EXISTS logos_anon_insert ON storage.objects;
DROP POLICY IF EXISTS logos_anon_update ON storage.objects;

-- ── 3. SELECT publique — déjà couverte par bucket.public = true ──────────────
-- Une policy explicite n'est pas requise pour la lecture publique quand le
-- bucket est marqué public. Documentée pour transparence.

-- ── 4. Rappel architecture ────────────────────────────────────────────────────
-- Flux unique autorisé pour l'écriture :
--   frontend → broker CORE (veraluzLogoUpload) → logo-upload-secure EF
--             → validateEmployeeSession (direction/gérant)
--             → supabase.storage.from('logos').upload(...) [service_role]
--             → retourne URL publique canonique
--             → persiste branding.logo_url en DB
--
-- Aucune autre route d'écriture n'est ouverte.
