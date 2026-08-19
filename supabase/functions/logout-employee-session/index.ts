/**
 * VERALUZ — logout-employee-session — v3 (AUTH-R2B1)
 *
 * Changements v3 :
 * - Accepte session_token (requis) + resume_token (optionnel, meme appareil).
 * - Revoque la session ET le resume_token specifique de cet appareil.
 * - Ne revoque JAMAIS les resume_tokens des autres appareils.
 * - employee_id toujours derive de la session validee, jamais du client.
 * - Verifie que le resume_token appartient au meme employe avant revocation.
 *
 * POST body : { session_token: string, resume_token?: string }
 * Reponse   : { ok: true }   (toujours 200 pour ne pas reveler l'etat du token)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }),
      { status: 405, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

  let sessionRaw = '';
  let resumeRaw  = '';
  try {
    const b = await req.json();
    sessionRaw = String(b.session_token || '');
    resumeRaw  = String(b.resume_token  || '');
  } catch { /* ignore */ }

  // Reponse par defaut : 200 quelle que soit l'issue (ne pas reveler l'etat des tokens)
  const ok = new Response(JSON.stringify({ ok: true }),
    { status: 200, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

  // session_token doit etre 64 hex (32 octets)
  if (!/^[0-9a-f]{64}$/.test(sessionRaw)) return ok;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const sessionHash = await sha256Hex(sessionRaw);
  const now = new Date().toISOString();

  // 1. Lookup session -> employee_id (source de verite, jamais le client)
  const { data: sess } = await admin
    .from('veraluz_employee_sessions')
    .select('id, employee_id')
    .eq('token_hash', sessionHash)
    .is('revoked_at', null)
    .limit(1);

  const session = sess && sess[0];

  // 2. Revoquer la session
  const { error: rErr } = await admin
    .from('veraluz_employee_sessions')
    .update({ revoked_at: now, revoked_reason: 'logout' })
    .eq('token_hash', sessionHash)
    .is('revoked_at', null);

  if (!rErr && session) {
    await admin.from('veraluz_auth_events').insert({
      event_type: 'logout',
      employee_id: session.employee_id,
      performed_by: session.employee_id,
      success: true,
      details_json: { resume_provided: resumeRaw.length >= 96 },
    });
  } else if (rErr) {
    console.error('[logout] session_revoke_failed code=', rErr.code);
  }

  // 3. Revoquer le resume_token de cet appareil (si fourni et valide)
  //    Securite : on verifie que le resume appartient au MEME employe que la session.
  //    employee_id derive uniquement de la session validee, jamais du client.
  if (resumeRaw.length >= 96 && session?.employee_id) {
    const resumeHash = await sha256Hex(resumeRaw);

    // Verifier que ce resume_token appartient bien a l'employe de la session
    const { data: rt } = await admin
      .from('veraluz_resume_tokens')
      .select('id, employee_id')
      .eq('token_hash', resumeHash)
      .is('revoked_at', null)
      .maybeSingle();

    if (rt && rt.employee_id === session.employee_id) {
      await admin
        .from('veraluz_resume_tokens')
        .update({ revoked_at: now, revoked_reason: 'logout' })
        .eq('id', rt.id);
    }
    // Si rt absent ou employe different : silencieux (ne pas reveler)
  }

  return ok;
});
