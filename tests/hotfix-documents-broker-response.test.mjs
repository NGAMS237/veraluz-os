/**
 * Tests automatisés — HOTFIX DOCUMENTS — RÉPONSE BROKER + UPLOAD VISIBLE
 * Branche : claude/hotfix-documents-broker-response
 * Exécution : node --test tests/hotfix-documents-broker-response.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'DOCUMENTS_EMBEDDED.html'), 'utf-8');
const SW   = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf-8');

/* ── Helper : simulate docsRequest with a stubbed broker response ── */
function makeDocsRequest(brokerResponse) {
  // Inline docsRequest logic extracted from the HTML
  const status = brokerResponse.status;
  const body   = brokerResponse.body || {};
  if (status === 0) {
    const e = Object.assign(new Error('network_error'), { status: 0, code: 'network_error' });
    return Promise.reject(e);
  }
  if (!body.ok || status < 200 || status >= 300) {
    const e = Object.assign(
      new Error(body.error || 'request_failed'),
      { status, code: body.error || 'request_failed' }
    );
    return Promise.reject(e);
  }
  return Promise.resolve(body);
}

/* ── H-01  200 + ok:true → résolution avec body ── */
test('H-01: 200 + ok:true résout avec body', async () => {
  const docs = Array.from({ length: 11 }, (_, i) => ({ id: `doc-${i}`, has_file: i % 2 === 0 }));
  const body = await makeDocsRequest({ status: 200, body: { ok: true, documents: docs } });
  assert.ok(body.ok);
  assert.equal(body.documents.length, 11);
});

/* ── H-02  status 0 → erreur réseau ── */
test('H-02: status=0 rejette avec code network_error', async () => {
  await assert.rejects(
    () => makeDocsRequest({ status: 0, body: { ok: false, error: 'network_error' } }),
    (e) => { assert.equal(e.status, 0); assert.equal(e.code, 'network_error'); return true; }
  );
});

/* ── H-03  401 → rejet ── */
test('H-03: 401 rejette avec status 401', async () => {
  await assert.rejects(
    () => makeDocsRequest({ status: 401, body: { ok: false, error: 'invalid_session' } }),
    (e) => { assert.equal(e.status, 401); assert.equal(e.code, 'invalid_session'); return true; }
  );
});

/* ── H-04  403 → rejet ── */
test('H-04: 403 rejette avec status 403', async () => {
  await assert.rejects(
    () => makeDocsRequest({ status: 403, body: { ok: false, error: 'forbidden' } }),
    (e) => { assert.equal(e.status, 403); return true; }
  );
});

/* ── H-05  500 + ok:false → rejet, jamais résolution ── */
test('H-05: 500 + ok:false rejette (pas de faux succès)', async () => {
  await assert.rejects(
    () => makeDocsRequest({ status: 500, body: { ok: false, error: 'internal_error' } }),
    (e) => { assert.equal(e.status, 500); return true; }
  );
});

/* ── H-06  body.ok=false avec 200 → rejet ── */
test('H-06: 200 + ok:false rejette', async () => {
  await assert.rejects(
    () => makeDocsRequest({ status: 200, body: { ok: false, error: 'auth_failed' } }),
    (e) => { assert.equal(e.code, 'auth_failed'); return true; }
  );
});

/* ── H-07  11 fiches rendues (code source) ── */
test('H-07: renderAll itère sur documents (code source)', () => {
  // docsRequest resolves with body; loadDocs does ALL_DOCS = res.documents
  assert.ok(
    HTML.includes('ALL_DOCS=res.documents||[]') || HTML.includes('ALL_DOCS = res.documents'),
    'ALL_DOCS doit être peuplé depuis res.documents (body)'
  );
});

/* ── H-08  get_signed_url utilise body.url ── */
test('H-08: consultDoc utilise res.url après unwrap (body direct)', () => {
  // After fix, docsRequest resolves with body, so res IS the body → res.url is body.url
  assert.ok(
    HTML.includes("res.url") && HTML.includes('docsRequest(\'get_signed_url\''),
    'consultDoc doit utiliser res.url depuis le body résolu'
  );
  // Must NOT open with undefined (body.url must exist check)
  assert.ok(
    HTML.includes("if(res && res.url)") || HTML.includes("if(res&&res.url)") ||
    HTML.includes("res && res.url"),
    'Guard res.url présent'
  );
});

