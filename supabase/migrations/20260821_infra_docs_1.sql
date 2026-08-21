-- =============================================================================
-- INFRA-DOCS-1 : Moteur documentaire déterministe — reçus & folios PDF
-- Migration : 20260821_infra_docs_1.sql
-- Branche   : claude/settings-ssot-1a
-- =============================================================================
-- INTERDIT : tenant_id / merge main / déploiement / API key en DB / IA pour
--            calcul / montant / ligne / numéro / rendu document
-- FORMULE SSOT: lodging = reservation.total (JAMAIS recalculé)
--               charges = SUM(veraluz_room_charges.amount) — montants nets
--               gross   = lodging + charges
--               payments = SUM(veraluz_payments.amount WHERE status='validated')
--               balance  = gross - payments
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Bucket Storage privé veraluz-documents-private
--    public = false — accès uniquement via signed URL (service_role)
--    Aucune URL publique permanente
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'veraluz-documents-private',
  'veraluz-documents-private',
  false,                        -- JAMAIS public
  5242880,                      -- 5 MB max par PDF
  ARRAY['application/pdf']
) ON CONFLICT (id) DO NOTHING;

-- RLS bucket : AUCUN accès direct — service_role bypasse RLS automatiquement
-- Pas de politique USING(true) — deny-all pour rôles Supabase Auth
CREATE POLICY IF NOT EXISTS no_direct_access_documents_bucket
  ON storage.objects FOR ALL
  USING (bucket_id = 'veraluz-documents-private' AND false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. veraluz_documents — registre des PDFs générés
--    storage_path : chemin dans bucket (jamais URL publique)
--    UNIQUE (document_type, related_record_id) → idempotence
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veraluz_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type     text        NOT NULL
    CHECK (document_type IN ('payment_receipt', 'stay_folio')),
  related_module    text        NOT NULL
    CHECK (related_module IN ('payments', 'reservations')),
  related_record_id text        NOT NULL,  -- payment_id ou reservation_id
  reservation_id    text        NOT NULL,  -- isolation guest A ≠ guest B
  storage_path      text,                  -- chemin dans veraluz-documents-private
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  generated_at      timestamptz,
  file_size_bytes   int,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, related_record_id)   -- un seul PDF par paiement / séjour
);

CREATE INDEX IF NOT EXISTS idx_veraluz_documents_reservation_id
  ON veraluz_documents (reservation_id);

CREATE INDEX IF NOT EXISTS idx_veraluz_documents_status
  ON veraluz_documents (status, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE veraluz_documents ENABLE ROW LEVEL SECURITY;
-- service_role bypasse RLS — deny-all pour autres rôles
CREATE POLICY IF NOT EXISTS no_direct_access_documents
  ON veraluz_documents AS RESTRICTIVE FOR ALL TO public USING (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. veraluz_document_jobs — file de génération PDF
--    UNIQUE (event_id, document_type) — idempotence
--    claim_document_jobs : FOR UPDATE SKIP LOCKED (concurrent-safe)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veraluz_document_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid        NOT NULL REFERENCES veraluz_events(id),
  document_type     text        NOT NULL
    CHECK (document_type IN ('payment_receipt', 'stay_folio')),
  related_record_id text        NOT NULL,  -- payment_id ou reservation_id
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempt           int         NOT NULL DEFAULT 0,
  max_attempts      int         NOT NULL DEFAULT 4,
  last_error        text,
  worker_id         text,       -- run_id du scheduler (traçabilité)
  claimed_at        timestamptz,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, document_type)  -- idempotence
);

CREATE INDEX IF NOT EXISTS idx_doc_jobs_status_created
  ON veraluz_document_jobs (status, created_at)
  WHERE status = 'pending';

