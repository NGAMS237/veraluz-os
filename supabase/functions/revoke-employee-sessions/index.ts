/**
 * VERALUZ — revoke-employee-sessions — v3 (AUTH-R2B1.2)
 *
 * Changements v3 :
 * - Révocation globale désormais ATOMIQUE via RPC PostgreSQL
 *   `veraluz_revoke_employee_sessions` (SECURITY DEFINER, service_role only).
 * - Plus de double UPDATE séquentiel depuis l'EF : si l'étape sessions
 *   réussissait mais resumes échouait, on renvoyait ok:true avec un état
 *   partiellement révoqué. Ce comportement est éliminé.
 * - La RPC roule sessions + resumes dans un bloc PL/pgSQL avec EXCEPTION
 *   handler → ROLLBACK des deux si l'une échoue → jamais ok:true partiel.
 * - UUID validation côté EF avant appel RPC.
 * - employee_id cible validé UUID + jamais fait confiance seul (caller toujours
 *   authentifié par session serveur avant).
 *
 * POST body : { session_token: string, employee_id: string (UUID) }
 * Réponse   : { ok: true, revoked_sessions: N, revoked_resumes: M }
 *
 * Autorisation : rôle gérant / admin / superadmin uniquement.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];
const DIRECTION_ROLES = ['gerant', 'admin', 'superadmin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(b: unknown, s: number, o: string | null) {
  return new Response(JSON.stringify(b),
    { status: s, headers: { ...cors(o), 'Content-Type': 'application/json' } });
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'forbidden_origin' }, 403, origin);

  let body: { session_token?: string; employee_id?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, 400, origin); }

  const token    = String(body.session_token || '');
  const targetId = String(body.employee_id   || '').trim();

  if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: 'unauthorized' }, 401, origin);
  if (!targetId)                       return json({ ok: false, error: 'employee_id_required' }, 400, origin);
  if (!UUID_RE.test(targetId))         return json({ ok: false, error: 'invalid_employee_id' }, 400, origin);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const now = new Date().toISOString();
  const callerHash = await sha256Hex(token);

  // 1. Authentifier le caller
  const { data: sessList, error: sErr } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', callerHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .limit(1);

  if (sErr) {
    console.error('[revoke-sessions] session_lookup code=', sErr.code);
    return json({ ok: false, error: 'server_error' }, 500, origin);
  }
  if (!sessList || sessList.length === 0) return json({ ok: false, error: 'unauthorized' }, 401, origin);

  const callerId = sessList[0].employee_id as string;

  // 2. Vérifier le rôle du caller — status IN ('actif','active') bilingue
  const { data: callerList, error: ceErr } = await admin
    .from('veraluz_employees')
    .select('id, role, status')
    .eq('id', callerId)
    .in('status', ['actif', 'active'])
    .limit(1);

  if (ceErr) {
    console.error('[revoke-sessions] caller_lookup code=', ceErr.code);
    return json({ ok: false, error: 'server_error' }, 500, origin);
  }
  const caller = callerList && callerList[0];
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401, origin);

  if (!DIRECTION_ROLES.includes(String(caller.role || ''))) {
    await admin.from('veraluz_auth_events').insert({
      event_type: 'session_revoke_denied', employee_id: targetId,
      performed_by: callerId, performed_by_role: caller.role,
      success: false, details_json: { reason: 'insufficient_role' },
    });
    return json({ ok: false, error: 'forbidden' }, 403, origin);
  }

  // 3. Révocation atomique via RPC PostgreSQL
  //    sessions + resume_tokens révoqués dans une seule transaction PL/pgSQL.
  //    Si l'une des deux UPDATE échoue → ROLLBACK total → jamais ok:true partiel.
  const { data: rpc, error: rpcErr } = await admin.rpc('veraluz_revoke_employee_sessions', {
    p_target_employee_id: targetId,
  });

  if (rpcErr || !rpc?.ok) {
    const errCode = rpcErr?.code || rpc?.error || 'server_error';
    console.error('[revoke-sessions] rpc_revoke err=', errCode);
    return json({ ok: false, error: 'server_error' }, 500, origin);
  }

  // 4. Journaliser l'événement audit (hors transaction : non critique)
  await admin.from('veraluz_auth_events').insert({
    event_type: 'sessions_revoked',
    employee_id: targetId,
    performed_by: callerId,
    performed_by_role: caller.role,
    success: true,
    details_json: {
      revoked_sessions: rpc.revoked_sessions,
      revoked_resumes:  rpc.revoked_resumes,
    },
  });

  return json({
    ok: true,
    revoked_sessions: rpc.revoked_sessions,
    revoked_resumes:  rpc.revoked_resumes,
  }, 200, origin);
});
