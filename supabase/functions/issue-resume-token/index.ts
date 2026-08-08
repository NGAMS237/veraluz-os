/**
 * issue-resume-token v1
 * Appelé après login réussi. Valide le session_token, crée un resume_token
 * opaque et le retourne. Le client stocke UNIQUEMENT ce token dans localStorage.
 * Le session_token lui-même ne quitte jamais la mémoire côté client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization,apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function generateToken(bytes = 48): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { session_token?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: CORS }); }

  const sessionRaw = body?.session_token;
  if (!sessionRaw) return new Response(JSON.stringify({ error: 'session_token required' }), { status: 400, headers: CORS });

  // Valider la session
  const hash = await sha256hex(sessionRaw);
  const now  = new Date().toISOString();
  const { data: sess } = await sb
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();

  if (!sess) return new Response(JSON.stringify({ error: 'invalid_session' }), { status: 401, headers: CORS });

  // Révoquer tout resume_token actif pour cet employé (une seule session de reprise)
  await sb.from('veraluz_resume_tokens')
    .update({ revoked_at: now, revoked_reason: 'new_login' })
    .eq('employee_id', sess.employee_id)
    .is('revoked_at', null);

  // Créer le nouveau resume_token
  const resumeRaw = generateToken(48);
  const resumeHash = await sha256hex(resumeRaw);
  const expires_at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const deviceHint = req.headers.get('user-agent')?.slice(0, 120) ?? null;

  await sb.from('veraluz_resume_tokens').insert({
    employee_id: sess.employee_id,
    token_hash:  resumeHash,
    device_hint: deviceHint,
    expires_at,
  });

  return new Response(JSON.stringify({
    resume_token: resumeRaw,
    expires_at,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
