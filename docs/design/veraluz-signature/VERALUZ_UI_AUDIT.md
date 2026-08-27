# VERALUZ UI Audit — UI-0

Date : 2026-08-27
Branche : `claude/ui-0-veraluz-signature-audit`
Périmètre : audit documentaire uniquement — aucun écran modifié.

---

## 1. Inventaire des systèmes visuels actifs

Cinq systèmes CSS distincts coexistent dans le dépôt, sans coordination entre eux.

### Système 1 — CORE Neumorphism Light

Fichiers : `VERALUZ_OS_CORE.html`, `VERALUZ_OS_PLATFORM.html`, `AUTH_EMBEDDED.html`, `RESERVATIONS_EMBEDDED.html` (partiel), `BOOKING_ENGINE.html`, `CLIENT_EMBEDDED.html`.

Palette : fond gris `#e8ecf0`, accent cyan `#0891b2`, violet `#818cf8`, texte `#1e293b`.
Rayons : `--vl-r:3px` — neumorphique, très petits.
Ombres : neumorphiques bi-directionnelles (`--vl-sh`, `--vl-sh-in`).
Thème : mode clair uniquement — aucun bloc `prefers-color-scheme` ou `[data-theme]`.
Police : `system-ui / Segoe UI`, sans-serif.

### Système 2 — Dark Purple/Teal (modules embarqués)

Fichiers : `RESTAURANT_EMBEDDED.html`, `FINANCE_EMBEDDED.html`, `RH_EMBEDDED.html`.

Palette : fond `#0d0d1a` (bleu-violet foncé), accent `#22d3a5` (teal-vert), violet `#818cf8`.
Mode : sombre permanent — aucun mode clair.
Police : `system-ui`, avec `Georgia, serif` présent dans RESTAURANT.
Couleurs hardcodées : 170 dans RESTAURANT, 83 dans FINANCE, nombreuses dans RH.
Note : `#22d3a5` ne correspond à aucun token VERALUZ Signature.

### Système 3 — Guest Portal (Marine/Turquoise/Or)

Fichiers : `GUEST_PORTAL.html`.

Palette : `--navy:#0A1E35`, `--turq:#00A3B4`, `--gold:#B8922A`, `--ivory:#F7F4EF`.
Rayon : `--r:14px` — correspondance exacte avec `--vlz-radius-sm:14px`.
Ombres : `--sh-card`, `--sh-modal` — diffuses.
Mode : clair principalement, sans bloc sombre explicite.
Proximité VERALUZ Signature : **la plus élevée du dépôt** — marine/turquoise/ivoire alignés.

### Système 4 — Livreur (Sombre + Or)

Fichiers : `LIVREUR.html`.

Palette : `--dk:#0f0f0d`, `--gold:#c9a84c`, `--dt:#f5f5f0`, sémantiques standard.
Rayon : `--r8/--r12/--r16/--r50` — quatre tokens locaux.
Mode : clair principalement, accents sombres sur les surfaces d'action.
Police : **Inter** — seul module utilisant Inter explicitement.
Correspondance clé : `--gold:#c9a84c` = **exacte** avec `--vlz-gold:#c9a84c`.

### Système 5 — Settings/Auth sombre

Fichiers : `SETTINGS_EMBEDDED.html`, partiellement `AUTH_EMBEDDED.html`.

Palette : `#0f1117` fond, `#22d3a5` accent teal, sémantiques ambre/rouge/bleu/vert/orange/violet.
Mode : sombre permanent.
Aucun token nommé, tout en valeurs directes.

---

## 2. Fichiers et modules concernés

| Module | Fichier principal | Système CSS | Thème | Couleurs hardcodées |
|---|---|---|---|---|
| CORE / Dashboard | `VERALUZ_OS_CORE.html` | Neumorphism Light | clair | ~30 |
| Auth | `AUTH_EMBEDDED.html` | Neumorphism Light | clair | ~40 |
| Guest Portal | `GUEST_PORTAL.html` | Marine/Turquoise/Or | clair | 22 |
| Réservations | `RESERVATIONS_EMBEDDED.html` | Neumorphism + surcharges | clair | 78 |
| Restaurant / KDS | `RESTAURANT_EMBEDDED.html` | Dark Purple/Teal | sombre | **170** |
| Livreur | `LIVREUR.html` | Sombre + Or | mixte | 51 |
| RH | `RH_EMBEDDED.html` | Dark Purple/Teal | sombre | nombreuses |
| Finance / Folio | `FINANCE_EMBEDDED.html` | Dark Purple/Teal | sombre | 83 |
| Settings | `SETTINGS_EMBEDDED.html` | Dark sombre | sombre | nombreuses |
| Documents | `DOCUMENTS_EMBEDDED.html` | non audité | — | — |
| Emails | non localisé | — | — | — |
| PDF | `VERALUZ_PDF_THEME.js` | JS inline | — | 14 |

---

## 3. Variables CSS concurrentes

Plus de 100 noms de propriétés custom coexistent. Familles identifiées :

