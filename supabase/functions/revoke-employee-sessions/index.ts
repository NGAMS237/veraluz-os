/**
 * VERALUZ — revoke-employee-sessions — v1 (PROMPT 009, §10)
 *
 * POST { session_token, employee_id } -> { ok:true, revoked_count }
 *
 * Action Direction independante du reset PIN : revoquer les sessions actives d'un
 * employe sans forcement generer un nouveau PIN provisoire. Meme modele
 * d'autorisation que reset-employee-pin (session Direction valide, role derive
 * cote serveur, jamais du client).
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
  if (sErr) { console.error('[revoke-sessions] session_lookup_failed code=', sErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  if (!sess || sess.length === 0) return json({ ok: false, error: 'unauthorized' }, 401, origin)
  const callerId = sess[0].employee_id as string

  const { data: callerEmp, error: ceErr } = await admin
    .from('veraluz_employees').select('id, role, status').eq('id', callerId).limit(1)
  if (ceErr) { console.error('[revoke-sessions] caller_lookup_failed code=', ceErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  const caller = callerEmp && callerEmp[0]
  if (!caller || !['actif', 'active'].includes(String(caller.status))) return json({ ok: false, error: 'unauthorized' }, 401, origin)
  const callerRole = String(caller.role || '')

  if (!DIRECTION_ROLES.includes(callerRole)) {
    await admin.from('veraluz_auth_events').insert({
      event_type: 'session_revoke_denied', employee_id: targetId,
      performed_by: callerId, performed_by_role: callerRole, success: false,
      details_json: { reason: 'insufficient_role' },
    })
    return json({ ok: false, error: 'forbidden' }, 403, origin)
  }

  const { data: revoked, error: revErr } = await admin.from('veraluz_employee_sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'admin_revoke' })
    .eq('employee_id', targetId).is('revoked_at', null)
    .select('id')
  if (revErr) { console.error('[revoke-sessions] revoke_failed code=', revErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }

  await admin.from('veraluz_auth_events').insert({
    event_type: 'sessions_revoked', employee_id: targetId,
    performed_by: callerId, performed_by_role: callerRole, success: true,
    details_json: { revoked_count: (revoked || []).length },
  })

  return json({ ok: true, revoked_count: (revoked || []).length }, 200, origin)
})
