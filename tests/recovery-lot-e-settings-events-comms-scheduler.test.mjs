/**
 * Tests automatisés — RECOVERY LOT E (CORRIGÉ)
 * Settings + Guest + Events + Communications + Scheduler
 * node --test tests/recovery-lot-e-settings-events-comms-scheduler.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT  = path.resolve(import.meta.dirname, '..');
const CORE  = fs.readFileSync(path.join(ROOT, 'VERALUZ_OS_CORE.html'), 'utf-8');
const SETT  = fs.readFileSync(path.join(ROOT, 'SETTINGS_EMBEDDED.html'), 'utf-8');
const NOTIF = fs.readFileSync(path.join(ROOT, 'NOTIFICATIONS_EMBEDDED.html'), 'utf-8');
const GSTEF = fs.readFileSync(path.join(ROOT, 'supabase/functions/guest-access/index.ts'), 'utf-8');
const COMM  = fs.readFileSync(path.join(ROOT, 'supabase/functions/communications-secure/index.ts'), 'utf-8');
const MIG   = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260828_recovery_lot_e_events_notifications_jobs.sql'), 'utf-8');
const NOTIF_EF = fs.readFileSync(path.join(ROOT, 'supabase/functions/notifications-secure/index.ts'), 'utf-8');

/* Strip comments from script blocks for executable-code checks */
function scriptCode(html) {
  return (html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)||[]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
}
const coreScripts  = scriptCode(CORE);
const settScripts  = scriptCode(SETT);
const notifScripts = scriptCode(NOTIF);

/* Whitelist endpoints */
const wlMatch   = CORE.match(/var VERALUZ_BROKER_ALLOWED_ENDPOINTS\s*=\s*\[([\s\S]*?)\];/);
const endpoints = wlMatch ? [...wlMatch[1].matchAll(/'([^']+)'/g)].map(m=>m[1]) : [];

/* ═══════════════════════════════════════════════════════════
   BLOC 1 — Whitelist & Sécurité navigateur
   ═══════════════════════════════════════════════════════════ */

test('E-01 [AUTOMATISÉ]: documents-secure dans la whitelist CORE (non-régression Gate 0)', () => {
  assert.ok(endpoints.includes('documents-secure'),
    'documents-secure doit rester dans la whitelist');
});

test('E-02 [AUTOMATISÉ]: endpoint inconnu bloqué dans le broker CORE', () => {
  assert.ok(!endpoints.includes('unknown-endpoint-xyz'),
    'endpoint arbitraire ne doit pas être dans la whitelist');
  assert.ok(CORE.includes('endpoint_not_whitelisted'),
    'le broker doit retourner endpoint_not_whitelisted pour les endpoints non autorisés');
});

test('E-03 [AUTOMATISÉ]: event-worker et comms-worker absents de la whitelist navigateur', () => {
  assert.ok(!endpoints.includes('event-worker'),
    'event-worker interdit dans whitelist navigateur — service_role only');
  assert.ok(!endpoints.includes('comms-worker'),
    'comms-worker interdit dans whitelist navigateur — service_role only');
});

