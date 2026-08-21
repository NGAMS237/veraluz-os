// ═══════════════════════════════════════════════════════════════
// infra-health — INFRA-OPS-1R (aligned with canonical schema)
// Endpoint read-only : statut des events + jobs (observabilité).
// Accès réservé aux gérants (settings.manage) via X-Veraluz-Session.
// Auth : SHA-256(raw_token) → token_hash (pas session_token/is_active).
// Aucune donnée sensible dans la réponse.
// ═══════════════════════════════════════════════════════════════
// INTERDIT : stocker API key / secret / token / password / credentials
// ═══════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasCapability, normalizeRole } from '../_shared/_rbac.ts';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-veraluz-session',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

// ── SHA-256 canonique ────────────────────────────────────────
async function sha256hex(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(msg),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url        = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin      = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Auth : X-Veraluz-Session → SHA-256 → token_hash ─────────
  const rawToken = req.headers.get('X-Veraluz-Session') ?? '';
  if (!rawToken) return json({ ok: false, error: 'auth_required' }, 401);

  const tokenHash = await sha256hex(rawToken);

  const { data: session } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .single();

  if (!session)                                           return json({ ok: false, error: 'invalid_session'  }, 401);
  if (session.revoked_at)                                 return json({ ok: false, error: 'session_revoked'  }, 401);
  if (new Date(session.expires_at) < new Date())          return json({ ok: false, error: 'session_expired'  }, 401);

  const { data: actor } = await admin
    .from('veraluz_employees')
    .select('role')
    .eq('id', session.employee_id)
    .single();

  if (!actor) return json({ ok: false, error: 'actor_not_found' }, 403);

  const role = normalizeRole(actor.role);
  if (!hasCapability(role, 'settings.manage')) {
    return json({ ok: false, error: 'access_denied', hint: 'gerant_only' }, 403);
  }

  // ── Requêtes read-only ───────────────────────────────────────
  const statuses = ['pending', 'processing', 'completed', 'failed', 'dead'] as const;
  const jobCounts: Record<string, number> = {};

  await Promise.all(statuses.map(async (st) => {
    const { count } = await admin
      .from('veraluz_event_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', st);
    jobCounts[st] = count ?? 0;
  }));

  // Événements 24h — colonnes canoniques (created_at, source)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEvents } = await admin
    .from('veraluz_events')
    .select('id, event_type, source, created_at')
    .gte('created_at', since24h)
    .order('created_at', { ascending: false })
    .limit(50);

  // Jobs récents — sans payload ni secrets
  const { data: recentJobs } = await admin
    .from('veraluz_event_jobs')
    .select('id, event_id, handler, status, attempt, last_error, processed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  // Jobs dead (alerte)
  const { data: deadJobs } = await admin
    .from('veraluz_event_jobs')
    .select('id, event_id, handler, attempt, last_error, created_at')
    .eq('status', 'dead')
    .order('created_at', { ascending: false })
    .limit(10);

  // ── Comms (veraluz_communication_jobs) — sans recipient ni body ─
  // blocked_provider = email parqué car Resend non configuré (retries préservés)
  const commStatuses = ['pending', 'processing', 'completed', 'failed', 'dead', 'blocked_provider'] as const;
  const commCounts: Record<string, number> = {};

  await Promise.all(commStatuses.map(async (st) => {
    const { count } = await admin
      .from('veraluz_communication_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', st);
    commCounts[st] = count ?? 0;
  }));

  const { data: recentCommJobs } = await admin
    .from('veraluz_communication_jobs')
    .select('id, template_key, channel, status, attempt, processed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: deadCommJobs } = await admin
    .from('veraluz_communication_jobs')
    .select('id, template_key, channel, attempt, last_error, created_at')
    .eq('status', 'dead')
    .order('created_at', { ascending: false })
    .limit(10);

  // Agréger par type
  const eventsByType: Record<string, number> = {};
  for (const ev of recentEvents ?? []) {
    const t = ev.event_type as string;
    eventsByType[t] = (eventsByType[t] ?? 0) + 1;
  }

  // ── Documents (veraluz_document_jobs + veraluz_documents) ───────────────
  const docStatuses = ['pending', 'processing', 'completed', 'failed', 'dead'] as const;
  const docJobCounts: Record<string, number> = {};

  await Promise.all(docStatuses.map(async (st) => {
    const { count } = await admin
      .from('veraluz_document_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', st);
    docJobCounts[st] = count ?? 0;
  }));

  const { data: lastDocGenerated } = await admin
    .from('veraluz_documents')
    .select('id, document_type, related_record_id, status, generated_at, file_size_bytes')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  const { data: failedDocs } = await admin
    .from('veraluz_documents')
    .select('id, document_type, related_record_id, error_message, updated_at')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(5);

  // ── Oldest pending ages (watchdog) ───────────────────────────
  const { data: oldestEventPending } = await admin
    .from('veraluz_event_jobs')
    .select('created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  const { data: oldestCommPending } = await admin
    .from('veraluz_communication_jobs')
    .select('created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  const now = Date.now();
  const oldestEventAgeMs = oldestEventPending?.created_at
    ? now - new Date(oldestEventPending.created_at as string).getTime()
    : null;
  const oldestCommAgeMs = oldestCommPending?.created_at
    ? now - new Date(oldestCommPending.created_at as string).getTime()
    : null;

  // ── Scheduler : dernière run ─────────────────────────────────
  const { data: lastRun } = await admin
    .from('veraluz_infra_runs')
    .select('id, started_at, finished_at, status, duration_ms, trigger_source, recovered_jobs, event_processed, comm_processed, event_failed, comm_failed, event_dead, comm_dead, doc_processed, doc_completed, doc_failed, doc_dead')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  const lastRunStartedAt = lastRun?.started_at ? new Date(lastRun.started_at as string).getTime() : null;
  const schedulerAgeMs   = lastRunStartedAt ? now - lastRunStartedAt : null;
  const FIVE_MINUTES_MS  = 5 * 60 * 1000;

  // ── Niveaux d'alerte ─────────────────────────────────────────
  const hasDead =
    (deadJobs?.length    ?? 0) > 0 ||
    (deadCommJobs?.length ?? 0) > 0 ||
    (docJobCounts['dead'] ?? 0) > 0;
  const schedulerStale  = schedulerAgeMs === null || schedulerAgeMs > FIVE_MINUTES_MS;
  const pendingStale    =
    (oldestEventAgeMs !== null && oldestEventAgeMs > FIVE_MINUTES_MS) ||
    (oldestCommAgeMs  !== null && oldestCommAgeMs  > FIVE_MINUTES_MS);
  // blocked_provider > 0 → WARNING : emails en attente d'activation du provider email
  const hasBlockedProvider = (commCounts['blocked_provider'] ?? 0) > 0;
  // docs failed → WARNING : au moins un PDF n'a pas pu être généré
  const hasDocFailed = (failedDocs?.length ?? 0) > 0;

  const alert_level: 'OK' | 'WARNING' | 'CRITICAL' =
    hasDead || schedulerStale                              ? 'CRITICAL' :
    pendingStale || hasBlockedProvider || hasDocFailed     ? 'WARNING'  : 'OK';

  return json({
    ok: true,
    checked_at:  new Date().toISOString(),
    alert_level,
    scheduler: {
      last_run_at:       lastRun?.started_at         ?? null,
      last_run_status:   lastRun?.status              ?? null,
      last_run_duration_ms: lastRun?.duration_ms      ?? null,
      last_run_trigger:  lastRun?.trigger_source      ?? null,
      last_run_id:       lastRun?.id                  ?? null,
      age_ms:            schedulerAgeMs,
      stale:             schedulerStale,
      // Statistiques dernière run (sans données sensibles)
      last_event_processed: (lastRun?.event_processed as number) ?? null,
      last_comm_processed:  (lastRun?.comm_processed  as number) ?? null,
      last_doc_processed:   (lastRun?.doc_processed   as number) ?? null,
      last_event_failed:    (lastRun?.event_failed     as number) ?? null,
      last_comm_failed:     (lastRun?.comm_failed      as number) ?? null,
      last_doc_failed:      (lastRun?.doc_failed       as number) ?? null,
      last_recovered_jobs:  (lastRun?.recovered_jobs   as number) ?? null,
    },
    jobs: {
      counts:                jobCounts,
      recent:                recentJobs  ?? [],
      dead:                  deadJobs    ?? [],
      has_dead:              (deadJobs?.length ?? 0) > 0,
      oldest_pending_age_ms: oldestEventAgeMs,
    },
    events: {
      last_24h_total: recentEvents?.length ?? 0,
      by_type:        eventsByType,
      recent:         recentEvents ?? [],
    },
    comms: {
      counts:                   commCounts,
      recent:                   recentCommJobs  ?? [],
      dead:                     deadCommJobs    ?? [],
      has_dead:                 (deadCommJobs?.length ?? 0) > 0,
      oldest_pending_age_ms:    oldestCommAgeMs,
      // blocked_provider : jobs email en attente d'activation Resend — retries intacts
      blocked_provider_count:   commCounts['blocked_provider'] ?? 0,
      has_blocked_provider:     hasBlockedProvider,
    },
    documents: {
      job_counts:          docJobCounts,
      last_generated:      lastDocGenerated ?? null,
      failed:              failedDocs       ?? [],
      has_failed:          hasDocFailed,
    },
  });
});
