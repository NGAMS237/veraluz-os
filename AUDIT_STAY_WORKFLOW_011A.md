# AUDIT STAY WORKFLOW — PROMPT 011A
**Projet :** Résidence Veraluz — Kribi, Cameroun  
**Date :** 2026-08-12  
**Repo :** NGAMS237/veraluz-os  
**Supabase :** dfdmasejsoibxrvubegu  
**Périmètre :** Réservations · Booking Engine · Food & Room Service · Restaurant · Messages · Paramètres  

---

## 1. ÉTAT GLOBAL — CARTOGRAPHIE REAL / PARTIAL / MOCK / LOCALSTORAGE

| Module | Statut | Table(s) Supabase | Notes |
|--------|--------|-------------------|-------|
| RESERVATIONS_EMBEDDED | **REAL** | `veraluz_reservations`, `veraluz_units`, `veraluz_clients`, `veraluz_payments`, `veraluz_photos` | CRUD complet, REST direct |
| BOOKING_ENGINE | **PARTIAL** | `veraluz_units`, `veraluz_reservations` (INSERT seulement) | Lit les unités, crée réservation — **pas de vérif dispo** |
| FOOD_LOUNGE | **PARTIAL** | `veraluz_food_orders`, `veraluz_restaurant_products` | Commandes réelles, room_number texte sans FK |
| RESTAURANT_EMBEDDED | **REAL** | `veraluz_food_orders`, `veraluz_restaurant_products`, `veraluz_restaurant_order_items`, `veraluz_reservations`, `veraluz_room_charges`, `veraluz_employees` | Gestion complète KDS + room charges |
| MESSAGES_EMBEDDED | **PARTIAL** | `veraluz_internal_messages` | Réel + fallback mock si 0 résultats RLS |
| SETTINGS_EMBEDDED | **LOCALSTORAGE** | *(aucune)* | 100% `veraluz_settings_v3` localStorage, jamais synchronisé Supabase |
| NOTIFICATIONS_EMBEDDED | **REAL** | `veraluz_notifications`, `veraluz_alert_rules` | Polling actif via Supabase REST |

---

## 2. RÉSERVATIONS (RESERVATIONS_EMBEDDED.html)

### 2.1 Schéma DB utilisé

```
veraluz_reservations (id TEXT PK, unit_id→veraluz_units, client_id→veraluz_clients,
  client_name, client_phone, client_email, check_in DATE, check_out DATE,
  guests INT, nights INT, total NUMERIC, paid NUMERIC,
  status CHECK(pending|confirmed|checkedin|checkedout|cancelled),
  source, notes, created_at, updated_at)
```

### 2.2 Patterns d'accès

- **Lecture :** `veraluz_reservations?select=*&order=created_at.desc&limit=200` (REST direct anon)
- **Disponibilité :** convention `[check_in, check_out)` — `r.check_in <= d && r.check_out > d` ✅
- **Statuts bloquants :** `checkedin | confirmed` (confirmed uniquement si `check_in === today`)
- **Check-in :** PATCH `status=checkedin` + localStorage `vlz_hk_checkin`
- **Checkout :** PATCH `status=checkedout`
- **Communications :** `window.parent.postMessage` → WhatsApp / email via CORE
- **Paiements :** `veraluz_payments` — INSERT avec `reservation_id`, `amount`, `method`, `proof_url`

### 2.3 GAP — Statut `no_show`

**PROBLÈME :** Le frontend RESERVATIONS_EMBEDDED affiche et utilise le statut `no_show` (bouton "Absent") mais la contrainte DB est :
```sql
CHECK (status IN ('pending','confirmed','checkedin','checkedout','cancelled'))
```
Un PATCH `status=no_show` **échoue silencieusement** — la réservation reste dans son statut précédent sans erreur visible.

**Fix P0 :**
```sql
ALTER TABLE veraluz_reservations 
  DROP CONSTRAINT IF EXISTS veraluz_reservations_status_check;
ALTER TABLE veraluz_reservations 
  ADD CONSTRAINT veraluz_reservations_status_check 
  CHECK (status IN ('pending','confirmed','checkedin','checkedout','cancelled','no_show'));
```

---

## 3. BOOKING ENGINE (BOOKING_ENGINE.html)

### 3.1 Flux actuel

