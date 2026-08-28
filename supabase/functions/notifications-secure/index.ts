/**
 * NOTIF-1 — notifications-secure Edge Function v1
 *
 * Actions:
 *   list         — liste les notifications de l'employé connecté (filtrées par rôle côté serveur)
 *   create       — crée une notification (direction/admin uniquement)
 *   mark_read    — marque une notification comme lue par l'employé courant
 *   acknowledge  — acquitte une notification (requires_ack=true) par l'employé courant
 *
 * Sécurité:
 *   - Employee session validée via X-Veraluz-Session header uniquement
 *   - Aucun session_token dans le body
 *   - RBAC: list/mark_read/acknowledge = tout employé authentifié
 *           create = direction/gerant/admin uniquement
 *   - Lecture filtrée côté serveur par recipient_roles
 *   - État de lecture indépendant par employé (notification_reads)
 *   - Aucune donnée mock en PROD
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
];

const ADMIN_ROLES = new Set(['gerant','direction','directrice','manager','admin','superadmin']);
const VALID_CATEGORIES = new Set([
  'system','reservation','payment','room_service','guest','maintenance','finance','hr','security'
]);
const VALID_PRIORITIES = new Set(['critical','high','medium','low']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

async function hashToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function validateEmployeeSession(
  db: ReturnType<typeof createClient>,
  sessionToken: string
) {
  if (!sessionToken) return null;
  const hash = await hashToken(sessionToken);
  const { data: sess } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .single();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;
  const { data: emp } = await db
    .from('veraluz_employees')
    .select('id, full_name, role')
    .eq('id', sess.employee_id)
    .single();
  return emp ?? null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const cors   = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
  }

  // ── Session — header uniquement (jamais body.session_token) ──
  const sessionToken = req.headers.get('x-veraluz-session') ?? '';
  if (!sessionToken) {
    return json({ ok: false, error: 'missing_session' }, 401, cors);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const employee = await validateEmployeeSession(db, sessionToken);
  if (!employee) {
    return json({ ok: false, error: 'invalid_session' }, 401, cors);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, cors);
  }

  const action = (body.action as string) ?? '';

  // ── ACTION: list ──────────────────────────────────────────────────────────
  if (action === 'list') {
    const limit  = Math.min(Number(body.limit  ?? 50), 100);
    const offset = Math.max(Number(body.offset ?? 0),  0);
    const unread_only = body.unread_only === true;

    // Filtrage côté serveur: recipient_roles vide (tous) OU rôle de l'employé dedans
    const { data: notifs, error } = await db
      .from('veraluz_notifications')
      .select('id, title, message, category, priority, recipient_roles, requires_ack, metadata, created_at, created_by')
      .or(`recipient_roles.eq.{},recipient_roles.cs.{${employee.role}}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[notifications-secure] list error:', error.message);
      return json({ ok: false, error: 'db_error' }, 500, cors);
    }

    const notifIds = (notifs ?? []).map((n: Record<string,unknown>) => n.id);

    // Charger l'état de lecture de CET employé uniquement
    const { data: reads } = notifIds.length > 0
      ? await db
          .from('notification_reads')
          .select('notification_id, read_at, ack_at')
          .eq('employee_id', employee.id)
          .in('notification_id', notifIds)
      : { data: [] };

    const readMap = new Map(
      (reads ?? []).map((r: Record<string,unknown>) => [r.notification_id, r])
    );

    const result = (notifs ?? [])
      .map((n: Record<string,unknown>) => {
        const r = readMap.get(n.id as string);
        return { ...n, read_at: r ? (r as Record<string,unknown>).read_at : null, ack_at: r ? (r as Record<string,unknown>).ack_at : null };
      })
      .filter((n: Record<string,unknown>) => !unread_only || !n.read_at);

    return json({ ok: true, notifications: result, count: result.length }, 200, cors);
  }

  // ── ACTION: create ────────────────────────────────────────────────────────
  if (action === 'create') {
    if (!ADMIN_ROLES.has(employee.role)) {
      return json({ ok: false, error: 'forbidden' }, 403, cors);
    }
    const title    = String(body.title    ?? '').trim();
    const message  = String(body.message  ?? '').trim();
    const category = String(body.category ?? 'system');
    const priority = String(body.priority ?? 'medium');
    const recipient_roles = Array.isArray(body.recipient_roles) ? body.recipient_roles : [];
    const requires_ack    = body.requires_ack === true;
    const metadata        = (body.metadata && typeof body.metadata === 'object') ? body.metadata : {};

    if (!title) return json({ ok: false, error: 'title_required' }, 400, cors);
    if (!VALID_CATEGORIES.has(category)) return json({ ok: false, error: 'invalid_category' }, 400, cors);
    if (!VALID_PRIORITIES.has(priority)) return json({ ok: false, error: 'invalid_priority'  }, 400, cors);

    const { data: notif, error } = await db
      .from('veraluz_notifications')
      .insert({
        title, message, category, priority,
        recipient_roles, requires_ack, metadata,
        created_by: employee.id,
      })
      .select('id, title, category, priority, created_at')
      .single();

    if (error) {
      console.error('[notifications-secure] create error:', error.message);
      return json({ ok: false, error: 'db_error' }, 500, cors);
    }
    return json({ ok: true, notification: notif }, 201, cors);
  }

  // ── ACTION: mark_read ─────────────────────────────────────────────────────
  if (action === 'mark_read') {
    const notification_id = String(body.notification_id ?? '').trim();
    if (!notification_id) return json({ ok: false, error: 'notification_id_required' }, 400, cors);

    // Vérifier que la notification existe ET est accessible à ce rôle
    const { data: notif } = await db
      .from('veraluz_notifications')
      .select('id, recipient_roles')
      .eq('id', notification_id)
      .single();

    if (!notif) return json({ ok: false, error: 'not_found' }, 404, cors);
    const roles = notif.recipient_roles as string[];
    if (roles.length > 0 && !roles.includes(employee.role)) {
      return json({ ok: false, error: 'forbidden' }, 403, cors);
    }

    // Upsert: état de lecture indépendant par employé
    const { error } = await db
      .from('notification_reads')
      .upsert(
        { notification_id, employee_id: employee.id, employee_role: employee.role, read_at: new Date().toISOString() },
        { onConflict: 'notification_id,employee_id', ignoreDuplicates: false }
      );

    if (error) {
      console.error('[notifications-secure] mark_read error:', error.message);
      return json({ ok: false, error: 'db_error' }, 500, cors);
    }
    return json({ ok: true, notification_id, employee_id: employee.id }, 200, cors);
  }

  // ── ACTION: acknowledge ───────────────────────────────────────────────────
  if (action === 'acknowledge') {
    const notification_id = String(body.notification_id ?? '').trim();
    if (!notification_id) return json({ ok: false, error: 'notification_id_required' }, 400, cors);

    const { data: notif } = await db
      .from('veraluz_notifications')
      .select('id, recipient_roles, requires_ack')
      .eq('id', notification_id)
      .single();

    if (!notif) return json({ ok: false, error: 'not_found' }, 404, cors);
    const roles = notif.recipient_roles as string[];
    if (roles.length > 0 && !roles.includes(employee.role)) {
      return json({ ok: false, error: 'forbidden' }, 403, cors);
    }

    const now = new Date().toISOString();
    const { error } = await db
      .from('notification_reads')
      .upsert(
        { notification_id, employee_id: employee.id, employee_role: employee.role, read_at: now, ack_at: now },
        { onConflict: 'notification_id,employee_id', ignoreDuplicates: false }
      );

    if (error) {
      console.error('[notifications-secure] acknowledge error:', error.message);
      return json({ ok: false, error: 'db_error' }, 500, cors);
    }
    return json({ ok: true, notification_id, employee_id: employee.id, ack_at: now }, 200, cors);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, cors);
});
