import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260819_auth_r1_containment_employees.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const core = fs.readFileSync(path.join(root, 'VERALUZ_OS_CORE.html'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'AUTH_EMBEDDED.html'), 'utf8');

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

test('RLS reste active sur veraluz_employees',
  /ALTER TABLE public\.veraluz_employees ENABLE ROW LEVEL SECURITY/i.test(migration));
test('la policy rh_anon_all est supprimee de facon idempotente',
  /DROP POLICY IF EXISTS rh_anon_all ON public\.veraluz_employees/i.test(migration));
test('PUBLIC, anon et authenticated perdent tous les privileges sur la table interne',
  ['PUBLIC', 'anon', 'authenticated'].every((role) => new RegExp(
    `REVOKE ALL PRIVILEGES ON TABLE public\\.veraluz_employees FROM ${role}`,
    'i',
  ).test(migration)));
test('aucun GRANT client ne recree un acces a la table interne',
  !/GRANT\s+[\s\S]*?ON TABLE public\.veraluz_employees\s+TO\s+(?:PUBLIC|anon|authenticated)/i.test(migration));

const credentialFunctions = [
  'change_employee_pin_hash\\(text, text\\)',
  'check_employee_pin_hash\\(text, text\\)',
  'generate_temp_pin\\(\\)',
  'reset_employee_pin_hash\\(text, text, timestamptz, text\\)',
  'veraluz_reset_employee_pin\\(text, text, text\\)',
  'veraluz_set_employee_pin\\(text, text\\)',
  'veraluz_verify_employee_pin\\(text, text\\)',
];
test('les RPC credentials refusent tout EXECUTE client direct',
  credentialFunctions.every((signature) => new RegExp(
    `REVOKE ALL PRIVILEGES ON FUNCTION public\\.${signature}\\s+FROM PUBLIC, anon, authenticated`,
    'i',
  ).test(migration)));
test('les RPC credentials restent executables par service_role',
  credentialFunctions.every((signature) => new RegExp(
    `GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role`,
    'i',
  ).test(migration)));

const viewBody = migration.match(
  /CREATE VIEW public\.veraluz_employees_public[\s\S]*?\bAS\s+SELECT([\s\S]*?)FROM public\.veraluz_employees AS e/i,
)?.[1] ?? '';
const normalizedColumns = viewBody
  .split(',')
  .map((column) => column.replace(/\s+/g, '').toLowerCase())
  .filter(Boolean);

test('la vue publique est recreee avec une projection explicite', viewBody.length > 0);
test('la vue publique expose exactement id, full_name, role et status',
  JSON.stringify(normalizedColumns) === JSON.stringify(['e.id', 'e.full_name', 'e.role', 'e.status']));
test('aucune colonne sensible ne figure dans la projection publique',
  !/(pin|hash|secret|token|salary|salaire|phone|email|hire_date|contract|bank|momo)/i.test(viewBody));
test('la vue publique est en lecture seule pour anon/authenticated',
  /GRANT SELECT ON TABLE public\.veraluz_employees_public TO anon/i.test(migration)
    && /GRANT SELECT ON TABLE public\.veraluz_employees_public TO authenticated/i.test(migration)
    && !/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]*?veraluz_employees_public\s+TO\s+(?:anon|authenticated)/i.test(migration));
test('la migration contient des assertions post-application',
  /has_table_privilege\('anon', 'public\.veraluz_employees', 'SELECT'\)/i.test(migration)
    && /exposed_columns IS DISTINCT FROM ARRAY\['id', 'full_name', 'role', 'status'\]/i.test(migration)
    && /has_function_privilege\('anon', credential_function, 'EXECUTE'\)/i.test(migration));

const minimalSelect = 'veraluz_employees_public?select=id,full_name,role,status&order=full_name.asc';
test('le selecteur CORE utilise uniquement la vue publique minimale', core.includes(minimalSelect));
test('la liste Auth utilise uniquement la vue publique minimale', auth.includes(minimalSelect));

const loginLoader = core.match(
  /function getEmployeesFromSupabase\([\s\S]*?\n}\r?\n\r?\nvar currentUser/,
)?.[0] ?? '';
test('le chargeur de login ne lit jamais directement veraluz_employees',
  loginLoader.length > 0 && !/veraluz_employees(?!_public)/.test(loginLoader));
const loginProjection = loginLoader.match(
  /veraluz_employees_public\?select=([^&'"\s]+)/,
)?.[1] ?? '';
test('le chargeur de login ne demande aucun credential',
  loginProjection === 'id,full_name,role,status'
    && !/(pin_code|pin_hash|secret|token)/i.test(loginProjection));

const frontendFiles = fs.readdirSync(root)
  .filter((name) => /\.(?:html|js)$/i.test(name) && !/(backup|legacy)/i.test(name));
const directCallFiles = frontendFiles.filter((name) => {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  return /(?:\/rest\/v1\/|['"])veraluz_employees(?!_public)/.test(source);
});

console.log(`\n  INFO scan frontend: ${directCallFiles.length} fichier(s) tentent encore un acces direct`);
for (const name of directCallFiles) console.log(`       - ${name}`);
console.log('       Ces appels seront bloques par AUTH-R1 et exigent un endpoint serveur dans un lot ulterieur.');

console.log(`\nRESULTAT AUTH-R1: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
