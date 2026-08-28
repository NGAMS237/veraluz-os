/**
 * NOTIF-1 — notifications-secure Edge Function v2
 *
 * Actions:
 *   list         — liste les notifications de l'employé connecté (filtrées par rôle côté serveur)
 *   create       — crée une notification (direction/admin uniquement)
 *   mark_read    — marque une notification comme lue par l'employé courant
 *   acknowledge  — acquitte une notification (requires_ack=true uniquement)
 *
 * Sécurité v2 (Bloc 4 hardening):
 *   - Employee session validée via X-Veraluz-Session header uniquement
 *   - Employé ACTIF requis (status actif/active)
 *   - Rôle normalisé en minuscules
 *   - RBAC: list/mark_read/acknowledge = tout employé actif authentifié
 *           create = direction/gerant/admin uniquement
 *   - limit/offset : validation stricte (entier, plage, NaN refusé)
 *   - recipient_roles : validé contre VALID_ROLES
 *   - metadata : taille max 4096 octets
 *   - idempotency_key : unicité sur create
 *   - acknowledge : refusé si requires_ack=false
 *   - Filtre recipient_roles sans interpolation de rôle brute (cs(array))
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

const VALID_ROLES = new Set([
  'gerant','direction','directrice','manager','admin','superadmin',
  'receptionist','réceptionniste','housekeeping','gouvernante','menage',
  'restaurant','livreur','driver','staff','employee','comptable','finance','rh','it',
]);

const VALID_CATEGORIES = new Set([
  'system','reservation','payment','room_service','guest','maintenance','finance','hr','security'
]);
const VALID_PRIORITIES = new Set(['critical','high','medium','low']);

const METADATA_MAX_BYTES = 4096;

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

interface Employee {
  id: string;
  full_name: string;
  role: string;
  status: string;
}

async function validateEmployeeSession(
  db: ReturnType<typeof createClient>,
  sessionToken: string
): Promise<Employee | null> {
  if (!sessionToken) return null;
  const hash = await hashToken(sessionToken);

  // Vérifier session active + non-révoquée
  const { data: sess } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .single();

  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;

  // Vérifier employé actif (status = actif ou active)
  const { data: emp } = await db
    .from('veraluz_employees')
    .select('id, full_name, role, status')
    .eq('id', sess.employee_id)
    .single();

  if (!emp) return null;
  const status = String(emp.status ?? '').toLowerCase();
  if (status !== 'actif' && status !== 'active') return null;

  // Normaliser le rôle en minuscules
  return {
    id: emp.id as string,
    full_name: emp.full_name as string,
    role: String(emp.role ?? 'staff').toLowerCase(),
    status,
  };
}

function validateInt(val: unknown, min: number, max: number, def: number): number | null {
  if (val === undefined || val === null) return def;
  const n = Number(val);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
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
    return json({ ok: false, error: 'invalid_or_inactive_session' }, 401, cors);
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
    const limitVal  = validateInt(body.limit,  1, 100, 50);
    const offsetVal = validateInt(body.offset, 0, 100000, 0);
    if (limitVal  === null) return json({ ok: false, error: 'invalid_limit',  detail: 'must be integer 1–100'    }, 400, cors);
    if (offsetVal === null) return json({ ok: false, error: 'invalid_offset', detail: 'must be integer 0–100000' }, 400, cors);

    const unread_only = body.unread_only === true;

    // Filtrage côté serveur sans interpolation brute du rôle:
    // recipient_roles vide ({}) = tous | ou contient le rôle de l'employé
    // On utilise deux requêtes séparées pour éviter l'injection via employee.role
    const { data: notifAll, error: errAll } = await db
      .from('veraluz_notifications')
      .select('id, title, message, category, priority, recipient_roles, requires_ack, metadata, created_at, created_by')
      .eq('recipient_roles', '{}')
      .order('created_at', { ascending: false })
      .range(offsetVal, offsetVal + limitVal - 1);

    const { data: notifRole, error: errRole } = await db
      .from('veraluz_notifications')
      .select('id, title, message, category, priority, recipient_roles, requires_ack, metadata, created_at, created_by')
      .contains('recipient_roles', [employee.role])
      .order('created_at', { ascending: false })
      .range(offsetVal, offsetVal + limitVal - 1);

    if (errAll || errRole) {
      console.error('[notifications-secure] list error:', errAll?.message ?? errRole?.message);
      return json({ ok: false, error: 'db_error' }, 500, cors);
    }

    // Fusionner et dédupliquer par id
    const seen = new Set<string>();
    const notifs: Record<string, unknown>[] = [];
    for (const n of [...(notifAll ?? []), ...(notifRole ?? [])]) {
      const id = (n as Record<string, unknown>).id as string;
      if (!seen.has(id)) { seen.add(id); notifs.push(n as Record<string, unknown>); }
    }
    notifs.sort((a, b) => {
      const ta = new Date(a.created_at as string).getTime();
      const tb = new Date(b.created_at as string).getTime();
      return tb - ta;
    });

    const notifIds = notifs.map(n => n.id);

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

    const result = notifs
      .map(n => {
        const r = readMap.get(n.id as string);
        return {
          ...n,
          read_at: r ? (r as Record<string,unknown>).read_at : null,
          ack_at:  r ? (r as Record<string,unknown>).ack_at  : null,
        };
      })
      .filter(n => !unread_only || !n.read_at)
      .slice(0, limitVal);

    return json({ ok: true, notifications: result, count: result.length }, 200, cors);
  }

  // ── ACTION: create ────────────────────────────────────────────────────────
  if (action === 'create') {
    if (!ADMIN_ROLES.has(employee.role)) {
      return json({ ok: false, error: 'forbidden', required_role: 'admin' }, 403, cors);
    }

    const title    = String(body.title    ?? '').trim();
    const message  = String(body.message  ?? '').trim();
    const category = String(body.category ?? 'system').toLowerCase();
    const priority = String(body.priority ?? 'medium').toLowerCase();
    const recipient_roles: string[] = Array.isArray(body.recipient_roles)
      ? (body.recipient_roles as unknown[]).map(r => String(r).toLowerCase())
      : [];
    const requires_ack    = body.requires_ack === true;
    const metadata        = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata))
      ? body.metadata as Record<string, unknown>
      : {};
    const idempotency_key = body.idempotency_key ? String(body.idempotency_key).trim() : null;

    if (!title)  return json({ ok: false, error: 'title_required' }, 400, cors);
    if (title.length > 255)   return json({ ok: false, error: 'title_too_long', max: 255 }, 400, cors);
    if (message.length > 4096) return json({ ok: false, error: 'message_too_long', max: 4096 }, 400, cors);
    if (!VALID_CATEGORIES.has(category)) return json({ ok: false, error: 'invalid_category', allowed: [...VALID_CATEGORIES] }, 400, cors);
    if (!VALID_PRIORITIES.has(priority)) return json({ ok: false, error: 'invalid_priority',  allowed: [...VALID_PRIORITIES] }, 400, cors);

    // Valider recipient_roles contre liste connue
    for (const r of recipient_roles) {
      if (!VALID_ROLES.has(r)) {
        return json({ ok: false, error: 'invalid_recipient_role', role: r, allowed: [...VALID_ROLES] }, 400, cors);
      }
    }

    // Valider taille metadata
    const metaJson = JSON.stringify(metadata);
    if (new TextEncoder().encode(metaJson).length > METADATA_MAX_BYTES) {
      return json({ ok: false, error: 'metadata_too_large', max_bytes: METADATA_MAX_BYTES }, 400, cors);
    }

    // Idempotence — si idempotency_key déjà utilisé, retourner la notif existante
    if (idempotency_key) {
      const { data: existing } = await db
        .from('veraluz_notifications')
        .select('id, title, category, priority, created_at')
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();
      if (existing) {
        return json({ ok: true, notification: existing, deduplicated: true }, 200, cors);
      }
    }

    const insertRow: Record<string, unknown> = {
      title, message, category, priority,
      recipient_roles, requires_ack, metadata,
      created_by: employee.id,
    };
    if (idempotency_key) insertRow.idempotency_key = idempotency_key;

    const { data: notif, error } = await db
      .from('veraluz_notifications')
      .insert(insertRow)
      .select('id, title, category, priority, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        // Race sur idempotency_key — récupérer l'existant
        if (idempotency_key) {
          const { data: dup } = await db
            .from('veraluz_notifications')
            .select('id, title, category, priority, created_at')
            .eq('idempotency_key', idempotency_key)
            .maybeSingle();
          if (dup) return json({ ok: true, notification: dup, deduplicated: true }, 200, cors);
        }
        return json({ ok: false, error: 'duplicate_idempotency_key' }, 409, cors);
      }
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
      .maybeSingle();

    if (!notif) return json({ ok: false, error: 'not_found' }, 404, cors);
    const roles = (notif as Record<string, unknown>).recipient_roles as string[];
    if (Array.isArray(roles) && roles.length > 0 && !roles.includes(employee.role)) {
      return json({ ok: false, error: 'forbidden' }, 403, cors);
    }

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
      .maybeSingle();

    if (!notif) return json({ ok: false, error: 'not_found' }, 404, cors);
    const n = notif as Record<string, unknown>;

    // Bloc 4: acknowledge uniquement si requires_ack = true
    if (n.requires_ack !== true) {
      return json({ ok: false, error: 'ack_not_required', notification_id }, 400, cors);
    }

    const roles = n.recipient_roles as string[];
    if (Array.isArray(roles) && roles.length > 0 && !roles.includes(employee.role)) {
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
