# CATALOG-SSOT-1 — Tests de recette

Source canonique : `veraluz_units` via `catalog-secure` EF et lecture directe REST anon.

---

## A. Lecture catalogue — badge DB, unités affichées depuis veraluz_units

**Précondition** : migration `20260820_catalog_ssot_1.sql` appliquée (ou unités déjà présentes).

1. Ouvrir Paramètres > Catalogue d'hébergement.
2. **Attendu** : badge vert `DB` visible, tableau affichant les unités de `veraluz_units`.
3. Compter les lignes : correspond exactement au contenu de la table.
4. **Non attendu** : lecture depuis `veraluz_settings_v3.chambres` ou `vlz_settings`.

---

## B. Création unité — gérant peut créer, unité apparaît dans Réservations

1. Cliquer "+ Ajouter", renseigner nom "Suite Deluxe", type "suite", capacité 4, prix 90000 XAF.
2. Cliquer "💾 Enregistrer".
3. **Attendu** : toast "✓ Unité enregistrée (DB)", tableau rechargé incluant la nouvelle unité.
4. Ouvrir Réservations : "Suite Deluxe" disponible dans le sélecteur de chambres.
5. Vérifier dans `veraluz_units` : ligne présente avec l'UUID généré côté serveur.

---

## C. Modification unité — gérant peut modifier nom/prix/capacité

1. Cliquer ✏️ sur une unité existante.
2. Modifier le prix, cliquer "💾 Enregistrer".
3. **Attendu** : toast succès, tableau reflète le nouveau prix.
4. Dans `veraluz_units` : `price` mis à jour, `updated_at` rafraîchi.
5. Booking Engine : affiche le nouveau prix à la prochaine requête.

---

## D. Suppression — unité supprimée de la DB et absente dans Booking Engine

**Cas sans réservations liées** :
1. Cliquer ✕ sur une unité, confirmer.
2. **Attendu** : toast "✓ Unité supprimée", unité absente du tableau.
3. Vérifier `veraluz_units` : ligne supprimée.
4. Booking Engine : unité absente.

**Cas avec réservations liées** :
1. Tenter de supprimer une unité ayant des réservations dans `veraluz_reservations`.
2. **Attendu** : `catalog-secure` répond `{ok:false, error:'unit_has_reservations'}` HTTP 409.
3. Toast d'erreur côté UI, unité conservée en DB.

---

## E. Manager — upsert/delete rejetés (403)

1. Se connecter avec un compte `manager`.
2. Tenter de créer ou supprimer une unité.
3. **Attendu** : `catalog-secure` répond HTTP 403, toast d'erreur UI.
4. `veraluz_units` inchangé.

---

## F. Cross-device — catalogue identique sur tous les devices (DB canonical)

1. Créer une unité depuis l'appareil A.
2. Ouvrir Paramètres > Catalogue sur l'appareil B (autre navigateur/session).
3. **Attendu** : la nouvelle unité est visible immédiatement (loadCatalogFromDB au chargement).
4. Aucune divergence entre devices — pas de source localStorage locale.

---

## G. DB KO — badge DB KO, bouton Ajouter masqué, mode dégradé affiché

1. Simuler indisponibilité DB (erreur réseau, anon key révoquée).
2. Ouvrir Paramètres > Catalogue.
3. **Attendu** :
   - Badge rouge `DB KO` visible.
   - Bannière mode dégradé.
   - Bouton "+ Ajouter" masqué (`_dbCatalogError` → condition dans renderChambres).
4. **Non attendu** : affichage depuis localStorage.

---

## H. Aucun catalogue dans localStorage

1. Inspecter `localStorage` dans DevTools.
2. **Attendu** : `veraluz_settings_v3.chambres` n'est jamais écrit par le module Paramètres.
3. `_LS_CANONICAL` contient `'chambres'` → `saveAll()` exclut ce namespace.

---

## I. RESERVATIONS ne régresse pas — réservations existantes toujours visibles

1. Ouvrir Réservations avec des réservations existantes en DB.
2. **Attendu** : tableau des réservations inchangé, lecture/écriture `veraluz_reservations` non perturbée.
3. Le sélecteur de chambres continue d'afficher `veraluz_units` (déjà canonical avant ce lot).
4. Aucune régression sur création/modification/annulation de réservation.

---

## J. Booking Engine affiche unités DB correctement

1. Ouvrir le Booking Engine (BOOKING_ENGINE.html).
2. **Attendu** : unités lues depuis `veraluz_units` (inchangé par ce lot), affichage correct.
3. Après création d'une nouvelle unité via Paramètres, recharger Booking Engine : nouvelle unité visible.
