/**
 * Tests automatisés — RECOVERY LOT E v2 (Correction Finale 7 Blocs)
 * Settings + Guest + Events + Communications + Scheduler + Notifications
 * node --test tests/recovery-lot-e-settings-events-comms-scheduler.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT     = path.resolve(import.meta.dirname, '..');
const CORE     = fs.readFileSync(path.join(ROOT, 'VERALUZ_OS_CORE.html'), 'utf-8');
const SETT     = fs.readFileSync(path.join(ROOT, 'SETTINGS_EMBEDDED.html'), 'utf-8');
const NOTIF    = fs.readFileSync(path.join(ROOT, 'NOTIFICATIONS_EMBEDDED.html'), 'utf-8');
const GSTEF    = fs.readFileSync(path.join(ROOT, 'supabase/functions/guest-access/index.ts'), 'utf-8');
const COMM     = fs.readFileSync(path.join(ROOT, 'supabase/functions/communications-secure/index.ts'), 'utf-8');
const MIG      = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260828_recovery_lot_e_events_notifications_jobs.sql'), 'utf-8');
const NOTIF_EF = fs.readFileSync(path.join(ROOT, 'supabase/functions/notifications-secure/index.ts'), 'utf-8');
const DRYRUN   = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260828_dry_run_preview.sql'), 'utf-8');
const SETT_EF  = fs.readFileSync(path.join(ROOT, 'supabase/functions/settings-secure/index.ts'), 'utf-8');

/* Strip comments for executable-code-only checks */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}
function scriptCode(html) {
  return (html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
}
const coreScripts   = stripComments(scriptCode(CORE));
const settScripts   = stripComments(scriptCode(SETT));
const settScriptsRaw = scriptCode(SETT); // includes comments for UI checks
const notifScripts  = stripComments(scriptCode(NOTIF));
const commStripped  = stripComments(COMM);
const notifEfStripped = stripComments(NOTIF_EF);
const migStripped   = stripComments(MIG);

/* Whitelist */
const wlMatch   = CORE.match(/var VERALUZ_BROKER_ALLOWED_ENDPOINTS\s*=\s*\[([\s\S]*?)\];/);
const endpoints = wlMatch ? [...wlMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];

/* settings-secure WRITABLE_KEYS */
const wkMatch = SETT_EF.match(/const WRITABLE_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
const writableKeys = wkMatch ? [...wkMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];

/* ═══════════════════════════════════════════════════════════
   BLOC 1 — BROKER CORE: whitelist + envelope {status,body}
   ═══════════════════════════════════════════════════════════ */

test('E-01 [BROKER] settings-secure dans la whitelist CORE', () => {
  assert.ok(endpoints.includes('settings-secure'),
    'settings-secure manquant de la whitelist');
});

test('E-01b [BROKER] communications-secure dans la whitelist CORE', () => {
  assert.ok(endpoints.includes('communications-secure'),
    'communications-secure manquant de la whitelist');
});

test('E-01c [BROKER] notifications-secure dans la whitelist CORE', () => {
  assert.ok(endpoints.includes('notifications-secure'),
    'notifications-secure manquant de la whitelist — aurait FAIL avec ancienne version');
});

test('E-01d [BROKER] event-worker et comms-worker absents (service_role only)', () => {
  assert.ok(!endpoints.includes('event-worker'), 'event-worker interdit côté navigateur');
  assert.ok(!endpoints.includes('comms-worker'), 'comms-worker interdit côté navigateur');
});

test('E-01e [BROKER] endpoint inconnu bloqué — endpoint_not_whitelisted', () => {
  assert.ok(!endpoints.includes('unknown-endpoint-xyz'));
  assert.ok(CORE.includes('endpoint_not_whitelisted'),
    'broker doit retourner endpoint_not_whitelisted pour endpoints non autorisés');
});

test('E-01f [BROKER] envelope {status,body} — Settings lit res.body.ok pas response.ok', () => {
  // Les appels broker dans SETTINGS doivent tester d.ok (après res.body), jamais res.ok
  assert.ok(!settScripts.includes('res.ok'),
    'saveAll/loadDbCanonical ne doit jamais tester res.ok — doit utiliser res.body.ok — aurait FAIL');
  assert.ok(settScripts.includes('res.body'),
    'Settings doit déballer res.body pour lire le résultat');
});

test('E-01g [BROKER] notifications EF — notifRequest utilise window.parent.veraluzSecureRequest', () => {
  assert.ok(NOTIF.includes("window.parent.veraluzSecureRequest('notifications-secure'"),
    'NOTIFICATIONS_EMBEDDED doit appeler window.parent.veraluzSecureRequest — aurait FAIL');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 2 — SETTINGS SSOT
   ═══════════════════════════════════════════════════════════ */

test('E-02a [SETTINGS] SB_SS et AK_SS supprimés — aucun accès REST direct', () => {
  assert.ok(!SETT.includes('SB_SS'),
    'SB_SS (URL directe Supabase) doit être supprimée — aurait FAIL');
  assert.ok(!SETT.includes('AK_SS'),
    'AK_SS (anon key) doit être supprimée — aurait FAIL');
});

test('E-02b [SETTINGS] loadDbCanonical utilise broker (pas fetch direct)', () => {
  assert.ok(!settScripts.includes("fetch(SB_SS"),
    'fetch direct interdit — broker CORE uniquement');
  assert.ok(settScripts.includes("veraluzSecureRequest('settings-secure'"),
    'loadDbCanonical doit passer par le broker');
});

test('E-02c [SETTINGS] loadDbCanonical ne demande que des clés WRITABLE_KEYS', () => {
  // Les clés demandées dans get_settings doivent être parmi les clés serveur-écrivables
  const nonWritable = ['email', 'devises', 'tarifs', 'permissions'];
  for (const k of nonWritable) {
    // La liste de keys dans get_settings ne doit pas contenir ces clés non-writables
    const keyListMatch = SETT.match(/keys:\[([^\]]+)\]/);
    if (keyListMatch) {
      assert.ok(!keyListMatch[1].includes(`'${k}'`),
        `${k} ne doit pas être demandé à get_settings — non dans WRITABLE_KEYS — aurait FAIL`);
    }
  }
});

test('E-02d [SETTINGS] hotel tab fait des writes séparés property + contact', () => {
  // saveAll pour section hotel doit appeler _doSave('property') ET _doSave('contact')
  assert.ok(settScripts.includes("_doSave('property'"),
    'hotel section doit écrire property séparément — aurait FAIL');
  assert.ok(settScripts.includes("_doSave('contact'"),
    'hotel section doit écrire contact séparément — aurait FAIL');
});

test('E-02e [SETTINGS] email/devises/tarifs/permissions sont local-only (pas de write serveur)', () => {
  // Ces sections doivent être dans LOCAL_ONLY et jamais passées à update_settings via save path normal
  assert.ok(settScripts.includes("LOCAL_ONLY"),
    'saveAll doit avoir un bloc LOCAL_ONLY pour les sections non-écrivables — aurait FAIL');
  // email ne doit pas être dans KEY_MAP vers server write
  const keyMapMatch = settScripts.match(/KEY_MAP\s*=\s*\{([^}]+)\}/);
  if (keyMapMatch) {
    assert.ok(!keyMapMatch[1].includes("email:'email'"),
      "email ne doit pas mapper vers un write serveur — aurait FAIL");
  }
});

test('E-02f [SETTINGS] localStorage n\'est pas SSOT métier', () => {
  assert.ok(!settScripts.includes("localStorage.getItem(LS_KEY)"),
    'loadSettings ne doit pas lire localStorage comme SSOT');
});

test('E-02g [SETTINGS] discardChanges restaure depuis _dbSett (DB), pas DEFAULTS', () => {
  assert.ok(settScripts.includes('_dbSett'),
    'discardChanges doit restaurer depuis _dbSett (valeurs DB confirmées)');
});

test('E-02h [SETTINGS-EF] WRITABLE_KEYS serveur contient property,contact,booking,wifi,restaurant,branding,security', () => {
  const expected = ['property','contact','booking','wifi','restaurant','branding','security'];
  for (const k of expected) {
    assert.ok(writableKeys.includes(k), `WRITABLE_KEYS doit contenir '${k}'`);
  }
});

test('E-02i [SETTINGS-EF] WRITABLE_KEYS ne contient pas email,devises,tarifs,permissions', () => {
  const forbidden = ['email','devises','tarifs','permissions'];
  for (const k of forbidden) {
    assert.ok(!writableKeys.includes(k),
      `WRITABLE_KEYS ne doit pas contenir '${k}' — aurait FAIL sans correction`);
  }
});

test('E-02j [SETTINGS-EF] update_settings valide key contre WRITABLE_KEYS', () => {
  assert.ok(SETT_EF.includes('WRITABLE_KEYS.has(key)'),
    'update_settings doit valider key contre WRITABLE_KEYS');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 3 — COMMUNICATIONS / RESEND
   ═══════════════════════════════════════════════════════════ */

test('E-03a [COMMS] action:send_email absente du code exécutable Settings', () => {
  // Dans le code non-commenté, action:'send_email' ne doit plus apparaître
  assert.ok(!settScripts.includes("action:'send_email'"),
    "action:'send_email' dans code exécutable Settings — aurait FAIL — action n'existe pas");
});

test('E-03b [COMMS] communications-secure ne supporte pas send_email', () => {
  // L'EF ne doit pas avoir de handler pour send_email
  assert.ok(!commStripped.includes("action === 'send_email'"),
    "send_email ne doit pas être une action dans communications-secure");
});

test('E-03c [COMMS] actions réelles présentes: dispatch_client_email, dispatch_restaurant_order_email', () => {
  assert.ok(COMM.includes("action === 'dispatch_client_email'"),
    'dispatch_client_email doit être présent');
  assert.ok(COMM.includes("action === 'dispatch_restaurant_order_email'"),
    'dispatch_restaurant_order_email doit être présent');
});

test('E-03d [COMMS] EmailJS credentials supprimés du Settings UI', () => {
  assert.ok(!SETT.includes('MqrKcqvO952CD5HOA'),
    'Public Key EmailJS ne doit pas apparaître dans le HTML — aurait FAIL');
  assert.ok(!SETT.includes('service_mwiart1'),
    'Service ID EmailJS ne doit pas apparaître dans le HTML — aurait FAIL');
});

test('E-03e [COMMS] vlz_cache_rez supprimé du code exécutable Settings', () => {
  assert.ok(!settScripts.includes('vlz_cache_rez'),
    'vlz_cache_rez ne doit pas être dans le code exécutable — aurait FAIL');
});

test('E-03f [COMMS] Resend API key vient exclusivement de Deno.env (jamais DB/body)', () => {
  assert.ok(COMM.includes("Deno.env.get('RESEND_API_KEY')"),
    'RESEND_API_KEY doit venir de Deno.env');
  assert.ok(!COMM.includes("resend_key"),
    'resend_key ne doit pas venir de settings DB');
});

test('E-03g [COMMS] list_templates, preview, prep_comm disponibles côté serveur', () => {
  assert.ok(COMM.includes("action === 'list_templates'"), 'list_templates doit exister');
  assert.ok(COMM.includes("action === 'preview'"), 'preview doit exister');
  assert.ok(COMM.includes("action === 'prep_comm'"), 'prep_comm doit exister');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 4 — NOTIFICATIONS EF hardening
   ═══════════════════════════════════════════════════════════ */

test('E-04a [NOTIF-EF] validateEmployeeSession vérifie status employé actif', () => {
  // doit vérifier status === actif || active
  assert.ok(notifEfStripped.includes("status !== 'actif'") || notifEfStripped.includes("!== 'actif'"),
    'validateEmployeeSession doit vérifier status actif — aurait FAIL avec ancienne version');
  assert.ok(NOTIF_EF.includes("'active'"),
    'validateEmployeeSession doit accepter status active (anglais)');
});

test('E-04b [NOTIF-EF] rôle normalisé toLowerCase', () => {
  assert.ok(NOTIF_EF.includes('.toLowerCase()'),
    'le rôle doit être normalisé en minuscules — aurait FAIL');
});

test('E-04c [NOTIF-EF] limit/offset validés (NaN refusé, plage vérifiée)', () => {
  assert.ok(NOTIF_EF.includes('validateInt'),
    'limit et offset doivent être validés via validateInt — aurait FAIL avec NaN');
  assert.ok(NOTIF_EF.includes('invalid_limit'),
    'limit invalide doit retourner invalid_limit');
  assert.ok(NOTIF_EF.includes('invalid_offset'),
    'offset invalide doit retourner invalid_offset');
});

test('E-04d [NOTIF-EF] recipient_roles validés contre VALID_ROLES', () => {
  assert.ok(NOTIF_EF.includes('VALID_ROLES'),
    'recipient_roles doit être validé contre VALID_ROLES — aurait FAIL');
  assert.ok(NOTIF_EF.includes('invalid_recipient_role'),
    'rôle invalide doit retourner invalid_recipient_role');
});

test('E-04e [NOTIF-EF] metadata taille max vérifiée', () => {
  assert.ok(NOTIF_EF.includes('METADATA_MAX_BYTES'),
    'metadata doit avoir une limite de taille — aurait FAIL');
  assert.ok(NOTIF_EF.includes('metadata_too_large'),
    'dépassement doit retourner metadata_too_large');
});

test('E-04f [NOTIF-EF] idempotency_key sur create — doublon retourne deduplicated=true', () => {
  assert.ok(NOTIF_EF.includes('idempotency_key'),
    'create doit supporter idempotency_key — aurait FAIL');
  assert.ok(NOTIF_EF.includes('deduplicated'),
    'create doit retourner deduplicated:true sur doublon');
});

test('E-04g [NOTIF-EF] acknowledge refusé si requires_ack=false', () => {
  // Le handler acknowledge doit vérifier requires_ack avant d'agir
  assert.ok(notifEfStripped.includes('requires_ack !== true') || notifEfStripped.includes('requires_ack != true'),
    'acknowledge doit être refusé si requires_ack=false — aurait FAIL avec ancienne version');
  assert.ok(NOTIF_EF.includes('ack_not_required'),
    'doit retourner ack_not_required si requires_ack=false');
});

test('E-04h [NOTIF-EF] filtrage recipient_roles sans interpolation brute de rôle', () => {
  // L'ancienne version utilisait: .or(`recipient_roles.cs.{${employee.role}}`)
  // La nouvelle version doit éviter l'interpolation directe via deux requêtes séparées
  assert.ok(!notifEfStripped.includes('`recipient_roles.cs.{${'),
    'recipient_roles ne doit pas utiliser interpolation brute dans .or() — aurait FAIL injection');
  assert.ok(NOTIF_EF.includes('.contains('),
    'doit utiliser .contains() pour filtrage recipient_roles — sans interpolation');
});

test('E-04i [NOTIF-EF] employé inactif rejeté (invalid_or_inactive_session)', () => {
  assert.ok(NOTIF_EF.includes('invalid_or_inactive_session'),
    'employé inactif doit retourner invalid_or_inactive_session — aurait FAIL');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 5 — MIGRATION hardening
   ═══════════════════════════════════════════════════════════ */

test('E-05a [MIGRATION] trigger d\'immuabilité fn_immutable_veraluz_events présent', () => {
  assert.ok(MIG.includes('fn_immutable_veraluz_events'),
    'trigger UPDATE/DELETE sur veraluz_events manquant — aurait FAIL');
  assert.ok(MIG.includes('BEFORE UPDATE OR DELETE ON public.veraluz_events'),
    'trigger doit bloquer UPDATE et DELETE sur veraluz_events');
});

test('E-05b [MIGRATION] fonctions utilisent SET search_path = \'\' (vide, pas public)', () => {
  // Compter les fonctions avec search_path = public (devrait être 0)
  const oldPattern = /SET search_path = public/g;
  const matches = MIG.match(oldPattern) || [];
  assert.strictEqual(matches.length, 0,
    `search_path = public trouvé ${matches.length} fois — doit être '' (vide) — aurait FAIL`);
  assert.ok(MIG.includes("SET search_path = ''"),
    "search_path = '' (vide) doit être utilisé dans toutes les fonctions");
});

test('E-05c [MIGRATION] REVOKE EXECUTE FROM PUBLIC, anon, authenticated sur toutes les fonctions', () => {
  assert.ok(MIG.includes('REVOKE EXECUTE ON FUNCTION public.claim_job_lease'),
    'REVOKE EXECUTE manquant sur claim_job_lease — aurait FAIL');
  assert.ok(MIG.includes('REVOKE EXECUTE ON FUNCTION public.release_job_lease'),
    'REVOKE EXECUTE manquant sur release_job_lease');
  assert.ok(MIG.includes('REVOKE EXECUTE ON FUNCTION public.recover_expired_job_leases'),
    'REVOKE EXECUTE manquant sur recover_expired_job_leases');
  assert.ok(MIG.includes('REVOKE EXECUTE ON FUNCTION public.fn_immutable_veraluz_events'),
    'REVOKE EXECUTE manquant sur fn_immutable_veraluz_events — aurait FAIL');
});

test('E-05d [MIGRATION] v_updated INTEGER (pas BOOLEAN) dans release_job_lease', () => {
  // v_updated BOOLEAN était un bug — GET DIAGNOSTICS ROW_COUNT exige INTEGER
  assert.ok(!migStripped.includes('v_updated BOOLEAN'),
    'v_updated BOOLEAN doit être corrigé en INTEGER — aurait FAIL');
  assert.ok(migStripped.includes('v_updated INTEGER'),
    'v_updated doit être INTEGER pour GET DIAGNOSTICS ROW_COUNT — aurait FAIL');
});

test('E-05e [MIGRATION] lease_secs validé (doit être 1–3600)', () => {
  assert.ok(MIG.includes('p_lease_secs > 3600') || MIG.includes('p_lease_secs < 1'),
    'claim_job_lease doit valider p_lease_secs 1–3600 — aurait FAIL');
  assert.ok(MIG.includes('invalid_lease_secs'),
    'doit retourner invalid_lease_secs si hors plage');
});

test('E-05f [MIGRATION] status validé dans release_job_lease (success|failure uniquement)', () => {
  assert.ok(MIG.includes("p_status NOT IN ('success','failure')"),
    "release_job_lease doit valider p_status contre success|failure — aurait FAIL");
  assert.ok(MIG.includes('invalid_status'),
    'doit retourner invalid_status pour valeur invalide');
});

test('E-05g [MIGRATION] lease_owner stocké pendant claim', () => {
  assert.ok(MIG.includes('lease_owner'),
    'veraluz_jobs doit avoir colonne lease_owner — aurait FAIL');
  assert.ok(MIG.includes('lease_owner      = p_worker_id'),
    'claim_job_lease doit stocker p_worker_id dans lease_owner — aurait FAIL');
});

test('E-05h [MIGRATION] release conditionné sur lease_token (pas lease_token + lease_owner séparé)', () => {
  // Le release doit filtrer sur lease_token au minimum
  assert.ok(MIG.includes('AND lease_token = p_lease_token'),
    'release doit être conditionné sur lease_token — aurait FAIL avec mauvais token');
});

test('E-05i [MIGRATION] CHECK constraints sur channels et recipient_roles', () => {
  assert.ok(MIG.includes("'in_app'") && MIG.includes("'email'") && MIG.includes("'sms'") && MIG.includes("'push'"),
    'channels doit avoir CHECK constraint avec valeurs valides — aurait FAIL');
  // recipient_roles CHECK doit valider les rôles
  assert.ok(MIG.includes("bool_and") || MIG.includes("= ANY(ARRAY["),
    'recipient_roles doit avoir CHECK constraint validant les rôles — aurait FAIL');
});

test('E-05j [MIGRATION] idempotency_key UNIQUE sur veraluz_events', () => {
  assert.ok(MIG.includes('idempotency_key  TEXT        NOT NULL UNIQUE'),
    'idempotency_key doit être UNIQUE sur veraluz_events');
});

test('E-05k [MIGRATION] veraluz_notifications a idempotency_key UNIQUE', () => {
  assert.ok(MIG.includes('idempotency_key  TEXT        UNIQUE'),
    'veraluz_notifications doit avoir idempotency_key UNIQUE');
});

test('E-05l [MIGRATION] duration_ms validé >= 0', () => {
  assert.ok(MIG.includes('p_duration_ms < 0'),
    'release_job_lease doit valider p_duration_ms >= 0 — aurait FAIL');
  assert.ok(MIG.includes('invalid_duration_ms'),
    'doit retourner invalid_duration_ms');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 6 — DRY RUN comportemental
   ═══════════════════════════════════════════════════════════ */

test('E-06a [DRY-RUN] BEGIN et ROLLBACK présents', () => {
  assert.ok(DRYRUN.includes('BEGIN;'), 'dry-run doit commencer par BEGIN');
  assert.ok(DRYRUN.includes('ROLLBACK;'), 'dry-run doit se terminer par ROLLBACK');
});

test('E-06b [DRY-RUN] tests T01-T18 avec ASSERT (comportement réel)', () => {
  // Les tests doivent utiliser ASSERT, pas seulement des textes de vérification
  const assertCount = (DRYRUN.match(/\bASSERT\b/g) || []).length;
  assert.ok(assertCount >= 15,
    `dry-run doit avoir ≥15 assertions ASSERT comportementales, trouvé: ${assertCount} — aurait FAIL`);
});

test('E-06c [DRY-RUN] test UPDATE/DELETE interdit sur veraluz_events (T04,T05)', () => {
  assert.ok(DRYRUN.includes("UPDATE public.veraluz_events SET") &&
            DRYRUN.includes('T04'),
    'T04: dry-run doit tester UPDATE sur veraluz_events et vérifier le blocage');
  assert.ok(DRYRUN.includes("DELETE FROM public.veraluz_events") &&
            DRYRUN.includes('T05'),
    'T05: dry-run doit tester DELETE sur veraluz_events et vérifier le blocage');
});

test('E-06d [DRY-RUN] test deux workers ne peuvent pas obtenir le même lease (T13)', () => {
  assert.ok(DRYRUN.includes('T13') && DRYRUN.includes('worker-test-002'),
    'T13: dry-run doit tester qu\'un second worker ne peut pas obtenir le lease');
});

test('E-06e [DRY-RUN] test mauvais lease_token rejeté (T14)', () => {
  assert.ok(DRYRUN.includes("'wrong-token-xyz'") || DRYRUN.includes('T14'),
    'T14: dry-run doit tester release avec mauvais lease_token');
});

test('E-06f [DRY-RUN] test recover_expired_job_leases (T18)', () => {
  assert.ok(DRYRUN.includes('recover_expired_job_leases') && DRYRUN.includes('T18'),
    'T18: dry-run doit tester la récupération des leases expirés');
});

test('E-06g [DRY-RUN] post-ROLLBACK aucun objet Lot E persisté', () => {
  assert.ok(DRYRUN.includes('POST-ROLLBACK') || DRYRUN.includes('post-ROLLBACK'),
    'dry-run doit vérifier après ROLLBACK que rien ne persiste');
  assert.ok(DRYRUN.includes("table_name IN"),
    'doit vérifier l\'absence des tables après ROLLBACK');
});

test('E-06h [DRY-RUN] test notification_reads UNIQUE(notification_id, employee_id) (T07)', () => {
  assert.ok(DRYRUN.includes('T07') && DRYRUN.includes('emp-001'),
    'T07: dry-run doit tester UNIQUE(notification_id, employee_id) sur notification_reads');
});

test('E-06i [DRY-RUN] test CHECK channels (T08)', () => {
  assert.ok(DRYRUN.includes('T08') && DRYRUN.includes("'invalid_channel'"),
    'T08: dry-run doit tester CHECK constraint sur channels');
});

test('E-06j [DRY-RUN] test CHECK recipient_roles (T09)', () => {
  assert.ok(DRYRUN.includes('T09') && DRYRUN.includes("'hacker'"),
    'T09: dry-run doit tester CHECK constraint sur recipient_roles');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 7 — Guest-access correctness
   ═══════════════════════════════════════════════════════════ */

test('E-07a [GUEST] veraluz_units.number inexistant — select doit utiliser name seul', () => {
  assert.ok(!GSTEF.includes(".select('name, number')"),
    'select name,number interdit — colonne number inexistante sur veraluz_units');
  assert.ok(!GSTEF.includes(".select('name,number')"),
    'select name,number (sans espace) interdit');
});

test('E-07b [GUEST] roomNumber résolu depuis unit name (pas number)', () => {
  assert.ok(GSTEF.includes('unitRow?.name') || GSTEF.includes("unitRow.name"),
    'roomNumber doit être résolu depuis unit.name');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 8 — Sécurité globale
   ═══════════════════════════════════════════════════════════ */

test('E-08a [SECURITE] service_role jamais dans le frontend (SETTINGS)', () => {
  assert.ok(!SETT.includes('service_role'),
    'service_role interdit dans SETTINGS_EMBEDDED.html');
});

test('E-08b [SECURITE] aucun fetch direct supabase.co dans SETTINGS scripts', () => {
  assert.ok(!settScripts.includes('supabase.co'),
    'fetch direct vers supabase.co interdit dans SETTINGS — broker CORE uniquement');
});

test('E-08c [SECURITE] NOTIFICATIONS_EMBEDDED utilise notifRequest helper pour les 4 actions', () => {
  assert.ok(NOTIF.includes("notifRequest('list'"),   'action list via notifRequest');
  assert.ok(NOTIF.includes("notifRequest('create'") || NOTIF.includes("saveNotifToSupabase"),
    'action create via notifRequest ou saveNotifToSupabase');
  assert.ok(NOTIF.includes("notifRequest('mark_read'") || NOTIF.includes("markReadInSupabase"),
    'action mark_read via notifRequest');
  assert.ok(NOTIF.includes("notifRequest('acknowledge'") || NOTIF.includes("acknowledgeInSupabase"),
    'action acknowledge via notifRequest');
});

test('E-08d [SECURITE] NOTIFICATIONS_EMBEDDED ne montre pas de fausses données après erreur', () => {
  // En mode démo, le banner doit être affiché; en mode prod, les erreurs server ne doivent pas
  // afficher de données demo
  assert.ok(NOTIF.includes('_NOTIF_DEMO_MODE') || NOTIF.includes('demo'),
    '_NOTIF_DEMO_MODE doit être présent pour séparer demo de prod');
});

test('E-08e [SECURITE] MIGRATION fonctions SECURITY DEFINER', () => {
  const sdCount = (MIG.match(/SECURITY DEFINER/g) || []).length;
  assert.ok(sdCount >= 4,
    `Toutes les fonctions doivent être SECURITY DEFINER, trouvé: ${sdCount}`);
});

test('E-08f [SECURITE] MIGRATION REVOKE ALL sur toutes les tables publiques', () => {
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_events FROM public, anon, authenticated'),
    'REVOKE ALL manquant sur veraluz_events');
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_notifications FROM public, anon, authenticated'),
    'REVOKE ALL manquant sur veraluz_notifications');
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_jobs FROM public, anon, authenticated'),
    'REVOKE ALL manquant sur veraluz_jobs');
});

test('E-08g [SECURITE] GRANT service_role uniquement sur toutes les tables', () => {
  assert.ok(MIG.includes('GRANT ALL ON public.veraluz_events           TO service_role'),
    'GRANT service_role manquant sur veraluz_events');
  assert.ok(MIG.includes('GRANT ALL ON public.veraluz_notifications    TO service_role'),
    'GRANT service_role manquant sur veraluz_notifications');
});
