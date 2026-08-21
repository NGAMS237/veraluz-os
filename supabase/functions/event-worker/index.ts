// ═══════════════════════════════════════════════════════════════
// event-worker — INFRA-OPS-1R (aligned with canonical schema)
// Traitement idempotent des veraluz_event_jobs.
// Appelé par cron Supabase ou HTTP POST (service_role requis).
// Verrou atomique via RPC claim_event_jobs (FOR UPDATE SKIP LOCKED).
// ═══════════════════════════════════════════════════════════════
// INTERDIT : tenant_id / secrets / API keys / passwords
// INTERDIT : merge main sans autorisation explicite
// ═══════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BATCH_SIZE    = 20;
const SYSTEM_NAME   = 'Système Veraluz';
const SYSTEM_SENDER = '00000000-0000-0000-0000-000000000001';

// ── CORS minimal ─────────────────────────────────────────────
const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-veraluz-session',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

// ── Mapping service_type → department ────────────────────────
// reception → 'reception'  (guichet, pas direction)
// other     → 'reception'  (par défaut)
const SERVICE_DEPT: Record<string, string> = {
  housekeeping: 'housekeeping',
  towels:       'housekeeping',
  maintenance:  'maintenance',
  reception:    'reception',
  other:        'reception',
};

// ── HANDLER 1 : guest_checked_out → tâche ménage ─────────────
async function handleCreateHousekeepingTask(
  admin:    ReturnType<typeof createClient>,
  payload:  Record<string, unknown>,
  event_id: string,
): Promise<void> {
  const unit_id        = (payload['unit_id']        as string)  || null;
  const reservation_id = (payload['reservation_id'] as string)  || null;
  const guest_name     = (payload['guest_name']     as string)  || null;

  // Schéma réel : id text (généré), type='cleaning' (pas task_type)
  // source_event_id UNIQUE → ON CONFLICT DO NOTHING = idempotent
  const { error } = await admin
    .from('veraluz_housekeeping')
    .upsert(
      {
        unit_id,
        reservation_id,
        type:            'cleaning',
        task_label:      'Nettoyage départ',
        status:          'pending',
        priority:        'high',
        notes:           guest_name ? `Départ client : ${guest_name}` : 'Nettoyage départ',
        source_event_id: event_id,
        scheduled_for:   new Date().toISOString().slice(0, 10),
      },
      { onConflict: 'source_event_id', ignoreDuplicates: true },
    );

  if (error) throw new Error(`housekeeping upsert: ${error.message}`);

  console.log(`[event-worker] create_housekeeping_task ok event_id=${event_id} unit_id=${unit_id}`);
}

// ── HANDLER 2 : guest_service_requested → message interne ────
async function handleCreateStaffNotification(
  admin:    ReturnType<typeof createClient>,
  payload:  Record<string, unknown>,
  event_id: string,
): Promise<void> {
  const service_type   = (payload['service_type']   as string) || 'other';
  const reservation_id = (payload['reservation_id'] as string) || '';
  const note           = (payload['notes']          as string) || (payload['note'] as string) || '';
  const unit_id        = (payload['unit_id']        as string) || '';

  const dept    = SERVICE_DEPT[service_type] ?? 'reception';
  const subject = `Demande de service : ${service_type}`;
  const message = [
    'Nouvelle demande de service reçue via le portail client.',
    `Type : ${service_type}`,
    unit_id        ? `Logement : ${unit_id}` : '',
    reservation_id ? `Réservation : ${reservation_id}` : '',
    note           ? `Note client : ${note}` : '',
    `Événement : ${event_id}`,
  ].filter(Boolean).join('\n');

  // source_event_job = clé d'idempotence (UNIQUE index sur la colonne)
  const source_event_job = `${event_id}:create_staff_notification`;

  const { error } = await admin
    .from('veraluz_internal_messages')
    .upsert(
      {
        sender_id:       SYSTEM_SENDER,
        sender_name:     SYSTEM_NAME,
        recipient_id:    null,
        recipient_type:  'department',
        department:      dept,
        subject,
        message,
        is_draft:        false,
        priority:        'normal',
        context_type:    'service_request',
        context_id:      reservation_id || null,
        source_event_job,
      },
      { onConflict: 'source_event_job', ignoreDuplicates: true },
    );

  if (error) throw new Error(`internal_messages upsert: ${error.message}`);

  console.log(`[event-worker] create_staff_notification ok event_id=${event_id} dept=${dept}`);
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

// ── Main ─────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Sécurité : service_role uniquement — correspondance EXACTE Bearer <key>
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return json({ ok: false, error: 'service_role_required' }, 403);
  }

  const url   = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started_at = Date.now();
  const results: Array<{
    job_id:   string;
    handler:  string;
    status:   string;
    attempt:  number;
    error?:   string;
  }> = [];

  // Lire worker_id depuis le body (transmis par infra-scheduler pour traçabilité run→worker→job)
  let worker_id = '';
  try {
    const body = await req.json() as Record<string, unknown>;
    worker_id  = (body['worker_id'] as string) || '';
  } catch { /* body vide ou absent — worker_id reste '' */ }

  // ── Verrou atomique via RPC ───────────────────────────────────
  // claim_event_jobs retourne UNIQUEMENT les jobs réclamés.
  // Si 0 lignes → aucun travail, retour immédiat.
  const { data: jobs, error: claimErr } = await admin
    .rpc('claim_event_jobs', { p_batch: BATCH_SIZE, p_worker_id: worker_id || null });

  if (claimErr) {
    console.error('[event-worker] claim_event_jobs error:', claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, duration_ms: Date.now() - started_at });
  }

  // ── Traitement job par job ────────────────────────────────────
  for (const job of jobs) {
    const attempt = (job.attempt as number); // déjà incrémenté par le trigger/RPC

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

    let lastError: string | undefined;
    try {
      await runHandler(admin, job.handler, (ev.payload as Record<string, unknown>) ?? {}, job.event_id);

      await admin.from('veraluz_event_jobs').update({
        status:       'completed',
        processed_at: new Date().toISOString(),
      }).eq('id', job.id);

      results.push({ job_id: job.id, handler: job.handler, status: 'completed', attempt });
      console.log(`[event-worker] job=${job.id} handler=${job.handler} attempt=${attempt} status=completed`);

    } catch (err: unknown) {
      lastError        = err instanceof Error ? err.message : String(err);
      const isDead     = attempt >= (job.max_attempts as number);
      const nextStatus = isDead ? 'dead' : 'failed';

      await admin.from('veraluz_event_jobs').update({
        status:       isDead ? 'dead' : 'pending', // failed → pending pour retry
        last_error:   lastError,
        processed_at: isDead ? new Date().toISOString() : null,
      }).eq('id', job.id);

      results.push({ job_id: job.id, handler: job.handler, status: nextStatus, attempt, error: lastError });
      console.error(`[event-worker] job=${job.id} handler=${job.handler} attempt=${attempt} status=${nextStatus} error=${lastError}`);
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
    // Logs structurés : job_id, handler, status, attempt, duration_ms — jamais de secrets
    results,
  };

  console.log(`[event-worker] batch done processed=${summary.processed} completed=${summary.completed} failed=${summary.failed} dead=${summary.dead} duration_ms=${duration_ms}`);
  return json(summary);
});
