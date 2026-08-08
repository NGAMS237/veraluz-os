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
    const { data: contracts } = await admin.from('veraluz_contracts').select('id, employee_id, type, status, start_date, end_date').limit(100);
    const active = contracts?.filter((c: any) => c.status === 'active') || [];
    const expired = contracts?.filter((c: any) => c.status === 'expired') || [];
    const expiring = contracts?.filter((c: any) => {
      if (!c.end_date || c.status !== 'active') return false;
      const days = (new Date(c.end_date).getTime() - Date.now()) / 86400000;
      return days >= 0 && days <= 30;
    }) || [];
    const byType: Record<string, number> = {};
    contracts?.forEach((c: any) => { byType[c.type || 'unknown'] = (byType[c.type || 'unknown'] || 0) + 1; });

    const { data: docs } = await admin.from('veraluz_documents').select('id, type, status, created_at').order('created_at', { ascending: false }).limit(50);
    const pendingDocs = docs?.filter((d: any) => d.status === 'pending') || [];

    return new Response(JSON.stringify({
      agent: 'lexa_legal_v1',
      display_name: 'Lexa — Juridique',
      operational_mode,
      data: {
        contracts: { total: contracts?.length || 0, active: active.length, expired: expired.length, expiring_30d: expiring.length, by_type: byType },
        documents: { total: docs?.length || 0, pending: pendingDocs.length }
      },
      sources: ['veraluz_contracts','veraluz_documents'],
      limits: ['veraluz_legal_obligations table not yet created'],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
