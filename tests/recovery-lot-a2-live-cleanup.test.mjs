import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const core = read('VERALUZ_OS_CORE.html');
const rh = read('RH_EMBEDDED.html');
const sw = read('sw.js');

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
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

const directRhRest = /\/rest\/v1\/veraluz_(?:attendance|pointages|payroll|hr_tasks|employee_checkins)/;
const punchIn = fnSource(core, 'doPunchIn');
const punchOut = fnSource(core, 'doPunchOut');
const history = fnSource(core, 'loadAttHistory');
const logout = fnSource(core, 'logout');
const clearLocal = fnSource(core, 'clearCoreLocalSession');
const clearRendered = fnSource(core, 'clearCoreRenderedContext');
const loginDirectory = fnSource(core, 'getEmployeesFromSupabase');
const loginNormalizer = fnSource(core, 'normalizeLoginEmployee');

test('A2-01 aucun POST frontend direct vers veraluz_attendance', !directRhRest.test(core));
test('A2-02 Mon espace lit attendance via get_my_rh_workspace', history.includes("action:'get_my_rh_workspace'") && !directRhRest.test(history));
test('A2-03 Mon espace ne lit pas payroll directement', !/rest\/v1\/veraluz_payroll/.test(core));
test('A2-04 Mon espace ne lit pas hr_tasks directement', !/rest\/v1\/veraluz_hr_tasks/.test(core));
test('A2-05 doPunchIn utilise employees-secure punch_self', punchIn.includes("'employees-secure'") && punchIn.includes("action:'punch_self'") && punchIn.includes("event:'in'"));
test('A2-06 doPunchOut utilise employees-secure punch_self', punchOut.includes("'employees-secure'") && punchOut.includes("action:'punch_self'") && punchOut.includes("event:'out'"));
test('A2-07 aucun handler pointage legacy redéfini', (core.match(/function doPunchIn\s*\(/g) || []).length === 1 && (core.match(/function doPunchOut\s*\(/g) || []).length === 1 && (core.match(/function loadAttHistory\s*\(/g) || []).length === 1);
test('A2-08 logout vide module-frame', logout.includes('clearCoreLocalSession(true)') && clearLocal.includes('clearCoreRenderedContext()') && clearRendered.includes("iframe.src = 'about:blank'"));
test('A2-09 logout supprime identité et tokens', clearLocal.includes('clearSessionToken()') && clearLocal.includes('currentUser = null') && clearLocal.includes('localStorage.removeItem(CORE_RESUME_KEY)'));
test('A2-10 logout ne laisse aucune vue RH active', clearRendered.includes("moduleView.classList.remove('active')") && clearRendered.includes("moduleError.classList.remove('show')"));
test('A2-11 changement utilisateur détruit le DOM précédent', clearLocal.includes('clearCoreRenderedContext()') && clearRendered.includes('iframe.onload = null') && clearRendered.includes("iframe.src = 'about:blank'"));
test('A2-12 annuaire login utilise list-login-employees', loginDirectory.includes('EDGE_LOGIN_EMPLOYEES_URL') && loginDirectory.includes('body.employees') && !loginDirectory.includes('/rest/v1/'));
test('A2-13 cache login limité à id et display_name', loginNormalizer.includes("return { id: String(emp.id), display_name: displayName }") && !/data-(?:role|email|team|department)/.test(core));
test('A2-14 service worker versionné et JS network-first', sw.includes("veraluz-pwa-v034-recovery-a2") && !fnSource(sw, 'isStaticAsset').includes("url.endsWith('.js')") && sw.includes("fetch(request, {cache:'no-store'})"));
test('A2-15 baseline Lot A/A1 conservée', rh.includes("employeesSecure('rh_read'") && rh.includes("employeesSecure('rh_write'") && !directRhRest.test(rh));

console.log(`\nRecovery Lot A.2: ${passed} PASS / ${failed} FAIL`);
if (failed) process.exitCode = 1;
