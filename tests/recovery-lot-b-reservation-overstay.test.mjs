import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const reservations = read('RESERVATIONS_EMBEDDED.html');
const booking = read('BOOKING_ENGINE.html');
const analytics = read('ANALYTICS_EMBEDDED.html');
const housekeeping = read('HOUSEKEEPING_EMBEDDED.html');
const guest = read('GUEST_PORTAL.html');
const guestAccess = read('supabase/functions/guest-access/index.ts');
const workflow = read('supabase/functions/reservation-workflow/index.ts');
const migration = read('supabase/migrations/20260824_recovery_lot_b_booking_overstay_guard.sql');

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) { console.log(`  PASS ${name}`); passed += 1; }
  else { console.log(`  FAIL ${name}`); failed += 1; }
}

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

function inlineScriptsParse(source, label) {
  const blocks = [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  return blocks.every(([, attrs, code]) => {
    if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["'](?:application\/json|importmap)/i.test(attrs)) return true;
    try { new Function(code); return true; }
    catch (error) { console.error(`    Syntax error in ${label}: ${error.message}`); return false; }
  });
}

const planning = fnSource(reservations, 'renderPlanning');
const occupiesDay = fnSource(reservations, 'reservationOccupiesPlanningDay');
const availability = fnSource(reservations, 'isUnitAvailable');
const overstay = fnSource(reservations, 'isReservationOverstay');
const lifecycleSettings = fnSource(reservations, 'loadLifecycleSettings');
const propertyClock = fnSource(reservations, 'propertyClock');
const bookingOverlap = fnSource(booking, 'hasRangeOverlap');
const bookingBlocked = fnSource(booking, 'loadBlockedDates');
const dashboard = fnSource(reservations, 'renderDash');
const computeRooms = fnSource(analytics, 'computeRooms');
const hkSync = fnSource(housekeeping, 'syncWithReservations');
const checkout = fnSource(reservations, 'doCheckOut');
const validateGuestToken = fnSource(guestAccess, 'validateGuestToken');

test('B01 confirmed future visible', planning.includes("!['cancelled','no_show'].includes(r.status)") && occupiesDay.includes('r.check_out>day'));
test('B02 confirmed aujourd’hui ne devient pas checkedin automatiquement', !/check_in\s*<=?\s*today[\s\S]{0,120}status\s*=\s*['"]checkedin/.test(reservations));
test('B03 checkedin avant départ visible Planning', occupiesDay.includes('if(isCheckedInReservation(r)) return true'));
test('B04 checkedin après départ prévu reste visible', planning.includes('planningReservationForDay(activeRez,room.id,d)') && !planning.includes('r.check_out>d'));
test('B05 checkedin overstay garde status checkedin', overstay.includes('isCheckedInReservation(r)') && !/status\s*=/.test(overstay));
test('B06 UI dérive overstay correctement', reservations.includes('Séjours dépassés') && reservations.includes('Séjour dépassé · ') && reservations.includes('overstayDurationLabel'));
test('B07 overstay unité reste occupée', availability.includes('if(isCheckedInReservation(r)) return true'));
test('B08 nouvelle réservation incompatible refusée', migration.includes("status in ('checkedin', 'checked_in')") && migration.includes("'availability_conflict'") && migration.includes('veraluz_reservations_one_checkedin_per_unit_idx'));
test('B09 Dashboard compte overstay occupé', dashboard.includes("r._dynStatus==='occupied'") && computeRooms.includes("['checkedin','checked_in'].includes(r.status)") && !computeRooms.includes('r.check_out > today'));
test('B10 Guest Portal reste actif si checkedin overstay', validateGuestToken.includes("['confirmed','checkedin']") && !validateGuestToken.includes('check_out'));
test('B11 Wi-Fi reste conditionné à checkedin, pas date', /const canSeePassword\s+= resStatus === 'checkedin'/.test(guestAccess) && !/check_out[\s\S]{0,100}canSeePassword/.test(fnSource(guestAccess, 'loadSettings')));
test('B12 aucune housekeeping tâche créée par date seule', hkSync.includes("(r.status==='checkedout'||r.status==='checked_out') && r.check_out===todayStr") && !/checkedin[^\n]*ensureCleaningTask/.test(hkSync));
test('B13 aucun guest_checked_out event par date seule', !/check_out\s*[<>=]+[\s\S]{0,160}guest_checked_out/.test([reservations, workflow, guestAccess].join('\n')));
test('B14 checkout staff → checkedout', workflow.includes('checkout: "checkedout"') && workflow.includes('checkout: ["checkedin"]'));
test('B15 checkout staff libère unité', checkout.includes("r.status='checkedout'") && reservations.includes("room._dynStatus='cleaning'"));
test('B16 checkout crée événement une seule fois', workflow.includes('.eq("status", rez.status)') && checkout.includes("if(d.transitioned===false){ refresh();"));
test('B17 double checkout idempotent/refusé proprement', workflow.includes('idempotent: true') && workflow.includes('transitioned: false') && workflow.includes('transition_conflict'));
test('B18 refresh Planning conserve overstay', reservations.includes('loadAll(function(){ enrichStatuses(); refresh(); checkBkSync(); })') && planning.includes('planningReservationForDay'));
test('B19 lendemain suivant conserve overstay', occupiesDay.includes('if(isCheckedInReservation(r)) return true') && !occupiesDay.includes('todayStr'));
test('B20 Historique n’absorbe pas checkedin overstay', !/check_out\s*<\s*today[\s\S]{0,120}(?:history|historique|checkedout)/i.test(reservations));
test('B21 aucune constante checkout 11:00/15:00 nouvelle', !lifecycleSettings.includes("'11:00'") && !lifecycleSettings.includes("'15:00'"));
test('B22 settings checkout_time utilisé si disponible', lifecycleSettings.includes('get_public_booking_settings') && lifecycleSettings.includes('cfg.checkout_time'));
test('B23 réservation normal checkedout fonctionne toujours', workflow.includes('checkout: ["checkedin"]') && workflow.includes('checkout: "checkedout"'));
test('B24 cancelled continue de fonctionner', /cancel:\s+\["pending", "confirmed"\]/.test(workflow) && /cancel:\s+"cancelled"/.test(workflow));
test('B25 consommateurs et sécurité Lot A préservés', booking.includes("status=in.(confirmed,checkedin,checked_in,pending)") && hkSync.includes("r.status==='checkedin'||r.status==='checked_in'") && !/veraluz_(?:employees|payroll|pointages|employee_checkins)/.test(migration));

test('B-SQL RPC conserve verrou transactionnel et signature canonique', migration.includes('pg_advisory_xact_lock') && migration.includes('create or replace function public.create_booking_hold('));
test('B-SQL fonction SECURITY DEFINER fixe search_path', migration.includes('security definer') && migration.includes("set search_path = ''") && migration.includes('public.veraluz_reservations'));
test('B-BOOKING frontend bloque tout checkedin indépendamment des dates', bookingOverlap.includes("b.status==='checkedin'||b.status==='checked_in'") && bookingOverlap.includes('return true'));
test('B-CHECKOUT frontend bloque les doubles clics', checkout.includes('_reservationTransitionPending[id]') && checkout.includes('delete _reservationTransitionPending[id]'));
test('B-CHECKIN serveur refuse une autre occupation physique', workflow.includes('.in("status", ["checkedin", "checked_in"])') && workflow.includes('fail("unit_occupied", 409)'));
test('B-RBAC transitions exigent leurs capabilities serveur', workflow.includes('ACTION_CAPABILITY') && workflow.includes('"reservations.checkin"') && workflow.includes('"reservations.checkout"') && workflow.includes('hasCapability(actorRole, ACTION_CAPABILITY[action])'));
test('B-GUEST aucun changement de calcul Folio', guest.includes('stay_total') || guest.includes('folio-total-val'));
test('B-TIME retard calculé dans le fuseau de Kribi', reservations.includes("_propertyTimeZone = 'Africa/Douala'") && propertyClock.includes('timeZone:_propertyTimeZone'));
test('B-SYNTAX scripts HTML modifiés valides', [
  ['RESERVATIONS_EMBEDDED.html', reservations],
  ['ANALYTICS_EMBEDDED.html', analytics],
  ['HOUSEKEEPING_EMBEDDED.html', housekeeping],
].every(([label, source]) => inlineScriptsParse(source, label)) && (() => {
  try { new Function(`${bookingBlocked}\n${bookingOverlap}`); return true; }
  catch (error) { console.error(`    Syntax error in Booking functions: ${error.message}`); return false; }
})());

console.log(`\nRecovery Lot B: ${passed} PASS / ${failed} FAIL`);
if (failed) process.exitCode = 1;
