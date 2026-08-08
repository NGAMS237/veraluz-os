/**
 * VERALUZ — verify-employee-pin — v6 (PROMPT 009)
 *
 * POST { employee_id, pin }
 * -> si must_change_pin=false : { ok:true, employee, session_token, session_expiry, must_change_pin:false }
 * -> si must_change_pin=true  : { ok:true, auth_state:'must_change_pin', employee:{id,display_name},
 *                                  change_token, change_token_expires_at, must_change_pin:true }
 *    AUCUNE session CORE n'est creee dans ce cas — change_token est a portee strictement
 *    limitee au endpoint complete-forced-pin-change (aucun autre endpoint ne le reconnait).
 * | { ok:false, error }
 *
 * Regles inchangees par rapport a la v5 : verification bcrypt deleguee a
 * veraluz_verify_employee_pin, aucun repli vers pin_code, CORS restreint, rien de
 * sensible journalise.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
]

function corsHeaders(origin: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function newToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin)
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'forbidden_origin' }, 403, origin)

  let body: { employee_id?: string; pin?: string }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400, origin) }

  const employeeId = String(body.employee_id || '').trim()
  const pin = String(body.pin || '').trim()
  if (!employeeId || !pin) return json({ ok: false, error: 'missing_fields' }, 400, origin)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data, error } = await admin.rpc('veraluz_verify_employee_pin', {
    p_employee_id: employeeId, p_pin: pin,
  })

  if (error) {
    console.error('[verify-pin] rpc_failed code=', error.code)
    return json({ ok: false, error: 'server_error' }, 500, origin)
  }

  const res = data as { ok: boolean; error?: string; employee?: Record<string, unknown>; must_change_pin?: boolean }

  if (!res || !res.ok) {
    const code = res?.error || 'invalid_credentials'
    const status = code === 'too_many_attempts' ? 429 : 401
    /* Journaliser l'echec — jamais le PIN. */
    await admin.from('veraluz_auth_events').insert({
      event_type: 'login_failed', employee_id: employeeId, success: false,
      details_json: { error: code },
    })
    return json({ ok: false, error: code }, status, origin)
  }

  /* ── Cas A : PIN provisoire — auth_state=must_change_pin, JAMAIS de session CORE. ── */
  if (res.must_change_pin === true) {
    const changeToken = newToken()
    const changeTokenHash = await sha256Hex(changeToken)
    const changeExpiresAt = new Date(Date.now() + 15 * 60 * 1000) /* 15 min — courte duree, usage unique */

    const { error: ctErr } = await admin.from('veraluz_employee_change_tokens').insert({
      employee_id: employeeId, token_hash: changeTokenHash, expires_at: changeExpiresAt.toISOString(),
    })
    if (ctErr) {
      console.error('[verify-pin] change_token_insert_failed code=', ctErr.code)
      return json({ ok: false, error: 'server_error' }, 500, origin)
    }

    await admin.from('veraluz_auth_events').insert({
      event_type: 'login_must_change_pin', employee_id: employeeId, success: true, details_json: {},
    })

    const emp = res.employee || {}
    return json({
      ok: true,
      auth_state: 'must_change_pin',
      must_change_pin: true,
      employee: {
        id: emp.id, employee_id: emp.id,
        full_name: emp.full_name, public_display_name: emp.public_display_name,
        role: emp.role, department: emp.department,
      },
      change_token: changeToken,                 // retourne UNE SEULE FOIS
      change_token_expires_at: changeExpiresAt.toISOString(),
    }, 200, origin)
  }

  /* ── Cas B : PIN permanent normal — session CORE complete, comportement existant. ── */
  const token = newToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)

  const { error: sErr } = await admin.from('veraluz_employee_sessions').insert({
    employee_id: employeeId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    last_seen_at: new Date().toISOString(),
  })

  if (sErr) {
    console.error('[verify-pin] session_insert_failed code=', sErr.code)
    return json({ ok: false, error: 'server_error' }, 500, origin)
  }

  await admin.from('veraluz_auth_events').insert({
    event_type: 'login_success', employee_id: employeeId, success: true, details_json: {},
  })

  const emp = { ...(res.employee || {}), session_expiry_ts: expiresAt.getTime() }

  return json({
    ok: true,
    auth_state: 'ok',
    employee: emp,
    session_token: token,                    // retourne UNE SEULE FOIS
    session_expiry: expiresAt.toISOString(),
    must_change_pin: false,
  }, 200, origin)
})
