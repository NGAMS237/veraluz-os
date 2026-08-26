# Recovery Lot C — Plan de déploiement ciblé

**Branche :** `claude/recovery-lot-c-room-service-folio`  
**HEAD :** f4c40fd  
**Auteur plan :** Claude (Cowork) — 2026-08-26  
**Autorisation requise :** Blaise — déploiement PROD interdit sans validation explicite

---

## Objectif

Fermer la brèche entre la commande Room Service Guest Portal et la facturation folio :
chaque commande `guest_portal + room + room_charge` livrée crée automatiquement et atomiquement
un room charge dans `veraluz_room_charges` via trigger PostgreSQL, avec chemin de réparation
via l'Edge Function `room-service` et via `post-restaurant-folio`.

---

## Périmètre des fichiers modifiés

| Fichier | Nature |
|---|---|
| `supabase/migrations/20260826_recovery_lot_c_room_service_folio.sql` | Migration DDL + RLS |
| `supabase/functions/room-service/index.ts` | v3 → v4 (ensureRoomCharge, CAS complet) |
| `supabase/functions/guest-access/index.ts` | v6 — create_restaurant_order + get_my_folio |
| `supabase/functions/post-restaurant-folio/index.ts` | SSOT food_orders + legacy restaurant |
| `LIVREUR.html` | Actions Room Service côté livreur |
| `RESTAURANT_EMBEDDED.html` | Routing transitions Guest chambre → room-service |
| `GUEST_PORTAL.html` | Timeline 6 étapes, folio, suivi commande |

---

## Ordre de déploiement

### Étape 1 — Migration SQL (Supabase dashboard ou CLI)

```bash
supabase db push  # ou apply via dashboard
```

Effets :
- Crée `uix_room_charges_order_original` (index partiel — déjà présent, no-op)
- Crée `veraluz_create_food_order_room_charge()` (SECURITY DEFINER, service_role only)
- Crée `veraluz_food_order_room_charge_trigger()` (SECURITY DEFINER)
- Pose deux triggers AFTER sur `veraluz_food_orders` (INSERT et UPDATE OF status)
- Active RLS sur `veraluz_food_orders` + policies INSERT/UPDATE anon restreintes
- Remplace les policies `food_orders_insert_public` et `food_orders_update_anon` PROD

**Rollback migration :**
```sql
DROP TRIGGER IF EXISTS trg_veraluz_food_order_room_charge_insert ON public.veraluz_food_orders;
DROP TRIGGER IF EXISTS trg_veraluz_food_order_room_charge_update ON public.veraluz_food_orders;
DROP FUNCTION IF EXISTS public.veraluz_food_order_room_charge_trigger();
DROP FUNCTION IF EXISTS public.veraluz_create_food_order_room_charge(uuid, text);
-- Restaurer policies précédentes si nécessaire
ALTER TABLE public.veraluz_food_orders DISABLE ROW LEVEL SECURITY;
```

### Étape 2 — Déployer les Edge Functions (dans l'ordre)

```bash
supabase functions deploy room-service
supabase functions deploy guest-access
supabase functions deploy post-restaurant-folio
```

Pas de dépendances circulaires. L'ordre n'est pas critique mais room-service en premier
(c'est lui qui déclenche la livraison et appelle le RPC).

### Étape 3 — Déployer les fichiers HTML (GitHub Pages)

```bash
git push origin claude/recovery-lot-c-room-service-folio
# Après merge vers main par Blaise :
# git push origin main  → GitHub Actions déploie GitHub Pages
```

### Étape 4 — Réparer les 3 commandes orphelines (post-déploiement)

Exécuter depuis le dashboard Supabase (SQL Editor) **après** la migration :

```sql
-- Vérifier d'abord la réservation de la première commande (delivered_at NULL)
SELECT id, reservation_id, status FROM public.veraluz_food_orders WHERE id = 'b73bdef9-c24e-460e-9ee7-9751996bfd7c';

-- Réparer les 3 commandes livrées sans room charge
SELECT * FROM public.veraluz_create_food_order_room_charge('b73bdef9-c24e-460e-9ee7-9751996bfd7c', 'repair-lot-c');
SELECT * FROM public.veraluz_create_food_order_room_charge('0bc946c0-4e3e-42da-a56c-75e5c6bbc2d2', 'repair-lot-c');
SELECT * FROM public.veraluz_create_food_order_room_charge('6e09572d-3f15-45c7-935e-627372972a4c', 'repair-lot-c');
```

Note : si la réservation de `b73bdef9` n'est plus `checkedin`, la fonction lèvera `reservation_not_checkedin` — dans ce cas, créer le room charge manuellement ou laisser en l'état (séjour terminé).

---

## Tests de fumée post-déploiement

1. Créer une commande Room Service depuis le Guest Portal → vérifier `status=pending` dans `veraluz_food_orders`
2. Faire passer la commande à `delivered` via room-service → vérifier qu'un room charge apparaît dans `veraluz_room_charges`
3. Appeler à nouveau `veraluz_create_food_order_room_charge` → vérifier `idempotent=true`, aucun doublon
4. Ouvrir le folio Guest Portal → vérifier que le room charge est visible sous `get_my_folio`
5. Vérifier que les commandes Food Lounge legacy (non-guest_portal) restent créables via anon

---

## Risques résiduels

| Risque | Mitigation |
|---|---|
| Réservation non-checkedin au moment de la livraison | Trigger lève `reservation_not_checkedin` → commande reste `delivered` sans charge, réparable via RPC |
| Legacy Food Lounge bloqué par RLS | Policies permettent explicitement `NOT (source='guest_portal' AND delivery_type='room')` — testé |
| Double débit concurrent | Unique index partiel + ON CONFLICT DO NOTHING + vérification post-insert garantissent l'idempotence |
| `trg_protect_food_order_anon` (BEFORE) en conflit | BEFORE s'exécute avant AFTER — aucun conflit de séquençage |

---

## Décision finale

**READY FOR TARGETED DEPLOYMENT : OUI ✅**

Sous réserve d'autorisation explicite de Blaise.  
NE PAS MERGER main. NE PAS DÉPLOYER sans autorisation.