```
1. GET veraluz_units?select=*&order=price.asc,id.asc
2. Filtre frontend: status === 'active' || status === 'available'  ← seul filtre
3. POST veraluz_reservations { unit_id, client_name, check_in, check_out, status:'pending' }
```

### 3.2 GAP CRITIQUE — Zéro protection contre le double booking

Le Booking Engine ne consulte **jamais** `veraluz_reservations` avant de créer une réservation. Un client peut réserver une unité déjà occupée. Il n'existe pas non plus de contrainte DB d'exclusion :

**Fix P0 — Double protection :**

**A) Contrainte DB (exclusion d'overlap) :**
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE veraluz_reservations
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled','no_show','checkedout'));
```

**B) Vérification côté Booking Engine (avant INSERT) :**
```js
async function checkAvailability(unitId, checkIn, checkOut) {
  var res = await sbFetch(
    'veraluz_reservations?unit_id=eq.'+unitId
    +'&status=in.(pending,confirmed,checkedin)'
    +'&check_in=lt.'+checkOut
    +'&check_out=gt.'+checkIn
    +'&select=id&limit=1'
  );
  return res.length === 0; // true = disponible
}
```

---

## 4. FOOD LOUNGE (FOOD_LOUNGE.html)

### 4.1 Produits

| Source | Statut |
|--------|--------|
| `veraluz_restaurant_products` | **REAL** — fetch au boot, fallback hardcodé si erreur réseau |

### 4.2 Payload INSERT dans `veraluz_food_orders`

```js
{
  order_number, customer_name, customer_phone,
  delivery_type,          // 'room' | 'delivery' | 'pickup' | 'on_site'
  room_number: text,      // texte libre "12" ou "Studio Horizon" — AUCUN FK
  address, delivery_lat, delivery_lng, delivery_zone,
  notes, payment_method, payment_status,
  items: JSON.stringify(_cart),  // TEXTE — pas JSONB
  subtotal, delivery_fee, total,
  status: 'pending', source: 'food-lounge'
  // ❌ PAS de reservation_id
  // ❌ PAS de client_id
  // ❌ PAS de unit_id
}
```

### 4.3 GAP CRITIQUE — Room Service non lié aux séjours

Quand un client commande en mode `room_service`, seul un `room_number` texte est transmis. Il n'y a aucun lien FK vers `veraluz_reservations` ni `veraluz_units`. La commande ne peut pas être automatiquement imputée au séjour.

**Fix P1 — SQL :**
```sql
ALTER TABLE veraluz_food_orders
  ADD COLUMN IF NOT EXISTS reservation_id TEXT REFERENCES veraluz_reservations(id),
  ADD COLUMN IF NOT EXISTS unit_id TEXT REFERENCES veraluz_units(id),
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES veraluz_clients(id);

-- Convertir items TEXT → JSONB
ALTER TABLE veraluz_food_orders 
  ALTER COLUMN items TYPE JSONB USING items::jsonb;
```

**Fix P1 — FOOD_LOUNGE.html (lookup avant INSERT) :**
```js
// Mode room_service : résoudre reservation depuis l'unité
if (_svc === 'room' && g('co-room')) {
  var unitName = g('co-room');
  var found = await sbFetch(
    'veraluz_reservations?status=in.(checkedin,confirmed)'
    +'&unit_id=eq.'+encodeURIComponent(unitName)
    +'&select=id,client_id&limit=1'
  );
  if (found[0]) {
    order.reservation_id = found[0].id;
    order.client_id = found[0].client_id;
  }
}
```

### 4.4 Persistance locale

- Cart : `localStorage vlz_food_cart`
- Historique : `localStorage vlz_food_orders` (20 dernières — non authoritatives)
- ID Supabase : `localStorage vlz_food_sb_id_{num}` (après INSERT réussi)
- Retry automatique : 3 tentatives, 3s d'intervalle ✅

---

## 5. RESTAURANT (RESTAURANT_EMBEDDED.html)

### 5.1 Sources de données

| Données | Source | Statut |
|---------|--------|--------|
| Produits menu | `veraluz_restaurant_products` | **REAL** |
| Commandes Food | `veraluz_food_orders` | **REAL** |
| Items de commande | `veraluz_restaurant_order_items` | **REAL** |
| Résidents actifs | `veraluz_reservations?status=eq.checkedin` | **REAL** |
| Room charges en cours | `veraluz_room_charges?settled=eq.false` | **REAL** |
| Livreurs | `veraluz_employees?role=eq.livreur` | **REAL** |

### 5.2 Room Service côté Restaurant — FONCTIONNE ✅

```js
// Sélection du résident dans la liste des checkedin
// Crée room_charge avec tous les liens:
POST veraluz_room_charges {
  reservation_id: _gid,           // ← lien séjour ✅
  unit_id: g.unit_id,             // ← lien unité ✅
  client_name: g.client_name,
  room_name: 'Chambre ' + g.unit_id,
  amount, description,
  charge_type: 'restaurant',
  restaurant_order_id: orderId    // ← lien commande ✅
}
```

Ce flux fonctionne mais est **entièrement manuel** — l'agent restaurant doit sélectionner le résident et imputer. Aucune liaison automatique quand la commande vient de Food Lounge.

### 5.3 KDS

- Statuts : `pending → preparing → ready → served` (sur place), `pending → picked_up → delivered` (livraison)
- Audio WebAudio persistant entre réloads ✅
- Polling 30s sur `veraluz_food_orders` ✅

### 5.4 GAP — `veraluz_restaurant_order_items` peu alimentée

La table existe mais les items détaillés sont principalement dans `veraluz_food_orders.items` (TEXT/JSON). Seul le POS interne Restaurant alimente systématiquement `veraluz_restaurant_order_items`.

---

## 6. MESSAGES (MESSAGES_EMBEDDED.html)

### 6.1 Table : `veraluz_internal_messages`

Accès : `sbQ('veraluz_internal_messages?tenant_id=eq.{TENANT}&order=created_at.desc&limit=80')`

Auth : lit `veraluz_session` (localStorage) → fallback `veraluz_auth_v1`

### 6.2 GAP — Fallback mock silencieux

```js
if (!msgs.length && _currentFolder === 'inbox') {
  msgs = getMockMsgs();  // données fictives sans avertissement
}
```

L'opérateur voit des messages fictifs sans savoir que la DB n'a rien retourné (RLS/auth silencieux).

**Fix P2 :** Afficher un bandeau `⚠ Mode démo — données non synchronisées` quand mock est actif.

### 6.3 Droits

- `canActorSeeMessage(actor, msg)` — filtrage frontend par rôle/destinataire
- `can_view_all_messages` — flag direction/admin
- Filtrage appliqué même sur mock data ✅

---

## 7. PARAMÈTRES (SETTINGS_EMBEDDED.html)

### 7.1 ⚠ ISOLATION COMPLÈTE DE SUPABASE

**SETTINGS_EMBEDDED ne se connecte jamais à Supabase.** Seul `emailjs.com` est appelé (envoi email). Tout le reste est localStorage `veraluz_settings_v3`.

| Donnée | Stockage | Synchronisé DB |
|--------|----------|---------------|
| Infos propriété | localStorage | ❌ |
| Heures check-in / check-out | localStorage | ❌ |
| WiFi, codes accès | localStorage | ❌ |
| Heures restaurant | localStorage | ❌ |
| Logo, couleurs marque | localStorage | ❌ |
| Templates email | localStorage | ❌ |
| Unités (prix, capacité) | **HARDCODÉ** (5 types) | ❌ |
| Comptes paiement MTN/Orange | localStorage | ❌ |

La table Supabase `veraluz_settings` (clés: admin, branding, contact, email, invoice, payment_accounts, payment_api, property) **n'est jamais lue ni écrite** par SETTINGS_EMBEDDED.

### 7.2 Unités hardcodées — ne reflètent pas la DB

```js
// MOCK dans SETTINGS (ne correspond pas à veraluz_units) :
{id:'std',  name:'Chambre Standard',     count:5, price:75000}
{id:'apt',  name:'Appartement 2 ch.',   count:1, price:120000}
{id:'stua', name:'Studio A',            count:1, price:90000}
{id:'stub', name:'Studio B',            count:1, price:90000}
{id:'suite',name:'Suite Présidentielle',count:1, price:250000}
```

Les 11 unités réelles dans `veraluz_units` (dont 2 en maintenance) ne sont pas gérables via SETTINGS.

---

## 8. PHOTOS DES UNITÉS — DOUBLE STOCKAGE

| Champ | Table/Colonne | Format |
|-------|---------------|--------|
| Photo principale | `veraluz_units.cover_image` | TEXT (URL) |
| Galerie inline | `veraluz_units.images` | JSONB array |
| Galerie dédiée | `veraluz_photos` (table séparée) | rows: id, unit_id, url, caption, sort_order |

Deux systèmes coexistent sans sync. `veraluz_photos` est orpheline — aucune UI ne la gère activement. RESERVATIONS_EMBEDDED lit `cover_image` et `.images`.

---

## 9. COMMUNICATIONS

| Canal | Mécanisme | Statut |
|-------|-----------|--------|
| WhatsApp | `window.open(wa.me/...)` postMessage RESERVATIONS→CORE | **FONCTIONNEL** |
| Email | EmailJS (clé API dans SETTINGS localStorage) | **FONCTIONNEL** si configuré |
| SMS | Non implémenté | ❌ |
| Push interne | `veraluz_notifications` polling | **FONCTIONNEL** |

**GAP :** Aucun trigger automatique sur transition de statut réservation (check-in, checkout, confirmation). Tout est manuel via les boutons de RESERVATIONS_EMBEDDED.

---

## 10. SYNTHÈSE DES GAPS

### P0 — Bloquants opérationnels

| # | Problème | Impact |
|---|----------|--------|
| P0-1 | **Double booking** — BOOKING_ENGINE sans vérif dispo + aucune contrainte DB | Deux clients peuvent réserver la même unité la même nuit |
| P0-2 | **Statut `no_show`** rejeté par CHECK constraint DB | Le bouton "Absent" échoue silencieusement |

### P1 — Cohérence données

| # | Problème | Impact |
|---|----------|--------|
| P1-1 | **Room Service sans FK** — commandes Food non liées aux séjours | Folio résident incomplet, imputation manuelle obligatoire |
| P1-2 | **`items` en TEXT** dans `veraluz_food_orders` | Pas de requêtes SQL sur les items (reporting, agrégats) |
| P1-3 | **SETTINGS isolé de Supabase** | Paramètres différents selon l'appareil, perte des config au changement de browser |
| P1-4 | **Unités hardcodées dans SETTINGS** | Gestion des prix/statuts/photos impossible depuis l'interface |

### P2 — Qualité et UX

| # | Problème |
|---|----------|
| P2-1 | Messages : fallback mock silencieux sans avertissement |
| P2-2 | Double stockage photos (veraluz_photos + images jsonb) |
| P2-3 | Pas de communication automatique sur transitions de statut |
| P2-4 | `veraluz_restaurant_order_items` peu alimentée depuis Food Lounge |

---

## 11. CE QUI FONCTIONNE BIEN ✅

- Convention disponibilité `[check_in, check_out)` correcte dans RESERVATIONS_EMBEDDED
- Room charges côté Restaurant : `reservation_id` + `unit_id` + `restaurant_order_id` présents → folio manuel possible
- KDS Restaurant complet : statuts, audio, livreur assignment, tracking delivery
- Paiements avec `proof_url` et `validated_by` → audit trail complet
- Food Lounge : retry automatique 3× sur INSERT Supabase
- Alertes temps réel : polling + WebAudio + postMessage cross-module
- Messages : `veraluz_internal_messages` opérationnel avec filtrage rôle/tenant

---

## 12. ORDRE D'EXÉCUTION RECOMMANDÉ

```
Sprint A — P0 (1 session SQL + BOOKING_ENGINE) :
  1. SQL: ADD no_show au CHECK constraint veraluz_reservations
  2. SQL: CREATE EXTENSION btree_gist + EXCLUDE constraint anti double-booking
  3. BOOKING_ENGINE: vérif disponibilité avant INSERT réservation

Sprint B — P1 Room Service (1 session) :
  4. SQL: ALTER veraluz_food_orders ADD reservation_id/unit_id/client_id, items→JSONB
  5. FOOD_LOUNGE: lookup reservation_id au checkout room_service
  6. RESTAURANT: auto-link food order → room_charge à la facturation chambre

Sprint C — P1 Settings (2 sessions) :
  7. SETTINGS: connecter à veraluz_settings Supabase (read/write)
  8. SETTINGS: UI gestion veraluz_units (prix, statut, cover_image)

Sprint D — P2 (1 session) :
  9. MESSAGES: bandeau mode démo si mock actif
  10. Photos: unifier sur veraluz_photos
```

---

*Audit généré par Claude (Anthropic) — veraluz-os PROMPT 011A — 2026-08-12*
