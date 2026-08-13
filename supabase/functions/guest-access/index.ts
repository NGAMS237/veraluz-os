/**
 * GUEST-1 — guest-access Edge Function
 * Foundation du Guest Portal Résidences Veraluz
 *
 * Actions:
 *   create_invitation  — employé auth → génère token 256 bits, stocke HASH, retourne URL
 *   validate_token     — public → échange token brut → session validée
 *   resume_session     — public → revalide token (même logique)
 *   revoke_session     — employé auth → révocation immédiate
 *   get_my_stay        — guest auth (X-Guest-Token) → données séjour minimales
 *
 * Sécurité:
 *   - Token: 32 octets crypto random (256 bits)
 *   - DB: SHA-256(token) uniquement, jamais le brut
 *   - RLS: anon + authenticated bloqués sur veraluz_guest_sessions
 *   - reservation_id JAMAIS issu du client pour les accès guest
 *   - Révocation immédiate: chaque requête re-valide le hash
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
];

const INVITE_ROLES = new Set([
  'superadmin','admin','manager','direction','directeur',
  'gerant','directrice','reception',
]);

const TENANT              = 'veraluz-001';
const PROPERTY_NAME       = 'Résidences Veraluz';
const MAX_ACTIVE_SESSIONS = 3;
const POST_CHECKOUT_GRACE = 6; // heures

// ── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session, x-guest-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

async function hashToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  const bytes = new Uint8Array(32); // 256 bits
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Auth employé ─────────────────────────────────────────────────────────────

async function validateEmployeeSession(db: any, sessionToken: string) {
  if (!sessionToken) return null;
  const hash = await hashToken(sessionToken);
  const { data: sess } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .single();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;
  const { data: emp } = await db
    .from('veraluz_employees')
    .select('id, full_name, role')
    .eq('id', sess.employee_id)
    .single();
  return emp ?? null;
}

// ── Auth guest ───────────────────────────────────────────────────────────────

async function validateGuestToken(db: any, rawToken: string) {
  if (!rawToken) return { error: 'token_required', session: null };
  const hash = await hashToken(rawToken);
  const now  = new Date();

  const { data: session } = await db
    .from('veraluz_guest_sessions')
    .select('*')
    .eq('token_hash', hash)
    .single();

  if (!session)                      return { error: 'invalid',    session: null };
  if (session.status === 'revoked')  return { error: 'revoked',    session: null };
  if (session.status === 'expired')  return { error: 'expired',    session: null };
  if (new Date(session.expires_at) < now) {
    await db.from('veraluz_guest_sessions').update({ status: 'expired' }).eq('id', session.id);
    return { error: 'expired', session: null };
  }
  if (new Date(session.valid_from) > now) return { error: 'not_yet_valid', session: null };

  // Vérifier statut réservation — serveur résout
  const { data: res } = await db
    .from('veraluz_reservations')
    .select('status')
    .eq('id', session.reservation_id)
    .single();

  if (!res) return { error: 'reservation_not_found', session: null };
  if (!['confirmed','checkedin'].includes(res.status)) {
    return { error: 'reservation_unavailable', session: null };
  }

  // last_used_at fire-and-forget
  db.from('veraluz_guest_sessions')
    .update({ last_used_at: now.toISOString() })
    .eq('id', session.id)
    .then(() => {});

  return { error: null, session };
}

function guestErrorMsg(error: string): string {
  const M: Record<string,string> = {
    invalid:                 'Lien invalide ou expiré.',
    revoked:                 'Ce lien a été révoqué.',
    expired:                 "Ce séjour n'est plus accessible.",
    not_yet_valid:           "Ce lien n'est pas encore actif.",
    reservation_unavailable: 'Aucune information de séjour disponible.',
    reservation_not_found:   'Lien invalide ou expiré.',
    token_required:          'Authentification requise.',
  };
  return M[error] ?? 'Lien invalide ou expiré.';
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ALLOWED_ORIGINS[0];
  const cors   = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, cors);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_json' }, 400, cors); }

  const { action } = body;

  // ── CREATE_INVITATION ────────────────────────────────────────────────────
  if (action === 'create_invitation') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!INVITE_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const reservationId = body.reservation_id as string | undefined;
    if (!reservationId)
      return json({ ok: false, error: 'reservation_id_required' }, 400, cors);

    const { data: res } = await db
      .from('veraluz_reservations')
      .select('id, unit_id, status, check_out')
      .eq('id', reservationId)
      .single();

    if (!res) return json({ ok: false, error: 'reservation_not_found' }, 404, cors);
    if (!['confirmed','checkedin'].includes(res.status))
      return json({ ok: false, error: 'reservation_not_active', reservation_status: res.status }, 400, cors);

    // Politique max sessions: révoquer la plus ancienne si dépassé
    const { data: existing, count } = await db
      .from('veraluz_guest_sessions')
      .select('id, created_at', { count: 'exact' })
      .eq('reservation_id', reservationId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (count && count >= MAX_ACTIVE_SESSIONS && existing && existing.length > 0) {
      await db.from('veraluz_guest_sessions')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: emp.id })
        .eq('id', existing[0].id);
    }

    // expires_at = checkout + grâce
    const expiresAt = new Date(res.check_out);
    expiresAt.setHours(expiresAt.getHours() + POST_CHECKOUT_GRACE);

    const rawToken  = generateToken();
    const tokenHash = await hashToken(rawToken);

    const { data: gs, error: insErr } = await db
      .from('veraluz_guest_sessions')
      .insert({
        tenant_id:      TENANT,
        reservation_id: reservationId,
        unit_id:        res.unit_id ?? '',
        token_hash:     tokenHash,
        status:         'active',
        scopes:         ['stay.read'],
        valid_from:     new Date().toISOString(),
        expires_at:     expiresAt.toISOString(),
        created_by:     emp.id,
        metadata:       { created_via: 'employee_invite', employee_name: emp.full_name },
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[guest-access] insert:', insErr.message);
      return json({ ok: false, error: 'session_create_failed' }, 500, cors);
    }

    const guestUrl = `https://ngams237.github.io/veraluz-os/GUEST_PORTAL.html?t=${rawToken}`;

    return json({
      ok:               true,
      guest_session_id: gs!.id,
      guest_url:        guestUrl,
      token:            rawToken,   // retourné UNE seule fois
      expires_at:       expiresAt.toISOString(),
      note:             'Token retourné une seule fois. Non stocké en DB.',
    }, 200, cors);
  }

  // ── VALIDATE_TOKEN / RESUME_SESSION ────────────────────────────────────────
  if (action === 'validate_token' || action === 'resume_session') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);
    return json({
      ok:               true,
      guest_session_id: session!.id,
      scopes:           session!.scopes,
      expires_at:       session!.expires_at,
    }, 200, cors);
  }

  // ── GET_MY_STAY ────────────────────────────────────────────────────────────
  // Le client ne fournit PAS reservation_id — le serveur résout depuis la session
  if (action === 'get_my_stay') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('stay.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    const { data: res } = await db
      .from('veraluz_reservations')
      .select('client_name, check_in, check_out, status, guests')
      .eq('id', session!.reservation_id)
      .single();

    const { data: unit } = await db
      .from('veraluz_units')
      .select('name, type, floor, emoji')
      .eq('id', session!.unit_id)
      .single();

    if (!res) return json({ ok: false, error: 'stay_not_found' }, 404, cors);

    const firstName = (res.client_name ?? '').split(' ')[0] || 'Cher client';

    return json({
      ok: true,
      stay: {
        property_name:      PROPERTY_NAME,
        guest_first_name:   firstName,
        unit_name:          unit?.name ?? session!.unit_id,
        unit_type:          unit?.type ?? '',
        unit_emoji:         unit?.emoji ?? '🏨',
        check_in:           res.check_in,
        check_out:          res.check_out,
        reservation_status: res.status,
        guests:             res.guests,
        // EXCLUS: notes, paid, total, client_phone, client_email, employee_ids,
        //         audit_logs, commission, marges, autres réservations/clients
      },
    }, 200, cors);
  }

  // ── REVOKE_SESSION ──────────────────────────────────────────────────────────
  if (action === 'revoke_session') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!INVITE_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const guestSessionId = body.guest_session_id as string | undefined;
    const reservationId  = body.reservation_id  as string | undefined;

    if (guestSessionId) {
      const { error } = await db
        .from('veraluz_guest_sessions')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: emp.id })
        .eq('id', guestSessionId)
        .eq('status', 'active');
      if (error) return json({ ok: false, error: 'revoke_failed' }, 500, cors);
    } else if (reservationId) {
      await db.from('veraluz_guest_sessions')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: emp.id })
        .eq('reservation_id', reservationId)
        .eq('status', 'active');
    } else {
      return json({ ok: false, error: 'guest_session_id_or_reservation_id_required' }, 400, cors);
    }

    return json({ ok: true, message: 'Session guest révoquée avec succès.' }, 200, cors);
  }

  return json({ error: 'unknown_action' }, 400, cors);
});
