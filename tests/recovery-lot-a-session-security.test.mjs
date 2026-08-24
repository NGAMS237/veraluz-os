import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const core = read('VERALUZ_OS_CORE.html');
const rh = read('RH_EMBEDDED.html');
const edge = read('supabase/functions/employees-secure/index.ts');
const migration = read('supabase/migrations/20260824_recovery_lot_a_rh_privacy.sql');

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) { console.log(`  PASS ${name}`); passed += 1; }
  else { console.log(`  FAIL ${name}`); failed += 1; }
}
async function testAsync(name, assertion) {
  try { test(name, Boolean(await assertion())); }
  catch (error) { console.log(`       ${error.stack || error.message}`); test(name, false); }
}

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

function actionBlock(action, nextAction) {
  const start = edge.indexOf(`if (action === '${action}')`);
  if (start < 0) return '';
  const end = nextAction ? edge.indexOf(`if (action === '${nextAction}')`, start + 1) : edge.length;
  return edge.slice(start, end < 0 ? edge.length : end);
}

const checkAuth = fnSource(core, 'checkAuth');
const resume = fnSource(core, 'resumeCoreSession');
const login = fnSource(core, 'doLoginPin');
const logout = fnSource(core, 'logout');
const clear = fnSource(core, 'clearCoreLocalSession');
const kioskEnter = fnSource(core, 'enterCoreKioskMode');
const kioskSession = fnSource(core, 'enterCoreKioskEmployeeSession');
const kioskFinish = fnSource(core, 'finishCoreKioskPunch');
const punchIn = fnSource(core, 'doPunchIn');
const punchOut = fnSource(core, 'doPunchOut');
const rhLogin = fnSource(rh, 'showLoginScreen');
const rhLogout = fnSource(rh, 'logoutEmp');
const workspace = actionBlock('get_my_rh_workspace', 'punch_self');
const punchSelf = actionBlock('punch_self', 'complete_my_task');
const rhRead = actionBlock('rh_read', 'rh_write');
const rhWrite = actionBlock('rh_write', 'rh_update_settings');

