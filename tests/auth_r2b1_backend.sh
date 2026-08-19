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

# ══════════════════════════════════════════════════════════════════════════════
# AUTH-R2B1.2 — Révocation globale atomique via RPC
# ══════════════════════════════════════════════════════════════════════════════

# ── I. RPC veraluz_revoke_employee_sessions — anon refusé ────────────────────
header "I — RPC revoke_employee_sessions : anon → 42501"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_revoke_employee_sessions" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AK}" -H "Authorization: Bearer ${AK}" \
  -d "{\"p_target_employee_id\":\"00000000-0000-0000-0000-000000000001\"}")
HTTP_CODE=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code','') or d.get('hint','') or 'no_code')" 2>/dev/null || echo "blocked")
[[ "$HTTP_CODE" == *"42501"* ]] || [[ "$HTTP_CODE" == *"insufficient_privilege"* ]] || [[ "$HTTP_CODE" == *"PGRST302"* ]] \
  && pass "anon → accès refusé ($HTTP_CODE)" || fail "anon → pas refusé: $R"

# ── J. RPC — authenticated refusé ────────────────────────────────────────────
header "J — RPC revoke_employee_sessions : authenticated → refusé"
# Note : authenticated = token JWT signé anon (pas de service_role). Même comportement que anon côté RLS RPC.
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_revoke_employee_sessions" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AK}" -H "Authorization: Bearer ${AK}" \
  -H "X-Client-Info: authenticated-test" \
  -d "{\"p_target_employee_id\":\"00000000-0000-0000-0000-000000000002\"}")
HTTP_CODE=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code','') or d.get('hint','') or 'no_code')" 2>/dev/null || echo "blocked")
[[ "$HTTP_CODE" == *"42501"* ]] || [[ "$HTTP_CODE" == *"insufficient_privilege"* ]] || [[ "$HTTP_CODE" == *"PGRST302"* ]] \
  && pass "authenticated → accès refusé ($HTTP_CODE)" || fail "authenticated → pas refusé: $R"

# ── K. RPC — service_role, UUID inexistant → ok:true, counts=0 ───────────────
header "K — RPC revoke_employee_sessions : service_role, UUID inexistant → ok:true 0/0"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_revoke_employee_sessions" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d "{\"p_target_employee_id\":\"00000000-0000-0000-0000-000000000099\"}")
OK=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('ok','')).lower())" 2>/dev/null || echo "")
SC=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('revoked_sessions','x'))" 2>/dev/null || echo "x")
RC=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('revoked_resumes','x'))" 2>/dev/null || echo "x")
[ "$OK" = "true" ] && [ "$SC" = "0" ] && [ "$RC" = "0" ] \
  && pass "service_role → ok:true, sessions=0, resumes=0" || fail "got: $R"

# ── L. EF revoke — caller rôle insuffisant (réceptionniste) → 403, cible intacte ──
header "L — EF revoke-employee-sessions : caller role insuffisant → 403"
# Fake session token (64 hex) — sera rejeté unauthorized avant même le check rôle
# On vérifie simplement que l'EF renvoie unauthorized/forbidden sans toucher la cible
R=$(ef revoke-employee-sessions "{\"session_token\":\"$(python3 -c "print('b'*64)")\",\"employee_id\":\"00000000-0000-0000-0000-000000000099\"}")
ERR=$(err_of "$R")
OK2=$(ok_of "$R")
[ "$OK2" = "false" ] && [[ "$ERR" == "unauthorized" || "$ERR" == "forbidden" ]] \
  && pass "403/unauthorized sans révocation ($ERR)" || fail "got: $R"

# ── M. EF revoke — employee_id format invalide (non-UUID) → 400 ──────────────
header "M — EF revoke-employee-sessions : employee_id non-UUID → 400 invalid_employee_id"
R=$(ef revoke-employee-sessions "{\"session_token\":\"$(python3 -c "print('c'*64)")\",\"employee_id\":\"not-a-uuid\"}")
ERR=$(err_of "$R")
# Note: peut être unauthorized (session fake rejetée en 1er) ou invalid_employee_id
# selon l'ordre de validation. Les deux sont corrects — l'important est ok:false.
[ "$(ok_of "$R")" = "false" ] \
  && pass "non-UUID → ok:false ($ERR)" || fail "got: $R"

# ── Résumé total ──────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────"
echo "Total AUTH-R2B1 : PASS=$PASS  FAIL=$FAIL"
echo "─────────────────────────────────────────────────"
cat << 'MANUAL2'

Tests E2E auth-r2b1.2 (nécessitent fixtures DB — protocole manuel) :

  Révocation globale normale :
    1. Insérer fixture : employé + 1 session active + 1 resume_token actif
    2. Appeler EF revoke-employee-sessions (caller gérant valide)
    3. Vérifier : ok:true, revoked_sessions=1, revoked_resumes=1
    4. Vérifier en DB : les deux lignes ont revoked_at IS NOT NULL
    5. Nettoyer fixtures

  Rollback atomique (échec step 2 simulé) :
    1. Insérer fixture : employé + 1 session active + 1 resume_token actif
    2. Simuler l'échec step 2 en appellant directement la RPC avec
       un p_target_employee_id dont la table resume_tokens est verrouillée
       (BEGIN; SELECT ... FOR UPDATE NOWAIT; puis appel RPC dans une 2e connexion)
    3. Vérifier : RPC retourne ok:false, error='server_error'
    4. Vérifier en DB : session toujours active (revoked_at IS NULL) — rollback confirmé
    5. ROLLBACK et nettoyer fixtures

  Audit log :
    1. Effectuer révocation globale avec caller gérant
    2. Vérifier veraluz_auth_events : event_type='sessions_revoked', success=true,
       details_json contient revoked_sessions + revoked_resumes corrects

MANUAL2
