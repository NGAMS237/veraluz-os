/**
 * MICRO 011D-2F — post-restaurant-folio Edge Function
 * Secure folio posting via real Veraluz employee session.
 *
 * Auth flow:
 *   CORE → veraluzSecureRequest('post-restaurant-folio', {order_id})
 *         → adds X-Veraluz-Session + session_token in body
 *   Edge Function → validateSession() → employee_id + role (server-side)
 *   Edge Function → calls SQL logic directly via service_role
 *
 * NEVER trusts employee_id from the client payload.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080'
];

const ALLOWED_ROLES = new Set([
  'restaurant', 'barman', 'gerant', 'manager', 'direction', 'admin',
  'directrice', 'reception', 'receptionniste',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra }
  });
}

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateSession(
  admin: ReturnType<typeof createClient>,
  token: string
): Promise<{ employee_id: string; role: string } | null> {
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();

  const { data: sess } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .single();

  if (!sess) return null;

  const { data: emp } = await admin
    .from('veraluz_employees')
    .select('role, status')
    .eq('id', sess.employee_id)
    .single();

  if (!emp || !['actif', 'active'].includes(String(emp.status || '').toLowerCase())) return null;

  return { employee_id: sess.employee_id, role: emp.role || 'staff' };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const SB_URL     = Deno.env.get('SUPABASE_URL')!;
  const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SB_URL, SB_SERVICE);

  try {
    // ── 1. Parse body ───────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));

    // session_token may come from header (set by broker) or body
    const sessionToken =
      req.headers.get('x-veraluz-session') ||
      body.session_token ||
      null;

    // ── 2. Validate session — server-side only ──────────────────────
    if (!sessionToken) {
      return json({ ok: false, error: 'session_token_required' }, 401, cors);
    }

    const session = await validateSession(admin, sessionToken);
    if (!session) {
      return json({ ok: false, error: 'invalid_or_expired_session' }, 401, cors);
    }

    // ── 3. Role check ───────────────────────────────────────────────
    if (!ALLOWED_ROLES.has(session.role)) {
      return json({ ok: false, error: `role_insuffisant: ${session.role}` }, 403, cors);
    }

    // ── 4. Validate payload — order_id only, employee_id from SESSION ─
    const order_id: string | undefined = body.order_id;
    if (!order_id || typeof order_id !== 'string') {
      return json({ ok: false, error: 'order_id_requis' }, 400, cors);
    }

    // Recovery Lot C: Guest Portal room orders use veraluz_food_orders as
    // their one operational SSOT. The database RPC is the same idempotent
    // authority used by the delivery trigger and by room-service retries.
    if (UUID_RE.test(order_id)) {
      const { data: foodOrder, error: foodErr } = await admin
        .from('veraluz_food_orders')
        .select('id, source, delivery_type, payment_method, status')
        .eq('id', order_id)
        .maybeSingle();

      if (foodErr) {
        return json({ ok: false, error: 'commande_food_indisponible' }, 500, cors);
      }

      if (foodOrder) {
        if (foodOrder.source !== 'guest_portal'
            || foodOrder.delivery_type !== 'room'
            || foodOrder.payment_method !== 'room_charge') {
          return json({ ok: false, error: 'commande_non_room_service' }, 400, cors);
        }
        if (foodOrder.status !== 'delivered') {
          return json({ ok: false, error: `commande_non_finalisee: ${foodOrder.status}` }, 400, cors);
        }

        const { data: chargeRows, error: chargeErr } = await admin.rpc(
          'veraluz_create_food_order_room_charge',
          { p_order_id: order_id, p_posted_by: session.employee_id },
        );
        if (chargeErr) {
          console.error('[post-restaurant-folio] food charge error:', chargeErr.message);
          return json({ ok: false, error: 'erreur_insertion_charge' }, 500, cors);
        }
        const charge = Array.isArray(chargeRows) ? chargeRows[0] : chargeRows;
        return json({
          ok: true,
          charge_id: charge?.charge_id,
          amount: charge?.amount,
          reservation_id: charge?.reservation_id,
          idempotent: charge?.idempotent ?? false,
          order_source: 'veraluz_food_orders',
          posted_by: session.employee_id,
        }, 200, cors);
      }
    }

    // ── 5. Load order via service_role (no RLS bypass needed — service_role) ─
    const { data: order, error: orderErr } = await admin
      .from('veraluz_restaurant_orders')
      .select('id, type, status, reservation_id, unit_id, total, items_json')
      .eq('id', order_id)
      .single();

    if (orderErr || !order) {
      return json({ ok: false, error: `commande_introuvable: ${order_id}` }, 404, cors);
    }

    if (order.type !== 'room') {
      return json({ ok: false, error: 'commande_non_room_service' }, 400, cors);
    }

    if (!order.reservation_id || !order.unit_id) {
      return json({ ok: false, error: 'reservation_id_ou_unit_id_manquant' }, 400, cors);
    }

    if (!['remis', 'paye', 'delivered'].includes(order.status)) {
      return json({ ok: false, error: `commande_non_finalisee: ${order.status}` }, 400, cors);
    }

    // ── 6. Idempotency — check existing charge ──────────────────────
    const { data: existing } = await admin
      .from('veraluz_room_charges')
      .select('id, amount, reservation_id')
      .eq('restaurant_order_id', order_id)
      .is('reversal_of_charge_id', null)
      .single();

    if (existing) {
      return json({
        ok: true,
        idempotent: true,
        charge_id: existing.id,
        amount: existing.amount,
        reservation_id: existing.reservation_id
      }, 200, cors);
    }

    // ── 7. Verify reservation is checked in ─────────────────────────
    const { data: rez } = await admin
      .from('veraluz_reservations')
      .select('id, unit_id, status')
      .eq('id', order.reservation_id)
      .single();

    if (!rez || rez.status !== 'checkedin') {
      return json({ ok: false, error: 'reservation_non_checkedin' }, 400, cors);
    }

    if (rez.unit_id !== order.unit_id) {
      return json({ ok: false, error: 'unit_id_ne_correspond_pas' }, 400, cors);
    }

    // ── 8. Build label ──────────────────────────────────────────────
    const itemsText = order.items_json
      ? (' — ' + JSON.stringify(order.items_json).substring(0, 60))
      : '';
    const label = `Room Service #${order_id.substring(0, 8)}${itemsText}`;

    // ── 9. Insert room_charge via service_role ──────────────────────
    const chargeId = crypto.randomUUID();
    const { data: charge, error: insertErr } = await admin
      .from('veraluz_room_charges')
      .insert({
        id: chargeId,
        reservation_id: order.reservation_id,
        unit_id: order.unit_id,
        charge_type: 'restaurant',
        amount: order.total ?? 0,
        description: label,
        label: label,
        restaurant_order_id: order_id,
        posted_by: session.employee_id,  // from validated session, not client
        posted_at: new Date().toISOString()
      })
      .select('id, amount, reservation_id')
      .single();

    if (insertErr) {
      console.error('[post-restaurant-folio] insert error:', insertErr);
      return json({ ok: false, error: 'erreur_insertion_charge' }, 500, cors);
    }

    return json({
      ok: true,
      charge_id: charge!.id,
      amount: charge!.amount,
      reservation_id: charge!.reservation_id,
      posted_by: session.employee_id
    }, 200, cors);

  } catch (err) {
    console.error('[post-restaurant-folio] unexpected error:', err);
    return json({ ok: false, error: 'internal_error' }, 500, cors);
  }
});
