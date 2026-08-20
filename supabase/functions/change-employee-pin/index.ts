/**
 * VERALUZ — change-employee-pin — v4 (PROMPT 009 : ajout journalisation §13)
 *
 * POST { current_pin, new_pin } -> { ok:true }  (session_token via X-Veraluz-Session header)
 *
 * Logique inchangee par rapport a la v3 (deja correcte) :
 *  - employee_id deduit de la session, jamais du corps ;
 *  - verification bcrypt via veraluz_verify_employee_pin ;
 *  - ecriture bcrypt dans veraluz_employee_auth_secrets uniquement ;
 *  - pin_code jamais ecrit ;
 *  - TOUTES les sessions de l'employe revoquees apres changement (politique documentee,
 *    conservee — §16 du prompt 009 : demande une reconnexion apres succes).
 * Ajout v4 : journalisation dans veraluz_auth_events (jamais le PIN, jamais un hash).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
]
function cors(origin: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-veraluz-session',
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

const WEAK = ['000000','111111','222222','333333','444444','555555','666666',
              '777777','888888','999999','123456','654321','012345','123123','111222']

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin)

  // Session token: X-Veraluz-Session header (contrat canonique CORE→EF)
  const token = (req.headers.get('x-veraluz-session') || '').trim()
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ ok: false, error: 'unauthorized' }, 401, origin)

  let body: { current_pin?: string; new_pin?: string }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400, origin) }

  const currentPin = String(body.current_pin || '')
  const newPin = String(body.new_pin || '')
  if (!/^\d{6}$/.test(newPin))       return json({ ok: false, error: 'new_pin_must_be_6_digits' }, 400, origin)
  if (WEAK.includes(newPin))         return json({ ok: false, error: 'weak_pin' }, 400, origin)
  if (newPin === currentPin)         return json({ ok: false, error: 'new_pin_same_as_current' }, 400, origin)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: sess, error: sErr } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', await sha256Hex(token))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)

  if (sErr) { console.error('[change-pin] session_lookup_failed code=', sErr.code)
              return json({ ok: false, error: 'server_error' }, 500, origin) }
  if (!sess || sess.length === 0) return json({ ok: false, error: 'unauthorized' }, 401, origin)

  const employeeId = sess[0].employee_id as string

  const { data: chk, error: cErr } = await admin.rpc('veraluz_verify_employee_pin', {
    p_employee_id: employeeId, p_pin: currentPin,
  })
  if (cErr) { console.error('[change-pin] verify_failed code=', cErr.code)
              return json({ ok: false, error: 'server_error' }, 500, origin) }
  const v = chk as { ok: boolean; error?: string }
  if (!v || !v.ok) {
    await admin.from('veraluz_auth_events').insert({
      event_type: 'pin_change_failed', employee_id: employeeId, performed_by: employeeId,
      success: false, details_json: { reason: v?.error || 'invalid_current_pin' },
    })
    return json({ ok: false, error: v?.error || 'invalid_credentials' }, 401, origin)
  }

  const { error: uErr } = await admin.rpc('veraluz_set_employee_pin', {
    p_employee_id: employeeId, p_new_pin: newPin,
  })
  if (uErr) { console.error('[change-pin] set_pin_failed code=', uErr.code)
              return json({ ok: false, error: 'update_failed' }, 500, origin) }

  const { error: rErr } = await admin.from('veraluz_employee_sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'pin_changed' })
    .eq('employee_id', employeeId).is('revoked_at', null)
  if (rErr) console.error('[change-pin] revoke_failed code=', rErr.code)

  await admin.from('veraluz_auth_events').insert({
    event_type: 'pin_changed_voluntary', employee_id: employeeId, performed_by: employeeId,
    success: true, details_json: {},
  })

  return json({ ok: true, message: 'PIN change. Reconnectez-vous.' }, 200, origin)
})
