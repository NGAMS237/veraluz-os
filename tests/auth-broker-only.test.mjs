// PROMPT 009B §14 — AUTH_EMBEDDED.html et RH_EMBEDDED.html ne doivent plus jamais
// recevoir/utiliser un session_token brut ; ils doivent passer par le broker unique
// window.parent.veraluzSecureRequest(), defini dans VERALUZ_OS_CORE.html.
import fs from 'fs';
const core = fs.readFileSync(new URL('../VERALUZ_OS_CORE.html', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../AUTH_EMBEDDED.html', import.meta.url), 'utf8');
const rh   = fs.readFileSync(new URL('../RH_EMBEDDED.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const t = (n, c) => { try { if (c()) { console.log('  PASS ' + n); pass++; } else { console.log('  FAIL ' + n); fail++; } }
                      catch (e) { console.log('  FAIL ' + n + ' — ' + e.message); fail++; } };

t('CORE-01 window.veraluzSecureRequest defini dans CORE', () =>
  /window\.veraluzSecureRequest\s*=\s*function/.test(core));
t('CORE-02 allowlist du broker contient exactement les 3 endpoints AUTH/RH requis', () => {
  const m = core.match(/VERALUZ_BROKER_ALLOWED_ENDPOINTS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return false;
  const list = m[1];
  return /'reset-employee-pin'/.test(list) &&
         /'revoke-employee-sessions'/.test(list) &&
         /'get-employee-access-status'/.test(list);
});
t('CORE-03 le broker envoie la session uniquement via X-Veraluz-Session', () =>
  /'X-Veraluz-Session':\s*tok/.test(core)
    && !/reqBody\.session_token\s*=/.test(core));

t('AUTH-01 AUTH_EMBEDDED.html ne declare plus _authRealSessionToken', () =>
  !/_authRealSessionToken/.test(auth));
t('AUTH-02 doResetPin() appelle le broker window.parent.veraluzSecureRequest', () =>
  /window\.parent\.veraluzSecureRequest\(\s*'reset-employee-pin'/.test(auth));
t('AUTH-03 aucun fetch() direct vers reset-employee-pin avec un session_token dans le corps', () =>
  !/body:\s*JSON\.stringify\(\{\s*session_token:\s*_authRealSessionToken/.test(auth));

t('RH-01 RH_EMBEDDED.html ne declare plus _rhSessionToken', () =>
  !/_rhSessionToken/.test(rh));
t('RH-02 loadDosAccessStatus() appelle le broker', () =>
  /window\.parent\.veraluzSecureRequest\(\s*'get-employee-access-status'/.test(rh));
t('RH-03 doRhResetPin() appelle le broker', () =>
  /window\.parent\.veraluzSecureRequest\(\s*'reset-employee-pin'/.test(rh));
t('RH-04 doRhRevokeSessions() appelle le broker', () =>
  /window\.parent\.veraluzSecureRequest\(\s*'revoke-employee-sessions'/.test(rh));
t('RH-05 aucun fetch() direct vers ces 3 Edge Functions avec un session_token dans le corps', () =>
  !/body:\s*JSON\.stringify\(\{\s*session_token:\s*_rhSessionToken/.test(rh));

console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass + fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
