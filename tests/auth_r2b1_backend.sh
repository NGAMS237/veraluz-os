#!/usr/bin/env bash
# AUTH-R2B1 — Tests backend sessions/resume
# Nécessite : curl, jq, variables env SUPA_URL SUPA_ANON_KEY SUPA_SERVICE_KEY
# Usage: SUPA_URL=... SUPA_ANON_KEY=... SUPA_SERVICE_KEY=... bash auth_r2b1_backend.sh
set -euo pipefail

EF_BASE="${SUPA_URL}/functions/v1"
AK="${SUPA_ANON_KEY}"
SK="${SUPA_SERVICE_KEY}"

PASS=0; FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
header() { echo; echo "=== $1 ==="; }

call_ef() {
  local ef="$1"; shift
  curl -s -X POST "${EF_BASE}/${ef}" \
    -H "Content-Type: application/json" \
    -H "apikey: ${AK}" \
    -H "Authorization: Bearer ${AK}" \
    -d "$@"
}

call_ef_admin() {
  local ef="$1"; shift
  curl -s -X POST "${EF_BASE}/${ef}" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SK}" \
    -H "Authorization: Bearer ${SK}" \
    -d "$@"
}

# ─── Fixtures : récupérer un employee_id réel avec status actif ─────────────
header "Setup"
EMP_ID=$(curl -s "${SUPA_URL}/rest/v1/veraluz_employees?select=id,status&limit=1" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" | jq -r '.[0].id')
echo "  Employee ID: ${EMP_ID}"
[ -n "$EMP_ID" ] && pass "employee_id récupéré" || fail "aucun employé trouvé"

# ─── TEST A : resume token invalide → 401 ───────────────────────────────────
header "A — token invalide → 401"
R=$(call_ef resume-employee-session '{"resume_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
ERR=$(echo "$R" | jq -r '.error // empty')
[ "$ERR" = "token_invalid_or_expired" ] && pass "token_invalid_or_expired" || fail "attendu token_invalid_or_expired, got: $R"

# ─── TEST B : token trop court → 400 ────────────────────────────────────────
header "B — token trop court → 400"
R=$(call_ef resume-employee-session '{"resume_token":"short"}')
ERR=$(echo "$R" | jq -r '.error // empty')
[ "$ERR" = "invalid_token" ] && pass "invalid_token" || fail "attendu invalid_token, got: $R"

# ─── TEST C : CORS preflight GitHub Pages ────────────────────────────────────
header "C — CORS preflight origin ngams237.github.io"
R=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  "${EF_BASE}/resume-employee-session" \
  -H "Origin: https://ngams237.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type, apikey, authorization")
[ "$R" = "204" ] && pass "preflight 204" || fail "attendu 204, got: $R"

R_CORS=$(curl -s -o /dev/null -D - -X OPTIONS \
  "${EF_BASE}/resume-employee-session" \
  -H "Origin: https://ngams237.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type, apikey, authorization" | grep -i access-control-allow-origin || true)
echo "  ACAO header: $R_CORS"
[[ "$R_CORS" == *"ngams237.github.io"* ]] && pass "ACAO header correct" || fail "ACAO header manquant"

# ─── TEST D : issue-resume sans session → 401 ────────────────────────────────
header "D — issue-resume sans session → 401"
R=$(call_ef issue-resume-token '{"session_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
ERR=$(echo "$R" | jq -r '.error // empty')
[ "$ERR" = "invalid_session" ] && pass "invalid_session" || fail "attendu invalid_session, got: $R"

# ─── TEST E : logout sans token → 200 (silencieux) ───────────────────────────
header "E — logout token invalide → 200 silencieux"
R=$(call_ef logout-employee-session '{"session_token":"notahextoken"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "200 silencieux" || fail "attendu ok:true, got: $R"

# ─── TEST F : revoke-employee-sessions sans auth → 401 ───────────────────────
header "F — revoke sans session valide → 401"
R=$(call_ef revoke-employee-sessions "{\"session_token\":\"$(printf 'a%.0s' {1..64})\",\"employee_id\":\"${EMP_ID}\"}")
ERR=$(echo "$R" | jq -r '.error // empty')
[ "$ERR" = "unauthorized" ] && pass "unauthorized" || fail "attendu unauthorized, got: $R"

# ─── Résumé ───────────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────"
echo "Résultat statique : PASS=$PASS  FAIL=$FAIL"
echo "─────────────────────────────────────────────────"
echo "Note : les tests live E2E (multi-device, rotation, actif/active)"
echo "nécessitent un PIN de test valide et sont exécutés manuellement."
echo "Voir AUTH-R2B1-LIVE-TESTS.md pour le protocole complet."
