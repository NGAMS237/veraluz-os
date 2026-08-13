/**
 * MICRO 011E-2D1.1 — communications-secure Edge Function v6
 * Hardening transport email production:
 *   - resend_api_key: Deno.env.get('RESEND_API_KEY') — plus jamais depuis veraluz_settings
 *   - Statuts canoniques: pending_channel / failed / sent / delivered (webhook only)
 *   - Zéro fallback navigateur (EmailJS supprimé côté EF)
 *   - provider + provider_message_id capturés dans comm_log
 *   - Idempotence retry: blocked only on sent/delivered (pending_channel + failed = retryable)
 *   - 403 Resend = sender_domain_not_verified
 *   - Aucune donnée de rendu renvoyée dans la réponse (body_html supprimé)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080'
];
const ADMIN_ROLES = new Set([
  'superadmin','admin','manager','direction','directeur','gerant','directrice'
]);
const TENANT = 'veraluz-001';
const SENSITIVE_VARS = ['wifi.password','wifi.mdp','wifi.pass'];
const ALLOWED_INTERNAL_EVENTS = new Set([
  'checkout_housekeeping',
  'restaurant_ready_driver',
  'delivery_assigned_driver',
  'stock_low_manager'
]);
const ALLOWED_CLIENT_EVENTS = new Set([
  'reservation_confirmed',
  'checkin',
  'payment_confirmed'
]);
const TEMPLATE_KEY_MAP: Record<string,string> = {
  'reservation_confirmed': 'reservation_confirmed',
  'checkin':               'checkin_welcome',
  'payment_confirmed':     'payment_confirmed',
};
const CLIENT_EXPECTED_STATUS: Record<string,string> = {
  'reservation_confirmed': 'confirmed',
  'checkin':               'checkedin',
};

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra }
  });
}
async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
interface ActorInfo {
  employee_id: string;
  actor_name:  string;
  role:        string;
  department:  string;
  is_admin:    boolean;
}
async function validateSession(
  admin: ReturnType<typeof createClient>,
  token: string
): Promise<ActorInfo | null> {
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const { data: sess } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .single();
  if (!sess) return null;
  const { data: emp } = await admin
    .from('veraluz_employees')
    .select('id, full_name, role, status, department')
    .eq('id', sess.employee_id)
    .single();
  if (!emp || (emp.status !== 'actif' && emp.status !== 'active')) return null;
  const role = ((emp.role as string) || 'staff').toLowerCase();
  return {
    employee_id: sess.employee_id as string,
    actor_name:  (emp.full_name as string) || 'Employe',
    role,
    department:  (emp.department as string) || role,
    is_admin:    ADMIN_ROLES.has(role)
  };
}
interface RenderResult {
  ok:                    boolean;
  subject?:              string;
  body?:                 string;
  body_redacted?:        string;
  missing_variables?:    string[];
  unknown_placeholders?: string[];
  error?:                string;
}
function renderTemplate(
  subjectTpl: string,
  bodyTpl: string,
  variables: Record<string, string>,
  variablesSchema: string[]
): RenderResult {
  const placeholderRe = /\{\{([^}]+)\}\}/g;
  const allPlaceholders = new Set<string>();
  for (const m of subjectTpl.matchAll(placeholderRe)) allPlaceholders.add(m[1].trim());
  for (const m of bodyTpl.matchAll(placeholderRe))    allPlaceholders.add(m[1].trim());
  const required = new Set(variablesSchema);
  const missing: string[] = [];
  for (const v of required) {
    if (variables[v] == null || variables[v] === '') missing.push(v);
  }
  if (missing.length > 0) return { ok: false, missing_variables: missing, error: 'missing_required_variables' };
  const unknown: string[] = [];
  for (const ph of allPlaceholders) { if (variables[ph] == null) unknown.push(ph); }
  const substitute = (tpl: string): string =>
    tpl.replace(placeholderRe, (_, key) => { const k = key.trim(); return variables[k] != null ? variables[k] : `{{${k}}}`; });
  const renderedSubject = substitute(subjectTpl);
  const renderedBody    = substitute(bodyTpl);
  let bodyRedacted = renderedBody;
  for (const sk of SENSITIVE_VARS) { const val = variables[sk]; if (val) bodyRedacted = bodyRedacted.split(val).join('[REDACTED]'); }
  for (const sk of SENSITIVE_VARS) { bodyRedacted = bodyRedacted.split(`{{${sk}}}`).join('[REDACTED]'); }
  return { ok: true, subject: renderedSubject, body: renderedBody, body_redacted: bodyRedacted, unknown_placeholders: unknown.length > 0 ? unknown : undefined };
}
function maskAddress(addr: string): string {
  if (!addr) return '';
  if (addr.includes('@')) { const [local, domain] = addr.split('@'); return local.slice(0,2) + '***@' + domain; }
  const digits = addr.replace(/\D/g,'');
  if (digits.length >= 6) return addr.slice(0,4) + '***' + addr.slice(-2);
  return addr.slice(0,2) + '***';
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const cors   = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const SB_URL     = Deno.env.get('SUPABASE_URL')!;
  const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin      = createClient(SB_URL, SB_SERVICE);

  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = req.headers.get('x-veraluz-session') || body.session_token || null;
    if (!sessionToken) return json({ ok: false, error: 'session_token_required' }, 401, cors);
    const actor = await validateSession(admin, sessionToken);
    if (!actor)        return json({ ok: false, error: 'invalid_or_expired_session' }, 401, cors);

    const action: string = body.action || '';

    // ─────────────────────────────────────────────────
    // ACTION: dispatch_client_email
    // ─────────────────────────────────────────────────
    if (action === 'dispatch_client_email') {
      const { event_type, reservation_id, payment_id } = body;

      if (!event_type || !ALLOWED_CLIENT_EVENTS.has(event_type))
        return json({ ok: false, error: 'unknown_event_type', allowed: [...ALLOWED_CLIENT_EVENTS] }, 400, cors);

      const template_key = TEMPLATE_KEY_MAP[event_type];

      // Fetch template
      const { data: tplRaw } = await admin.from('veraluz_comm_templates')
        .select('id, subject_template, body_template, variables_schema, event_type')
        .eq('tenant_id', TENANT).eq('template_key', template_key)
        .eq('channel', 'email').eq('locale', 'fr').eq('active', true)
        .maybeSingle();
      if (!tplRaw) return json({ ok: false, error: 'template_not_found', template_key }, 404, cors);
      const t = tplRaw as Record<string,unknown>;
      const schema: string[] = Array.isArray(t.variables_schema) ? t.variables_schema as string[] : [];

      // Fetch settings batch (no resend key — comes from Deno.env)
      const { data: allSettings } = await admin.from('veraluz_settings')
        .select('key, value')
        .in('key', ['property','contact','wifi','restaurant','email']);
      const S: Record<string, Record<string,string>> = {};
      for (const s of (allSettings || [])) S[(s as Record<string,string>).key] = (s as Record<string,unknown>).value as Record<string,string>;
      const propName   = S.property?.name   || 'Résidences Veraluz';
      const recepPhone = S.contact?.phone   || '';
      const wifiSsid   = S.wifi?.ssid       || 'Voir réception';
      const wifiPass   = S.wifi?.password   || 'Voir réception';
      const restOpen   = S.restaurant?.opening_time || 'Sur demande';
      const restClose  = S.restaurant?.closing_time || 'Sur demande';
      const emailFrom  = (S.email as Record<string,string>)?.from || 'Résidences Veraluz <onboarding@resend.dev>';

      // ── RESEND KEY: Edge secret only — never from DB ──
      const resendKey: string = Deno.env.get('RESEND_API_KEY') || '';

      // Resolve guest + build variables
      let guestEmail = '';
      let guestName  = '';
      let variables: Record<string,string> = {};
      let contextId = '';
      let resId: string | null = null;

      if (event_type === 'reservation_confirmed' || event_type === 'checkin') {
        if (!reservation_id) return json({ ok: false, error: 'reservation_id_required' }, 400, cors);
        contextId = String(reservation_id);
        resId = contextId;
        const expectedStatus = CLIENT_EXPECTED_STATUS[event_type];
        const { data: rez } = await admin.from('veraluz_reservations')
          .select('id, unit_id, client_name, client_email, check_in, check_out, status')
          .eq('id', contextId).maybeSingle();
        if (!rez) return json({ ok: false, error: 'reservation_not_found' }, 422, cors);
        const r = rez as Record<string,unknown>;
        if (r.status !== expectedStatus)
          return json({ ok: false, error: 'business_state_invalid', detail: `expected_${expectedStatus}_got_${r.status}` }, 422, cors);
        if (!r.client_email) return json({ ok: false, error: 'no_guest_email', reservation_id: contextId }, 422, cors);
        guestEmail = r.client_email as string;
        guestName  = (r.client_name as string) || 'Client';
        const firstName = guestName.split(' ')[0];
        const { data: unit } = await admin.from('veraluz_units')
          .select('name').eq('id', String(r.unit_id)).maybeSingle();
        const unitName = unit ? (unit as Record<string,string>).name : String(r.unit_id || '');
        variables = {
          'guest.first_name':      firstName,
          'property.name':         propName,
          'reservation.id':        contextId,
          'reservation.check_in':  String(r.check_in  || ''),
          'reservation.check_out': String(r.check_out || ''),
          'unit.name':             unitName,
          'reception.phone':       recepPhone,
        };
        if (event_type === 'checkin') {
          variables['wifi.ssid']                = wifiSsid;
          variables['wifi.password']            = wifiPass;
          variables['restaurant.opening_time']  = restOpen;
          variables['restaurant.closing_time']  = restClose;
        }
      }

      else if (event_type === 'payment_confirmed') {
        if (!reservation_id && !payment_id)
          return json({ ok: false, error: 'reservation_id_or_payment_id_required' }, 400, cors);
        if (payment_id) {
          contextId = String(payment_id);
          const { data: pay } = await admin.from('veraluz_payments')
            .select('id, reservation_id, amount, method, status, guest_name')
            .eq('id', contextId).maybeSingle();
          if (!pay || (pay as Record<string,unknown>).status !== 'validated')
            return json({ ok: false, error: 'business_state_invalid', detail: 'payment_not_validated' }, 422, cors);
          resId = (pay as Record<string,unknown>).reservation_id as string;
        } else {
          contextId = String(reservation_id);
          resId = contextId;
        }
        const { data: rez } = await admin.from('veraluz_reservations')
          .select('id, client_name, client_email, check_in, check_out')
          .eq('id', resId).maybeSingle();
        if (!rez || !(rez as Record<string,unknown>).client_email)
          return json({ ok: false, error: 'reservation_not_found_or_no_email' }, 422, cors);
        const r = rez as Record<string,unknown>;
        guestEmail = r.client_email as string;
        guestName  = (r.client_name as string) || 'Client';
        const firstName = guestName.split(' ')[0];
        variables = {
          'guest.first_name':      firstName,
          'property.name':         propName,
          'reservation.id':        resId as string,
          'reservation.check_in':  String(r.check_in  || ''),
          'reservation.check_out': String(r.check_out || ''),
        };
      }

      // Render
      const renderResult = renderTemplate(
        t.subject_template as string,
        t.body_template    as string,
        variables,
        schema
      );
      if (!renderResult.ok)
        return json({ ok: false, error: 'render_failed', missing_variables: renderResult.missing_variables }, 400, cors);

      // Idempotence — retry allowed after failed/pending_channel, blocked only on sent/delivered
      const { data: existing } = await admin.from('veraluz_comm_log')
        .select('id, status')
        .eq('tenant_id', TENANT)
        .eq('event_type', event_type)
        .eq('context_id', contextId)
        .eq('template_key', template_key)
        .eq('recipient_id', guestEmail)
        .in('status', ['sent','delivered'])
        .maybeSingle();
      if (existing)
        return json({ ok: true, status: 'skipped_duplicate', log_id: (existing as Record<string,unknown>).id }, 200, cors);

      // ── Transport Resend ──
      const now = new Date().toISOString();
      let emailStatus: 'sent' | 'failed' | 'pending_channel' = 'pending_channel';
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      let providerMsgId: string | null = null;
      const providerName: string | null = resendKey ? 'resend' : null;

      if (!resendKey) {
        // Secret not configured in EF environment
        emailStatus = 'pending_channel';
        errorCode   = 'resend_not_configured';
        console.warn('[dispatch_client_email] RESEND_API_KEY not set — email queued as pending_channel');
      } else {
        try {
          const resendResp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from:    emailFrom,
              to:      [guestEmail],
              subject: renderResult.subject,
              html:    renderResult.body,
            })
          });
          if (resendResp.ok) {
            emailStatus = 'sent';
            const resendData = await resendResp.json().catch(() => ({}));
            providerMsgId = (resendData as Record<string,string>).id || null;
          } else {
            emailStatus  = 'failed';
            const errText = await resendResp.text().catch(() => '');
            errorMessage  = errText.slice(0, 400);
            if (resendResp.status === 403) {
              errorCode = 'sender_domain_not_verified';
            } else {
              errorCode = `resend_${resendResp.status}`;
            }
            console.error('[dispatch_client_email] Resend error:', resendResp.status, errText.slice(0, 200));
          }
        } catch(e) {
          emailStatus  = 'failed';
          errorCode    = 'resend_network_error';
          errorMessage = String(e).slice(0, 400);
        }
      }

      // Comm log — provider + provider_message_id captured
      const { data: logRow } = await admin.from('veraluz_comm_log').insert({
        tenant_id:                TENANT,
        event_type,
        template_id:              String(t.id),
        template_key,
        channel:                  'email',
        recipient_type:           'guest',
        recipient_id:             guestEmail,
        recipient_address_masked: maskAddress(guestEmail),
        reservation_id:           resId,
        context_type:             event_type,
        context_id:               contextId,
        status:                   emailStatus,
        subject_snapshot:         renderResult.subject || '',
        body_snapshot_redacted:   renderResult.body_redacted || '',
        created_by:               actor.employee_id,
        prepared_at:              now,
        sent_at:                  emailStatus === 'sent' ? now : null,
        error_code:               errorCode,
        error_message:            errorMessage,
        provider:                 providerName,
        provider_message_id:      providerMsgId,
      }).select('id').single();

      // Response — no body_html, no to_email (no auto-fallback data)
      return json({
        ok:      true,
        status:  emailStatus,
        log_id:  (logRow as Record<string,unknown>)?.id,
        ...(errorCode ? { error_code: errorCode } : {}),
      }, 200, cors);
    }

    // ─────────────────────────────────────────────────
    // ACTION: list_templates
    // ─────────────────────────────────────────────────
    if (action === 'list_templates') {
      const { audience, channel, active } = body;
      let q: any = admin.from('veraluz_comm_templates')
        .select('id,template_key,name,description,audience,event_type,channel,locale,active,variables_schema,updated_at')
        .eq('tenant_id', TENANT).order('audience').order('event_type');
      if (audience)       q = q.eq('audience', audience);
      if (channel)        q = q.eq('channel', channel);
      if (active != null) q = q.eq('active', !!active);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: 'db_error' }, 500, cors);
      return json({ ok: true, templates: data || [] }, 200, cors);
    }

    if (action === 'get_template') {
      const { template_key, channel, locale } = body;
      if (!template_key) return json({ ok: false, error: 'template_key_required' }, 400, cors);
      let q: any = admin.from('veraluz_comm_templates').select('*')
        .eq('tenant_id', TENANT).eq('template_key', template_key);
      if (channel) q = q.eq('channel', channel);
      if (locale)  q = q.eq('locale', locale || 'fr');
      const { data, error } = await q.maybeSingle();
      if (error) return json({ ok: false, error: 'db_error' }, 500, cors);
      if (!data)  return json({ ok: false, error: 'template_not_found' }, 404, cors);
      return json({ ok: true, template: data }, 200, cors);
    }

    if (action === 'create_template') {
      if (!actor.is_admin) return json({ ok: false, error: 'role_insuffisant' }, 403, cors);
      const { template_key, name, description, audience, event_type, channel, locale, subject_template, body_template, variables_schema } = body;
      if (!template_key || !name || !event_type || !body_template)
        return json({ ok: false, error: 'missing_required_fields' }, 400, cors);
      const newTpl = {
        tenant_id: TENANT, template_key, name, description: description || '',
        audience: audience || 'guest', event_type, channel: channel || 'email',
        locale: locale || 'fr', subject_template: subject_template || '',
        body_template, active: true,
        variables_schema: Array.isArray(variables_schema) ? variables_schema : [],
        created_by: actor.employee_id, updated_by: actor.employee_id
      };
      const { data, error } = await admin.from('veraluz_comm_templates').insert(newTpl).select('id').single();
      if (error) {
        if (error.code === '23505') return json({ ok: false, error: 'template_key_already_exists' }, 409, cors);
        return json({ ok: false, error: 'create_failed', detail: error.message }, 500, cors);
      }
      return json({ ok: true, template_id: (data as Record<string,string>).id }, 200, cors);
    }

    if (action === 'update_template') {
      if (!actor.is_admin) return json({ ok: false, error: 'role_insuffisant' }, 403, cors);
      const { template_id, name, description, subject_template, body_template, variables_schema, active } = body;
      if (!template_id) return json({ ok: false, error: 'template_id_required' }, 400, cors);
      const { data: existing } = await admin.from('veraluz_comm_templates').select('id')
        .eq('id', template_id).eq('tenant_id', TENANT).single();
      if (!existing) return json({ ok: false, error: 'template_not_found' }, 404, cors);
      const updates: Record<string,unknown> = { updated_by: actor.employee_id };
      if (name             !== undefined) updates.name             = name;
      if (description      !== undefined) updates.description      = description;
      if (subject_template !== undefined) updates.subject_template = subject_template;
      if (body_template    !== undefined) updates.body_template    = body_template;
      if (variables_schema !== undefined) updates.variables_schema = variables_schema;
      if (active           !== undefined) updates.active           = !!active;
      await admin.from('veraluz_comm_templates').update(updates).eq('id', template_id);
      return json({ ok: true }, 200, cors);
    }

    if (action === 'toggle_template') {
      if (!actor.is_admin) return json({ ok: false, error: 'role_insuffisant' }, 403, cors);
      const { template_id, active } = body;
      if (!template_id) return json({ ok: false, error: 'template_id_required' }, 400, cors);
      const { data: existing } = await admin.from('veraluz_comm_templates').select('id, active')
        .eq('id', template_id).eq('tenant_id', TENANT).single();
      if (!existing) return json({ ok: false, error: 'template_not_found' }, 404, cors);
      const newActive = active != null ? !!active : !(existing as Record<string,unknown>).active;
      await admin.from('veraluz_comm_templates').update({ active: newActive, updated_by: actor.employee_id }).eq('id', template_id);
      return json({ ok: true, active: newActive }, 200, cors);
    }

    if (action === 'preview') {
      const { template_key, channel, locale, variables } = body;
      if (!template_key) return json({ ok: false, error: 'template_key_required' }, 400, cors);
      let q: any = admin.from('veraluz_comm_templates')
        .select('subject_template, body_template, variables_schema, active')
        .eq('tenant_id', TENANT).eq('template_key', template_key).eq('active', true);
      if (channel) q = q.eq('channel', channel);
      q = q.eq('locale', locale || 'fr');
      const { data: tpl } = await q.maybeSingle();
      if (!tpl) return json({ ok: false, error: 'template_not_found_or_inactive' }, 404, cors);
      const vars: Record<string,string> = typeof variables === 'object' && variables ? variables : {};
      const schema: string[] = Array.isArray((tpl as Record<string,unknown>).variables_schema) ? (tpl as Record<string,string[]>).variables_schema : [];
      const result = renderTemplate((tpl as Record<string,string>).subject_template, (tpl as Record<string,string>).body_template, vars, schema);
      if (result.ok && result.body) {
        let previewBody = result.body;
        for (const sk of SENSITIVE_VARS) { const val = vars[sk]; if (val) previewBody = previewBody.split(val).join('........'); previewBody = previewBody.split(`{{${sk}}}`).join('........'); }
        result.body = previewBody;
      }
      return json({ ok: result.ok, preview: result }, 200, cors);
    }

    if (action === 'prep_comm') {
      const { template_key, channel, locale, variables, recipient_type, recipient_id, recipient_address, reservation_id, order_id, context_type, context_id, event_type } = body;
      if (!template_key) return json({ ok: false, error: 'template_key_required' }, 400, cors);
      let q: any = admin.from('veraluz_comm_templates')
        .select('id, subject_template, body_template, variables_schema, event_type')
        .eq('tenant_id', TENANT).eq('template_key', template_key).eq('active', true);
      if (channel) q = q.eq('channel', channel);
      q = q.eq('locale', locale || 'fr');
      const { data: tpl } = await q.maybeSingle();
      if (!tpl) return json({ ok: false, error: 'template_not_found_or_inactive' }, 404, cors);
      const t = tpl as Record<string,unknown>;
      const vars: Record<string,string> = typeof variables === 'object' && variables ? variables : {};
      const schema: string[] = Array.isArray(t.variables_schema) ? t.variables_schema as string[] : [];
      const renderResult = renderTemplate(t.subject_template as string, t.body_template as string, vars, schema);
      if (!renderResult.ok) return json({ ok: false, error: 'render_failed', missing_variables: renderResult.missing_variables }, 400, cors);
      const logEntry = {
        tenant_id: TENANT, event_type: event_type || (t.event_type as string),
        template_id: t.id as string, template_key, channel: channel || 'email',
        recipient_type: recipient_type || 'guest', recipient_id: recipient_id || null,
        recipient_address_masked: recipient_address ? maskAddress(recipient_address) : null,
        reservation_id: reservation_id || null, order_id: order_id || null,
        context_type: context_type || null, context_id: context_id || null,
        status: 'prepared', subject_snapshot: renderResult.subject || '',
        body_snapshot_redacted: renderResult.body_redacted || '',
        created_by: actor.employee_id, prepared_at: new Date().toISOString()
      };
      const { data: created, error: logErr } = await admin.from('veraluz_comm_log').insert(logEntry).select('id').single();
      if (logErr) return json({ ok: false, error: 'log_create_failed', detail: logErr.message }, 500, cors);
      return json({ ok: true, log_id: (created as Record<string,string>).id, status: 'prepared', subject: renderResult.subject, body_preview: renderResult.body_redacted, unknown_placeholders: renderResult.unknown_placeholders }, 200, cors);
    }

    if (action === 'list_comm_log') {
      const { status, channel, event_type: evtType, limit: lim } = body;
      let q: any = admin.from('veraluz_comm_log')
        .select('id,event_type,template_key,channel,recipient_type,recipient_id,recipient_address_masked,reservation_id,order_id,context_id,status,subject_snapshot,created_at,prepared_at,sent_at,error_code,provider,provider_message_id')
        .eq('tenant_id', TENANT).order('created_at', { ascending: false }).limit(lim || 100);
      if (!actor.is_admin) q = q.eq('created_by', actor.employee_id);
      if (status)  q = q.eq('status', status);
      if (channel) q = q.eq('channel', channel);
      if (evtType) q = q.eq('event_type', evtType);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: 'db_error' }, 500, cors);
      return json({ ok: true, logs: data || [] }, 200, cors);
    }

    if (action === 'dispatch_internal_event') {
      const { event_type, context_id, context_data } = body;
      if (!event_type || !ALLOWED_INTERNAL_EVENTS.has(event_type))
        return json({ ok: false, error: 'unknown_event_type', allowed: [...ALLOWED_INTERNAL_EVENTS] }, 400, cors);
      if (!context_id)
        return json({ ok: false, error: 'context_id_required' }, 400, cors);
      const ctx: Record<string,string> = typeof context_data === 'object' && context_data ? context_data : {};
      const now = new Date().toISOString();

      const { data: tplRaw } = await admin.from('veraluz_comm_templates')
        .select('id, subject_template, body_template, variables_schema')
        .eq('tenant_id', TENANT).eq('template_key', event_type)
        .eq('channel', 'internal').eq('locale', 'fr').eq('active', true)
        .maybeSingle();
      if (!tplRaw)
        return json({ ok: false, error: 'template_not_found', template_key: event_type }, 404, cors);
      const t = tplRaw as Record<string,unknown>;
      const schema: string[] = Array.isArray(t.variables_schema) ? t.variables_schema as string[] : [];

      async function logFailure(errorCode: string, errorMsg: string, recipientId: string | null = null) {
        await admin.from('veraluz_comm_log').insert({
          tenant_id: TENANT, event_type, template_id: String(t.id), template_key: event_type,
          channel: 'internal', recipient_type: 'employee', recipient_id: recipientId,
          context_type: event_type, context_id, status: 'failed',
          subject_snapshot: '', body_snapshot_redacted: '',
          created_by: actor.employee_id, prepared_at: now,
          error_code: errorCode, error_message: errorMsg,
        });
      }

      type Recipient = { id: string; name: string };
      let recipients: Recipient[] = [];
      let variables: Record<string,string> = {};
      let hkFallback = false;

      if (event_type === 'checkout_housekeeping') {
        const { data: rez } = await admin.from('veraluz_reservations')
          .select('id, unit_id, client_name, check_out, status')
          .eq('id', context_id).maybeSingle();
        if (!rez || (rez as Record<string,unknown>).status !== 'checkedout')
          return json({ ok: false, error: 'business_state_invalid', detail: 'reservation_not_checkedout' }, 422, cors);
        const r = rez as Record<string,unknown>;
        const { data: emps } = await admin.from('veraluz_employees')
          .select('id, full_name, role, department').in('status', ['actif','active']);
        const hkEmps = (emps || []).filter((e: Record<string,unknown>) => {
          const role = String(e.role || '').toLowerCase();
          const dept = String(e.department || '').toLowerCase();
          return role === 'housekeeping' || role === 'gouvernante' || role === 'menage' || dept === 'housekeeping' || dept === 'menage';
        });
        if (hkEmps.length === 0) {
          hkFallback = true;
          const { data: mgrs } = await admin.from('veraluz_employees')
            .select('id, full_name').in('status', ['actif','active']).in('role', [...ADMIN_ROLES]).limit(2);
          recipients = (mgrs || []).map((e: Record<string,unknown>) => ({ id: String(e.id), name: String(e.full_name) }));
        } else {
          recipients = hkEmps.map((e: Record<string,unknown>) => ({ id: String(e.id), name: String(e.full_name) }));
        }
        variables = {
          unit_id:        String(r.unit_id  || ctx.unit_id  || ''),
          guest_name:     String(r.client_name || ctx.guest_name || 'Client'),
          checkout_date:  String(r.check_out || now.slice(0,10)),
          reservation_id: String(context_id),
        };
      }
      else if (event_type === 'restaurant_ready_driver') {
        const { data: order } = await admin.from('veraluz_food_orders')
          .select('id, order_number, status, livreur_id, assigned_to, items')
          .eq('id', context_id).maybeSingle();
        if (!order || (order as Record<string,unknown>).status !== 'ready')
          return json({ ok: false, error: 'business_state_invalid', detail: 'food_order_not_ready' }, 422, cors);
        const o = order as Record<string,unknown>;
        if (!o.livreur_id) {
          await logFailure('driver_not_assigned', 'No livreur assigned to food order at time of ready event');
          return json({ ok: false, error: 'driver_not_assigned', sent: 0, comm_logged: true, detail: 'No message sent. Use delivery_assigned_driver when a driver is assigned.' }, 200, cors);
        }
        const { data: liv } = await admin.from('veraluz_employees')
          .select('id, full_name').eq('id', o.livreur_id).maybeSingle();
        if (!liv) return json({ ok: false, error: 'recipient_not_found', detail: 'livreur_employee_not_found' }, 422, cors);
        recipients = [{ id: String((liv as Record<string,unknown>).id), name: String((liv as Record<string,unknown>).full_name) }];
        const orderNum = String(o.order_number || context_id.slice(0,8).toUpperCase());
        let itemsSummary = ctx.items_summary || '';
        if (!itemsSummary && Array.isArray(o.items)) {
          itemsSummary = (o.items as Record<string,unknown>[]).slice(0,3).map((i) => String(i.name || i.product_name || '')).filter(Boolean).join(', ');
        }
        variables = { order_number: orderNum, items_summary: itemsSummary || 'commande' };
      }
      else if (event_type === 'delivery_assigned_driver') {
        const { data: order } = await admin.from('veraluz_food_orders')
          .select('id, order_number, livreur_id, assigned_to, delivery_status, room_number')
          .eq('id', context_id).maybeSingle();
        if (!order) return json({ ok: false, error: 'business_state_invalid', detail: 'order_not_found' }, 422, cors);
        const o = order as Record<string,unknown>;
        if (o.delivery_status !== 'assigned' || !o.livreur_id)
          return json({ ok: false, error: 'business_state_invalid', detail: 'order_not_assigned_or_no_livreur' }, 422, cors);
        const { data: liv } = await admin.from('veraluz_employees')
          .select('id, full_name').eq('id', o.livreur_id).maybeSingle();
        if (!liv) return json({ ok: false, error: 'recipient_not_found', detail: 'livreur_employee_not_found' }, 422, cors);
        recipients = [{ id: String((liv as Record<string,unknown>).id), name: String((liv as Record<string,unknown>).full_name) }];
        variables = {
          order_number: String(o.order_number || context_id.slice(0,8).toUpperCase()),
          room_number:  String(o.room_number || ctx.room_number || ''),
          client_name:  String(ctx.client_name || o.assigned_to || ''),
          livreur_name: String((liv as Record<string,unknown>).full_name),
        };
      }
      else if (event_type === 'stock_low_manager') {
        const { data: mgrs } = await admin.from('veraluz_employees')
          .select('id, full_name').in('status', ['actif','active']).in('role', [...ADMIN_ROLES]);
        recipients = (mgrs || []).map((e: Record<string,unknown>) => ({ id: String(e.id), name: String(e.full_name) }));
        if (recipients.length === 0)
          return json({ ok: false, error: 'recipient_not_found', detail: 'no_manager_found' }, 422, cors);
        variables = {
          item_name:        String(ctx.item_name || ''),
          current_quantity: String(ctx.current_quantity ?? ''),
          min_quantity:     String(ctx.min_quantity ?? ''),
          unit:             String(ctx.unit || ''),
          category:         String(ctx.category || ''),
        };
      }

      if (recipients.length === 0)
        return json({ ok: false, error: 'no_recipients_found' }, 422, cors);

      const renderResult = renderTemplate(t.subject_template as string, t.body_template as string, variables, schema);
      if (!renderResult.ok) {
        await logFailure('missing_variables', (renderResult.missing_variables || []).join(','));
        return json({ ok: false, error: 'render_failed', missing_variables: renderResult.missing_variables }, 400, cors);
      }

      const results: Array<Record<string,unknown>> = [];
      for (const recip of recipients) {
        const { data: existing } = await admin.from('veraluz_comm_log')
          .select('id, status')
          .eq('tenant_id', TENANT).eq('event_type', event_type)
          .eq('context_id', context_id).eq('template_key', event_type)
          .eq('recipient_id', recip.id).in('status', ['prepared','sent','delivered'])
          .maybeSingle();
        if (existing) {
          results.push({ recipient_id: recip.id, recipient_name: recip.name, status: 'skipped_duplicate', log_id: (existing as Record<string,unknown>).id });
          continue;
        }
        const threadId = crypto.randomUUID();
        await admin.from('veraluz_message_threads').insert({
          id: threadId, tenant_id: TENANT, thread_type: 'system_event',
          title: renderResult.subject || event_type,
          participants: [actor.employee_id, recip.id],
          context_type: event_type, context_id, created_by: actor.employee_id, status: 'active',
        });
        const msgId = crypto.randomUUID();
        const { error: msgErr } = await admin.from('veraluz_internal_messages').insert({
          id: msgId, tenant_id: TENANT, thread_id: threadId,
          sender_id: actor.employee_id,
          sender_name: hkFallback ? `[SYSTEME HK fallback: ${actor.actor_name}]` : actor.actor_name,
          sender_role: actor.role, sender_type: 'system_event',
          recipient_id: recip.id, recipient_name: recip.name, recipient_type: 'employee',
          subject: renderResult.subject || '', message: renderResult.body || '',
          context_type: event_type, context_id, is_internal: true, is_draft: false,
          priority: event_type === 'stock_low_manager' ? 'high' : 'normal',
          requires_action: event_type === 'checkout_housekeeping',
          source_type: 'system_event',
        });
        const msgStatus = msgErr ? 'failed' : 'sent';
        const { data: logRow } = await admin.from('veraluz_comm_log').insert({
          tenant_id: TENANT, event_type, template_id: String(t.id), template_key: event_type,
          channel: 'internal', recipient_type: 'employee', recipient_id: recip.id,
          context_type: event_type, context_id, status: msgStatus,
          subject_snapshot: renderResult.subject || '', body_snapshot_redacted: renderResult.body_redacted || '',
          created_by: actor.employee_id, prepared_at: now,
          sent_at: msgStatus === 'sent' ? now : null,
          error_code: msgErr ? 'message_insert_failed' : null,
          error_message: msgErr ? (msgErr as Error).message : null,
        }).select('id').single();
        results.push({
          recipient_id: recip.id, recipient_name: recip.name, status: msgStatus,
          log_id: (logRow as Record<string,unknown> | null)?.id,
          msg_id: msgErr ? null : msgId,
          hk_fallback: hkFallback || undefined,
        });
      }
      const sentCount    = results.filter(r => r.status === 'sent').length;
      const skippedCount = results.filter(r => r.status === 'skipped_duplicate').length;
      const failedCount  = results.filter(r => r.status === 'failed').length;
      return json({ ok: true, event_type, context_id, sent: sentCount, skipped_duplicate: skippedCount, failed: failedCount, hk_fallback: hkFallback || undefined, results }, 200, cors);
    }

    return json({ ok: false, error: `unknown_action: ${action}` }, 400, cors);
  } catch (err) {
    console.error('[communications-secure] unexpected error:', err);
    return json({ ok: false, error: 'internal_error' }, 500, cors);
  }
});
