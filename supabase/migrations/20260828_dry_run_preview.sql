-- ============================================================
-- DRY RUN PREVIEW — RECOVERY LOT E
-- BEGIN … ROLLBACK — aucune donnée persistée
-- Exécute la migration ET teste le comportement réel des fonctions.
-- Les assertions suivantes auraient ÉCHOUÉ avec l'ancienne version.
-- ============================================================

BEGIN;

-- ─── Inclure le contenu de la migration ──────────────────────────────────────
\i supabase/migrations/20260828_recovery_lot_e_events_notifications_jobs.sql

-- ─── BLOC DE VÉRIFICATION : tests comportementaux réels ──────────────────────
DO $$
DECLARE
  v_result       JSONB;
  v_notif_id     TEXT;
  v_event_id     TEXT;
  v_idem_key     TEXT := 'dry-run-idem-' || gen_random_uuid()::text;
  v_job_name     TEXT := 'dry_run_test_job_' || left(gen_random_uuid()::text, 8);
  v_token        TEXT;
  v_notif_id2    TEXT;
  v_err          TEXT;
BEGIN

  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'DRY RUN LOT E — Tests comportementaux — BEGIN/ROLLBACK';
  RAISE NOTICE '═══════════════════════════════════════════════════════';

  -- ── T01 : Tables créées ──────────────────────────────────────────────────
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='veraluz_events'),
    'T01 FAIL: veraluz_events missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='veraluz_event_processing'),
    'T01b FAIL: veraluz_event_processing missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='veraluz_notifications'),
    'T01c FAIL: veraluz_notifications missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='notification_reads'),
    'T01d FAIL: notification_reads missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='veraluz_jobs'),
    'T01e FAIL: veraluz_jobs missing';
  RAISE NOTICE 'T01 PASS: toutes les tables présentes';

  -- ── T02 : RLS activé sur toutes les tables ───────────────────────────────
  ASSERT (SELECT rowsecurity FROM pg_class WHERE relname='veraluz_events' AND relnamespace='public'::regnamespace),
    'T02 FAIL: RLS not enabled on veraluz_events';
  ASSERT (SELECT rowsecurity FROM pg_class WHERE relname='veraluz_notifications' AND relnamespace='public'::regnamespace),
    'T02b FAIL: RLS not enabled on veraluz_notifications';
  ASSERT (SELECT rowsecurity FROM pg_class WHERE relname='veraluz_jobs' AND relnamespace='public'::regnamespace),
    'T02c FAIL: RLS not enabled on veraluz_jobs';
  RAISE NOTICE 'T02 PASS: RLS activé';

  -- ── T03 : idempotency_key UNIQUE sur veraluz_events ─────────────────────
  INSERT INTO public.veraluz_events (idempotency_key, event_type, source, payload)
  VALUES (v_idem_key, 'test_event', 'dry_run', '{}')
  RETURNING id INTO v_event_id;
  ASSERT v_event_id IS NOT NULL, 'T03 FAIL: insert veraluz_events échoué';

  BEGIN
    INSERT INTO public.veraluz_events (idempotency_key, event_type, source, payload)
    VALUES (v_idem_key, 'test_event', 'dry_run', '{}');
    ASSERT false, 'T03 FAIL: duplicate idempotency_key accepté (doit être rejeté)';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'T03 PASS: idempotency_key UNIQUE — doublon rejeté';
  END;

  -- ── T04 : veraluz_events IMMUABLE — UPDATE interdit ─────────────────────
  BEGIN
    UPDATE public.veraluz_events SET event_type = 'hacked' WHERE id = v_event_id;
    ASSERT false, 'T04 FAIL: UPDATE accepté sur veraluz_events (doit être interdit)';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'T04 PASS: UPDATE sur veraluz_events correctement bloqué par trigger';
  END;

  -- ── T05 : veraluz_events IMMUABLE — DELETE interdit ─────────────────────
  BEGIN
    DELETE FROM public.veraluz_events WHERE id = v_event_id;
    ASSERT false, 'T05 FAIL: DELETE accepté sur veraluz_events (doit être interdit)';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'T05 PASS: DELETE sur veraluz_events correctement bloqué par trigger';
  END;

  -- ── T06 : veraluz_notifications — idempotency_key UNIQUE ─────────────────
  INSERT INTO public.veraluz_notifications (title, message, idempotency_key, channels)
  VALUES ('Test notif', 'Message test', 'notif-idem-dry-run-001', ARRAY['in_app'])
  RETURNING id INTO v_notif_id;
  ASSERT v_notif_id IS NOT NULL, 'T06 FAIL: insert veraluz_notifications échoué';

  BEGIN
    INSERT INTO public.veraluz_notifications (title, message, idempotency_key, channels)
    VALUES ('Test notif 2', 'Message 2', 'notif-idem-dry-run-001', ARRAY['in_app']);
    ASSERT false, 'T06 FAIL: duplicate idempotency_key notifications accepté';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'T06 PASS: veraluz_notifications idempotency_key UNIQUE';
  END;

  -- ── T07 : notification_reads — UNIQUE(notification_id, employee_id) ──────
  INSERT INTO public.notification_reads (notification_id, employee_id, employee_role)
  VALUES (v_notif_id, 'emp-001', 'staff');

  INSERT INTO public.notification_reads (notification_id, employee_id, employee_role)
  VALUES (v_notif_id, 'emp-002', 'staff');  -- autre employé → doit réussir

  BEGIN
    INSERT INTO public.notification_reads (notification_id, employee_id, employee_role)
    VALUES (v_notif_id, 'emp-001', 'staff');  -- même employé → doit échouer
    ASSERT false, 'T07 FAIL: doublon notification_reads accepté';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'T07 PASS: notification_reads UNIQUE(notification_id, employee_id)';
  END;

  -- ── T08 : veraluz_notifications — CHECK channels valide ──────────────────
  BEGIN
    INSERT INTO public.veraluz_notifications (title, channels)
    VALUES ('Bad channel', ARRAY['invalid_channel']);
    ASSERT false, 'T08 FAIL: channel invalide accepté';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T08 PASS: channels CHECK constraint — valeur invalide rejetée';
  END;

  -- ── T09 : veraluz_notifications — CHECK recipient_roles valide ───────────
  BEGIN
    INSERT INTO public.veraluz_notifications (title, recipient_roles, channels)
    VALUES ('Bad role', ARRAY['hacker'], ARRAY['in_app']);
    ASSERT false, 'T09 FAIL: recipient_role invalide accepté';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T09 PASS: recipient_roles CHECK constraint — rôle invalide rejeté';
  END;

  -- ── T10 : claim_job_lease — job disabled → claimed=false ─────────────────
  INSERT INTO public.veraluz_jobs (name, cron_expression, worker_endpoint, enabled, dry_run)
  VALUES (v_job_name, '0 6 * * *', 'test-worker', false, false);

  v_result := public.claim_job_lease(v_job_name, 'worker-test-001', 300);
  ASSERT (v_result->>'claimed')::boolean = false, 'T10 FAIL: disabled job claim doit retourner claimed=false';
  ASSERT v_result->>'reason' = 'job_disabled', 'T10 FAIL: reason doit être job_disabled, got: ' || (v_result->>'reason');
  RAISE NOTICE 'T10 PASS: claim_job_lease job disabled → claimed=false';

  -- ── T11 : claim_job_lease — job dry_run → claimed=false ──────────────────
  UPDATE public.veraluz_jobs SET enabled=true, dry_run=true WHERE name=v_job_name;
  v_result := public.claim_job_lease(v_job_name, 'worker-test-001', 300);
  ASSERT (v_result->>'claimed')::boolean = false, 'T11 FAIL: dry_run job claim doit retourner claimed=false';
  ASSERT v_result->>'reason' = 'job_dry_run', 'T11 FAIL: reason doit être job_dry_run';
  RAISE NOTICE 'T11 PASS: claim_job_lease job dry_run → claimed=false';

  -- ── T12 : claim_job_lease — enabled + non dry_run → claimed=true ─────────
  UPDATE public.veraluz_jobs SET enabled=true, dry_run=false WHERE name=v_job_name;
  v_result := public.claim_job_lease(v_job_name, 'worker-test-001', 300);
  ASSERT (v_result->>'claimed')::boolean = true, 'T12 FAIL: claim doit réussir sur job enabled+non-dry_run';
  v_token := v_result->>'lease_token';
  ASSERT v_token IS NOT NULL AND length(v_token) > 0, 'T12 FAIL: lease_token absent';
  RAISE NOTICE 'T12 PASS: claim_job_lease → claimed=true, lease_token présent';

  -- ── T13 : deux workers ne peuvent pas obtenir le même job ─────────────────
  v_result := public.claim_job_lease(v_job_name, 'worker-test-002', 300);
  ASSERT (v_result->>'claimed')::boolean = false, 'T13 FAIL: second worker ne doit pas obtenir le lease';
  ASSERT v_result->>'reason' = 'lease_active', 'T13 FAIL: reason doit être lease_active';
  RAISE NOTICE 'T13 PASS: deux workers ne peuvent pas obtenir le même lease';

  -- ── T14 : release_job_lease — mauvais token → released=false ─────────────
  v_result := public.release_job_lease(v_job_name, 'wrong-token-xyz', 'success', 100, NULL);
  ASSERT (v_result->>'released')::boolean = false, 'T14 FAIL: mauvais token doit retourner released=false';
  RAISE NOTICE 'T14 PASS: release avec mauvais lease_token → released=false';

  -- ── T15 : release_job_lease — bon token → released=true ──────────────────
  v_result := public.release_job_lease(v_job_name, v_token, 'success', 500, NULL);
  ASSERT (v_result->>'released')::boolean = true, 'T15 FAIL: bon token doit retourner released=true';
  -- Vérifier que le job est bien libéré
  ASSERT NOT EXISTS (SELECT 1 FROM public.veraluz_jobs WHERE name=v_job_name AND running=true),
    'T15 FAIL: job toujours running après release';
  RAISE NOTICE 'T15 PASS: release_job_lease bon token → released=true, job libéré';

  -- ── T16 : release_job_lease — status invalide → erreur ───────────────────
  v_result := public.release_job_lease(v_job_name, v_token, 'invalid_status', NULL, NULL);
  ASSERT (v_result->>'released')::boolean = false, 'T16 FAIL: status invalide doit retourner released=false';
  ASSERT v_result->>'reason' = 'invalid_status', 'T16 FAIL: reason doit être invalid_status';
  RAISE NOTICE 'T16 PASS: release_job_lease status invalide rejeté';

  -- ── T17 : claim_job_lease — lease_secs invalide ───────────────────────────
  v_result := public.claim_job_lease(v_job_name, 'worker-001', 9999);
  ASSERT (v_result->>'claimed')::boolean = false, 'T17 FAIL: lease_secs invalide doit retourner claimed=false';
  ASSERT v_result->>'reason' = 'invalid_lease_secs', 'T17 FAIL: reason doit être invalid_lease_secs';
  RAISE NOTICE 'T17 PASS: claim_job_lease lease_secs invalide rejeté';

  -- ── T18 : recover_expired_job_leases — lease expiré récupéré ─────────────
  -- Reclaim le job et forcer l'expiration
  UPDATE public.veraluz_jobs
  SET enabled=true, dry_run=false, running=false WHERE name=v_job_name;

  v_result := public.claim_job_lease(v_job_name, 'worker-expire', 300);
  ASSERT (v_result->>'claimed')::boolean = true, 'T18 setup FAIL: reclaim échoué';

  -- Forcer l'expiration du lease
  UPDATE public.veraluz_jobs SET lease_expires_at = now() - interval '1 second' WHERE name=v_job_name;

  v_result := public.recover_expired_job_leases();
  ASSERT (v_result->>'recovered')::int >= 1, 'T18 FAIL: aucun lease récupéré';
  ASSERT NOT EXISTS (SELECT 1 FROM public.veraluz_jobs WHERE name=v_job_name AND running=true),
    'T18 FAIL: job toujours running après recover';
  RAISE NOTICE 'T18 PASS: recover_expired_job_leases — lease expiré récupéré';

  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'T01–T18 : tous PASS ✓';
  RAISE NOTICE '═══════════════════════════════════════════════════════';

END $$;

-- ─── ROLLBACK — aucune donnée ne persiste ─────────────────────────────────────
ROLLBACK;

-- ─── Vérification post-ROLLBACK : tables Lot E absentes ──────────────────────
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN (
      'veraluz_events','veraluz_event_processing',
      'veraluz_notifications','notification_reads','veraluz_jobs'
    )),
    'POST-ROLLBACK FAIL: objets Lot E persistent après ROLLBACK';
  RAISE NOTICE 'POST-ROLLBACK PASS: aucun objet Lot E persisté — dry-run propre';
END $$;

-- ============================================================
-- FIN DRY RUN — ROLLBACK OK | Aucune donnée PROD modifiée
-- Aucun email envoyé | Aucun cron activé | Aucune donnée synthétique
-- ============================================================
