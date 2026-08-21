// ═══════════════════════════════════════════════════════════════
// _shared/events.ts — INFRA-OPS-1
// Types d'événements canoniques + helper emitEvent()
// Convention : underscore (ex: guest_checked_out)
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Types d'événements canoniques ────────────────────────────
export const EVENT_TYPES = {
  GUEST_CHECKED_OUT:       'guest_checked_out',
  GUEST_SERVICE_REQUESTED: 'guest_service_requested',
  GUEST_CHECKED_IN:        'guest_checked_in',
  PAYMENT_VALIDATED:       'payment_validated',
  RESERVATION_CREATED:     'reservation_created',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// ── Handlers déclarés par type d'événement ───────────────────
// Chaque handler correspond à une action exécutée par event-worker.
// La contrainte UNIQUE (event_id, handler) en DB garantit l'idempotence.
export const EVENT_HANDLERS: Record<string, string[]> = {
  [EVENT_TYPES.GUEST_CHECKED_OUT]:       ['create_housekeeping_task'],
  [EVENT_TYPES.GUEST_SERVICE_REQUESTED]: ['create_staff_notification'],
};

// ── emitEvent ────────────────────────────────────────────────
// Insère l'événement dans veraluz_events, puis les jobs associés.
// Retourne { ok, event_id } si succès, { ok:false, error } sinon.
// NE stocke PAS de secrets / tokens / mots de passe dans payload.
export async function emitEvent(
  db: SupabaseClient,
  event_type: EventType,
  payload: Record<string, unknown>,
  source_fn: string,
  tenant_id = 'veraluz-001',
): Promise<{ ok: boolean; event_id?: string; error?: string }> {

  // 1. Insérer l'événement
  const { data: ev, error: evErr } = await db
    .from('veraluz_events')
    .insert({ event_type, payload, source_fn, tenant_id })
    .select('id')
    .single();

  if (evErr || !ev) {
    const msg = evErr?.message ?? 'insert_event_failed';
    console.error(`[emitEvent] event insert failed (${event_type}):`, msg);
    return { ok: false, error: msg };
  }

  // 2. Insérer les jobs associés (ON CONFLICT DO NOTHING → idempotent)
  const handlers = EVENT_HANDLERS[event_type] ?? [];
  if (handlers.length > 0) {
    const jobs = handlers.map(handler => ({
      event_id:     ev.id,
      handler,
      status:       'pending',
      attempt:      0,
      max_attempts: 4,
    }));

    const { error: jobErr } = await db
      .from('veraluz_event_jobs')
      .upsert(jobs, { onConflict: 'event_id,handler', ignoreDuplicates: true });

    if (jobErr) {
      // L'événement est inscrit — le worker peut créer les jobs au prochain cycle
      console.error(`[emitEvent] jobs upsert error for event ${ev.id}:`, jobErr.message);
    }
  }

  console.log(`[emitEvent] event_type=${event_type} event_id=${ev.id} handlers=${handlers.join(',') || 'none'}`);
  return { ok: true, event_id: ev.id };
}
