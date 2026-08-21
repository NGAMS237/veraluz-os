# SETTINGS-SSOT-1A — Suite de Tests
**Branche :** `claude/settings-ssot-1a`
**Date :** 2026-08-20

---

## A — BRANDING (DB canonical)

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| A1 | Settings → Branding : couleurs lues au boot | Couleurs proviennent de `_dbSett.branding` (DB), pas de S.branding (localStorage) | ⬜ |
| A2 | Modifier primary_color → cliquer "Enregistrer les couleurs (DB)" | Toast `✓ Enregistré (DB)` · `_dbSett.branding.primary_color` mis à jour | ⬜ |
| A3 | F5 après sauvegarde couleur | `loadDbCanonical()` recharge — couleur conservée (DB) sans lecture localStorage | ⬜ |
| A4 | Ouvrir Settings sur second appareil après sauvegarde | Même couleur affichée (cross-device depuis DB) | ⬜ |
| A5 | Tenter de coller un dataURL `data:image/...` dans le champ logo | Toast `❌ Logo : URL Storage uniquement — pas de base64` · aucun envoi EF | ⬜ |
| A6 | Saisir URL https:// Storage valide → "Enregistrer le branding (DB)" | EF accepte · logo visible dans prévisualisation + CORE sidebar | ⬜ |
| A7 | CORE boot : branding chargé sans localStorage | Console `[Core] Branding chargé depuis DB canonical` · pas de `vz_logo_url` lu | ⬜ |
| A8 | EF settings-secure : POST `{action:"update_settings", key:"branding", value:{logo_url:"data:..."}}` | HTTP 400 `logo_url_base64_rejected` | ⬜ |

---

## B — LOCALIZATION (DB canonical)

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| B1 | Settings → Localisation : valeurs lues depuis `_dbSett.localization` | language=fr, primary_currency=XAF, timezone=Africa/Douala (DB) | ⬜ |
| B2 | Changer timezone → Africa/Douala déjà sélectionné par défaut | Défaut DB respecté sans intervention | ⬜ |
| B3 | Modifier language→en → "Enregistrer la localisation (DB)" | Toast `✓ Enregistré (DB)` · event `locale-updated` émis avec language=en | ⬜ |
| B4 | F5 après sauvegarde localisation | Valeurs DB rechargées · langue=en conservée cross-session | ⬜ |
| B5 | EF : POST `{action:"update_settings", key:"localization", value:{locale:"fr-CM"}}` | HTTP 200 ok:true | ⬜ |
| B6 | EF : POST `{action:"update_settings", key:"localization", value:{fx_rate:1.5}}` | HTTP 400 `localization_field_rejected` field=fx_rate | ⬜ |
| B7 | Aucune conversion FX dans l'UI | Champ "devise secondaire" annoté "(affichage uniquement)" · aucun calcul montant affiché | ⬜ |

---

## C — HOTEL (nettoyage writers localStorage)

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| C1 | `saveAll()` en section hotel | `localStorage.setItem('vz_hotel_info', ...)` N'EST PLUS appelé | ⬜ |
| C2 | DB indisponible → section hotel | Affichage état dégradé (valeurs DB vides) · aucune écriture localStorage comme fallback | ⬜ |

---

## D — RESTAURANT (non-financier DB canonical)

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| D1 | Settings → Restaurant : chargement depuis `_dbSett.restaurant` | name, capacity, breakfast_*, lunch_*, dinner_*, bar_*, min_order = DB | ⬜ |
| D2 | Modifier `breakfast_start`→08:00 → "Enregistrer le restaurant (DB)" | Toast ok · `_dbSett.restaurant.breakfast_start=08:00` | ⬜ |
| D3 | F5 après sauvegarde restaurant | Valeur `08:00` rechargée depuis DB (pas localStorage) | ⬜ |
| D4 | Champs TVA et service_charge : absents du formulaire Restaurant | Aucun champ tva/service_charge visible en UI (déplacé FISCAL-1) | ⬜ |
| D5 | `saveRestaurantCanonical()` : tva/service_charge existants préservés | Merge `prev` conserve tva/service_charge s'ils existent en DB | ⬜ |

---

## E — PERMISSIONS (read-only)

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| E1 | Settings → Permissions → matrice affichée | Toutes les cases disabled + cursor:not-allowed | ⬜ |
| E2 | Aucun bouton "Appliquer" ou "Réinitialiser" dans Permissions | Ces boutons sont supprimés de l'UI | ⬜ |
| E3 | `saveAll()` en section permissions | `permissions-updated` event N'EST PLUS émis | ⬜ |
| E4 | CORE : `permissions-updated` handler absent | Bloc handler supprimé — ROLES non modifiés par Settings | ⬜ |
| E5 | Message informatif affiché | "⚠ Permissions réelles gérées par AUTH/_rbac.ts..." visible | ⬜ |

---

