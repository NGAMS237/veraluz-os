// PROMPT 009B §14/§16 — verifie EN DIRECT que les anciens session_token reels
// issus des tests du lot 009 (evidence/auth-backend-tests-raw-output.txt) sont
// bien rejetes maintenant que les comptes TEST009_* ont ete supprimes (§2).
// Aucune ecriture, aucune nouvelle fixture — lecture seule.
import fs from 'fs';
const core = fs.readFileSync(new URL('../VERALUZ_OS_CORE.html', import.meta.url), 'utf8');
const anon = core.match(/var SUPA_KEY = '([^']+)'/)[1];
const changePinUrl = core.match(/var EDGE_CHANGE_PIN_URL\s*=\s*'([^']+)'/)[1];

let pass = 0, fail = 0;
const t = (n, c) => { try { if (c()) { console.log('  PASS ' + n); pass++; } else { console.log('  FAIL ' + n); fail++; } }
                      catch (e) { console.log('  FAIL ' + n + ' — ' + e.message); fail++; } };

// Jetons reels captures pendant les tests §14 du lot 009 (voir evidence/auth-backend-tests-raw-output.txt),
// deja revoques puis le compte lui-meme supprime par la correction 009B §2.
const oldTokens = [
  'da07fec0a69471a3817b0827dea5fa34ee89c7a5affb56283f396b05d89116f5', // TEST009_DIRECTION
  '37ed13a0eb75bf2d77dbaeaeaee4da16f8b8b4b7287a320cf90c96da09379212', // TEST009_EMPLOYE
];

async function tryUse(token) {
  const r = await fetch(changePinUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': anon, 'Authorization': 'Bearer ' + anon,
               'Origin': 'https://ngams237.github.io' },
    body: JSON.stringify({ session_token: token, current_pin: '482913', new_pin: '384726' }),
  });
  return r.json().catch(() => ({}));
}

for (const tok of oldTokens) {
  const res = await tryUse(tok);
  t('SR-' + tok.slice(0, 8) + '… rejete (unauthorized)', () =>
    res && res.ok === false && res.error === 'unauthorized');
}

console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass + fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