ALTER TABLE veraluz_document_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'veraluz_document_jobs'
      AND policyname = 'no_direct_access_doc_jobs'
  ) THEN
    CREATE POLICY no_direct_access_doc_jobs ON veraluz_document_jobs
      AS RESTRICTIVE FOR ALL TO public USING (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC claim_document_jobs — verrou atomique + incrément attempt
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION claim_document_jobs(
  p_batch      int  DEFAULT 10,
  p_worker_id  text DEFAULT NULL
)
RETURNS SETOF veraluz_document_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE veraluz_document_jobs dj
  SET    status     = 'processing',
         attempt    = dj.attempt + 1,
         worker_id  = p_worker_id,
         claimed_at = now(),
         updated_at = now()
  FROM (
    SELECT id
    FROM   veraluz_document_jobs
    WHERE  status = 'pending'
    ORDER  BY created_at
    LIMIT  p_batch
    FOR UPDATE SKIP LOCKED
  ) sub
  WHERE  dj.id = sub.id
  RETURNING dj.*;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Étendre recover_stale_jobs pour inclure les document_jobs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recover_stale_jobs(
  p_threshold_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff    timestamptz := now() - (p_threshold_minutes || ' minutes')::interval;
  v_ev_count  int;
  v_com_count int;
  v_doc_count int;
BEGIN
  -- ── Event jobs ────────────────────────────────────────────────
  WITH stale_ev AS (
    UPDATE veraluz_event_jobs
    SET    status     = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
           last_error = CASE WHEN attempt >= max_attempts
                             THEN 'recovered_dead_stale'
                             ELSE 'recovered_stale_processing'
                        END,
           updated_at = now()
    WHERE  status     = 'processing'
      AND  claimed_at < v_cutoff
      AND  status NOT IN ('completed','dead')
    RETURNING id
  )
  SELECT count(*) INTO v_ev_count FROM stale_ev;

  -- ── Communication jobs ────────────────────────────────────────
  WITH stale_comm AS (
    UPDATE veraluz_communication_jobs
    SET    status     = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
           last_error = CASE WHEN attempt >= max_attempts
                             THEN 'recovered_dead_stale'
                             ELSE 'recovered_stale_processing'
                        END,
           updated_at = now()
    WHERE  status     = 'processing'
      AND  claimed_at < v_cutoff
      AND  status NOT IN ('completed','dead')
    RETURNING id
  )
  SELECT count(*) INTO v_com_count FROM stale_comm;

  -- ── Document jobs ─────────────────────────────────────────────
  WITH stale_doc AS (
    UPDATE veraluz_document_jobs
    SET    status     = CASE WHEN attempt >= max_attempts THEN 'dead' ELSE 'pending' END,
           last_error = CASE WHEN attempt >= max_attempts
                             THEN 'recovered_dead_stale'
                             ELSE 'recovered_stale_processing'
                        END,
           updated_at = now()
    WHERE  status     = 'processing'
      AND  claimed_at < v_cutoff
      AND  status NOT IN ('completed','dead')
    RETURNING id
  )
  SELECT count(*) INTO v_doc_count FROM stale_doc;

  RETURN jsonb_build_object(
    'recovered_event_jobs', v_ev_count,
    'recovered_comm_jobs',  v_com_count,
    'recovered_doc_jobs',   v_doc_count,
    'threshold_minutes',    p_threshold_minutes,
    'cutoff',               v_cutoff
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Étendre veraluz_infra_runs — colonnes document-worker
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE veraluz_infra_runs
  ADD COLUMN IF NOT EXISTS doc_processed  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_completed  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_failed     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_dead       int NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. vz_emit_payment_event — ajouter document_job payment_receipt
--    CORRIGER IN PLACE (CREATE OR REPLACE)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_payment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eid          uuid;
  v_reservation  text;
  v_client_email text;
  v_gs_id        text;
BEGIN
  -- Guard : uniquement UPDATE avec vraie transition vers validated
  IF TG_OP = 'INSERT' AND NEW.status != 'validated' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'validated' THEN RETURN NEW; END IF;
    IF NEW.status != 'validated'  THEN RETURN NEW; END IF;
  END IF;

  -- Récupérer reservation_id (TEXT) et client_email depuis veraluz_reservations
  SELECT r.id::text, r.client_email
  INTO   v_reservation, v_client_email
  FROM   veraluz_reservations r
  WHERE  r.id::text = NEW.reservation_id::text
  LIMIT  1;

  -- Payload minimal — JAMAIS proof_url, données carte, token, secret
  v_eid := gen_random_uuid();
  INSERT INTO veraluz_events (
    id, event_type, payload, source,
    entity_type, entity_id,
    reservation_id, actor_type, actor_id, created_at
  ) VALUES (
    v_eid,
    'payment_recorded',
    jsonb_build_object(
      'payment_id',     NEW.id,
      'reservation_id', COALESCE(v_reservation, NEW.reservation_id::text),
      'amount',         NEW.amount,
      'method',         NEW.method,
      'validated_at',   now()
      -- INTERDIT : proof_url, card_data, token, secret
    ),
    'db_trigger',
    'payment', NEW.id::text,
    COALESCE(v_reservation, NEW.reservation_id::text),
    'system', 'payment_trigger',
    now()
  )
  ON CONFLICT DO NOTHING;

  -- ── Document job : PDF reçu de paiement ──────────────────────
  INSERT INTO veraluz_document_jobs
    (event_id, document_type, related_record_id,
     status, attempt, max_attempts, updated_at, created_at)
  VALUES
    (v_eid, 'payment_receipt', NEW.id::text,
     'pending', 0, 4, now(), now())
  ON CONFLICT (event_id, document_type) DO NOTHING;

  -- ── Comm job : email confirmation si client_email ─────────────
  IF v_client_email IS NOT NULL AND v_client_email != '' THEN
    INSERT INTO veraluz_communication_jobs
      (event_id, template_key, channel, recipient_ref,
       status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid, 'payment_confirmed', 'email', v_client_email,
       'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
  END IF;

  -- ── Comm job : guest_portal si session active ─────────────────
  SELECT gs.id::text INTO v_gs_id
  FROM   veraluz_guest_sessions gs
  WHERE  gs.reservation_id = COALESCE(v_reservation, NEW.reservation_id::text)
    AND  gs.status       = 'active'
    AND  gs.revoked_at   IS NULL
    AND  gs.expires_at   >  now()
  ORDER  BY gs.created_at DESC
  LIMIT  1;

  IF v_gs_id IS NOT NULL THEN
    INSERT INTO veraluz_communication_jobs
      (event_id, template_key, channel, recipient_ref,
       status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid, 'payment_confirmed', 'guest_portal', v_gs_id,
       'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger existe déjà — DROP/CREATE pour s'assurer qu'il est attaché.
DROP TRIGGER IF EXISTS trg_payment_recorded ON veraluz_payments;
CREATE TRIGGER trg_payment_recorded
  AFTER INSERT OR UPDATE OF status ON veraluz_payments
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_payment_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. vz_emit_reservation_event — ajouter document_job stay_folio au checkout
--    CORRIGER IN PLACE (CREATE OR REPLACE)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vz_emit_reservation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_name  text;
  v_gs_id       text;
  v_eid_out     uuid;
  v_eid_in      uuid;
  v_eid_conf    uuid;
BEGIN
  v_guest_name := COALESCE(NEW.client_name, 'Client');

  -- ── Checkout ──────────────────────────────────────────────────
  IF (OLD.status = 'checkedin' AND NEW.status = 'checkedout') THEN
    v_eid_out := gen_random_uuid();

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_eid_out, 'guest_checked_out', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'unit_id',        NEW.unit_id,
        'guest_id',       NEW.client_id,
        'guest_name',     v_guest_name,
        'checkout_time',  now()
      ),
      now()
    ) ON CONFLICT DO NOTHING;

    -- Event job : nettoyage
    INSERT INTO veraluz_event_jobs (event_id, handler, status, attempt, max_attempts, updated_at, created_at)
    VALUES (v_eid_out, 'create_housekeeping_task', 'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, handler) DO NOTHING;

    -- Document job : folio de séjour PDF (reservation_id comme related_record_id)
    INSERT INTO veraluz_document_jobs
      (event_id, document_type, related_record_id,
       status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid_out, 'stay_folio', NEW.id::text,
       'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, document_type) DO NOTHING;

  END IF;

  -- ── Check-in ──────────────────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'checkedin' AND NEW.status = 'checkedin') THEN
    v_eid_in := gen_random_uuid();

    SELECT id::text INTO v_gs_id
    FROM   veraluz_guest_sessions
    WHERE  reservation_id = NEW.id
      AND  status     = 'active'
      AND  revoked_at IS NULL
      AND  expires_at > now()
    ORDER  BY created_at DESC
    LIMIT  1;

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_eid_in, 'guest_checked_in', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id',   NEW.id,
        'unit_id',          NEW.unit_id,
        'guest_id',         NEW.client_id,
        'guest_name',       v_guest_name,
        'client_email',     NEW.client_email,
        'check_in',         NEW.check_in,
        'check_out',        NEW.check_out,
        'guest_session_id', v_gs_id
      ),
      now()
    ) ON CONFLICT DO NOTHING;

    IF v_gs_id IS NOT NULL THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
      VALUES
        (v_eid_in, 'checkin_welcome', 'guest_portal', v_gs_id, 'pending', 0, 4, now(), now())
      ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
    END IF;

    IF NEW.client_email IS NOT NULL AND NEW.client_email <> '' THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
      VALUES
        (v_eid_in, 'checkin_welcome', 'email', NEW.client_email, 'pending', 0, 4, now(), now())
      ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
    END IF;

  END IF;

  -- ── Reservation confirmed ─────────────────────────────────────
  IF (OLD.status IS DISTINCT FROM 'confirmed' AND NEW.status = 'confirmed') THEN
    v_eid_conf := gen_random_uuid();

    INSERT INTO veraluz_events (
      id, event_type, source,
      entity_type, entity_id,
      reservation_id, unit_id,
      actor_type, actor_id,
      payload, created_at
    ) VALUES (
      v_eid_conf, 'reservation_confirmed', 'reservation-workflow',
      'reservation', NEW.id::text,
      NEW.id::text, NEW.unit_id::text,
      'system', 'trigger',
      jsonb_build_object(
        'reservation_id', NEW.id,
        'unit_id',        NEW.unit_id,
        'guest_id',       NEW.client_id,
        'guest_name',     v_guest_name,
        'client_email',   NEW.client_email,
        'check_in',       NEW.check_in,
        'check_out',      NEW.check_out
      ),
      now()
    ) ON CONFLICT DO NOTHING;

    INSERT INTO veraluz_communication_jobs
      (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
    VALUES
      (v_eid_conf, 'booking_confirmation', 'internal', 'department:reception', 'pending', 0, 4, now(), now())
    ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;

    IF NEW.client_email IS NOT NULL AND NEW.client_email <> '' THEN
      INSERT INTO veraluz_communication_jobs
        (event_id, template_key, channel, recipient_ref, status, attempt, max_attempts, updated_at, created_at)
      VALUES
        (v_eid_conf, 'reservation_confirmed', 'email', NEW.client_email, 'pending', 0, 4, now(), now())
      ON CONFLICT (event_id, template_key, channel, recipient_ref) DO NOTHING;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Re-attacher le trigger (déjà présent — DROP/CREATE sûr)
DROP TRIGGER IF EXISTS trg_emit_reservation_event ON veraluz_reservations;
CREATE TRIGGER trg_emit_reservation_event
  AFTER UPDATE OF status ON veraluz_reservations
  FOR EACH ROW
  EXECUTE FUNCTION vz_emit_reservation_event();

-- =============================================================================
-- FIN 20260821_infra_docs_1.sql (INFRA-DOCS-1)
-- =============================================================================
