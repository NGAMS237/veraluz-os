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
    const { data: reservations } = await admin.from('veraluz_reservations').select('id, status, check_in, check_out').limit(100);
    const activeRes = reservations?.filter((r: any) => r.status === 'active' || r.status === 'confirmed') || [];
    const today = new Date().toISOString().split('T')[0];
    const checkinsToday = reservations?.filter((r: any) => r.check_in === today) || [];
    const checkoutsToday = reservations?.filter((r: any) => r.check_out === today) || [];

    const { data: payments } = await admin.from('veraluz_payments').select('id, amount, status, payment_date').order('payment_date', { ascending: false }).limit(50);
    const pendingPay = payments?.filter((p: any) => p.status === 'pending') || [];
    const validatedPay = payments?.filter((p: any) => p.status === 'validated' || p.status === 'paid') || [];
    const totalRevenue = validatedPay.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);

    const { data: emps } = await admin.from('veraluz_employees').select('id, role, status').limit(100);
    const activeEmps = emps?.filter((e: any) => e.status === 'actif' || e.status === 'active') || [];

    const { data: sessions } = await admin.from('veraluz_employee_sessions').select('id').is('revoked_at', null).gt('expires_at', new Date().toISOString()).limit(50);

    const { data: notifs } = await admin.from('veraluz_notifications').select('id, type, read_at').is('read_at', null).limit(20);

    const result = {
      agent: 'chloe_director_v1',
      display_name: 'Chloé — Direction',
      operational_mode,
      summary: {
        reservations_actives: activeRes.length,
        arrivees_aujourd_hui: checkinsToday.length,
        departs_aujourd_hui: checkoutsToday.length,
        paiements_en_attente: pendingPay.length,
        revenu_valide: totalRevenue,
        employes_actifs: activeEmps.length,
        sessions_ouvertes: sessions?.length || 0,
        notifications_non_lues: notifs?.length || 0
      },
      sources: ['veraluz_reservations','veraluz_payments','veraluz_employees','veraluz_employee_sessions','veraluz_notifications'],
      limits: [],
      latency_ms: Date.now() - t0
    };

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
