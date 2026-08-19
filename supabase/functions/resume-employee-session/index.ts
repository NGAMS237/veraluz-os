/**
 * VERALUZ — resume-employee-session — v2 (AUTH-R2B1)
 *
 * Changements v2 :
 * - status IN ('actif','active') : compatibilité bilingue (fix Bug 1)
 * - CORS élargi : content-type + authorization + apikey (CORE envoie ces 3 headers)
 * - Atomicité rotation : INSERT nouveau resume_token AVANT de révoquer l'ancien
 * - last_used_at + rotated_at écrits sur le token sortant
 * - Identité retournée fraîche depuis DB
 * - department + public_display_name + resume_expires_at dans la réponse
 *
 * POST body : { resume_token: string }
 * Réponse   : { session_token, resume_token, employee_id, role, full_name,
 *               department, public_display_name, expires_at, resume_expires_at }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
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

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(bytes = 48): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden_origin' }, 403, origin);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: { resume_token?: string };
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400, origin); }

  const rawToken = body?.resume_token;
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 64) {
    return json({ error: 'invalid_token' }, 400, origin);
  }

  const hash = await sha256hex(rawToken);
  const now  = new Date().toISOString();

  // 1. Valider le resume_token
  const { data: rt, error: rtErr } = await sb
    .from('veraluz_resume_tokens')
    .select('id, employee_id, expires_at')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();

  if (rtErr || !rt) return json({ error: 'token_invalid_or_expired' }, 401, origin);

  // 2. Vérifier l'employe — IN ('actif','active') pour compatibilite bilingue
  const { data: emp, error: empErr } = await sb
    .from('veraluz_employees')
    .select('id, full_name, role, status, department, public_display_name')
    .eq('id', rt.employee_id)
    .in('status', ['actif', 'active'])
    .maybeSingle();

  if (empErr || !emp) return json({ error: 'employee_inactive' }, 403, origin);

  // 3. Preparer nouveaux credentials
  const newRawResume  = generateToken(48);
  const newResumeHash = await sha256hex(newRawResume);
  const resumeExpiry  = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const deviceHint    = req.headers.get('user-agent')?.slice(0, 120) ?? null;

  const sessionRaw    = generateToken(32);
  const sessionHash   = await sha256hex(sessionRaw);
  const sessionExpiry = new Date(Date.now() + 8 * 3600 * 1000).toISOString();

  // 4. ATOMICITE : INSERT nouveau resume_token EN PREMIER
  // Si INSERT echoue -> ancien token intact -> utilisateur peut reessayer
  // Si revoke echoue -> 2 tokens valides brievement (acceptable, rotation au prochain usage)
  // Si INSERT session echoue -> rollback nouveau resume, retour 500 -> utilisateur reessaie
  const { error: insertResumeErr } = await sb.from('veraluz_resume_tokens').insert({
    employee_id: rt.employee_id,
    token_hash:  newResumeHash,
    device_hint: deviceHint,
    expires_at:  resumeExpiry,
  });

  if (insertResumeErr) {
    console.error('[resume-session] new_resume_insert_failed code=', insertResumeErr.code);
    return json({ error: 'server_error' }, 500, origin);
  }

  // 5. Revoquer l'ancien resume_token (apres succes INSERT)
  await sb.from('veraluz_resume_tokens')
    .update({ revoked_at: now, revoked_reason: 'rotated', rotated_at: now, last_used_at: now })
    .eq('id', rt.id);

  // 6. Creer la nouvelle employee_session
  const { error: sessErr } = await sb.from('veraluz_employee_sessions').insert({
    employee_id:  rt.employee_id,
    token_hash:   sessionHash,
    expires_at:   sessionExpiry,
    last_seen_at: now,
  });

  if (sessErr) {
    console.error('[resume-session] session_insert_failed code=', sessErr.code);
    // Rollback du nouveau resume_token
    await sb.from('veraluz_resume_tokens')
      .update({ revoked_at: now, revoked_reason: 'session_create_failed' })
      .eq('token_hash', newResumeHash);
    return json({ error: 'server_error' }, 500, origin);
  }

  return json({
    session_token:       sessionRaw,    // garder UNIQUEMENT en memoire cote client
    resume_token:        newRawResume,  // stocker dans localStorage (opaque)
    employee_id:         emp.id,
    role:                emp.role,
    full_name:           emp.full_name,
    department:          emp.department ?? '',
    public_display_name: emp.public_display_name ?? emp.full_name,
    expires_at:          sessionExpiry,
    resume_expires_at:   resumeExpiry,
  }, 200, origin);
});
