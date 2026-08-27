# VERALUZ UI Pilot Plan — UI-1 (futur)

Date : 2026-08-27
Statut : planification uniquement — UI-1 non autorisé sans instruction explicite de Blaise.

---

## Objectif du pilote

Démontrer la faisabilité de VERALUZ Signature UI sur trois surfaces représentatives avant tout déploiement étendu. Le pilote doit valider : mode clair, mode sombre, mobile, accessibilité, performances et absence de régression métier.

---

## Surface 1 — Dashboard / Accueil direction

### Périmètre exact
Section synthèse de `VERALUZ_OS_CORE.html` ou `VERALUZ_OS_PLATFORM.html` : métriques du jour, taux d'occupation, chiffre d'affaires, alertes actives. Sidebar de navigation non incluse dans le pilote.

### Composants concernés
- Carte hero de synthèse (asymétrique `--vlz-card-signature-right`)
- Tuiles métriques (occupation, revenus, arrivées, départs)
- Barre de navigation latérale (tokens seulement, pas de refonte structurelle)
- Notifications et alertes (badges sémantiques)

### États clair / sombre / mobile
- Clair : `--vlz-canvas:#F5F2EA`, cartes `--vlz-surface-raised`, accent `--vlz-ocean`
- Sombre : `--vlz-canvas:#06171c`, surfaces `--vlz-surface:#0b252c`, or adouci `--vlz-gold-strong`
- Mobile : grille mono-colonne, cartes signature réduites à `--vlz-radius-xl` sur `max-width:640px`

### Données réelles utilisées
Métriques live depuis `VERALUZ_OS_CORE.html` : `getTodayStats()`, occupation et alertes existants. Aucune donnée fictive.

### Tests visuels et fonctionnels
- Contraste AA/AAA vérifié avec les nouvelles valeurs de tokens
- Navigation clavier (Tab/Enter) sur les tuiles et actions principales
- Affichage en portrait 375px (iPhone SE) et 768px (tablette)
- `prefers-reduced-motion` : transitions désactivées
- `prefers-color-scheme` : thème sombre automatique si non forcé
- Aucun écran métier adjacent modifié

### Critères d'acceptation
- Aucune erreur console
- Aucun sélecteur CSS cassé dans les modules adjacents
- Contrastes ≥ 4.5:1 pour le texte courant dans les deux modes
- Temps de rendu inchangé (pas de bibliothèque ajoutée)
- Métriques affichées identiques avant/après

### Captures nécessaires
- Dashboard clair, desktop 1280px
- Dashboard sombre, desktop 1280px
- Dashboard clair, mobile 375px
- Dashboard sombre, mobile 375px

### Fichiers qui seraient modifiés
- `VERALUZ_OS_CORE.html` — section `<style>` du dashboard uniquement, dans un bloc `/* UI-1 PILOT */` délimité

### Stratégie de rollback
Supprimer le bloc `/* UI-1 PILOT */` dans `VERALUZ_OS_CORE.html`. Aucune autre dépendance. `git revert` du commit pilot suffit.

---

## Surface 2 — Profil client / Séjour

