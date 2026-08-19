import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const livreur = fs.readFileSync(path.join(root, 'LIVREUR.html'), 'utf8').replace(/\r\n/g, '\n');

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

async function testAsync(name, assertion) {
  try {
    test(name, Boolean(await assertion()));
  } catch (error) {
    console.log(`       ${error.stack || error.message}`);
    test(name, false);
  }
}

function functionSource(name, nextMarker) {
  const start = livreur.indexOf(`function ${name}(`);
  const end = livreur.indexOf(nextMarker, start);
  return start >= 0 && end > start ? livreur.slice(start, end).trim() : '';
}

const validatePinSource = functionSource('validatePin', '/* ══════════════════════════════════════════\n   APP INIT');
const loadLivreursSource = functionSource('loadLivreurs', 'function buildPinPad');

function loginScenario(result, secureResponse, secureError) {
  const state = { initialized: 0, employeeSecureCalls: [], revoked: [] };
  const elements = {
    'pin-livreur-sel': { value: 'liv-1' },
    'pin-err': { textContent: '' },
    'pin-loading': { textContent: '' },
    'pin-pad': { style: { pointerEvents: '' } },
    'pin-screen': { classList: { add() {} } },
    'main-app': { style: { display: 'none' } },
  };
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] || null },
    LIVREURS: [{ id: 'liv-1', role: 'staff', full_name: 'Livreur Test' }],
    LIVREUR_ACTIF: null,
    LIVREUR_SESSION_TOKEN: '',
    LIVREUR_SESSION_EXPIRY: null,
    _pinBuffer: '123456',
    renderPinDots() {},
    verifyLivreurPin: () => Promise.resolve(result),
    employeesSecure: (action, payload) => {
      state.employeeSecureCalls.push({ action, payload });
      return secureError ? Promise.reject(new Error(secureError)) : Promise.resolve(secureResponse);
    },
    normalizeLivreurEmployee: (employee) => ({ ...employee, prenom: 'Livreur', nom: 'Test' }),
    clearLivreurSessionState() {
      context.LIVREUR_SESSION_TOKEN = '';
      context.LIVREUR_SESSION_EXPIRY = null;
    },
    revokeLivreurSession: (token) => { state.revoked.push(token); return Promise.resolve(); },
    initApp: () => { state.initialized += 1; },
    Error, Promise, String, Date,
  });
  new vm.Script(validatePinSource, { filename: 'LIVREUR.validatePin.js' }).runInContext(context);
  return { context, state, elements };
}

async function settleLogin(scenario) {
  scenario.context.validatePin();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return scenario;
}

test('SELECTOR-01 vue publique avec projection minimale exacte',
  /veraluz_delivery_login_public\?select=id,full_name,status&order=full_name\.asc/.test(livreur));
