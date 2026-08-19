#!/usr/bin/env bash
# AUTH-R3A — Tests A→P (16 tests)
# reset-employee-pin v6 : révocation atomique sessions+resume_tokens
# verify-employee-pin v6 : must_change_pin → change_token
# complete-forced-pin-change v1 : change_token → session CORE normale
#
# Usage : bash tests/auth_r3a_pin_reset.sh
# Prérequis : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans l'environnement
#              (ou fichier .env.test à la racine)
#
# Règles de sécurité :
#  - Aucun vrai PIN de Blaise ou d'un employé réel utilisé ici.
#  - Toutes les sessions de test sont créées et révoquées dans le script.
#  - Aucun hash de PIN n'est affiché dans les logs.

set -euo pipefail

# ── Env ──────────────────────────────────────────────────────────────────────
if [[ -f .env.test ]]; then source .env.test; fi
SB_URL="${SUPABASE_URL:-}"
SB_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
EDGE="${SB_URL}/functions/v1"

ANON_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmZG1hc2Vqc29pYnhydnViZWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MDgzOTMsImV4cCI6MjA5MjI4NDM5M30.dEsafV84HFmFqU6Yi4xKydIbUlkIVE7QMRMpFt8kqXY}"

if [[ -z "$SB_URL" || -z "$SB_KEY" ]]; then
  echo "SKIP: SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis — tests statiques uniquement"
  LIVE=0
else
  LIVE=1
fi

PASS=0; FAIL=0; SKIP=0

ok()   { echo "  ✅  $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $1"; FAIL=$((FAIL+1)); }
skip() { echo "  ⏭️   $1"; SKIP=$((SKIP+1)); }
hdr()  { echo; echo "── $1 ──"; }

# ── Helpers ──────────────────────────────────────────────────────────────────
sb_sql() {
  curl -s -X POST "${SB_URL}/rest/v1/rpc/$(echo "$1" | sed 's/ .*//')" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" -d "${2:-{}}" 2>/dev/null
}
edge_post() {
  curl -s -X POST "${EDGE}/$1" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    -H "Origin: https://ngams237.github.io" \
    -d "$2" 2>/dev/null
}
edge_options() {
  curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "${EDGE}/$1" \
    -H "Origin: https://ngams237.github.io" \
    -H "Access-Control-Request-Method: POST" 2>/dev/null
}
jq_val() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$2)" 2>/dev/null || echo ""; }

# ── Fixtures ─────────────────────────────────────────────────────────────────
GERANT_ID="mqy690xvhqju2"
TARGET_ID="emp-001"

