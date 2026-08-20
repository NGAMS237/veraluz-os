# SETTINGS-FISCAL-1 — Tests de recette

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
3. Champ en lecture seule (`readonly`, fond grisé, tooltip "Géré dans Paramètres → Fiscalité").
4. Modifier la TVA dans Paramètres → Fiscalité, recharger Réservations : valeur mise à jour.
5. `vlz_settings` dans localStorage ne contient plus de clé `tax_pct` après la migration.
