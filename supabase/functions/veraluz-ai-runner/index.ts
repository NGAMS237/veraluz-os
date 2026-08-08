/**
 * veraluz-ai-runner — Edge Function VERALUZ IA v3
 * PROMPT 015 — Connexion réelle Agent Directeur Quotidien
 *
 * ═══════════════════════════════════════════════════════════════
 * SÉCURITÉ ABSOLUE :
 *  ✗ Aucune clé IA dans ce fichier
 *  ✗ Aucune clé dans le frontend HTML/JS
 *  ✓ Clés IA via Supabase Secrets uniquement :
 *      ANTHROPIC_API_KEY  (si AI_PROVIDER=anthropic)
 *      OPENAI_API_KEY     (si AI_PROVIDER=openai)
 *      AI_PROVIDER        (anthropic | openai)
 *  ✓ Ne jamais loguer les clés
 *  ✓ Ne jamais retourner les clés dans la réponse
 *
 * SECRETS À CONFIGURER (une seule fois) :
 *   supabase secrets set AI_PROVIDER=anthropic
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
 *   -- ou --
 *   supabase secrets set AI_PROVIDER=openai
 *   supabase secrets set OPENAI_API_KEY=sk-xxxxxxxx
 *
 * AGENT ACTIVÉ POUR CETTE PHASE : daily_director uniquement
 * ═══════════════════════════════════════════════════════════════
 */

import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ── Types ───────────────────────────────────────────────────── */
interface AiRunRequest {
  agent_key:     string;
  run_type?:     string;
  snapshot?:     Record<string, unknown>;
  requested_by?: string;
}

interface AlertItem {
  priority:    string;
  category:    string;
  title:       string;
  description: string;
}

interface RecommendationItem {
  priority:          string;
  category:          string;
  title:             string;
  description:       string;
  related_module:    string;
  requires_approval: boolean;
  suggested_action?: string;
}

interface DecisionItem {
  priority: string;
  decision: string;
  reason:   string;
}

interface DirectorReport {
  title:              string;
  summary:            string;
  operational_status: "green" | "orange" | "red";
  key_metrics:        Record<string, number>;
  alerts:             AlertItem[];
  recommendations:    RecommendationItem[];
  decisions_required: DecisionItem[];
  next_actions:       string[];
  limits:             string;
}

interface AiRunResponse {
  ok:           boolean;
  mode:         "mock" | "edge" | "placeholder" | "fallback";
  provider?:    string;
  agent_key?:   string;
  run_type?:    string;
  run_id?:      string;
  report?:      DirectorReport;
  error?:       string;
  timestamp:    string;
}

/* ── CORS ────────────────────────────────────────────────────── */
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: AiRunResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* ── Budget guard — rate limiting simple ─────────────────────── */
/** Map en mémoire : requested_by → {count, firstTs} — réinitié à chaque cold start */
const dailyCounters  = new Map<string, number>();
const lastCallTs     = new Map<string, number>();
const COOLDOWN_MS    = 2 * 60 * 1000;   // 2 min entre deux appels par utilisateur
const MAX_DAILY      = 20;              // max 20 générations/jour en DEV

function budgetCheck(requestedBy: string): string | null {
  const now = Date.now();
  const last = lastCallTs.get(requestedBy) ?? 0;
  if (now - last < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    return `Trop de requêtes. Attendez ${waitSec}s avant la prochaine génération.`;
  }
  const count = dailyCounters.get(requestedBy) ?? 0;
  if (count >= MAX_DAILY) {
    return `Limite quotidienne atteinte (${MAX_DAILY} générations/jour en mode DEV).`;
  }
  lastCallTs.set(requestedBy, now);
  dailyCounters.set(requestedBy, count + 1);
  return null;
}

/* ── Sanitize snapshot ───────────────────────────────────────── */
const FORBIDDEN_KEYS = new Set([
  "pin_code","pin_hash","password","password_hash",
  "salary","base_salary","hourly_rate","monthly_salary","net_salary","gross_salary",
  "contract","contract_type","contract_details",
  "rh_notes","private_notes","personal_notes","medical_notes",
  "access_token","refresh_token","service_role","api_key",
  "secret","token","jwt","bearer","authorization",
]);

function sanitizeValue(val: unknown, depth = 0): unknown {
  if (depth > 5) return "[tronqué]";
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    // Tronquer les chaînes trop longues
    return val.length > 2000 ? val.slice(0, 2000) + "…" : val;
  }
  if (typeof val === "number" || typeof val === "boolean") return val;
  if (Array.isArray(val)) {
    return val.slice(0, 50).map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    let fieldCount = 0;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (fieldCount++ > 100) break; // max 100 champs par objet
      const key = k.toLowerCase();
      if (FORBIDDEN_KEYS.has(key)) continue;
      // Supprimer tout champ contenant des mots sensibles
      if (/pin|hash|password|secret|salary|salaire|contrat_prive|token|bearer/.test(key)) continue;
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return val;
}

