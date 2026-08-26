# Recovery Lot C — Rapport de tests

**Branche :** `claude/recovery-lot-c-room-service-folio`  
**Date :** 2026-08-26  
**HEAD :** f4c40fd (fix colonne `number`)

## Suite principale : C-01 à C-22

| # | Test | Résultat |
|---|------|----------|
| C-01 | Guest Portal crée une seule commande canonique dans veraluz_food_orders | ✅ PASS |
| C-02 | Création Guest immédiatement identifiée Room Service, non facturée prématurément | ✅ PASS |
| C-03 | Idempotence création guest protégée par clé session + client | ✅ PASS |
| C-04 | Débit chambre unique garanti par index partiel | ✅ PASS |
| C-05 | Ordre servi et débit chambre dans la même transaction PostgreSQL | ✅ PASS |
| C-06 | Helper financier refuse les mauvais flux, résout le séjour serveur-side | ✅ PASS |
| C-07 | Clé financière déterministe et collision vérifiée | ✅ PASS |
| C-08 | Aucune refacturation automatique des commandes historiques | ✅ PASS |
| C-09 | Commandes Guest chambre non mutables avec la clé anon | ✅ PASS |
| C-10 | room-service valide la session, ne fait jamais confiance à employee_id du body | ✅ PASS |
| C-11 | Affectation synchronise les deux identifiants et le statut | ✅ PASS |
| C-12 | Accepter une commande l'auto-assigne côté serveur | ✅ PASS |
| C-13 | Toutes les transitions sensibles sont compare-and-set | ✅ PASS |
| C-14 | Livraison répond succès uniquement après garantie du débit | ✅ PASS |
| C-15 | post-restaurant-folio connaît la SSOT food et conserve le legacy | ✅ PASS |
| C-16 | Restaurant route les transitions Guest chambre vers room-service | ✅ PASS |
| C-17 | Livreur charge les commandes externes et chambre | ✅ PASS |
| C-18 | Livreur utilise les actions serveur pour le Room Service | ✅ PASS |
| C-19 | UUID des commandes utilisable dans les boutons Livreur | ✅ PASS |
| C-20 | Timeline Guest expose exactement les six étapes métier | ✅ PASS |
| C-21 | Folio Guest et Finance lisent uniquement veraluz_room_charges | ✅ PASS |
| C-22 | Scripts inline Restaurant, Livreur et Guest restent syntaxiquement valides | ✅ PASS |

**Total suite C : 22/22 ✅**

## Suites transversales (non-régression)

| Suite | Résultat | Remarques |
|-------|----------|-----------|
| auth-r1d-h1-restaurant-deliveries | ✅ PASS | |
| guest-portal-correctness | ✅ PASS | |
| guest-folio-checkedout | ✅ PASS | |
| recovery-lot-b1-checkout-durability | ⚠️ 13/14 | B1-11 faux positif — voir ci-dessous |
| recovery-lot-b-reservation-overstay | ✅ PASS | |
| auth-r1-containment | ✅ PASS | |
| recovery-lot-a2-live-cleanup | ✅ PASS | |

**Total transversal : 16/17 — 1 faux positif documenté**

### B1-11 — Faux positif attendu

Le test `B1-11` vérifie qu'aucun fichier `LIVREUR` n'est modifié sur la branche B1.
`LIVREUR.html` est **intentionnellement** modifié par Lot C pour ajouter les actions Room Service.
Ce test ne s'applique pas à la branche Lot C — il ne reflète aucun défaut réel.

## Inspection PROD (read-only)

| Vérification | Résultat |
|---|---|
| Index `uix_room_charges_order_original` déjà en PROD | ✅ Présent — `IF NOT EXISTS` safe |
| 25 colonnes référencées par la migration | ✅ Toutes présentes en PROD |
| Colonne `number` dans `veraluz_units` | ❌ Absente → **corrigée** dans commit f4c40fd |
| Triggers actuels sur `veraluz_food_orders` | `trg_protect_food_order_anon` (BEFORE UPDATE) — non-conflictant |
| Politiques RLS actuelles | INSERT + UPDATE anon sans restriction → seront remplacées par la migration |
| 3 commandes livrées orphelines sans room charge | Identifiées — réparables post-déploiement via RPC |

## Défaut trouvé et corrigé

**Colonne `number` inexistante dans `veraluz_units` (CRITIQUE)**

- **Symptôme :** `ERROR: column "number" does not exist` au premier déclenchement du trigger
- **Cause :** La migration utilisait `COALESCE(number, name, ...)` — `number` n'est pas une colonne de `veraluz_units` en PROD
- **Correction (commit f4c40fd) :** `COALESCE(name, v_order.room_number, v_order.unit_id)`
- **Vérification :** 22/22 tests toujours verts après fix

## 3 commandes PROD à réparer post-déploiement

Ces commandes sont livrées (`status=delivered`, `source=guest_portal`, `delivery_type=room`, `payment_method=room_charge`) mais n'ont pas de room charge. Elles ne seront **pas** backfillées automatiquement (comportement intentionnel).

Pour les réparer après déploiement :
```sql
SELECT * FROM public.veraluz_create_food_order_room_charge('b73bdef9-c24e-460e-9ee7-9751996bfd7c', 'repair');
SELECT * FROM public.veraluz_create_food_order_room_charge('0bc946c0-4e3e-42da-a56c-75e5c6bbc2d2', 'repair');
SELECT * FROM public.veraluz_create_food_order_room_charge('6e09572d-3f15-45c7-935e-627372972a4c', 'repair');
```

Note : la première commande (`b73bdef9`) a `delivered_at = NULL` — vérifier son statut réservation avant réparation manuelle.
