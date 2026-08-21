# CATALOG-SSOT-1 — Tests de recette (v2 — review fixes)

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
2. Renseigner `amenities` = `["clim","tv","wifi","terrasse"]` (tableau JSON).
3. Cliquer "💾 Enregistrer".
4. **Attendu** : toast "✓ Unité enregistrée (DB)", tableau rechargé incluant la nouvelle unité.
5. Ouvrir Réservations : "Suite Deluxe" disponible dans le sélecteur de chambres.
6. Vérifier dans `veraluz_units` : ligne présente avec l'UUID généré côté serveur.

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
   - FK vérifiée : `.eq('unit_id', unitId)` (colonne réelle — pas `room_id`).
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
4. **Import JSON** : importer un ancien JSON contenant `"chambres":[...]` — `importSettings()` filtre
   ce champ via `_LS_CANONICAL` avant écriture localStorage. La clé `chambres` n'apparaît pas dans LS.

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

---

## K. amenities — JSONB array conservé (STATIC CHECK + runtime)

**Static** : inspecter `catalog-secure/index.ts` v2 :
- `UNIT_ALLOWED_STATUSES` = `{'active','maintenance','out_of_service'}` (absent : `occupied`).
- Payload amenities : `amenities = Array.isArray(unit.amenities) ? unit.amenities : []`
  → jamais `typeof unit.amenities === 'string' ? unit.amenities : ''` (ancien code — bug v1).
- Validation : si `amenities` non-array ET non-null → HTTP 400 `invalid_field_value`.

**Runtime** :
1. Créer une unité avec `amenities = ["clim","tv","wifi"]`.
2. Récupérer via `get_catalog` — `amenities` doit être un tableau `["clim","tv","wifi"]`, pas une chaîne.
3. **Non attendu** : `"clim,tv,wifi"` ou `""`.

---

## L. Statuts catalogue : active / maintenance / out_of_service seulement

**Static** : `UNIT_ALLOWED_STATUSES` = `new Set(['active','maintenance','out_of_service'])`.

**Runtime** :
1. Tenter de créer une unité avec `status='occupied'` → HTTP 400 `invalid_field_value` attendu.
2. Tenter `status='available'` → HTTP 400 `invalid_field_value` attendu.
3. `status='active'` → HTTP 200 attendu.
4. `status='maintenance'` → HTTP 200 attendu.
5. `status='out_of_service'` → HTTP 200 attendu.

**Note** : "Disponible/Occupée" sont des états opérationnels dérivés des réservations — jamais stockés dans le catalogue.

---

## M. delete utilise unit_id — FK correcte (STATIC CHECK)

**Static** : inspecter `catalog-secure/index.ts` v2 ligne `delete_unit` :
```
.eq('unit_id', unitId)   ← FK correcte
```
**Non attendu** : `.eq('room_id', unitId)` (bug v1 — corrigé v2).

**Runtime** :
1. Créer une réservation sur une unité existante dans `veraluz_reservations.unit_id`.
2. Tenter de supprimer l'unité via catalog-secure.
3. **Attendu** : HTTP 409 `unit_has_reservations`.
4. Si count query échoue (DB inaccessible) → HTTP 500 `reservation_check_failed`, delete bloqué.
