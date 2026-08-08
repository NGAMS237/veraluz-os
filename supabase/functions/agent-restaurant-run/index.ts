import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INTERNAL_SECRET = Deno.env.get('VERALUZ_AGENT_INTERNAL_SECRET') || '';
const ALLOWED_ROLES = ['gerant','admin','superadmin','barman'];

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

    const { data: orders } = await admin.from('veraluz_restaurant_orders').select('id, status, total, created_at').order('created_at', { ascending: false }).limit(100);
    const todayOrders = orders?.filter((o: any) => o.created_at?.startsWith(today)) || [];
    const pendingOrders = orders?.filter((o: any) => o.status === 'pending' || o.status === 'en_preparation') || [];
    const completedOrders = orders?.filter((o: any) => o.status === 'servi' || o.status === 'completed') || [];
    const totalRevToday = todayOrders.filter((o: any) => o.status === 'servi' || o.status === 'completed').reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);

    const { data: supplierOrders } = await admin.from('veraluz_supplier_orders').select('id, status, total_amount').limit(20);
    const pendingSupplier = supplierOrders?.filter((s: any) => s.status === 'pending') || [];

    const result = {
      agent: 'maya_restaurant_v1',
      display_name: 'Maya — Restaurant',
      operational_mode,
      data: {
        commandes: { total_aujourd_hui: todayOrders.length, en_attente: pendingOrders.length, completees: completedOrders.length },
        revenus_aujourd_hui: totalRevToday,
        fournisseurs: { commandes_en_attente: pendingSupplier.length }
      },
      sources: ['veraluz_restaurant_orders','veraluz_supplier_orders'],
      limits: [],
      latency_ms: Date.now() - t0
    };

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
