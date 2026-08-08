/**
 * VERALUZ — get-employee-access-status — v1 (PROMPT 009, §10)
 *
 * POST { session_token, employee_id } -> { ok:true, status:{...} }
 *
 * Fournit au bloc « Gestion des accès » de la fiche employé RH (openDossier)
 * des metadonnees de securite SANS JAMAIS exposer pin_hash, session token_hash,
 * ou tout autre secret. Reserve a la Direction (meme modele d'autorisation que
 * reset-employee-pin / revoke-employee-sessions : session_token valide, role
 * derive cote serveur).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
]
const DIRECTION_ROLES = ['gerant', 'admin', 'superadmin']

function cors(origin: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
function json(b: unknown, s: number, o: string | null) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), 'Content-Type': 'application/json' } })
}
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin)
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'forbidden_origin' }, 403, origin)

  let body: { session_token?: string; employee_id?: string }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400, origin) }

  const token = String(body.session_token || '')
  const targetId = String(body.employee_id || '').trim()
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: 'unauthorized' }, 401, origin)
  if (!targetId) return json({ ok: false, error: 'employee_id_required' }, 400, origin)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const callerTokenHash = await sha256Hex(token)
  const { data: sess, error: sErr } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', callerTokenHash).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).limit(1)
  if (sErr) { console.error('[access-status] session_lookup_failed code=', sErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  if (!sess || sess.length === 0) return json({ ok: false, error: 'unauthorized' }, 401, origin)
  const callerId = sess[0].employee_id as string

  const { data: callerEmp, error: ceErr } = await admin
    .from('veraluz_employees').select('id, role, status').eq('id', callerId).limit(1)
  if (ceErr) { console.error('[access-status] caller_lookup_failed code=', ceErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  const caller = callerEmp && callerEmp[0]
  if (!caller || !['actif', 'active'].includes(String(caller.status))) return json({ ok: false, error: 'unauthorized' }, 401, origin)
  if (!DIRECTION_ROLES.includes(String(caller.role || ''))) return json({ ok: false, error: 'forbidden' }, 403, origin)

  const { data: targetEmp, error: teErr } = await admin
    .from('veraluz_employees').select('id, status, failed_pin_attempts, pin_locked_until').eq('id', targetId).limit(1)
  if (teErr) { console.error('[access-status] target_lookup_failed code=', teErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  if (!targetEmp || targetEmp.length === 0) return json({ ok: false, error: 'employee_not_found' }, 404, origin)
  const target = targetEmp[0]

  const { data: secrets } = await admin
    .from('veraluz_employee_auth_secrets')
    .select('must_change_pin, temporary_pin_expires_at, pin_status, last_reset_at, pin_updated_at')
    .eq('employee_id', targetId).limit(1)
  const sec = (secrets && secrets[0]) || null

  const { data: activeSessions, error: asErr } = await admin
    .from('veraluz_employee_sessions')
    .select('id, created_at, last_seen_at, expires_at')
    .eq('employee_id', targetId).is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false, nullsFirst: false })
  if (asErr) console.error('[access-status] sessions_lookup_failed code=', asErr.code)
  const sessions = activeSessions || []

  return json({
    ok: true,
    status: {
      account_status:            target.status,
      account_locked:            !!(target.pin_locked_until && new Date(target.pin_locked_until as string) > new Date()),
      failed_pin_attempts:       target.failed_pin_attempts || 0,
      must_change_pin:           !!(sec && sec.must_change_pin),
      temporary_pin_expires_at:  sec ? sec.temporary_pin_expires_at : null,
      pin_status:                sec ? sec.pin_status : 'unknown',
      last_reset_at:             sec ? sec.last_reset_at : null,
      last_pin_updated_at:       sec ? sec.pin_updated_at : null,
      active_sessions_count:     sessions.length,
      last_connection_at:        sessions.length > 0 ? (sessions[0].last_seen_at || sessions[0].created_at) : null,
    },
  }, 200, origin)
})
