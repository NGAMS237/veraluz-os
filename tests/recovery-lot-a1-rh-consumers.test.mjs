import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const analytics = read('ANALYTICS_EMBEDDED.html');
const livreur = read('LIVREUR.html');
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

function actionBlock(action, nextAction) {
  const start = edge.indexOf(`if (action === '${action}')`);
  if (start < 0) return '';
  const end = edge.indexOf(`if (action === '${nextAction}')`, start + 1);
  return edge.slice(start, end < 0 ? edge.length : end);
}

const analyticsBlock = actionBlock('list_analytics', 'rh_list');
const deliveryHelper = edge.slice(
  edge.indexOf('async function getDeliveryEmployee'),
  edge.indexOf('async function authorizeTargetMutation'),
);
const shiftBlock = actionBlock('get_my_delivery_shift_status', 'record_my_delivery_checkin');
const checkinBlock = actionBlock('record_my_delivery_checkin', 'update_my_photo');

test('A1-01 Analytics ne fait plus de SELECT anon direct sur payroll',
  !/safeFetchTable\(['"]veraluz_payroll/.test(analytics)
    && !/\/rest\/v1\/veraluz_payroll/.test(analytics));
test('A1-03 Analytics utilise finance.read et une projection paie minimale',
  /hasCapability\(actor\.role, 'finance\.read'\)/.test(analyticsBlock)
    && /select\('employee_id,period_month,period_year,net_salary'\)/.test(analyticsBlock)
    && !/(notes|deductions|cnps|irpp|bank_account)/.test(
      [...analyticsBlock.matchAll(/\.select\('([^']+)'\)/g)].map((match) => match[1]).join(','),
    ));
test('A1-04 agrégats et écrans Analytics utilisent la réponse sécurisée',
  /_payroll\s*=\s*results\[4\]\.payroll/.test(analytics)
    && /_employees\s*=\s*results\[4\]\.employees/.test(analytics)
    && /monthMap\[k\]\.exp \+= toNum\(p\.net_salary\)/.test(analytics)
    && /payroll_all_time: _payroll\.reduce/.test(analytics));

test('A1-05 Livreur ne lit/écrit plus directement pointages',
  !/(?:sbFetch|sbPost|sbInsert|sbPatch)\(['"]veraluz_pointages/.test(livreur)
    && !/\/rest\/v1\/veraluz_pointages/.test(livreur));
test('A1-06 Livreur ne lit/écrit plus directement employee_checkins',
  !/(?:sbFetch|sbPost|sbInsert|sbPatch)\(['"]veraluz_employee_checkins/.test(livreur)
    && !/\/rest\/v1\/veraluz_employee_checkins/.test(livreur));
test('A1-07 état Livreur limité à SELF et à la table attendance canonique',
  /get_my_delivery_shift_status/.test(livreur)
    && /\.from\('veraluz_attendance'\)/.test(shiftBlock)
    && /\.eq\('employee_id', actor\.id\)/.test(shiftBlock)
    && /getDeliveryEmployee\(db, actor\)/.test(shiftBlock));
test('A1-08 payloads Livreur ne choisissent jamais employee_id',
  !/body\.employee_id/.test(shiftBlock + checkinBlock + deliveryHelper)
    && /employee_id: actor\.id/.test(checkinBlock)
    && /validateFields\(body, RECORD_MY_DELIVERY_CHECKIN_FIELDS\)/.test(checkinBlock));
test('A1-09 workflow Livreur conserve pointage, offline sync, selfie et profil',
  /function doPunch\(type\)/.test(livreur)
    && /queueAction\('punch'/.test(livreur)
    && /punch_my_delivery_shift/.test(livreur)
    && /record_my_delivery_checkin/.test(livreur)
    && /employeesSecure\('update_my_photo'/.test(livreur));

test('A1-10 migration RLS couvre les trois consommateurs corrigés',
  /'veraluz_payroll'/.test(migration)
    && /'veraluz_pointages'/.test(migration)
    && /'veraluz_employee_checkins'/.test(migration));
test('A1-11 aucune policy/grant anon permissif réintroduit',
  !/create\s+policy/i.test(migration)
    && !/grant\s+(?:select|insert|update|delete|all)[\s\S]*?\s+to\s+(?:anon|authenticated)/i.test(migration));
test('A1-12 service_role conserve l’accès serveur',
  /grant select, insert, update, delete on table public\.%I to service_role/i.test(migration));

function fakeDb(actorRole = 'staff', deliveryAllowed = true) {
  const calls = [];
  return { calls, from(table) {
    const state = { table, projection: '', filters: {}, operation: 'select', values: null };
    calls.push(state);
    const query = {
      select(value) { state.projection = value; return query; },
      eq(key, value) { state.filters[key] = value; return query; },
      is() { return query; }, gt() { return query; }, in() { return query; },
      order() { return query; }, limit() { return query; },
      insert(values) { state.operation = 'insert'; state.values = values; return query; },
      update(values) { state.operation = 'update'; state.values = values; return query; },
      delete() { state.operation = 'delete'; return query; },
      maybeSingle() { return Promise.resolve(resolve(true)); },
      single() { return Promise.resolve(resolve(true)); },
      then(ok, ko) { return Promise.resolve(resolve(false)).then(ok, ko); },
    };
    function resolve(single) {
      if (table === 'veraluz_employee_sessions') return { data: { employee_id: 'actor-1' }, error: null };
      if (table === 'veraluz_employees' && state.projection === 'id,role,status') {
        return { data: { id: 'actor-1', role: actorRole, status: 'actif' }, error: null };
      }
      if (table === 'veraluz_employees' && state.projection.includes('team_id')) {
        return { data: deliveryAllowed ? { id: 'actor-1', full_name: 'Test Livreur', role: actorRole, status: 'actif', team_id: 'team-delivery' } : null, error: null };
      }
      if (table === 'veraluz_employees') return { data: [{ id: 'actor-1', full_name: 'Test', role: actorRole, status: 'actif', base_salary: 100, contract_type: 'test' }], error: null };
      if (table === 'veraluz_teams') return { data: deliveryAllowed ? { id: 'team-delivery', name: 'Livreurs' } : { id: 'team-other', name: 'Maintenance' }, error: null };
      if (table === 'veraluz_payroll') return { data: [{ employee_id: 'actor-1', period_month: 8, period_year: 2026, net_salary: 90 }], error: null };
      if (table === 'veraluz_attendance') return { data: single ? { id: 'att-1', date: '2026-08-24', check_in: '08:00:00', check_out: null, status: 'present' } : [], error: null };
      if (table === 'veraluz_employee_checkins' && state.operation === 'insert') return { data: { id: 'checkin-1', checkin_type: 'shift_start', status: 'pending' }, error: null };
      return { data: single ? null : [], error: null };
    }
    return query;
  } };
}

async function invokeEdge(body, actorRole = 'staff', deliveryAllowed = true) {
  let handler;
  const db = fakeDb(actorRole, deliveryAllowed);
  const runtime = stripTypeScriptTypes(edge, { mode: 'transform' })
    .replace(/^import \{ createClient \}[^;]+;\s*$/m, 'const createClient = globalThis.__createClient;')
    .replace(/^import \{ normalizeRole, hasCapability, isPrivilegedRole \}[^;]+;\s*$/m,
      `const normalizeRole=(r)=>String(r||'').toLowerCase();
       const hasCapability=(r,c)=>c==='finance.read'&&['gerant','manager','comptable'].includes(normalizeRole(r));
       const isPrivilegedRole=()=>false;`);
  const context = vm.createContext({
    __createClient: () => db,
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
  return { status: response.status, body: await response.json(), calls: db.calls };
}

await testAsync('A1-02 rôle non autorisé ne lit pas la paie individuelle', async () => {
  const result = await invokeEdge({ action: 'list_analytics' }, 'staff');
  return result.status === 403 && result.body.error === 'forbidden'
    && !result.calls.some((call) => call.table === 'veraluz_payroll');
});
await testAsync('A1-03R rôle autorisé conserve employés et paie minimale', async () => {
  const result = await invokeEdge({ action: 'list_analytics' }, 'gerant');
  return result.status === 200 && result.body.ok === true
    && result.body.employees.length === 1 && result.body.payroll.length === 1;
});
await testAsync('A1-08R employee_id étranger est rejeté avant lecture shift', async () => {
  const result = await invokeEdge({ action: 'get_my_delivery_shift_status', employee_id: 'other' }, 'staff');
  return result.status === 400 && result.body.error === 'invalid_delivery_shift_fields'
    && !result.calls.some((call) => call.table === 'veraluz_attendance');
});

const syntaxErrors = [];
for (const [name, html] of [['ANALYTICS', analytics], ['LIVREUR', livreur]]) {
  const valid = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
    try { new vm.Script(match[1], { filename: `${name}.html` }); return true; }
    catch (error) { syntaxErrors.push(error.stack || error.message); return false; }
  });
  test(`SYNTAX-${name}`, valid);
}
for (const error of syntaxErrors) console.log(`       ${error}`);

console.log(`\nRESULTAT RECOVERY LOT A.1: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
