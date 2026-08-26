import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const guestAccess = read('supabase/functions/guest-access/index.ts');
const roomService = read('supabase/functions/room-service/index.ts');
const postFolio = read('supabase/functions/post-restaurant-folio/index.ts');
const migration = read('supabase/migrations/20260826_recovery_lot_c_room_service_folio.sql');
const portal = read('GUEST_PORTAL.html');
const restaurant = read('RESTAURANT_EMBEDDED.html');
const livreur = read('LIVREUR.html');
const finance = read('FINANCE_EMBEDDED.html');

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
}

test('C-01 Guest Portal crée une seule commande canonique dans veraluz_food_orders', () => {
  const create = block(guestAccess, "if (action === 'create_restaurant_order')", '// GET_MY_RESTAURANT_ORDERS');
  assert.match(create, /\.from\('veraluz_food_orders'\)/);
  assert.match(create, /delivery_type:\s*'room'/);
  assert.match(create, /source:\s*'guest_portal'/);
  assert.match(create, /reservation_id:\s*session!\.reservation_id/);
  assert.match(create, /unit_id:\s*session!\.unit_id/);
  assert.match(create, /order_id:\s*newOrder!\.id/);
  assert.doesNotMatch(create, /\.from\('veraluz_restaurant_orders'\)/);
});

test('C-02 création Guest immédiatement identifiée Room Service et non facturée prématurément', () => {
  assert.match(guestAccess, /delivery_type:\s*'room'[\s\S]*room_service_status:\s*'unassigned'/);
  assert.match(guestAccess, /folio_ready:\s*false/);
  assert.match(guestAccess, /room_charge_status:\s*'pending_delivery'/);
});

test('C-03 idempotence création guest protégée par clé session + client', () => {
  assert.match(guestAccess, /\.eq\('guest_session_id', session!\.id\)[\s\S]*\.eq\('client_order_key', clientOrderKey\)/);
  assert.match(guestAccess, /insErr\.code === '23505'/);
});

test('C-04 débit chambre unique garanti par index partiel', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uix_room_charges_order_original/);
  assert.match(migration, /WHERE restaurant_order_id IS NOT NULL[\s\S]*reversal_of_charge_id IS NULL/);
});

test('C-05 ordre servi et débit chambre appartiennent à la même transaction PostgreSQL', () => {
  assert.match(migration, /AFTER UPDATE OF status ON public\.veraluz_food_orders/);
  assert.match(migration, /NEW\.status = 'delivered'/);
  assert.match(migration, /PERFORM public\.veraluz_create_food_order_room_charge/);
  assert.match(migration, /RAISE EXCEPTION[\s\S]*room_charge_not_guaranteed/);
});

test('C-06 le helper financier refuse les mauvais flux et résout le séjour serveur-side', () => {
  assert.match(migration, /v_order\.source IS DISTINCT FROM 'guest_portal'/);
  assert.match(migration, /v_order\.delivery_type IS DISTINCT FROM 'room'/);
  assert.match(migration, /v_order\.payment_method IS DISTINCT FROM 'room_charge'/);
  assert.match(migration, /v_reservation\.status IS DISTINCT FROM 'checkedin'/);
  assert.match(migration, /v_reservation\.unit_id IS DISTINCT FROM v_order\.unit_id/);
});