function sanitizeDirectorSnapshot(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const sanitized = sanitizeValue(raw, 0) as Record<string, unknown>;
  // Vérification taille finale
  const str = JSON.stringify(sanitized);
  if (str.length > 50_000) {
    // Snapshot trop volumineux : garder uniquement les clés de haut niveau
    const reduced: Record<string, unknown> = {};
    for (const k of ["reservations","revenues","expenses","occupancy","hr","housekeeping","food","alerts"]) {
      if (sanitized[k]) reduced[k] = sanitized[k];
    }
    return reduced;
  }
  return sanitized;
}

/* ── Parser et valider réponse IA ────────────────────────────── */
const FORBIDDEN_AUTO_ACTIONS = [
  "modifier paiement","annuler réservation","confirmer réservation",
  "modifier prix","changer salaire","supprimer","modifier accès",
  "mettre à jour automatiquement","exécuter automatiquement",
];

function stripHtml(s: string): string {
  return String(s).replace(/<[^>]*>/g, "").slice(0, 1000);
}

function parseAndValidateAiReport(text: string): DirectorReport | null {
  // Extraire JSON depuis la réponse (peut être entouré de texte markdown)
  let jsonStr = text;
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) jsonStr = codeBlock[1];
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (!codeBlock && braceMatch) jsonStr = braceMatch[0];

  let report: DirectorReport;
  try {
    report = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  // Valider et forcer les champs obligatoires
  if (!report.title)   report.title   = "Rapport Directeur Quotidien";
  if (!report.summary) report.summary = "Rapport généré.";
  if (!["green","orange","red"].includes(report.operational_status)) {
    report.operational_status = "orange";
  }
  report.key_metrics     = report.key_metrics     ?? {};
  report.alerts          = Array.isArray(report.alerts)          ? report.alerts.slice(0, 20)          : [];
  report.recommendations = Array.isArray(report.recommendations) ? report.recommendations.slice(0, 15) : [];
  report.decisions_required = Array.isArray(report.decisions_required) ? report.decisions_required.slice(0, 10) : [];
  report.next_actions    = Array.isArray(report.next_actions)    ? report.next_actions.slice(0, 10)    : [];

  // Sanitize textes
  report.title   = stripHtml(report.title);
  report.summary = stripHtml(report.summary).slice(0, 3000);
  report.limits  = stripHtml(report.limits ?? "");

  // SÉCURITÉ CRITIQUE : forcer requires_approval = true sur TOUTES les recommandations
  // Supprimer toute recommandation qui suggère une action automatique interdite
  report.recommendations = report.recommendations
    .filter((r) => {
      const text = ((r.title ?? "") + " " + (r.description ?? "") + " " + (r.suggested_action ?? "")).toLowerCase();
      return !FORBIDDEN_AUTO_ACTIONS.some((f) => text.includes(f));
    })
    .map((r) => ({
      priority:          ["low","normal","high","urgent"].includes(r.priority) ? r.priority : "normal",
      category:          stripHtml(r.category ?? "general").slice(0, 100),
      title:             stripHtml(r.title ?? "").slice(0, 200),
      description:       stripHtml(r.description ?? "").slice(0, 500),
      related_module:    stripHtml(r.related_module ?? "dashboard").slice(0, 100),
      requires_approval: true,           // TOUJOURS forcé
      suggested_action:  r.suggested_action ? stripHtml(r.suggested_action).slice(0, 300) : null,
    }));

  // Sanitize alertes
  report.alerts = report.alerts.map((a) => ({
    priority:    ["low","normal","high","urgent"].includes(a.priority) ? a.priority : "normal",
    category:    stripHtml(a.category ?? "").slice(0, 100),
    title:       stripHtml(a.title ?? "").slice(0, 200),
    description: stripHtml(a.description ?? "").slice(0, 500),
  }));

  return report;
}

/* ── Appel Anthropic ─────────────────────────────────────────── */
async function callAnthropic(systemPrompt: string, userContent: string, apiKey: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      temperature: 0.2,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(28_000), // 28s timeout
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Anthropic API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.content?.[0]?.text ?? "";
}

/* ── Appel OpenAI ────────────────────────────────────────────── */
async function callOpenAI(systemPrompt: string, userContent: string, apiKey: string): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:       "gpt-4o-mini",
      max_tokens:  2048,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(28_000),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/* ── Construire prompt système directeur ─────────────────────── */
