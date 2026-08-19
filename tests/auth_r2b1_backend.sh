#!/usr/bin/env bash
# AUTH-R2B1.1 — Tests backend sessions/resume hardening
# Usage: SUPA_URL=... SUPA_ANON_KEY=... SUPA_SERVICE_KEY=... bash auth_r2b1_backend.sh
set -euo pipefail

EF_BASE="${SUPA_URL}/functions/v1"
AK="${SUPA_ANON_KEY}"
SK="${SUPA_SERVICE_KEY}"
PASS=0; FAIL=0

pass() { echo "  PASS ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL ✗ $1"; FAIL=$((FAIL+1)); }
header() { echo; echo "=== $1 ==="; }

ef() { curl -s -X POST "${EF_BASE}/$1" -H "Content-Type: application/json" \
  -H "apikey: ${AK}" -H "Authorization: Bearer ${AK}" -d "$2"; }

ef_admin() { curl -s -X POST "${EF_BASE}/$1" -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" -d "$2"; }

err_of() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))"; }
ok_of()  { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('ok','')).lower())"; }

# ── A. Resume token invalide ─────────────────────────────────────────────────
header "A — resume_token invalide (96 hex) → token_invalid_or_expired"
R=$(ef resume-employee-session "{\"resume_token\":\"$(python3 -c "print('a'*96)")\"}")
[ "$(err_of "$R")" = "token_invalid_or_expired" ] && pass "token_invalid_or_expired" || fail "got: $R"

# ── B. Token trop court ──────────────────────────────────────────────────────
header "B — resume_token trop court → invalid_token"
R=$(ef resume-employee-session '{"resume_token":"short"}')
[ "$(err_of "$R")" = "invalid_token" ] && pass "invalid_token" || fail "got: $R"

# ── C. CORS preflight GitHub Pages → 204 + ACAO origin ──────────────────────
header "C — CORS preflight GitHub Pages"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  "${EF_BASE}/resume-employee-session" \
  -H "Origin: https://ngams237.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type, apikey, authorization")
[ "$CODE" = "204" ] && pass "OPTIONS → 204" || fail "OPTIONS → $CODE (attendu 204, EF live = ancienne version)"

ACAO=$(curl -s -D - -o /dev/null -X OPTIONS "${EF_BASE}/resume-employee-session" \
  -H "Origin: https://ngams237.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type, apikey, authorization" \
  | grep -i "access-control-allow-origin" || true)
[[ "$ACAO" == *"ngams237.github.io"* ]] && pass "ACAO origin spécifique" || fail "ACAO: $ACAO (corrigé en v3, test post-déploiement)"

# ── D. issue-resume session invalide → invalid_session ───────────────────────
header "D — issue-resume session invalide → invalid_session"
R=$(ef issue-resume-token "{\"session_token\":\"$(python3 -c "print('a'*64)")\"}")
[ "$(err_of "$R")" = "invalid_session" ] && pass "invalid_session" || fail "got: $R"

# ── E. Logout token invalide → 200 silencieux ────────────────────────────────
header "E — logout token invalide → 200 silencieux"
R=$(ef logout-employee-session '{"session_token":"notahex"}')
[ "$(ok_of "$R")" = "true" ] && pass "200 silencieux" || fail "got: $R"

# ── F. Revoke sans auth → unauthorized ───────────────────────────────────────
header "F — revoke sans session valide → unauthorized"
R=$(ef revoke-employee-sessions "{\"session_token\":\"$(python3 -c "print('a'*64)")\",\"employee_id\":\"test-id\"}")
[ "$(err_of "$R")" = "unauthorized" ] && pass "unauthorized" || fail "got: $R"

# ── G. RPC veraluz_rotate_resume_token — droits anon refusés ─────────────────
header "G — RPC rotate_resume_token : anon refusé"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_rotate_resume_token" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AK}" -H "Authorization: Bearer ${AK}" \
  -d "{\"p_old_resume_hash\":\"$(python3 -c "print('a'*64)")\",\"p_new_resume_hash\":\"$(python3 -c "print('b'*64)")\",\"p_new_session_hash\":\"$(python3 -c "print('c'*64)")\",\"p_device_hint\":\"test\",\"p_resume_expires_at\":\"2099-01-01T00:00:00Z\",\"p_session_expires_at\":\"2099-01-01T00:00:00Z\"}")
HTTP=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code','') or d.get('error','') or 'no_code')" 2>/dev/null || echo "blocked")
[[ "$HTTP" == *"42501"* ]] || [[ "$HTTP" == *"insufficient_privilege"* ]] || [[ "$HTTP" == *"blocked"* ]] || [[ "$HTTP" == *"42"* ]] && pass "anon → accès refusé ($HTTP)" || fail "anon → pas refusé: $R"

# ── H. RPC — token invalide via service_role → token_invalid_or_expired ──────
header "H — RPC rotate_resume_token via service_role : token inexistant → erreur propre"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_rotate_resume_token" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d "{\"p_old_resume_hash\":\"$(python3 -c "print('a'*64)")\",\"p_new_resume_hash\":\"$(python3 -c "print('b'*64)")\",\"p_new_session_hash\":\"$(python3 -c "print('c'*64)")\",\"p_device_hint\":\"test\",\"p_resume_expires_at\":\"2099-01-01T00:00:00Z\",\"p_session_expires_at\":\"2099-01-01T00:00:00Z\"}")
ERR=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "parse_fail")
[ "$ERR" = "token_invalid_or_expired" ] && pass "RPC → token_invalid_or_expired" || fail "got: $R"

# ── Résumé ────────────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────"
echo "Résultats statiques : PASS=$PASS  FAIL=$FAIL"
echo "─────────────────────────────────────────────────"
cat << 'MANUAL'

Tests E2E live (nécessitent PIN valide — protocole manuel) :

  Multi-device :
    1. Login employé A (PC) → issue-resume → store resume_A
    2. Login même employé B (téléphone) → issue-resume → store resume_B
    3. Vérifier : resume_A → session OK (pas révoqué par login B)
    4. Vérifier : resume_B → session OK
    5. logout A (session_A + resume_A)
    6. Vérifier : resume_A → token_invalid_or_expired
    7. Vérifier : resume_B → session OK (non affecté)
    8. revoke-employee-sessions (admin) sur l'employé
    9. Vérifier : resume_B → employee_inactive ou token_invalid_or_expired

  Atomicité (rollback RPC) :
    1. Insérer un resume_token valide en DB (fixture)
    2. Provoquer un échec dans la RPC (ex: p_new_session_hash dupliqué = UNIQUE violation)
    3. Vérifier : ancien token toujours valide (non révoqué)
    4. Nettoyer la fixture

  Status bilingue :
    1. Employé status='actif' → resume → session OK
    2. Employé status='active' → resume → session OK
    3. Employé status='inactif' → resume → employee_inactive

MANUAL
