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

  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: reservations } = await admin.from('veraluz_reservations').select('id, status, check_in, check_out, unit_id').order('check_in', { ascending: true }).limit(200);
    const active = reservations?.filter((r: any) => r.status === 'active' || r.status === 'confirmed') || [];
    const checkinsToday = reservations?.filter((r: any) => r.check_in === today) || [];
    const checkoutsToday = reservations?.filter((r: any) => r.check_out === today) || [];
    const upcoming7d = reservations?.filter((r: any) => {
      if (!r.check_in) return false;
      const d = new Date(r.check_in).getTime() - Date.now();
      return d > 0 && d <= 7 * 86400000;
    }) || [];

    const { data: units } = await admin.from('veraluz_units').select('id, name, type, status').limit(50);
    const availableUnits = units?.filter((u: any) => u.status === 'available' || u.status === 'libre') || [];
    const occupiedUnits = units?.filter((u: any) => u.status === 'occupied' || u.status === 'occupe') || [];
    const occupancyRate = units && units.length > 0 ? Math.round((occupiedUnits.length / units.length) * 100) : 0;

    return new Response(JSON.stringify({
      agent: 'nora_reservations_v1',
      display_name: 'Nora — Réservations',
      operational_mode,
      data: {
        reservations: { actives: active.length, arrivees_aujourd_hui: checkinsToday.length, departs_aujourd_hui: checkoutsToday.length, prochains_7j: upcoming7d.length, total: reservations?.length || 0 },
        unites: { total: units?.length || 0, disponibles: availableUnits.length, occupees: occupiedUnits.length, taux_occupation_pct: occupancyRate }
      },
      sources: ['veraluz_reservations','veraluz_units'],
      limits: [],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
