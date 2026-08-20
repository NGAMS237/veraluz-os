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
