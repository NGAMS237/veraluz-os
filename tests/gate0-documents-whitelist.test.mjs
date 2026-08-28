/**
 * Gate 0 — Whitelist documents-secure dans CORE broker
 * node --test tests/gate0-documents-whitelist.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CORE = fs.readFileSync(path.join(ROOT, 'VERALUZ_OS_CORE.html'), 'utf-8');
const SW   = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf-8');

/* Extraire la whitelist depuis le source */
const wlMatch = CORE.match(/var VERALUZ_BROKER_ALLOWED_ENDPOINTS\s*=\s*\[([\s\S]*?)\];/);
assert.ok(wlMatch, 'VERALUZ_BROKER_ALLOWED_ENDPOINTS introuvable dans CORE');
const wlBlock = wlMatch[1];
const endpoints = [...wlBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);

/* G0-01 — documents-secure autorisé */
test('G0-01: documents-secure est dans la whitelist', () => {
  assert.ok(endpoints.includes('documents-secure'),
    `documents-secure absent. Whitelist: ${endpoints.join(', ')}`);
});

/* G0-02 — endpoint inconnu rejeté (logique broker) */
test('G0-02: endpoint inconnu absent de la whitelist', () => {
  assert.ok(!endpoints.includes('unknown-endpoint-xyz'));
  assert.ok(!endpoints.includes('hack-endpoint'));
});

/* G0-03 — workers internes absents */
test('G0-03: event-worker et comms-worker absents de la whitelist navigateur', () => {
  assert.ok(!endpoints.includes('event-worker'),
    'event-worker ne doit pas être accessible via le broker navigateur');
  assert.ok(!endpoints.includes('comms-worker'),
    'comms-worker ne doit pas être accessible via le broker navigateur');
});

/* G0-04 — veraluz-document-upload absent de la whitelist (broker multipart dédié) */
test('G0-04: veraluz-document-upload absent de la whitelist broker JSON', () => {
  assert.ok(!endpoints.includes('veraluz-document-upload'),
    'veraluz-document-upload doit utiliser son broker multipart dédié, pas la whitelist JSON');
  // Vérifier que le broker multipart dédié existe bien dans CORE
  assert.ok(
    CORE.includes('veraluzUploadDocument') || CORE.includes('veraluz-document-upload'),
    'broker multipart veraluzUploadDocument doit exister dans CORE'
  );
});

/* G0-05 — aucune clé service_role dans le code exécutable (commentaires tolérés) */
test('G0-05: service_role absent du code exécutable des <script> du CORE', () => {
  const scripts = (CORE.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
  // Supprimer les commentaires JS (/* ... */ et // ...) avant de chercher
  const stripped = scripts
    .replace(/\/\*[\s\S]*?\*\//g, '')   // commentaires bloc
    .replace(/\/\/.*/g, '');              // commentaires ligne
  assert.ok(!stripped.includes('service_role'),
    'service_role interdit dans le code exécutable du CORE navigateur (hors commentaires)');
});

/* G0-06 — broker logique : rejet si endpoint non whitélisté */
test('G0-06: code broker contient la vérification indexOf/whitelist', () => {
  assert.ok(
    CORE.includes('endpoint_not_whitelisted') &&
    (CORE.includes('indexOf(endpoint)') || CORE.includes("indexOf(endpoint) === -1")),
    'Logique de rejet whitelist absente du broker CORE'
  );
});

/* G0-07 — cache PWA v037 */
test('G0-07: sw.js CACHE_NAME = veraluz-pwa-v037-lot-e', () => {
  assert.ok(SW.includes("CACHE_NAME = 'veraluz-pwa-v037-lot-e'"),
    'CACHE_NAME doit être veraluz-pwa-v037-lot-e');
  assert.ok(!SW.includes('veraluz-pwa-v036'), 'Ancienne valeur v036 encore présente');
});

/* G0-08 — non-régression : les endpoints précédents toujours présents */
test('G0-08: endpoints critiques précédents toujours dans la whitelist', () => {
  const required = [
    'settings-secure', 'guest-access', 'room-service',
    'communications-secure', 'employees-secure', 'reservation-workflow',
    'messages-secure', 'post-restaurant-folio', 'infra-health', 'infra-scheduler'
  ];
  for (const ep of required) {
    assert.ok(endpoints.includes(ep), `Endpoint requis manquant: ${ep}`);
  }
});
