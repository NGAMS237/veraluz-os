/**
 * GUEST-2 — guest-access Edge Function v2
 * Accueil séjour enrichi: settings wifi/property/restaurant/contact + photo unité
 *
 * Nouveautés v2:
 *   list_sessions     — employé auth → liste sessions actives pour une réservation
 *   get_my_stay       — enrichi: settings, photo, wifi conditionnel (checkedin uniquement)
 *
 * Règle wifi.password:
 *   - Retourné UNIQUEMENT si reservation.status = 'checkedin'
 *   - confirmed → ssid exposé, password = null
 *   - checkedout / cancelled / expired → password = null
 *   - Jamais dans logs, URLs, comm_log, analytics
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Auth employé ──────────────────────────────────────────────────────────────

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

// ── Auth guest ────────────────────────────────────────────────────────────────

async function validateGuestToken(db: any, rawToken: string) {
  if (!rawToken) return { error: 'token_required', session: null, reservationStatus: null };
  const hash = await hashToken(rawToken);
  const now  = new Date();

  const { data: session } = await db
    .from('veraluz_guest_sessions')
    .select('*')
    .eq('token_hash', hash)
    .single();

  if (!session)                      return { error: 'invalid',    session: null, reservationStatus: null };
  if (session.status === 'revoked')  return { error: 'revoked',    session: null, reservationStatus: null };
  if (session.status === 'expired')  return { error: 'expired',    session: null, reservationStatus: null };
  if (new Date(session.expires_at) < now) {
    await db.from('veraluz_guest_sessions').update({ status: 'expired' }).eq('id', session.id);
    return { error: 'expired', session: null, reservationStatus: null };
  }
  if (new Date(session.valid_from) > now) return { error: 'not_yet_valid', session: null, reservationStatus: null };

  const { data: res } = await db
    .from('veraluz_reservations')
    .select('status')
    .eq('id', session.reservation_id)
    .single();

  if (!res) return { error: 'reservation_not_found', session: null, reservationStatus: null };
  if (!['confirmed','checkedin'].includes(res.status)) {
    return { error: 'reservation_unavailable', session: null, reservationStatus: res.status };
  }

  db.from('veraluz_guest_sessions')
    .update({ last_used_at: now.toISOString() })
    .eq('id', session.id)
    .then(() => {});

  return { error: null, session, reservationStatus: res.status };
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

// ── Chargement settings ──────────────────────────────────────────────────────

async function loadSettings(db: any) {
  const { data } = await db
    .from('veraluz_settings')
    .select('key, value')
    .in('key', ['wifi','property','booking','contact','restaurant']);
  const S: Record<string, any> = {};
  for (const row of (data || [])) S[row.key] = row.value;
  return S;
}

// ── Main ──────────────────────────────────────────────────────────────────────

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

  // ── CREATE_INVITATION ────────────────────────────────────────────────────────
  if (action === 'create_invitation') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!INVITE_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const reservationId = body.reservation_id as string | undefined;
    if (!reservationId) return json({ ok: false, error: 'reservation_id_required' }, 400, cors);

    const { data: res } = await db
      .from('veraluz_reservations')
      .select('id, unit_id, status, check_out')
      .eq('id', reservationId)
      .single();

    if (!res) return json({ ok: false, error: 'reservation_not_found' }, 404, cors);
    if (!['confirmed','checkedin'].includes(res.status))
      return json({ ok: false, error: 'reservation_not_active', reservation_status: res.status }, 400, cors);

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

  // ── LIST_SESSIONS (employé) ──────────────────────────────────────────────────
  if (action === 'list_sessions') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!INVITE_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const reservationId = body.reservation_id as string | undefined;
    if (!reservationId) return json({ ok: false, error: 'reservation_id_required' }, 400, cors);

    // Retourner sans token_hash (jamais exposé côté client)
    const { data: sessions } = await db
      .from('veraluz_guest_sessions')
      .select('id, status, scopes, created_at, expires_at, last_used_at, revoked_at, created_by')
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: false })
      .limit(10);

    return json({ ok: true, sessions: sessions || [] }, 200, cors);
  }

  // ── VALIDATE_TOKEN / RESUME_SESSION ──────────────────────────────────────────
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

  // ── GET_MY_STAY (enrichi v2) ──────────────────────────────────────────────────
  // Le client ne fournit PAS reservation_id — résolution serveur uniquement
  if (action === 'get_my_stay') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session, reservationStatus } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('stay.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    // Charger en parallèle: réservation, unité, photo, settings
    const [resResult, unitResult, photoResult, settingsData] = await Promise.all([
      db.from('veraluz_reservations')
        .select('client_name, check_in, check_out, status, guests')
        .eq('id', session!.reservation_id)
        .single(),
      db.from('veraluz_units')
        .select('name, type, floor, emoji')
        .eq('id', session!.unit_id)
        .single(),
      db.from('veraluz_photos')
        .select('url')
        .eq('unit_id', session!.unit_id)
        .eq('is_cover', true)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle(),
      loadSettings(db),
    ]);

    const res  = resResult.data;
    const unit = unitResult.data;
    const photo = photoResult.data;

    if (!res) return json({ ok: false, error: 'stay_not_found' }, 404, cors);

    const firstName = (res.client_name ?? '').split(' ')[0] || 'Cher client';
    const resStatus = res.status as string;

    // Settings
    const S        = settingsData;
    const wifi     = S['wifi']       || {};
    const property = S['property']   || {};
    const booking  = S['booking']    || {};
    const contact  = S['contact']    || {};
    const rest     = S['restaurant'] || {};

    // WiFi: password UNIQUEMENT si checkedin
    const wifiEnabled = wifi.enabled !== false;
    const canSeePassword = resStatus === 'checkedin';
    const wifiPayload = wifiEnabled ? {
      enabled:            true,
      ssid:               wifi.ssid || null,
      password:           canSeePassword ? (wifi.password || null) : null,
      password_available: canSeePassword,
      hint: !canSeePassword
        ? "Le code Wi-Fi sera disponible après votre arrivée."
        : null,
    } : { enabled: false };

    // Restaurant
    const restaurantPayload = {
      enabled:             rest.enabled !== false,
      opening_time:        rest.opening_time  || null,
      closing_time:        rest.closing_time  || null,
      room_service_enabled: rest.room_service_enabled === true,
    };

    return json({
      ok: true,
      stay: {
        // Identité
        property_name:       property.name     || PROPERTY_NAME,
        property_tagline:    property.tagline  || '',
        property_location:   property.location || 'Kribi, Cameroun',
        guest_first_name:    firstName,
        // Unité
        unit_name:           unit?.name  ?? session!.unit_id,
        unit_type:           unit?.type  ?? '',
        unit_emoji:          unit?.emoji ?? '🏨',
        unit_photo_url:      photo?.url  ?? null,
        // Dates & statut
        check_in:            res.check_in,
        check_out:           res.check_out,
        checkin_time:        booking.checkin_time  || '15:00',
        checkout_time:       booking.checkout_time || '11:00',
        reservation_status:  resStatus,
        guests:              res.guests,
        // Contact réception
        contact: {
          phone:     contact.phone    || null,
          email:     contact.email    || null,
          whatsapp:  contact.whatsapp || null,
        },
        // Wi-Fi (conditionnel)
        wifi: wifiPayload,
        // Restaurant
        restaurant: restaurantPayload,
        // EXCLUS: notes, paid, total, client_phone, client_email, employee_ids,
        //         audit_logs, commission, marges, autres réservations/clients
      },
    }, 200, cors);
  }

  // ── REVOKE_SESSION ────────────────────────────────────────────────────────────
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
