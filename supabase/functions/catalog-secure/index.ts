/**
 * CATALOG-SSOT-1 — catalog-secure Edge Function v2
 *
 * Source canonique : veraluz_units
 *
 * Actions:
 *   get_catalog  — lecture publique (anon), retourne toutes les unités
 *   upsert_unit  — créer ou modifier une unité (settings.manage uniquement)
 *   delete_unit  — supprimer une unité (settings.manage uniquement)
 *
 * Sécurité :
 *   - X-Veraluz-Session requis pour écriture
 *   - RBAC canonique _rbac.ts — settings.manage
 *   - Validation stricte des champs
 *   - Jamais de service_role exposé
 *
 * v2 (CATALOG-SSOT-1 review fixes):
 *   + Statuts catalogue corrigés : active | maintenance | out_of_service
 *     (occupied supprimé — état opérationnel dérivé des réservations, jamais stocké dans le catalogue)
 *   + amenities : JSONB array passé tel quel (jamais converti en string)
 *   + delete_unit : FK correcte → veraluz_reservations.unit_id (était room_id — BUG)
 *   + Guard count query échouée → 500 plutôt que delete silencieux
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasCapability } from './_rbac.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
];

const UNIT_ALLOWED_TYPES = new Set(['chambre','studio','appartement','suite','villa','bungalow']);

/* Statuts administratifs catalogue uniquement.
   'occupied' est un état opérationnel dérivé des réservations — jamais stocké ici. */