| Famille | Exemples | Problème |
|---|---|---|
| Verbeux générique | `--bg`, `--text`, `--border`, `--accent` | ambigus sans préfixe |
| Abrégé opaque | `--tx`, `--gd`, `--cy`, `--dk`, `--dt` | illisibles hors contexte |
| Échelle Stone | `--s200` à `--s950`, `--stone-100` à `--stone-950` | import Tailwind partiel |
| Opérationnel sémantique | `--c-available`, `--c-occupied`, `--c-cleaning` | bonne pratique — à conserver |
| Tokens VERALUZ cible | `--vlz-*` | **absent de tous les fichiers** |

---

## 4. Correspondance vers les tokens `--vlz-*`

| Valeur existante | Fichier | Token `--vlz-*` cible | Compatibilité |
|---|---|---|---|
| `--gold:#c9a84c` | LIVREUR | `--vlz-gold` | **exacte** |
| `--navy:#0A1E35` | GUEST_PORTAL | `--vlz-ink-strong` | proche (2 tons) |
| `--turq:#00A3B4` | GUEST_PORTAL | `--vlz-ocean` | proche (même famille) |
| `--ivory:#F7F4EF` | GUEST_PORTAL | `--vlz-canvas` | très proche |
| `--r:14px` | GUEST_PORTAL | `--vlz-radius-sm` | **exacte** |
| `--bg:#e8ecf0` | CORE | aucun direct | migration nécessaire |
| `#0d0d1a` | RESTAURANT | proche `--vlz-canvas` dark | écart notable |
| `#22d3a5` | RESTAURANT/FINANCE/RH | **aucun token VERALUZ** | à remplacer |

---

## 5. Risques de régression

**Critiques**
- RESTAURANT_EMBEDDED : 170 couleurs hardcodées + Georgia serif + sombre permanent. Migration lourde et risquée pour un module actif en service.
- Modules sombres permanents (RESTAURANT, FINANCE, RH, SETTINGS) : toute introduction de tokens clair/sombre doit être strictement conditionnelle.
- RESERVATIONS : scale Tailwind Stone partiellement intégrée — un remplacement global casse des sélecteurs non documentés.

**Élevés**
- `#818cf8` (violet) comme `--acc2` dans CORE et RESTAURANT/FINANCE — pas un token VERALUZ. Le retirer modifie l'identité visuelle de ces modules.
- Neumorphic shadows dans CORE incompatibles avec le système d'ombres diffuses VERALUZ.

**Modérés**
- Georgia serif dans RESTAURANT : inutile, à supprimer lors de la migration de ce module.
- `assets/veraluz-logo.png` = variante coucher de soleil — inadaptée à la sidebar.
- Inter uniquement dans LIVREUR : standardiser sans CDN externe.

---

## 6. Accessibilité, mobile et performances

- `prefers-reduced-motion` : absent de tous les modules audités.
- Focus clavier visible : présent dans GUEST_PORTAL, non documenté dans RESTAURANT/KDS.
- Zones tactiles : non vérifiées en LIVREUR et RESTAURANT — à mesurer avant UI-1.
- `prefers-color-scheme` : absent — aucun module ne réagit à la préférence système.
- `safe-area-inset` : présents dans GUEST_PORTAL et CORE, à vérifier dans LIVREUR.
- Aucune `@import` CSS externe trouvée (positif pour les performances).
- `VERALUZ_PDF_THEME.js` stable mais opaque — migration séparée nécessaire.

---

## 7. Traitements distincts application / email / PDF

**Application** : cinq systèmes visuels, migration progressive lot par lot.

**Email** : aucun template email localisé dans le dépôt lors de l'audit. À identifier avant UI-1. Les contraintes email (pas de CSS externe, pas de variables CSS) nécessitent un traitement entièrement distinct.

**PDF** : `VERALUZ_PDF_THEME.js` — 14 couleurs hardcodées, bleu nuit + turquoise + or. Cohérent avec la direction VERALUZ mais non tokenisé. Migration dans un lot séparé après UI-1.

---

## 8. Dette technique et ordre de migration

**Dette actuelle**
- 100+ noms de variables CSS sans préfixe ni cohérence inter-modules.
- 5 palettes parallèles dont 3 en conflit avec VERALUZ Signature.
- 0 fichier utilisant les tokens `--vlz-*`.
- `#22d3a5` (teal-vert sci-fi) comme accent dans 3 modules — pas un token VERALUZ.
- Aucun système de thème clair/sombre cohérent à l'échelle du produit.

**Ordre de migration recommandé (après UI-1 validé)**

| Priorité | Module | Effort | Risque |
|---|---|---|---|
| 1 | Dashboard/CORE | moyen | modéré |
| 2 | Guest Portal | faible | faible — déjà proche |
| 3 | Finance / Folio | moyen | modéré |
| 4 | Auth / Settings | moyen | modéré |
| 5 | Réservations / Planning | élevé | élevé — Tailwind Stone |
| 6 | RH | moyen | faible |
| 7 | Livreur | faible | faible — or déjà aligné |
| 8 | Restaurant / KDS | **très élevé** | **très élevé** |
| 9 | PDF | séparé | faible |
| 10 | Email | séparé | faible si templates localisés |

---

*Aucun écran modifié. Aucun token importé. Audit documentaire uniquement.*
