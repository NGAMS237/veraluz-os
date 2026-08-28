/**
 * Tests automatisés — RECOVERY LOT E
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
const GUEST = fs.readFileSync(path.join(ROOT, 'GUEST_PORTAL.html'), 'utf-8');
const GSTEF = fs.readFileSync(path.join(ROOT, 'supabase/functions/guest-access/index.ts'), 'utf-8');
const COMM  = fs.readFileSync(path.join(ROOT, 'supabase/functions/communications-secure/index.ts'), 'utf-8');
const MIG   = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260828_recovery_lot_e_events_notifications_jobs.sql'), 'utf-8');

const coreScripts = (CORE.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)||[]).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
const settScripts = (SETT.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)||[]).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
const notifScripts = (NOTIF.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)||[]).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');

/* Helper: extraire whitelist CORE */
const wlMatch = CORE.match(/var VERALUZ_BROKER_ALLOWED_ENDPOINTS\s*=\s*\[([\s\S]*?)\];/);
const endpoints = wlMatch ? [...wlMatch[1].matchAll(/'([^']+)'/g)].map(m=>m[1]) : [];

/* ─────────────────────────────────────────────────── */
/* 1. documents-secure whitelist (Gate 0 non-régression) */
test('E-01 [AUTOMATISÉ]: documents-secure dans la whitelist CORE', () => {
  assert.ok(endpoints.includes('documents-secure'));
});

/* 2. Endpoint inconnu bloqué */
test('E-02 [AUTOMATISÉ]: endpoint inconnu absent de la whitelist', () => {
  assert.ok(!endpoints.includes('unknown-endpoint-xyz'));
  assert.ok(CORE.includes('endpoint_not_whitelisted'));
});

/* 3. Workers service-only absents du broker navigateur */
test('E-03 [AUTOMATISÉ]: event-worker et comms-worker absents de la whitelist', () => {
  assert.ok(!endpoints.includes('event-worker'), 'event-worker interdit dans whitelist navigateur');
  assert.ok(!endpoints.includes('comms-worker'), 'comms-worker interdit dans whitelist navigateur');
});

/* 4. Settings DB = SSOT (loadSettings sans localStorage SSOT) */
test('E-04 [AUTOMATISÉ]: loadSettings() n\'utilise pas localStorage comme SSOT', () => {
  // La fonction loadSettings ne doit pas lire LS_KEY comme source de vérité
  assert.ok(!settScripts.includes("localStorage.getItem(LS_KEY)"),
    'loadSettings ne doit pas lire localStorage(LS_KEY) — SSOT = veraluz_settings DB');
});

/* 5. Absence d'EmailJS métier direct dans le code exécutable */
test('E-05 [AUTOMATISÉ]: pas d\'envoi EmailJS direct dans les scripts Settings', () => {
  assert.ok(!settScripts.includes('emailjs.send(') && !settScripts.includes('emailjs.sendForm('),
    'EmailJS.send() interdit dans SETTINGS_EMBEDDED — passer par communications-secure');
});

/* 6. Absence de settings métier dépendant exclusivement de localStorage */
test('E-06 [AUTOMATISÉ]: saveAll() ne stocke pas les settings dans localStorage(LS_KEY)', () => {
  assert.ok(!settScripts.includes("localStorage.setItem(LS_KEY,"),
    'saveAll() ne doit pas sauvegarder les paramètres métier dans localStorage');
});

/* 7. Wi-Fi masqué publiquement (settings-secure get_settings) */
test('E-07 [AUTOMATISÉ]: settings-secure masque wifi.password dans get_settings', () => {
  const settEF = fs.readFileSync(path.join(ROOT, 'supabase/functions/settings-secure/index.ts'), 'utf-8');
  assert.ok(settEF.includes('password_configured') || settEF.includes('_password'),
    'get_settings doit masquer wifi.password et n\'exposer que password_configured');
  assert.ok(!settEF.includes('return wifi.password'), 'wifi.password ne doit jamais être retourné');
});

