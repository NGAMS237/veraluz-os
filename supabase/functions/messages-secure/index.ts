/**
 * MICRO 011E-2A — messages-secure Edge Function
 * All message operations via validated Veraluz employee session.
 *
 * Auth flow:
 *   MESSAGES_EMBEDDED → window.parent.veraluzSecureRequest('messages-secure', {action, ...})
 *   CORE broker → adds X-Veraluz-Session + session_token in body
 *   Edge Function → validateSession() → employee_id, role, department (server-side)
 *   Edge Function → service_role DB operations (RLS bypassed safely)
 *
 * NEVER trusts sender_id / sender_name / role from client payload.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080'
];

const ADMIN_ROLES    = new Set(['superadmin','admin','manager','direction','directeur','gerant','directrice']);
const VIEW_ALL_ROLES = new Set(['superadmin','admin','manager','direction','directeur','gerant','directrice','rh','finance']);
const TENANT         = 'veraluz-001';
const MSG_LIMIT      = 80;

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
  can_view_all: boolean;
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
  if (!emp || emp.status !== 'actif') return null;

  const role = ((emp.role as string) || 'staff').toLowerCase();
  return {
    employee_id: sess.employee_id as string,
    actor_name:  (emp.full_name as string) || 'Employé',
    role,
    department:  (emp.department as string) || role,
    can_view_all: VIEW_ALL_ROLES.has(role)
  };
}

function canAccessMessage(actor: ActorInfo, msg: Record<string, unknown>): boolean {
  if (actor.can_view_all)                                                    return true;
  if (msg.sender_id    === actor.employee_id)                                return true;
  if (msg.recipient_id === actor.employee_id)                                return true;
  if (msg.recipient_type === 'all')                                          return true;
  if (msg.recipient_type === 'department' && msg.department === actor.department) return true;
  return false;
}

// ── Apply permission filter to a Supabase query for non-admins ────────────
function applyPermissionFilter(query: ReturnType<typeof createClient>['from'], actor: ActorInfo) {
  if (actor.can_view_all) return query;
  const filters = [
    `sender_id.eq.${actor.employee_id}`,
    `recipient_id.eq.${actor.employee_id}`,
    `recipient_type.eq.all`
  ];
  if (actor.department) {
    filters.push(`and(recipient_type.eq.department,department.eq.${actor.department})`);
  }
  return (query as ReturnType<typeof createClient>['from'] & { or: (f: string) => unknown }).or(filters.join(','));
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
    if (!actor)    return json({ ok: false, error: 'invalid_or_expired_session' }, 401, cors);

    const action: string = body.action || '';

    // ══════════════════════════════════════════════════════════════════════
    // LIST MESSAGES
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'list_messages') {
      const folder: string   = body.folder    || 'inbox';
      const searchQ: string  = body.search_q  || '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = admin
        .from('veraluz_internal_messages')
        .select('*')
        .eq('tenant_id', TENANT)
        .order('created_at', { ascending: false })
        .limit(MSG_LIMIT);

      if      (folder === 'inbox')    q = q.eq('archived', false).eq('is_draft', false);
      else if (folder === 'sent')     q = q.eq('sender_id', actor.employee_id).eq('is_draft', false);
      else if (folder === 'starred')  q = q.eq('starred', true).eq('archived', false).eq('is_draft', false);
      else if (folder === 'archived') q = q.eq('archived', true).eq('is_draft', false);
      else if (folder === 'drafts')   q = q.eq('is_draft', true).eq('sender_id', actor.employee_id);
      else if (folder === 'chloe')    q = q.eq('sender_type', 'chloe').eq('archived', false).eq('is_draft', false);
      else                            q = q.eq('archived', false).eq('is_draft', false);

      if (!actor.can_view_all) {
        const filters = [`sender_id.eq.${actor.employee_id}`, `recipient_id.eq.${actor.employee_id}`, `recipient_type.eq.all`];
        if (actor.department) filters.push(`and(recipient_type.eq.department,department.eq.${actor.department})`);
        q = q.or(filters.join(','));
      }
      if (searchQ) {
        q = q.or(`subject.ilike.%${searchQ}%,body.ilike.%${searchQ}%,sender_name.ilike.%${searchQ}%`);
      }

      const { data: messages, error } = await q;
      if (error) { console.error('[messages-secure] list:', error); return json({ ok: false, error: 'db_error' }, 500, cors); }

      return json({
        ok: true,
        messages: messages || [],
        actor: {
          actor_id:     actor.employee_id,
          actor_name:   actor.actor_name,
          role:         actor.role,
          department:   actor.department,
          can_view_all: actor.can_view_all
        }
      }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // GET THREAD
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'get_thread') {
      const message_id: string = body.message_id || '';
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);

      const { data: msg } = await admin
        .from('veraluz_internal_messages').select('*')
        .eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'message_not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);

      const { data: replies } = await admin
        .from('veraluz_internal_messages').select('*')
        .eq('parent_id', message_id).eq('tenant_id', TENANT)
        .order('created_at', { ascending: true });

      return json({ ok: true, message: msg, replies: replies || [] }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // CREATE MESSAGE / SAVE DRAFT
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'create_message' || action === 'save_draft') {
      const is_draft = (action === 'save_draft') || (body.is_draft === true);
      const { subject, body: msgBody, recipient_id, recipient_type, department,
              labels, priority, context_type, context_id, parent_id } = body;

      if (!is_draft && !subject)  return json({ ok: false, error: 'subject_required' }, 400, cors);
      if (!is_draft && !msgBody)  return json({ ok: false, error: 'body_required' }, 400, cors);

      const newMsg = {
        id:            crypto.randomUUID(),
        tenant_id:     TENANT,
        sender_id:     actor.employee_id,                            // SERVER — never from client
        sender_name:   actor.actor_name,                             // SERVER — never from client
        sender_type:   ADMIN_ROLES.has(actor.role) ? 'admin' : 'employee',
        department:    department || actor.department,
        subject:       subject || '',
        body:          msgBody || '',
        recipient_id:  recipient_id  || null,
        recipient_type: recipient_type || 'all',
        labels:        Array.isArray(labels) ? labels : [],
        priority:      priority || 'normal',
        context_type:  context_type  || null,
        context_id:    context_id    || null,
        parent_id:     parent_id     || null,
        is_draft,
        starred:  false,
        read:     false,
        archived: false,
        created_at: new Date().toISOString()
      };

      const { data: created, error } = await admin
        .from('veraluz_internal_messages').insert(newMsg).select('id').single();
      if (error) { console.error('[messages-secure] create:', error); return json({ ok: false, error: 'create_failed' }, 500, cors); }

      return json({ ok: true, message_id: (created as Record<string,string>).id, is_draft }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // CREATE CHLOÉ MESSAGE (admin/direction only — sender shown as Chloé IA)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'create_chloe_message') {
      if (!ADMIN_ROLES.has(actor.role)) return json({ ok: false, error: 'role_insuffisant' }, 403, cors);
      const { subject, body: msgBody, labels, recipient_type, department } = body;

      const newMsg = {
        id:            crypto.randomUUID(),
        tenant_id:     TENANT,
        sender_id:     actor.employee_id,   // real employee id for audit
        sender_name:   'Chloé IA',
        sender_type:   'chloe',
        department:    department || 'direction',
        subject:       subject   || 'Message Chloé',
        body:          msgBody   || '',
        recipient_id:  null,
        recipient_type: recipient_type || 'all',
        labels:        Array.isArray(labels) ? labels : ['chloe'],
        priority:      'normal',
        is_draft:      false,
        starred:       false,
        read:          false,
        archived:      false,
        created_at:    new Date().toISOString()
      };

      const { data: created, error } = await admin
        .from('veraluz_internal_messages').insert(newMsg).select('id').single();
      if (error) return json({ ok: false, error: 'create_failed' }, 500, cors);
      return json({ ok: true, message_id: (created as Record<string,string>).id }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // REPLY
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'reply') {
      const { parent_id, body: replyBody } = body;
      if (!parent_id)  return json({ ok: false, error: 'parent_id_required' }, 400, cors);
      if (!replyBody)  return json({ ok: false, error: 'body_required' }, 400, cors);

      const { data: parent } = await admin
        .from('veraluz_internal_messages').select('id, sender_id, subject, thread_id, tenant_id')
        .eq('id', parent_id).eq('tenant_id', TENANT).single();
      if (!parent) return json({ ok: false, error: 'parent_not_found' }, 404, cors);

      const reply = {
        id:            crypto.randomUUID(),
        tenant_id:     TENANT,
        parent_id,
        thread_id:     (parent as Record<string,string>).thread_id || null,
        sender_id:     actor.employee_id,   // SERVER — never from client
        sender_name:   actor.actor_name,    // SERVER — never from client
        sender_type:   ADMIN_ROLES.has(actor.role) ? 'admin' : 'employee',
        department:    actor.department,
        subject:       'Re: ' + ((parent as Record<string,string>).subject || ''),
        body:          replyBody,
        recipient_id:  (parent as Record<string,string>).sender_id || null,
        recipient_type: 'direct',
        labels:        [],
        priority:      'normal',
        is_draft:      false,
        starred:       false,
        read:          false,
        archived:      false,
        created_at:    new Date().toISOString()
      };

      const { data: created, error } = await admin
        .from('veraluz_internal_messages').insert(reply).select('id').single();
      if (error) { console.error('[messages-secure] reply:', error); return json({ ok: false, error: 'reply_failed' }, 500, cors); }
      return json({ ok: true, reply_id: (created as Record<string,string>).id }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // UPDATE DRAFT
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'update_draft') {
      const { draft_id, subject, body: msgBody, labels } = body;
      if (!draft_id) return json({ ok: false, error: 'draft_id_required' }, 400, cors);

      const { data: draft } = await admin
        .from('veraluz_internal_messages').select('id, sender_id, is_draft')
        .eq('id', draft_id).eq('tenant_id', TENANT).single();
      if (!draft || !(draft as Record<string,unknown>).is_draft) return json({ ok: false, error: 'draft_not_found' }, 404, cors);
      if ((draft as Record<string,string>).sender_id !== actor.employee_id) return json({ ok: false, error: 'not_your_draft' }, 403, cors);

      const updates: Record<string,unknown> = {};
      if (subject  !== undefined) updates.subject = subject;
      if (msgBody  !== undefined) updates.body    = msgBody;
      if (labels   !== undefined) updates.labels  = labels;

      await admin.from('veraluz_internal_messages').update(updates).eq('id', draft_id);
      return json({ ok: true }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // MARK READ
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'mark_read') {
      const { message_id } = body;
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);

      const { data: msg } = await admin
        .from('veraluz_internal_messages')
        .select('id, sender_id, recipient_id, recipient_type, department, tenant_id')
        .eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);

      await admin.from('veraluz_internal_messages')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', message_id);
      return json({ ok: true }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // STAR
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'star') {
      const { message_id, starred } = body;
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);

      const { data: msg } = await admin
        .from('veraluz_internal_messages')
        .select('id, sender_id, recipient_id, recipient_type, department, tenant_id')
        .eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);

      await admin.from('veraluz_internal_messages').update({ starred: !!starred }).eq('id', message_id);
      return json({ ok: true }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // ARCHIVE (soft-delete — no physical DELETE)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'archive') {
      const { message_id } = body;
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);

      const { data: msg } = await admin
        .from('veraluz_internal_messages')
        .select('id, sender_id, recipient_id, recipient_type, department, tenant_id')
        .eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);

      await admin.from('veraluz_internal_messages')
        .update({ archived: true, archived_at: new Date().toISOString() })
        .eq('id', message_id);
      return json({ ok: true }, 200, cors);
    }

    // ══════════════════════════════════════════════════════════════════════
    // CHECK NEW (lightweight polling)
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'check_new') {
      const since: string = body.since || new Date(0).toISOString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = admin
        .from('veraluz_internal_messages')
        .select('id, created_at', { count: 'exact' })
        .eq('tenant_id', TENANT)
        .eq('is_draft', false)
        .eq('archived', false)
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!actor.can_view_all) {
        const filters = [`recipient_id.eq.${actor.employee_id}`, `recipient_type.eq.all`];
        if (actor.department) filters.push(`and(recipient_type.eq.department,department.eq.${actor.department})`);
        q = q.or(filters.join(','));
      }

      const { data, count } = await q;
      const latest_id = (data && data.length > 0) ? (data[0] as Record<string,string>).id : null;
      return json({ ok: true, count: count || 0, latest_id }, 200, cors);
    }

    return json({ ok: false, error: `unknown_action: ${action}` }, 400, cors);

  } catch (err) {
    console.error('[messages-secure] unexpected error:', err);
    return json({ ok: false, error: 'internal_error' }, 500, cors);
  }
});
