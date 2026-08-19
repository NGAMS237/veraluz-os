/**
 * VERALUZ — issue-resume-token — v2 (AUTH-R2B1)
 *
 * Changements v2 :
 * - Multi-appareil : ne revoque PLUS les resume_tokens existants des autres
 *   appareils/sessions. Chaque appareil possede son propre resume credential.
 *   Avant v1 : login sur telephone revoquait le resume du PC.
 *   Apres v2  : chaque login ajoute un credential independant.
 *               Chaque logout ne revoque que le sien (logout-employee-session v3).
 *               La revocation globale reste dans revoke-employee-sessions v2.
 * - CORS elargi : apikey + Authorization pour coherence avec les autres EF Auth.
 *
 * POST body : { session_token: string }
 * Reponse   : { resume_token, expires_at }
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

  let body: { session_token?: string };
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400, origin); }

  const sessionRaw = body?.session_token;
  if (!sessionRaw || typeof sessionRaw !== 'string') {
    return json({ error: 'session_token required' }, 400, origin);
  }

  // 1. Valider la session
  const hash = await sha256hex(sessionRaw);
  const now  = new Date().toISOString();

  const { data: sess } = await sb
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();

  if (!sess) return json({ error: 'invalid_session' }, 401, origin);

  // 2. Emettre un nouveau resume_token pour cet appareil/session
  //    Multi-appareil : on N'efface PAS les autres resume_tokens de l'employe.
  const resumeRaw  = generateToken(48);
  const resumeHash = await sha256hex(resumeRaw);
  const expiresAt  = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const deviceHint = req.headers.get('user-agent')?.slice(0, 120) ?? null;

  const { error: insertErr } = await sb.from('veraluz_resume_tokens').insert({
    employee_id: sess.employee_id,
    token_hash:  resumeHash,
    device_hint: deviceHint,
    expires_at:  expiresAt,
  });

  if (insertErr) {
    console.error('[issue-resume] insert_failed code=', insertErr.code);
    return json({ error: 'server_error' }, 500, origin);
  }

  return json({
    resume_token: resumeRaw,  // stocker dans localStorage uniquement
    expires_at:   expiresAt,
  }, 200, origin);
});