test('A01 login employé normal attend la stabilisation serveur',
  /stabilizeCoreEmployeeLogin\(result, result\.session_token/.test(login));
test('A02 F5 utilise le resume opaque local puis la réponse serveur',
  /localStorage\.getItem\(CORE_RESUME_KEY\)/.test(checkAuth)
    && /resumeCoreSession\(resumeToken\)/.test(checkAuth)
    && /enterCoreEmployeeSession\(data, data\.session_token\)/.test(resume));
test('A03 logout gérant/employé nettoie session et resume',
  /clearCoreLocalSession\(true\)/.test(logout)
    && /localStorage\.removeItem\(CORE_RESUME_KEY\)/.test(clear));
test('A04 Mon espace utilise currentUser issu du serveur',
  /currentUser\.employee_id !== employeeId/.test(fnSource(core, 'loadEmployeePersonalData'))
    && /get_my_rh_workspace/.test(fnSource(core, 'loadEmployeePersonalData')));
test('A05 session employé restaurée revient sur employee_home',
  /goTo\('employee_home'\)/.test(fnSource(core, 'enterCoreEmployeeSession')));
test('A06 session expirée/révoquée revient au login',
  /error\.status === 401 \|\| error\.status === 403/.test(resume)
    && /clearCoreLocalSession\(invalidCredential\)/.test(resume));
test('A07 logout RH ne révèle aucune session gérant cachée',
  /enter-kiosk-mode/.test(rhLogout) && !/showClockScreen/.test(rhLogout));
test('A08 iframe RH ne crée ni ne restaure LOGGED_EMP',
  /LOGGED_EMP = null/.test(rh) && !/LOGGED_EMP\s*=\s*emp/.test(rh));
test('A09 spoof employee_id self impossible',
  /validateFields\(body, SELF_WORKSPACE_FIELDS\)/.test(workspace)
    && !/body\.employee_id/.test(workspace)
    && workspace.match(/\.eq\('employee_id', actor\.id\)/g)?.length >= 8);
test('A10 RH autorisé lit via capability serveur',
  /hasCapability\(actor\.role, 'employees\.manage'\)/.test(rhRead));
test('A11 gérant conserve employees.manage dans RBAC canonique',
  /gerant:\s*\[[\s\S]*?'employees\.manage'/.test(read('supabase/functions/_shared/_rbac.ts')));
test('A12 cache local expiré ne bloque plus la reprise serveur',
  !/expires|veraluz_auth_v1|sessionStorage/.test(checkAuth));
test('A13 session révoquée ne peut pas être reconstituée des métadonnées',
  !/JSON\.parse/.test(checkAuth) && !/currentUser\s*=\s*\{/.test(checkAuth));
test('A14 kiosque revient verrouillé après chaque pointage',
  /finishCoreKioskPunch/.test(punchIn) && /finishCoreKioskPunch/.test(punchOut)
    && /showCoreKioskLocked/.test(kioskFinish));
test('A15 kiosque ne construit jamais la navigation CORE',
  !/buildNav|loadDashboardData|goTo\(/.test(kioskSession));
test('A16 deux utilisateurs kiosque sont isolés par révocation et wipe',
  /logoutCoreSessionBestEffort\(token, null\)/.test(kioskFinish)
    && /clearCoreLocalSession\(true\)/.test(kioskFinish));
test('A17 F5 kiosque reste verrouillé et supprime tout resume',
  /isCoreKioskContext\(\)/.test(checkAuth)
    && /clearCoreLocalSession\(true\)/.test(checkAuth)
    && /showCoreKioskLocked/.test(checkAuth));
test('A18 aucun token de session brut persisté',
  !/(?:localStorage|sessionStorage)\.setItem\([^\n;]*(?:session_token|_sessionToken)/i.test(core)
    && !/console\.(?:log|warn|error)\([^\n]*(?:sessionToken|rawToken|pin)/i.test(edge));
test('A19 localStorage seul ne donne pas accès au broker RH',
  /var tok = getSessionToken\(\)/.test(fnSource(core, 'veraluzSecureRequest'))
    || /if \(!tok\)[\s\S]*not_logged_in/.test(core.slice(core.indexOf('window.veraluzSecureRequest'))));
test('A20 pointage cross-employee refusé côté serveur',
  /validateFields\(body, PUNCH_SELF_FIELDS\)/.test(punchSelf)
    && !/body\.employee_id/.test(punchSelf)
    && /\.eq\('employee_id', actor\.id\)/.test(punchSelf));

test('RH-01 lectures/écritures iframe passent par employees-secure',
  /employeesSecure\('rh_read'/.test(rh) && /employeesSecure\('rh_write'/.test(rh)
    && !/fetch\(SUPA_URL\+'\/rest\/v1\/veraluz_(?:attendance|payroll|contracts|advances|hr_documents|hr_tasks|schedules)/.test(rh));
test('RH-02 écriture générique utilise table/colonnes allowlistées',
  /rhResourceName\(body\.resource\)/.test(rhWrite)
    && /sanitizeRhValues\(resource, body\.values, actor\)/.test(rhWrite));
test('RLS-01 migration active RLS et retire anon/authenticated',
  /enable row level security/.test(migration)
    && /revoke all privileges[\s\S]*from anon, authenticated/.test(migration));
test('RLS-02 migration ne touche ni réservation ni Finance',
  !/veraluz_reservations|veraluz_payments|veraluz_room_charges/.test(migration));

function fakeDb(actorRole = 'staff') {
  return { from(table) {
    const state = { table, projection: '', filters: {}, operation: 'select', values: null };
    const query = {
      select(value) { state.projection = value; return query; },
      eq(key, value) { state.filters[key] = value; return query; },
      is() { return query; }, gt() { return query; }, order() { return query; },
      limit() { return query; },
      insert(values) { state.operation = 'insert'; state.values = values; return query; },
      update(values) { state.operation = 'update'; state.values = values; return query; },
      delete() { state.operation = 'delete'; return query; },
      maybeSingle() { return Promise.resolve(resolve()); },
      single() { return Promise.resolve(resolve()); },
      then(ok, ko) { return Promise.resolve(resolve()).then(ok, ko); },
    };
    function resolve() {
      if (table === 'veraluz_employee_sessions') return { data: { employee_id: 'actor-1' }, error: null };
      if (table === 'veraluz_employees' && state.projection === 'id,role,status') {
        return { data: { id: 'actor-1', role: actorRole, status: 'actif' }, error: null };
      }
      if (state.operation === 'select') return { data: [], error: null };
      return { data: [], error: null };
    }
    return query;
  } };
}

async function invokeEdge(body, actorRole = 'staff') {
  let handler;
  const runtime = stripTypeScriptTypes(edge, { mode: 'transform' })
    .replace(/^import \{ createClient \}[^;]+;\s*$/m, 'const createClient = globalThis.__createClient;')
    .replace(/^import \{ normalizeRole, hasCapability, isPrivilegedRole \}[^;]+;\s*$/m,
      `const normalizeRole=(r)=>String(r||'').toLowerCase();
       const hasCapability=(r,c)=>c==='employees.manage'&&['gerant','manager','rh'].includes(normalizeRole(r));
       const isPrivilegedRole=(r)=>['gerant','admin','superadmin','direction'].includes(normalizeRole(r));`);
  const context = vm.createContext({
    __createClient: () => fakeDb(actorRole),
    Deno: { env: { get: (name) => name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'service-key' }, serve: (fn) => { handler = fn; } },
    Request, Response, TextEncoder, URL, Intl, crypto,
    console: { log() {}, warn() {}, error() {} },
  });
  new vm.Script(runtime, { filename: 'employees-secure/index.ts' }).runInContext(context);
  const response = await handler(new Request('https://example.supabase.co/functions/v1/employees-secure', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://ngams237.github.io', 'x-veraluz-session': 'temporary-session-token-for-tests' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

await testAsync('RUNTIME-01 SELF rejette employee_id choisi par le client', async () => {
  const result = await invokeEdge({ action: 'get_my_rh_workspace', employee_id: 'other' });
  return result.status === 400 && result.body.error === 'invalid_workspace_fields';
});
await testAsync('RUNTIME-02 pointage rejette employee_id choisi par le client', async () => {
  const result = await invokeEdge({ action: 'punch_self', event: 'in', employee_id: 'other' });
  return result.status === 400 && result.body.error === 'invalid_punch';
});
await testAsync('RUNTIME-03 employé sans capability reçoit 403 sur RH admin', async () => {
  const result = await invokeEdge({ action: 'rh_read', resource: 'veraluz_payroll' }, 'staff');
  return result.status === 403 && result.body.error === 'forbidden';
});
await testAsync('RUNTIME-04 gérant autorisé peut appeler la lecture RH', async () => {
  const result = await invokeEdge({ action: 'rh_read', resource: 'veraluz_payroll' }, 'gerant');
  return result.status === 200 && result.body.ok === true;
});

const syntaxErrors = [];
for (const [name, html] of [['CORE', core], ['RH', rh]]) {
  const valid = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
    try { new vm.Script(match[1], { filename: `${name}.html` }); return true; }
    catch (error) { syntaxErrors.push(error.stack || error.message); return false; }
  });
  test(`SYNTAX-${name}`, valid);
}
for (const error of syntaxErrors) console.log(`       ${error}`);

console.log(`\nRESULTAT RECOVERY LOT A: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
