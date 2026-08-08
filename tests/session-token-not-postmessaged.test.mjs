// PROMPT 009B §14 — le session_token ne doit plus jamais quitter CORE via postMessage.
import fs from 'fs';
const src = fs.readFileSync(new URL('../VERALUZ_OS_CORE.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const t = (n, c) => { try { if (c()) { console.log('  PASS ' + n); pass++; } else { console.log('  FAIL ' + n); fail++; } }
                      catch (e) { console.log('  FAIL ' + n + ' — ' + e.message); fail++; } };

function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

const m = src.match(/function sendAuthContext\(iframe\) \{[\s\S]*?\n\}\n/);
t('SAC-01 sendAuthContext() trouvee dans VERALUZ_OS_CORE.html', () => !!m);
const bodyRaw = m ? m[0] : '';
const body = stripComments(bodyRaw); // exclut la prose des commentaires explicatifs, ne teste que le CODE reel

t('SAC-02 aucune occurrence de "session_token" dans le CODE (hors commentaires) de sendAuthContext()', () =>
  !/session_token/.test(body));

t('SAC-03 aucun appel a getSessionToken() dans le corps de sendAuthContext()', () =>
  !/getSessionToken\s*\(/.test(bodyRaw));

t('SAC-04 sendAuthContext() utilise toujours postMessage (fonction non vidée)', () =>
  /postMessage/.test(body));

t('SAC-05 employee_id reste transmis (necessaire pour l\'auto-login RH existant)', () =>
  /employee_id:\s*currentUser\.employee_id/.test(body));

console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass + fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
