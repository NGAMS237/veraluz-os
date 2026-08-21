# SETTINGS-FISCAL-1 — Tests de recette (v2 — review fixes)

Source canonique : `veraluz_settings.fiscal` via `settings-secure` EF.

---

## A. Lecture — gérant peut lire fiscal depuis DB (badge DB affiché)

**Précondition** : session gérant active, DB accessible, migration `20260820_settings_fiscal_1.sql` appliquée.

1. Ouvrir Paramètres > Tarifs & Fiscalité.
2. **Attendu** : badge vert `DB` visible à côté du titre.
3. Valeurs affichées : TVA 19.25%, taxe touristique 2000 XAF/nuit, charge de service 10%, annulation 30%.
4. **Non attendu** : aucune lecture depuis `veraluz_settings_v3.tarifs` ou `vlz_settings`.

---

## B. Écriture gérant — mise à jour taux TVA validée DB

1. Modifier le taux TVA à 20%, cliquer "Enregistrer la fiscalité".
2. **Attendu** : toast succès, badge `DB` maintenu.
3. Recharger le module (F5 ou navigation) : taux TVA = 20% lu depuis DB.
4. Vérifier dans `veraluz_settings` : `key='fiscal', value->>'vat_rate' = '20'`.

---

## C. Écriture manager — HTTP 403 (forbidden)

1. Se connecter avec un compte `manager`.
2. Tenter "Enregistrer la fiscalité".
3. **Attendu** : réponse HTTP 403 depuis `settings-secure`, toast d'erreur côté UI.
4. Aucune modification dans `veraluz_settings.fiscal`.

---

## D. Taux invalide (TVA > 100) — rejeté côté client ET serveur

**Client** :
1. Saisir TVA = 150%, cliquer "Enregistrer la fiscalité".
2. **Attendu** : toast `❌ Taux TVA invalide (0–100%)`, aucun appel réseau.

**Serveur** (bypass UI via curl/test direct) :
1. Envoyer `{action:'update_settings', key:'fiscal', value:{vat_rate:150}}` à `settings-secure`.
2. **Attendu** : `{ok:false, error:'invalid_fiscal_value', field:'vat_rate'}` HTTP 400.

---

## E. DB KO — badge DB KO, bouton save désactivé, pas de fallback writable localStorage

1. Simuler DB indisponible (couper réseau ou revoke anon key temporairement).
2. Naviguer sur Tarifs & Fiscalité.
3. **Attendu** :
   - Badge rouge `DB KO` visible.
   - Bannière mode dégradé affichée.
   - Bouton "DB indisponible" désactivé (attribut `disabled`).
4. **Non attendu** : écriture dans `veraluz_settings_v3` ou `vlz_settings`.

---

## F. Aucune vérité fiscale writable en localStorage

1. Inspecter `localStorage` dans DevTools.
2. **Attendu** : `veraluz_settings_v3.tarifs` n'est jamais mis à jour par le module Paramètres.
3. **Attendu** : `vlz_settings.tax_pct` n'est jamais écrit par `saveSettings()` dans Réservations.
4. `_LS_CANONICAL` contient `'tarifs'` → `saveAll()` exclut ce namespace du `localStorage.setItem`.

---

## G. RESERVATIONS lit TVA depuis _dbSettings.fiscal (plus vlz_settings.tax_pct)

1. Ouvrir Réservations > onglet Paramètres généraux.
2. **Attendu** : champ "Taxe de séjour / TVA (%)" affiche la valeur de `_dbSettings.fiscal.vat_rate` (ex: 19.25).
3. Champ en lecture seule (`readonly`, fond grisé, tooltip "Géré dans Paramètres → Fiscalité (DB canonical)").
4. Modifier la TVA dans Paramètres → Fiscalité, recharger Réservations : valeur mise à jour.
5. `vlz_settings` dans localStorage ne contient plus de clé `tax_pct` après la migration.

---

## H. vat_enabled=false → tax_pct = 0 dans RESERVATIONS (STATIC CHECK)

**Static** : inspecter `RESERVATIONS_EMBEDDED.html` — ligne champ `p-tax` :
```javascript
var f = _dbSettings.fiscal;
if (!f) return 0;
return f.vat_enabled === true ? (f.vat_rate || 0) : 0;
```
Règle : si `vat_enabled=false`, le champ affiche `0` même si `vat_rate` a une valeur en DB.
**Non attendu** : `_settings.tax_pct` ou `_settings.vat_rate` utilisé comme fallback.

**Runtime** :
1. Dans Paramètres → Fiscalité, désactiver TVA (toggle OFF).
2. Enregistrer.
3. Ouvrir Réservations → Paramètres généraux.
4. **Attendu** : champ TVA = 0.

---

## I. Import JSON ne réintroduit aucun domaine canonical en localStorage (STATIC CHECK)

**Static** : inspecter `SETTINGS_EMBEDDED.html` — fonction `importSettings()` :
- Lit le JSON importé dans `S` (mémoire JS).
- Filtre `_LS_CANONICAL` avant `localStorage.setItem`.
- `_LS_CANONICAL` = `['hotel','branding','localization','restaurant','tarifs','chambres']`.
- **Non attendu** : `localStorage.setItem(LS_KEY, JSON.stringify(S))` sans filtre (bug pré-review).

**Runtime** :
1. Exporter les paramètres courants (`exportSettings()`).
2. Supprimer LS : `localStorage.removeItem('veraluz_settings_v3')`.
3. Réimporter le JSON exporté.
4. Inspecter LS : aucune des clés `['hotel','branding','localization','restaurant','tarifs','chambres']` dans `veraluz_settings_v3`.

---

## J. tourist_tax_type=pct → tourist_tax_value > 100 rejeté (STATIC CHECK + runtime)

**Static** : inspecter `settings-secure/index.ts` — bloc fiscal :
```typescript
const ttType = typeof v.tourist_tax_type === 'string' ? v.tourist_tax_type : 'fixed';
// si pct && value > 100 → HTTP 400
```

**Runtime** :
1. Envoyer `{key:'fiscal', value:{tourist_tax_type:'pct', tourist_tax_value:150}}`.
2. **Attendu** : HTTP 400 `{ok:false, error:'invalid_fiscal_value', field:'tourist_tax_value', range:'0–100 (type=pct)'}`.
3. Envoyer `{key:'fiscal', value:{tourist_tax_type:'pct', tourist_tax_value:50}}`.
4. **Attendu** : HTTP 200.
5. Envoyer `{key:'fiscal', value:{tourist_tax_type:'fixed', tourist_tax_value:5000}}` (XAF).
6. **Attendu** : HTTP 200 (pas de cap à 100 en mode fixed).

---

## K. DB KO visible sur Localisation, Branding, Restaurant (STATIC CHECK)

**Static** : vérifier que les fonctions suivantes comportent badge + degradeMsg + bouton disabled sur `_dbSettError` :
- `renderHotel()` ✓ (existait avant review)
- `renderTarifs()` ✓ (existait avant review)
- `renderChambres()` ✓ (via `_dbCatalogError`, existait avant review)
- `renderBranding()` ✓ **(ajouté review fix)**
- `renderRestaurant()` ✓ **(ajouté review fix)**
- `renderDevises()` (Localisation) ✓ **(ajouté review fix)**

**Runtime** (DB KO) :
1. Simuler DB KO.
2. Naviguer dans chacun des 6 onglets ci-dessus.
3. **Attendu** : badge `DB KO` + bannière mode dégradé + bouton Enregistrer désactivé.
4. **Non attendu** : section semble fonctionnelle ou bouton actif.