### Périmètre exact
Fiche séjour dans `RESERVATIONS_EMBEDDED.html` (vue détail d'une réservation) ou fiche client dans `CLIENT_EMBEDDED.html`. Inclut : identité, dates, unité, statut, historique résumé.

### Composants concernés
- Carte profil asymétrique (`--vlz-card-signature-left`) — grande surface de synthèse
- En-tête identitaire (nom, statut, dates)
- Tuiles d'information (check-in, check-out, unité, nombre de nuits)
- Actions rapides (check-in, check-out, note)
- Historique condensé (tableau lisible)

### États clair / sombre / mobile
- Clair : fond `--vlz-canvas`, carte profil `--vlz-surface-raised`, accent or discret sur le statut premium
- Sombre : surfaces `--vlz-surface` / `--vlz-surface-raised`, texte `--vlz-text`
- Mobile : empilage vertical, carte réduite, tableau → liste de tuiles

### Données réelles utilisées
Données de réservation existantes depuis `RESERVATIONS_EMBEDDED.html`. Aucune donnée fictive ni montant inventé.

### Tests visuels et fonctionnels
- Affichage cohérent avec 1 nuit et avec 30 nuits
- Nom long (plus de 40 caractères) sans débordement
- Statuts (confirmée, en cours, checkout, annulée) tous testés visuellement
- Actions (check-in / check-out) fonctionnellement inchangées

### Critères d'acceptation
- Actions check-in et check-out toujours fonctionnelles
- Aucune donnée client tronquée ou invisible
- Lisibilité à 375px sans scroll horizontal
- Aucune régression sur le reste de `RESERVATIONS_EMBEDDED.html`

### Captures nécessaires
- Fiche séjour en cours, clair desktop
- Fiche séjour en cours, sombre desktop
- Fiche séjour mobile 375px

### Fichiers qui seraient modifiés
- `RESERVATIONS_EMBEDDED.html` ou `CLIENT_EMBEDDED.html` — bloc `/* UI-1 PILOT */` uniquement

### Stratégie de rollback
Supprimer le bloc `/* UI-1 PILOT */`. Aucune modification du JavaScript métier.

---

## Surface 3 — Folio / Résumé financier

### Périmètre exact
Vue folio dans `FINANCE_EMBEDDED.html` ou module `get_my_folio` du Guest Portal (`GUEST_PORTAL.html`). Inclut : solde dû, détail des charges, total accommodation, total restaurant, paiements reçus.

### Composants concernés
- Carte hero financière asymétrique (solde en évidence)
- Tableau de charges (date, libellé, montant, type)
- Ligne de synthèse (total, payé, solde)
- Indicateur de statut (soldé / solde dû / crédit)

### États clair / sombre / mobile
- Clair : fond `--vlz-canvas`, données financières `--vlz-financial-number` (tabular-nums), solde dû en `--vlz-danger`, crédit en `--vlz-success`
- Sombre : même sémantique, surfaces ajustées
- Mobile : tableau → liste de lignes empilées avec libellé + montant sur deux lignes

### Données réelles utilisées
Données de `veraluz_room_charges` et `veraluz_reservations` via les Edge Functions existantes. Aucun montant fictif.

### Tests visuels et fonctionnels
- Folio vide (aucune charge) — message informatif, pas de tableau vide cassé
- Folio avec 1 charge et avec 20+ charges (scroll)
- Montants > 1 000 000 XAF sans débordement
- Ligne de reversal (montant négatif) clairement identifiable
- Sens du solde toujours explicite (libellé obligatoire)

### Critères d'acceptation
- Aucun montant affiché sans unité et sans libellé de sens
- Totaux corrects (vérification manuelle sur données de test)
- Aucune régression sur les autres vues de `FINANCE_EMBEDDED.html`
- Guest Portal : `get_my_folio` toujours fonctionnel

### Captures nécessaires
- Folio avec charges multiples, clair desktop
- Folio avec charges multiples, sombre desktop
- Folio mobile 375px
- Folio soldé vs solde dû (deux captures)

### Fichiers qui seraient modifiés
- `FINANCE_EMBEDDED.html` — bloc `/* UI-1 PILOT */` uniquement
- OU `GUEST_PORTAL.html` section folio — si le pilote cible le portail

### Stratégie de rollback
Supprimer le bloc `/* UI-1 PILOT */`. Les données et l'API ne sont pas modifiées.

---

## Contraintes globales UI-1

- `VERALUZ_TOKENS.css` importé uniquement dans les blocs pilotes, pas globalement
- Aucune bibliothèque UI, aucune police CDN ajoutée
- Aucune modification de JavaScript métier, Supabase, Auth, RLS ou API
- `git diff --check` doit passer
- Chaque surface = un commit séparé avec rollback indépendant
- Validation humaine de Blaise requise avant tout déploiement ou extension

---

## Séquençage UI-1

1. Surface 1 (Dashboard) — commit, captures, validation Blaise
2. Surface 2 (Profil client) — commit, captures, validation Blaise
3. Surface 3 (Folio) — commit, captures, validation Blaise
4. Rapport de synthèse UI-1 — bilan, ajustements, décision d'extension

---

*UI-1 non démarré. Ce document est un plan préparatoire soumis à autorisation.*