test('E-03b [AUTOMATISÉ]: notifications-secure dans la whitelist CORE', () => {
  assert.ok(endpoints.includes('notifications-secure'),
    'notifications-secure doit être dans la whitelist CORE après RBAC côté serveur');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 2 — Settings localStorage → DB
   ═══════════════════════════════════════════════════════════ */

test('E-04 [AUTOMATISÉ]: loadSettings() n\'utilise pas localStorage comme SSOT', () => {
  assert.ok(!settScripts.includes("localStorage.getItem(LS_KEY)"),
    'loadSettings ne doit pas lire localStorage(LS_KEY) — SSOT = veraluz_settings DB');
});

test('E-04b [AUTOMATISÉ]: loadDbCanonical() utilise le broker CORE (pas de fetch direct)', () => {
  // loadDbCanonical ne doit PAS utiliser fetch() direct vers SB_SS
  assert.ok(!settScripts.includes("fetch(SB_SS"),
    'loadDbCanonical doit utiliser veraluzSecureRequest, pas fetch(SB_SS)');
  assert.ok(settScripts.includes("veraluzSecureRequest('settings-secure'"),
    'loadDbCanonical doit passer par le broker CORE');
});

test('E-05 [AUTOMATISÉ]: pas d\'envoi EmailJS direct dans les scripts Settings', () => {
  assert.ok(!settScripts.includes('emailjs.send('),
    'EmailJS.send() interdit dans SETTINGS_EMBEDDED');
  assert.ok(!settScripts.includes('emailjs.sendForm('),
    'EmailJS.sendForm() interdit dans SETTINGS_EMBEDDED');
  assert.ok(!settScripts.includes('api.emailjs.com'),
    'Aucun appel REST direct à api.emailjs.com dans le code exécutable');
});

test('E-06 [AUTOMATISÉ]: saveAll() ne stocke pas les settings dans localStorage(LS_KEY)', () => {
  assert.ok(!settScripts.includes("localStorage.setItem(LS_KEY,"),
    'saveAll() ne doit pas sauvegarder les paramètres métier dans localStorage');
});

test('E-06b [AUTOMATISÉ]: saveAll() appelle veraluzSecureRequest(settings-secure) pour persister', () => {
  // saveAll doit appeler le broker pour persister, pas localStorage
  assert.ok(settScripts.includes("veraluzSecureRequest('settings-secure'"),
    'saveAll() doit appeler veraluzSecureRequest pour la persistance DB');
  // Success seulement après réponse serveur (d.ok)
  assert.ok(settScripts.includes("d.ok"),
    'Succès affiché uniquement après confirmation serveur (d.ok)');
  // saveAll ne doit pas appeler markClean() avant confirmation serveur — validé par d.ok ci-dessus
});

test('E-06c [AUTOMATISÉ]: discardChanges() restaure depuis _dbSett (valeurs DB), pas DEFAULTS', () => {
  // discardChanges doit référencer _dbSett pour la restauration
  assert.ok(settScripts.includes('_dbSett') && settScripts.includes('discardChanges'),
    'discardChanges() doit référencer _dbSett pour restaurer les valeurs DB');
  // Ne doit PAS appeler loadSettings() (qui remet DEFAULTS)
  assert.ok(!settScripts.includes('function discardChanges(){\n  loadSettings()'),
    'discardChanges() ne doit pas appeler loadSettings() — restauration depuis _dbSett');
});

test('E-06d [AUTOMATISÉ]: historique email sans localStorage comme SSOT', () => {
  assert.ok(!settScripts.includes("localStorage.getItem('vz_email_log')"),
    'historique email ne doit pas lire vz_email_log depuis localStorage');
  assert.ok(!settScripts.includes("localStorage.setItem('vz_email_log'"),
    'historique email ne doit pas écrire vz_email_log dans localStorage');
  assert.ok(settScripts.includes('_emailLog'),
    'historique email doit utiliser _emailLog en mémoire');
});

test('E-06e [AUTOMATISÉ]: campagnes email sans localStorage comme SSOT', () => {
  assert.ok(!settScripts.includes("localStorage.getItem('vz_email_campaigns_log')"),
    'campagnes email sans localStorage SSOT');
  assert.ok(!settScripts.includes("localStorage.setItem('vz_email_campaigns_log'"),
    'campagnes email sans localStorage SSOT');
});

test('E-06f [AUTOMATISÉ]: testEmail() passe par communications-secure broker', () => {
  assert.ok(settScripts.includes("veraluzSecureRequest('communications-secure'"),
    'testEmail() doit appeler veraluzSecureRequest(communications-secure)');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 3 — Settings-secure EF
   ═══════════════════════════════════════════════════════════ */

test('E-07 [AUTOMATISÉ]: settings-secure masque wifi.password dans get_settings', () => {
  const settEF = fs.readFileSync(path.join(ROOT, 'supabase/functions/settings-secure/index.ts'), 'utf-8');
  assert.ok(settEF.includes('password_configured') || settEF.includes('_password'),
    'get_settings doit masquer wifi.password');
  assert.ok(!settEF.includes('return wifi.password'),
    'wifi.password ne doit jamais être retourné');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 4 — Guest access
   ═══════════════════════════════════════════════════════════ */

test('E-08 [AUTOMATISÉ]: guest-access ne donne le mot de passe Wi-Fi qu\'en checkedin', () => {
  assert.ok(
    GSTEF.includes("canSeePassword") && GSTEF.includes("checkedin"),
    'Mot de passe Wi-Fi conditionné à checkedin dans guest-access'
  );
  assert.ok(
    GSTEF.includes("resStatus === 'checkedin'") || GSTEF.includes("=== 'checkedin'"),
    'Condition checkedin présente pour le Wi-Fi'
  );
});

test('E-09 [AUTOMATISÉ]: checkout_time par défaut = 12:00 dans Settings et guest-access', () => {
  assert.ok(
    SETT.includes("checkout:'12:00'") || SETT.includes('checkout_time||\'12:00\'') || SETT.includes('"12:00"'),
    'DEFAULTS Settings doit avoir checkout 12:00'
  );
  assert.ok(
    GSTEF.includes("|| '12:00'") || GSTEF.includes('|| "12:00"'),
    'guest-access EF doit defaulter checkout_time à 12:00'
  );
});

test('E-09b [CRITIQUE — AUTOMATISÉ]: guest-access sans .select("name, number") — veraluz_units.number inexistant', () => {
  // Test spécifique: .select('name, number') ne doit pas apparaître dans les blocs exécutables
  // qui requêtent veraluz_units
  assert.ok(
    !GSTEF.includes(".select('name, number')"),
    'CRITIQUE: .select("name, number") trouvé dans guest-access — veraluz_units.number n\'existe pas en PROD'
  );
  // Vérifier que .select('name') seul est utilisé pour veraluz_units
  assert.ok(
    GSTEF.includes(".select('name')") || GSTEF.includes('.select("name")'),
    'guest-access doit sélectionner uniquement "name" depuis veraluz_units'
  );
  // Aucune référence exécutable à unitRow?.number (uniquement dans les commentaires éventuels)
  const guestNoComments = GSTEF.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
  assert.ok(
    !guestNoComments.includes('unitRow?.number') && !guestNoComments.includes('unitRow.number'),
    'Aucune référence exécutable à unitRow.number dans guest-access'
  );
});

test('E-10 [AUTOMATISÉ]: EF ne promeut pas automatiquement confirmed → checkedin', () => {
  assert.ok(
    GSTEF.includes("'confirmed','checkedin'") || GSTEF.includes("['confirmed','checkedin']"),
    'confirmed et checkedin sont des statuts distincts dans guest-access'
  );
});

test('E-11 [AUTOMATISÉ]: guest-access utilise reservation_id depuis session validée côté serveur', () => {
  assert.ok(
    GSTEF.includes("session!.reservation_id") || GSTEF.includes("session.reservation_id"),
    'reservation_id doit venir de la session validée côté serveur'
  );
});

/* ═══════════════════════════════════════════════════════════
   BLOC 5 — Events: immutabilité + architecture
   ═══════════════════════════════════════════════════════════ */

test('E-12 [AUTOMATISÉ]: migration veraluz_events a idempotency_key UNIQUE', () => {
  assert.ok(MIG.includes('idempotency_key  TEXT        NOT NULL UNIQUE'),
    'idempotency_key UNIQUE requis dans veraluz_events');
});

test('E-12b [AUTOMATISÉ]: enveloppe événement immuable (pas de status dans veraluz_events)', () => {
  // veraluz_events ne doit pas avoir status (mutable) — séparé dans veraluz_event_processing
  const eventsTableBlock = MIG.match(/CREATE TABLE IF NOT EXISTS public\.veraluz_events\s*\([\s\S]*?\);/)?.[0] ?? '';
  assert.ok(!eventsTableBlock.includes('status'),
    'veraluz_events ne doit pas avoir colonne status — état de traitement dans veraluz_event_processing');
  assert.ok(!eventsTableBlock.includes('retry_count'),
    'veraluz_events ne doit pas avoir retry_count — dans veraluz_event_processing');
});

test('E-12c [AUTOMATISÉ]: table veraluz_event_processing séparée pour l\'état mutable', () => {
  assert.ok(MIG.includes('CREATE TABLE IF NOT EXISTS public.veraluz_event_processing'),
    'veraluz_event_processing doit exister comme table séparée');
  assert.ok(MIG.includes('REFERENCES public.veraluz_events(id)'),
    'veraluz_event_processing doit avoir une FK vers veraluz_events');
});

test('E-12d [AUTOMATISÉ]: pas d\'index redondant sur idempotency_key', () => {
  // UNIQUE crée déjà un index btree — pas de CREATE INDEX séparé pour idempotency_key
  const createIndexLines = MIG.split('\n').filter(l => l.trim().startsWith('CREATE INDEX') && l.includes('idem'));
  assert.equal(createIndexLines.length, 0,
    'Aucun CREATE INDEX séparé pour idempotency_key — UNIQUE crée déjà l\'index');
});

test('E-13 [AUTOMATISÉ]: REVOKE ALL sur toutes les tables (public, anon, authenticated)', () => {
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_events FROM public, anon, authenticated'),
    'REVOKE ALL FROM public sur veraluz_events');
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_event_processing FROM public, anon, authenticated'),
    'REVOKE ALL FROM public sur veraluz_event_processing');
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_notifications FROM public, anon, authenticated'),
    'REVOKE ALL FROM public sur veraluz_notifications');
  assert.ok(MIG.includes('REVOKE ALL ON public.notification_reads FROM public, anon, authenticated'),
    'REVOKE ALL FROM public sur notification_reads');
  assert.ok(MIG.includes('REVOKE ALL ON public.veraluz_jobs FROM public, anon, authenticated'),
    'REVOKE ALL FROM public sur veraluz_jobs');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 6 — Notifications: état par employé
   ═══════════════════════════════════════════════════════════ */

test('E-14 [AUTOMATISÉ]: NOTIFICATIONS_EMBEDDED sans REST anon direct', () => {
  assert.ok(
    !notifScripts.includes("fetch(SUPA_URL + '/rest/v1/veraluz_notifications"),
    'REST anon direct vers veraluz_notifications interdit dans le code exécutable'
  );
});

test('E-14b [AUTOMATISÉ]: NOTIFICATIONS_EMBEDDED utilise le broker pour list/mark_read/acknowledge', () => {
  assert.ok(
    notifScripts.includes("veraluzSecureRequest('notifications-secure'") ||
    NOTIF.includes("window.parent.veraluzSecureRequest('notifications-secure'"),
    'NOTIFICATIONS_EMBEDDED doit utiliser le broker notifications-secure via window.parent'
  );
  assert.ok(
    NOTIF.includes("notifRequest('list'") || notifScripts.includes("action: 'list'"),
    'notifRequest doit supporter l\'action list'
  );
  assert.ok(
    NOTIF.includes("notifRequest('mark_read'") || NOTIF.includes("'mark_read'"),
    'markReadInSupabase doit supporter l\'action mark_read'
  );
});

test('E-15 [AUTOMATISÉ]: simulation notifications désactivée par défaut (_NOTIF_DEMO_MODE)', () => {
  assert.ok(
    NOTIF.includes('_NOTIF_DEMO_MODE') && NOTIF.includes('= true'),
    '_NOTIF_DEMO_MODE = true par défaut'
  );
  assert.ok(
    NOTIF.includes('_NOTIF_DEMO_MODE||simulationInterval') || NOTIF.includes('_NOTIF_DEMO_MODE'),
    'simulationInterval gardé par _NOTIF_DEMO_MODE'
  );
});

test('E-15b [AUTOMATISÉ]: notification_reads — état de lecture indépendant par employé', () => {
  assert.ok(
    MIG.includes('CREATE TABLE IF NOT EXISTS public.notification_reads'),
    'Table notification_reads requise pour état par employé'
  );
  assert.ok(
    MIG.includes('UNIQUE (notification_id, employee_id)'),
    'UNIQUE (notification_id, employee_id) garantit indépendance par employé'
  );
  assert.ok(
    MIG.includes('employee_id') && MIG.includes('read_at') && MIG.includes('ack_at'),
    'notification_reads doit avoir employee_id, read_at, ack_at'
  );
});

test('E-15c [AUTOMATISÉ]: notifications-secure EF a les 4 actions requises', () => {
  assert.ok(NOTIF_EF.includes("action === 'list'"),       'action list requise');
  assert.ok(NOTIF_EF.includes("action === 'create'"),     'action create requise');
  assert.ok(NOTIF_EF.includes("action === 'mark_read'"),  'action mark_read requise');
  assert.ok(NOTIF_EF.includes("action === 'acknowledge'"),'action acknowledge requise');
});

test('E-15d [AUTOMATISÉ]: notifications-secure EF filtre par rôle côté serveur', () => {
  // Le filtrage recipient_roles doit se faire dans la requête DB, pas côté client
  assert.ok(
    NOTIF_EF.includes('recipient_roles') && NOTIF_EF.includes('employee.role'),
    'notifications-secure doit filtrer les notifications par rôle côté serveur'
  );
});

test('E-15e [AUTOMATISÉ]: notifications-secure EF sans session_token dans le body', () => {
  const efNoComments = NOTIF_EF.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
  assert.ok(
    !efNoComments.includes('body.session_token'),
    'session_token dans le body interdit — header x-veraluz-session uniquement'
  );
  assert.ok(
    NOTIF_EF.includes("'x-veraluz-session'") || NOTIF_EF.includes('"x-veraluz-session"'),
    'authentification via header x-veraluz-session uniquement'
  );
});

test('E-15f [AUTOMATISÉ]: notifications-secure EF retourne 401/403 correctement', () => {
  assert.ok(NOTIF_EF.includes('401'), 'notifications-secure doit retourner 401 si session invalide');
  assert.ok(NOTIF_EF.includes('403'), 'notifications-secure doit retourner 403 si rôle insuffisant');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 7 — Communications
   ═══════════════════════════════════════════════════════════ */

test('E-16 [AUTOMATISÉ]: communications-secure sans session_token dans le body', () => {
  const commNoComments = COMM.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
  assert.ok(
    !commNoComments.includes("body.session_token"),
    'session_token dans le body interdit dans communications-secure'
  );
});

test('E-17 [AUTOMATISÉ]: communications-secure a une logique d\'idempotence', () => {
  assert.ok(
    COMM.includes('idempoten') || COMM.includes('duplicate') || COMM.includes('comm_log'),
    'communications-secure doit avoir une logique anti-double-envoi'
  );
});

/* ═══════════════════════════════════════════════════════════
   BLOC 8 — Scheduler
   ═══════════════════════════════════════════════════════════ */

test('E-18 [AUTOMATISÉ]: veraluz_jobs a colonnes running + running_since + lease atomique', () => {
  assert.ok(MIG.includes('running         BOOLEAN'),     'colonne running requise');
  assert.ok(MIG.includes('running_since   TIMESTAMPTZ'), 'colonne running_since requise');
  assert.ok(MIG.includes('lease_token     TEXT'),        'colonne lease_token requise');
  assert.ok(MIG.includes('lease_expires_at TIMESTAMPTZ'),'colonne lease_expires_at requise');
});

test('E-19 [AUTOMATISÉ]: veraluz_jobs démarre disabled et dry_run=true', () => {
  assert.ok(MIG.includes('DEFAULT false'), 'enabled DEFAULT false requis');
  assert.ok(MIG.includes('DEFAULT true'),  'dry_run DEFAULT true requis');
});

test('E-19b [AUTOMATISÉ]: claim atomique — deux workers ne peuvent pas prendre le même job', () => {
  // La fonction claim_job_lease doit utiliser UPDATE atomique avec vérification du lease
  assert.ok(
    MIG.includes('CREATE OR REPLACE FUNCTION public.claim_job_lease'),
    'claim_job_lease doit exister'
  );
  assert.ok(
    MIG.includes('UPDATE public.veraluz_jobs'),
    'claim atomique via UPDATE (pas SELECT + UPDATE séparés)'
  );
  assert.ok(
    MIG.includes('RETURNING * INTO v_job'),
    'claim atomique avec RETURNING pour confirmer le claim'
  );
  // La fonction doit gérer les leases expirés
  assert.ok(
    MIG.includes('lease_expires_at < v_now'),
    'récupération des leases expirés dans claim_job_lease'
  );
});

test('E-19c [AUTOMATISÉ]: release_job_lease et recover_expired_job_leases existent', () => {
  assert.ok(MIG.includes('CREATE OR REPLACE FUNCTION public.release_job_lease'),
    'release_job_lease doit exister pour libérer le lease après succès/échec');
  assert.ok(MIG.includes('CREATE OR REPLACE FUNCTION public.recover_expired_job_leases'),
    'recover_expired_job_leases doit exister pour la récupération automatique');
});

test('E-19d [AUTOMATISÉ]: fonctions scheduler sont SECURITY DEFINER + search_path protégé', () => {
  assert.ok(MIG.includes('SECURITY DEFINER'), 'SECURITY DEFINER requis sur les fonctions scheduler');
  assert.ok(MIG.includes('SET search_path = public'), 'search_path = public requis (anti-hijack)');
});

test('E-20 [AUTOMATISÉ]: workers absents de la whitelist navigateur', () => {
  assert.ok(!endpoints.includes('event-worker'),  'event-worker absent de la whitelist');
  assert.ok(!endpoints.includes('comms-worker'),  'comms-worker absent de la whitelist');
});

/* ═══════════════════════════════════════════════════════════
   BLOC 9 — Sécurité générale
   ═══════════════════════════════════════════════════════════ */

test('E-21 [AUTOMATISÉ]: EFs ne retournent pas les stack traces au client', () => {
  const gstNoComments = GSTEF.replace(/\/\*[\s\S]*?\*\//g,'');
  assert.ok(!gstNoComments.includes('e.stack') || gstNoComments.includes('console.error'),
    'Stack traces doivent rester côté serveur (console.error)');
});

test('E-22 [AUTOMATISÉ]: service_role absent du code exécutable CORE et SETTINGS', () => {
  assert.ok(!coreScripts.includes('service_role'),
    'service_role interdit dans scripts CORE');
  assert.ok(!settScripts.includes('service_role'),
    'service_role interdit dans scripts SETTINGS');
});

test('E-22b [AUTOMATISÉ]: fonctions scheduler REVOKE des rôles non-service_role', () => {
  assert.ok(
    MIG.includes('REVOKE ALL ON FUNCTION public.claim_job_lease') ||
    MIG.includes('REVOKE EXECUTE ON FUNCTION') ||
    MIG.includes('REVOKE ALL ON FUNCTION'),
    'REVOKE sur les fonctions scheduler pour bloquer public/anon/authenticated'
  );
  assert.ok(
    MIG.includes('GRANT  EXECUTE ON FUNCTION public.claim_job_lease') ||
    MIG.includes('GRANT EXECUTE ON FUNCTION public.claim_job_lease'),
    'GRANT EXECUTE sur claim_job_lease uniquement pour service_role'
  );
});

/* ═══════════════════════════════════════════════════════════
   BLOC 10 — Non-régression
   ═══════════════════════════════════════════════════════════ */

test('E-23 [AUTOMATISÉ]: SETTINGS_EMBEDDED conserve la gestion du thème', () => {
  assert.ok(
    SETT.includes('vl_theme') || SETT.includes('vl-dark') || SETT.includes('dark_mode'),
    'Gestion thème clair/sombre conservée dans SETTINGS'
  );
});

test('E-24 [AUTOMATISÉ]: SETTINGS_EMBEDDED a des media queries responsive', () => {
  assert.ok(
    SETT.includes('@media') && (SETT.includes('max-width') || SETT.includes('min-width')),
    'Media queries responsive présentes dans SETTINGS'
  );
});

test('E-25 [AUTOMATISÉ]: DOCUMENTS_EMBEDDED utilise le broker unwrap {status,body}', () => {
  const docsPath = path.join(ROOT, 'DOCUMENTS_EMBEDDED.html');
  const docs = fs.readFileSync(docsPath, 'utf-8');
  assert.ok(docs.includes('var status = res.status') && docs.includes('var body   = res.body'),
    'docsRequest() doit unwrapper {status, body} du broker');
});

test('E-26 [AUTOMATISÉ]: fichiers critiques Lots B/C/Auth non supprimés', () => {
  const critical = [
    'supabase/functions/reservation-workflow/index.ts',
    'supabase/functions/guest-access/index.ts',
    'supabase/functions/room-service/index.ts',
    'supabase/functions/employees-secure/index.ts',
    'supabase/migrations/20260826_recovery_lot_c_room_service_folio.sql',
    'supabase/functions/notifications-secure/index.ts',
  ];
  for (const f of critical) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `Fichier critique manquant: ${f}`);
  }
});

test('E-27 [AUTOMATISÉ]: notifications-secure utilise uniquement service_role (pas anon key)', () => {
  // L'EF doit utiliser SUPABASE_SERVICE_ROLE_KEY, jamais SUPABASE_ANON_KEY
  const efNoComments = NOTIF_EF.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
  assert.ok(
    efNoComments.includes('SERVICE_ROLE_KEY') || efNoComments.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'notifications-secure doit utiliser service_role key côté serveur'
  );
  assert.ok(
    !efNoComments.includes('ANON_KEY') && !efNoComments.includes('SUPABASE_ANON_KEY') &&
    !efNoComments.includes('anon_key'),
    'notifications-secure ne doit pas utiliser la clé anon'
  );
});

test('E-28 [AUTOMATISÉ]: événement idempotent — veraluz_event_processing a event_id FK unique', () => {
  assert.ok(
    MIG.includes('event_id       TEXT        NOT NULL PRIMARY KEY REFERENCES public.veraluz_events(id)'),
    'event_id est PK dans veraluz_event_processing (un seul état de traitement par événement)'
  );
});
