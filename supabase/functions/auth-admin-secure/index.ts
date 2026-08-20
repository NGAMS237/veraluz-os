/**
 * AUTH-R6 — auth-admin-secure
 *
 * API administration sessions + audit + politiques pour AUTH_EMBEDDED.
 * Toutes les permissions sont vérifiées côté serveur via capabilities R5.
 * Le token_hash n'est JAMAIS retourné au frontend.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability } from './_rbac.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

const ACTIVE_STATUSES = new Set(['actif', 'active']);

// Politiques IMMUABLES serveur — ne jamais modifier sans déploiement EF
const IMMUTABLE_POLICIES = {
  pin_digits:               6,
  pin_hashing:              'bcrypt',
  change_token_minutes:     15,
  must_change_pin_enforced: true,
  session_revoke_supported: true,
  role_capability_enforced: true,
  token_hash_stored:        'SHA-256 côté serveur uniquement',
  raw_token_stored:         false,
  two_factor_auth:          false,
};

/** Lire les params configurables depuis veraluz_settings.security */
async function loadSecuritySettings(db: DbClient): Promise<Record<string, unknown>> {
  const { data } = await db.from('veraluz_settings').select('value').eq('key', 'security').maybeSingle();
  const s = (data?.value || {}) as Record<string, unknown>;
  return {
    session_lifetime_hours: Number(s.session_lifetime_hours) || 12,
    resume_token_days:      Number(s.resume_token_days)      || 30,
    temp_pin_expiry_hours:  Number(s.temp_pin_expiry_hours)  || 24,
    track_ip:               s.track_ip !== false,
    track_user_agent:       s.track_user_agent !== false,
  };
}

// Clés de details_json autorisées à être exposées (whitelist)
const SAFE_DETAIL_KEYS = new Set([
  'action', 'reason', 'session_count', 'role', 'error_type',
  'target_employee_id', 'target_employee_name', 'performed_by_role',
  'ip', 'source',
]);

// Labels des événements auth pour l'affichage
const EVENT_LABELS: Record<string, string> = {
  login_success:              'Connexion réussie',
  login_failed:               'Échec de connexion',
  logout:                     'Déconnexion',
  pin_reset:                  'PIN réinitialisé',
  pin_change:                 'PIN modifié',
  login_must_change_pin:      'PIN provisoire utilisé',
  forced_pin_change_completed:'Nouveau PIN défini',
  sessions_revoked:           'Sessions révoquées',
  session_revoked:            'Session révoquée',
  pin_change_token_issued:    'Jeton changement PIN émis',
  resume_token_issued:        'Jeton reprise émis',
  resume_used:                'Reprise de session',
  access_forbidden:           'Accès refusé',
};

type Actor = { id: string; role: string; tokenHash: string };
type DbClient = ReturnType<typeof createClient>;

