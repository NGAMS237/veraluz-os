import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://joegfxwcsvtqtxbffpkp.supabase.co',
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080'
];

const ALLOWED_RUNNERS = new Set([
  'agent-chloe-run','agent-restaurant-run','agent-reservations-run','agent-techops-run',
  'agent-hr-run','agent-legal-run','agent-finance-run','agent-commercial-run',
  'agent-maintenance-run','agent-security-run'
]);

const INTERNAL_SECRET = Deno.env.get('VERALUZ_AGENT_INTERNAL_SECRET') || '';

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-veraluz-session, x-internal-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

// 010F — validation session: revoked_at IS NULL + expires_at > now()
async function validateSession(admin: ReturnType<typeof createClient>, token: string): Promise<{ employee_id: string; role: string } | null> {
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const { data: sess } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .single();
  if (!sess) return null;
  const { data: emp } = await admin.from('veraluz_employees').select('role').eq('id', sess.employee_id).single();
  return { employee_id: sess.employee_id, role: emp?.role || 'staff' };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!INTERNAL_SECRET) return new Response(JSON.stringify({ error: 'secret_not_configured' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });

  const SB_URL = Deno.env.get('SUPABASE_URL')!;
  const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SB_URL, SB_SERVICE);

  try {
    const body = await req.json();
    const { agent_key, action, params, session_token } = body;

    if (action === 'list_agents') {
      const isInternal = req.headers.get('x-internal-secret') === INTERNAL_SECRET;
      if (!isInternal && session_token) {
        const sess = await validateSession(admin, session_token);
        if (!sess) return new Response(JSON.stringify({ error: 'invalid_session' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      const { data: configRow } = await admin.from('veraluz_operational_config').select('mode').order('changed_at', { ascending: false }).limit(1).single();
      const { data: agents } = await admin.from('veraluz_ai_agents')
        .select('agent_key, name, display_name, description, runner_function, supervisor_agent_key, ui_metadata_json, status, category, icon')
        .not('runner_function', 'is', null).order('agent_key');
      return new Response(JSON.stringify({ ok: true, agents: agents || [], operational_mode: configRow?.mode || 'construction_simulation' }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    if (!agent_key) return new Response(JSON.stringify({ error: 'agent_key required' }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } });

    const isInternalCall = req.headers.get('x-internal-secret') === INTERNAL_SECRET;
    let employee: { employee_id: string; role: string } | null = null;
    if (!isInternalCall) {
      if (!session_token) return new Response(JSON.stringify({ error: 'session_token required' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
      employee = await validateSession(admin, session_token);
      if (!employee) return new Response(JSON.stringify({ error: 'invalid_session' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    const { data: agentRow } = await admin.from('veraluz_ai_agents').select('runner_function').eq('agent_key', agent_key).single();
    const runner = agentRow?.runner_function;
    if (!runner || !ALLOWED_RUNNERS.has(runner)) return new Response(JSON.stringify({ error: 'runner_not_allowed', runner }), { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } });

    const { data: configRow } = await admin.from('veraluz_operational_config').select('mode').order('changed_at', { ascending: false }).limit(1).single();
    const operationalMode = configRow?.mode || 'construction_simulation';

    const runnerResp = await fetch(`${SB_URL}/functions/v1/${runner}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'Authorization': `Bearer ${SB_SERVICE}` },
      body: JSON.stringify({ agent_key, action, params, employee, operational_mode: operationalMode })
    });
    const runnerData = await runnerResp.json();
    return new Response(JSON.stringify({ ...runnerData, operational_mode: operationalMode }), { status: runnerResp.status, headers: { ...headers, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'internal_error', message: err.message }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
});

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
