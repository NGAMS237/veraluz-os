/**
 * VERALUZ — complete-forced-pin-change — v1 (PROMPT 009, §7-8)
 *
 * POST { change_token, new_pin } -> { ok:true, session_token, session_expiry, employee }
 *
 * Seul endpoint qui accepte un change_token (emis par verify-employee-pin quand
 * must_change_pin=true). Le change_token :
 *  - est a usage unique (marque used_at des la premiere utilisation reussie) ;
 *  - expire en 15 minutes ;
 *  - n'est JAMAIS accepte par un autre endpoint (aucun autre endpoint ne consulte
 *    veraluz_employee_change_tokens).
 * Une fois le nouveau PIN valide et enregistre (bcrypt, must_change_pin=false), une
 * VRAIE session CORE normale est creee — c'est la seule facon d'obtenir un session_token
 * a partir d'un change_token.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
]
const WEAK = ['000000','111111','222222','333333','444444','555555','666666',
              '777777','888888','999999','123456','654321','012345','123123','111222']

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
function newToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin)
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'forbidden_origin' }, 403, origin)

  let body: { change_token?: string; new_pin?: string }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400, origin) }

  const changeToken = String(body.change_token || '')
  const newPin = String(body.new_pin || '')

  if (!/^[0-9a-f]{64}$/.test(changeToken)) return json({ ok: false, error: 'invalid_change_token' }, 401, origin)
  if (!/^\d{6}$/.test(newPin)) return json({ ok: false, error: 'new_pin_must_be_6_digits' }, 400, origin)
  if (WEAK.includes(newPin)) return json({ ok: false, error: 'weak_pin' }, 400, origin)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  /* 1. change_token valide, non expire, non deja utilise. */
  const tokenHash = await sha256Hex(changeToken)
  const { data: ct, error: ctErr } = await admin
    .from('veraluz_employee_change_tokens')
    .select('id, employee_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .limit(1)
  if (ctErr) { console.error('[complete-pin-change] token_lookup_failed code=', ctErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  const row = ct && ct[0]
  if (!row) return json({ ok: false, error: 'invalid_change_token' }, 401, origin)
  if (row.used_at) return json({ ok: false, error: 'change_token_already_used' }, 401, origin)
  if (new Date(row.expires_at as string) < new Date()) return json({ ok: false, error: 'change_token_expired' }, 401, origin)

  const employeeId = row.employee_id as string

  /* 2. Enregistrer le nouveau PIN (bcrypt, remet must_change_pin=false cote RPC existante). */
  const { data: setRes, error: setErr } = await admin.rpc('veraluz_set_employee_pin', {
    p_employee_id: employeeId, p_new_pin: newPin,
  })
  if (setErr) { console.error('[complete-pin-change] set_pin_failed code=', setErr.code); return json({ ok: false, error: 'update_failed' }, 500, origin) }
  const setOk = setRes as { ok: boolean; error?: string }
  if (!setOk || !setOk.ok) return json({ ok: false, error: setOk?.error || 'update_failed' }, 400, origin)

  /* 3. Marquer le change_token comme utilise (usage unique — jamais reutilisable). */
  const { error: markErr } = await admin.from('veraluz_employee_change_tokens')
    .update({ used_at: new Date().toISOString() }).eq('id', row.id)
  if (markErr) console.error('[complete-pin-change] mark_used_failed code=', markErr.code)

  /* 4. Creer la VRAIE session CORE — seul chemin pour transformer un change_token en session. */
  const { data: empRows, error: empErr } = await admin
    .from('veraluz_employees')
    .select('id, full_name, role, status, department, team_id, public_display_name')
    .eq('id', employeeId).limit(1)
  if (empErr || !empRows || empRows.length === 0) {
    console.error('[complete-pin-change] employee_lookup_failed');
    return json({ ok: false, error: 'server_error' }, 500, origin)
  }
  const emp = empRows[0]

  const sessionToken = newToken()
  const sessionHash = await sha256Hex(sessionToken)
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)
  const { error: sessErr } = await admin.from('veraluz_employee_sessions').insert({
    employee_id: employeeId, token_hash: sessionHash,
    expires_at: expiresAt.toISOString(), last_seen_at: new Date().toISOString(),
  })
  if (sessErr) { console.error('[complete-pin-change] session_insert_failed code=', sessErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }

  await admin.from('veraluz_auth_events').insert({
    event_type: 'forced_pin_change_completed', employee_id: employeeId, success: true, details_json: {},
  })

  return json({
    ok: true,
    session_token: sessionToken,
    session_expiry: expiresAt.toISOString(),
    employee: { ...emp, session_expiry_ts: expiresAt.getTime() },
  }, 200, origin)
})
