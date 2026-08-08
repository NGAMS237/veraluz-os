import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INTERNAL_SECRET = Deno.env.get('VERALUZ_AGENT_INTERNAL_SECRET') || '';
const ALLOWED_ROLES = ['gerant','admin','superadmin'];

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
    const { data: ord } = await admin.from('veraluz_restaurant_orders').select('id, total, status').limit(200);
    const paidOrd = ord?.filter((o: any) => o.status === 'servi' || o.status === 'completed') || [];
    const restoRevenue = paidOrd.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);

    const { data: pay } = await admin.from('veraluz_payments').select('id, amount, status').limit(200);
    const validated = pay?.filter((p: any) => p.status === 'validated' || p.status === 'paid') || [];
    const pending = pay?.filter((p: any) => p.status === 'pending') || [];
    const totalValidated = validated.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    const totalPending = pending.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);

    return new Response(JSON.stringify({
      agent: 'finance_v1',
      display_name: 'Finance — Comptabilité',
      operational_mode,
      data: {
        paiements: { total_valide_xaf: totalValidated, count_valide: validated.length, total_en_attente_xaf: totalPending, count_en_attente: pending.length },
        restaurant: { revenu_xaf: restoRevenue, commandes_terminees: paidOrd.length }
      },
      sources: ['veraluz_payments','veraluz_restaurant_orders'],
      limits: ['veraluz_expenses not queried','veraluz_payroll not queried'],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
