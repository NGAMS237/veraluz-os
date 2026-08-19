/**
 * VERALUZ — reset-employee-pin — v6 (AUTH-R3A)
 *
 * POST { session_token, employee_id } -> { ok:true, temporary_pin, expires_at, must_change_pin:true }
 *
 * v6 vs v5 : étape 4 (révocation) utilise désormais veraluz_revoke_employee_sessions(text)
 * qui révoque ATOMIQUEMENT sessions + resume_tokens en une seule transaction PL/pgSQL.
 * La v5 ne révoquait que veraluz_employee_sessions (oubli resume_tokens → vecteur de
 * réauthentification silencieuse post-reset). Zéro autre changement de comportement.
 *
 * Contrat de sécurité inchangé :
 *  - session Direction VALIDE requise (rôle dérivé côté serveur, jamais du corps) ;
 *  - PIN 6 chiffres cryptographiquement sûr (crypto.getRandomValues) ;
 *  - stockage bcrypt uniquement via RPC veraluz_reset_employee_pin ;
 *  - retourne le PIN en clair UNE SEULE FOIS, jamais journalisé, jamais relisible ;
 *  - aucun PIN partagé, aucun PIN hardcodé, aucun plaintext persisté DB/localStorage/log.
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
/** PIN 6 chiffres cryptographiquement sûr, jamais Math.random(). */
function generateSecurePin(): string {
  const bytes = new Uint32Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => (b % 10).toString()).join('')
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

  /* 1. Session appelante valide → employee_id + role (JAMAIS depuis le corps). */
  const callerTokenHash = await sha256Hex(token)
  const { data: sess, error: sErr } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', callerTokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  if (sErr) { console.error('[reset-pin] session_lookup_failed code=', sErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  if (!sess || sess.length === 0) return json({ ok: false, error: 'unauthorized' }, 401, origin)
  const callerId = sess[0].employee_id as string

  const { data: callerEmp, error: ceErr } = await admin
    .from('veraluz_employees').select('id, role, status').eq('id', callerId).limit(1)
  if (ceErr) { console.error('[reset-pin] caller_lookup_failed code=', ceErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  const caller = callerEmp && callerEmp[0]
  if (!caller || !['actif', 'active'].includes(String(caller.status))) return json({ ok: false, error: 'unauthorized' }, 401, origin)

  const callerRole = String(caller.role || '')
  if (!DIRECTION_ROLES.includes(callerRole)) {
    await admin.from('veraluz_auth_events').insert({
      event_type: 'pin_reset_denied', employee_id: targetId,
      performed_by: callerId, performed_by_role: callerRole, success: false,
      details_json: { reason: 'insufficient_role' },
    })
    return json({ ok: false, error: 'forbidden' }, 403, origin)
  }

  /* 2. Cible existe et est active. */
  const { data: targetEmp, error: teErr } = await admin
    .from('veraluz_employees').select('id, status').eq('id', targetId).limit(1)
  if (teErr) { console.error('[reset-pin] target_lookup_failed code=', teErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  if (!targetEmp || targetEmp.length === 0) return json({ ok: false, error: 'employee_not_found' }, 404, origin)

  /* 3. Générer le PIN côté serveur et l'écrire (bcrypt uniquement). */
  const tempPin = generateSecurePin()
  const { data: rpcRes, error: rpcErr } = await admin.rpc('veraluz_reset_employee_pin', {
    p_employee_id: targetId, p_new_pin: tempPin, p_reset_by: callerId,
  })
  if (rpcErr) { console.error('[reset-pin] rpc_failed code=', rpcErr.code); return json({ ok: false, error: 'server_error' }, 500, origin) }
  const rpc = rpcRes as { ok: boolean; error?: string }
  if (!rpc || !rpc.ok) return json({ ok: false, error: rpc?.error || 'reset_failed' }, 400, origin)

  /* 4. Révoquer TOUTES les sessions + resume_tokens existants de la cible — ATOMIQUE via RPC.
   *    v6 : veraluz_revoke_employee_sessions revoque sessions ET resume_tokens en une seule
   *    transaction PL/pgSQL (AUTH-R2B1.2). La v5 ne révoquait que les sessions, laissant les
   *    resume_tokens actifs (vecteur de réauthentification silencieuse post-reset). */
  const { data: revokeRes, error: revErr } = await admin.rpc('veraluz_revoke_employee_sessions', {
    p_target_employee_id: targetId,
  })
  if (revErr) {
    console.error('[reset-pin] revoke_rpc_failed code=', revErr.code)
    /* Non-bloquant : le PIN a déjà été réinitialisé ; journaliser l'échec de révocation. */
  }
  const revoke = revokeRes as { ok: boolean; revoked_sessions?: number; revoked_resumes?: number } | null
  if (!revoke?.ok) console.error('[reset-pin] revoke_rpc_returned_not_ok', revokeRes)

  /* 5. Journaliser (jamais le PIN, jamais un hash). */
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await admin.from('veraluz_auth_events').insert({
    event_type: 'pin_reset', employee_id: targetId,
    performed_by: callerId, performed_by_role: callerRole, success: true,
    details_json: {
      temporary_pin_expires_at: expiresAt.toISOString(),
      revoked_sessions: revoke?.revoked_sessions ?? null,
      revoked_resumes: revoke?.revoked_resumes ?? null,
    },
  })

  /* 6. Retourner le PIN en clair — UNE SEULE FOIS. Jamais journalisé, jamais relisible. */
  return json({
    ok: true,
    temporary_pin: tempPin,
    expires_at: expiresAt.toISOString(),
    must_change_pin: true,
  }, 200, origin)
})
