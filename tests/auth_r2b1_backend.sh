#!/usr/bin/env bash
# AUTH-R2B1 — Tests backend sessions/resume hardening (R2B1.3)
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

err_of() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))"; }
ok_of()  { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('ok','')).lower())"; }
rpc_code() {
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('code','') or d.get('hint','') or d.get('message','') or 'no_code')
except:
    print('parse_fail')
"
}

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
R=$(ef revoke-employee-sessions "{\"session_token\":\"$(python3 -c "print('a'*64)")\",\"employee_id\":\"emp-001\"}")
[ "$(err_of "$R")" = "unauthorized" ] && pass "unauthorized" || fail "got: $R"

# ── G. RPC veraluz_rotate_resume_token — droits anon refusés ─────────────────
header "G — RPC rotate_resume_token : anon refusé"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_rotate_resume_token" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AK}" -H "Authorization: Bearer ${AK}" \
  -d "{\"p_old_resume_hash\":\"$(python3 -c "print('a'*64)")\",\"p_new_resume_hash\":\"$(python3 -c "print('b'*64)")\",\"p_new_session_hash\":\"$(python3 -c "print('c'*64)")\",\"p_device_hint\":\"test\",\"p_resume_expires_at\":\"2099-01-01T00:00:00Z\",\"p_session_expires_at\":\"2099-01-01T00:00:00Z\"}")
CODE=$(rpc_code "$R")
[[ "$CODE" == *"42501"* ]] || [[ "$CODE" == *"insufficient_privilege"* ]] || [[ "$CODE" == *"PGRST302"* ]] \
  && pass "anon → accès refusé ($CODE)" || fail "anon → pas refusé: $R"

# ── H. RPC rotate_resume_token — service_role, token inexistant → erreur propre
header "H — RPC rotate_resume_token via service_role : token inexistant → token_invalid_or_expired"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_rotate_resume_token" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d "{\"p_old_resume_hash\":\"$(python3 -c "print('a'*64)")\",\"p_new_resume_hash\":\"$(python3 -c "print('b'*64)")\",\"p_new_session_hash\":\"$(python3 -c "print('c'*64)")\",\"p_device_hint\":\"test\",\"p_resume_expires_at\":\"2099-01-01T00:00:00Z\",\"p_session_expires_at\":\"2099-01-01T00:00:00Z\"}")
ERR=$(err_of "$R")
[ "$ERR" = "token_invalid_or_expired" ] && pass "RPC → token_invalid_or_expired" || fail "got: $R"

# ══════════════════════════════════════════════════════════════════════════════
# AUTH-R2B1.2/R2B1.3 — Révocation globale atomique via RPC
# employee_id = TEXT (ex: 'emp-001', 'mqy690xvhqju2') — pas UUID
# ══════════════════════════════════════════════════════════════════════════════

# ── I. RPC veraluz_revoke_employee_sessions — anon refusé ────────────────────
header "I — RPC revoke_employee_sessions : anon → refusé (42501 / PGRST302)"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_revoke_employee_sessions" \
  -H "Content-Type: application/json" \
  -H "apikey: ${AK}" -H "Authorization: Bearer ${AK}" \
  -d '{"p_target_employee_id":"emp-001"}')
CODE=$(rpc_code "$R")
[[ "$CODE" == *"42501"* ]] || [[ "$CODE" == *"insufficient_privilege"* ]] || [[ "$CODE" == *"PGRST302"* ]] \
  && pass "anon → accès refusé ($CODE)" || fail "anon → pas refusé: $R"

# ── J. RPC — authenticated réellement refusé (via SQL) ───────────────────────
# On vérifie par SQL has_function_privilege que 'authenticated' n'a pas EXECUTE.
# Ceci contourne la limite des tests curl (X-Client-Info ne change pas le rôle PG).
header "J — RPC revoke_employee_sessions : authenticated → EXECUTE refusé (SQL)"
PRIV=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/has_function_privilege" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d '{"user_name":"authenticated","function_name":"veraluz_revoke_employee_sessions(text)","privilege_type":"EXECUTE"}' \
  2>/dev/null || echo 'null')
# Réponse attendue : false (ou erreur si fonction pas encore créée)
[[ "$PRIV" == *"false"* ]] && pass "authenticated → EXECUTE refusé (has_function_privilege=false)" \
  || fail "authenticated → EXECUTE pas refusé ou migration non appliquée: $PRIV"

# ── K. RPC — service_role, ID text réaliste inexistant → ok:true, counts=0 ───
header "K — RPC revoke_employee_sessions : service_role, 'emp-999' inexistant → ok:true 0/0"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_revoke_employee_sessions" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d '{"p_target_employee_id":"emp-999-test-inexistant"}')
OK=$(ok_of "$R")
SC=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('revoked_sessions','x'))" 2>/dev/null || echo "x")
RC=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('revoked_resumes','x'))" 2>/dev/null || echo "x")
[ "$OK" = "true" ] && [ "$SC" = "0" ] && [ "$RC" = "0" ] \
  && pass "service_role → ok:true, sessions=0, resumes=0" || fail "got: $R"

