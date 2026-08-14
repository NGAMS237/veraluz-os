/**
 * GUEST-3 — guest-access Edge Function v3
 * Restaurant Room Service + suivi commandes
 *
 * Nouveautés v3:
 *   get_restaurant_menu        — menu public room_service (actif + disponible)
 *   create_restaurant_order    — commande Room Service sécurisée (checkedin requis)
 *   get_my_restaurant_orders   — commandes du séjour (isolation stricte par guest_session)
 *
 * Scopes ajoutés aux nouvelles sessions:
 *   restaurant.read, restaurant.order, restaurant.orders.read
 *
 * Règles sécurité:
 *   - reservation_id / unit_id jamais depuis le body client
 *   - price / total jamais depuis le body client (prix DB uniquement)
 *   - commande uniquement si reservation.status = 'checkedin'
 *   - idempotence: (guest_session_id, client_order_key) unique en DB
 *   - isolation: get_my_restaurant_orders filtre par session.reservation_id
 *   - room_service_enabled obligatoire sur le produit
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

    const S        = settingsData;
    const wifi     = S['wifi']       || {};
    const property = S['property']   || {};
    const booking  = S['booking']    || {};
    const contact  = S['contact']    || {};
    const rest     = S['restaurant'] || {};

    const wifiEnabled    = wifi.enabled !== false;
    const canSeePassword = resStatus === 'checkedin';
    const wifiPayload    = wifiEnabled ? {
      enabled:            true,
      ssid:               wifi.ssid || null,
      password:           canSeePassword ? (wifi.password || null) : null,
      password_available: canSeePassword,
      hint: !canSeePassword ? "Le code Wi-Fi sera disponible après votre arrivée." : null,
    } : { enabled: false };

    return json({
      ok: true,
      stay: {
        property_name:     property.name     || PROPERTY_NAME,
        property_tagline:  property.tagline  || '',
        property_location: property.location || 'Kribi, Cameroun',
        guest_first_name:  firstName,
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

  return json({ error: 'unknown_action' }, 400, cors);
});
