import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const restaurant = fs.readFileSync(path.join(root, 'RESTAURANT_EMBEDDED.html'), 'utf8')
  .replace(/\r\n/g, '\n');

let passed = 0;
let failed = 0;
function test(name, condition) {
  if (condition) {
    console.log(`  PASS ${name}`);
    passed += 1;
  } else {
    console.log(`  FAIL ${name}`);
    failed += 1;
  }
}

function functionBlock(name, nextName) {
  const start = restaurant.indexOf(`function ${name}(`);
  const end = restaurant.indexOf(`function ${nextName}(`, start);
  return start >= 0 && end > start ? restaurant.slice(start, end) : '';
}

const loadDrivers = functionBlock('loadLivraisonsLivreurs', 'renderLivraisonsLivreurs');
const renderDrivers = functionBlock('renderLivraisonsLivreurs', 'openLivraisonDetail');
const renderToday = functionBlock('renderLivraisonsJour', 'loadLivraisonsDate');
const loadHistory = functionBlock('loadLivraisonsDate', 'loadLivraisonsLivreurs');
const detail = functionBlock('openLivraisonDetail', 'loadDeliveryEventsInModal');
const sendMessage = functionBlock('sendLivraisonMsg', 'closeMd');

test('SCHEMA-01 aucune référence legacy active dans Restaurant',
  !/assigned_livreur_(?:id|name)/.test(restaurant));
test('DRIVERS-01 projection Livreurs utilise les colonnes canoniques',
  /select=id,livreur_id,assigned_to,status,delivery_status,delivered_at,created_at/.test(loadDrivers));
test('DRIVERS-02 regroupement utilise livreur_id et assigned_to',
  /var lid=o\.livreur_id\|\|'none'/.test(renderDrivers)
    && /var lname=o\.assigned_to\|\|'Non assigné'/.test(renderDrivers));
test('TODAY-01 Aujourd’hui affiche assigned_to',
  /o\.assigned_to\?'<span>🚚 '/.test(renderToday));
test('HISTORY-01 Historique affiche assigned_to',
  /o\.assigned_to\?'<span>🚚 '/.test(loadHistory));
test('DETAIL-01 détail affiche assigned_to',
  /o\.assigned_to\?'🚚 <b>'/.test(detail));
test('MESSAGE-01 message récupère livreur_id côté commande',
  /select=livreur_id&limit=1/.test(sendMessage)
    && /rows\[0\]\.livreur_id/.test(sendMessage)
    && /livreur_id:livId/.test(sendMessage));
test('ASSIGN-01 workflow d’assignation reste canonique',
  /assigned_to:\s*lnom\|\|null/.test(restaurant)
    && /livreur_id:\s*lid\|\|null/.test(restaurant));

const rendered = { innerHTML: '' };
try {
  vm.runInNewContext(`${renderDrivers}\nrenderLivraisonsLivreurs([
    {id:'o-1',livreur_id:'liv-1',assigned_to:'Livreur Un',status:'delivered'},
    {id:'o-2',livreur_id:'liv-1',assigned_to:'Livreur Un',status:'ready'},
    {id:'o-3',livreur_id:'liv-2',assigned_to:'Livreur Deux',delivery_status:'delivered'}
  ]);`, {
    document: { getElementById: () => rendered },
    esc: (value) => String(value),
  });
} catch (error) {
  console.log(`       ${error.stack || error.message}`);
}
test('DRIVERS-03 regroupement runtime par livreur fonctionne',
  (rendered.innerHTML.match(/class="dlv-lv-row"/g) || []).length === 2
    && rendered.innerHTML.includes('Livreur Un')
    && rendered.innerHTML.includes('2 commandes · 1 livrées'));

const syntaxErrors = [];
test('SYNTAX-01 scripts inline Restaurant valides',
  [...restaurant.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].every((match) => {
    try { new vm.Script(match[1], { filename: 'RESTAURANT_EMBEDDED.html' }); return true; }
    catch (error) { syntaxErrors.push(error.stack || error.message); return false; }
  }));
for (const error of syntaxErrors) console.log(`       ${error}`);

console.log(`\nRESULTAT AUTH-R1D-H1: ${passed}/${passed + failed} PASS — ${failed} echec(s)`);
process.exit(failed ? 1 : 0);
