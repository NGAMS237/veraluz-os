// ═══════════════════════════════════════════════════════════════
// infra-health — INFRA-OPS-1
// Endpoint read-only : statut des events + jobs (observabilité).
// Accès réservé aux gérants (settings.manage) via JWT employé.
// Aucune donnée sensible dans la réponse.
// ═══════════════════════════════════════════════════════════════
// INTERDIT : stocker API key / secret / token / password / credentials
// ═══════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasCapability, normalizeRole } from '../_shared/_rbac.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-veraluz-session',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url        = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin      = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Auth : JWT employé requis (gérant uniquement) ────────────
  const sessionToken = req.headers.get('X-Veraluz-Session') ?? '';
  if (!sessionToken) return json({ ok: false, error: 'auth_required' }, 401);

  const { data: session } = await admin
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at')
    .eq('session_token', sessionToken)
    .eq('is_active', true)
    .single();

  if (!session) return json({ ok: false, error: 'invalid_session' }, 401);
  if (new Date(session.expires_at) < new Date()) return json({ ok: false, error: 'session_expired' }, 401);

  const { data: actor } = await admin
    .from('veraluz_employees')
    .select('role')
    .eq('id', session.employee_id)
    .single();

  if (!actor) return json({ ok: false, error: 'actor_not_found' }, 403);

  const role = normalizeRole(actor.role);
  if (!hasCapability(role, 'settings.manage')) {
    return json({ ok: false, error: 'access_denied', hint: 'gerant_only' }, 403);
  }

  // ── Requêtes read-only ───────────────────────────────────────

  // Comptages jobs par statut
  const statuses = ['pending','processing','completed','failed','dead'] as const;
  const jobCounts: Record<string, number> = {};

  await Promise.all(statuses.map(async (st) => {
    const { count } = await admin
      .from('veraluz_event_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', st);
    jobCounts[st] = count ?? 0;
  }));

  // Événements des 24 dernières heures par type
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEvents } = await admin
    .from('veraluz_events')
    .select('id, event_type, emitted_at, source_fn')
    .gte('emitted_at', since24h)
    .order('emitted_at', { ascending: false })
    .limit(50);

  // Derniers jobs (tous statuts) — sans payload/secrets
  const { data: recentJobs } = await admin
    .from('veraluz_event_jobs')
    .select('id, event_id, handler, status, attempt, last_error, processed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  // Jobs dead (max 10) pour alerte
  const { data: deadJobs } = await admin
    .from('veraluz_event_jobs')
    .select('id, event_id, handler, attempt, last_error, created_at')
    .eq('status', 'dead')
    .order('created_at', { ascending: false })
    .limit(10);

  // Comptage événements par type (24h)
  const eventsByType: Record<string, number> = {};
  for (const ev of recentEvents ?? []) {
    const t = ev.event_type as string;
    eventsByType[t] = (eventsByType[t] ?? 0) + 1;
  }

  return json({
    ok: true,
    checked_at: new Date().toISOString(),
    jobs: {
      counts:   jobCounts,
      recent:   recentJobs ?? [],
      dead:     deadJobs   ?? [],
      has_dead: (deadJobs?.length ?? 0) > 0,
    },
    events: {
      last_24h_total:  recentEvents?.length ?? 0,
      by_type:         eventsByType,
      recent:          recentEvents ?? [],
    },
  });
});
