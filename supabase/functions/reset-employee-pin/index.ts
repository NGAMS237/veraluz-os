// PROMPT 020C — reset-employee-pin v2
// Génère un PIN temporaire à 6 chiffres, stocke dans pin_code, active must_change_pin
// Déployé sur Supabase: dfdmasejsoibxrvubegu

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function generatePin6(): string {
  // 6 chiffres : 100000–999999
  return String(Math.floor(100000 + Math.random() * 900000));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { employee_id, requested_by, requested_by_role, reason } = body;

    if (!employee_id) {
      return new Response(JSON.stringify({ ok: false, error: "employee_id requis" }),
        { status: 400, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const tempPin = generatePin6();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("veraluz_employees")
      .update({
        pin_code: tempPin,
        must_change_pin: true,
        temporary_pin_expires_at: expiresAt,
        failed_pin_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", employee_id);

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({
      ok: true,
      temporary_pin: tempPin,
      expires_at: expiresAt,
      message: "PIN temporaire 6 chiffres généré — valable 24h",
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: CORS });
  }
});