const UNIT_ALLOWED_STATUSES = new Set(['active','maintenance','out_of_service']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

async function hashToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function validateEmployeeSession(db: ReturnType<typeof createClient>, sessionToken: string) {
  if (!sessionToken) return null;
  const hash = await hashToken(sessionToken);
  const { data: sess } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .single();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;
  const { data: emp } = await db
    .from('veraluz_employees')
    .select('id, full_name, role')
    .eq('id', sess.employee_id)
    .single();
  return emp ?? null;
}

// ── Validation unité ──────────────────────────────────────────────────────────

function validateUnit(unit: Record<string,unknown>): { ok: true } | { ok: false; error: string; field?: string; detail?: string } {
  if (!unit.name || typeof unit.name !== 'string' || (unit.name as string).trim().length === 0) {
    return { ok: false, error: 'field_required', field: 'name' };
  }
  if (unit.type !== undefined && !UNIT_ALLOWED_TYPES.has(unit.type as string)) {
    return { ok: false, error: 'invalid_field_value', field: 'type',
      detail: [...UNIT_ALLOWED_TYPES].join('|') };
  }
  if (unit.status !== undefined && !UNIT_ALLOWED_STATUSES.has(unit.status as string)) {
    return { ok: false, error: 'invalid_field_value', field: 'status',
      detail: [...UNIT_ALLOWED_STATUSES].join('|') + ' (occupied interdit — état dérivé des réservations)' };
  }
  if (unit.capacity !== undefined) {
    const c = Number(unit.capacity);
    if (!Number.isInteger(c) || c < 1 || c > 20) {
      return { ok: false, error: 'invalid_field_value', field: 'capacity', detail: '1–20' };
    }
  }
  if (unit.price !== undefined) {
    const p = Number(unit.price);
    if (!Number.isFinite(p) || p < 0) {
      return { ok: false, error: 'invalid_field_value', field: 'price', detail: '>= 0' };
    }
  }
  if (unit.sort_order !== undefined) {
    const s = Number(unit.sort_order);
    if (!Number.isFinite(s) || s < 0) {
      return { ok: false, error: 'invalid_field_value', field: 'sort_order', detail: '>= 0' };
    }
  }
  if (unit.floor !== undefined && !Number.isFinite(Number(unit.floor))) {
    return { ok: false, error: 'invalid_field_value', field: 'floor' };
  }
  /* amenities : doit être un tableau JSON ou null/absent */
  if (unit.amenities !== undefined && unit.amenities !== null) {
    if (!Array.isArray(unit.amenities)) {
      return { ok: false, error: 'invalid_field_value', field: 'amenities',
        detail: 'amenities must be a JSON array of strings (e.g. ["clim","wifi","tv"])' };
    }
    for (const a of unit.amenities as unknown[]) {
      if (typeof a !== 'string') {
        return { ok: false, error: 'invalid_field_value', field: 'amenities',
          detail: 'each amenity must be a string key' };
      }
    }
  }
  return { ok: true };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors   = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
  }

  let body: Record<string,unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400, cors); }

  const action = body.action as string | undefined;
  if (!action) return json({ ok: false, error: 'action_required' }, 400, cors);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── get_catalog — lecture publique (anon) ─────────────────────────────────
  if (action === 'get_catalog') {
    const { data, error } = await db
      .from('veraluz_units')
      .select('id,name,type,floor,capacity,price,description,amenities,status,sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) return json({ ok: false, error: 'db_error' }, 500, cors);
    return json({ ok: true, units: data ?? [] }, 200, cors);
  }

  // ── Actions nécessitant settings.manage ───────────────────────────────────
  if (action === 'upsert_unit' || action === 'delete_unit') {
    const sessionToken = req.headers.get('x-veraluz-session') ?? '';
    const employee = await validateEmployeeSession(db, sessionToken);
    if (!employee) return json({ ok: false, error: 'auth_required' }, 401, cors);
    if (!hasCapability(employee.role, 'settings.manage')) {
      return json({ ok: false, error: 'forbidden', required_capability: 'settings.manage' }, 403, cors);
    }

    // ── upsert_unit ──────────────────────────────────────────────────────────
    if (action === 'upsert_unit') {
      const unit = body.unit as Record<string,unknown> | undefined;
      if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
        return json({ ok: false, error: 'unit_required' }, 400, cors);
      }

      const validation = validateUnit(unit);
      if (!validation.ok) return json({ ok: false, ...validation }, 400, cors);

      /* amenities : passer le tableau JSONB tel quel — jamais convertir en string */
      const amenities = Array.isArray(unit.amenities) ? unit.amenities : [];

      // Préparer le payload — seuls les champs autorisés
      const payload: Record<string,unknown> = {
        name:        (unit.name as string).trim(),
        type:        unit.type        ?? 'chambre',
        status:      unit.status      ?? 'active',
        capacity:    Number(unit.capacity ?? 2),
        price:       Number(unit.price    ?? 0),
        floor:       Number(unit.floor    ?? 0),
        sort_order:  Number(unit.sort_order ?? 0),
        amenities:   amenities,
        description: typeof unit.description === 'string' ? unit.description : '',
        updated_at:  new Date().toISOString(),
      };

      // Si id présent → update ; sinon → insert avec UUID
      if (unit.id && typeof unit.id === 'string') {
        payload.id = unit.id;
      } else {
        payload.id = crypto.randomUUID();
      }

      const { error: upsertErr } = await db
        .from('veraluz_units')
        .upsert(payload, { onConflict: 'id' });

      if (upsertErr) return json({ ok: false, error: 'db_write_error', detail: upsertErr.message }, 500, cors);
      return json({ ok: true, id: payload.id, updated_by: employee.full_name }, 200, cors);
    }

    // ── delete_unit ──────────────────────────────────────────────────────────
    if (action === 'delete_unit') {
      const unitId = body.id as string | undefined;
      if (!unitId || typeof unitId !== 'string') {
        return json({ ok: false, error: 'id_required' }, 400, cors);
      }

      /* Vérifier s'il existe des réservations liées avant de supprimer.
         FK réelle : veraluz_reservations.unit_id → veraluz_units.id       */
      const { count, error: countErr } = await db
        .from('veraluz_reservations')
        .select('id', { count: 'exact', head: true })
        .eq('unit_id', unitId);   /* ← FK correcte (était room_id — BUG) */

      if (countErr) {
        console.error('[catalog-secure] Reservation count check failed:', countErr.message);
        return json({ ok: false, error: 'reservation_check_failed', detail: countErr.message }, 500, cors);
      }

      if (count !== null && count > 0) {
        return json({ ok: false, error: 'unit_has_reservations', count }, 409, cors);
      }

      const { error: delErr } = await db
        .from('veraluz_units')
        .delete()
        .eq('id', unitId);

      if (delErr) return json({ ok: false, error: 'db_delete_error', detail: delErr.message }, 500, cors);
      return json({ ok: true, deleted_id: unitId, deleted_by: employee.full_name }, 200, cors);
    }
  }

  return json({ ok: false, error: 'unknown_action' }, 400, cors);
});