## F — NON-RÉGRESSION

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| F1 | AUTH : login PIN + session valide | Aucune régression — sessions/RBAC intacts | ⬜ |
| F2 | Booking Engine : deposit_pct / hold_duration_hours toujours DB | `get_public_booking_settings` RPC inchangé | ⬜ |
| F3 | Guest Portal : wifi.password masqué | `password_configured: true` — password jamais exposé | ⬜ |
| F4 | CORE broker : settings-secure dans ALLOWED_ENDPOINTS | Appels `veraluzSecureRequest('settings-secure',...)` fonctionnels | ⬜ |
| F5 | Réservations → onglet Paramètres : checkin/checkout toujours DB | `sbPatchSettings()` via broker — inchangé | ⬜ |
| F6 | localStorage `LS_KEY=veraluz_settings_v3` : branding/devises ne sont plus updated | Domaines migrés absents des opérations localStorage après migration | ⬜ |

---

## G — HORS SCOPE VALIDÉS (aucune migration cachée)

| # | Test | Attendu |
|---|------|---------|
| G1 | tarifs : aucune nouvelle table SQL taxes | Migration 20260820 ne contient aucune table taxes |
| G2 | chambres : aucune table veraluz_unit_types créée | Migration 20260820 ne contient pas unit_types |
| G3 | notifs/systeme/integrations/email : localStorage inchangé | Ces sections non touchées |

---

**Total : 20 tests (A:8, B:7, C:2, D:5, E:5, F:6, G:3 info)**

---

## H — MICRO PATCH PRE-DEPLOY GUARDS (fix(settings): final pre-deploy guards)

| # | Test | Attendu | Résultat |
|---|------|---------|----------|
| H1 | `_LS_CANONICAL` contient `'devises'` et `'fiscal'` | `_LS_CANONICAL.includes('devises') === true` · `_LS_CANONICAL.includes('fiscal') === true` — ni l'un ni l'autre ne doit jamais être écrit en localStorage | ⬜ |
| H2 | `exportSettings()` produit `{_meta, settings}` sans domaines canonical | Le JSON exporté ne contient PAS de clé `branding`, `localization`, `restaurant`, `tarifs`, `chambres`, `devises`, `fiscal` dans `settings`. Le champ `_meta.excluded` liste ces domaines. Le fichier se nomme `veraluz_settings_local_AAAA-MM-JJ.json` | ⬜ |
| H3 | `saveCanonical()` refusé si `_dbSettError === true` | Simuler un boot DB KO (`_dbSettError=true`) → appeler `saveCanonical('branding',{})` → toast `❌ DB indisponible — sauvegarde impossible` — aucun appel réseau effectué | ⬜ |
| H4 | `logo-upload-secure` : erreur lecture branding → HTTP 500, aucun upload Storage | Simuler erreur DB sur `maybeSingle()` branding → l'EF retourne `{ok:false, error:'branding_read_error'}` · aucun fichier uploadé dans le bucket `logos` | ⬜ |
| H5 | `logo-upload-secure` : `old_path_removed` reflète le résultat réel du cleanup | Si suppression de l'ancien objet réussit → `old_path_removed: true`. Si elle échoue (non-bloquant) → `old_path_removed: false`. Si aucun ancien objet → `old_path_removed: null` | ⬜ |
| H6 | Migration legacy `logoUrl` → `logo_url` (branding PROD camelCase HTTP) | Si `_dbSett.branding.logoUrl` commence par `https://` et `logo_url` absent → `_dbSett.branding.logo_url` est renseigné · `saveCanonical('branding', {legacy_logo_url:..., logo_url:...})` est appelé (fire-and-forget) | ⬜ |
| H7 | Migration legacy `logoUrl` relatif → PAS de promotion `logo_url` | Si `logoUrl = '/uploads/logo.png'` (pas `http://`) → `logo_url` reste absent · `legacy_logo_url` seul enregistré | ⬜ |
| H8 | `settings-secure` fiscal : update partiel `{tourist_tax_value: 150}` bloqué si DB type = `pct` | POST `{action:"update_settings", key:"fiscal", value:{tourist_tax_value:150}}` alors que DB a `tourist_tax_type:'pct'` → HTTP 400 `invalid_fiscal_value` field=`tourist_tax_value` range=`0–100 (type=pct)` | ⬜ |
| H9 | `settings-secure` fiscal : update partiel `{tourist_tax_value: 150}` autorisé si DB type = `fixed` | Même payload alors que DB a `tourist_tax_type:'fixed'` → HTTP 200 `ok:true` | ⬜ |
| H10 | `guest-access` : `checkout_time` défaut `'12:00'` | Si `booking.checkout_time` est absent/null → la réponse contient `checkout_time:'12:00'` et non `'11:00'` | ⬜ |

---

**Total section H : 10 tests (H1–H10)**
**Total général après patch : 30 tests fonctionnels + 3 informatifs**
