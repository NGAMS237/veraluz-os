// ═══════════════════════════════════════════════════════════════
// event-worker — INFRA-OPS-1
// Traitement idempotent des veraluz_event_jobs.
// Appelé par cron Supabase ou HTTP POST (service_role requis).
// Max 20 jobs par invocation. Max 4 tentatives par job.
// ═══════════════════════════════════════════════════════════════
// INTERDIT : stocker API key / secret / token / password / credentials
// INTERDIT : merge main sans autorisation explicite
// ═══════════════════════════════════════════════════════════════

import { serve }               from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient }        from 'https://esm.sh/@supabase/supabase-js@2';

const TENANT        = 'veraluz-001';
const BATCH_SIZE    = 20;
const SYSTEM_NAME   = 'Système Veraluz';
// UUID zéro — sender système (pas un vrai employé)
const SYSTEM_SENDER = '00000000-0000-0000-0000-000000000001';

// ── CORS minimal (invocation HTTP) ───────────────────────────
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-veraluz-session',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// ── Mapping service_type → department (staff messages) ───────
const SERVICE_DEPT: Record<string, string> = {
  housekeeping: 'housekeeping',
  towels:       'housekeeping',
  maintenance:  'maintenance',
  reception:    'direction',
  other:        'direction',
};

// ── Handlers ─────────────────────────────────────────────────

// HANDLER 1 : guest_checked_out → tâche ménage dans veraluz_housekeeping
async function handleCreateHousekeepingTask(
  admin:    ReturnType<typeof createClient>,
  payload:  Record<string, unknown>,
  event_id: string,
): Promise<void> {
  const unit_id        = payload['unit_id']        as string | null;
  const reservation_id = payload['reservation_id'] as string | null;
  const guest_name     = payload['guest_name']     as string | null;

  const { error } = await admin.from('veraluz_housekeeping').insert({
    unit_id:         unit_id  || null,
    reservation_id:  reservation_id || null,
    task_type:       'checkout_clean',
    status:          'pending',
    priority:        'high',
    notes:           guest_name ? `Départ client : ${guest_name}` : 'Nettoyage départ',
    source_event_id: event_id,
  });

  if (error) throw new Error(`housekeeping insert: ${error.message}`);

  console.log(`[event-worker] create_housekeeping_task OK event_id=${event_id} unit_id=${unit_id}`);
}

// HANDLER 2 : guest_service_requested → message interne staff
async function handleCreateStaffNotification(
  admin:    ReturnType<typeof createClient>,
  payload:  Record<string, unknown>,
  event_id: string,
): Promise<void> {
  const service_type   = (payload['service_type']   as string) || 'other';
  const reservation_id = (payload['reservation_id'] as string) || '';
  const note           = (payload['note']           as string) || '';
  const unit_id        = (payload['unit_id']        as string) || '';

  const dept    = SERVICE_DEPT[service_type] ?? 'direction';
  const subject = `Demande de service : ${service_type}`;
  const message = [
    `Nouvelle demande de service reçue via le portail client.`,
    `Type : ${service_type}`,
    unit_id        ? `Logement : ${unit_id}` : '',
    reservation_id ? `Réservation : ${reservation_id}` : '',
    note           ? `Note client : ${note}` : '',
    `Événement : ${event_id}`,
  ].filter(Boolean).join('\n');

  const { error } = await admin.from('veraluz_internal_messages').insert({
    tenant_id:      TENANT,
    sender_id:      SYSTEM_SENDER,
    sender_name:    SYSTEM_NAME,
    recipient_id:   null,
    recipient_type: 'department',
    department:     dept,
    subject,
    message,
    is_draft:       false,
    priority:       'normal',
    context_type:   'service_request',
    context_id:     reservation_id || null,
  });

  if (error) throw new Error(`internal_messages insert: ${error.message}`);

  console.log(`[event-worker] create_staff_notification OK event_id=${event_id} dept=${dept}`);
}

