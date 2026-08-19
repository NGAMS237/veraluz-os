import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const edge = read('supabase/functions/employees-secure/index.ts');
const migration = read('supabase/migrations/20260819_auth_r1_containment_employees.sql');
const core = read('VERALUZ_OS_CORE.html');
const rh = read('RH_EMBEDDED.html');

const adaptedFiles = [
  'ANALYTICS_EMBEDDED.html',
  'CONTACTS_EMBEDDED.html',
  'RESTAURANT_EMBEDDED.html',
  'RH_EMBEDDED.html',
  'VERALUZ_OS_CORE.html',
];

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) {
    console.log(`  PASS ${name}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${name}`);
    failed += 1;
  }
}

function actionBlock(action, nextAction) {
  const start = edge.indexOf(`if (action === '${action}')`);
  if (start < 0) return '';
  const end = nextAction ? edge.indexOf(`if (action === '${nextAction}')`, start + 1) : edge.length;
  return edge.slice(start, end < 0 ? edge.length : end);
}

function makeFakeDb(scenario, calls) {
  const actor = { id: 'actor-1', role: 'rh', status: 'actif', ...(scenario.actor || {}) };
  const target = { id: 'target-1', role: 'staff', status: 'actif', ...(scenario.target || {}) };
  const deliveryEmployee = {
    id: actor.id, full_name: 'Livreur Test', role: actor.role, status: actor.status,
    team_id: scenario.teamId === undefined ? 'team-delivery' : scenario.teamId,
    phone: null, photo_url: null, public_display_name: null, identity_verified: false,
  };
  const deliveryTeam = scenario.teamMissing
    ? null
    : { id: deliveryEmployee.team_id, name: scenario.teamName || 'Livreurs' };

  return {
    from(table) {
      const state = { table, operation: 'select', projection: '', filters: {}, payload: null };
      const query = {
        select(projection) { state.projection = projection; return query; },
        eq(column, value) { state.filters[column] = value; return query; },
        is() { return query; },
        gt() { return query; },
        in() { return query; },
        order() { return query; },
        insert(payload) { state.operation = 'insert'; state.payload = payload; return query; },
        update(payload) { state.operation = 'update'; state.payload = payload; return query; },
        maybeSingle() { return Promise.resolve(resolveQuery()); },
        single() { return Promise.resolve(resolveQuery()); },
        then(onFulfilled, onRejected) {
          return Promise.resolve(resolveQuery()).then(onFulfilled, onRejected);
        },
      };

      function resolveQuery() {
        calls.push({ ...state, filters: { ...state.filters } });
        if (table === 'veraluz_employee_sessions') {
          return { data: scenario.sessionValid === false ? null : { employee_id: actor.id }, error: null };
        }
        if (table === 'veraluz_employees') {
          if (state.operation === 'insert') {
            return { data: { id: 'created-1', ...state.payload }, error: null };
          }
          if (state.operation === 'update') {
            return { data: { id: state.filters.id || target.id, ...state.payload }, error: null };
          }
          if (state.projection === 'id,role,status') return { data: actor, error: null };
          if (state.projection === 'id,full_name,role,status,team_id,phone,photo_url,public_display_name,identity_verified') {
            return { data: deliveryEmployee, error: null };
          }
          if (state.projection === 'id,role') {
            return state.filters.id === target.id
              ? { data: target, error: null }
              : { data: null, error: null };
          }
        }
        if (table === 'veraluz_teams' && state.projection === 'id,name') {
          return { data: deliveryTeam, error: null };
        }
        return { data: [], error: null };
      }

      return query;
    },
  };
}

