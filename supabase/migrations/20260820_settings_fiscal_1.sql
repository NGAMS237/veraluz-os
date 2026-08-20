-- SETTINGS-FISCAL-1 — Seed clé 'fiscal' dans veraluz_settings
-- Idempotent : ON CONFLICT DO NOTHING
-- Source canonique des paramètres fiscaux de l'établissement Veraluz (Kribi, Cameroun)

INSERT INTO veraluz_settings (key, value) VALUES (
  'fiscal',
  jsonb_build_object(
    'vat_enabled',             true,
    'vat_rate',                19.25,
    'tourist_tax_enabled',     true,
    'tourist_tax_type',        'fixed',
    'tourist_tax_value',       2000,
    'service_charge_enabled',  true,
    'service_charge_rate',     10,
    'municipal_tax_enabled',   false,
    'municipal_tax_value',     0,
    'early_checkin_enabled',   true,
    'early_checkin_fee',       15000,
    'late_checkout_enabled',   true,
    'late_checkout_fee',       12000,
    'extra_bed_fee',           10000,
    'cancellation_pct',        30
  )
) ON CONFLICT (key) DO NOTHING;
