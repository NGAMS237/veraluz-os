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
    const { data: emps } = await admin.from('veraluz_employees').select('id, full_name, role, status').limit(200);
    const active = emps?.filter((e: any) => e.status === 'actif' || e.status === 'active') || [];
    const roleBreakdown: Record<string, number> = {};
    emps?.forEach((e: any) => { roleBreakdown[e.role] = (roleBreakdown[e.role] || 0) + 1; });

    const { data: sessions } = await admin.from('veraluz_employee_sessions').select('id').is('revoked_at', null).gt('expires_at', new Date().toISOString()).limit(100);
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const { data: authEvents } = await admin.from('veraluz_auth_events').select('id, event_type').gte('created_at', cutoff).limit(200);
    const failedPins = authEvents?.filter((e: any) => e.event_type === 'pin_failed') || [];

    return new Response(JSON.stringify({
      agent: 'sonia_hr_v1',
      display_name: 'Sonia — RH',
      operational_mode,
      data: {
        employees: { total: emps?.length || 0, active: active.length, role_breakdown: roleBreakdown },
        sessions: { active: sessions?.length || 0 },
        security: { failed_pins_24h: failedPins.length, total_auth_events_24h: authEvents?.length || 0 }
      },
      sources: ['veraluz_employees','veraluz_employee_sessions','veraluz_auth_events'],
      limits: [],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