// ── Dispatch ─────────────────────────────────────────────────
async function runHandler(
  admin:    ReturnType<typeof createClient>,
  handler:  string,
  payload:  Record<string, unknown>,
  event_id: string,
): Promise<void> {
  switch (handler) {
    case 'create_housekeeping_task':
      return handleCreateHousekeepingTask(admin, payload, event_id);
    case 'create_staff_notification':
      return handleCreateStaffNotification(admin, payload, event_id);
    default:
      throw new Error(`unknown_handler: ${handler}`);
  }
}

// ── Main serve ───────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Vérification service_role uniquement (pas de JWT invité)
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || !authHeader.endsWith(serviceKey)) {
    return json({ ok: false, error: 'service_role_required' }, 403);
  }

  const url  = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started_at = Date.now();
  const results: Array<{ job_id: string; handler: string; status: string; attempt: number; error?: string }> = [];

  // 1. Lire les jobs pending (BATCH_SIZE max)
  const { data: jobs, error: fetchErr } = await admin
    .from('veraluz_event_jobs')
    .select('id, event_id, handler, attempt, max_attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, duration_ms: Date.now() - started_at });
  }

  // 2. Traiter chaque job
  for (const job of jobs) {
    const attempt = (job.attempt as number) + 1;

    // Marquer processing (évite double-exécution si worker parallèle)
    const { error: lockErr } = await admin
      .from('veraluz_event_jobs')
      .update({ status: 'processing', attempt })
      .eq('id', job.id)
      .eq('status', 'pending'); // guard : annule si déjà pris

    if (lockErr) {
      results.push({ job_id: job.id, handler: job.handler, status: 'skipped_locked', attempt });
      continue;
    }

    // Charger le payload de l'événement
    const { data: ev, error: evErr } = await admin
      .from('veraluz_events')
      .select('event_type, payload')
      .eq('id', job.event_id)
      .single();

    if (evErr || !ev) {
      await admin.from('veraluz_event_jobs').update({
        status:       'dead',
        last_error:   `event_not_found: ${evErr?.message ?? ''}`,
        processed_at: new Date().toISOString(),
      }).eq('id', job.id);
      results.push({ job_id: job.id, handler: job.handler, status: 'dead', attempt, error: 'event_not_found' });
      continue;
    }

    // Exécuter le handler
    let lastError: string | undefined;
    try {
      await runHandler(admin, job.handler, ev.payload as Record<string, unknown>, job.event_id);

      await admin.from('veraluz_event_jobs').update({
        status:       'completed',
        processed_at: new Date().toISOString(),
      }).eq('id', job.id);

      results.push({ job_id: job.id, handler: job.handler, status: 'completed', attempt });
      console.log(`[event-worker] job_id=${job.id} handler=${job.handler} attempt=${attempt} status=completed duration_ms=${Date.now()-started_at}`);

    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      const isDead = attempt >= (job.max_attempts as number);

      await admin.from('veraluz_event_jobs').update({
        status:       isDead ? 'dead' : 'failed',
        last_error:   lastError,
        processed_at: isDead ? new Date().toISOString() : null,
      }).eq('id', job.id);

      results.push({ job_id: job.id, handler: job.handler, status: isDead ? 'dead' : 'failed', attempt, error: lastError });
      console.error(`[event-worker] job_id=${job.id} handler=${job.handler} attempt=${attempt} status=${isDead?'dead':'failed'} error=${lastError}`);
    }

    // Reschedule failed jobs to pending (pour retry au prochain cycle)
    if (results.at(-1)?.status === 'failed') {
      await admin.from('veraluz_event_jobs').update({ status: 'pending' }).eq('id', job.id);
    }
  }

  const duration_ms = Date.now() - started_at;
  const summary = {
    ok:          true,
    processed:   results.length,
    completed:   results.filter(r => r.status === 'completed').length,
    failed:      results.filter(r => r.status === 'failed').length,
    dead:        results.filter(r => r.status === 'dead').length,
    duration_ms,
    // Logs structurés : event_id, function, handler, status, attempt, duration_ms — jamais de secrets
    results,
  };

  console.log(`[event-worker] batch done processed=${summary.processed} completed=${summary.completed} failed=${summary.failed} dead=${summary.dead} duration_ms=${duration_ms}`);
  return json(summary);
});
