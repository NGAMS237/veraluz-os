/**
 * SETTINGS-1 — settings-secure Edge Function v1
 *
 * Actions:
 *   get_settings    — lecture publique, wifi.password toujours masqué
 *   update_settings — écriture sécurisée (direction/gerant uniquement)
 *
 * Sécurité:
 *   - Employee session validée via X-Veraluz-Session header
 *   - Rôle direction/gerant requis pour écriture
 *   - Clés autorisées: property, contact, booking, wifi, restaurant, branding, security
 *   - Secrets jamais dans settings (RESEND_API_KEY, service_role, etc.)
 *   - wifi.password jamais renvoyé par get_settings ni loggué
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
];

const DIRECTION_ROLES = new Set([
  'gerant','direction','directrice','manager','admin','superadmin',
]);

const WRITABLE_KEYS = new Set([
  'property','contact','booking','wifi','restaurant','branding','security',
]);

// ── Helpers ────────────────────────────────────────────────────────────────────

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

async function validateEmployeeSession(db: ReturnType<typeof createClient>, sessionToken: string) {
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

// ── Main ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
  }

  let body: Record<string,unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400, cors); }

  const action = body.action as string | undefined;
  if (!action) return json({ ok: false, error: 'action_required' }, 400, cors);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── get_settings — public read (no auth) ──────────────────────────────────
  if (action === 'get_settings') {
    const requestedKeys = Array.isArray(body.keys)
      ? (body.keys as string[]).filter(k => WRITABLE_KEYS.has(k))
      : [...WRITABLE_KEYS];

    const { data: rows, error } = await db
      .from('veraluz_settings')
      .select('key, value')
      .in('key', requestedKeys);

    if (error) return json({ ok: false, error: 'db_error' }, 500, cors);

    const settings: Record<string,unknown> = {};
    for (const row of rows ?? []) {
      if (row.key === 'wifi' && row.value && typeof row.value === 'object') {
        const wifi = row.value as Record<string,unknown>;
        const { password: _password, ...publicWifi } = wifi;
        settings[row.key] = {
          ...publicWifi,
          password_configured: typeof _password === 'string' && _password.length > 0,
        };
      } else {
        settings[row.key] = row.value;
      }
    }
    return json({ ok: true, settings }, 200, cors);
  }

  // ── update_settings — direction only ─────────────────────────────────────
  if (action === 'update_settings') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const employee = await validateEmployeeSession(db, sessionToken);
    if (!employee) return json({ ok: false, error: 'auth_required' }, 401, cors);

    const role = (employee.role ?? '').toLowerCase();
    if (!DIRECTION_ROLES.has(role)) {
      return json({ ok: false, error: 'forbidden', required_role: 'direction' }, 403, cors);
    }

    const key   = body.key as string | undefined;
    const value = body.value as Record<string,unknown> | undefined;

    if (!key || !WRITABLE_KEYS.has(key)) {
      return json({ ok: false, error: 'key_not_allowed' }, 400, cors);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return json({ ok: false, error: 'invalid_value' }, 400, cors);
    }

    // Refuse tout champ ressemblant à un secret
    const SECRET_PATTERNS = [/key/i, /secret/i, /token/i, /password.*api/i, /private/i];
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_PATTERNS.some(p => p.test(k)) && k !== 'password') {
        // Allow wifi.password only
        return json({ ok: false, error: 'secret_field_rejected', field: k }, 400, cors);
      }
    }

    // Validation spécifique security — ranges et types
    if (key === 'security') {
      const v = value;
      const slh = Number(v.session_lifetime_hours ?? 12);
      const rtd = Number(v.resume_token_days ?? 30);
      const tpe = Number(v.temp_pin_expiry_hours ?? 24);
      if (!Number.isFinite(slh) || slh < 1 || slh > 720) return json({ ok: false, error: 'invalid_security_value', field: 'session_lifetime_hours' }, 400, cors);
      if (!Number.isFinite(rtd)  || rtd < 1  || rtd > 365) return json({ ok: false, error: 'invalid_security_value', field: 'resume_token_days' }, 400, cors);
      if (!Number.isFinite(tpe)  || tpe < 1  || tpe > 168) return json({ ok: false, error: 'invalid_security_value', field: 'temp_pin_expiry_hours' }, 400, cors);
      if ('track_ip' in v && typeof v.track_ip !== 'boolean') return json({ ok: false, error: 'invalid_security_value', field: 'track_ip' }, 400, cors);
      if ('track_user_agent' in v && typeof v.track_user_agent !== 'boolean') return json({ ok: false, error: 'invalid_security_value', field: 'track_user_agent' }, 400, cors);
    }

    // Merge avec valeur existante pour ne pas écraser les champs non envoyés
    const { data: existing } = await db
      .from('veraluz_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    const merged = Object.assign({}, existing?.value ?? {}, value);
    if (
      key === 'wifi' &&
      value.password === '' &&
      typeof existing?.value?.password === 'string' &&
      existing.value.password.length > 0
    ) {
      merged.password = existing.value.password;
    }

    const { error: upErr } = await db
      .from('veraluz_settings')
      .upsert({ key, value: merged, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (upErr) return json({ ok: false, error: 'db_write_error' }, 500, cors);

    return json({ ok: true, key, updated_by: employee.full_name }, 200, cors);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, cors);
});
