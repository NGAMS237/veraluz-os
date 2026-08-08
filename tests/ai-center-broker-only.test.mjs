// PROMPT 009B §14/§6/§11 — AI_CENTER_EMBEDDED.html ne doit appeler le backend
// que via window.parent.veraluzSecureRequest, jamais directement, et ne doit
// jamais persister/relire de session_token lui-meme.
import fs from 'fs';
const src = fs.readFileSync(new URL('../AI_CENTER_EMBEDDED.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const t = (n, c) => { try { if (c()) { console.log('  PASS ' + n); pass++; } else { console.log('  FAIL ' + n); fail++; } }
                      catch (e) { console.log('  FAIL ' + n + ' — ' + e.message); fail++; } };

t('AI-01 utilise window.parent.veraluzSecureRequest pour atteindre le backend', () =>
  /window\.parent\.veraluzSecureRequest/.test(src));
t('AI-02 aucun appel fetch() direct vers *.supabase.co dans ce fichier', () =>
  !/fetch\([^)]*supabase\.co/.test(src));
t('AI-03 aucune lecture/ecriture de session_token en localStorage/sessionStorage', () =>
  !/(localStorage|sessionStorage)\.(setItem|getItem)\([^)]*session_token/i.test(src));
t('AI-04 pas de cle service_role codee en dur', () =>
  !/service_role/i.test(src));

console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass + fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
