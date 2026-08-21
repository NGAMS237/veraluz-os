-- CATALOG-SSOT-1 — Source canonique : veraluz_units
-- La table veraluz_units existe déjà avec la structure complète :
--   id, name, type, floor, capacity, price, description, amenities, status, sort_order, hk_status
-- Aucun changement de schéma requis.
--
-- v2 review fixes :
--   + amenities = JSONB arrays valides (plus de chaînes littérales)
--   + status seed = 'active' (statut administratif catalogue)
--     → 'occupied' n'est jamais un statut catalogue (état dérivé des réservations)
--   + gen_random_uuid()::text pour compatibilité colonnes TEXT si nécessaire
--   + Idempotent : INSERT uniquement si table vide

-- Seed des unités par défaut si la table est complètement vide
-- Correspond à la structure réelle de la résidence Veraluz (Kribi, Cameroun)
INSERT INTO veraluz_units (id, name, type, floor, capacity, price, description, amenities, status, sort_order)
SELECT
  gen_random_uuid()::text,
  name, type, floor, capacity, price, description,
  amenities::jsonb,
  'active',           -- statut administratif catalogue : active | maintenance | out_of_service
  sort_order
FROM (VALUES
  (
    'Chambre Standard',
    'chambre',
    1, 2, 35000,
    'Chambre indépendante avec salle de bain et terrasse privée',
    '["clim","tv","wifi","eau_ch","terrasse"]',
    10
  ),
  (
    'Studio Océan',
    'studio',
    2, 3, 65000,
    'Grand studio avec chambre, salon, cuisine américaine et grande terrasse',
    '["clim","tv","wifi","eau_ch","cuisine","grande_terrasse"]',
    20
  ),
  (
    'Suite Présidentielle',
    'suite',
    3, 6, 150000,
    'Grand appartement 3 chambres avec salon, cuisine et grande terrasse — niveau penthouse',
    '["clim","tv","wifi","eau_ch","cuisine","grande_terrasse","service_perso","jacuzzi"]',
    30
  )
) AS t(name, type, floor, capacity, price, description, amenities, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM veraluz_units LIMIT 1);