test('C-07 clé financière déterministe et collision vérifiée', () => {
  assert.match(migration, /'food-order-' \|\| v_order\.id::text/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
  assert.match(migration, /room_charge_collision/);
  assert.match(migration, /v_charge\.amount IS DISTINCT FROM COALESCE\(v_order\.total, 0\)::numeric/);
});

test('C-08 aucune refacturation automatique des commandes historiques', () => {
  assert.match(migration, /intentionally does not backfill historical delivered orders/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.veraluz_food_orders\s+SET\s+status\s*=\s*'delivered'/i);
});

test('C-09 les commandes Guest chambre ne sont plus mutables avec la clé anon', () => {
  assert.match(migration, /DROP POLICY IF EXISTS food_orders_update_anon/);
  assert.match(migration, /COALESCE\(source, ''\) = 'guest_portal'[\s\S]*delivery_type = 'room'/);
});

test('C-10 room-service valide la session et ne fait jamais confiance à employee_id du body', () => {
  assert.match(roomService, /validateEmployeeSession\(db, token\)/);
  assert.match(roomService, /const actor = await validateEmployeeSession/);
  assert.doesNotMatch(roomService, /body\.employee_id/);
});

test('C-11 affectation synchronise les deux identifiants et le statut', () => {
  const assign = block(roomService, "if (action === 'assign_room_service')", "if (action === 'claim_room_service')");
  assert.match(assign, /room_service_employee_id:\s*targetId/);
  assert.match(assign, /livreur_id:\s*targetId/);
  assert.match(assign, /delivery_status:\s*'assigned'/);
  assert.match(assign, /room_service_status:\s*'assigned'/);
  assert.match(assign, /employee_not_on_duty/);
});

test('C-12 Accepter une commande chambre l’auto-assigne côté serveur', () => {
  const claim = block(roomService, "if (action === 'claim_room_service')", "if (order.room_service_employee_id !== actor.employeeId");
  assert.match(claim, /room_service_employee_id:\s*actor\.employeeId/);
  assert.match(claim, /livreur_id:\s*actor\.employeeId/);
  assert.match(claim, /delivery_status:\s*'accepted_by_driver'/);
  assert.match(claim, /room_service_status:\s*'accepted'/);
});

test('C-13 toutes les transitions sensibles sont compare-and-set', () => {
  assert.match(roomService, /async function cas/);
  assert.match(roomService, /query = value === null \? query\.is\(key, null\) : query\.eq\(key, value\)/);
  for (const action of ['advance_room_order', 'assign_room_service', 'claim_room_service', 'accept_room_service', 'pickup_room_service', 'depart_room_service', 'arrive_room_service', 'deliver_room_service']) {
    assert.match(roomService, new RegExp(`action === '${action}'`));
  }
});

test('C-14 livraison ne répond succès qu’après garantie du débit', () => {
  const deliver = block(roomService, "if (action === 'deliver_room_service')", "return json({ ok: false, error: 'unknown_action' }");
  assert.match(deliver, /status:\s*'delivered'/);
  assert.match(deliver, /payment_status:\s*'charged'/);
  assert.match(deliver, /charge:\s*await ensureRoomCharge/);
  assert.match(deliver, /idempotent:\s*true/);
});

test('C-15 post-restaurant-folio connaît la SSOT food et conserve le legacy restaurant', () => {
  const foodPos = postFolio.indexOf(".from('veraluz_food_orders')");
  const legacyPos = postFolio.indexOf(".from('veraluz_restaurant_orders')");
  assert.ok(foodPos >= 0 && legacyPos > foodPos);
  assert.match(postFolio, /\.rpc\([\s\S]*'veraluz_create_food_order_room_charge'/);
  assert.match(postFolio, /order_source:\s*'veraluz_food_orders'/);
});

test('C-16 Restaurant route les transitions Guest chambre vers room-service', () => {
  const update = block(restaurant, 'function kdsFoodUpd', '/* Assign deliverer');
  assert.match(update, /currentOrder\.source==='guest_portal'/);
  assert.match(update, /currentOrder\.delivery_type==='room'/);
  assert.match(update, /veraluzSecureRequest\('room-service'/);
  assert.match(update, /action:'advance_room_order'/);
});

test('C-17 Livreur charge les commandes externes et chambre', () => {
  assert.match(livreur, /delivery_type=in\.\(delivery,room\)/);
  assert.match(livreur, /room_service_employee_id/);
  assert.match(livreur, /isUnassignedReady[\s\S]*o\.delivery_type === 'room'/);
});

test('C-18 Livreur utilise les actions serveur pour le Room Service', () => {
  const deliveryStep = block(livreur, 'function doDeliveryStep', 'function logDeliveryEvent');
  assert.match(deliveryStep, /o&&o\.delivery_type==='room'/);
  assert.match(deliveryStep, /accept:'claim_room_service'/);
  assert.match(deliveryStep, /pickup:'pickup_room_service'/);
  assert.match(deliveryStep, /depart:'depart_room_service'/);
  assert.match(deliveryStep, /arrive:'arrive_room_service'/);
  assert.match(livreur, /roomServiceSecure\('deliver_room_service'/);
});

test('C-19 UUID des commandes utilisable dans les boutons Livreur', () => {
  assert.match(livreur, /data-oid="'\+escH\(String\(o\.id\)\)\+'" onclick="openMsgMod\(this\.dataset\.oid\)"/);
  assert.match(livreur, /onclick="confirmDeliveryPrompt\(this\.dataset\.oid,this\)"/);
  assert.doesNotMatch(livreur, /openPhotoMod\('\+oid\+'\)/);
});

test('C-20 timeline Guest expose exactement les six étapes métier', () => {
  const timeline = block(portal, 'var TIMELINE_STEPS_RS=', '/* mapping status food_order');
  for (const label of ['Reçue', 'En préparation', 'Prête', 'Prise en charge', 'En route', 'Servie']) {
    assert.ok(timeline.includes(label), `étape manquante: ${label}`);
  }
  assert.equal((timeline.match(/label:/g) || []).length, 6);
});

test('C-21 Folio Guest et Finance lisent uniquement veraluz_room_charges', () => {
  const folio = block(guestAccess, "if (action === 'get_my_folio')", "return json({ error: 'unknown_action'");
  assert.match(folio, /\.from\('veraluz_room_charges'\)/);
  assert.doesNotMatch(folio, /\.from\('veraluz_food_orders'\)/);
  assert.match(finance, /veraluz_room_charges\?select=\*&charge_type=eq\.restaurant/);
});

test('C-22 scripts inline Restaurant, Livreur et Guest restent syntaxiquement valides', () => {
  for (const [name, source] of [['Restaurant', restaurant], ['Livreur', livreur], ['Guest', portal]]) {
    const errors = [];
    const valid = [...source.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
      try { new vm.Script(match[1], { filename: name }); return true; }
      catch (error) { errors.push(error.stack || error.message); return false; }
    });
    assert.ok(valid, errors.join('\n'));
  }
});
