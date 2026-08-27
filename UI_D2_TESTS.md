# UI-D2 — Tests techniques (branche : claude/ui-d2-documents-rebuild)

## Vérifications statiques

| Test | Statut | Détail |
|---|---|---|
| `git diff --check` | ✅ PASS | EXIT 0 — zéro whitespace trailing |
| Syntaxe JavaScript | ✅ PASS | `node --check` sur scripts extraits |
| Zéro appel REST direct | ✅ PASS | Aucun `supabase.io/rest`, `fetch(`, `axios` |
| Zéro `service_role` côté navigateur | ✅ PASS | Mention documentaire uniquement (panneau Sécurité) |
| Broker CORE intact | ✅ PASS | `window.parent.veraluzSecureRequest('documents-secure',...)` |
| Actions conservées | ✅ PASS | list / create / update / archive (aucun DELETE) |
| Aucun violet | ✅ PASS | Aucun `#1e1b4b`, `#312e81`, `#6366f1` |
| Aucune lib externe | ✅ PASS | Aucun CDN, unpkg, axios |
| Aucun badge DEV MODE | ✅ PASS | Supprimé depuis D1, absent du rebuild |
| Standalone guard | ✅ PASS | `standalone-wall` affiché hors CORE |
| Responsive 390px | ✅ PASS | breakpoint 640px, grille 1 col à 380px |
| `prefers-reduced-motion` | ✅ PASS | Présent dans CSS |
| Focus clavier `focus-visible` | ✅ PASS | Défini sur tous les éléments interactifs |

## Vérifications post-déploiement (à effectuer par Blaise)

| Test | Type |
|---|---|
| 11 documents chargés dans Vue d'ensemble | [POST-DÉPLOIEMENT] |
| Navigation entre les 6 onglets | [POST-DÉPLOIEMENT] |
| Formulaire Ajouter visible et fonctionnel | [POST-DÉPLOIEMENT] |
| Modifier un document existant | [POST-DÉPLOIEMENT] |
| Archiver un document existant | [POST-DÉPLOIEMENT] |
| Panneau Documents manquants / checklist | [POST-DÉPLOIEMENT] |
| Dossiers par catégorie | [POST-DÉPLOIEMENT] |
| Clair/sombre toggle (FAB ou message CORE) | [POST-DÉPLOIEMENT] |
| Desktop 1440×900 — aucun scroll horizontal | [POST-DÉPLOIEMENT] |
| Mobile 390×844 — cartes documentaires | [POST-DÉPLOIEMENT] |

## Fichiers modifiés (branche)

| Fichier | Type |
|---|---|
| `assets/brand/veraluz-monogram-vr.png` | Ajout — actif officiel |
| `assets/brand/veraluz-crest-gold.png` | Ajout — actif officiel |
| `assets/brand/veraluz-crest-monochrome.png` | Ajout — actif officiel |
| `assets/brand/veraluz-crest-sunset.png` | Ajout — actif officiel |
| `VERALUZ_OS_CORE.html` | Modification — logo VR + blason login |
| `DOCUMENTS_EMBEDDED.html` | Reconstruction complète — VERALUZ Signature D2 |
| `assets/pwa/icon-192.png` | Remplacement — monogramme VR |
| `assets/pwa/icon-512.png` | Remplacement — monogramme VR |
| `assets/pwa/icon-maskable-192.png` | Remplacement — monogramme VR maskable |
| `assets/pwa/icon-maskable-512.png` | Remplacement — monogramme VR maskable |
| `sw.js` | Cache v034 → v035-ui-d2 |

## Non modifié

- Supabase (aucune migration, aucune EF, aucun RLS)
- `_rbac.ts`, contrats API
- Modules métier (booking, restaurant, RH, etc.)
- Icônes Food Lounge et Livreur
- `manifest-food.webmanifest`, `manifest-livreur.webmanifest`
