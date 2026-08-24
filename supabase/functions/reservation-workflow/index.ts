import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizeRole, hasCapability } from "./_rbac.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const JSON_H = { "Content-Type": "application/json", ...CORS };

function ok(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_H });
}
function fail(error: string, status = 400, extra: object = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), { status, headers: JSON_H });
}

const TRANSITION_MAP: Record<string, string[]> = {
  confirm:  ["pending"],
  checkin:  ["confirmed"],
  checkout: ["checkedin"],
  no_show:  ["confirmed", "pending"],
  cancel:   ["pending", "confirmed"],
};
const STATUS_MAP: Record<string, string> = {
  confirm:  "confirmed",
  checkin:  "checkedin",
  checkout: "checkedout",
  no_show:  "no_show",
  cancel:   "cancelled",
};
const ACTION_CAPABILITY: Record<string, string> = {
  confirm:  "reservations.write",
  checkin:  "reservations.checkin",
  checkout: "reservations.checkout",
  no_show:  "reservations.write",
  cancel:   "reservations.write",
};

// AUTH-R5: ALLOWED_ROLES remplacé par capability check via _rbac.ts

async function sha256hex(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

async function validateSession(db: ReturnType<typeof createClient>, token: string) {
  const hash = await sha256hex(token);
  const { data: sess } = await db
    .from("veraluz_employee_sessions")
    .select("employee_id, expires_at, revoked_at")
    .eq("token_hash", hash)
    .single();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;
  const { data: emp } = await db
    .from("veraluz_employees")
    .select("id, role, full_name")
    .eq("id", sess.employee_id)
    .single();
  return emp ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const token = req.headers.get("X-Veraluz-Session");
  if (!token) return fail("auth_required", 401);

  const db = createClient(SUPA_URL, SERVICE_KEY);
  const employee = await validateSession(db, token);
  if (!employee) return fail("invalid_session", 401);
  const actorRole = normalizeRole(employee.role);
  if (!hasCapability(actorRole, 'reservations.read')) return fail("forbidden", 403, { role: employee.role });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail("invalid_json"); }

  const action = String(body.action ?? "");
  const reservation_id = String(body.reservation_id ?? "");
  const confirm_early = Boolean(body.confirm_early);

  if (!action || !reservation_id) return fail("missing_params");
  if (!TRANSITION_MAP[action]) return fail("invalid_action");
  if (!hasCapability(actorRole, ACTION_CAPABILITY[action])) {
    return fail("forbidden", 403, { role: employee.role, action });
  }

  const { data: rez, error: rezErr } = await db
    .from("veraluz_reservations")
    .select("id, status, check_in, check_out, unit_id, client_name, client_email")
    .eq("id", reservation_id)
    .single();

  if (rezErr || !rez) return fail("reservation_not_found", 404);

  const targetStatus = STATUS_MAP[action];
  if (rez.status === targetStatus) {
    return ok({
      ok: true,
      reservation_id,
      previous_status: rez.status,
      new_status: rez.status,
      action,
      transitioned: false,
      idempotent: true,
    });
  }

  if (!TRANSITION_MAP[action].includes(rez.status)) {
    return fail("invalid_transition", 422, {
      current_status: rez.status, action,
      allowed_from: TRANSITION_MAP[action],
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (action === "checkin" && rez.check_in > today && !confirm_early) {
    return fail("early_checkin", 422, {
      check_in: rez.check_in, today, requires_confirm: true,
    });
  }

  if (action === "checkin" && rez.unit_id) {
    const { data: occupant, error: occupantErr } = await db
      .from("veraluz_reservations")
      .select("id")
      .eq("unit_id", rez.unit_id)
      .in("status", ["checkedin", "checked_in"])
      .neq("id", reservation_id)
      .limit(1)
      .maybeSingle();
    if (occupantErr) return fail("db_error", 500, { detail: occupantErr.message });
    if (occupant) return fail("unit_occupied", 409);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await db
    .from("veraluz_reservations")
    .update({ status: targetStatus, updated_at: now })
    .eq("id", reservation_id)
    .eq("status", rez.status)
    .select("id, status")
    .maybeSingle();

  if (updErr) {
    if (action === "checkin" && updErr.code === "23505") {
      return fail("unit_occupied", 409);
    }
    return fail("db_error", 500, { detail: updErr.message });
  }
  if (!updated) {
    return fail("transition_conflict", 409, {
      reservation_id,
      action,
    });
  }

  return ok({
    ok: true, reservation_id,
    previous_status: rez.status, new_status: targetStatus,
    transitioned: true,
    action, performed_by: employee.id,
    performed_by_name: employee.full_name, performed_at: now,
    ...(action === "checkin" && confirm_early ? { early_checkin: true } : {}),
  });
});