test('SELECTOR-02 aucun fallback ou accès direct à veraluz_employees',
  !/(?:sbFetch|sbPatch)\(['"]veraluz_employees(?:\?|['"])/.test(livreur)
    && !/\/rest\/v1\/veraluz_employees(?:\?|['"])/.test(livreur));
test('SELECTOR-03 aucune autorisation Livreur décidée par un rôle frontend',
  !/DELIVERY_LOGIN_ROLES|isLivreurLoginCandidate|rows\.filter\(/.test(loadLivreursSource));

test('SESSION-01 token canonique séparé de LIVREUR_ACTIF',
  /var LIVREUR_SESSION_TOKEN='', LIVREUR_SESSION_EXPIRY=null/.test(livreur)
    && !/LIVREUR_ACTIF\s*=\s*Object\.assign\([^)]*session_token/s.test(livreur));
test('SESSION-02 employees-secure reçoit X-Veraluz-Session',
  /'X-Veraluz-Session':LIVREUR_SESSION_TOKEN/.test(livreur));
test('SESSION-03 aucune restauration d’autorité depuis localStorage',
  !/function saveSession\(|function checkSession\(/.test(livreur)
    && !/localStorage\.(?:setItem|getItem)\([^)]*(?:LS_LEGACY_SESSION|session_token)/.test(livreur)
    && /localStorage\.removeItem\(LS_LEGACY_SESSION\)/.test(livreur));

await testAsync('LOGIN-01 PIN faux refuse l’ouverture et ne crée aucune session locale', async () => {
  const scenario = await settleLogin(loginScenario({ ok: false, error: 'invalid_credentials' }, null));
  return scenario.context.LIVREUR_ACTIF === null
    && scenario.context.LIVREUR_SESSION_TOKEN === ''
    && scenario.state.initialized === 0
    && /incorrect/i.test(scenario.elements['pin-err'].textContent);
});
await testAsync('LOGIN-02 PIN correct utilise la vraie session et le profil serveur', async () => {
  const token = 'a'.repeat(64);
  const scenario = await settleLogin(loginScenario(
    { ok: true, auth_state: 'ok', session_token: token, session_expiry: '2099-01-01T00:00:00Z', employee: { id: 'liv-1' } },
    { ok: true, delivery_access: true, profile: { id: 'liv-1', full_name: 'Livreur Test', role: 'staff' } },
  ));
  return scenario.context.LIVREUR_SESSION_TOKEN === token
    && scenario.context.LIVREUR_ACTIF?.id === 'liv-1'
    && !Object.prototype.hasOwnProperty.call(scenario.context.LIVREUR_ACTIF, 'session_token')
    && scenario.state.employeeSecureCalls.length === 1
    && scenario.state.employeeSecureCalls[0].action === 'get_my_delivery_profile'
    && scenario.state.initialized === 1;
});
await testAsync('LOGIN-03 must_change_pin bloque totalement l’application', async () => {
  const scenario = await settleLogin(loginScenario({
    ok: true, auth_state: 'must_change_pin', must_change_pin: true,
    change_token: 'temporary-change-token', employee: { id: 'liv-1', role: 'staff' },
  }, null));
  return scenario.context.LIVREUR_ACTIF === null
    && scenario.context.LIVREUR_SESSION_TOKEN === ''
    && scenario.state.employeeSecureCalls.length === 0
    && scenario.state.initialized === 0
    && scenario.elements['pin-err'].textContent === 'Vous devez modifier votre PIN avant de continuer.';
});

await testAsync('LOGIN-04 session non éligible révoquée sans ouvrir Livreur', async () => {
  const token = 'b'.repeat(64);
  const scenario = await settleLogin(loginScenario(
    { ok: true, auth_state: 'ok', session_token: token, session_expiry: '2099-01-01T00:00:00Z', employee: { id: 'liv-1' } },
    null,
    'delivery_access_forbidden',
  ));
  return scenario.context.LIVREUR_ACTIF === null
    && scenario.context.LIVREUR_SESSION_TOKEN === ''
    && scenario.state.revoked.length === 1
    && scenario.state.revoked[0] === token
    && scenario.state.initialized === 0
    && scenario.elements['pin-err'].textContent === 'Accès livreur non autorisé';
});

const photoSource = functionSource('onProfilPhotoSelected', '/* ══════════════════════════════════════════\n   LOGOUT');
test('PHOTO-01 mise à jour via employees-secure sans employee_id client',
  /employeesSecure\('update_my_photo',\{photo_url:url\}\)/.test(photoSource)
    && !/employee_id|sbPatch\(/.test(photoSource));

const logoutSource = functionSource('logout', '/* ══════════════════════════════════════════════════════════════');
test('LOGOUT-01 logout révoque la session serveur puis nettoie l’état local',
  /tokenToRevoke=LIVREUR_SESSION_TOKEN/.test(logoutSource)
    && /clearLivreurSessionState\(\)/.test(logoutSource)
    && /revokeLivreurSession\(tokenToRevoke\)/.test(logoutSource)
    && /LIVREUR_ACTIF=null/.test(logoutSource));

test('SECURITY-01 aucun token/PIN/credential persisté dans LIVREUR_ACTIF ou Storage web',
  !/(localStorage|sessionStorage)\.setItem\([^)]*(?:pin|token|credential)/i.test(livreur)
    && !/LIVREUR_ACTIF\.(?:pin_code|pin_hash|session_token)\b/.test(livreur)
    && !/LIVREUR_ACTIF\s*=\s*Object\.assign\([^)]*(?:pin_code|pin_hash|session_token)/s.test(livreur));

const syntaxErrors = [];
test('SYNTAX-01 tous les scripts inline Livreur restent valides',
  [...livreur.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
    try { new vm.Script(match[1], { filename: 'LIVREUR.html' }); return true; }
    catch (error) { syntaxErrors.push(error.stack || error.message); return false; }
  }));
for (const error of syntaxErrors) console.log(`       ${error}`);

console.log(`\nRESULTAT AUTH-R1C2: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
