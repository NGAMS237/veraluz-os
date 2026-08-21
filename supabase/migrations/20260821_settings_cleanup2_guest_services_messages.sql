-- ═══════════════════════════════════════════════════════════════
-- SETTINGS-CLEANUP-2 + GUEST-5 + GUEST-6
-- Date: 2026-08-21
-- Branche: claude/settings-ssot-1a
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. veraluz_settings : seed canonical domains ─────────────

/* notifications (A — préférences email alertes réellement consommées)
   SMS supprimés (D — dead config, aucun backend SMS)              */
INSERT INTO veraluz_settings (key, value, updated_at)
VALUES ('notifications', jsonb_build_object(
  'alert_email',        'afterworkquebec2025@gmail.com',
  'email_reservations', true,
  'email_payments',     true,
  'email_checkin',      true,
  'email_checkout',     false,
  'daily_report',       true,
  'weekly_report',      true,
  'low_stock_alert',    true,
  'payment_alert',      true
), now())
ON CONFLICT (key) DO NOTHING;

/* integrations — enable flags + whatsapp_number (A canonique)
   *_key secrets exclus (B — env serveur uniquement, jamais DB)   */
INSERT INTO veraluz_settings (key, value, updated_at)
VALUES ('integrations', jsonb_build_object(
  'booking_com',    false,
  'airbnb',         false,
  'cinetpay',       true,
  'whatsapp',       false,
  'whatsapp_number', ''
), now())
ON CONFLICT (key) DO NOTHING;

/* email — config non secrète (A canonique)
   Credentials Resend/SMTP restent en env serveur (B)              */
INSERT INTO veraluz_settings (key, value, updated_at)
VALUES ('email', jsonb_build_object(
  'template_id',  '',
  'test_address', 'residenceveraluz@gmail.com',
  'auto_booking', true,
  'auto_alert',   true,
  'auto_report',  false
), now())
ON CONFLICT (key) DO NOTHING;

/* system — uniquement maintenance_mode (A canonique)
   session_timeout supprimé (D — utiliser security.session_lifetime_hours)
   auto_backup / backup_freq / log_retention supprimés (D — dead config) */
INSERT INTO veraluz_settings (key, value, updated_at)
VALUES ('system', jsonb_build_object(
  'maintenance_mode', false
), now())
ON CONFLICT (key) DO NOTHING;

-- ─── 2. veraluz_guest_service_requests (GUEST-5) ──────────────
CREATE TABLE IF NOT EXISTS veraluz_guest_service_requests (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_session_id uuid        NOT NULL,
  reservation_id   uuid        NOT NULL,
  unit_id          uuid,
  service_type     text        NOT NULL
    CHECK (service_type IN ('housekeeping','towels','maintenance','reception','other')),
  note             text,
  status           text        NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','in_progress','completed','cancelled')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

/* RLS : aucune politique RLS — accès via service_role dans l'EF uniquement */
ALTER TABLE veraluz_guest_service_requests DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vgsr_guest_session
  ON veraluz_guest_service_requests (guest_session_id);
CREATE INDEX IF NOT EXISTS idx_vgsr_reservation
  ON veraluz_guest_service_requests (reservation_id);
CREATE INDEX IF NOT EXISTS idx_vgsr_service_type
  ON veraluz_guest_service_requests (service_type);
CREATE INDEX IF NOT EXISTS idx_vgsr_status
  ON veraluz_guest_service_requests (status);

-- ─── 3. veraluz_guest_messages (GUEST-6) ─────────────────────
CREATE TABLE IF NOT EXISTS veraluz_guest_messages (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id   uuid        NOT NULL,
  guest_session_id uuid,                          /* null si envoi staff */
  sender_type      text        NOT NULL DEFAULT 'guest'
    CHECK (sender_type IN ('guest','staff')),
  staff_id         uuid,                          /* null si sender_type=guest */
  staff_name       text,
  channel          text        NOT NULL DEFAULT 'reception'
    CHECK (channel IN ('reception','direction')), /* direction = privé gérant/manager */
  message          text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at       timestamptz DEFAULT now(),
  read_at          timestamptz                    /* null = non lu côté staff */
);

ALTER TABLE veraluz_guest_messages DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_vgm_reservation
  ON veraluz_guest_messages (reservation_id);
CREATE INDEX IF NOT EXISTS idx_vgm_channel
  ON veraluz_guest_messages (channel);
CREATE INDEX IF NOT EXISTS idx_vgm_guest_session
  ON veraluz_guest_messages (guest_session_id);
CREATE INDEX IF NOT EXISTS idx_vgm_created_at
  ON veraluz_guest_messages (created_at DESC);
