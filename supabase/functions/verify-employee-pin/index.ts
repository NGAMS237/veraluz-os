/**
 * VERALUZ — verify-employee-pin — v7 (AUTH-SECURITY-FINAL)
 *
 * Nouveautés v7 :
 * - Session lifetime lue depuis veraluz_settings.security.session_lifetime_hours (fallback 12h)
 * - IP capturée depuis x-forwarded-for / cf-connecting-ip (jamais du body)
 * - User-Agent capturé depuis req.headers
 * - track_ip / track_user_agent respectés depuis security settings
 * - session_token SUPPRIMÉ du body — auth via X-Veraluz-Session header uniquement
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

/** IP côté serveur uniquement — jamais acceptée depuis le body */
function getClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim().slice(0, 45)
  return req.headers.get('cf-connecting-ip')?.trim().slice(0, 45) ?? null
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

  // Lire les security settings depuis SSOT veraluz_settings
  const { data: settingsRow } = await admin
    .from('veraluz_settings')
    .select('value')
    .eq('key', 'security')
    .maybeSingle()
  const sec = (settingsRow?.value || {}) as Record<string, unknown>
  const sessionLifetimeHours = Number(sec.session_lifetime_hours) || 12
  const trackIp              = sec.track_ip !== false
  const trackUa              = sec.track_user_agent !== false

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
    const changeExpiresAt = new Date(Date.now() + 15 * 60 * 1000)

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
      change_token: changeToken,
      change_token_expires_at: changeExpiresAt.toISOString(),
    }, 200, origin)
  }

  /* ── Cas B : PIN permanent normal — session CORE complète. ── */
  const token = newToken()
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + sessionLifetimeHours * 60 * 60 * 1000)

  // IP et UA depuis les headers réseau (jamais du body)
  const clientIp  = trackIp ? getClientIp(req) : null
  const userAgent = trackUa ? (req.headers.get('user-agent')?.slice(0, 255) ?? null) : null

  const { error: sErr } = await admin.from('veraluz_employee_sessions').insert({
    employee_id:  employeeId,
    token_hash:   tokenHash,
    expires_at:   expiresAt.toISOString(),
    last_seen_at: new Date().toISOString(),
    created_ip:   clientIp,
    last_ip:      clientIp,
    user_agent:   userAgent,
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
    session_token: token,
    session_expiry: expiresAt.toISOString(),
    must_change_pin: false,
  }, 200, origin)
})