function buildSystemPrompt(agentSystemPrompt: string): string {
  return `${agentSystemPrompt}

RÈGLES ABSOLUES DE SÉCURITÉ :
- Tu es un assistant opérationnel, pas un exécutant autonome.
- Tu ne peux PAS modifier directement des paiements, réservations, prix, salaires, accès ou documents.
- Toutes tes recommandations doivent être validées par un humain avant exécution.
- Tu dois signaler clairement quand une donnée est absente ou indisponible.
- Tu ne dois jamais inventer des données ou faire semblant d'avoir accès à des informations non fournies.
- Tu dois toujours inclure le champ "limits" pour décrire ce que tu n'as pas pu analyser.

FORMAT DE SORTIE OBLIGATOIRE :
Tu dois répondre UNIQUEMENT avec un objet JSON valide respectant exactement cette structure :
{
  "title": "Rapport Directeur Quotidien",
  "summary": "Résumé exécutif en 2-3 phrases",
  "operational_status": "green|orange|red",
  "key_metrics": {
    "reservations": 0,
    "occupancy_rate": 0,
    "revenue": 0,
    "expenses": 0,
    "pending_payments": 0
  },
  "alerts": [
    { "priority": "low|normal|high|urgent", "category": "string", "title": "string", "description": "string" }
  ],
  "recommendations": [
    {
      "priority": "low|normal|high|urgent",
      "category": "string",
      "title": "string",
      "description": "string",
      "related_module": "string",
      "requires_approval": true,
      "suggested_action": "string ou null"
    }
  ],
  "decisions_required": [
    { "priority": "low|normal|high|urgent", "decision": "string", "reason": "string" }
  ],
  "next_actions": ["string"],
  "limits": "Ce que tu n'as pas pu analyser"
}

Langue : Français uniquement. Ton : directeur opérationnel professionnel, clair et orienté décision.`;
}