async function invokeEdge(body, scenario = {}) {
  const calls = [];
  let handler = null;
  const runtimeSource = stripTypeScriptTypes(edge, { mode: 'transform' })
    .replace(/^import[^;]+;\s*$/m, 'const createClient = globalThis.__createClient;');
  const context = vm.createContext({
    __createClient: () => makeFakeDb(scenario, calls),
    Deno: {
      env: { get: (name) => name === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'server-secret' },
      serve: (fn) => { handler = fn; },
    },
    Request, Response, TextEncoder, URL, crypto,
    console: { error() {}, warn() {}, log() {} },
  });
  new vm.Script(runtimeSource, { filename: 'employees-secure/index.ts' }).runInContext(context);
  const request = new Request('https://example.supabase.co/functions/v1/employees-secure', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://ngams237.github.io',
      'x-veraluz-session': 'temporary-test-session-token',
    },
    body: JSON.stringify(body),
  });
  const response = await handler(request);
  return { status: response.status, body: await response.json(), calls };
}

async function testAsync(name, assertion) {
  try {
    test(name, Boolean(await assertion()));
  } catch (error) {
    console.log(`       ${error.stack || error.message}`);
    test(name, false);
  }
}

test('EDGE-01 employees-secure utilise le service_role uniquement depuis l’environnement',
  /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/.test(edge)
    && !/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+/.test(edge));
test('EDGE-02 le TypeScript de la fonction est syntaxiquement valide', () => {
  try {
    const js = stripTypeScriptTypes(edge, { mode: 'transform' })
      .replace(/^import[^;]+;\s*$/m, '');
    new vm.Script(js, { filename: 'employees-secure/index.ts' });
    return true;
  } catch { return false; }
});

test('AUTH-01 la session est lue exclusivement depuis X-Veraluz-Session',
  /req\.headers\.get\('x-veraluz-session'\)/.test(edge)
    && !/body\.session_token/.test(edge));
