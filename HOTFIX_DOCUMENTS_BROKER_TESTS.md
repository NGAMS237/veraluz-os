# HOTFIX DOCUMENTS — RÉPONSE BROKER + UPLOAD VISIBLE
## Tests ciblés — branche `claude/hotfix-documents-broker-response`

---

### H-01 — Unwrap broker : 2xx + ok:true → résolution avec body

**Condition** : `veraluzSecureRequest` retourne `{ status: 200, body: { ok: true, documents: [...] } }`
**Attendu** : `docsRequest('list')` résout avec `{ ok: true, documents: [...] }`
**Interdit** : accès à `res.documents` sur l'objet `{ status, body }` brut

---

### H-02 — Unwrap broker : status 0 → erreur réseau

**Condition** : `veraluzSecureRequest` retourne `{ status: 0, body: { ok: false, error: 'network_error' } }`
**Attendu** : `docsRequest` rejette avec `e.status === 0`, `e.code === 'network_error'`

---

### H-03 — Unwrap broker : 401 → rejet avec status + code

**Condition** : `veraluzSecureRequest` retourne `{ status: 401, body: { ok: false, error: 'invalid_session' } }`
**Attendu** : `docsRequest` rejette avec `e.status === 401`, `e.code === 'invalid_session'`
**Interdit** : résolution silencieuse, traitement comme succès

---

### H-04 — Unwrap broker : 403 → rejet avec status + code

**Condition** : `veraluzSecureRequest` retourne `{ status: 403, body: { ok: false, error: 'forbidden' } }`
**Attendu** : `docsRequest` rejette avec `e.status === 403`

---

### H-05 — Unwrap broker : 500 + ok:false → rejet (pas de faux succès)

**Condition** : `veraluzSecureRequest` retourne `{ status: 500, body: { ok: false, error: 'internal_error' } }`
**Attendu** : `docsRequest` rejette — JAMAIS résolution
**Interdit** : `ALL_DOCS = []` peuplé avec une réponse 500

---

### H-06 — 11 fiches rendues après list

**Condition** : broker retourne `{ status: 200, body: { ok: true, documents: [/* 11 objets */] } }`
**Attendu** : `ALL_DOCS.length === 11`, tableau desktop et cartes mobiles affichent 11 lignes

---

### H-07 — get_signed_url utilise body.url

**Condition** : broker retourne `{ status: 200, body: { ok: true, url: 'https://...', expires_in: 900 } }`
**Attendu** : `consultDoc()` ouvre `body.url` — PAS `res.url` sur l'objet broker brut
**Interdit** : `window.open` avec `undefined`

---

### H-08 — Bouton Uploader visible dans le tableau desktop (has_file = false)

**Condition** : fiche avec `has_file: false`
**Attendu** : ligne desktop contient un bouton dont le texte est `Uploader`
**Attendu** : clic sur le bouton appelle `quickUpload(id)` avec l'ID correct

---

### H-09 — Bouton Remplacer visible dans le tableau desktop (has_file = true)

**Condition** : fiche avec `has_file: true`
**Attendu** : ligne desktop contient un bouton dont le texte est `Remplacer`

---

### H-10 — Bouton Uploader/Remplacer visible dans les cartes mobiles

**Condition** : fiches avec `has_file: false` et `has_file: true`
**Attendu** : chaque carte mobile contient le bouton correspondant (`Uploader` ou `Remplacer`)

---

### H-11 — quickUpload définit CURRENT_VIEW_ID avant le file picker

**Condition** : `quickUpload('abc-123')` appelé
**Attendu** : `CURRENT_VIEW_ID === 'abc-123'` AVANT que `doc-file-input.click()` soit déclenché
**Effet** : `handleFileSelected` utilisera le bon ID de fiche

---

### H-12 — Upload via quickUpload utilise l'ID de la fiche correcte

**Condition** : `quickUpload('fiche-X')` → sélection d'un fichier
**Attendu** : `window.parent.veraluzUploadDocument('fiche-X', file)` appelé
**Interdit** : upload vers un ID null, undefined, ou celui d'une autre fiche

---

### H-13 — Aucun accès REST direct côté navigateur

**Condition** : inspection du code DOCUMENTS_EMBEDDED.html
**Attendu** : zéro appel `fetch` direct vers `supabase.co`
**Attendu** : zéro référence à `service_role`
**Attendu** : tout passe par `window.parent.veraluzSecureRequest` ou `window.parent.veraluzUploadDocument`

---

### H-14 — DELETE interdit

**Condition** : inspection du code DOCUMENTS_EMBEDDED.html et documents-secure
**Attendu** : aucun appel DELETE de fiche, ni côté frontend ni dans l'EF
**Accepté** : archivage (`status = 'archived'`) uniquement

---

### H-15 — PWA cache incrémenté

**Condition** : lecture de `sw.js`
**Attendu** : `CACHE_NAME === 'veraluz-pwa-v036-documents-hotfix'`
**Interdit** : `veraluz-pwa-v035-ui-d2` ou toute valeur antérieure

---

*Tous ces tests doivent être exécutés et PASS avant tout merge vers main.*
*Aucun déploiement PROD sans autorisation explicite.*
