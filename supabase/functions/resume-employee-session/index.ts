/**
 * resume-employee-session v1
 * Valide un resume_token opaque, le fait tourner (rotation),
 * crée une nouvelle employee_session et retourne un session_token mémoire.
 *
 * POST body: { resume_token: string }
 * Réponse: { session_token, employee_id, role, full_name, expires_at }
 *
 * SÉCURITÉ :
 * - Aucun droit métier accordé par le resume_token lui-même.
 * - Seul le token brut côté client, seul le hash côté serveur.
 * - Rotation à chaque appel réussi (ancien hash révoqué).
 * - Révocable au logout.
 * - Impossible d'appeler les Edge Functions métier directement avec ce token.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { resume_token?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: CORS }); }

  const rawToken = body?.resume_token;
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 64) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400, headers: CORS });
  }

  const hash = await sha256hex(rawToken);
  const now  = new Date().toISOString();

  // Chercher le resume token valide
  const { data: rt, error: rtErr } = await sb
    .from('veraluz_resume_tokens')
    .select('id, employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();

  if (rtErr || !rt) {
    return new Response(JSON.stringify({ error: 'token_invalid_or_expired' }), { status: 401, headers: CORS });
  }

  // Récupérer infos employé
  const { data: emp } = await sb
    .from('veraluz_employees')
    .select('id, full_name, role, status')
    .eq('id', rt.employee_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!emp) {
    return new Response(JSON.stringify({ error: 'employee_inactive' }), { status: 403, headers: CORS });
  }

  // Rotation : révoquer l'ancien, créer le nouveau resume_token
  const newRawToken  = generateToken(48);
  const newHash      = await sha256hex(newRawToken);
  const resumeExpiry = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const deviceHint   = req.headers.get('user-agent')?.slice(0, 120) ?? null;

  await sb.from('veraluz_resume_tokens')
    .update({ revoked_at: now, revoked_reason: 'rotated', rotated_at: now })
    .eq('id', rt.id);

  await sb.from('veraluz_resume_tokens').insert({
    employee_id: rt.employee_id,
    token_hash:  newHash,
    device_hint: deviceHint,
    expires_at:  resumeExpiry,
  });

  // Créer nouvelle employee_session (session_token brut retourné uniquement ici)
  const sessionRaw    = generateToken(32);
  const sessionHash   = await sha256hex(sessionRaw);
  const sessionExpiry = new Date(Date.now() + 8 * 3600 * 1000).toISOString(); // 8h

  await sb.from('veraluz_employee_sessions').insert({
    employee_id: rt.employee_id,
    token_hash:  sessionHash,
    expires_at:  sessionExpiry,
  });

  return new Response(JSON.stringify({
    session_token:    sessionRaw,   // ← garder UNIQUEMENT en mémoire côté client
    resume_token:     newRawToken,  // ← stocker dans localStorage (opaque, sans droits directs)
    employee_id:      emp.id,
    role:             emp.role,
    full_name:        emp.full_name,
    expires_at:       sessionExpiry,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
