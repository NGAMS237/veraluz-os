import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('supabase/functions/reservation-workflow/index.ts');
const reservations = read('RESERVATIONS_EMBEDDED.html');
const migration = read('supabase/migrations/20260824_recovery_lot_b_booking_overstay_guard.sql');

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) { console.log(`  PASS ${name}`); passed += 1; }
  else { console.log(`  FAIL ${name}`); failed += 1; }
}

const ensureStart = workflow.indexOf('async function ensureCheckoutEffects');
const ensureEnd = workflow.indexOf('\nDeno.serve(', ensureStart);
const ensureSource = workflow.slice(ensureStart, ensureEnd);
const idempotentStart = workflow.indexOf('if (rez.status === targetStatus)');
const transitionCheck = workflow.indexOf('if (!TRANSITION_MAP[action].includes', idempotentStart);
const idempotentSource = workflow.slice(idempotentStart, transitionCheck);
const updateStart = workflow.indexOf('const { data: updated');
const responseStart = workflow.indexOf('return ok({', workflow.indexOf('const checkoutEffect = action === "checkout"', updateStart));
const postUpdateSource = workflow.slice(updateStart, responseStart);

const helperStart = workflow.indexOf('function doualaDate');
const helperEnd = workflow.indexOf('\nDeno.serve(', helperStart);
const helperJs = stripTypeScriptTypes(workflow.slice(helperStart, helperEnd));
const { ensureCheckoutEffects, doualaDate } = vm.runInNewContext(
  `${helperJs}\n({ ensureCheckoutEffects, doualaDate })`,
  { console, Date, Intl },
);

function housekeepingDb() {
  const rows = new Map();
  return {
    rows,
    from(table) {
      if (table !== 'veraluz_housekeeping') throw new Error(`unexpected table ${table}`);
      return {
        async insert(row) {
          if (rows.has(row.id)) return { error: { code: '23505' } };
          rows.set(row.id, { ...row });
          return { error: null };
        },
        select() {
          let id;
          const chain = {
            eq(_column, value) { id = value; return chain; },
            async maybeSingle() { return { data: rows.get(id) ?? null, error: null }; },
          };
          return chain;
        },
      };
    },
  };
}

const fakeDb = housekeepingDb();
const firstEnsure = await ensureCheckoutEffects(fakeDb, { id: 'BK-B1-A', unit_id: 'U1' });
const retryEnsure = await ensureCheckoutEffects(fakeDb, { id: 'BK-B1-A', unit_id: 'U1' });
const secondReservationEnsure = await ensureCheckoutEffects(fakeDb, { id: 'BK-B1-B', unit_id: 'U1' });

test('B1-01 checkout transition crée housekeeping une fois',
  ensureSource.includes('.from("veraluz_housekeeping").insert({') &&
  postUpdateSource.includes('await ensureCheckoutEffects') &&
  firstEnsure.ok && firstEnsure.created && fakeDb.rows.has('checkout-BK-B1-A'));
test('B1-02 double checkout ne crée pas deux tâches',
  ensureSource.includes('const taskId = `checkout-${reservation.id}`') &&
  ensureSource.includes('insertErr.code !== "23505"') &&
  ensureSource.includes('.eq("id", taskId)') && retryEnsure.ok && !retryEnsure.created &&
  [...fakeDb.rows.keys()].filter((id) => id === 'checkout-BK-B1-A').length === 1);
test('B1-03 retry checkedout garantit tâche manquante',
  idempotentSource.includes('await ensureCheckoutEffects(db, rez)') &&
  idempotentSource.indexOf('ensureCheckoutEffects') < idempotentSource.indexOf('idempotent: true') &&
  postUpdateSource.includes('current?.status === "checkedout"'));
test('B1-04 overstay seul ne crée jamais housekeeping',
  !/overstay[\s\S]{0,180}ensureCheckoutEffects/i.test(workflow) &&
  !/isReservationOverstay[\s\S]{0,180}veraluz_housekeeping/.test(reservations));
test('B1-05 chaque réservation a sa propre tâche déterministe',
  ensureSource.includes('checkout-${reservation.id}') && !ensureSource.includes('unit_id}`') &&
  secondReservationEnsure.ok && fakeDb.rows.size === 2 && fakeDb.rows.has('checkout-BK-B1-B'));
test('B1-06 échec Edge après commit reste réparable sans seconde transition',
  workflow.includes('fail(checkoutEffect.error, 503, { retryable: true })') &&
  !postUpdateSource.includes('status: rez.status'));
test('B1-07 frontend ne dépend plus du localStorage pour le ménage canonique',
  !reservations.includes("localStorage.setItem('vlz_hk_checkout'") &&
  reservations.includes('Legacy UI notification only') &&
  reservations.includes('reservation-workflow guarantees the canonical housekeeping task'));
test('B1-08 aucune nouvelle table Events',
  !/from\(["']veraluz_(?:events|event_jobs)["']\)/.test(workflow) &&
  !/create\s+table[^;]*veraluz_(?:events|event_jobs)/i.test(migration));
test('B1-09 early check-in utilise Africa/Douala',
  workflow.includes('timeZone: "Africa/Douala"') &&
  workflow.includes('const today = doualaDate();') &&
  !workflow.includes('const today = new Date().toISOString().slice(0, 10)') &&
  doualaDate(new Date('2026-08-24T23:30:00.000Z')) === '2026-08-25');

let lotBPass = false;
try {
  const output = execFileSync(process.execPath, [path.join(root, 'tests/recovery-lot-b-reservation-overstay.test.mjs')], { encoding: 'utf8' });
  lotBPass = output.includes('Recovery Lot B: 34 PASS / 0 FAIL');
} catch {}
test('B1-10 tous tests Lot B restent verts', lotBPass);

let changed = [];
try {
  changed = execFileSync('git', ['diff', '--name-only', '9e0ae136c6861b6598d9718a77146f90b5912347'], { cwd: root, encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean);
} catch {}
test('B1-11 aucun fichier Lot A/A1/A2 modifié',
  changed.length > 0 && changed.every((name) => !/(?:CORE|RH_EMBEDDED|LIVREUR|employees-secure|recovery-lot-a)/i.test(name)));

test('B1-12 checkout DB et ménage partagent la même transaction',
  migration.includes('create or replace function public.veraluz_ensure_checkout_housekeeping()') &&
  migration.includes('create trigger trg_veraluz_checkout_housekeeping') &&
  migration.includes('after update of status on public.veraluz_reservations') &&
  migration.includes("new.status = 'checkedout'") &&
  migration.includes('execute function public.veraluz_ensure_checkout_housekeeping()'));

test('B1-13 trigger ménage déterministe et collision vérifiée',
  migration.includes("v_task_id := 'checkout-' || new.id") &&
  migration.includes('on conflict (id) do nothing') &&
  migration.includes("raise exception 'checkout_effect_conflict'") &&
  migration.includes("time zone 'Africa/Douala'"));

let workflowSyntaxValid = false;
try {
  const withoutImports = workflow.replace(/^import .*;$/gm, '');
  new Function(stripTypeScriptTypes(withoutImports));
  workflowSyntaxValid = true;
} catch {}
test('B1-14 reservation-workflow complet reste syntaxiquement valide', workflowSyntaxValid);

console.log(`\nRecovery Lot B.1: ${passed} PASS / ${failed} FAIL`);
if (failed) process.exitCode = 1;