/* ── Main handler ────────────────────────────────────────────── */
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const ts = new Date().toISOString();

  if (req.method !== "POST") {
    return jsonResp({ ok:false, mode:"placeholder", error:"Méthode non autorisée — utiliser POST", timestamp:ts }, 405);
  }

  // ── Lire body ──────────────────────────────────────────────
  let body: AiRunRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ ok:false, mode:"placeholder", error:"Body JSON invalide", timestamp:ts }, 400);
  }

  const agentKey    = (body.agent_key    ?? "").trim();
  const runType     = (body.run_type     ?? "daily_report").trim();
  const requestedBy = (body.requested_by ?? "system").trim().slice(0, 100);
  const rawSnapshot = body.snapshot ?? {};

  // ── Phase 1 : seul daily_director autorisé ────────────────
  if (agentKey !== "daily_director") {
    return jsonResp({
      ok:    false, mode:"placeholder", timestamp:ts,
      error: "Seul l'agent daily_director est activé dans cette phase. Les autres agents restent en mode mock.",
    }, 403);
  }

  // ── Budget guard ──────────────────────────────────────────
  const budgetError = budgetCheck(requestedBy);
  if (budgetError) {
    return jsonResp({ ok:false, mode:"placeholder", error:budgetError, timestamp:ts }, 429);
  }

  // ── Initialiser Supabase client ────────────────────────────
  const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SB_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!SB_URL) {
    return jsonResp({ ok:false, mode:"placeholder", error:"Supabase non configuré", timestamp:ts }, 500);
  }
  const sb = createClient(SB_URL, SB_KEY);

  // ── Mission 4 : vérifier agent en base ────────────────────
  const { data: agent, error: agentErr } = await sb
    .from("veraluz_ai_agents")
    .select("agent_key,name,status,system_prompt,data_sources_json,allowed_actions_json,forbidden_actions_json,risk_level,approval_required,version")
    .eq("agent_key", "daily_director")
    .single();

  if (agentErr || !agent) {
    return jsonResp({ ok:false, mode:"placeholder", error:"Agent daily_director introuvable en base", timestamp:ts }, 404);
  }
  if (agent.status !== "active") {
    return jsonResp({ ok:false, mode:"placeholder", error:`Agent inactif (status=${agent.status})`, timestamp:ts }, 403);
  }
  if (agent.risk_level === "critical") {
    return jsonResp({ ok:false, mode:"placeholder", error:"Agent de niveau critical non autorisé dans cette phase", timestamp:ts }, 403);
  }

  // ── Mission 5 : sanitize snapshot ─────────────────────────
  const snapshot = sanitizeDirectorSnapshot(rawSnapshot);

  // ── Vérifier secrets IA ────────────────────────────────────
  const aiProvider = (Deno.env.get("AI_PROVIDER") ?? "").toLowerCase().trim();
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey    = Deno.env.get("OPENAI_API_KEY")    ?? "";

  const hasAnthropic = aiProvider === "anthropic" && anthropicKey.length > 10;
  const hasOpenAI    = aiProvider === "openai"    && openaiKey.length > 10;

  if (!hasAnthropic && !hasOpenAI) {
    // Pas de clé IA → retourner placeholder clair
    return jsonResp({
      ok:    false, mode:"placeholder", timestamp:ts, agent_key:agentKey,
      error: "Fournisseur IA non configuré. Définir AI_PROVIDER + clé dans Supabase Secrets.",
    });
  }

  // ── Mission 6 : construire prompt ─────────────────────────
  const systemPrompt = buildSystemPrompt(agent.system_prompt ?? "");
  const userContent  = `Voici les données de la résidence VERALUZ Kribi pour aujourd'hui :\n\n${JSON.stringify(snapshot, null, 2)}\n\nProduis le rapport JSON directeur.`;

  // ── Mission 7 : appel IA ──────────────────────────────────
  let rawAiText = "";
  const provider = hasAnthropic ? "anthropic" : "openai";
  const t0 = Date.now();

  try {
    if (hasAnthropic) {
      rawAiText = await callAnthropic(systemPrompt, userContent, anthropicKey);
    } else {
      rawAiText = await callOpenAI(systemPrompt, userContent, openaiKey);
    }
  } catch (err) {
    const errMsg = String(err).replace(/sk-[a-zA-Z0-9-]+/g, "sk-[REDACTED]");
    // Sauvegarder run en échec
    await sb.from("veraluz_ai_agent_runs").insert({
      agent_key:   "daily_director", run_type:runType, status:"failed",
      input_snapshot_json: snapshot,
      output_text: `Erreur fournisseur IA : ${errMsg}`,
      error_message: errMsg,
      created_by:  requestedBy,
    });
    return jsonResp({ ok:false, mode:"edge", provider, error:`Erreur IA : ${errMsg}`, timestamp:ts }, 502);
  }
  const durationMs = Date.now() - t0;

  // ── Mission 8 : parser et valider réponse ─────────────────
  const report = parseAndValidateAiReport(rawAiText);

  if (!report) {
    // Fallback : sauvegarder texte brut
    const { data: runData } = await sb.from("veraluz_ai_agent_runs").insert({
      agent_key:   "daily_director", run_type:runType, status:"completed",
      input_snapshot_json: snapshot,
      output_text: rawAiText.slice(0, 5000),
      output_json: { raw: rawAiText.slice(0, 5000), parse_error: true },
      duration_ms: durationMs, created_by: requestedBy,
    }).select("id").single();

    return jsonResp({
      ok:true, mode:"edge", provider, timestamp:ts, agent_key:agentKey,
      run_id: runData?.id,
      error:  "Réponse IA non parseable — texte brut sauvegardé",
      report: {
        title:"Rapport Directeur Quotidien", summary: rawAiText.slice(0,500),
        operational_status:"orange", key_metrics:{}, alerts:[], recommendations:[],
        decisions_required:[], next_actions:[], limits:"Parsing JSON échoué — réponse brute conservée"
      },
    });
  }

  // ── Mission 9 : sauvegarder run ───────────────────────────
  const { data: runData } = await sb.from("veraluz_ai_agent_runs").insert({
    agent_key:            "daily_director",
    run_type:             runType,
    status:               "completed",
    input_snapshot_json:  snapshot,
    output_json:          report,
    output_text:          report.summary,
    recommendations_json: report.recommendations,
    duration_ms:          durationMs,
    created_by:           requestedBy,
  }).select("id").single();

  const runId = runData?.id ?? null;

  // ── Mission 10 : sauvegarder recommandations ──────────────
  if (report.recommendations.length > 0) {
    const recsToInsert = report.recommendations.map((r) => ({
      agent_key:        "daily_director",
      category:         r.category,
      title:            r.title,
      description:      r.description,
      priority:         r.priority,
      status:           "pending",
      requires_approval: true,          // TOUJOURS forcé, jamais contournable
      related_module:   r.related_module,
      suggested_action: r.suggested_action ?? null,
    }));
    await sb.from("veraluz_ai_recommendations").insert(recsToInsert);
  }

  // ── Réponse finale ────────────────────────────────────────
  return jsonResp({
    ok:        true,
    mode:      "edge",
    provider,
    agent_key: agentKey,
    run_type:  runType,
    run_id:    runId,
    report,
    timestamp: ts,
  });
});
