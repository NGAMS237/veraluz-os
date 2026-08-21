// ═══════════════════════════════════════════════════════════════
// comms-worker — INFRA-COMMS-1A
// Traitement des veraluz_communication_jobs.
// Canaux : internal (veraluz_internal_messages) | guest_portal (portail client)
//          | email → pending/not_configured (EmailJS legacy, pas de secrets)
// Verrou atomique : claim_communication_jobs (FOR UPDATE SKIP LOCKED).
// ═══════════════════════════════════════════════════════════════
// INTERDIT : tenant_id / stocker API key / secret / password / credentials
// INTERDIT : merge main sans autorisation explicite
// ═══════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderSubject, renderBody, TemplateContext } from '../_shared/templates.ts';

const BATCH_SIZE    = 20;
const SYSTEM_NAME   = 'Système Veraluz';
const SYSTEM_SENDER = '00000000-0000-0000-0000-000000000001';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-veraluz-session',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

// ─────────────────────────────────────────────────────────────────────────────
// Résolution du contexte de rendu depuis veraluz_events.payload + settings DB
// ─────────────────────────────────────────────────────────────────────────────

async function resolveContext(
  admin:   ReturnType<typeof createClient>,
  eventId: string,
): Promise<TemplateContext> {
  // Charger le payload de l'événement
  const { data: ev } = await admin
    .from('veraluz_events')
    .select('payload')
    .eq('id', eventId)
    .single();

  const payload = (ev?.payload as Record<string, unknown>) ?? {};

  // Charger property_name et reception_phone depuis les settings DB
  const { data: branding } = await admin
    .from('veraluz_settings')
    .select('value')
    .eq('key', 'branding')
    .single();

  const { data: localisation } = await admin
    .from('veraluz_settings')
    .select('value')
    .eq('key', 'localisation')
    .single();

  const bv  = (branding?.value    as Record<string, unknown>) ?? {};
  const lv  = (localisation?.value as Record<string, unknown>) ?? {};

  // Résoudre unit_name depuis veraluz_units si unit_id présent
  let unit_name = '';
  const unit_id = payload['unit_id'] as string | undefined;
  if (unit_id) {
    const { data: unit } = await admin
      .from('veraluz_units')
      .select('name')
      .eq('unit_id', unit_id)
      .single();
    unit_name = (unit?.name as string) ?? unit_id;
  }

  // Formater les dates ISO → lisibles (YYYY-MM-DD → JJ/MM/AAAA)
  const fmtDate = (d: unknown): string => {
    if (!d || typeof d !== 'string') return '';
    const parts = d.slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d.slice(0, 10);
  };

  return {
    guest_name:      (payload['guest_name']     as string) || '',
    check_in:        fmtDate(payload['check_in']),
    check_out:       fmtDate(payload['check_out']),
    unit_name,
    property_name:   (bv['hotel_name']          as string) || (bv['property_name'] as string) || 'Résidence Veraluz',
    reception_phone: (lv['phone']               as string) || '',
    reservation_id:  (payload['reservation_id'] as string) || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canal : internal — insère dans veraluz_internal_messages
// ─────────────────────────────────────────────────────────────────────────────

async function processInternal(
  admin:        ReturnType<typeof createClient>,
  job:          Record<string, unknown>,
  tmpl:         { subject: string; body: string },
  ctx:          TemplateContext,
): Promise<void> {
  const subject = renderSubject(tmpl.subject, ctx);
  const message = renderBody(tmpl.body, ctx);

  // recipient_ref format : 'department:<dept>' ou employee_id
  const ref       = (job['recipient_ref'] as string) || '';
  const isDept    = ref.startsWith('department:');
  const dept      = isDept ? ref.replace('department:', '') : null;
  const empId     = !isDept ? ref : null;

  // Clé d'idempotence
  const source_event_job = `comms:${job['id']}`;

  const { error } = await admin
    .from('veraluz_internal_messages')
    .upsert(
      {
        sender_id:       SYSTEM_SENDER,
        sender_name:     SYSTEM_NAME,
        recipient_id:    empId,
        recipient_type:  isDept ? 'department' : 'employee',
        department:      dept,
        subject,
        message,
        is_draft:        false,
        priority:        'normal',
        context_type:    'communication',
        context_id:      ctx['reservation_id'] || null,
        source_event_job,
      },
      { onConflict: 'source_event_job', ignoreDuplicates: true },
    );

  if (error) throw new Error(`internal_messages upsert: ${error.message}`);
  console.log(`[comms-worker] internal ok job=${job['id']} dept=${dept ?? empId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canal : guest_portal — insère dans veraluz_messages (ou veraluz_guest_messages)
// ─────────────────────────────────────────────────────────────────────────────

async function processGuestPortal(
  admin:        ReturnType<typeof createClient>,
  job:          Record<string, unknown>,
  tmpl:         { subject: string; body: string },
  ctx:          TemplateContext,
): Promise<void> {
  const subject = renderSubject(tmpl.subject, ctx);
  const message = renderBody(tmpl.body, ctx);

  // recipient_ref = guest_session_id
  const guestSessionId = (job['recipient_ref'] as string) || '';

  // Insérer comme message système dans le canal réception du portail
  // (même table que send_message de guest-access : veraluz_messages)
  const { error } = await admin
    .from('veraluz_messages')
    .insert({
      guest_session_id: guestSessionId,
      sender_type:      'staff',
      staff_id:         SYSTEM_SENDER,
      content:          `**${subject}**\n\n${message}`,
      channel:          'reception',
      is_read:          false,
      created_at:       new Date().toISOString(),
    });

  if (error) throw new Error(`veraluz_messages insert: ${error.message}`);
  console.log(`[comms-worker] guest_portal ok job=${job['id']} session=${guestSessionId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canal : email — non configuré (EmailJS legacy)
// Marque le job comme email_not_configured sans erreur fatale
// ─────────────────────────────────────────────────────────────────────────────

async function processEmail(
  admin: ReturnType<typeof createClient>,
  job:   Record<string, unknown>,
): Promise<'email_not_configured'> {
  console.log(`[comms-worker] email channel not_configured job=${job['id']} — marking email_not_configured`);
  await admin
    .from('veraluz_communication_jobs')
    .update({
      status:       'email_not_configured',
      last_error:   'EmailJS non configuré — intégration email à connecter',
      processed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq('id', job['id'] as string);
  return 'email_not_configured';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Sécurité : service_role uniquement
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey || !authHeader.endsWith(serviceKey)) {
    return json({ ok: false, error: 'service_role_required' }, 403);
  }

  const url   = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started_at = Date.now();
  const results: Array<{
    job_id:        string;
    template_code: string;
    channel:       string;
    status:        string;
    attempt:       number;
    error?:        string;
  }> = [];

  // ── Verrou atomique ────────────────────────────────────────
  const { data: jobs, error: claimErr } = await admin
    .rpc('claim_communication_jobs', { p_batch: BATCH_SIZE });

  if (claimErr) {
    console.error('[comms-worker] claim_communication_jobs error:', claimErr.message);
    return json({ ok: false, error: claimErr.message }, 500);
  }

  if (!jobs || jobs.length === 0) {
    return json({ ok: true, processed: 0, duration_ms: Date.now() - started_at });
  }

  // ── Traitement ─────────────────────────────────────────────
  for (const job of jobs) {
    const attempt = job.attempt as number;

    // Canal email → traitement spécial sans charger le template
    if (job.channel === 'email') {
      const s = await processEmail(admin, job as Record<string, unknown>);
      results.push({
        job_id:        job.id,
        template_code: job.template_code,
        channel:       'email',
        status:        s,
        attempt,
      });
      continue;
    }

    // Charger le template
    const { data: tmpl, error: tmplErr } = await admin
      .from('veraluz_communication_templates')
      .select('subject, body, active')
      .eq('code', job.template_code)
      .eq('channel', job.channel)
      .single();

    if (tmplErr || !tmpl || !tmpl.active) {
      const errMsg = tmplErr?.message ?? 'template_not_found_or_inactive';
      const isDead = attempt >= (job.max_attempts as number);
      await admin.from('veraluz_communication_jobs').update({
        status:       isDead ? 'dead' : 'pending',
        last_error:   errMsg,
        processed_at: isDead ? new Date().toISOString() : null,
        updated_at:   new Date().toISOString(),
      }).eq('id', job.id);
      results.push({ job_id: job.id, template_code: job.template_code, channel: job.channel, status: isDead ? 'dead' : 'failed', attempt, error: errMsg });
      continue;
    }

    // Résoudre le contexte de rendu
    let ctx: TemplateContext = {};
    try {
      ctx = await resolveContext(admin, job.event_id as string);
    } catch (e) {
      // Contexte partiel acceptable
      console.warn(`[comms-worker] resolveContext partial error job=${job.id}:`, e);
    }

    try {
      if (job.channel === 'internal') {
        await processInternal(admin, job as Record<string, unknown>, tmpl, ctx);
      } else if (job.channel === 'guest_portal') {
        await processGuestPortal(admin, job as Record<string, unknown>, tmpl, ctx);
      } else {
        throw new Error(`unsupported_channel: ${job.channel}`);
      }

      await admin.from('veraluz_communication_jobs').update({
        status:       'completed',
        processed_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }).eq('id', job.id);

      results.push({ job_id: job.id, template_code: job.template_code, channel: job.channel, status: 'completed', attempt });
      console.log(`[comms-worker] job=${job.id} template=${job.template_code} channel=${job.channel} attempt=${attempt} status=completed`);

    } catch (err: unknown) {
      const lastError  = err instanceof Error ? err.message : String(err);
      const isDead     = attempt >= (job.max_attempts as number);

      await admin.from('veraluz_communication_jobs').update({
        status:       isDead ? 'dead' : 'pending',
        last_error:   lastError,
        processed_at: isDead ? new Date().toISOString() : null,
        updated_at:   new Date().toISOString(),
      }).eq('id', job.id);

      results.push({ job_id: job.id, template_code: job.template_code, channel: job.channel, status: isDead ? 'dead' : 'failed', attempt, error: lastError });
      console.error(`[comms-worker] job=${job.id} attempt=${attempt} status=${isDead?'dead':'failed'} error=${lastError}`);
    }
  }

  const duration_ms = Date.now() - started_at;
  const summary = {
    ok:          true,
    processed:   results.length,
    completed:   results.filter(r => r.status === 'completed').length,
    failed:      results.filter(r => r.status === 'failed').length,
    dead:        results.filter(r => r.status === 'dead').length,
    not_configured: results.filter(r => r.status === 'email_not_configured').length,
    duration_ms,
    results,
  };

  console.log(`[comms-worker] batch done processed=${summary.processed} completed=${summary.completed} failed=${summary.failed} dead=${summary.dead} duration_ms=${duration_ms}`);
  return json(summary);
});
