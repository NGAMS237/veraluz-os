/**
 * MICRO 011E-2A — messages-secure Edge Function (v2 — schema-corrected)
 * DB column: `message` (not `body`); no `read` boolean (only `read_at`).
 * normMsg() maps DB row → client response, renaming message→body.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasCapability, normalizeRole } from './_rbac.ts';

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

/** Normalize DB row for client: rename message→body, derive read bool from read_at */
function normMsg(row: Record<string,unknown>): Record<string,unknown> {
  const r = { ...row };
  r.body = r.message;
  delete r.message;
  r.read = r.read_at != null;
  return r;
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
  if (actor.can_view_all)                                                         return true;
  if (msg.sender_id    === actor.employee_id)                                     return true;
  if (msg.recipient_id === actor.employee_id)                                     return true;
  if (msg.recipient_type === 'all')                                               return true;
  if (msg.recipient_type === 'department' && msg.department === actor.department) return true;
  return false;
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

    // ── LIST MESSAGES ──────────────────────────────────────────────────────
    if (action === 'list_messages') {
      const folder: string  = body.folder   || 'inbox';
      const searchQ: string = body.search_q || '';
      let q: any = admin
        .from('veraluz_internal_messages').select('*')
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
        const f = [`sender_id.eq.${actor.employee_id}`,`recipient_id.eq.${actor.employee_id}`,`recipient_type.eq.all`];
        if (actor.department) f.push(`and(recipient_type.eq.department,department.eq.${actor.department})`);
        q = q.or(f.join(','));
      }
      if (searchQ) q = q.or(`subject.ilike.%${searchQ}%,message.ilike.%${searchQ}%,sender_name.ilike.%${searchQ}%`);
      const { data: messages, error } = await q;
      if (error) { console.error('[messages-secure] list:', error); return json({ ok: false, error: 'db_error' }, 500, cors); }
      return json({ ok: true, messages: (messages || []).map(normMsg), actor: { actor_id: actor.employee_id, actor_name: actor.actor_name, role: actor.role, department: actor.department, can_view_all: actor.can_view_all } }, 200, cors);
    }

    // ── GET THREAD ─────────────────────────────────────────────────────────
    if (action === 'get_thread') {
      const message_id: string = body.message_id || '';
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);
      const { data: msg } = await admin.from('veraluz_internal_messages').select('*').eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'message_not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);
      const { data: replies } = await admin.from('veraluz_internal_messages').select('*').eq('parent_id', message_id).eq('tenant_id', TENANT).order('created_at', { ascending: true });
      return json({ ok: true, message: normMsg(msg as Record<string,unknown>), replies: (replies || []).map(normMsg) }, 200, cors);
    }

    // ── CREATE MESSAGE / SAVE DRAFT ────────────────────────────────────────
    if (action === 'create_message' || action === 'save_draft') {
      const is_draft = (action === 'save_draft') || (body.is_draft === true);
      const { subject, body: msgBody, recipient_id, recipient_type, department, labels, priority, context_type, context_id, parent_id } = body;
      if (!is_draft && !subject)  return json({ ok: false, error: 'subject_required' }, 400, cors);
      if (!is_draft && !msgBody)  return json({ ok: false, error: 'body_required' }, 400, cors);
      const newMsg = {
        tenant_id: TENANT, sender_id: actor.employee_id, sender_name: actor.actor_name,
        sender_type: ADMIN_ROLES.has(actor.role) ? 'admin' : 'employee',
        department: department || actor.department, subject: subject || '',
        message: msgBody || '',
        recipient_id: recipient_id || null, recipient_type: recipient_type || 'all',
        labels: Array.isArray(labels) ? labels : [], priority: priority || 'normal',
        context_type: context_type || null, context_id: context_id || null,
        parent_id: parent_id || null, is_draft
      };
      const { data: created, error } = await admin.from('veraluz_internal_messages').insert(newMsg).select('id').single();
      if (error) { console.error('[messages-secure] create:', error); return json({ ok: false, error: 'create_failed' }, 500, cors); }
      return json({ ok: true, message_id: (created as Record<string,string>).id, is_draft }, 200, cors);
    }

    // ── CREATE CHLOÉ MESSAGE ───────────────────────────────────────────────
    if (action === 'create_chloe_message') {
      if (!ADMIN_ROLES.has(actor.role)) return json({ ok: false, error: 'role_insuffisant' }, 403, cors);
      const { subject, body: msgBody, labels, recipient_type, department } = body;
      const newMsg = {
        tenant_id: TENANT, sender_id: actor.employee_id, sender_name: 'Chloé IA', sender_type: 'chloe',
        department: department || 'direction', subject: subject || 'Message Chloé',
        message: msgBody || '',
        recipient_id: null, recipient_type: recipient_type || 'all',
        labels: Array.isArray(labels) ? labels : ['chloe'], priority: 'normal', is_draft: false
      };
      const { data: created, error } = await admin.from('veraluz_internal_messages').insert(newMsg).select('id').single();
      if (error) return json({ ok: false, error: 'create_failed' }, 500, cors);
      return json({ ok: true, message_id: (created as Record<string,string>).id }, 200, cors);
    }

    // ── REPLY ──────────────────────────────────────────────────────────────
    if (action === 'reply') {
      const { parent_id, body: replyBody } = body;
      if (!parent_id)  return json({ ok: false, error: 'parent_id_required' }, 400, cors);
      if (!replyBody)  return json({ ok: false, error: 'body_required' }, 400, cors);
      const { data: parent } = await admin.from('veraluz_internal_messages').select('id, sender_id, subject, thread_id, tenant_id').eq('id', parent_id).eq('tenant_id', TENANT).single();
      if (!parent) return json({ ok: false, error: 'parent_not_found' }, 404, cors);
      const p = parent as Record<string,string>;
      const reply = {
        tenant_id: TENANT, parent_id, thread_id: p.thread_id || null,
        sender_id: actor.employee_id, sender_name: actor.actor_name,
        sender_type: ADMIN_ROLES.has(actor.role) ? 'admin' : 'employee',
        department: actor.department, subject: 'Re: ' + (p.subject || ''),
        message: replyBody,
        recipient_id: p.sender_id || null, recipient_type: 'direct',
        labels: [], priority: 'normal', is_draft: false
      };
      const { data: created, error } = await admin.from('veraluz_internal_messages').insert(reply).select('id').single();
      if (error) { console.error('[messages-secure] reply:', error); return json({ ok: false, error: 'reply_failed' }, 500, cors); }
      return json({ ok: true, reply_id: (created as Record<string,string>).id }, 200, cors);
    }

    // ── UPDATE DRAFT ───────────────────────────────────────────────────────
    if (action === 'update_draft') {
      const { draft_id, subject, body: msgBody, labels } = body;
      if (!draft_id) return json({ ok: false, error: 'draft_id_required' }, 400, cors);
      const { data: draft } = await admin.from('veraluz_internal_messages').select('id, sender_id, is_draft').eq('id', draft_id).eq('tenant_id', TENANT).single();
      if (!draft || !(draft as Record<string,unknown>).is_draft) return json({ ok: false, error: 'draft_not_found' }, 404, cors);
      if ((draft as Record<string,string>).sender_id !== actor.employee_id) return json({ ok: false, error: 'not_your_draft' }, 403, cors);
      const updates: Record<string,unknown> = {};
      if (subject !== undefined) updates.subject = subject;
      if (msgBody !== undefined) updates.message = msgBody;
      if (labels  !== undefined) updates.labels  = labels;
      await admin.from('veraluz_internal_messages').update(updates).eq('id', draft_id);
      return json({ ok: true }, 200, cors);
    }

    // ── MARK READ ──────────────────────────────────────────────────────────
    if (action === 'mark_read') {
      const { message_id } = body;
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);
      const { data: msg } = await admin.from('veraluz_internal_messages').select('id, sender_id, recipient_id, recipient_type, department, tenant_id').eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);
      await admin.from('veraluz_internal_messages').update({ read_at: new Date().toISOString() }).eq('id', message_id);
      return json({ ok: true }, 200, cors);
    }

    // ── STAR ───────────────────────────────────────────────────────────────
    if (action === 'star') {
      const { message_id, starred } = body;
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);
      const { data: msg } = await admin.from('veraluz_internal_messages').select('id, sender_id, recipient_id, recipient_type, department, tenant_id').eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);
      await admin.from('veraluz_internal_messages').update({ starred: !!starred }).eq('id', message_id);
      return json({ ok: true }, 200, cors);
    }

    // ── ARCHIVE (soft-delete — NO physical DELETE) ─────────────────────────
    if (action === 'archive') {
      const { message_id } = body;
      if (!message_id) return json({ ok: false, error: 'message_id_required' }, 400, cors);
      const { data: msg } = await admin.from('veraluz_internal_messages').select('id, sender_id, recipient_id, recipient_type, department, tenant_id').eq('id', message_id).eq('tenant_id', TENANT).single();
      if (!msg) return json({ ok: false, error: 'not_found' }, 404, cors);
      if (!canAccessMessage(actor, msg as Record<string,unknown>)) return json({ ok: false, error: 'access_denied' }, 403, cors);
      await admin.from('veraluz_internal_messages').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', message_id);
      return json({ ok: true }, 200, cors);
    }

    // ── CHECK NEW ──────────────────────────────────────────────────────────
    if (action === 'check_new') {
      const since: string = body.since || new Date(0).toISOString();
      let q: any = admin.from('veraluz_internal_messages')
        .select('id, created_at', { count: 'exact' })
        .eq('tenant_id', TENANT).eq('is_draft', false).eq('archived', false)
        .gt('created_at', since).order('created_at', { ascending: false }).limit(1);
      if (!actor.can_view_all) {
        const f = [`recipient_id.eq.${actor.employee_id}`,`recipient_type.eq.all`];
        if (actor.department) f.push(`and(recipient_type.eq.department,department.eq.${actor.department})`);
        q = q.or(f.join(','));
      }
      const { data, count } = await q;
      const latest_id = (data && data.length > 0) ? (data[0] as Record<string,string>).id : null;
      return json({ ok: true, count: count || 0, latest_id }, 200, cors);
    }

    // ── LIST GUEST CONVERSATIONS ───────────────────────────────────────
    // reception: any staff with messages.read
    // direction: gérant only (settings.manage capability)
    if (action === 'list_guest_conversations') {
      const channel: string = String(body.channel ?? 'reception').trim().toLowerCase();
      const ALLOWED_CHANNELS = new Set(['reception','direction']);
      if (!ALLOWED_CHANNELS.has(channel))
        return json({ ok: false, error: 'invalid_channel', allowed: ['reception','direction'] }, 400, cors);

      // RBAC server-side — direction channel: gérant only
      if (channel === 'direction') {
        const normRole = normalizeRole(actor.role);
        if (!hasCapability(normRole, 'settings.manage'))
          return json({ ok: false, error: 'access_denied', hint: 'direction_gerant_only' }, 403, cors);
      } else {
        // reception: must have messages.read
        if (!hasCapability(normalizeRole(actor.role), 'messages.read'))
          return json({ ok: false, error: 'access_denied' }, 403, cors);
      }

      // Group by reservation_id — return last message per reservation + unread count
      const { data: msgs, error: mErr } = await admin
        .from('veraluz_guest_messages')
        .select('id, reservation_id, sender_type, staff_name, channel, message, created_at, read_at')
        .eq('channel', channel)
        .order('created_at', { ascending: false })
        .limit(200);

      if (mErr) return json({ ok: false, error: 'db_error' }, 500, cors);

      // Group conversations by reservation_id
      const convMap: Record<string, any> = {};
      for (const m of (msgs ?? [])) {
        const rid = m.reservation_id;
        if (!convMap[rid]) {
          convMap[rid] = {
            reservation_id: rid,
            channel,
            last_message:   m.message,
            last_sender:    m.sender_type,
            last_at:        m.created_at,
            unread_count:   0,
          };
        }
        // Count unread staff-visible messages (guest sent, not yet read by staff)
        if (m.sender_type === 'guest' && !m.read_at) {
          convMap[rid].unread_count += 1;
        }
      }

      return json({ ok: true, conversations: Object.values(convMap), channel }, 200, cors);
    }

    // ── GET GUEST CONVERSATION THREAD ─────────────────────────────────
    if (action === 'get_guest_thread') {
      const channel: string = String(body.channel ?? 'reception').trim().toLowerCase();
      const reservation_id: string = String(body.reservation_id ?? '').trim();
      if (!reservation_id) return json({ ok: false, error: 'reservation_id_required' }, 400, cors);

      // RBAC
      if (channel === 'direction') {
        if (!hasCapability(normalizeRole(actor.role), 'settings.manage'))
          return json({ ok: false, error: 'access_denied', hint: 'direction_gerant_only' }, 403, cors);
      } else {
        if (!hasCapability(normalizeRole(actor.role), 'messages.read'))
          return json({ ok: false, error: 'access_denied' }, 403, cors);
      }

      const { data: messages, error: mErr } = await admin
        .from('veraluz_guest_messages')
        .select('id, sender_type, staff_name, staff_id, channel, message, created_at, read_at')
        .eq('reservation_id', reservation_id)
        .eq('channel', channel)
        .order('created_at', { ascending: true })
        .limit(200);

      if (mErr) return json({ ok: false, error: 'db_error' }, 500, cors);

      // Mark unread guest messages as read
      const unread = (messages ?? []).filter((m: any) => m.sender_type === 'guest' && !m.read_at).map((m: any) => m.id);
      if (unread.length > 0) {
        await admin.from('veraluz_guest_messages')
          .update({ read_at: new Date().toISOString() })
          .in('id', unread);
      }

      return json({ ok: true, messages: messages ?? [], channel, reservation_id }, 200, cors);
    }

    // ── REPLY TO GUEST ─────────────────────────────────────────────────
    // Staff posts reply into guest's conversation thread.
    // direction replies: gérant only (settings.manage).
    // reception replies: any staff with messages.send.
    if (action === 'reply_to_guest') {
      const channel: string = String(body.channel ?? 'reception').trim().toLowerCase();
      const reservation_id: string = String(body.reservation_id ?? '').trim();
      const rawMessage: string = String(body.message ?? '').trim();

      if (!reservation_id) return json({ ok: false, error: 'reservation_id_required' }, 400, cors);
      if (!rawMessage || rawMessage.length > 2000) return json({ ok: false, error: 'invalid_message' }, 400, cors);

      const ALLOWED_CHANNELS = new Set(['reception','direction']);
      if (!ALLOWED_CHANNELS.has(channel))
        return json({ ok: false, error: 'invalid_channel' }, 400, cors);

      // RBAC server-side
      if (channel === 'direction') {
        if (!hasCapability(normalizeRole(actor.role), 'settings.manage'))
          return json({ ok: false, error: 'access_denied', hint: 'direction_gerant_only' }, 403, cors);
      } else {
        if (!hasCapability(normalizeRole(actor.role), 'messages.send'))
          return json({ ok: false, error: 'access_denied' }, 403, cors);
      }

      // Verify reservation exists
      const { data: res } = await admin
        .from('veraluz_reservations')
        .select('id')
        .eq('id', reservation_id)
        .single();
      if (!res) return json({ ok: false, error: 'reservation_not_found' }, 404, cors);

      const { data: msg, error: msgErr } = await admin
        .from('veraluz_guest_messages')
        .insert({
          reservation_id,
          sender_type: 'staff',
          staff_id:    actor.employee_id,
          staff_name:  actor.actor_name,
          channel,
          message:     rawMessage,
        })
        .select('id, channel, message, created_at')
        .single();

      if (msgErr) return json({ ok: false, error: 'reply_failed' }, 500, cors);
      return json({ ok: true, message: msg }, 201, cors);
    }

    return json({ ok: false, error: `unknown_action: ${action}` }, 400, cors);

  } catch (err) {
    console.error('[messages-secure] unexpected error:', err);
    return json({ ok: false, error: 'internal_error' }, 500, cors);
  }
});
