/**
 * room-service — GUEST-3.2
 * Actions employé : list_on_duty_employees, assign_room_service,
 *                   accept_room_service, depart_room_service,
 *                   deliver_room_service, get_my_room_service_tasks
 *
 * Sécurité :
 *   - employee_id TOUJOURS issu de validateEmployeeSession() — jamais du body
 *   - Service role key côté serveur uniquement
 *   - assign : seul un employé authentifié peut assigner ; target validé on-duty
 *   - accept/depart/deliver : seul l'employé assigné peut progresser son ordre
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SVC_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-veraluz-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateEmployeeSession(db: any, token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const hash = await sha256hex(token);
  const { data } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  return data.employee_id as string;
}

function todayStartUTC(): string {
  // Africa/Douala = UTC+1, pas de DST
  const nowUtc = Date.now();
  const localMs = nowUtc + 3600000;
  const utcMidnight = localMs - (localMs % 86400000) - 3600000;
  return new Date(utcMidnight).toISOString();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const action = body.action as string | undefined;
  if (!action) return json({ ok: false, error: 'action_required' }, 400);

  const sessionToken = req.headers.get('x-veraluz-session')
    ?? (body.session_token as string | undefined) ?? '';

  try {

    // ============================================================
    // list_on_duty_employees
    // ============================================================
    if (action === 'list_on_duty_employees') {
      const { data: settings } = await db
        .from('veraluz_settings').select('value').eq('key', 'restaurant').maybeSingle();
      const allowedRoles: string[] = (settings?.value)?.room_service_allowed_roles
        ?? ['barman', 'femme_chambre', 'gerant', 'receptionniste', 'staff'];

      const { data: checkins } = await db
        .from('veraluz_employee_checkins')
        .select('employee_id, employee_name, role')
        .eq('checkin_type', 'shift_start')
        .in('role', allowedRoles)
        .gte('created_at', todayStartUTC())
        .order('created_at', { ascending: false });

      if (!checkins?.length) return json({ ok: true, employees: [] });

      const seen = new Set<string>();
      const unique = (checkins as any[]).filter(c => {
        if (seen.has(c.employee_id)) return false;
        seen.add(c.employee_id); return true;
      });

      const empIds = unique.map((c: any) => c.employee_id);
      const { data: employees } = await db
        .from('veraluz_employees')
        .select('id, public_display_name, public_role_label, status')
        .in('id', empIds).eq('status', 'active');

      const empMap: Record<string, any> = {};
      (employees ?? []).forEach((e: any) => { empMap[e.id] = e; });

      return json({
        ok: true,
        employees: unique.map((c: any) => {
          const emp = empMap[c.employee_id] ?? {};
          return {
            employee_id:  c.employee_id,
            display_name: emp.public_display_name || c.employee_name || 'Employe',
            role_label:   emp.public_role_label   || c.role          || '',
          };
        }),
      });
    }

    // Toutes les autres actions : session requise
    const employeeId = await validateEmployeeSession(db, sessionToken);
    if (!employeeId) return json({ ok: false, error: 'session_required' }, 401);

    // ============================================================
    // get_my_room_service_tasks
    // ============================================================
    if (action === 'get_my_room_service_tasks') {
      const { data: tasks } = await db
        .from('veraluz_food_orders')
        .select('id,order_number,status,room_service_status,room_service_assigned_at,room_service_accepted_at,room_service_departed_at,room_number,customer_name,items,notes,total')
        .eq('room_service_employee_id', employeeId)
        .in('room_service_status', ['assigned', 'accepted', 'on_the_way'])
        .order('room_service_assigned_at', { ascending: true });

      return json({ ok: true, tasks: tasks ?? [] });
    }

    // ============================================================
    // assign_room_service
    // ============================================================
    if (action === 'assign_room_service') {
      const orderId          = body.order_id           as string | undefined;
      const targetEmployeeId = body.target_employee_id as string | undefined;
      if (!orderId || !targetEmployeeId)
        return json({ ok: false, error: 'order_id_and_target_employee_id_required' }, 400);

      const { data: order } = await db
        .from('veraluz_food_orders')
        .select('id, delivery_type, status, room_service_employee_id')
        .eq('id', orderId).maybeSingle();

      if (!order)                         return json({ ok: false, error: 'order_not_found'  }, 404);
      if (order.delivery_type !== 'room') return json({ ok: false, error: 'not_room_service' }, 400);
      if (order.status !== 'ready')       return json({ ok: false, error: 'order_not_ready'  }, 400);
      if (order.room_service_employee_id) return json({ ok: false, error: 'already_assigned' }, 409);

      const { data: checkin } = await db
        .from('veraluz_employee_checkins')
        .select('employee_id')
        .eq('employee_id', targetEmployeeId)
        .eq('checkin_type', 'shift_start')
        .gte('created_at', todayStartUTC())
        .maybeSingle();

      if (!checkin) return json({ ok: false, error: 'employee_not_on_duty' }, 400);

      const { error } = await db
        .from('veraluz_food_orders')
        .update({
          room_service_employee_id: targetEmployeeId,
          room_service_status:      'assigned',
          room_service_assigned_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .is('room_service_employee_id', null);

      if (error) return json({ ok: false, error: 'assign_failed' }, 500);
      return json({ ok: true });
    }

    // ============================================================
    // accept_room_service
    // ============================================================
    if (action === 'accept_room_service') {
      const orderId = body.order_id as string | undefined;
      if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400);

      const { data: order } = await db
        .from('veraluz_food_orders')
        .select('id, room_service_employee_id, room_service_status')
        .eq('id', orderId).maybeSingle();

      if (!order)                                        return json({ ok: false, error: 'order_not_found' }, 404);
      if (order.room_service_employee_id !== employeeId) return json({ ok: false, error: 'not_your_task'  }, 403);
      if (order.room_service_status !== 'assigned')      return json({ ok: false, error: 'invalid_status' }, 400);

      await db.from('veraluz_food_orders').update({
        room_service_status:      'accepted',
        room_service_accepted_at: new Date().toISOString(),
      }).eq('id', orderId);

      return json({ ok: true });
    }

    // ============================================================
    // depart_room_service
    // ============================================================
    if (action === 'depart_room_service') {
      const orderId = body.order_id as string | undefined;
      if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400);

      const { data: order } = await db
        .from('veraluz_food_orders')
        .select('id, room_service_employee_id, room_service_status')
        .eq('id', orderId).maybeSingle();

      if (!order)                                        return json({ ok: false, error: 'order_not_found' }, 404);
      if (order.room_service_employee_id !== employeeId) return json({ ok: false, error: 'not_your_task'  }, 403);
      if (!['assigned', 'accepted'].includes(order.room_service_status as string))
        return json({ ok: false, error: 'invalid_status' }, 400);

      await db.from('veraluz_food_orders').update({
        room_service_status:      'on_the_way',
        room_service_departed_at: new Date().toISOString(),
      }).eq('id', orderId);

      return json({ ok: true });
    }

    // ============================================================
    // deliver_room_service
    // ============================================================
    if (action === 'deliver_room_service') {
      const orderId = body.order_id as string | undefined;
      if (!orderId) return json({ ok: false, error: 'order_id_required' }, 400);

      const { data: order } = await db
        .from('veraluz_food_orders')
        .select('id, room_service_employee_id, room_service_status')
        .eq('id', orderId).maybeSingle();

      if (!order)                                        return json({ ok: false, error: 'order_not_found' }, 404);
      if (order.room_service_employee_id !== employeeId) return json({ ok: false, error: 'not_your_task'  }, 403);
      if (order.room_service_status !== 'on_the_way')   return json({ ok: false, error: 'invalid_status' }, 400);

      await db.from('veraluz_food_orders').update({
        room_service_status:       'delivered',
        room_service_delivered_at: new Date().toISOString(),
        status:                    'delivered',
        delivered_at:              new Date().toISOString(),
      }).eq('id', orderId);

      return json({ ok: true });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);

  } catch (err) {
    console.error('[room-service] unhandled:', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});
