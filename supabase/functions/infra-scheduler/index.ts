// ═══════════════════════════════════════════════════════════════════════════
// infra-scheduler — INFRA-SCHED-1
// Orchestrateur serveur : stale recovery → event-worker → comms-worker.
// Deux modes d'accès :
//   A. Automatique (cron/pg_cron) : Authorization: Bearer <service_role_key>
//   B. Manuel gérant              : X-Veraluz-Session + settings.manage
// Résumé retourné : non sensible (counts, durée, statut).
// ═══════════════════════════════════════════════════════════════════════════
// INTERDIT : stocker API key / secret / token / password / credentials
// INTERDIT : retourner emails, tokens, payloads privés
// INTERDIT : appeler event-worker ou comms-worker depuis le frontend
// ═══════════════════════════════════════════════════════════════════════════

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

// ── SHA-256 (même helper que infra-health) ───────────────────────────────
async function sha256hex(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(msg),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Worker call helper ───────────────────────────────────────────────────
interface WorkerResult {
  processed: number;
  completed: number;
  failed:    number;
  dead:      number;
  duration_ms?: number;
  error?: string;
}

async function callWorker(
  sbUrl:      string,
  serviceKey: string,
  workerName: string,
  workerId?:  string,
): Promise<WorkerResult> {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${sbUrl}/functions/v1/${workerName}`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      // Transmettre worker_id = run_id pour traçabilité scheduler→worker→job
      body: JSON.stringify(workerId ? { worker_id: workerId } : {}),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        processed: 0, completed: 0, failed: 0, dead: 0,
        duration_ms: Date.now() - t0,
        error: `http_${resp.status}: ${txt.slice(0, 200)}`,
      };
    }

    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
    return {
      processed:   (data.processed   as number) ?? 0,
      completed:   (data.completed   as number) ?? 0,
      failed:      (data.failed      as number) ?? 0,
      dead:        (data.dead        as number) ?? 0,
      duration_ms: Date.now() - t0,
    };
  } catch (err: unknown) {
    return {
      processed: 0, completed: 0, failed: 0, dead: 0,
      duration_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const sbUrl      = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const admin = createClient(sbUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started_at      = Date.now();
  const run_id          = crypto.randomUUID();
  let   trigger_source  = 'cron';

  // ── Authentification ────────────────────────────────────────────────────
  //
  // MODE A — service_role (cron automatique, internal calls)
  //   Authorization: Bearer <service_role_key>
  //
  // MODE B — gérant humain (bouton "Exécuter maintenant")
  //   X-Veraluz-Session: <raw_token>  +  settings.manage
  //
  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = serviceKey && authHeader === `Bearer ${serviceKey}`;

  if (!isServiceRole) {
    // Tenter mode B : session gérant
    const rawToken = req.headers.get('X-Veraluz-Session') ?? '';
    if (!rawToken) {
      return json({ ok: false, error: 'auth_required' }, 401);
    }

    const tokenHash = await sha256hex(rawToken);
    const { data: session } = await admin
      .from('veraluz_employee_sessions')
      .select('employee_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .single();

    if (!session)                                  return json({ ok: false, error: 'invalid_session'  }, 401);
    if (session.revoked_at)                         return json({ ok: false, error: 'session_revoked'  }, 401);
    if (new Date(session.expires_at) < new Date()) return json({ ok: false, error: 'session_expired'  }, 401);

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

    trigger_source = 'manual';
  }

  // ── Enregistrer début run ──────────────────────────────────────────────
  const { data: runRow } = await admin
    .from('veraluz_infra_runs')
    .insert({
      id:             run_id,
      started_at:     new Date(started_at).toISOString(),
      status:         'started',
      trigger_source,
    })
    .select('id')
    .single();

  const runDbId: string = runRow?.id ?? run_id;

  // ── 1. Stale recovery ──────────────────────────────────────────────────
  let recovered_jobs = 0;
  try {
    const { data: recoveryResult } = await admin
      .rpc('recover_stale_jobs', { p_threshold_minutes: 5 });
    const rec = recoveryResult as { recovered_event_jobs?: number; recovered_comm_jobs?: number } | null;
    recovered_jobs =
      (rec?.recovered_event_jobs ?? 0) +
      (rec?.recovered_comm_jobs  ?? 0);
  } catch (e) {
    console.warn(`[infra-scheduler] run=${run_id} stale_recovery error:`, e);
  }

  // ── 2. event-worker ────────────────────────────────────────────────────
  // run_id transmis comme worker_id → gravé dans claimed_at/worker_id du job (traçabilité)
  const ewResult = await callWorker(sbUrl, serviceKey, 'event-worker', run_id);
  console.log(
    `[infra-scheduler] run=${run_id} event-worker processed=${ewResult.processed}` +
    ` completed=${ewResult.completed} failed=${ewResult.failed} dead=${ewResult.dead}` +
    (ewResult.error ? ` error=${ewResult.error}` : ''),
  );

  // ── 3. document-worker ─────────────────────────────────────────────────────
  // Après event-worker : les document_jobs ont été créés par les triggers DB.
  // document-worker génère les PDFs déterministes et les stocke dans veraluz-documents-private.
  const dwResult = await callWorker(sbUrl, serviceKey, 'document-worker', run_id);
  console.log(
    `[infra-scheduler] run=${run_id} document-worker processed=${dwResult.processed}` +
    ` completed=${dwResult.completed} failed=${dwResult.failed} dead=${dwResult.dead}` +
    (dwResult.error ? ` error=${dwResult.error}` : ''),
  );

  // ── 4. comms-worker ────────────────────────────────────────────────────
  const cwResult = await callWorker(sbUrl, serviceKey, 'comms-worker', run_id);
  console.log(
    `[infra-scheduler] run=${run_id} comms-worker processed=${cwResult.processed}` +
    ` completed=${cwResult.completed} failed=${cwResult.failed} dead=${cwResult.dead}` +
    (cwResult.error ? ` error=${cwResult.error}` : ''),
  );

  // ── 5. Finaliser run ───────────────────────────────────────────────────
  const duration_ms = Date.now() - started_at;
  const hasError    = !!(ewResult.error || dwResult.error || cwResult.error);
  const runStatus   = hasError ? 'partial' : 'completed';

  await admin
    .from('veraluz_infra_runs')
    .update({
      finished_at:     new Date().toISOString(),
      status:          runStatus,
      event_processed: ewResult.processed,
      event_completed: ewResult.completed,
      event_failed:    ewResult.failed,
      event_dead:      ewResult.dead,
      doc_processed:   dwResult.processed,
      doc_completed:   dwResult.completed,
      doc_failed:      dwResult.failed,
      doc_dead:        dwResult.dead,
      comm_processed:  cwResult.processed,
      comm_completed:  cwResult.completed,
      comm_failed:     cwResult.failed,
      comm_dead:       cwResult.dead,
      recovered_jobs,
      duration_ms,
      error_message:   hasError
        ? [ewResult.error, dwResult.error, cwResult.error].filter(Boolean).join(' | ')
        : null,
    })
    .eq('id', runDbId);

  // ── 6. Réponse non sensible ────────────────────────────────────────────
  return json({
    ok:              true,
    run_id,
    trigger:         trigger_source,
    timestamp:       new Date().toISOString(),
    duration_ms,
    recovered_jobs,
    event_worker: {
      processed: ewResult.processed,
      completed: ewResult.completed,
      failed:    ewResult.failed,
      dead:      ewResult.dead,
    },
    document_worker: {
      processed: dwResult.processed,
      completed: dwResult.completed,
      failed:    dwResult.failed,
      dead:      dwResult.dead,
    },
    comms_worker: {
      processed: cwResult.processed,
      completed: cwResult.completed,
      failed:    cwResult.failed,
      dead:      cwResult.dead,
    },
    status: runStatus,
  });
});
