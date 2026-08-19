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

const profile = actionBlock('get_my_profile', 'list_directory');
test('PROFILE-01 get_my_profile utilise uniquement actor.id',
  /\.eq\('id', actor\.id\)/.test(profile) && !/body\.employee_id/.test(profile));
test('PROFILE-02 projection profil minimale',
  /\.select\('id,full_name,phone,email,hire_date,team_id'\)/.test(profile));

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
  'get_my_profile', 'list_directory', 'list_operational_roster', 'list_analytics',
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
test('LIVREUR-01 LIVREUR reste explicitement hors R1C1 et conserve ses appels pour R1C2',
  directAccess.test(livreur) && !/employees-secure/.test(livreur));

console.log(`\nRESULTAT AUTH-R1C1: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