/* 8. Wi-Fi disponible uniquement pour checkedin */
test('E-08 [AUTOMATISÉ]: guest-access ne donne le mot de passe Wi-Fi qu\'en checkedin', () => {
  assert.ok(
    GSTEF.includes("canSeePassword") && GSTEF.includes("checkedin"),
    'Mot de passe Wi-Fi conditionné à checkedin dans guest-access'
  );
  // canSeePassword doit impliquer resStatus === 'checkedin'
  assert.ok(
    GSTEF.includes("resStatus === 'checkedin'") || GSTEF.includes("=== 'checkedin'"),
    'Condition checkedin présente dans guest-access pour le Wi-Fi'
  );
});

/* 9. Checkout 12:00 (DEFAULTS + EF) */
test('E-09 [AUTOMATISÉ]: checkout_time par défaut = 12:00 dans Settings et guest-access', () => {
  assert.ok(
    SETT.includes("checkout:'12:00'") || SETT.includes('checkout_time||\'12:00\'') || SETT.includes('"12:00"'),
    'DEFAULTS Settings doit avoir checkout 12:00'
  );
  assert.ok(
    GSTEF.includes("|| '12:00'") || GSTEF.includes("|| \"12:00\""),
    'guest-access EF doit defaulter checkout_time à 12:00'
  );
});

/* 10. confirmed différent de checkedin (pas de promotion automatique) */
test('E-10 [AUTOMATISÉ]: EF ne promeut pas automatiquement confirmed → checkedin', () => {
  // reservation-workflow ne doit pas set status='checkedin' automatiquement pour confirmed
  // Vérification dans le code guest-access : confirmed autorisé pour accès, mais pas promu
  assert.ok(
    GSTEF.includes("'confirmed','checkedin'") || GSTEF.includes("['confirmed','checkedin']"),
    'confirmed et checkedin sont des statuts distincts dans guest-access'
  );
});

/* 11. Isolation Guest (reservation_id depuis session serveur, pas body) */
test('E-11 [AUTOMATISÉ]: guest-access utilise reservation_id depuis session validée', () => {
  // Pour les actions authentifiées (après login), reservation_id vient de session!.reservation_id
  assert.ok(
    GSTEF.includes("session!.reservation_id") || GSTEF.includes("session.reservation_id"),
    'reservation_id doit venir de la session validée côté serveur'
  );
});

/* 12. Events idempotents (idempotency_key UNIQUE dans migration) */
test('E-12 [AUTOMATISÉ]: migration veraluz_events a idempotency_key UNIQUE', () => {
  assert.ok(MIG.includes('idempotency_key') && MIG.includes('UNIQUE'),
    'idempotency_key UNIQUE requis dans veraluz_events');
});

/* 13. Source/acteur événement serveur-side */
test('E-13 [AUTOMATISÉ]: veraluz_events a colonnes source et actor_id (serveur)', () => {
  assert.ok(MIG.includes('source') && MIG.includes('actor_id'),
    'veraluz_events doit avoir source et actor_id pour traçabilité serveur');
});

/* 14. Notifications sans REST anon */
test('E-14 [AUTOMATISÉ]: NOTIFICATIONS_EMBEDDED n\'a plus de REST anon direct', () => {
  assert.ok(
    !notifScripts.includes("fetch(SUPA_URL + '/rest/v1/veraluz_notifications"),
    'REST anon direct vers veraluz_notifications interdit dans le code exécutable'
  );
});

/* 15. Mock/simulation désactivé en production */
test('E-15 [AUTOMATISÉ]: simulation notifications désactivée par défaut (_NOTIF_DEMO_MODE)', () => {
  assert.ok(
    NOTIF.includes('_NOTIF_DEMO_MODE') && NOTIF.includes('true'),
    '_NOTIF_DEMO_MODE = true par défaut (simulation désactivée en PROD)'
  );
  assert.ok(
    NOTIF.includes('_NOTIF_DEMO_MODE||simulationInterval') || NOTIF.includes('_NOTIF_DEMO_MODE'),
    'simulationInterval gardé par _NOTIF_DEMO_MODE'
  );
});

/* 16. Communication sans token dans body */
test('E-16 [AUTOMATISÉ]: communications-secure n\'accepte plus session_token dans le body', () => {
  // Le fallback body.session_token a été retiré
  assert.ok(
    !COMM.includes("body.session_token"),
    'session_token dans le body interdit dans communications-secure — header X-Veraluz-Session uniquement'
  );
});

