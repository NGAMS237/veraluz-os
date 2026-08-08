// PROMPT 009B §14/§16 — verifie EN DIRECT, sur PRODUCTION (dfdmasejsoibxrvubegu),
// qu'aucun des 4 comptes TEST009_* du lot 009 n'est plus connectable. Ne cree
// AUCUNE nouvelle fixture (lecture seule, respecte §8). Utilise la cle anon deja
// publique, extraite du fichier reellement deploye (jamais dupliquee a la main).
import fs from 'fs';
const core = fs.readFileSync(new URL('../VERALUZ_OS_CORE.html', import.meta.url), 'utf8');
const anon = core.match(/var SUPA_KEY = '([^']+)'/)[1];
const verifyUrl = core.match(/var EDGE_VERIFY_PIN_URL\s*=\s*'([^']+)'/)[1];

let pass = 0, fail = 0;
const t = (n, c) => { try { if (c()) { console.log('  PASS ' + n); pass++; } else { console.log('  FAIL ' + n); fail++; } }
                      catch (e) { console.log('  FAIL ' + n + ' — ' + e.message); fail++; } };

async function tryLogin(employee_id) {
  const r = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': anon, 'Authorization': 'Bearer ' + anon,
               'Origin': 'https://ngams237.github.io' },
    body: JSON.stringify({ employee_id, pin: '000000' }),
  });
  return r.json().catch(() => ({}));
}

const ids = ['TEST009_DIRECTION', 'TEST009_EMPLOYE', 'TEST009_BARMAN', 'TEST009_TECHNICIEN'];
for (const id of ids) {
  const res = await tryLogin(id);
  t('FX-' + id + ' refuse la connexion (compte supprime, 009B §2)', () =>
    res && res.ok === false && (res.error === 'invalid_credentials' || res.error === 'employee_inactive'));
}

console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass + fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
