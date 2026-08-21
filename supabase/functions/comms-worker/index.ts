// ═══════════════════════════════════════════════════════════════
// comms-worker — INFRA-COMMS-1B (CORRIGÉ)
// Traitement des veraluz_communication_jobs.
// Canaux : internal (veraluz_internal_messages)
//          | guest_portal (veraluz_guest_messages)
//          | email → dispatch via communications-secure (Resend)
// Verrou atomique : claim_communication_jobs (FOR UPDATE SKIP LOCKED).
// Template SSOT : veraluz_comm_templates (pas veraluz_communication_templates)
// ═══════════════════════════════════════════════════════════════
// INTERDIT : tenant_id / stocker API key / email dans les logs
// INTERDIT : merge main sans autorisation explicite
// INTERDIT : email_not_configured — l'email passe par communications-secure
// ═══════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderSubject, renderBody, TemplateContext } from '../_shared/templates.ts';

const BATCH_SIZE    = 20;
const TENANT        = 'veraluz-001';
const SYSTEM_NAME   = 'Système Veraluz';
const SYSTEM_SENDER = 'system';   // TEXT — staff_id dans veraluz_guest_messages

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
// CORRIGÉ : settings key 'property' (pas 'branding'), 'contact' (pas 'localisation')
//           unité via .eq('id', unit_id) (pas .eq('unit_id', unit_id))
// ─────────────────────────────────────────────────────────────────────────────

