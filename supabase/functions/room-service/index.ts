/**
 * room-service — Recovery Lot C
 * Canonical workflow for Guest Portal room-service orders.
 * Actor identity always comes from the validated Veraluz employee session.
 * All state changes are compare-and-set. The Lot C database trigger creates
 * the matching room charge in the same transaction as delivery.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability } from './_rbac.ts';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-veraluz-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Actor = { employeeId: string; role: string; displayName: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function validateEmployeeSession(db: any, token: string): Promise<Actor | null> {
  if (!token || token.length < 16) return null;
  const { data: session } = await db.from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', await sha256hex(token)).maybeSingle();
  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) return null;

  const { data: employee } = await db.from('veraluz_employees')
    .select('id, role, status, full_name, public_display_name')
    .eq('id', session.employee_id).maybeSingle();
  if (!employee || !['actif', 'active'].includes(String(employee.status || '').toLowerCase())) return null;
  return {
    employeeId: String(employee.id),
    role: normalizeRole(employee.role),
    displayName: employee.public_display_name || employee.full_name || 'Employé',
  };
}

function todayStartUTC(): string {
  // Africa/Douala = UTC+1 year-round.
  const localMs = Date.now() + 3_600_000;
  return new Date(localMs - (localMs % 86_400_000) - 3_600_000).toISOString();
}

async function currentOnDutyEmployees(db: any) {
  const { data: rows, error } = await db.from('veraluz_employee_checkins')
    .select('employee_id, employee_name, role, checkin_type, created_at')
    .gte('created_at', todayStartUTC()).order('created_at', { ascending: false });
  if (error) throw error;
  const latest = new Map<string, any>();
  for (const row of rows || []) {
    const id = String(row.employee_id || '');
    if (id && !latest.has(id)) latest.set(id, row);
  }
  return [...latest.values()].filter((row) => row.checkin_type === 'shift_start');
}

async function isOnDuty(db: any, employeeId: string) {
  return (await currentOnDutyEmployees(db))
    .some((row) => String(row.employee_id) === String(employeeId));
}

const ORDER_SELECT = 'id,order_number,source,delivery_type,payment_method,payment_status,status,reservation_id,unit_id,total,room_number,room_service_employee_id,room_service_status,room_service_assigned_at,livreur_id,assigned_to,assigned_at,delivery_status,accepted_at,picked_up_at,out_for_delivery_at,arrived_at,delivered_at';

async function loadRoomOrder(db: any, orderId: string) {
  const { data, error } = await db.from('veraluz_food_orders')
    .select(ORDER_SELECT).eq('id', orderId).maybeSingle();
  if (error) throw error;
  return data;
}

function invalidRoomOrder(order: any): string | null {
  if (!order) return 'order_not_found';
  if (order.source !== 'guest_portal' || order.delivery_type !== 'room') return 'not_guest_room_service';
  if (order.payment_method !== 'room_charge') return 'not_room_charge';
  return null;
}

async function ensureRoomCharge(db: any, orderId: string, postedBy: string) {
  const { data, error } = await db.rpc('veraluz_create_food_order_room_charge', {
    p_order_id: orderId,
    p_posted_by: postedBy,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function cas(db: any, orderId: string, filters: Record<string, any>, patch: Record<string, any>) {
  let query = db.from('veraluz_food_orders').update(patch).eq('id', orderId);
  for (const [key, value] of Object.entries(filters)) {
    query = value === null ? query.is(key, null) : query.eq(key, value);
  }
  const { data, error } = await query.select(ORDER_SELECT).maybeSingle();
  if (error) throw error;
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const action = String(body.action || '');
  const token = req.headers.get('x-veraluz-session')
    ?? (body.session_token as string | undefined) ?? '';

  try {
    const actor = await validateEmployeeSession(db, token);
    if (!actor) return json({ ok: false, error: 'session_required' }, 401);

    if (action === 'list_on_duty_employees') {
      if (!hasCapability(actor.role, 'restaurant.room_service')
          && !hasCapability(actor.role, 'reservations.read')
          && !hasCapability(actor.role, 'employees.directory')) {
        return json({ ok: false, error: 'forbidden' }, 403);
      }
      const { data: settings } = await db.from('veraluz_settings')
        .select('value').eq('key', 'restaurant').maybeSingle();
      const allowedRoles: string[] = settings?.value?.room_service_allowed_roles
        ?? ['barman', 'femme_chambre', 'livreur', 'gerant', 'receptionniste', 'staff'];
      const onDuty = (await currentOnDutyEmployees(db))
        .filter((row) => allowedRoles.includes(normalizeRole(row.role)));
      if (!onDuty.length) return json({ ok: true, employees: [] });
      const { data: employees, error } = await db.from('veraluz_employees')
        .select('id,public_display_name,public_role_label,full_name,status')
        .in('id', onDuty.map((row) => row.employee_id)).in('status', ['active', 'actif']);
      if (error) throw error;
      const byId = new Map((employees || []).map((employee: any) => [String(employee.id), employee]));
      return json({ ok: true, employees: onDuty.map((row) => {
        const employee: any = byId.get(String(row.employee_id)) || {};
        return {
          employee_id: String(row.employee_id),
          display_name: employee.public_display_name || employee.full_name || row.employee_name || 'Employé',
          role_label: employee.public_role_label || row.role || '',
        };
      }) });
    }

    if (action === 'get_my_room_service_tasks') {
      const { data, error } = await db.from('veraluz_food_orders')
        .select('id,order_number,status,delivery_status,room_service_status,room_service_assigned_at,room_service_accepted_at,room_service_departed_at,room_number,customer_name,items,notes,total')
        .eq('source', 'guest_portal').eq('delivery_type', 'room')
        .eq('room_service_employee_id', actor.employeeId)
        .in('room_service_status', ['assigned', 'accepted', 'on_the_way'])
        .order('room_service_assigned_at', { ascending: true });
      if (error) throw error;
      return json({ ok: true, tasks: data || [] });
    }

    const orderId = String(body.order_id || '');
    if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400);
    let order = await loadRoomOrder(db, orderId);
    const invalid = invalidRoomOrder(order);
    if (invalid) return json({ ok: false, error: invalid }, invalid === 'order_not_found' ? 404 : 400);

    if (action === 'advance_room_order') {
      if (!hasCapability(actor.role, 'restaurant.order') && !hasCapability(actor.role, 'restaurant.stock')) {
        return json({ ok: false, error: 'forbidden' }, 403);
      }
      const target = String(body.target_status || '');
      const allowed = target === 'confirmed' ? order.status === 'pending'
        : target === 'preparing' ? ['pending', 'confirmed'].includes(order.status)
        : target === 'ready' ? order.status === 'preparing' : false;
      if (!allowed) return json({ ok: false, error: 'invalid_status_transition' }, 409);
      const changed = await cas(db, orderId, { status: order.status }, {
        status: target,
        ...(target === 'ready' ? { delivery_status: 'waiting_assignment' } : {}),
      });
      return changed ? json({ ok: true, order: changed })
        : json({ ok: false, error: 'concurrent_transition' }, 409);
    }

    if (action === 'assign_room_service') {
      if (!hasCapability(actor.role, 'restaurant.assign')) return json({ ok: false, error: 'forbidden' }, 403);
      const targetId = String(body.target_employee_id || '');
      if (!targetId) return json({ ok: false, error: 'target_employee_id_required' }, 400);
      if (order.status !== 'ready') return json({ ok: false, error: 'order_not_ready' }, 409);
      if (order.room_service_employee_id) return json({ ok: false, error: 'already_assigned' }, 409);
      if (!(await isOnDuty(db, targetId))) return json({ ok: false, error: 'employee_not_on_duty' }, 400);
      const { data: employee } = await db.from('veraluz_employees')
        .select('id,full_name,public_display_name,status').eq('id', targetId)
        .in('status', ['active', 'actif']).maybeSingle();
      if (!employee) return json({ ok: false, error: 'employee_not_active' }, 400);
      const now = new Date().toISOString();
      const displayName = employee.public_display_name || employee.full_name || 'Employé';
      const changed = await cas(db, orderId, { status: 'ready', room_service_employee_id: null }, {
        room_service_employee_id: targetId,
        room_service_status: 'assigned',
        room_service_assigned_at: now,
        livreur_id: targetId,
        assigned_to: displayName,
        assigned_at: now,
        delivery_status: 'assigned',
      });
      return changed ? json({ ok: true, order: changed })
        : json({ ok: false, error: 'concurrent_assignment' }, 409);
    }

    if (action === 'claim_room_service') {
      if (!hasCapability(actor.role, 'restaurant.room_service')) return json({ ok: false, error: 'forbidden' }, 403);
      if (!(await isOnDuty(db, actor.employeeId))) return json({ ok: false, error: 'employee_not_on_duty' }, 400);
      if (order.status !== 'ready') return json({ ok: false, error: 'order_not_ready' }, 409);
      if (order.room_service_employee_id === actor.employeeId
          && ['accepted', 'on_the_way', 'delivered'].includes(order.room_service_status)) {
        return json({ ok: true, idempotent: true, order });
      }
      if (order.room_service_employee_id && order.room_service_employee_id !== actor.employeeId) {
        return json({ ok: false, error: 'already_assigned' }, 409);
      }
      const now = new Date().toISOString();
      const changed = await cas(db, orderId, {
        status: 'ready',
        room_service_employee_id: order.room_service_employee_id || null,
      }, {
        room_service_employee_id: actor.employeeId,
        room_service_status: 'accepted',
        room_service_assigned_at: order.room_service_assigned_at || now,
        room_service_accepted_at: now,
        livreur_id: actor.employeeId,
        assigned_to: actor.displayName,
        assigned_at: order.assigned_at || now,
        accepted_at: now,
        delivery_status: 'accepted_by_driver',
      });
      return changed ? json({ ok: true, order: changed })
        : json({ ok: false, error: 'concurrent_assignment' }, 409);
    }

    if (order.room_service_employee_id !== actor.employeeId || order.livreur_id !== actor.employeeId) {
      return json({ ok: false, error: 'not_your_task' }, 403);
    }

    if (action === 'accept_room_service') {
      if (order.room_service_status === 'accepted') return json({ ok: true, idempotent: true, order });
      if (order.room_service_status !== 'assigned') return json({ ok: false, error: 'invalid_status' }, 409);
      const now = new Date().toISOString();
      const changed = await cas(db, orderId, {
        room_service_employee_id: actor.employeeId, room_service_status: 'assigned',
      }, {
        room_service_status: 'accepted', room_service_accepted_at: now,
        accepted_at: now, delivery_status: 'accepted_by_driver',
      });
      return changed ? json({ ok: true, order: changed }) : json({ ok: false, error: 'concurrent_transition' }, 409);
    }

    if (action === 'pickup_room_service') {
      if (order.room_service_status !== 'accepted') return json({ ok: false, error: 'invalid_status' }, 409);
      if (order.picked_up_at) return json({ ok: true, idempotent: true, order });
      const now = new Date().toISOString();
      const changed = await cas(db, orderId, {
        room_service_employee_id: actor.employeeId, room_service_status: 'accepted', picked_up_at: null,
      }, { picked_up_at: now, delivery_status: 'picked_up' });
      return changed ? json({ ok: true, order: changed }) : json({ ok: false, error: 'concurrent_transition' }, 409);
    }

    if (action === 'depart_room_service') {
      if (order.room_service_status === 'on_the_way') return json({ ok: true, idempotent: true, order });
      if (order.room_service_status !== 'accepted') return json({ ok: false, error: 'invalid_status' }, 409);
      const now = new Date().toISOString();
      const changed = await cas(db, orderId, {
        room_service_employee_id: actor.employeeId, room_service_status: 'accepted',
      }, {
        room_service_status: 'on_the_way', room_service_departed_at: now,
        out_for_delivery_at: now, delivery_status: 'out_for_delivery', status: 'out_for_delivery',
      });
      return changed ? json({ ok: true, order: changed }) : json({ ok: false, error: 'concurrent_transition' }, 409);
    }

    if (action === 'arrive_room_service') {
      if (order.room_service_status !== 'on_the_way') return json({ ok: false, error: 'invalid_status' }, 409);
      if (order.arrived_at) return json({ ok: true, idempotent: true, order });
      const now = new Date().toISOString();
      const changed = await cas(db, orderId, {
        room_service_employee_id: actor.employeeId, room_service_status: 'on_the_way', arrived_at: null,
      }, { arrived_at: now, delivery_status: 'arrived' });
      return changed ? json({ ok: true, order: changed }) : json({ ok: false, error: 'concurrent_transition' }, 409);
    }

    if (action === 'deliver_room_service') {
      if (order.room_service_status === 'delivered' && order.status === 'delivered') {
        return json({ ok: true, idempotent: true, order,
          charge: await ensureRoomCharge(db, orderId, actor.employeeId) });
      }
      if (order.room_service_status !== 'on_the_way') return json({ ok: false, error: 'invalid_status' }, 409);
      const now = new Date().toISOString();
      const photoUrl = typeof body.photo_url === 'string' ? body.photo_url : null;
      try {
        order = await cas(db, orderId, {
          room_service_employee_id: actor.employeeId, room_service_status: 'on_the_way',
        }, {
          room_service_status: 'delivered', room_service_delivered_at: now,
          status: 'delivered', delivery_status: 'delivered', delivered_at: now,
          payment_status: 'charged', ...(photoUrl ? { proof_photo_url: photoUrl } : {}),
        });
      } catch (error) {
        console.error('[room-service] delivery transaction failed:', error instanceof Error ? error.message : error);
        return json({ ok: false, error: 'deliver_failed' }, 409);
      }
      if (!order) return json({ ok: false, error: 'concurrent_transition' }, 409);
      return json({ ok: true, order,
        charge: await ensureRoomCharge(db, orderId, actor.employeeId) });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (error) {
    console.error('[room-service] unhandled:', error instanceof Error ? error.message : error);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});
