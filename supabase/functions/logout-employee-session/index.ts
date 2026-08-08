/**
 * VERALUZ — logout-employee-session — v2 (PROMPT 009 : ajout journalisation §13)
 * POST { session_token } -> { ok:true }
 * Revoque la session. Reponse volontairement identique que le jeton existe ou non.
 * Le jeton n'est jamais journalise.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
]
function cors(origin: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }),
      { status: 405, headers: { ...cors(origin), 'Content-Type': 'application/json' } })

  let token = ''
  try { const b = await req.json(); token = String(b.session_token || '') } catch { /* ignore */ }

  if (/^[0-9a-f]{64}$/.test(token)) {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const tokenHash = await sha256Hex(token)
    const { data: sess } = await admin.from('veraluz_employee_sessions')
      .select('employee_id').eq('token_hash', tokenHash).is('revoked_at', null).limit(1)
    const { error } = await admin.from('veraluz_employee_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'logout' })
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
    if (error) console.error('[logout] revoke_failed code=', error.code)
    else if (sess && sess[0]) {
      await admin.from('veraluz_auth_events').insert({
        event_type: 'logout', employee_id: sess[0].employee_id, performed_by: sess[0].employee_id,
        success: true, details_json: {},
      })
    }
  }

  /* Toujours 200 : ne pas reveler l'existence d'un jeton. */
  return new Response(JSON.stringify({ ok: true }),
    { status: 200, headers: { ...cors(origin), 'Content-Type': 'application/json' } })
})
