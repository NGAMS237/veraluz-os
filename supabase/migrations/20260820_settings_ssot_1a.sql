-- ════════════════════════════════════════════════════════════════════════════
-- SETTINGS-SSOT-1A  —  Branding, Localization, Restaurant Ops canonicaux
-- Branche : claude/settings-ssot-1a  —  2026-08-20
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. branding ──────────────────────────────────────────────────────────────
-- Seed initial.  ON CONFLICT DO NOTHING : ne pas écraser une valeur déjà
-- configurée par le gérant.
INSERT INTO veraluz_settings (key, value, updated_at)
VALUES (
  'branding',
  jsonb_build_object(
    'primary_color',   '#22d3a5',
    'secondary_color', '#1ba87f',
    'bg_color',        '#0f1117',
    'font',            'Inter',
    'show_logo',       true,
    'logo_url',        ''
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. localization ───────────────────────────────────────────────────────────
-- Remplace la clé métier "devises" qui mélangeait devise + langue + timezone.
-- timezone par défaut : Africa/Douala (établissement).
-- Aucune conversion FX : secondary_currency = affichage seulement.
INSERT INTO veraluz_settings (key, value, updated_at)
VALUES (
  'localization',
  jsonb_build_object(
    'language',           'fr',
    'locale',             'fr-CM',
    'primary_currency',   'XAF',
    'secondary_currency', 'EUR',
    'timezone',           'Africa/Douala',
    'date_format',        'DD/MM/YYYY',
    'time_format',        '24h'
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;

-- ── 3. restaurant — extension champs opérationnels non-financiers ─────────────
-- Les champs existants (enabled, opening_time, closing_time, room_service_enabled)
-- sont PRÉSERVÉS par le merge ||.
-- Les champs financiers (tva, service_charge) restent HORS SCOPE  →  SETTINGS-FISCAL-1.
-- guard `? 'name'` : ne pas ré-appliquer si déjà défini par le gérant.
UPDATE veraluz_settings
SET
  value      = value || jsonb_build_object(
    'name',            'Le Mako Lounge',
    'capacity',        40,
    'breakfast_start', '07:00',
    'breakfast_end',   '10:30',
    'lunch_start',     '12:00',
    'lunch_end',       '14:30',
    'dinner_start',    '19:00',
    'dinner_end',      '22:30',
    'bar_active',      true,
    'bar_open',        '10:00',
    'bar_close',       '00:00',
    'min_order',       3000
  ),
  updated_at = now()
WHERE key = 'restaurant'
  AND NOT (value ? 'name');   -- idempotent : ne ré-applique pas si déjà là

-- ── 4. BRANDING LEGACY MIGRATION — camelCase → snake_case ───────────────────
-- La PROD peut contenir des clés legacy (logoUrl, heroImage, accentColor,
-- primaryColor, theme) issues d'une version antérieure.
-- Migration idempotente : ne remplace une clé snake_case que si elle est absente
-- ou vide, et supprime les clés camelCase après migration.
-- Exécution safe si aucune clé legacy n'existe (aucun effet).
-- Sans perte : les valeurs canoniques déjà définies par le gérant ne sont pas écrasées.
UPDATE veraluz_settings
SET value = (
  WITH legacy AS (
    SELECT
      value->>'logoUrl'     AS logo_url_leg,
      value->>'heroImage'   AS hero_image_leg,
      value->>'accentColor' AS accent_color_leg,
      value->>'primaryColor' AS primary_color_leg
      /* 'theme' : clé obsolète, non migrée — discardée ci-dessous */
  )
  SELECT
    /* Appliquer migration camelCase→snake_case uniquement si valeur absente/vide côté snake_case */
    (value
      /* logo_url */
      || CASE WHEN (value->>'logo_url' IS NULL OR value->>'logo_url' = '')
                   AND logo_url_leg IS NOT NULL AND logo_url_leg <> ''
              THEN jsonb_build_object('logo_url', logo_url_leg)
              ELSE '{}'::jsonb END
      /* hero_image */
      || CASE WHEN (value->>'hero_image' IS NULL OR value->>'hero_image' = '')
                   AND hero_image_leg IS NOT NULL AND hero_image_leg <> ''
              THEN jsonb_build_object('hero_image', hero_image_leg)
              ELSE '{}'::jsonb END
      /* accent_color */
      || CASE WHEN (value->>'accent_color' IS NULL OR value->>'accent_color' = '')
                   AND accent_color_leg IS NOT NULL AND accent_color_leg <> ''
              THEN jsonb_build_object('accent_color', accent_color_leg)
              ELSE '{}'::jsonb END
      /* primary_color */
      || CASE WHEN (value->>'primary_color' IS NULL OR value->>'primary_color' = '')
                   AND primary_color_leg IS NOT NULL AND primary_color_leg <> ''
              THEN jsonb_build_object('primary_color', primary_color_leg)
              ELSE '{}'::jsonb END
      /* Supprimer les clés camelCase et theme (obsolète) après migration */
      - 'logoUrl' - 'heroImage' - 'accentColor' - 'primaryColor' - 'theme'
    )
  FROM legacy
)
, updated_at = now()
WHERE key = 'branding'
  /* N'exécuter que si au moins une clé legacy est présente */
  AND (
    value ? 'logoUrl' OR value ? 'heroImage' OR
    value ? 'accentColor' OR value ? 'primaryColor' OR value ? 'theme'
  );

-- ── 5. RLS — s'assurer que localization est lisible publiquement ──────────────
-- La politique veraluz_settings_anon_read existante couvre toutes les lignes ;
-- aucun ajustement RLS nécessaire pour la nouvelle clé.
-- Rappel de la politique existante (documentation, pas de re-création) :
--   CREATE POLICY veraluz_settings_anon_read ON veraluz_settings
--     FOR SELECT TO anon, authenticated USING (true);
