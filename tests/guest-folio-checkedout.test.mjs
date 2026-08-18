import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../supabase/functions/guest-access/index.ts', import.meta.url),
  'utf8',
);
const portal = fs.readFileSync(
  new URL('../GUEST_PORTAL.html', import.meta.url),
  'utf8',
);

const validator = source.match(
  /async function validateGuestToken[\s\S]*?return \{ error: null, session, reservationStatus: res\.status \};\s*\}/,
)?.[0] ?? '';
const folioHandler = source.match(
  /if \(action === 'get_my_folio'\) \{[\s\S]*?\/\/ ── CHECKEDIN \/ CHECKEDOUT/,
)?.[0] ?? '';

assert.match(
  validator,
  /allowedReservationStatuses: string\[\] = \['confirmed','checkedin'\]/,
  'Les endpoints séjour-actif doivent rester limités à confirmed/checkedin par défaut.',
);
assert.match(
  validator,
  /allowedReservationStatuses\.includes\(res\.status\)/,
  'Le validateur doit appliquer explicitement la liste de statuts autorisés.',
);
assert.match(
  folioHandler,
  /validateGuestToken\([\s\S]*?\['confirmed','checkedin','checkedout'\][\s\S]*?\)/,
  'get_my_folio doit être le seul parcours à étendre la validation à checkedout.',
);
assert.match(
  folioHandler,
  /const reservationId = session!\.reservation_id/,
  'Le Folio doit résoudre reservation_id depuis la guest_session serveur.',
);
assert.doesNotMatch(
  folioHandler,
  /body\.(reservation_id|folio_id|unit_id)/,
  'Le client ne doit choisir aucun identifiant métier du Folio.',
);
assert.match(
  portal,
  /function openCheckedoutFolio\(tok\)[\s\S]*?action:'get_my_folio'[\s\S]*?reservation\.status!=='checkedout'/,
  'Le portail doit ouvrir un mode Folio uniquement après validation serveur du checkout.',
);
assert.doesNotMatch(
  portal.match(/function openCheckedoutFolio\(tok\)[\s\S]*?\n\}/)?.[0] ?? '',
  /get_my_stay|get_restaurant_menu|create_restaurant_order|wifi\.password/,
  'Le mode checkout ne doit rouvrir aucune fonction réservée au séjour actif.',
);
assert.match(
  portal,
  /folio-other-card'\)\.style\.display='';[\s\S]*?folio-other-amt'\)\.textContent=fmt\(s\.other\)/,
  'Le montant Autres charges doit rester visible même lorsqu’il vaut zéro.',
);

console.log('PASS guest folio checkedout ciblé: accès Folio étendu, endpoints séjour-actif inchangés.');
