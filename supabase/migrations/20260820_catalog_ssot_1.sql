-- CATALOG-SSOT-1 — Source canonique : veraluz_units
-- La table veraluz_units existe déjà avec la structure complète :
--   id, name, type, floor, capacity, price, description, amenities, status, sort_order, hk_status
-- Aucun changement de schéma requis.

-- Seed des unités par défaut si la table est vide
-- Correspond à la structure réelle de la résidence Veraluz (Kribi, Cameroun)
INSERT INTO veraluz_units (id, name, type, floor, capacity, price, description, amenities, status, sort_order)
SELECT
  gen_random_uuid(), name, type, floor, capacity, price, description, amenities, 'available', sort_order
FROM (VALUES
  ('Chambre Standard',       'chambre',  1, 2,  35000,  'Chambre indépendante avec salle de bain et terrasse privée',  'WiFi, Climatisation, TV, Terrasse',              10),
  ('Studio Océan',           'studio',   2, 3,  65000,  'Grand studio avec chambre, salon, cuisine américaine et grande terrasse', 'WiFi, Climatisation, Cuisine équipée, Grande terrasse', 20),
  ('Suite Présidentielle',   'suite',    3, 6, 150000,  'Grand appartement 3 chambres avec salon, cuisine et grande terrasse — niveau penthouse', 'WiFi, Climatisation, Cuisine équipée, Grande terrasse panoramique, Service personnalisé', 30)
) AS t(name, type, floor, capacity, price, description, amenities, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM veraluz_units LIMIT 1);