function corsHeaders(origin: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateEmployeeSession(
  db: DbClient, rawToken: string
): Promise<{ actor: Actor | null; serverError: boolean }> {
  if (!rawToken || rawToken.length < 16) return { actor: null, serverError: false };

  const tokenHash = await sha256Hex(rawToken);
  const { data: session, error: sessionError } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (sessionError) {
    console.error('[auth-admin-secure] session_lookup_failed', sessionError.code);
    return { actor: null, serverError: true };
  }
  if (!session) return { actor: null, serverError: false };

  const { data: employee, error: employeeError } = await db
    .from('veraluz_employees')
    .select('id, role, status')
    .eq('id', session.employee_id)
    .maybeSingle();

  if (employeeError) {
    console.error('[auth-admin-secure] actor_lookup_failed', employeeError.code);
    return { actor: null, serverError: true };
  }
  if (!employee || !ACTIVE_STATUSES.has(String(employee.status || '').toLowerCase())) {
    return { actor: null, serverError: false };
  }

  return {
    actor: { id: String(employee.id), role: normalizeRole(employee.role), tokenHash },
    serverError: false,
  };
}

function sanitizeDetailsJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    // Jamais de valeur qui ressemble à un PIN / token / hash
    if (typeof value === 'string') {
      const v = value.trim();
      // Rejeter si ressemble à bcrypt hash, hex hash, JWT, etc.
      if (/^\$2[ab]\$/.test(v)) continue;           // bcrypt
      if (/^[0-9a-f]{40,}$/i.test(v)) continue;      // hex hash 40+ chars
      if (/^ey[A-Za-z0-9+/=]{20,}/.test(v)) continue; // JWT
      if (v.length > 256) continue;
    }
    if (typeof value === 'number' && key !== 'session_count') continue; // garder seulement session_count
    if (key === 'session_count' || typeof value === 'string' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parseUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Appareil inconnu';
  const u = ua.toLowerCase();
  let browser = 'Navigateur inconnu';
  let os = 'OS inconnu';
  if (u.includes('chrome') && !u.includes('edg'))  browser = 'Chrome';
  else if (u.includes('firefox'))                    browser = 'Firefox';
  else if (u.includes('safari') && !u.includes('chrome')) browser = 'Safari';
  else if (u.includes('edg'))                        browser = 'Edge';
  if (u.includes('windows'))       os = 'Windows';
  else if (u.includes('iphone'))   os = 'iPhone';
  else if (u.includes('ipad'))     os = 'iPad';
  else if (u.includes('android'))  os = 'Android';
  else if (u.includes('mac'))      os = 'macOS';
  else if (u.includes('linux'))    os = 'Linux';
  if (browser === 'Navigateur inconnu' && os === 'OS inconnu') return 'Appareil inconnu';
  return browser + ' / ' + os;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ ok: false, error: 'forbidden_origin' }, 403, origin);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, 400, origin); }

  const sessionToken = req.headers.get('x-veraluz-session')?.trim() || '';
  if (!sessionToken) return json({ ok: false, error: 'session_required' }, 401, origin);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const validation = await validateEmployeeSession(db, sessionToken);
  if (validation.serverError) return json({ ok: false, error: 'server_error' }, 500, origin);
  if (!validation.actor) return json({ ok: false, error: 'invalid_or_expired_session' }, 401, origin);

  const actor = validation.actor;
  const action = String(body.action || '').trim();
  if (!action) return json({ ok: false, error: 'action_required' }, 400, origin);

  // ============================================================
  // get_security_policies — tout employé authentifié
  // ============================================================
  if (action === 'get_security_policies') {
    const configurable = await loadSecuritySettings(db);
    const policies = {
      ...IMMUTABLE_POLICIES,
      session_lifetime_hours: configurable.session_lifetime_hours,
      resume_token_days:      configurable.resume_token_days,
      temp_pin_expiry_hours:  configurable.temp_pin_expiry_hours,
      ip_tracking:            configurable.track_ip,
      user_agent_tracking:    configurable.track_user_agent,
    };
    return json({ ok: true, policies }, 200, origin);
  }

  // ============================================================
  // list_sessions — auth.sessions.read
  // ============================================================
  if (action === 'list_sessions') {
    if (!hasCapability(actor.role, 'auth.sessions.read')) {
      return json({ ok: false, error: 'forbidden', required: 'auth.sessions.read' }, 403, origin);
    }

    const now = new Date().toISOString();
    const { data: rows, error } = await db
      .from('veraluz_employee_sessions')
      .select('id, employee_id, created_at, expires_at, last_seen_at, revoked_at, revoked_reason, created_ip, last_ip, user_agent')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[auth-admin-secure] list_sessions_failed', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }

    // Récupérer les infos employé en une passe
    const empIds = [...new Set((rows || []).map(r => r.employee_id).filter(Boolean))];
    const { data: employees } = await db
      .from('veraluz_employees')
      .select('id, full_name, role')
      .in('id', empIds);
    const empMap: Record<string, { full_name: string; role: string }> = {};
    (employees || []).forEach(e => { empMap[String(e.id)] = e; });

    const sessions = (rows || []).map(s => {
      const emp = empMap[String(s.employee_id)] || {};
      const isActive = !s.revoked_at && s.expires_at > now;
      // is_current: comparer le hash du token acteur avec les sessions de cet employé
      // On compare seulement pour l'acteur lui-même (même employee_id)
      const isCurrent = s.employee_id === actor.id &&
        /* La session courante n'a pas de revoked_at */
        !s.revoked_at && s.expires_at > now &&
        /* On ne peut pas comparer le hash ici directement SAUF si on stocke
           le tokenHash de l'acteur — ce qu'on fait via actor.tokenHash */
        false; // override ci-dessous

      return {
        session_id:     s.id,
        employee: {
          id:   String(s.employee_id || ''),
          name: emp.full_name || '—',
          role: emp.role ? normalizeRole(emp.role) : '—',
        },
        created_at:     s.created_at,
        expires_at:     s.expires_at,
        last_seen_at:   s.last_seen_at || null,
        active:         isActive,
        revoked_at:     s.revoked_at || null,
        revoked_reason: s.revoked_reason || null,
        device:         parseUserAgent(s.user_agent),
        ip:             s.last_ip || s.created_ip || null,
        is_current:     false,             // calculé ci-dessous
      };
    });

    // Marquer la session courante (celle dont le token_hash = hash du token acteur)
    // On effectue une requête ciblée pour trouver la session courante de l'acteur
    const { data: currentSessRow } = await db
      .from('veraluz_employee_sessions')
      .select('id')
      .eq('token_hash', actor.tokenHash)
      .maybeSingle();

    const currentSessId = currentSessRow?.id;
    sessions.forEach(s => {
      if (currentSessId && s.session_id === currentSessId) s.is_current = true;
    });

    const activeCount   = sessions.filter(s => s.active).length;
    const revokedCount  = sessions.filter(s => s.revoked_at).length;

    return json({
      ok: true,
      sessions,
      meta: { total: sessions.length, active: activeCount, revoked: revokedCount },
    }, 200, origin);
  }

  // ============================================================
  // revoke_session — auth.sessions.manage
  // ============================================================
  if (action === 'revoke_session') {
    if (!hasCapability(actor.role, 'auth.sessions.manage')) {
      return json({ ok: false, error: 'forbidden', required: 'auth.sessions.manage' }, 403, origin);
    }
    const sessionId = String(body.session_id || '').trim();
    if (!sessionId) return json({ ok: false, error: 'session_id_required' }, 400, origin);

    // Vérifier que la session existe et n'est pas déjà révoquée
    const { data: sess, error: fetchErr } = await db
      .from('veraluz_employee_sessions')
      .select('id, employee_id, token_hash, revoked_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (fetchErr) return json({ ok: false, error: 'server_error' }, 500, origin);
    if (!sess) return json({ ok: false, error: 'session_not_found' }, 404, origin);
    if (sess.revoked_at) return json({ ok: false, error: 'already_revoked' }, 409, origin);

    // Sécurité : ne pas révoquer sa propre session via cette action
    if (sess.token_hash === actor.tokenHash) {
      return json({ ok: false, error: 'cannot_revoke_own_session' }, 400, origin);
    }

    const now = new Date().toISOString();
    const { error: revokeErr } = await db
      .from('veraluz_employee_sessions')
      .update({ revoked_at: now, revoked_reason: 'admin_revoke' })
      .eq('id', sessionId)
      .is('revoked_at', null);

    if (revokeErr) {
      console.error('[auth-admin-secure] revoke_session_failed', revokeErr.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }

    // Journaliser
    await db.from('veraluz_auth_events').insert({
      event_type:       'session_revoked',
      employee_id:      String(sess.employee_id || ''),
      performed_by:     actor.id,
      performed_by_role: actor.role,
      success:          true,
      details_json:     { reason: 'admin_revoke', source: 'auth_admin_secure' },
    }).select().maybeSingle();

    return json({ ok: true, session_id: sessionId, revoked: true }, 200, origin);
  }

  // ============================================================
  // revoke_employee_sessions — auth.sessions.manage
  // ============================================================
  if (action === 'revoke_employee_sessions') {
    if (!hasCapability(actor.role, 'auth.sessions.manage')) {
      return json({ ok: false, error: 'forbidden', required: 'auth.sessions.manage' }, 403, origin);
    }
    const targetEmployeeId = String(body.employee_id || '').trim();
    if (!targetEmployeeId) return json({ ok: false, error: 'employee_id_required' }, 400, origin);

    // Appeler la RPC atomique existante (AUTH-R2B1.2)
    const { data: rpcResult, error: rpcErr } = await db
      .rpc('veraluz_revoke_employee_sessions', {
        p_employee_id: targetEmployeeId,
        p_reason:      'admin_revoke_all',
      });

    if (rpcErr) {
      console.error('[auth-admin-secure] revoke_employee_sessions_failed', rpcErr.code);
      // Fallback: direct UPDATE si la RPC échoue
      const { error: updateErr } = await db
        .from('veraluz_employee_sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'admin_revoke_all' })
        .eq('employee_id', targetEmployeeId)
        .is('revoked_at', null);
      if (updateErr) return json({ ok: false, error: 'server_error' }, 500, origin);
    }

    const sessionCount = typeof rpcResult === 'number' ? rpcResult : null;

    // Journaliser
    await db.from('veraluz_auth_events').insert({
      event_type:       'sessions_revoked',
      employee_id:      targetEmployeeId,
      performed_by:     actor.id,
      performed_by_role: actor.role,
      success:          true,
      details_json:     {
        reason: 'admin_revoke_all',
        session_count: sessionCount ?? 'unknown',
        source: 'auth_admin_secure',
      },
    }).select().maybeSingle();

    return json({ ok: true, employee_id: targetEmployeeId, sessions_revoked: sessionCount }, 200, origin);
  }

  // ============================================================
  // list_audit — auth.audit.read
  // ============================================================
  if (action === 'list_audit') {
    if (!hasCapability(actor.role, 'auth.audit.read')) {
      return json({ ok: false, error: 'forbidden', required: 'auth.audit.read' }, 403, origin);
    }

    const limit  = Math.min(Number(body.limit  || 100), 500);
    const offset = Math.max(Number(body.offset || 0),   0);
    const filterEventType = String(body.event_type || '').trim() || null;

    let query = db
      .from('veraluz_auth_events')
      .select('id, event_type, employee_id, admin_username, performed_by, performed_by_role, success, ip, user_agent, details_json, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filterEventType) query = query.eq('event_type', filterEventType);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[auth-admin-secure] list_audit_failed', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }

    const events = (rows || []).map(e => ({
      id:              e.id,
      event_type:      e.event_type,
      event_label:     EVENT_LABELS[e.event_type] || e.event_type,
      employee_id:     e.employee_id || null,
      admin_username:  e.admin_username || null,
      performed_by:    e.performed_by || null,
      performed_by_role: e.performed_by_role || null,
      success:         e.success,
      ip:              e.ip || null,
      device:          parseUserAgent(e.user_agent),
      details:         sanitizeDetailsJson(e.details_json),
      created_at:      e.created_at,
    }));

    return json({ ok: true, events, meta: { count: events.length, offset } }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, origin);
});