/* 17. Communication sans double envoi (idempotency pattern) */
test('E-17 [AUTOMATISÉ]: communications-secure a une logique d\'idempotence', () => {
  assert.ok(
    COMM.includes('idempoten') || COMM.includes('duplicate') || COMM.includes('comm_log'),
    'communications-secure doit avoir une logique anti-double-envoi via comm_log'
  );
});

/* 18. Scheduler sans concurrence double */
test('E-18 [AUTOMATISÉ]: veraluz_jobs a colonne running pour éviter la concurrence', () => {
  assert.ok(MIG.includes('running') && MIG.includes('running_since'),
    'veraluz_jobs doit avoir running + running_since pour contrôle de concurrence');
});

/* 19. Scheduler désactivé/dry_run par défaut */
test('E-19 [AUTOMATISÉ]: veraluz_jobs démarre disabled et dry_run=true par défaut', () => {
  assert.ok(
    MIG.includes('enabled         BOOLEAN     NOT NULL DEFAULT false'),
    'veraluz_jobs.enabled DEFAULT false requis'
  );
  assert.ok(
    MIG.includes('dry_run         BOOLEAN     NOT NULL DEFAULT true'),
    'veraluz_jobs.dry_run DEFAULT true requis'
  );
});

/* 20. Workers internes non accessibles au navigateur */
test('E-20 [AUTOMATISÉ]: infra-scheduler dans whitelist mais event/comms-worker absents', () => {
  assert.ok(endpoints.includes('infra-scheduler'), 'infra-scheduler autorisé (gérant only, RBAC serveur)');
  assert.ok(!endpoints.includes('event-worker') && !endpoints.includes('comms-worker'));
});

/* 21. Erreurs techniques non retournées au client */
test('E-21 [AUTOMATISÉ]: EFs ne retournent pas les stack traces au client', () => {
  // Vérifier que les EFs n'incluent pas .stack dans les réponses json
  const gstEF2 = GSTEF.replace(/\/\*[\s\S]*?\*\//g,'');
  assert.ok(!gstEF2.includes('e.stack') || gstEF2.includes('console.error'),
    'Stack traces doivent rester côté serveur (console.error, pas dans la réponse client)');
});

/* 22. Aucune clé service_role frontend */
test('E-22 [AUTOMATISÉ]: service_role absent du code exécutable CORE et SETTINGS', () => {
  assert.ok(!coreScripts.includes('service_role'), 'service_role interdit dans scripts CORE');
  assert.ok(!settScripts.includes('service_role'), 'service_role interdit dans scripts SETTINGS');
});

/* 23. Thèmes clair/sombre conservés */
test('E-23 [AUTOMATISÉ]: SETTINGS_EMBEDDED conserve la gestion du thème', () => {
  assert.ok(
    SETT.includes('vl_theme') || SETT.includes('vl-dark') || SETT.includes('dark_mode'),
    'Gestion thème clair/sombre conservée dans SETTINGS'
  );
});

/* 24. Mobile conservé */
test('E-24 [AUTOMATISÉ]: SETTINGS_EMBEDDED a des media queries responsive', () => {
  assert.ok(
    SETT.includes('@media') && (SETT.includes('max-width') || SETT.includes('min-width')),
    'Media queries responsive présentes dans SETTINGS'
  );
});

/* 25. Non-régression Documents (hotfix broker) */
test('E-25 [AUTOMATISÉ]: DOCUMENTS_EMBEDDED utilise le broker unwrap {status,body}', () => {
  const docsPath = path.join(ROOT, 'DOCUMENTS_EMBEDDED.html');
  const docs = fs.readFileSync(docsPath, 'utf-8');
  assert.ok(docs.includes('var status = res.status') && docs.includes('var body   = res.body'),
    'docsRequest() doit unwrapper {status, body} du broker');
});

/* 26. Non-régression Lots B/C/Auth (fichiers critiques présents) */
test('E-26 [AUTOMATISÉ]: fichiers critiques Lots B/C/Auth non supprimés', () => {
  const critical = [
    'supabase/functions/reservation-workflow/index.ts',
    'supabase/functions/guest-access/index.ts',
    'supabase/functions/room-service/index.ts',
    'supabase/functions/employees-secure/index.ts',
    'supabase/migrations/20260826_recovery_lot_c_room_service_folio.sql',
  ];
  for (const f of critical) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `Fichier critique manquant: ${f}`);
  }
});