async function resolveContext(
  admin:   ReturnType<typeof createClient>,
  eventId: string,
): Promise<TemplateContext> {
  const { data: ev } = await admin
    .from('veraluz_events')
    .select('payload')
    .eq('id', eventId)
    .single();

  const payload = (ev?.payload as Record<string, unknown>) ?? {};

  // Settings canoniques : clés 'property' et 'contact'
  const { data: property } = await admin
    .from('veraluz_settings')
    .select('value')
    .eq('key', 'property')
    .single();

  const { data: contact } = await admin
    .from('veraluz_settings')
    .select('value')
    .eq('key', 'contact')
    .single();

  const pv = (property?.value as Record<string, unknown>) ?? {};
  const cv = (contact?.value  as Record<string, unknown>) ?? {};

  // Résoudre unit_name via .eq('id', unit_id) — PK réel de veraluz_units
  let unit_name = '';
  const unit_id = payload['unit_id'] as string | undefined;
  if (unit_id) {
    const { data: unit } = await admin
      .from('veraluz_units')
      .select('name')
      .eq('id', unit_id)
      .single();
    unit_name = (unit?.name as string) ?? unit_id;
  }

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
    property_name:   (pv['name']               as string) || 'Résidences Veraluz',
    reception_phone: (cv['phone']              as string) || '',
    reservation_id:  (payload['reservation_id'] as string) || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canal : internal — insère dans veraluz_internal_messages
// ─────────────────────────────────────────────────────────────────────────────

async function processInternal(
  admin: ReturnType<typeof createClient>,
  job:   Record<string, unknown>,
  tmpl:  { subject_template: string; body_template: string },
  ctx:   TemplateContext,
): Promise<void> {
  const subject = renderSubject(tmpl.subject_template, ctx);
  const message = renderBody(tmpl.body_template, ctx);

  const ref    = (job['recipient_ref'] as string) || '';
  const isDept = ref.startsWith('department:');
  const dept   = isDept ? ref.replace('department:', '') : null;
  const empId  = !isDept ? ref : null;

  const source_event_job = `comms:${job['id']}`;

  const { error } = await admin
    .from('veraluz_internal_messages')
    .upsert(
      {
        sender_id:       '00000000-0000-0000-0000-000000000001',
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
// Canal : guest_portal — insère dans veraluz_guest_messages (table réelle)
// CORRIGÉ : reservation_id TEXT, guest_session_id UUID, staff_id TEXT
//           source_event_job UNIQUE pour idempotence
// ─────────────────────────────────────────────────────────────────────────────

async function processGuestPortal(
  admin: ReturnType<typeof createClient>,
  job:   Record<string, unknown>,
  tmpl:  { subject_template: string; body_template: string },
  ctx:   TemplateContext,
): Promise<void> {
  const subject = renderSubject(tmpl.subject_template, ctx);
  const message = renderBody(tmpl.body_template, ctx);

  const guestSessionId = (job['recipient_ref'] as string) || '';
  const source_event_job = `comms:${job['id']}`;

  const { error } = await admin
    .from('veraluz_guest_messages')
    .upsert(
      {
        reservation_id:   ctx['reservation_id'] || null,
        guest_session_id: guestSessionId,
        sender_type:      'staff',
        staff_id:         SYSTEM_SENDER,   // TEXT ('system') — schéma canonique
        staff_name:       SYSTEM_NAME,
        message:          `${subject}\n\n${message}`,  // colonne TEXT, pas content
        channel:          'reception',
        // read_at null = non lu côté staff (schéma canonique, pas is_read)
        source_event_job,
        created_at:       new Date().toISOString(),
      },
      { onConflict: 'source_event_job', ignoreDuplicates: true },
    );

  if (error) throw new Error(`veraluz_guest_messages upsert: ${error.message}`);
  console.log(`[comms-worker] guest_portal ok job=${job['id']} session=${guestSessionId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Canal : email — dispatch via communications-secure (Resend)
// OPTION B : appel interne service_role → dispatch_worker_email
// INTERDIT : stocker RESEND_API_KEY ici / loguer l'email du destinataire
// ─────────────────────────────────────────────────────────────────────────────

async function processEmail(
  admin:      ReturnType<typeof createClient>,
  job:        Record<string, unknown>,
  serviceKey: string,
  sbUrl:      string,
): Promise<void> {
  const eventId    = job['event_id']     as string;
  const templateKey = job['template_key'] as string;

  const resp = await fetch(`${sbUrl}/functions/v1/communications-secure`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      action:       'dispatch_worker_email',
      event_id:     eventId,
      template_key: templateKey,
    }),
  });

  const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok && !data.ok) {
    throw new Error(`dispatch_worker_email failed: ${data.error ?? resp.status}`);
  }

  // Statuts acceptables : sent, pending_channel (Resend non configuré — non bloquant)
  console.log(`[comms-worker] email dispatched job=${job['id']} status=${data.status} log=${data.log_id}`);
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

  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(sbUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const started_at = Date.now();
  const results: Array<{
    job_id:       string;
    template_key: string;
    channel:      string;
    status:       string;
    attempt:      number;
    error?:       string;
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
    const attempt    = job.attempt as number;
    const templateKey = job.template_key as string;

    // Canal email → dispatch via communications-secure (pas de template local)
    if (job.channel === 'email') {
      try {
        await processEmail(admin, job as Record<string, unknown>, serviceKey, sbUrl);

        await admin.from('veraluz_communication_jobs').update({
          status:       'completed',
          processed_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        }).eq('id', job.id);

        results.push({ job_id: job.id, template_key: templateKey, channel: 'email', status: 'completed', attempt });
      } catch (err: unknown) {
        const lastError = err instanceof Error ? err.message : String(err);
        const isDead    = attempt >= (job.max_attempts as number);

        await admin.from('veraluz_communication_jobs').update({
          status:       isDead ? 'dead' : 'pending',
          last_error:   lastError,
          processed_at: isDead ? new Date().toISOString() : null,
          updated_at:   new Date().toISOString(),
        }).eq('id', job.id);

        results.push({ job_id: job.id, template_key: templateKey, channel: 'email', status: isDead ? 'dead' : 'failed', attempt, error: lastError });
        console.error(`[comms-worker] email job=${job.id} attempt=${attempt} status=${isDead ? 'dead' : 'failed'} error=${lastError}`);
      }
      continue;
    }

    // Charger le template depuis la SSOT veraluz_comm_templates
    const { data: tmpl, error: tmplErr } = await admin
      .from('veraluz_comm_templates')
      .select('subject_template, body_template, active')
      .eq('template_key', templateKey)
      .eq('channel', job.channel)
      .eq('tenant_id', TENANT)
      .eq('locale', 'fr')
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
      results.push({ job_id: job.id, template_key: templateKey, channel: job.channel, status: isDead ? 'dead' : 'failed', attempt, error: errMsg });
      continue;
    }

    // Résoudre le contexte de rendu
    let ctx: TemplateContext = {};
    try {
      ctx = await resolveContext(admin, job.event_id as string);
    } catch (e) {
      console.warn(`[comms-worker] resolveContext partial error job=${job.id}:`, e);
    }

    try {
      if (job.channel === 'internal') {
        await processInternal(admin, job as Record<string, unknown>, tmpl as { subject_template: string; body_template: string }, ctx);
      } else if (job.channel === 'guest_portal') {
        await processGuestPortal(admin, job as Record<string, unknown>, tmpl as { subject_template: string; body_template: string }, ctx);
      } else {
        throw new Error(`unsupported_channel: ${job.channel}`);
      }

      await admin.from('veraluz_communication_jobs').update({
        status:       'completed',
        processed_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }).eq('id', job.id);

      results.push({ job_id: job.id, template_key: templateKey, channel: job.channel, status: 'completed', attempt });
      console.log(`[comms-worker] job=${job.id} template=${templateKey} channel=${job.channel} attempt=${attempt} status=completed`);

    } catch (err: unknown) {
      const lastError = err instanceof Error ? err.message : String(err);
      const isDead    = attempt >= (job.max_attempts as number);

      await admin.from('veraluz_communication_jobs').update({
        status:       isDead ? 'dead' : 'pending',
        last_error:   lastError,
        processed_at: isDead ? new Date().toISOString() : null,
        updated_at:   new Date().toISOString(),
      }).eq('id', job.id);

      results.push({ job_id: job.id, template_key: templateKey, channel: job.channel, status: isDead ? 'dead' : 'failed', attempt, error: lastError });
      console.error(`[comms-worker] job=${job.id} attempt=${attempt} status=${isDead ? 'dead' : 'failed'} error=${lastError}`);
    }
  }

  const duration_ms = Date.now() - started_at;
  const summary = {
    ok:        true,
    processed: results.length,
    completed: results.filter(r => r.status === 'completed').length,
    failed:    results.filter(r => r.status === 'failed').length,
    dead:      results.filter(r => r.status === 'dead').length,
    duration_ms,
    results,
  };

  console.log(`[comms-worker] batch done processed=${summary.processed} completed=${summary.completed} failed=${summary.failed} dead=${summary.dead} duration_ms=${duration_ms}`);
  return json(summary);
});
