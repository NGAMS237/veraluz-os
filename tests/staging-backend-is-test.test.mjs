// PROMPT 009B §14 — le harnais TEST/STAGING doit pointer exclusivement sur le
// projet TEST (joegfxwcsvtqtxbffpkp), jamais sur PRODUCTION (dfdmasejsoibxrvubegu),
// et afficher clairement l'environnement.
import fs from 'fs';
const src = fs.readFileSync(new URL('../VERALUZ_OS_CORE_TEST_STAGING_009.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const t = (n, c) => { try { if (c()) { console.log('  PASS ' + n); pass++; } else { console.log('  FAIL ' + n); fail++; } }
                      catch (e) { console.log('  FAIL ' + n + ' — ' + e.message); fail++; } };

function stripComments(s) { return s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); }
const code = stripComments(src);

t('STG-01 SUPABASE_URL pointe sur le projet TEST', () =>
  /SUPABASE_URL\s*=\s*'https:\/\/joegfxwcsvtqtxbffpkp\.supabase\.co'/.test(src));
t('STG-02 le projet PRODUCTION n\'apparait nulle part dans le CODE (hors commentaire explicatif d\'en-tete)', () =>
  !/dfdmasejsoibxrvubegu/.test(code));
t('STG-03 bandeau ENVIRONNEMENT DE TEST toujours visible (position sticky)', () =>
  /ENVIRONNEMENT DE TEST/.test(src) && /class="banner"/.test(src));
t('STG-04 le backend TEST est affiche explicitement dans le bandeau', () =>
  /joegfxwcsvtqtxbffpkp/.test(src.match(/<div class="banner">[\s\S]*?<\/div>/)[0]));
t('STG-05 session_token jamais ecrit en localStorage/sessionStorage', () =>
  !/localStorage\.(setItem|getItem)\([^)]*session/i.test(src) &&
  !/sessionStorage\.(setItem|getItem)\([^)]*session/i.test(src));
t('STG-06 le postMessage auth-context vers l\'iframe IA ne contient pas session_token dans son objet data', () => {
  const m = src.match(/postMessage\(\{ source: 'veraluz-core', type: 'auth-context', data: \{[\s\S]*?\} \}, '\*'\);/);
  return !!m && !/session_token/.test(stripComments(m[0]));
});
t('STG-07 le broker window.veraluzSecureRequest ajoute lui-meme le session_token', () =>
  /reqBody\.session_token\s*=\s*_sessionToken/.test(src));

console.log(`\n${'='.repeat(60)}\nRESULTAT : ${pass} reussis / ${pass + fail} — ${fail} echec(s)\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