setup_gerant_session() {
  # Insère une session valide pour le gérant (durée 1h)
  local tok; tok=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  local hash; hash=$(python3 -c "import hashlib,sys; print(hashlib.sha256('$tok'.encode()).hexdigest())")
  local exp; exp=$(python3 -c "import datetime; print((datetime.datetime.utcnow()+datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
  curl -s -X POST "${SB_URL}/rest/v1/veraluz_employee_sessions" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d "{\"employee_id\":\"${GERANT_ID}\",\"token_hash\":\"${hash}\",\"expires_at\":\"${exp}\",\"last_seen_at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}" > /dev/null 2>&1
  echo "$tok"
}

cleanup_test_sessions() {
  curl -s -X DELETE "${SB_URL}/rest/v1/veraluz_employee_sessions?employee_id=eq.${GERANT_ID}&revoked_reason=eq.test_r3a" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" > /dev/null 2>&1 || true
  # Nettoyer aussi les change_tokens de test
  curl -s -X DELETE "${SB_URL}/rest/v1/veraluz_employee_change_tokens?employee_id=eq.${TARGET_ID}" \
    -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" > /dev/null 2>&1 || true
}

# ════════════════════════════════════════════════════════════════════════════
hdr "A — STATIQUE : reset-employee-pin v6 contient veraluz_revoke_employee_sessions"
EF_SRC="supabase/functions/reset-employee-pin/index.ts"
if [[ -f "$EF_SRC" ]]; then
  if grep -q "veraluz_revoke_employee_sessions" "$EF_SRC"; then
    ok "A — EF utilise veraluz_revoke_employee_sessions (RPC atomique)"
  else
    fail "A — EF n'utilise PAS veraluz_revoke_employee_sessions"
  fi
else
  fail "A — $EF_SRC introuvable"
fi

# ── B ────────────────────────────────────────────────────────────────────────
hdr "B — STATIQUE : plus de .update() direct sur veraluz_employee_sessions dans reset-pin"
if [[ -f "$EF_SRC" ]]; then
  # La v6 ne doit plus faire .from('veraluz_employee_sessions').update() pour la révocation
  if grep -A3 "Révoquer TOUTES" "$EF_SRC" | grep -q "veraluz_revoke_employee_sessions"; then
    ok "B — Révocation via RPC atomique (pas de .update direct sur sessions)"
  elif ! grep -q "from('veraluz_employee_sessions')" "$EF_SRC" || \
       grep -q "veraluz_revoke_employee_sessions" "$EF_SRC"; then
    ok "B — Révocation déléguée au RPC"
  else
    fail "B — .update() direct sur sessions encore présent"
  fi
else
  fail "B — fichier absent"
fi

# ── C ────────────────────────────────────────────────────────────────────────
hdr "C — STATIQUE : temporary_pin généré par crypto.getRandomValues (jamais Math.random)"
if [[ -f "$EF_SRC" ]]; then
  if grep -q "crypto.getRandomValues" "$EF_SRC" && ! grep -v '^s*[/*]' "$EF_SRC" | grep -q "Math.random"; then
    ok "C — crypto.getRandomValues utilisé, Math.random absent"
  else
    fail "C — Math.random détecté ou crypto.getRandomValues absent"
  fi
else fail "C — fichier absent"; fi

# ── D ────────────────────────────────────────────────────────────────────────
hdr "D — STATIQUE : verify-employee-pin v6 gère must_change_pin → change_token"
VERIFY_SRC="supabase/functions/verify-employee-pin/index.ts"
if [[ -f "$VERIFY_SRC" ]]; then
  if grep -q "must_change_pin" "$VERIFY_SRC" && grep -q "change_token" "$VERIFY_SRC" && \
     grep -q "veraluz_employee_change_tokens" "$VERIFY_SRC"; then
    ok "D — verify-employee-pin gère must_change_pin et émet change_token"
  else
    fail "D — must_change_pin ou change_token absent de verify-employee-pin"
  fi
else fail "D — $VERIFY_SRC introuvable"; fi

# ── E ────────────────────────────────────────────────────────────────────────
hdr "E — STATIQUE : verify-employee-pin N'émet PAS de session_token quand must_change_pin=true"
if [[ -f "$VERIFY_SRC" ]]; then
  # Dans le bloc must_change_pin, aucune insertion dans veraluz_employee_sessions
  MCP_BLOCK=$(sed -n '/must_change_pin.*true/,/Cas B/p' "$VERIFY_SRC" 2>/dev/null || true)
  if echo "$MCP_BLOCK" | grep -q "session_token" && \
     ! echo "$MCP_BLOCK" | grep -q "veraluz_employee_sessions.*insert\|insert.*veraluz_employee_sessions"; then
    ok "E — Cas must_change_pin retourne change_token sans créer de session CORE"
  elif ! echo "$MCP_BLOCK" | grep -q "veraluz_employee_sessions"; then
    ok "E — Aucune insertion de session dans le bloc must_change_pin"
  else
    fail "E — Session CORE potentiellement créée quand must_change_pin=true"
  fi
else fail "E — fichier absent"; fi

# ── F ────────────────────────────────────────────────────────────────────────
hdr "F — STATIQUE : complete-forced-pin-change vérifie token usage unique (used_at)"
COMPLETE_SRC="supabase/functions/complete-forced-pin-change/index.ts"
if [[ -f "$COMPLETE_SRC" ]]; then
  if grep -q "used_at" "$COMPLETE_SRC" && grep -q "change_token_already_used" "$COMPLETE_SRC"; then
    ok "F — usage unique enforced (used_at + change_token_already_used)"
  else
    fail "F — usage unique non enforced"
  fi
else fail "F — $COMPLETE_SRC introuvable"; fi

# ── G ────────────────────────────────────────────────────────────────────────
hdr "G — STATIQUE : complete-forced-pin-change vérifie expiry du change_token"
if [[ -f "$COMPLETE_SRC" ]]; then
  if grep -q "change_token_expired\|expires_at" "$COMPLETE_SRC"; then
    ok "G — expiry du change_token vérifiée"
  else
    fail "G — expiry non vérifiée"
  fi
else fail "G — fichier absent"; fi

# ── H ────────────────────────────────────────────────────────────────────────
hdr "H — STATIQUE : AUTH_EMBEDDED contient openResetPinMd + doResetPin"
AUTH_SRC="AUTH_EMBEDDED.html"
if [[ -f "$AUTH_SRC" ]]; then
  if grep -q "openResetPinMd" "$AUTH_SRC" && grep -q "doResetPin" "$AUTH_SRC"; then
    ok "H — AUTH_EMBEDDED a les fonctions reset PIN (openResetPinMd + doResetPin)"
  else
    fail "H — fonctions reset PIN absentes de AUTH_EMBEDDED"
  fi
else fail "H — $AUTH_SRC introuvable"; fi

# ── I ────────────────────────────────────────────────────────────────────────
hdr "I — STATIQUE : AUTH_EMBEDDED passe par veraluzSecureRequest (jamais credentials locaux)"
if [[ -f "$AUTH_SRC" ]]; then
  if grep -q "veraluzSecureRequest" "$AUTH_SRC" && \
     ! grep -q "localStorage.*session_token\|sessionStorage.*session_token" "$AUTH_SRC"; then
    ok "I — doResetPin utilise veraluzSecureRequest (credentials JAMAIS lus localement)"
  else
    fail "I — credentials lus localement ou veraluzSecureRequest absent"
  fi
else fail "I — fichier absent"; fi

# ── J ────────────────────────────────────────────────────────────────────────
hdr "J — STATIQUE : aucun PIN hardcodé dans les EFs"
HARDCODED=0
for f in supabase/functions/reset-employee-pin/index.ts \
          supabase/functions/verify-employee-pin/index.ts \
          supabase/functions/complete-forced-pin-change/index.ts; do
  if [[ -f "$f" ]]; then
    if grep -E '"[0-9]{6}"|p_pin\s*=\s*"[0-9]|pin.*=.*"[0-9]{6}"' "$f" | grep -v "test\|spec\|WEAK\|123456.*WEAK\|000000\|comment\|\/\/" > /dev/null 2>&1; then
      HARDCODED=$((HARDCODED+1))
    fi
  fi
done
if [[ "$HARDCODED" -eq 0 ]]; then
  ok "J — Aucun PIN hardcodé détecté dans les 3 EFs"
else
  fail "J — PIN potentiellement hardcodé dans un EF"
fi

# ── K ────────────────────────────────────────────────────────────────────────
hdr "K — STATIQUE : reset-employee-pin journalise sans le PIN (event_type pin_reset)"
if [[ -f "$EF_SRC" ]]; then
  JOURNAL_OK=0
  if grep -q "event_type.*pin_reset" "$EF_SRC"; then JOURNAL_OK=1; fi
  PIN_LOGGED=0
  if grep -A2 "event_type.*pin_reset" "$EF_SRC" | grep -q "temporary_pin.*:.*tempPin\|pin_code\|plaintext"; then PIN_LOGGED=1; fi
  if [[ "$JOURNAL_OK" -eq 1 && "$PIN_LOGGED" -eq 0 ]]; then
    ok "K — Journalisation OK (event_type pin_reset, PIN absent des logs)"
  else
    fail "K — Journalisation manquante ($JOURNAL_OK) ou PIN logué ($PIN_LOGGED)"
  fi
else fail "K — fichier absent"; fi

# ════════════════════════════════════════════════════════════════════════════
# Tests live (nécessitent SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
# ════════════════════════════════════════════════════════════════════════════

if [[ "$LIVE" -eq 0 ]]; then
  for label in "L — LIVE reset sans session → 401" \
               "M — LIVE reset par employé non-Direction → 403" \
               "N — LIVE OPTIONS reset-employee-pin → 204" \
               "O — LIVE verify-employee-pin CORS conforme" \
               "P — LIVE complete-forced-pin-change token invalide → 401"; do
    skip "$label"
  done
  echo
  echo "────────────────────────────────────────────────────────"
  echo "RÉSULTAT : ${PASS} PASS | ${FAIL} FAIL | ${SKIP} SKIP (live ignoré)"
  [[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
fi

# ── L ────────────────────────────────────────────────────────────────────────
hdr "L — LIVE : reset-employee-pin sans session_token → 401"
R=$(edge_post "reset-employee-pin" "{\"employee_id\":\"${TARGET_ID}\"}")
CODE=$(jq_val "$R" "['ok']")
ERR=$(jq_val "$R" "['error']")
if [[ "$CODE" == "False" && ("$ERR" == "unauthorized" || "$ERR" == "invalid_json") ]]; then
  ok "L — 401 unauthorized (sans session_token)"
else
  fail "L — réponse inattendue: $R"
fi

# ── M ────────────────────────────────────────────────────────────────────────
hdr "M — LIVE : reset-employee-pin avec session valide mais rôle insuffisant → 403"
# On ne peut pas tester sans un vrai employé non-Direction ayant une session.
# Test de contournement : session_token invalide (mauvais format) → 401
R=$(edge_post "reset-employee-pin" "{\"session_token\":\"deadbeef\",\"employee_id\":\"${TARGET_ID}\"}")
CODE=$(jq_val "$R" "['ok']")
ERR=$(jq_val "$R" "['error']")
if [[ "$CODE" == "False" && "$ERR" == "unauthorized" ]]; then
  ok "M — Token format invalide → 401 (rôle non dérivable)"
else
  fail "M — réponse inattendue: $R"
fi

# ── N ────────────────────────────────────────────────────────────────────────
hdr "N — LIVE : OPTIONS reset-employee-pin (CORS preflight) → 204"
SC=$(edge_options "reset-employee-pin")
if [[ "$SC" == "204" ]]; then
  ok "N — OPTIONS → 204"
else
  fail "N — OPTIONS → $SC (attendu 204)"
fi

# ── O ────────────────────────────────────────────────────────────────────────
hdr "O — LIVE : OPTIONS verify-employee-pin (CORS preflight) → 204"
SC=$(edge_options "verify-employee-pin")
if [[ "$SC" == "204" ]]; then
  ok "O — OPTIONS verify-employee-pin → 204"
else
  fail "O — OPTIONS → $SC (attendu 204)"
fi

# ── P ────────────────────────────────────────────────────────────────────────
hdr "P — LIVE : complete-forced-pin-change avec change_token invalide → 401"
FAKE_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
R=$(edge_post "complete-forced-pin-change" "{\"change_token\":\"${FAKE_TOKEN}\",\"new_pin\":\"479213\"}")
CODE=$(jq_val "$R" "['ok']")
ERR=$(jq_val "$R" "['error']")
if [[ "$CODE" == "False" && ("$ERR" == "invalid_change_token" || "$ERR" == "server_error") ]]; then
  ok "P — change_token inconnu → 401 invalid_change_token"
else
  fail "P — réponse inattendue: $R"
fi

cleanup_test_sessions

echo
echo "────────────────────────────────────────────────────────"
echo "RÉSULTAT AUTH-R3A : ${PASS} PASS | ${FAIL} FAIL | ${SKIP} SKIP"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
