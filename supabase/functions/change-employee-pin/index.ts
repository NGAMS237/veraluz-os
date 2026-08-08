// PROMPT 020C — change-employee-pin v2
// Vérifie le PIN actuel (4 ou 6 chiffres), exige le nouveau PIN à 6 chiffres
// Déployé sur Supabase: dfdmasejsoibxrvubegu

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const WEAK_PINS = ["000000","111111","222222","333333","444444","555555",
                   "666666","777777","888888","999999","123456","654321","012345"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { employee_id, current_pin, new_pin } = body;

    if (!employee_id || !current_pin || !new_pin) {
      return new Response(JSON.stringify({ ok: false, error: "Champs requis manquants" }),
        { status: 400, headers: CORS });
    }

    // Nouveau PIN : exactement 6 chiffres
    if (!/^\d{6}$/.test(new_pin)) {
      return new Response(JSON.stringify({ ok: false, error: "Le nouveau PIN doit avoir exactement 6 chiffres" }),
        { status: 400, headers: CORS });
    }

    // PIN faible
    if (WEAK_PINS.includes(new_pin)) {
      return new Response(JSON.stringify({ ok: false, error: "PIN trop simple — choisissez une combinaison plus sécurisée" }),
        { status: 400, headers: CORS });
    }

    // PIN actuel : 4 ou 6 chiffres (compatibilité legacy)
    if (!/^\d{4}$/.test(current_pin) && !/^\d{6}$/.test(current_pin)) {
      return new Response(JSON.stringify({ ok: false, error: "PIN actuel invalide — 4 ou 6 chiffres requis" }),
        { status: 400, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Récupérer l'employé
    const { data: emp, error: fetchErr } = await supabase
      .from("veraluz_employees")
      .select("id, pin_code, must_change_pin, pin_locked_until, failed_pin_attempts")
      .eq("id", employee_id)
      .single();

    if (fetchErr || !emp) {
      return new Response(JSON.stringify({ ok: false, error: "Employé introuvable" }),
        { status: 404, headers: CORS });
    }

    // Vérifier le PIN actuel
    if (emp.pin_code !== current_pin) {
      return new Response(JSON.stringify({ ok: false, error: "PIN actuel incorrect" }),
        { status: 401, headers: CORS });
    }

    // Refuser si nouveau == ancien temporaire
    if (new_pin === current_pin) {
      return new Response(JSON.stringify({ ok: false, error: "Le nouveau PIN doit être différent du PIN actuel" }),
        { status: 400, headers: CORS });
    }

    // Mettre à jour le PIN
    const { error: updateErr } = await supabase
      .from("veraluz_employees")
      .update({
        pin_code: new_pin,
        must_change_pin: false,
        temporary_pin_expires_at: null,
        failed_pin_attempts: 0,
        pin_locked_until: null,
      })
      .eq("id", employee_id);

    if (updateErr) {
      return new Response(JSON.stringify({ ok: false, error: updateErr.message }),
        { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({
      ok: true,
      message: "PIN modifié avec succès — connexion avec le nouveau PIN à 6 chiffres",
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: CORS });
  }
});
