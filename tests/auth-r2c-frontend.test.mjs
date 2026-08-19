import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const core = read('VERALUZ_OS_CORE.html');
const livreur = read('LIVREUR.html');

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) { console.log(`  PASS ${name}`); passed += 1; }
  else { console.log(`  FAIL ${name}`); failed += 1; }
}

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  return '';
}

const coreCheck = fnSource(core, 'checkAuth');
const coreResume = fnSource(core, 'resumeCoreSession');
const coreLogin = fnSource(core, 'stabilizeCoreEmployeeLogin');
const coreIdentity = fnSource(core, 'coreSessionFromServer');
const coreLogout = fnSource(core, 'logoutCoreSessionBestEffort');
const coreLogoutUi = fnSource(core, 'logout');
const livreurResume = fnSource(livreur, 'resumeLivreurSession');
const livreurLogin = fnSource(livreur, 'validatePin');
const livreurLogout = fnSource(livreur, 'logout');

test('CORE-01 endpoints du contrat AUTH-R2B sont utilisés',
  /issue-resume-token/.test(core) && /resume-employee-session/.test(core) && /logout-employee-session/.test(core));
test('CORE-02 login attend issue-resume-token avant ouverture',
  /return issueCoreResumeToken\(sessionToken\)\.then/.test(coreLogin)
    && coreLogin.indexOf('issueCoreResumeToken') < coreLogin.indexOf('enterCoreEmployeeSession'));
test('CORE-03 F5 reprend avec le resume même si le cache expires est périmé',
  /getItem\(CORE_RESUME_KEY\)/.test(coreCheck)
    && /resumeCoreSession\(resumeToken\)/.test(coreCheck)
    && coreCheck.indexOf('resumeCoreSession') < coreCheck.indexOf("getItem('veraluz_auth_v1')"));
test('CORE-04 reprise 9s, rotation et anti-concurrence',
  /if \(_resumePromise\) return _resumePromise/.test(coreResume)
    && /authEdgePost\(EDGE_RESUME_SESSION_URL, \{ resume_token: resumeToken \}, 9000\)/.test(coreResume)
    && /setItem\(CORE_RESUME_KEY, data\.resume_token\)/.test(coreResume));
test('CORE-05 identité et rôle reconstruits depuis la réponse serveur',
  /data\.employee_id/.test(coreIdentity) && /data\.role/.test(coreIdentity)
    && /data\.full_name/.test(coreIdentity) && /enterCoreEmployeeSession\(data, data\.session_token\)/.test(coreResume));
test('CORE-06 invalidation serveur retire le resume, erreur réseau ne crée aucune autorité locale',
  /error\.status === 401 \|\| error\.status === 403/.test(coreResume)
    && /clearCoreLocalSession\(invalidCredential\)/.test(coreResume));
test('CORE-07 logout envoie les deux jetons sans employee_id et nettoie toujours localement',
  /session_token: sessionToken \|\| null, resume_token: resumeToken \|\| null/.test(coreLogout)
    && !/employee_id/.test(coreLogout)
    && /clearCoreLocalSession\(true\)/.test(coreLogoutUi));
test('CORE-08 session_token n’est jamais écrit dans localStorage/sessionStorage',
  !/(?:localStorage|sessionStorage)\.setItem\([^\n;]*(?:session_token|_sessionToken)/i.test(core));

test('LIVREUR-01 clé resume séparée et écran PIN masqué au boot',
  /LS_RESUME_LIVREUR = 'vz_resume_livreur'/.test(livreur)
    && /id="pin-login-card" style="display:none"/.test(livreur)
    && /id="livreur-reconnect"/.test(livreur));
test('LIVREUR-02 login attend émission resume avant ouverture',
  livreurLogin.indexOf('issueLivreurResumeToken(sessionToken)') >= 0
    && livreurLogin.indexOf('issueLivreurResumeToken(sessionToken)') < livreurLogin.indexOf('openLivreurApp(profile)'));
test('LIVREUR-03 reprise 9s, rotation et anti-concurrence',
  /if\(_livreurResumePromise\)return _livreurResumePromise/.test(livreurResume)
    && /livreurAuthPost\(EDGE_RESUME_SESSION_URL,\{resume_token:resumeToken\},9000\)/.test(livreurResume)
    && /setItem\(LS_RESUME_LIVREUR,data\.resume_token\)/.test(livreurResume));
test('LIVREUR-04 profil serveur obligatoire avant ouverture',
  /employeesSecure\('get_my_delivery_profile',\{\}\)/.test(livreurResume)
    && /delivery_access!==true/.test(livreurResume)
    && /openLivreurApp\(profileData\.profile\)/.test(livreurResume));
test('LIVREUR-05 hors équipe révoque et nettoie la session rotatée',
  /delivery_access_forbidden/.test(livreurResume)
    && /revokeLivreurSession\(sessionToRevoke,resumeToRevoke\)/.test(livreurResume)
    && /clearLivreurSessionState\(invalid\|\|!!sessionToRevoke\)/.test(livreurResume));
test('LIVREUR-06 logout envoie session + resume et nettoie localement',
  /resumeToRevoke=localStorage\.getItem\(LS_RESUME_LIVREUR\)/.test(livreurLogout)
    && /clearLivreurSessionState\(true\)/.test(livreurLogout)
    && /revokeLivreurSession\(tokenToRevoke,resumeToRevoke\)/.test(livreurLogout));
test('LIVREUR-07 session_token reste en mémoire, seul resume opaque est persisté',
  /LIVREUR_SESSION_TOKEN=String\(data\.session_token\)/.test(livreurResume)
    && !/(?:localStorage|sessionStorage)\.setItem\([^\n;]*(?:session_token|LIVREUR_SESSION_TOKEN)/i.test(livreur));
test('SECURITY-01 resume/logout n’envoient jamais employee_id comme autorité',
  !/employee_id/.test(coreResume) && !/employee_id/.test(coreLogout)
    && !/employee_id/.test(fnSource(livreur, 'livreurAuthPost'))
    && !/employee_id/.test(fnSource(livreur, 'revokeLivreurSession')));

const syntaxErrors = [];
for (const [name, html] of [['CORE', core], ['LIVREUR', livreur]]) {
  const valid = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
    try { new vm.Script(match[1], { filename: `${name}.html` }); return true; }
    catch (error) { syntaxErrors.push(error.stack || error.message); return false; }
  });
  test(`SYNTAX-${name} scripts inline valides`, valid);
}
for (const error of syntaxErrors) console.log(`       ${error}`);

console.log(`\nRESULTAT AUTH-R2C: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
