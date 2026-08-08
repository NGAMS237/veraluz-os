import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INTERNAL_SECRET = Deno.env.get('VERALUZ_AGENT_INTERNAL_SECRET') || '';
const ALLOWED_ROLES = ['gerant','admin','superadmin','receptionniste'];

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
    const today = new Date().toISOString().split('T')[0];
    const { data: res } = await admin.from('veraluz_reservations').select('id, status, check_in, check_out').limit(200);
    const { data: units } = await admin.from('veraluz_units').select('id, name, status, type').limit(50);

    const active = res?.filter((r: any) => r.status === 'active' || r.status === 'confirmed') || [];
    const arrivals = res?.filter((r: any) => r.check_in === today) || [];
    const departures = res?.filter((r: any) => r.check_out === today) || [];
    const pipeline = res?.filter((r: any) => r.status === 'pending') || [];
    const totalUnits = units?.length || 1;
    const occupied = units?.filter((u: any) => u.status === 'occupied' || u.status === 'occupe').length || 0;
    const available = units?.filter((u: any) => u.status === 'available' || u.status === 'libre').length || 0;

    return new Response(JSON.stringify({
      agent: 'commercial_v1',
      display_name: 'Commercial — Réservations',
      operational_mode,
      data: {
        occupancy: { rate_pct: Math.round((occupied / totalUnits) * 100), occupied, available, total_units: totalUnits },
        reservations: { active: active.length, pipeline: pipeline.length, arrivals_today: arrivals.length, departures_today: departures.length, total: res?.length || 0 }
      },
      sources: ['veraluz_reservations','veraluz_units'],
      limits: ['veraluz_clients table not queried'],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