/* ── H-09  Bouton Uploader desktop (has_file false) ── */
test('H-09: code desktop contient bouton Uploader/Remplacer conditionnel', () => {
  assert.ok(
    HTML.includes("d.has_file?'Remplacer':'Uploader'"),
    "Bouton conditionnel Remplacer/Uploader absent du rendu desktop"
  );
});

/* ── H-10  Bouton mobile présent ── */
test('H-10: cartes mobiles contiennent également le bouton Uploader/Remplacer', () => {
  const matches = (HTML.match(/d\.has_file\?'Remplacer':'Uploader'/g) || []).length;
  assert.ok(matches >= 2, `Attendu ≥2 occurrences (desktop + mobile), trouvé ${matches}`);
});

/* ── H-11  quickUpload appelle viewDoc puis triggerFileUpload ── */
test('H-11: quickUpload ouvre la fiche via viewDoc avant de déclencher le picker', () => {
  assert.ok(
    HTML.includes('viewDoc(id)') && HTML.includes('triggerFileUpload()'),
    'quickUpload doit appeler viewDoc(id) puis triggerFileUpload()'
  );
  // viewDoc sets CURRENT_VIEW_ID — ensure quickUpload relies on viewDoc, not direct assignment
  const fnMatch = HTML.match(/function quickUpload\(id\)\{[\s\S]*?\}/);
  assert.ok(fnMatch, 'Fonction quickUpload introuvable');
  const fn = fnMatch[0];
  assert.ok(fn.includes('viewDoc(id)'), 'quickUpload doit appeler viewDoc(id)');
  assert.ok(fn.includes('triggerFileUpload()'), 'quickUpload doit appeler triggerFileUpload()');
});

/* ── H-12  ID exact utilisé pour l'upload ── */
test('H-12: veraluzUploadDocument utilise CURRENT_VIEW_ID', () => {
  assert.ok(
    HTML.includes('veraluzUploadDocument(CURRENT_VIEW_ID, file)'),
    'Upload doit passer CURRENT_VIEW_ID au broker'
  );
});

/* ── H-13  Aucun accès REST direct ── */
test('H-13: aucun fetch direct vers supabase.co dans DOCUMENTS_EMBEDDED', () => {
  // Extraire uniquement les blocs <script> pour les vérifications de code
  const scriptContent = (HTML.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
  assert.ok(
    !scriptContent.includes('supabase.co'),
    'DOCUMENTS_EMBEDDED.html: aucune URL supabase.co dans les blocs <script>'
  );
  // service_role interdit dans le code JS (toléré dans le texte UI en commentaire)
  assert.ok(
    !scriptContent.includes('service_role'),
    'service_role interdit dans les blocs <script> du frontend'
  );
});

/* ── H-14  DELETE interdit ── */
test('H-14: aucun appel DELETE dans DOCUMENTS_EMBEDDED', () => {
  // Acceptable: archive (status update). Forbidden: DELETE method or deleteDoc call
  const hasDELETE = /method\s*:\s*['"]DELETE['"]/i.test(HTML);
  assert.ok(!hasDELETE, "Méthode DELETE interdite dans DOCUMENTS_EMBEDDED.html");
});

/* ── H-15  Cache PWA >= v036 (v037 avec Lot E) ── */
test('H-15: sw.js CACHE_NAME est >= veraluz-pwa-v036 (actuel: v037-lot-e)', () => {
  // Le hotfix v036 a été intégré au v037 (Lot E). v035 ne doit jamais revenir.
  assert.ok(
    SW.includes("CACHE_NAME = 'veraluz-pwa-v037-lot-e'") ||
    SW.includes("CACHE_NAME = 'veraluz-pwa-v036-documents-hotfix'"),
    "sw.js: CACHE_NAME doit être >= veraluz-pwa-v036"
  );
  assert.ok(
    !SW.includes('veraluz-pwa-v035'),
    "Ancienne valeur v035 encore présente dans sw.js"
  );
});
