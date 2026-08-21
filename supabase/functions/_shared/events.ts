/**
 * _shared/events.ts — Contrat événement canonique Veraluz (INFRA-OPS-1R)
 *
 * Règles absolues :
 *  - JAMAIS de tenant_id (propriété unique, non-SaaS)
 *  - JAMAIS de secrets/tokens dans payload
 *  - Les triggers DB émettent en production ; emitEvent() = usage secondaire/tests
 *  - Contrat colonnes : id, event_type, source, entity_type, entity_id,
 *    reservation_id, unit_id, actor_type, actor_id, payload, created_at
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────────
// Types d'événements canoniques
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = {
  // Réservations
  RESERVATION_CREATED:      'reservation_created',
  RESERVATION_CONFIRMED:    'reservation_confirmed',
  RESERVATION_CANCELLED:    'reservation_cancelled',
  GUEST_CHECKED_IN:         'guest_checked_in',
  GUEST_CHECKED_OUT:        'guest_checked_out',

  // Paiements
  PAYMENT_RECORDED:         'payment_recorded',
  PAYMENT_REFUNDED:         'payment_refunded',

  // Services invités
  GUEST_SERVICE_REQUESTED:  'guest_service_requested',
  GUEST_SERVICE_COMPLETED:  'guest_service_completed',

  // Ménage
  HOUSEKEEPING_ASSIGNED:    'housekeeping_assigned',
  HOUSEKEEPING_COMPLETED:   'housekeeping_completed',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Mapping événement → handlers (event-worker)
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_HANDLERS: Record<string, string[]> = {
  [EVENT_TYPES.GUEST_CHECKED_OUT]:       ['create_housekeeping_task'],
  [EVENT_TYPES.GUEST_SERVICE_REQUESTED]: ['create_staff_notification'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Contrat d'événement pour emitEvent()
// ─────────────────────────────────────────────────────────────────────────────

export interface EventPayload {
  event_type:      EventType;
  source:          string;
  entity_type?:    string;
  entity_id?:      string;
  reservation_id?: string;
  unit_id?:        string;
  actor_type?:     'staff' | 'guest' | 'system';
  actor_id?:       string;
  payload?:        Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// emitEvent — écriture directe depuis EF (triggers DB = chemin primaire)
// ─────────────────────────────────────────────────────────────────────────────

export async function emitEvent(
  db: SupabaseClient,
  evt: EventPayload,
): Promise<{ ok: boolean; event_id?: string; error?: string }> {
  try {
    const event_id = crypto.randomUUID();

    const { error: evtErr } = await db
      .from('veraluz_events')
      .insert({
        id:             event_id,
        event_type:     evt.event_type,
        source:         evt.source,
        entity_type:    evt.entity_type    ?? null,
        entity_id:      evt.entity_id      ?? null,
        reservation_id: evt.reservation_id ?? null,
        unit_id:        evt.unit_id        ?? null,
        actor_type:     evt.actor_type     ?? 'system',
        actor_id:       evt.actor_id       ?? null,
        payload:        evt.payload        ?? {},
        created_at:     new Date().toISOString(),
      });

    if (evtErr) return { ok: false, error: evtErr.message };

    const handlers = EVENT_HANDLERS[evt.event_type] ?? [];
    if (handlers.length > 0) {
      const jobs = handlers.map(handler => ({
        event_id,
        handler,
        status:       'pending',
        attempt:      0,
        max_attempts: 4,
        created_at:   new Date().toISOString(),
      }));

      const { error: jobErr } = await db
        .from('veraluz_event_jobs')
        .upsert(jobs, { onConflict: 'event_id,handler', ignoreDuplicates: true });

      if (jobErr) {
        console.error(`[emitEvent] jobs upsert error event=${event_id}:`, jobErr.message);
      }
    }

    console.log(`[emitEvent] type=${evt.event_type} id=${event_id} handlers=${handlers.join(',') || 'none'}`);
    return { ok: true, event_id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
