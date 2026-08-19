/**
 * VERALUZ — resume-employee-session — v3 (AUTH-R2B1.1)
 *
 * Changements v3 (par rapport à v2 AUTH-R2B1) :
 * - Rotation atomique via RPC PostgreSQL veraluz_rotate_resume_token :
 *     FOR UPDATE SKIP LOCKED → INSERT nouveau → REVOKE ancien → INSERT session
 *     ROLLBACK total si une étape échoue → ancien token intact → pas de lockout.
 * - L'EF génère les raw tokens et n'envoie QUE leurs hashes à la RPC.
 * - Plus de compensation applicative fragile : la DB garantit l'atomicité.
 * - CORS, status IN ('actif','active'), identité fraîche : conservés.
 *
 * POST body : { resume_token: string }
 * Réponse   : { session_token, resume_token, employee_id, role, full_name,
 *               department, public_display_name, expires_at, resume_expires_at }
 *
 * SÉCURITÉ :
 * - raw tokens jamais stockés en DB (SHA-256 uniquement)
 * - raw tokens jamais journalisés
 * - employee_id toujours résolu depuis la RPC (jamais du client)
 * - RPC exécutable uniquement via service_role
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

function generateToken(bytes: number): string {
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

  // ── Générer les nouveaux credentials AVANT l'appel RPC ───────────────────
  // Les raw tokens ne traversent jamais la DB. Seuls les hashes sont transmis.
  const newRawResume   = generateToken(48);           // 48 octets = 96 hex
  const newRawSession  = generateToken(32);           // 32 octets = 64 hex

  const [oldHash, newResumeHash, newSessionHash] = await Promise.all([
    sha256hex(rawToken),
    sha256hex(newRawResume),
    sha256hex(newRawSession),
  ]);

  const resumeExpiry  = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(); // 30j
  const sessionExpiry = new Date(Date.now() +  8 *      3600 * 1000).toISOString(); //  8h
  const deviceHint    = req.headers.get('user-agent')?.slice(0, 120) ?? null;

  // ── Appel RPC atomique ───────────────────────────────────────────────────
  // veraluz_rotate_resume_token est SECURITY DEFINER, service_role seulement.
  // Si n'importe quelle étape DB échoue → ROLLBACK PostgreSQL → ancien token intact.
  const { data: rpc, error: rpcErr } = await sb.rpc('veraluz_rotate_resume_token', {
    p_old_resume_hash:    oldHash,
    p_new_resume_hash:    newResumeHash,
    p_new_session_hash:   newSessionHash,
    p_device_hint:        deviceHint,
    p_resume_expires_at:  resumeExpiry,
    p_session_expires_at: sessionExpiry,
  });

  if (rpcErr) {
    console.error('[resume-session] rpc_failed code=', rpcErr.code);
    return json({ error: 'server_error' }, 500, origin);
  }

  const result = rpc as {
    ok: boolean; error?: string;
    employee_id?: string; role?: string; full_name?: string;
    department?: string; public_display_name?: string;
  };

  if (!result.ok) {
    const status = result.error === 'employee_inactive' ? 403 : 401;
    return json({ error: result.error ?? 'unknown' }, status, origin);
  }

  // ── Réponse — raw tokens retournés une seule fois ─────────────────────────
  return json({
    session_token:       newRawSession,  // ← garder UNIQUEMENT en mémoire côté client
    resume_token:        newRawResume,   // ← stocker dans localStorage (opaque)
    employee_id:         result.employee_id,
    role:                result.role,
    full_name:           result.full_name,
    department:          result.department ?? '',
    public_display_name: result.public_display_name ?? result.full_name,
    expires_at:          sessionExpiry,
    resume_expires_at:   resumeExpiry,
  }, 200, origin);
});