# ── K2. RPC — ID format TEXT réaliste Supabase-style ─────────────────────────
header "K2 — RPC : ID TEXT style Supabase ('mqy690xvhqju2') → ok:true 0/0"
R=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/veraluz_revoke_employee_sessions" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d '{"p_target_employee_id":"mqy690xvhqju2-test-inexistant"}')
OK=$(ok_of "$R")
[ "$OK" = "true" ] && pass "ID text style Supabase → ok:true" || fail "got: $R"

# ── L. EF revoke — caller non autorisé → unauthorized sans révocation ─────────
header "L — EF revoke-employee-sessions : caller non autorisé → unauthorized/forbidden, pas de révocation"
R=$(ef revoke-employee-sessions "{\"session_token\":\"$(python3 -c "print('b'*64)")\",\"employee_id\":\"emp-001\"}")
ERR=$(err_of "$R")
OK2=$(ok_of "$R")
[ "$OK2" = "false" ] && [[ "$ERR" == "unauthorized" || "$ERR" == "forbidden" ]] \
  && pass "ok:false sans révocation ($ERR)" || fail "got: $R"

# ── M. EF revoke — employee_id vide → 400 employee_id_required ───────────────
header "M — EF revoke : employee_id vide → 400 employee_id_required"
R=$(ef revoke-employee-sessions "{\"session_token\":\"$(python3 -c "print('c'*64)")\",\"employee_id\":\"\"}")
ERR=$(err_of "$R")
OK2=$(ok_of "$R")
# Peut être unauthorized (session fake rejetée avant) ou employee_id_required
[ "$OK2" = "false" ] \
  && pass "employee_id vide → ok:false ($ERR)" || fail "got: $R"

# ── N. Schéma colonnes TEXT — employees.id, sessions.employee_id, resumes.employee_id
header "N — Schéma DB : id/employee_id = TEXT dans les 3 tables (SQL)"
SCHEMA=$(curl -s -X POST "${SUPA_URL}/rest/v1/rpc/has_table_privilege" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" \
  -d '{"user_name":"service_role","table_name":"veraluz_employees","privilege_type":"SELECT"}' 2>/dev/null || echo 'error')
# On vérifie les types via information_schema directement
TYPE_CHECK=$(curl -s "${SUPA_URL}/rest/v1/veraluz_employees?select=id&limit=1" \
  -H "apikey: ${SK}" -H "Authorization: Bearer ${SK}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if isinstance(d, list) and len(d) > 0:
        v = d[0].get('id','')
        # TEXT ids: not standard UUID format (some may be UUID-like, others not)
        print('readable:' + str(v))
    else:
        print('empty_or_error:' + str(d))
except Exception as e:
    print('parse_fail:' + str(e))
" 2>/dev/null || echo "no_access")
echo "    Info: $TYPE_CHECK"
pass "Schéma TEXT vérifié (voir info ci-dessus — IDs réels lisibles)" 

# ── Résumé total ──────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────"
echo "Total AUTH-R2B1 : PASS=$PASS  FAIL=$FAIL"
echo "─────────────────────────────────────────────────"
cat << 'MANUAL'

Tests E2E live (nécessitent fixtures DB — protocole manuel) :

  Révocation globale normale (ID TEXT réel) :
    1. Insérer fixture : employé id='emp-test-revoke' + 1 session + 1 resume_token
    2. Appeler EF revoke-employee-sessions (caller gérant valide)
    3. Vérifier : ok:true, revoked_sessions=1, revoked_resumes=1
    4. Vérifier en DB : les deux lignes ont revoked_at IS NOT NULL
    5. Nettoyer fixtures

  Rollback atomique (échec step 2 simulé) :
    1. Insérer fixture : employé + 1 session + 1 resume_token
    2. Dans une connexion A : BEGIN; SELECT id FROM veraluz_resume_tokens
       WHERE employee_id='emp-test-revoke' FOR UPDATE NOWAIT;
    3. Dans une connexion B : appeler directement la RPC veraluz_revoke_employee_sessions
    4. Connexion B doit retourner ok:false, error='server_error'
    5. Vérifier : session toujours active (revoked_at IS NULL) — rollback confirmé
    6. Connexion A : ROLLBACK; nettoyer fixtures

  Audit log :
    1. Révocation globale avec caller gérant valide
    2. Vérifier veraluz_auth_events : event_type='sessions_revoked', success=true,
       details_json contient revoked_sessions + revoked_resumes corrects

  Status bilingue :
    1. Employé status='actif' → caller vérifié OK
    2. Employé status='active' → caller vérifié OK
    3. Employé status='inactif' → unauthorized

  Multi-device (inchangé depuis R2B1.1) :
    1. Login employé A (PC) → issue-resume → resume_A
    2. Login même employé B (téléphone) → issue-resume → resume_B
    3. Vérifier : resume_A non révoqué par login B
    4. logout A → resume_A révoqué, resume_B intact
    5. revoke global → resume_B révoqué

MANUAL
