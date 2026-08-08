import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INTERNAL_SECRET = Deno.env.get('VERALUZ_AGENT_INTERNAL_SECRET') || '';
const ALLOWED_ROLES = ['gerant','admin','superadmin','technicien'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!INTERNAL_SECRET) return new Response(JSON.stringify({ error: 'secret_not_configured' }), { status: 500 });
  const secret = req.headers.get('x-internal-secret');
  if (secret !== INTERNAL_SECRET) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });

  const SB_URL = Deno.env.get('SUPABASE_URL')!;
  const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SB_URL, SB_SERVICE);
  const body = await req.json();
  const { employee, operational_mode } = body;
  const t0 = Date.now();

  if (employee && !ALLOWED_ROLES.includes(employee.role)) {
    return new Response(JSON.stringify({ error: 'role_not_allowed', role: employee.role }), { status: 403 });
  }

  try {
    const { data: units } = await admin.from('veraluz_units').select('id, name, status, type, floor').limit(50);
    const { data: hk } = await admin.from('veraluz_housekeeping').select('id, unit_id, status, priority, assigned_to').limit(100);

    const byStatus: Record<string, number> = {};
    units?.forEach((u: any) => { byStatus[u.status] = (byStatus[u.status] || 0) + 1; });

    const hkPending = hk?.filter((h: any) => h.status === 'pending') || [];
    const hkHighPri = hk?.filter((h: any) => h.priority === 'high' && h.status === 'pending') || [];
    const hkInProgress = hk?.filter((h: any) => h.status === 'in_progress') || [];

    return new Response(JSON.stringify({
      agent: 'maintenance_v1',
      display_name: 'Maintenance — Technique',
      operational_mode,
      data: {
        units: { total: units?.length || 0, by_status: byStatus, out_of_service: byStatus['out_of_service'] || 0, available: byStatus['available'] || 0, occupied: byStatus['occupied'] || 0 },
        housekeeping: { total_tasks: hk?.length || 0, pending: hkPending.length, in_progress: hkInProgress.length, high_priority: hkHighPri.length }
      },
      sources: ['veraluz_units','veraluz_housekeeping'],
      limits: ['veraluz_maintenance_tickets not yet created'],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
