import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

const livreur = read('LIVREUR.html');
const edge = read('supabase/functions/employees-secure/index.ts');
const migration = read('supabase/migrations/20260819_auth_r1c2_delivery_login_public.sql');

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

const viewProjection = migration.match(
  /CREATE VIEW public\.veraluz_delivery_login_public[\s\S]*?\bAS\s+SELECT([\s\S]*?)FROM public\.veraluz_employees AS e/i,
)?.[1] || '';
const deliveryActionStart = edge.indexOf("if (action === 'get_my_delivery_profile')");
const deliveryActionEnd = edge.indexOf("if (action === 'update_my_photo')", deliveryActionStart);
const deliveryAction = edge.slice(deliveryActionStart, deliveryActionEnd);
const deliveryHelperStart = edge.indexOf('async function getDeliveryEmployee');
const deliveryHelperEnd = edge.indexOf('async function authorizeTargetMutation', deliveryHelperStart);
const deliveryHelper = edge.slice(deliveryHelperStart, deliveryHelperEnd);

test('VIEW-01 projection publique limitée à id, full_name et status',
  /e\.id\s*,\s*e\.full_name\s*,\s*e\.status\s*$/s.test(viewProjection.trim())
    && !/(role|team_id|phone|email|salary|pin|hash|token)/i.test(viewProjection));
test('VIEW-02 éligibilité issue de la relation canonique employee.team_id → teams.id',
  /INNER JOIN public\.veraluz_teams AS t[\s\S]*?ON t\.id = e\.team_id/i.test(migration));
test('VIEW-03 seuls Livreurs et les statuts actif/active sont exposés',
  /lower\(btrim\(t\.name\)\) = 'livreurs'/i.test(migration)
    && /lower\(btrim\(e\.status\)\) IN \('actif', 'active'\)/i.test(migration));
test('VIEW-04 anon reçoit SELECT seulement; authenticated reste sans accès',
  /GRANT SELECT ON TABLE public\.veraluz_delivery_login_public TO anon/i.test(migration)
    && /REVOKE ALL PRIVILEGES ON TABLE public\.veraluz_delivery_login_public FROM authenticated/i.test(migration)
    && !/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]*?veraluz_delivery_login_public\s+TO\s+anon/i.test(migration));

test('FRONTEND-01 sélecteur dédié sans rôle ni filtre actif unique',
  /veraluz_delivery_login_public\?select=id,full_name,status&order=full_name\.asc/.test(livreur)
    && !/veraluz_delivery_login_public\?[^'"\s]*(?:role|status=eq\.actif)/.test(livreur));
test('FRONTEND-02 aucun rôle générique ne décide de l’accès Livreur',
  !/DELIVERY_LOGIN_ROLES|isLivreurLoginCandidate/.test(livreur)
    && /employeesSecure\('get_my_delivery_profile',\{\}\)/.test(livreur));
test('FRONTEND-03 refus serveur révoque la session et bloque l’application',
  /delivery_access_forbidden/.test(livreur)
    && /revokeLivreurSession\(tokenToRevoke,resumeToRevoke\)/.test(livreur)
    && /Accès livreur non autorisé/.test(livreur));
test('FRONTEND-04 aucun accès direct à veraluz_employees',
  !/(?:sbFetch|sbPatch)\(['"]veraluz_employees(?:\?|['"])/.test(livreur)
    && !/\/rest\/v1\/veraluz_employees(?:\?|['"])/.test(livreur));

test('SERVER-01 action limitée à actor.id et à un payload sans employee_id',
  deliveryActionStart >= 0
    && /validateFields\(body, GET_MY_DELIVERY_PROFILE_FIELDS\)/.test(deliveryAction)
    && /\.eq\('id', actor\.id\)/.test(deliveryHelper)
    && !/body\.employee_id/.test(deliveryAction + deliveryHelper));
test('SERVER-02 équipe relue côté serveur depuis employee.team_id',
  /\.from\('veraluz_teams'\)[\s\S]*?\.eq\('id', employee\.team_id\)/.test(deliveryHelper)
    && /isDeliveryTeamName\(team\.name\)/.test(deliveryHelper));
test('SERVER-03 réponse expose explicitement delivery_access true/false',
  /delivery_access: false/.test(deliveryAction)
    && /delivery_access: true/.test(deliveryAction));
test('SERVER-04 aucune projection Livreur ne retourne un credential',
  !/(pin_code|pin_hash|secret|token_hash|session_token|base_salary|bank_account|momo_number)/i.test(
    [...(deliveryAction + deliveryHelper).matchAll(/\.select\('([^']+)'\)/g)].map((match) => match[1]).join(','),
  ));

const syntaxErrors = [];
test('SYNTAX-01 scripts inline Livreur valides',
  [...livreur.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
    try { new vm.Script(match[1], { filename: 'LIVREUR.html' }); return true; }
    catch (error) { syntaxErrors.push(error.stack || error.message); return false; }
  }));
for (const error of syntaxErrors) console.log(`       ${error}`);

console.log(`\nRESULTAT AUTH-R1C2.1: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
