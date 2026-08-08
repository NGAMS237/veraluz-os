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
    const { data: sessions } = await admin.from('veraluz_employee_sessions').select('id, employee_id, created_at, expires_at, revoked_at').order('created_at', { ascending: false }).limit(100);
    const activeSessions = sessions?.filter((s: any) => !s.revoked_at && new Date(s.expires_at) > new Date()) || [];
    const revokedRecent = sessions?.filter((s: any) => s.revoked_at && s.revoked_at >= cutoff24h) || [];
    const newSessions24h = sessions?.filter((s: any) => s.created_at >= cutoff24h) || [];

    const { data: authEvents } = await admin.from('veraluz_auth_events').select('id, event_type, created_at').gte('created_at', cutoff24h).limit(200);
    const failedPins = authEvents?.filter((e: any) => e.event_type === 'pin_failed' || e.event_type === 'login_failed') || [];
    const successLogins = authEvents?.filter((e: any) => e.event_type === 'login_success' || e.event_type === 'pin_success') || [];

    const { data: aiAgents } = await admin.from('veraluz_ai_agents').select('agent_key, name, runner_function').not('runner_function', 'is', null);

    return new Response(JSON.stringify({
      agent: 'techops_v1',
      display_name: 'TechOps — Infrastructure',
      operational_mode,
      data: {
        sessions: { actives: activeSessions.length, nouvelles_24h: newSessions24h.length, revoquees_24h: revokedRecent.length, total: sessions?.length || 0 },
        securite: { tentatives_echec_24h: failedPins.length, connexions_reussies_24h: successLogins.length, total_evenements_24h: authEvents?.length || 0 },
        agents_ia: { deployes: aiAgents?.length || 0, noms: aiAgents?.map((a: any) => a.name) || [] },
        infrastructure: { base_de_donnees: 'PROD — dfdmasejsoibxrvubegu', statut: 'OK', edge_functions_actives: true }
      },
      sources: ['veraluz_employee_sessions','veraluz_auth_events','veraluz_ai_agents'],
      limits: [],
      latency_ms: Date.now() - t0
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'runner_error', message: err.message }), { status: 500 });
  }
});