test('AUTH-02 une requête sans session reçoit 401',
  /if \(!sessionToken\) return json\(\{ ok: false, error: 'session_required' \}, 401/.test(edge));
test('AUTH-03 une session invalide ou expirée reçoit 401',
  /invalid_or_expired_session' \}, 401/.test(edge)
    && /\.is\('revoked_at', null\)/.test(edge)
    && /\.gt\('expires_at', new Date\(\)\.toISOString\(\)\)/.test(edge));
test('AUTH-04 rôle et statut du demandeur sont relus côté serveur',
  /\.from\('veraluz_employees'\)[\s\S]*?\.select\('id,role,status'\)/.test(edge)
    && /roleClass: roleClass\(employee\.role\)/.test(edge));

const profile = actionBlock('get_my_profile', 'get_my_delivery_profile');
test('PROFILE-01 get_my_profile utilise uniquement actor.id',
  /\.eq\('id', actor\.id\)/.test(profile) && !/body\.employee_id/.test(profile));
test('PROFILE-02 projection profil minimale',
  /\.select\('id,full_name,role,phone,email,hire_date,team_id,photo_url,public_display_name,identity_verified'\)/.test(profile));

const deliveryProfile = actionBlock('get_my_delivery_profile', 'update_my_photo');
test('DELIVERY-01 éligibilité calculée uniquement depuis actor.id et la DB',
  /\.eq\('id', actor\.id\)/.test(deliveryProfile)
    && /\.from\('veraluz_teams'\)/.test(deliveryProfile)
    && /\.eq\('id', employee\.team_id\)/.test(deliveryProfile)
    && !/body\.employee_id/.test(deliveryProfile));
test('DELIVERY-02 le rôle générique ne décide jamais de l’accès Livreur',
  /isDeliveryTeamName\(team\.name\)/.test(deliveryProfile)
    && !/(actor|employee)\.role\s*===|DELIVERY_LOGIN_ROLES/.test(deliveryProfile));

await testAsync('DELIVERY-03 staff + équipe Livreurs autorisé', async () => {
  const result = await invokeEdge(
    { action: 'get_my_delivery_profile' },
    { actor: { role: 'staff', status: 'actif' }, teamName: 'Livreurs' },
  );
  return result.status === 200 && result.body.delivery_access === true
    && result.body.profile?.id === 'actor-1';
});
await testAsync('DELIVERY-04 technicien + équipe Livreurs autorisé', async () => {
  const result = await invokeEdge(
    { action: 'get_my_delivery_profile' },
    { actor: { role: 'technicien', status: 'active' }, teamName: 'Livreurs' },
  );
  return result.status === 200 && result.body.delivery_access === true;
});
await testAsync('DELIVERY-05 technicien + Maintenance refusé', async () => {
  const result = await invokeEdge(
    { action: 'get_my_delivery_profile' },
    { actor: { role: 'technicien', status: 'actif' }, teamName: 'Maintenance' },
  );
  return result.status === 403 && result.body.delivery_access === false
    && result.body.error === 'delivery_access_forbidden';
});
await testAsync('DELIVERY-06 staff hors Livreurs refusé', async () => {
  const result = await invokeEdge(
    { action: 'get_my_delivery_profile' },
    { actor: { role: 'staff', status: 'actif' }, teamName: 'Réception' },
  );
  return result.status === 403 && result.body.delivery_access === false;
});
await testAsync('DELIVERY-07 employé inactif de l’équipe Livreurs refusé', async () => {
  const result = await invokeEdge(
    { action: 'get_my_delivery_profile' },
    { actor: { role: 'staff', status: 'inactif' }, teamName: 'Livreurs' },
  );
  return result.status === 401 && result.body.error === 'invalid_or_expired_session';
});
await testAsync('DELIVERY-08 le client ne peut pas choisir employee_id', async () => {
  const result = await invokeEdge({ action: 'get_my_delivery_profile', employee_id: 'target-1' });
  return result.status === 400 && result.body.error === 'invalid_delivery_profile_fields'
    && !result.calls.some((call) => call.table === 'veraluz_teams');
});

const updatePhoto = actionBlock('update_my_photo', 'list_directory');
test('PHOTO-01 update_my_photo utilise actor.id et une allowlist de payload',
  /validateFields\(body, UPDATE_MY_PHOTO_FIELDS\)/.test(updatePhoto)
    && /\.eq\('id', actor\.id\)/.test(updatePhoto)
    && !/body\.employee_id/.test(updatePhoto));
await testAsync('PHOTO-02 update_my_photo écrit uniquement la photo de l’acteur', async () => {
  const photoUrl = 'https://example.supabase.co/storage/v1/object/public/employee-photos/test.jpg';
  const result = await invokeEdge({ action: 'update_my_photo', photo_url: photoUrl }, { actor: { id: 'actor-1', role: 'staff' } });
  const write = result.calls.find((call) => call.operation === 'update');
  return result.status === 200 && write && write.filters.id === 'actor-1'
    && JSON.stringify(write.payload) === JSON.stringify({ photo_url: photoUrl });
});
await testAsync('PHOTO-03 le client ne peut pas choisir employee_id', async () => {
  const result = await invokeEdge({
    action: 'update_my_photo', employee_id: 'target-1',
    photo_url: 'https://example.supabase.co/storage/v1/object/public/employee-photos/test.jpg',
  });
  return result.status === 400 && result.body.error === 'invalid_photo_fields'
    && !result.calls.some((call) => call.operation === 'update');
});
await testAsync('PHOTO-04 une URL hors du bucket/projet autorisé est refusée', async () => {
  const result = await invokeEdge({ action: 'update_my_photo', photo_url: 'https://attacker.example/photo.jpg' });
  return result.status === 400 && result.body.error === 'invalid_photo_url'
    && !result.calls.some((call) => call.operation === 'update');
});

const directory = actionBlock('list_directory', 'list_operational_roster');
test('DIRECTORY-01 projection Contacts limitée',
  /\.select\('id,full_name,role,email,phone,status'\)/.test(directory)
    && !/(salary|contract|notes|bank|momo|pin|hash|token)/i.test(directory.replace('DIRECTORY_ROLE_CLASSES', '')));
test('DIRECTORY-02 permission serveur obligatoire',
  /requireRole\(actor, DIRECTORY_ROLE_CLASSES\)/.test(directory));

const roster = actionBlock('list_operational_roster', 'list_analytics');
test('ROSTER-01 roster limité aux données opérationnelles',
  /id,full_name,role,status,photo_url,public_display_name,public_role_label,identity_verified,team:veraluz_teams\(id,name\)/.test(roster)
    && !/(salary|contract|notes|bank|momo|pin|hash|token)/i.test(roster.replace('OPERATIONAL_ROLE_CLASSES', '')));
test('ROSTER-02 permission serveur obligatoire',
  /requireRole\(actor, OPERATIONAL_ROLE_CLASSES\)/.test(roster));

const analytics = actionBlock('list_analytics', 'rh_list');
test('ANALYTICS-01 projection KPI minimale',
  /\.select\('id,full_name,role,status,base_salary,contract_type'\)/.test(analytics));
test('ANALYTICS-02 accès réservé strictement Direction ou Finance',
  /requireRole\(actor, ANALYTICS_ROLE_CLASSES\)/.test(analytics)
    && /const ANALYTICS_ROLE_CLASSES = new Set\(\['superadmin', 'accountant'\]\)/.test(edge));

const expectedActions = [
  'get_my_profile', 'get_my_delivery_profile', 'update_my_photo',
  'list_directory', 'list_operational_roster', 'list_analytics',
  'rh_list', 'rh_create', 'rh_update', 'rh_set_status', 'rh_update_compensation',
];
const actualActions = [...edge.matchAll(/if \(action === '([^']+)'\)/g)].map((match) => match[1]);
test('RH-01 seules les actions fixes attendues existent',
  JSON.stringify(actualActions) === JSON.stringify(expectedActions));
test('RH-02 chaque action RH vérifie une permission serveur',
  ['rh_list', 'rh_create', 'rh_update', 'rh_set_status', 'rh_update_compensation']
    .every((action, index, actions) => {
      const block = actionBlock(action, actions[index + 1]);
      return /requireRole\(actor, RH_ROLE_CLASSES\)/.test(block);
    }));
test('RH-02B les écritures RH refusent les rôles non autorisés',
  /const RH_ROLE_CLASSES = new Set\(\['superadmin', 'manager', 'rh'\]\)/.test(edge)
    && !/const RH_ROLE_CLASSES = new Set\([^\n]*(?:staff|reception|accountant)/.test(edge));
test('RH-03 aucune écriture arbitraire de colonnes',
  /validateFields\(input, RH_CREATE_FIELDS\)/.test(edge)
    && /validateFields\(input, RH_UPDATE_FIELDS\)/.test(edge)
    && !/\.update\(body\.|\.insert\(body\./.test(edge));
test('RH-04 création sans credential legacy',
  /pin_code: null/.test(actionBlock('rh_create', 'rh_update'))
    && /must_change_pin: false/.test(actionBlock('rh_create', 'rh_update'))
    && /access_provisioned: false/.test(actionBlock('rh_create', 'rh_update'))
    && /ALTER COLUMN pin_code DROP DEFAULT/i.test(migration));
const rhLogin = rh.match(/function doLogin\(\)[\s\S]*?function logoutEmp/)?.[0] || '';
test('RH-05 aucun PIN local ni fallback local dans le workflow employé RH',
  !/id="emp-pin"|emp\.pin_code|d\.pin_code/.test(rh)
    && rhLogin.length > 0
    && !/pin_code|default_pin/.test(rhLogin));
test('RH-06 les rôles acceptés viennent d’une liste fermée connue',
  /const KNOWN_EMPLOYEE_ROLES = new Set/.test(edge)
    && /return KNOWN_EMPLOYEE_ROLES\.has\(normalized\) \? normalized : null/.test(edge)
    && !/\^\[a-z\].*a-z0-9_/.test(edge));
test('RH-07 chaque mutation de cible vérifie que son rôle DB n’a pas changé',
  ['rh_update', 'rh_set_status', 'rh_update_compensation']
    .every((action, index, actions) => {
      const block = actionBlock(action, actions[index + 1]);
      return /\.eq\('role', targetAccess\.target\.role\)/.test(block);
    }));

await testAsync('PRIV-01 RH peut créer un rôle housekeeping connu', async () => {
  const result = await invokeEdge(
    { action: 'rh_create', employee: { full_name: 'Test Housekeeping', role: 'femme_chambre' } },
    { actor: { role: 'rh' } },
  );
  return result.status === 201 && result.calls.some((call) => call.operation === 'insert');
});
await testAsync('PRIV-02 manager peut créer un rôle opérationnel connu', async () => {
  const result = await invokeEdge(
    { action: 'rh_create', employee: { full_name: 'Test Restaurant', role: 'barman' } },
    { actor: { role: 'manager' } },
  );
  return result.status === 201 && result.calls.some((call) => call.operation === 'insert');
});
await testAsync('PRIV-03 RH ne peut pas créer superadmin', async () => {
  const result = await invokeEdge(
    { action: 'rh_create', employee: { full_name: 'Test Admin', role: 'superadmin' } },
    { actor: { role: 'rh' } },
  );
  return result.status === 403 && result.body.error === 'privileged_role_forbidden'
    && !result.calls.some((call) => call.operation === 'insert');
});
await testAsync('PRIV-04 manager ne peut pas créer gerant', async () => {
  const result = await invokeEdge(
    { action: 'rh_create', employee: { full_name: 'Test Gérant', role: 'gerant' } },
    { actor: { role: 'manager' } },
  );
  return result.status === 403 && result.body.error === 'privileged_role_forbidden'
    && !result.calls.some((call) => call.operation === 'insert');
});
await testAsync('PRIV-05 RH ne peut pas promouvoir un employé vers admin', async () => {
  const result = await invokeEdge(
    { action: 'rh_update', employee_id: 'target-1', employee: { role: 'admin' } },
    { actor: { role: 'rh' }, target: { role: 'staff' } },
  );
  return result.status === 403 && result.body.error === 'privileged_role_forbidden'
    && !result.calls.some((call) => call.operation === 'update');
});
await testAsync('PRIV-06 manager ne peut pas promouvoir vers direction', async () => {
  const result = await invokeEdge(
    { action: 'rh_update', employee_id: 'target-1', employee: { role: 'direction' } },
    { actor: { role: 'manager' }, target: { role: 'staff' } },
  );
  return result.status === 403 && result.body.error === 'privileged_role_forbidden'
    && !result.calls.some((call) => call.operation === 'update');
});
await testAsync('PRIV-07 RH/manager ne peuvent pas modifier un compte privilégié', async () => {
  const results = await Promise.all([
    invokeEdge(
      { action: 'rh_update', employee_id: 'target-1', employee: { phone: '+237600000000' } },
      { actor: { role: 'rh' }, target: { role: 'gerant' } },
    ),
    invokeEdge(
      { action: 'rh_update', employee_id: 'target-1', employee: { notes: 'test' } },
      { actor: { role: 'manager' }, target: { role: 'admin' } },
    ),
  ]);
  return results.every((result) => result.status === 403
    && result.body.error === 'privileged_target_forbidden'
    && !result.calls.some((call) => call.operation === 'update'));
});
await testAsync('PRIV-08 RH/manager ne peuvent pas changer le statut d’un compte privilégié', async () => {
  const results = await Promise.all([
    invokeEdge(
      { action: 'rh_set_status', employee_id: 'target-1', status: 'inactif' },
      { actor: { role: 'rh' }, target: { role: 'superadmin' } },
    ),
    invokeEdge(
      { action: 'rh_set_status', employee_id: 'target-1', status: 'actif' },
      { actor: { role: 'manager' }, target: { role: 'direction' } },
    ),
  ]);
  return results.every((result) => result.status === 403
    && result.body.error === 'privileged_target_forbidden'
    && !result.calls.some((call) => call.operation === 'update'));
});
await testAsync('PRIV-09 RH/manager ne peuvent pas modifier la compensation d’un compte privilégié', async () => {
  const results = await Promise.all([
    invokeEdge(
      { action: 'rh_update_compensation', employee_id: 'target-1', base_salary: 100000 },
      { actor: { role: 'rh' }, target: { role: 'owner' } },
    ),
    invokeEdge(
      { action: 'rh_update_compensation', employee_id: 'target-1', base_salary: 100000 },
      { actor: { role: 'manager' }, target: { role: 'directrice' } },
    ),
  ]);
  return results.every((result) => result.status === 403
    && result.body.error === 'privileged_target_forbidden'
    && !result.calls.some((call) => call.operation === 'update'));
});
await testAsync('PRIV-10 un acteur privilégié conserve les opérations RH prévues', async () => {
  const results = await Promise.all([
    invokeEdge(
      { action: 'rh_create', employee: { full_name: 'Test Direction', role: 'admin' } },
      { actor: { role: 'gerant' } },
    ),
    invokeEdge(
      { action: 'rh_update', employee_id: 'target-1', employee: { role: 'direction' } },
      { actor: { role: 'gerant' }, target: { role: 'admin' } },
    ),
    invokeEdge(
      { action: 'rh_set_status', employee_id: 'target-1', status: 'inactif' },
      { actor: { role: 'gerant' }, target: { role: 'superadmin' } },
    ),
    invokeEdge(
      { action: 'rh_update_compensation', employee_id: 'target-1', base_salary: 100000 },
      { actor: { role: 'gerant' }, target: { role: 'owner' } },
    ),
  ]);
  return results.every((result) => result.status >= 200 && result.status < 300
    && result.calls.some((call) => call.operation === 'insert' || call.operation === 'update'));
});
await testAsync('PRIV-11 le rôle déclaré par le payload n’accorde aucun droit', async () => {
  const result = await invokeEdge(
    {
      action: 'rh_create', caller_role: 'superadmin', requested_by_role: 'gerant',
      employee: { full_name: 'Test Payload', role: 'staff' },
    },
    { actor: { role: 'staff' } },
  );
  return result.status === 403 && result.body.error === 'forbidden'
    && !result.calls.some((call) => call.operation === 'insert');
});

const projectionSource = [
  edge.match(/const RH_LIST_PROJECTION = \[([\s\S]*?)\]\.join/)?.[1] || '',
  ...[...edge.matchAll(/\.select\('([^']+)'\)/g)].map((match) => match[1]),
].join(',');
test('SECURITY-01 aucune projection ne retourne PIN, hash, secret ou token',
  !/(pin_code|pin_hash|secret|token_hash|session_token)/i.test(projectionSource));

const directAccess = /(?:\/rest\/v1\/|['"])veraluz_employees(?!_public)/;
test('FRONTEND-01 les cinq fichiers adaptés n’accèdent plus directement à la table',
  adaptedFiles.every((name) => !directAccess.test(read(name))));
test('FRONTEND-02 les cinq fichiers passent par employees-secure',
  adaptedFiles.every((name) => /employees-secure/.test(read(name))));
const syntaxErrors = [];
test('FRONTEND-03 les scripts inline des cinq fichiers restent syntaxiquement valides',
  adaptedFiles.every((name) => {
    const scripts = [...read(name).matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1]).join('\n');
    try { new vm.Script(scripts, { filename: name }); return true; }
    catch (error) { syntaxErrors.push(`${name}: ${error.stack || error.message}`); return false; }
  }));
for (const error of syntaxErrors) console.log(`       ${error}`);
test('FRONTEND-04 le sélecteur login public minimal reste intact',
  /veraluz_employees_public\?select=id,full_name,role,status&order=full_name\.asc/.test(core));
test('BROKER-01 employees-secure est dans l’allowlist sans retirer les endpoints Auth',
  /'employees-secure'/.test(core)
    && ['reset-employee-pin', 'revoke-employee-sessions', 'get-employee-access-status']
      .every((endpoint) => core.includes(`'${endpoint}'`)));

const livreur = read('LIVREUR.html');
test('LIVREUR-01 R1C2 retire les accès directs et utilise employees-secure',
  !directAccess.test(livreur) && /employees-secure/.test(livreur));

console.log(`\nRESULTAT AUTH-R1C1: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
