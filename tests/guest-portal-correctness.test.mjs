import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const portal = readFileSync(new URL('../GUEST_PORTAL.html', import.meta.url), 'utf8');
const guestAccess = readFileSync(
  new URL('../supabase/functions/guest-access/index.ts', import.meta.url),
  'utf8',
);
const settingsSecure = readFileSync(
  new URL('../supabase/functions/settings-secure/index.ts', import.meta.url),
  'utf8',
);
const reservations = readFileSync(
  new URL('../RESERVATIONS_EMBEDDED.html', import.meta.url),
  'utf8',
);
const wifiPrivacyMigration = readFileSync(
  new URL('../supabase/migrations/20260818_guest_wifi_privacy.sql', import.meta.url),
  'utf8',
);

test('RLS cible: anon et authenticated ne lisent pas directement la ligne wifi', () => {
  assert.match(
    wifiPrivacyMigration,
    /to anon[\s\S]*'admin'::text, 'email'::text, 'wifi'::text/,
  );
  assert.match(
    wifiPrivacyMigration,
    /to authenticated[\s\S]*key <> 'wifi'::text/,
  );
});

test('Guest Portal: aucun accès direct à veraluz_settings', () => {
  assert.doesNotMatch(portal, /veraluz_settings/);
  assert.match(guestAccess, /function loadSettings\(db: any\)/);
  assert.match(guestAccess, /\.from\('veraluz_settings'\)/);
});

test('Settings: employé autorisé et schéma enabled/ssid/password préservés', () => {
  const saveWifi = reservations.match(
    /function saveWifiSettings\(\)[\s\S]*?(?=function renderRestaurantCard)/,
  )?.[0] ?? '';
  assert.match(settingsSecure, /validateEmployeeSession\(db, sessionToken\)/);
  assert.match(settingsSecure, /DIRECTION_ROLES\.has\(role\)/);
  assert.match(settingsSecure, /'property','contact','booking','wifi','restaurant','branding'/);
  assert.match(saveWifi, /ssid:/);
  assert.match(saveWifi, /password:/);
  assert.match(saveWifi, /enabled:/);
  assert.match(saveWifi, /sbPatchSettings\('wifi', obj/);
  assert.match(reservations, /veraluzSecureRequest\('settings-secure',[\s\S]*action:'get_settings'/);
  assert.doesNotMatch(reservations, /rest\/v1\/veraluz_settings\?key=in\.\(booking,wifi/);
});

test('Settings public: password masqué et valeur existante préservée si champ vide', () => {
  assert.match(settingsSecure, /const \{ password: _password, \.\.\.publicWifi \} = wifi/);
  assert.match(settingsSecure, /password_configured: typeof _password === 'string'/);
  assert.match(
    settingsSecure,
    /key === 'wifi'[\s\S]*value\.password === ''[\s\S]*merged\.password = existing\.value\.password/,
  );
});

test('Guest confirmed: password absent', () => {
  assert.match(guestAccess, /const canSeePassword\s+= resStatus === 'checkedin'/);
  assert.match(guestAccess, /password:\s*passwordAvailable \? wifiPassword : null/);
});

test('Guest checkedin configuré: password disponible', () => {
  assert.match(guestAccess, /passwordAvailable = canSeePassword && wifiPassword\.length > 0/);
  assert.match(guestAccess, /password_available:\s*passwordAvailable/);
});

test('Guest checkedout: password absent et get_my_stay reste séjour-actif', () => {
  assert.match(guestAccess, /const canSeePassword\s+= resStatus === 'checkedin'/);
  assert.doesNotMatch(guestAccess, /const canSeePassword\s+= resStatus === 'checkedout'/);
});

test('Aucun raw password dans logs, erreurs ou analytics', () => {
  const relevantSources = [guestAccess, settingsSecure, portal, reservations].join('\n');
  assert.doesNotMatch(
    relevantSources,
    /console\.(?:log|info|warn|error|debug)\([^\n]*(?:wifiPassword|wifi\.password|value\.password)/i,
  );
  assert.doesNotMatch(relevantSources, /analytics[^\n]*(?:wifiPassword|wifi\.password|value\.password)/i);
  assert.doesNotMatch(relevantSources, /error[^\n]*(?:wifiPassword|wifi\.password|value\.password)/i);
});

test('Nom legacy elono gregoire: Elono Gregoire', () => {
  assert.match(
    guestAccess,
    /\.map\(\(part: string\) => part \? part\.charAt\(0\)\.toUpperCase\(\) \+ part\.slice\(1\) : ''\)/,
  );
  const formatted = 'elono gregoire'
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .join(' ');
  assert.equal(formatted, 'Elono Gregoire');
  assert.match(guestAccess, /guest_display_name:\s*displayName/);
  assert.match(portal, /stay\.guest_display_name\|\|stay\.guest_first_name/);
});

test('Payments: zéro sans signe, positif avec déduction', () => {
  const expression = portal.match(
    /folio-payments-val'\)\.textContent=(s\.payments>0\?'-'\+fmt\(s\.payments\):fmt\(0\))/,
  )?.[1];
  assert.ok(expression, 'payment rendering expression must exist');
  const renderPayment = new Function('s', 'fmt', `return ${expression};`);
  const fmt = (value) => `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
  assert.equal(renderPayment({ payments: 0 }, fmt), '0 FCFA');
  assert.equal(renderPayment({ payments: 102000 }, fmt), '-102 000 FCFA');
});

test('Checkedin non configuré: aucun faux message de pré-arrivée', () => {
  assert.match(
    portal,
    /stay\.reservation_status==='checkedin'\?"L'accès Wi-Fi n'est pas encore configuré/,
  );
});
