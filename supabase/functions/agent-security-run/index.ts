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
    const cutoff24h = new Date(Date.now() - 86400000).toISOString();
    const { data: events } = await admin.from('veraluz_auth_events').select('id, event_type, username, created_at').gte('created_at', cutoff24h).order('created_at', { ascending: false }).limit(200);
    const { data: sessions } = await admin.from('veraluz_employee_sessions').select('id, employee_id, created_at, expires_at, revoked_at').limit(200);

    const byType: Record<string, number> = {};
    events?.forEach((e: any) => { byType[e.event_type] = (byType[e.event_type] || 0) + 1; });

    const activeSess = sessions?.filter((s: any) => !s.revoked_at && new Date(s.expires_at) > new Date()) || [];
    const failedPins = events?.filter((e: any) => e.event_type === 'pin_failed') || [];

    const failsByUser: Record<string, number> = {};
    failedPins.forEach((e: any) => { failsByUser[e.username] = (failsByUser[e.username] || 0) + 1; });
    const suspicious = Object.entries(failsByUser).filter(([,c]) => c >= 3).map(([u,c]) => ({ username: u, failed_count: c }));

    return new Response(JSON.stringify({
      agent: 'security_v1',
      display_name: 'Sécurité — Accès',
      operational_mode,
      data: {
        auth_events_24h: { total: events?.length || 0, by_type: byType, failed_pins: failedPins.length },
        sessions: { total: sessions?.length || 0, active: activeSess.length },
        suspicious_accounts: suspicious,
        suspicious_count: suspicious.length
      },
      sources: ['veraluz_auth_events','veraluz_employee_sessions'],
      limits: ['cameras not integrated','veraluz_security_incidents table not yet created'],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
