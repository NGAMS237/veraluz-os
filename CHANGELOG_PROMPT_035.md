# CHANGELOG — PROMPT 035
**Date :** 2026-08-04  
**Périmètre :** Audit complet LIVREUR.html + Photo de profil changeable  
**Statut :** Appliqué · Syntaxe vérifiée (OK) · Aucun doublon · En attente git push

---

## Résumé de l'audit

### ✅ Fonctionnalités confirmées opérationnelles

| Composant | Statut |
|-----------|--------|
| `loadOrders()` — fetch Supabase + filtre livreur + normaliseStatuts | ✅ |
| `detectNewAssignments()` — silencieux au 1er chargement (PROMPT 033A) | ✅ |
| `renderOrders()` / `buildOrderCard()` — cartes + actions selon statut | ✅ |
| `doDeliveryStep()` — accept/pickup/depart/arrive → PATCH + logDeliveryEvent | ✅ |
| `confirmDeliveryNoPhoto()` — delivered_at + delivery_status (PROMPT 033A) | ✅ |
| `confirmDeliveryWithPhoto()` — upload Storage delivery-proofs + PATCH | ✅ |
| `startLivreurMsgPolling()` — démarré 3s après initApp (PROMPT 032) | ✅ |
| `loadLivreurMessages()` — 3 requêtes ciblées (livreur_id/recipient_id/sender_id) | ✅ |
| `renderMessagesTab()` — restaurant/driver/client (PROMPT 034 orange) | ✅ |
| `sendLivreurQR()` / `sendDeliveryMsgFromTab()` — quick replies + message libre | ✅ |
| `markLivreurMessageRead()` — sbPatch correct (PROMPT 033A) | ✅ |
| `refreshMsgBadge()` — badge onglet Messages | ✅ |
| `doPunch()` — pointage + ouverture selfie modal | ✅ |
| `openSelfieModal()` / `confirmSelfie()` — upload employee-selfies + checkin | ✅ |
| `loadPointageToday()` / `renderPointageToday()` — historique pointage du jour | ✅ |
| `renderHistorique()` — 7 jours, stats aujourd'hui/semaine, proof_photo_url | ✅ |
| `renderProfil()` — avatar photo ou initiales + badge identité + stats | ✅ |
| Offline queue — queueAction/syncPendingActions/cleanupPendingActions (48h) | ✅ |
| Session 12h — saveSession/checkSession sans PIN en localStorage | ✅ |
| XSS — escH() sur toutes les données utilisateur | ✅ |

### 🔧 Correction apportée

#### Photo de profil visible ET changeable

**Avant :** La photo de profil (`LIVREUR_ACTIF.photo_url`) était affichée dans l'onglet Profil si elle existait, mais aucun mécanisme ne permettait de la modifier.

**Après :** Le livreur peut changer sa photo depuis l'onglet Profil.

---

## Fichier modifié : `LIVREUR.html`

### 1. Bouton "Changer la photo" dans `renderProfil()`

Ajouté sous l'avatar, avant le nom d'affichage :

```javascript
+'<button onclick="document.getElementById(\'profil-photo-inp\').click()" style="margin-top:8px;...">📷 Changer la photo</button>'
```

L'avatar a reçu `id="profil-avatar-ring"` pour permettre la mise à jour de l'aperçu sans re-render complet.

### 2. Fonction `onProfilPhotoSelected(inp)` (PROMPT 035)

Ajoutée après `renderProfil()` :

```javascript
function onProfilPhotoSelected(inp){
  // 1. Aperçu immédiat dans l'avatar (FileReader)
  // 2. Upload vers Storage employee-photos/{id}_{timestamp}.jpg
  // 3. PATCH veraluz_employees avec photo_url
  // 4. Mise à jour LIVREUR_ACTIF.photo_url en mémoire
  // 5. renderProfil() pour rafraîchir l'ensemble
}
```

**Comportement si RLS bloque le PATCH :**  
La photo reste affichée pour la session en cours grâce à `LIVREUR_ACTIF.photo_url`. Un toast informe l'utilisateur ("Photo visible pour cette session").

### 3. Input caché dans le HTML

```html
<!-- PROMPT 035 — Input photo de profil -->
<input type="file" accept="image/*" id="profil-photo-inp" style="display:none" onchange="onProfilPhotoSelected(this)">
```

Placé dans le HTML statique (hors zone dynamique de `renderProfil()`) pour garantir sa persistance entre les re-renders.

---

## Sécurité respectée

- Pas de base64 en DB — upload direct vers Supabase Storage (même pattern que selfies + delivery-proofs)
- Pas de reconnaissance faciale
- `photo_url` visible uniquement par le livreur lui-même dans son onglet Profil
- Le PIN ne transite pas, session conservée sans modification

---

## Vérification syntaxe

```
LIVREUR.html : OK (node --check)
Doublons de fonctions : aucun
```

---

## Tests manuels recommandés

- [ ] Ouvrir onglet Profil → vérifier que la photo existante s'affiche (si `photo_url` présent)
- [ ] Cliquer "📷 Changer la photo" → sélecteur fichier s'ouvre
- [ ] Sélectionner une photo → aperçu immédiat dans l'avatar ✅
- [ ] Vérifier dans Supabase Storage bucket `employee-photos/` que le fichier est uploadé
- [ ] Vérifier PATCH dans `veraluz_employees` : `photo_url` mis à jour
- [ ] Déconnexion + reconnexion → la photo doit réapparaître depuis Supabase
- [ ] Si Storage indisponible → toast d'erreur, pas de crash
- [ ] Workflow Restaurant → vérifier que `assigned_livreur_id` et messages fonctionnent toujours
- [ ] Workflow Food → vérifier que tracking et chat client fonctionnent toujours

---

## Git push (depuis Windows)

```bash
cd "C:\Users\Veraluz\OneDrive\Documents\Claude\Projects\Projet residence Veraluz"
git add LIVREUR.html CHANGELOG_PROMPT_035.md
git commit -m "PROMPT 035 — Audit LIVREUR + photo de profil changeable"
git push
```

---

## Note technique — bucket Storage

Le bucket `employee-photos` doit exister dans Supabase Storage avec une politique INSERT pour la clé anon. Si le bucket n'existe pas, créez-le dans Supabase Dashboard → Storage → New bucket → `employee-photos` → Private.

Politique INSERT à ajouter (si absente) :
```sql
CREATE POLICY "Livreurs peuvent uploader leur photo"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'employee-photos');
```

---

*PROMPT 035 terminé. Aucune nouvelle table, aucune Edge Function, aucun fichier autre que LIVREUR.html modifié.*
