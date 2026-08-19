/**
 * GUEST-3.3 — guest-access Edge Function v6
 * Feedback client + Usage tracking
 *
 * Nouveautés v6:
 *   portal_open            — première ouverture + comptage (is_new_load)
 *   log_activity           — allowlist stricte, metadata filtrée
 *   submit_feedback        — review/complaint, severity déterministe, employee résolu serveur
 *   list_feedback          — direction uniquement
 *   update_feedback_status — direction uniquement
 *   get_usage_stats        — synthèse usage direction
 *
 * Règles sécurité:
 *   - reservation_id toujours depuis session (serveur)
 *   - related_employee_id résolu depuis food_orders (jamais depuis client)
 *   - aucune sanction automatique employé
 *   - event_type: allowlist stricte
 *   - metadata: clés autorisées uniquement
 *   - no IP, no fingerprint, no raw token logged
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
const MAX_ITEM_QTY        = 20;
const MAX_ITEMS_PER_ORDER = 15;

// Scopes accordés à toutes les sessions guest
const GUEST_DEFAULT_SCOPES = [
  'stay.read',
  'restaurant.read',
  'restaurant.order',
  'restaurant.orders.read',
  'folio.read',      // GUEST-4A — lecture folio séjour
];

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
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `RS-${ts}-${rnd}`;
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

async function validateGuestToken(
  db: any,
  rawToken: string,
  allowedReservationStatuses: string[] = ['confirmed','checkedin'],
) {
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
  if (!allowedReservationStatuses.includes(res.status)) {
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

// ── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings(db: any) {
  const { data } = await db
    .from('veraluz_settings')
    .select('key, value')
    .in('key', ['wifi','property','booking','contact','restaurant']);
  const S: Record<string, any> = {};
  for (const row of (data || [])) S[row.key] = row.value;
  return S;
}

// ── Status label (FR) ────────────────────────────────────────────────────────

function orderStatusLabel(status: string): string {
  const L: Record<string,string> = {
    pending:          'Reçue',
    confirmed:        'Reçue',
    preparing:        'En préparation',
    ready:            'Prête',
    out_for_delivery: 'En livraison',
    delivered:        'Livrée',
    cancelled:        'Annulée',
  };
  return L[status] ?? status;
}

function orderStatusStep(status: string): number {
  const S: Record<string,number> = {
    pending: 1, confirmed: 1, preparing: 2, ready: 3,
    out_for_delivery: 4, delivered: 5, cancelled: 0,
  };
  return S[status] ?? 0;
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

  // ══════════════════════════════════════════════════════════════════
  // CREATE_INVITATION (employé → crée session guest)
  // ══════════════════════════════════════════════════════════════════
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
        scopes:         GUEST_DEFAULT_SCOPES,
        valid_from:     new Date().toISOString(),
        expires_at:     expiresAt.toISOString(),
        created_by:     emp.id,
        metadata:       { created_via: 'employee_invite', employee_name: emp.full_name },
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('[guest-access] insert session:', insErr.message);
      return json({ ok: false, error: 'session_create_failed' }, 500, cors);
    }

    const guestUrl = `https://ngams237.github.io/veraluz-os/GUEST_PORTAL.html?t=${rawToken}`;

    return json({
      ok:               true,
      guest_session_id: gs!.id,
      guest_url:        guestUrl,
      token:            rawToken,
      expires_at:       expiresAt.toISOString(),
      note:             'Token retourné une seule fois. Non stocké en DB.',
    }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // LIST_SESSIONS (employé)
  // ══════════════════════════════════════════════════════════════════
  if (action === 'list_sessions') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!INVITE_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const reservationId = body.reservation_id as string | undefined;
    if (!reservationId) return json({ ok: false, error: 'reservation_id_required' }, 400, cors);

    const { data: sessions } = await db
      .from('veraluz_guest_sessions')
      .select('id, status, scopes, created_at, expires_at, last_used_at, revoked_at, created_by')
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: false })
      .limit(10);

    return json({ ok: true, sessions: sessions || [] }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // VALIDATE_TOKEN / RESUME_SESSION
  // ══════════════════════════════════════════════════════════════════
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

  // ══════════════════════════════════════════════════════════════════
  // GET_MY_STAY (enrichi v2 — inchangé)
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_my_stay') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session, reservationStatus } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('stay.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    const [resResult, unitResult, photoResult, settingsData] = await Promise.all([
      db.from('veraluz_reservations')
        .select('client_id, client_name, check_in, check_out, status, guests')
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

    let identityName = (res.client_name ?? '').trim();
    if (res.client_id) {
      const { data: client } = await db.from('veraluz_clients')
        .select('full_name')
        .eq('id', res.client_id)
        .maybeSingle();
      if (client?.full_name?.trim()) identityName = client.full_name.trim();
    }
    const displayName = identityName
      .replace(/\s+/g, ' ')
      .split(' ')
      .map((part: string) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
      .join(' ') || 'Cher client';
    const firstName = displayName.split(' ')[0] || 'Cher client';
    const resStatus = res.status as string;

    const S        = settingsData;
    const wifi     = S['wifi']       || {};
    const property = S['property']   || {};
    const booking  = S['booking']    || {};
    const contact  = S['contact']    || {};
    const rest     = S['restaurant'] || {};

    const wifiEnabled       = wifi.enabled !== false;
    const canSeePassword    = resStatus === 'checkedin';
    const wifiPassword      = typeof wifi.password === 'string' ? wifi.password : '';
    const passwordAvailable = canSeePassword && wifiPassword.length > 0;
    const wifiPayload    = wifiEnabled ? {
      enabled:            true,
      ssid:               wifi.ssid || null,
      password:           passwordAvailable ? wifiPassword : null,
      password_available: passwordAvailable,
      hint: canSeePassword
        ? (passwordAvailable ? null : "L'accès Wi-Fi n'est pas encore configuré. Contactez la réception.")
        : "Le code Wi-Fi sera disponible après votre arrivée.",
    } : { enabled: false };

    return json({
      ok: true,
      stay: {
        property_name:     property.name     || PROPERTY_NAME,
        property_tagline:  property.tagline  || '',
        property_location: property.location || 'Kribi, Cameroun',
        guest_first_name:  firstName,
        guest_display_name: displayName,
        unit_name:         unit?.name  ?? session!.unit_id,
        unit_type:         unit?.type  ?? '',
        unit_emoji:        unit?.emoji ?? '🏨',
        unit_photo_url:    photo?.url  ?? null,
        check_in:          res.check_in,
        check_out:         res.check_out,
        checkin_time:      booking.checkin_time  || '15:00',
        checkout_time:     booking.checkout_time || '11:00',
        reservation_status: resStatus,
        guests:            res.guests,
        contact: {
          phone:    contact.phone    || null,
          email:    contact.email    || null,
          whatsapp: contact.whatsapp || null,
        },
        wifi: wifiPayload,
        restaurant: {
          enabled:              rest.enabled !== false,
          opening_time:         rest.opening_time  || null,
          closing_time:         rest.closing_time  || null,
          room_service_enabled: rest.room_service_enabled === true,
        },
      },
    }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // GET_RESTAURANT_MENU — scope restaurant.read
  // Lecture publique menu room service (actif + room_service_enabled)
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_restaurant_menu') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('restaurant.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    const { data: products, error: pErr } = await db
      .from('veraluz_restaurant_products')
      .select('id, name, category, price, description, available, image_url, sort_order')
      .eq('active', true)
      .eq('room_service_enabled', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (pErr) {
      console.error('[guest-access] get_restaurant_menu:', pErr.message);
      return json({ ok: false, error: 'menu_load_failed' }, 500, cors);
    }

    // Grouper par catégorie
    const categories: string[] = [];
    const byCategory: Record<string, any[]> = {};
    for (const p of (products || [])) {
      if (!byCategory[p.category]) {
        categories.push(p.category);
        byCategory[p.category] = [];
      }
      byCategory[p.category].push({
        id:          p.id,
        name:        p.name,
        description: p.description || '',
        price:       Number(p.price),
        available:   p.available,
        image_url:   p.image_url || null,
        category:    p.category,
      });
    }

    return json({
      ok:         true,
      categories,
      by_category: byCategory,
      products:   (products || []).map(p => ({
        id:          p.id,
        name:        p.name,
        description: p.description || '',
        price:       Number(p.price),
        available:   p.available,
        image_url:   p.image_url || null,
        category:    p.category,
      })),
    }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // CREATE_RESTAURANT_ORDER — scope restaurant.order
  // CHECKEDIN OBLIGATOIRE
  // Prix calculés serveur uniquement
  // ══════════════════════════════════════════════════════════════════
  if (action === 'create_restaurant_order') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session, reservationStatus } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('restaurant.order'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    // CHECKEDIN OBLIGATOIRE pour commande Room Service
    if (reservationStatus !== 'checkedin') {
      return json({
        ok:      false,
        error:   'checkedin_required',
        message: 'Le Room Service est disponible pendant votre séjour.',
      }, 403, cors);
    }

    // Valider items
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0)
      return json({ ok: false, error: 'items_required', message: 'Votre commande est vide.' }, 400, cors);
    if (rawItems.length > MAX_ITEMS_PER_ORDER)
      return json({ ok: false, error: 'too_many_items' }, 400, cors);

    // Valider quantités
    for (const item of rawItems) {
      const qty = Number(item.quantity);
      if (!item.product_id) return json({ ok: false, error: 'product_id_required' }, 400, cors);
      if (!Number.isInteger(qty) || qty <= 0)
        return json({ ok: false, error: 'invalid_quantity', product_id: item.product_id }, 400, cors);
      if (qty > MAX_ITEM_QTY)
        return json({ ok: false, error: 'quantity_too_large', max: MAX_ITEM_QTY }, 400, cors);
    }

    const clientOrderKey = (body.client_order_key as string | undefined) || null;
    const note           = (body.note as string | undefined)?.slice(0, 300) || null;

    // Idempotence: déjà créée avec cette clé?
    if (clientOrderKey) {
      const { data: existing } = await db
        .from('veraluz_food_orders')
        .select('id, order_number, status, total')
        .eq('guest_session_id', session!.id)
        .eq('client_order_key', clientOrderKey)
        .maybeSingle();
      if (existing) {
        return json({
          ok:           true,
          order_id:     existing.id,
          order_number: existing.order_number,
          status:       existing.status,
          total:        existing.total,
          idempotent:   true,
          message:      'Commande déjà enregistrée.',
        }, 200, cors);
      }
    }

    // Charger les produits depuis DB (jamais depuis le client)
    const productIds = rawItems.map((i: any) => i.product_id);
    const { data: products, error: pErr } = await db
      .from('veraluz_restaurant_products')
      .select('id, name, price, available, active, room_service_enabled')
      .in('id', productIds);

    if (pErr) return json({ ok: false, error: 'product_load_failed' }, 500, cors);

    const productMap: Record<string, any> = {};
    for (const p of (products || [])) productMap[p.id] = p;

    // Vérifier chaque produit
    for (const item of rawItems) {
      const p = productMap[item.product_id];
      if (!p)                       return json({ ok: false, error: 'product_not_found',    product_id: item.product_id, message: 'Produit introuvable.' }, 400, cors);
      if (!p.active)                return json({ ok: false, error: 'product_inactive',     product_id: item.product_id, message: 'Ce produit n\'est plus disponible.' }, 400, cors);
      if (!p.available)             return json({ ok: false, error: 'product_unavailable',  product_id: item.product_id, message: `${p.name} est momentanément indisponible.` }, 400, cors);
      if (!p.room_service_enabled)  return json({ ok: false, error: 'not_room_service',     product_id: item.product_id, message: `${p.name} n'est pas disponible en Room Service.` }, 400, cors);
    }

    // Calculer prix SERVEUR (jamais client)
    const resolvedItems: any[] = [];
    let subtotal = 0;
    for (const item of rawItems) {
      const p   = productMap[item.product_id];
      const qty = Number(item.quantity);
      const dbPrice   = Number(p.price);
      const lineTotal = Math.round(dbPrice * qty);
      subtotal += lineTotal;
      resolvedItems.push({
        product_id: p.id,
        name:       p.name,
        quantity:   qty,
        unit_price: dbPrice,
        subtotal:   lineTotal,
      });
    }
    const total = subtotal; // Room Service: delivery_fee = 0

    // Charger room_number depuis l'unité
    const { data: unitRow } = await db
      .from('veraluz_units')
      .select('name, number')
      .eq('id', session!.unit_id)
      .maybeSingle();
    const roomNumber = unitRow?.number ?? unitRow?.name ?? session!.unit_id;

    const orderNumber = generateOrderNumber();

    const { data: newOrder, error: insErr } = await db
      .from('veraluz_food_orders')
      .insert({
        order_number:     orderNumber,
        delivery_type:    'room',
        source:           'guest_portal',
        room_number:      String(roomNumber),
        // Résolution serveur — jamais depuis le client
        reservation_id:   session!.reservation_id,
        unit_id:          session!.unit_id,
        guest_session_id: session!.id,
        client_order_key: clientOrderKey,
        notes:            note,
        payment_method:   'room_charge',
        payment_status:   'pending',
        items:            JSON.stringify(resolvedItems),
        subtotal:         subtotal,
        delivery_fee:     0,
        total:            total,
        status:           'pending',
      })
      .select('id, order_number, status, total, created_at')
      .single();

    if (insErr) {
      // Vérifie si c'est un conflit d'idempotence (code 23505)
      if (insErr.code === '23505' && clientOrderKey) {
        const { data: dup } = await db
          .from('veraluz_food_orders')
          .select('id, order_number, status, total')
          .eq('guest_session_id', session!.id)
          .eq('client_order_key', clientOrderKey)
          .maybeSingle();
        if (dup) {
          return json({
            ok:           true,
            order_id:     dup.id,
            order_number: dup.order_number,
            status:       dup.status,
            total:        dup.total,
            idempotent:   true,
            message:      'Commande déjà enregistrée.',
          }, 200, cors);
        }
      }
      console.error('[guest-access] create_restaurant_order:', insErr.message);
      return json({ ok: false, error: 'order_create_failed', message: 'Erreur lors de la création de la commande.' }, 500, cors);
    }

    return json({
      ok:           true,
      order_id:     newOrder!.id,
      order_number: newOrder!.order_number,
      status:       newOrder!.status,
      status_label: orderStatusLabel(newOrder!.status),
      status_step:  orderStatusStep(newOrder!.status),
      total:        newOrder!.total,
      items:        resolvedItems,
      created_at:   newOrder!.created_at,
      folio_ready:  true,
    }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // GET_MY_RESTAURANT_ORDERS — scope restaurant.orders.read
  // Isolation stricte: filtre par session.reservation_id (serveur)
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_my_restaurant_orders') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('restaurant.orders.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    // Isolation: reservation_id résolu depuis la session — jamais depuis body
    const { data: orders, error: oErr } = await db
      .from('veraluz_food_orders')
      .select('id, order_number, status, delivery_type, total, items, notes, created_at, delivered_at, room_service_employee_id, room_service_status, room_service_assigned_at, room_service_departed_at, room_service_delivered_at, guest_confirmed_at')
      .eq('reservation_id', session!.reservation_id)
      .eq('source', 'guest_portal')
      .order('created_at', { ascending: false })
      .limit(20);

    if (oErr) {
      console.error('[guest-access] get_my_restaurant_orders:', oErr.message);
      return json({ ok: false, error: 'orders_load_failed' }, 500, cors);
    }

    const mapped = (orders || []).map((o: any) => {
      let parsedItems: any[] = [];
      try { parsedItems = JSON.parse(o.items || '[]'); } catch { /* ignore */ }
      return {
        id:           o.id,
        order_number: o.order_number,
        status:       o.status,
        status_label: orderStatusLabel(o.status),
        status_step:  orderStatusStep(o.status),
        total:        o.total,
        items:        parsedItems,
        notes:        o.notes,
        created_at:   o.created_at,
        delivered_at: o.delivered_at,
      };
    });

    return json({ ok: true, orders: mapped }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // GET_ORDER_STATUS — scope restaurant.orders.read
  // Suivi temps réel d'une commande (isolation par reservation_id)
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_order_status') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('restaurant.orders.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    const orderId = body.order_id as string | undefined;
    if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400, cors);

    const { data: order } = await db
      .from('veraluz_food_orders')
      .select('id, order_number, status, delivery_type, total, items, notes, created_at, delivered_at, room_service_employee_id, room_service_status, room_service_assigned_at, room_service_departed_at, room_service_delivered_at, guest_confirmed_at')
      .eq('id', orderId)
      .eq('reservation_id', session!.reservation_id) // isolation garantie serveur
      .eq('source', 'guest_portal')
      .maybeSingle();

    if (!order)
      return json({ ok: false, error: 'order_not_found', message: 'Commande introuvable.' }, 404, cors);

    let parsedItems: any[] = [];
    try { parsedItems = JSON.parse(order.items || '[]'); } catch { /* ignore */ }

    return json({
      ok:                    true,
      id:                    order.id,
      order_number:          order.order_number,
      status:                order.status,
      status_label:          orderStatusLabel(order.status),
      status_step:           orderStatusStep(order.status),
      total:                 order.total,
      items:                 parsedItems,
      notes:                 order.notes,
      created_at:            order.created_at,
      delivered_at:          order.delivered_at,
      delivery_type:         order.delivery_type,
      room_service_status:       order.room_service_status,
      room_service_employee_id:  order.room_service_employee_id,
      room_service_assigned_at:  order.room_service_assigned_at,
      room_service_departed_at:  order.room_service_departed_at,
      room_service_delivered_at: order.room_service_delivered_at,
      guest_confirmed_at:        order.guest_confirmed_at,
    }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // GET_RS_EMPLOYEE_INFO — identité employé Room Service pour le guest
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_rs_employee_info') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('restaurant.orders.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    const orderId = body.order_id as string | undefined;
    if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400, cors);

    const { data: order } = await db
      .from('veraluz_food_orders')
      .select('id, room_service_employee_id, room_service_status')
      .eq('id', orderId)
      .eq('reservation_id', session!.reservation_id)
      .eq('source', 'guest_portal')
      .maybeSingle();

    if (!order) return json({ ok: false, error: 'order_not_found' }, 404, cors);
    if (!order.room_service_employee_id)
      return json({ ok: true, employee: null, room_service_status: order.room_service_status ?? 'unassigned' }, 200, cors);

    const { data: emp } = await db
      .from('veraluz_employees')
      .select('public_display_name, public_role_label, full_name')
      .eq('id', order.room_service_employee_id)
      .maybeSingle();

    return json({
      ok:                  true,
      room_service_status: order.room_service_status,
      employee: emp ? {
        display_name: emp.public_display_name || emp.full_name || 'Employé',
        role_label:   emp.public_role_label   || '',
      } : null,
    }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // CONFIRM_RECEIVED — guest confirme réception Room Service
  // ══════════════════════════════════════════════════════════════════
  if (action === 'confirm_received') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('restaurant.orders.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    const orderId = body.order_id as string | undefined;
    if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400, cors);

    const { data: order } = await db
      .from('veraluz_food_orders')
      .select('id, room_service_status, guest_confirmed_at')
      .eq('id', orderId)
      .eq('reservation_id', session!.reservation_id)
      .eq('source', 'guest_portal')
      .maybeSingle();

    if (!order) return json({ ok: false, error: 'order_not_found' }, 404, cors);
    if (order.room_service_status !== 'delivered')
      return json({ ok: false, error: 'not_delivered_yet' }, 400, cors);
    if (order.guest_confirmed_at)
      return json({ ok: true, already_confirmed: true }, 200, cors); // idempotent

    await db.from('veraluz_food_orders')
      .update({ guest_confirmed_at: new Date().toISOString() })
      .eq('id', orderId);

    return json({ ok: true }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // REVOKE_SESSION (employé)
  // ══════════════════════════════════════════════════════════════════
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


  // ══════════════════════════════════════════════════════════════════
  // PORTAL_OPEN — premier ouverture + comptage (guest authentifié)
  // Distingue "nouvelle ouverture" vs polling via le flag is_new_load
  // ══════════════════════════════════════════════════════════════════
  if (action === 'portal_open') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    const isNewLoad = body.is_new_load === true;
    const now = new Date().toISOString();
    const current = session!;

    const updates: Record<string, any> = { last_seen_at: now };

    if (!current.first_opened_at) {
      updates.first_opened_at = now;
      updates.open_count = 1;
    } else if (isNewLoad) {
      updates.open_count = (current.open_count ?? 0) + 1;
    }

    await db.from('veraluz_guest_sessions')
      .update(updates)
      .eq('id', current.id);

    // Log event si nouvelle ouverture
    if (!current.first_opened_at || isNewLoad) {
      await db.from('veraluz_guest_activity').insert({
        tenant_id:        'veraluz-001',
        guest_session_id: current.id,
        reservation_id:   current.reservation_id,
        event_type:       'portal_opened',
        metadata:         {},
      });
    }

    return json({ ok: true, first_open: !current.first_opened_at }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // LOG_ACTIVITY — allowlist stricte, metadata filtrée serveur
  // ══════════════════════════════════════════════════════════════════
  const ACTIVITY_ALLOWLIST = new Set([
    'portal_opened','restaurant_viewed','restaurant_order_created',
    'room_service_confirmed','feedback_opened','feedback_submitted',
    'folio_viewed',   // GUEST-4A
  ]);
  const ACTIVITY_ALLOWED_META_KEYS = new Set(['order_id','feedback_id','view_name']);

  if (action === 'log_activity') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    const eventType = body.event_type as string | undefined;
    if (!eventType || !ACTIVITY_ALLOWLIST.has(eventType))
      return json({ ok: false, error: 'invalid_event_type' }, 400, cors);

    // Filtrer metadata — uniquement clés autorisées, valeurs string/uuid
    const rawMeta = (body.metadata && typeof body.metadata === 'object') ? body.metadata as Record<string,any> : {};
    const safeMeta: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawMeta)) {
      if (ACTIVITY_ALLOWED_META_KEYS.has(k) && typeof v === 'string' && v.length < 100) {
        safeMeta[k] = v;
      }
    }

    // Update last_seen_at
    await db.from('veraluz_guest_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session!.id);

    await db.from('veraluz_guest_activity').insert({
      tenant_id:        'veraluz-001',
      guest_session_id: session!.id,
      reservation_id:   session!.reservation_id,
      event_type:       eventType,
      metadata:         safeMeta,
    });

    return json({ ok: true }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // SUBMIT_FEEDBACK — guest soumet un feedback
  // related_employee_id résolu SERVEUR depuis related_order_id
  // Aucune donnée identité client fiable depuis body
  // ══════════════════════════════════════════════════════════════════
  const FEEDBACK_CATEGORIES = new Set([
    'accueil','chambre_proprete','restaurant','room_service',
    'maintenance','facturation','securite','autre',
  ]);

  if (action === 'submit_feedback') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error, session } = await validateGuestToken(db, rawToken);
    if (error) return json({ ok: false, error, message: guestErrorMsg(error) }, 401, cors);

    if (!(session!.scopes as string[]).includes('stay.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    // Valider type
    const feedbackType = body.feedback_type as string | undefined;
    if (!feedbackType || !['review','complaint'].includes(feedbackType))
      return json({ ok: false, error: 'invalid_feedback_type' }, 400, cors);

    // Valider catégorie
    const category = body.category as string | undefined;
    if (!category || !FEEDBACK_CATEGORIES.has(category))
      return json({ ok: false, error: 'invalid_category' }, 400, cors);

    // Rating optionnel — validate range
    const ratingRaw = body.rating;
    let rating: number | null = null;
    if (ratingRaw !== undefined && ratingRaw !== null) {
      rating = Number(ratingRaw);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5)
        return json({ ok: false, error: 'invalid_rating' }, 400, cors);
    }

    // Commentaire optionnel — limiter longueur
    const rawComment = body.comment as string | undefined;
    let comment: string | null = null;
    if (rawComment) {
      if (rawComment.length > 2000)
        return json({ ok: false, error: 'comment_too_long', max: 2000 }, 400, cors);
      comment = rawComment;
    }

    const contactRequested = body.contact_requested === true;

    // related_order_id — valider isolation reservation_id
    let relatedOrderId: string | null = null;
    let relatedEmployeeId: string | null = null;

    const rawOrderId = body.related_order_id as string | undefined;
    if (rawOrderId) {
      const { data: ord } = await db
        .from('veraluz_food_orders')
        .select('id, room_service_employee_id, reservation_id')
        .eq('id', rawOrderId)
        .eq('reservation_id', session!.reservation_id) // isolation garantie serveur
        .eq('source', 'guest_portal')
        .maybeSingle();
      if (!ord) return json({ ok: false, error: 'order_not_found' }, 404, cors);
      relatedOrderId = ord.id;
      // Résolution serveur — jamais depuis client
      relatedEmployeeId = ord.room_service_employee_id ?? null;
    }

    // Calcul severity — 100% déterministe serveur
    let severity = 'normal';
    if (category === 'securite') {
      severity = (rating !== null && rating <= 2) ? 'critical' : 'high';
    } else if (rating !== null) {
      if (rating <= 2)      severity = 'high';
      else if (rating === 3) severity = 'attention';
    }
    if (contactRequested && severity === 'normal') severity = 'attention';

    const { data: fb, error: insErr } = await db
      .from('veraluz_guest_feedback')
      .insert({
        tenant_id:           'veraluz-001',
        guest_session_id:    session!.id,
        reservation_id:      session!.reservation_id, // jamais depuis client
        feedback_type:       feedbackType,
        category,
        rating,
        comment,
        related_order_id:    relatedOrderId,
        related_employee_id: relatedEmployeeId,
        severity,
        contact_requested:   contactRequested,
        status:              'new',
      })
      .select('id, severity')
      .single();

    if (insErr) {
      console.error('[guest-access] submit_feedback:', insErr.message);
      return json({ ok: false, error: 'feedback_create_failed' }, 500, cors);
    }

    // Log activité
    await db.from('veraluz_guest_activity').insert({
      tenant_id: 'veraluz-001', guest_session_id: session!.id,
      reservation_id: session!.reservation_id, event_type: 'feedback_submitted',
      metadata: { feedback_id: fb!.id },
    });

    return json({ ok: true, feedback_id: fb!.id, severity: fb!.severity, needs_attention: ['high','critical'].includes(fb!.severity) || contactRequested }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // LIST_FEEDBACK — direction uniquement
  // ══════════════════════════════════════════════════════════════════
  const DIRECTION_ROLES = new Set([
    'gerant','direction','directrice','manager','admin','superadmin',
  ]);

  if (action === 'list_feedback') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!DIRECTION_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const statusFilter  = body.status  as string | undefined;
    const severityFilter= body.severity as string | undefined;
    const limitReq      = Math.min(Number(body.limit) || 50, 100);

    let q = db.from('veraluz_guest_feedback')
      .select('id, reservation_id, feedback_type, category, rating, comment, severity, contact_requested, status, related_employee_id, created_at, acknowledged_at, resolved_at, resolution_note')
      .order('created_at', { ascending: false })
      .limit(limitReq);

    if (statusFilter)   q = q.eq('status', statusFilter);
    if (severityFilter) q = q.eq('severity', severityFilter);

    const { data: feedbacks, error: fErr } = await q;
    if (fErr) return json({ ok: false, error: 'list_failed' }, 500, cors);

    return json({ ok: true, feedbacks: feedbacks || [] }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // UPDATE_FEEDBACK_STATUS — direction uniquement
  // ══════════════════════════════════════════════════════════════════
  if (action === 'update_feedback_status') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!DIRECTION_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    const feedbackId   = body.feedback_id as string | undefined;
    const newStatus    = body.status as string | undefined;
    const resolutionNote = body.resolution_note as string | undefined;

    if (!feedbackId) return json({ ok: false, error: 'feedback_id_required' }, 400, cors);
    if (!newStatus || !['acknowledged','in_progress','resolved','closed'].includes(newStatus))
      return json({ ok: false, error: 'invalid_status' }, 400, cors);
    if (resolutionNote && resolutionNote.length > 1000)
      return json({ ok: false, error: 'resolution_note_too_long' }, 400, cors);

    const now = new Date().toISOString();
    const updates: Record<string, any> = { status: newStatus };
    if (newStatus === 'acknowledged' || newStatus === 'in_progress') {
      updates.acknowledged_at = now;
      updates.acknowledged_by = emp.id;
    }
    if (newStatus === 'resolved' || newStatus === 'closed') {
      updates.resolved_at = now;
      updates.resolved_by = emp.id;
      if (resolutionNote) updates.resolution_note = resolutionNote;
    }

    const { error: updErr } = await db
      .from('veraluz_guest_feedback')
      .update(updates)
      .eq('id', feedbackId);

    if (updErr) return json({ ok: false, error: 'update_failed' }, 500, cors);

    return json({ ok: true }, 200, cors);
  }

  // ══════════════════════════════════════════════════════════════════
  // GET_USAGE_STATS — direction, synthèse usage Guest Portal
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_usage_stats') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const emp = await validateEmployeeSession(db, sessionToken);
    if (!emp) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!DIRECTION_ROLES.has((emp.role ?? '').toLowerCase()))
      return json({ ok: false, error: 'insufficient_role' }, 403, cors);

    // Sessions actives
    const { data: sessions } = await db
      .from('veraluz_guest_sessions')
      .select('id, reservation_id, first_opened_at, last_seen_at, open_count, status, expires_at')
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(200);

    const allSessions = sessions || [];
    const total       = allSessions.length;
    const neverOpened = allSessions.filter(s => !s.first_opened_at).length;
    const opened      = total - neverOpened;

    // Activités récentes
    const cutoff24h = new Date(Date.now() - 86400000).toISOString();
    const { data: recentActs } = await db
      .from('veraluz_guest_activity')
      .select('event_type, guest_session_id')
      .gt('created_at', cutoff24h);

    const acts = recentActs || [];
    const restViewed  = new Set(acts.filter(a => a.event_type==='restaurant_viewed').map(a=>a.guest_session_id)).size;
    const orderCreate = acts.filter(a => a.event_type==='restaurant_order_created').length;

    // Feedbacks new/attention
    const { data: fbStats } = await db
      .from('veraluz_guest_feedback')
      .select('id, status, severity')
      .in('status', ['new','acknowledged','in_progress']);

    const fbs       = fbStats || [];
    const fbNew     = fbs.filter(f => f.status === 'new').length;
    const fbHigh    = fbs.filter(f => ['high','critical'].includes(f.severity)).length;

    return json({
      ok: true,
      stats: {
        active_sessions:     total,
        portal_opened:       opened,
        never_opened:        neverOpened,
        usage_rate_pct:      total > 0 ? Math.round((opened/total)*100) : 0,
        restaurant_viewed:   restViewed,
        orders_created_24h:  orderCreate,
        feedbacks_pending:   fbNew,
        feedbacks_high:      fbHigh,
      },
    }, 200, cors);
  }



  // ══════════════════════════════════════════════════════════════════
  // GET_MY_FOLIO — GUEST-4A
  // Scope: folio.read (attribué serveur-side dans GUEST_DEFAULT_SCOPES)
  // reservation_id / folio_id JAMAIS depuis le client — résolu depuis session
  // Statuts autorisés: confirmed (résumé), checkedin / checkedout (complet)
  // Cancelled / no_show: bloqué (folio_unavailable)
  // ══════════════════════════════════════════════════════════════════
  if (action === 'get_my_folio') {
    const rawToken = (body.token as string | undefined)
      ?? req.headers.get('x-guest-token') ?? '';
    const { error: tokErr, session } = await validateGuestToken(
      db,
      rawToken,
      ['confirmed','checkedin','checkedout'],
    );
    if (tokErr) return json({ ok: false, error: tokErr, message: guestErrorMsg(tokErr) }, 401, cors);

    if (!(session!.scopes as string[]).includes('folio.read'))
      return json({ ok: false, error: 'insufficient_scope' }, 403, cors);

    // ── Résoudre la réservation (serveur-side uniquement) ────────────
    const reservationId = session!.reservation_id;
    const { data: res, error: resErr } = await db
      .from('veraluz_reservations')
      .select('id, status, total, paid, check_in, check_out, nights, unit_id, client_name')
      .eq('id', reservationId)
      .single();

    if (resErr || !res) return json({ ok: false, error: 'reservation_not_found' }, 404, cors);

    const st = res.status as string;

    // Bloqué: cancelled / no_show
    if (['cancelled','no_show'].includes(st))
      return json({ ok: false, error: 'folio_unavailable', status: st }, 403, cors);

    // ── Hébergement (source canonique: reservation.total) ────────────
    const accommodation: number = res.total ?? 0;
    const payments: number      = res.paid  ?? 0;

    // ── CONFIRMED: résumé pré-séjour uniquement (pas de charges séjour encore) ─
    if (st === 'confirmed') {
      const balance = accommodation - payments;
      return json({
        ok: true,
        mode: 'pre_stay',
        reservation: {
          status:    st,
          check_in:  res.check_in,
          check_out: res.check_out,
          nights:    res.nights ?? 1,
          unit_id:   res.unit_id,
        },
        summary: {
          accommodation,
          restaurant: 0,
          other:       0,
          total:       accommodation,
          payments,
          balance,
          is_settled:  balance <= 0,
        },
        charges: [],
      }, 200, cors);
    }

    // ── CHECKEDIN / CHECKEDOUT: folio complet ────────────────────────
    const { data: rawCharges, error: cErr } = await db
      .from('veraluz_room_charges')
      .select('id, created_at, posted_at, charge_type, label, description, amount, restaurant_order_id, reversal_of_charge_id')
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: true });

    if (cErr) return json({ ok: false, error: 'charges_unavailable' }, 500, cors);

    const charges = rawCharges ?? [];

    // ── Calcul canonique (identique Finance / RESERVATIONS_EMBEDDED) ─
    const restaurant: number = charges
      .filter(c => (c.charge_type ?? 'restaurant') === 'restaurant')
      .reduce((s: number, c: any) => s + (c.amount ?? 0), 0);

    const other: number = charges
      .filter(c => (c.charge_type ?? 'restaurant') !== 'restaurant')
      .reduce((s: number, c: any) => s + (c.amount ?? 0), 0);

    const total   = accommodation + restaurant + other;
    const balance = total - payments;

    // ── Détail charges exposé au guest (sans données internes) ───────
    const chargesForGuest = charges.map((c: any) => ({
      id:           c.id,
      date:         (c.posted_at ?? c.created_at ?? '').slice(0, 10),
      charge_type:  c.charge_type ?? 'restaurant',
      label:        c.label ?? c.description ?? 'Charge',
      amount:       c.amount ?? 0,
      order_ref:    c.restaurant_order_id
                      ? c.restaurant_order_id.slice(-10).toUpperCase()
                      : null,
      is_reversal:  !!c.reversal_of_charge_id,
    }));

    return json({
      ok: true,
      mode: 'full',
      reservation: {
        status:    st,
        check_in:  res.check_in,
        check_out: res.check_out,
        nights:    res.nights ?? 1,
        unit_id:   res.unit_id,
      },
      summary: {
        accommodation,
        restaurant,
        other,
        total,
        payments,
        balance,
        is_settled: balance <= 0,
      },
      charges: chargesForGuest,
    }, 200, cors);
  }

  return json({ error: 'unknown_action' }, 400, cors);
});
