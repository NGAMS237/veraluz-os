# VERALUZ — Recovery Matrix

Audit read-only effectué le 2026-08-24. Aucun déploiement, aucune migration et aucune fusion n'ont été réalisés.

## Références vérifiées

- Repo canonique : `NGAMS237/veraluz-os`
- `origin/main` : `0e6158b432a4d8c39c95319fa40c4b6a593974a0`
- `origin/claude/settings-ssot-1a` : `512b2a74e86cb0c9597ee0641a4bb0f7f82856ce` (10 commits devant `main`, 0 derrière)
- Dernier bundle : `veraluz_infra_docs_1.bundle`, valide et complet, HEAD `3f56b568deba1516c0fdc225fd82ac5e1b49c064`
- Branche d'audit issue du bundle : `codex/recovery-audit-1`, 34 commits devant `main`, 0 derrière
- Production DB : 126 migrations enregistrées; dernière `20260820005842_auth_r4_identity_columns`
- Production Edge Functions : 41 fonctions actives
- GitHub Pages : les blobs servis pour CORE, Guest et Rapports correspondent exactement à `origin/main`

## Matrice de réconciliation

| Domaine | Main | Branche locale `3f56b56` | Prod DB | Prod EF | Front online | Risque | Action |
|---|---|---|---|---|---|---|---|
| AUTH / sessions | AUTH final intégré, mais ancien et nouveau resume coexistent | Inchangé hors dépendances | Migrations AUTH jusqu'à R4 présentes | Fonctions AUTH actives | Correspond à `main` | Critique : boot lit encore `sessionStorage`, refuse un cache expiré avant le serveur et logout laisse le resume `localStorage`; seconde session RH | Lot A : un seul chemin resume/logout puis suppression de l'autorité RH parallèle |
| SETTINGS / catalogue | Version stable publiée | SSOT branding/localization/fiscal/catalogue + upload logo | 4 migrations du 20 août absentes; bucket `logos` absent | `catalog-secure` et `logo-upload-secure` absentes; `settings-secure` local plus récent | Valeur online à préserver | Élevé si frontend local publié avant backend | Déployer DB/EF par sous-lots, puis UI; ne pas écraser les valeurs existantes |
| GUEST / Folio | GUEST-4A validé | Services, messages, paiements, reçus et folios ajoutés | Tables guest services/messages/jobs absentes | `guest-access` et `messages-secure` plus anciens en prod | Guest online = blob `main` | Élevé : UI locale appelle contrats/tables absents | Conserver GUEST-4A; réintégrer chaque capacité séparément après backend |
| RESERVATIONS / Planning | Fonctionnel avec défaut overstay | Seulement 9 lignes settings/fiscal | 3 séjours `checkedin` dépassent leur `check_out` | `reservation-workflow` v2 | Correspond à `main` | Critique métier : planning masque l'occupation après date et disponibilité redevient possible | Lot B : statut `checkedin` prioritaire sur date, contrôle serveur, tests overstay |
| RESTAURANT / Room Service | Flux actuel publié | Pas de refonte Restaurant/Livreur | 7 commandes room; 6 liées à une réservation; 0 liée à une charge | `room-service` v3, `post-restaurant-folio` v3 | Valeur online à préserver | Élevé : statuts parallèles et folio non prouvé de bout en bout | Lot C : même `food_order.id`, transitions serveur, charge idempotente, read-back |
| FOOD LOUNGE | Version publiée | Inchangé | `veraluz_food_orders` existe | Pas d'orchestrateur unique | Correspond à `main` | Probable : requête active demande encore `assigned_livreur_id` legacy | Petit correctif isolé après preuve live; garder `livreur_id` / `assigned_to` |
| LIVREUR | Auth/session canonique publiée | Inchangé | Tables delivery présentes | AUTH/room-service actives | Correspond à `main` | Élevé : écritures directes et file offline restent autorité client | Ne pas refondre dans Recovery; tester sync et RLS avant fermeture ciblée |
| HOUSEKEEPING | Version publiée | Colonnes/events proposés | Table présente, policy `hk_open` publique; jobs absents | `event-worker` absent | Correspond à `main` | Critique sécurité + couplage aux futurs events | Lot A pour accès; Lot E pour events, sans casser le workflow actuel |
| RH | Version publiée | Inchangé | Employés protégés; `employee_checkins` sans RLS; nombreuses tables RH directes | `employees-secure` actif | Correspond à `main` | Critique : login iframe parallèle; logout révèle session gérant; données globales chargées | Lot A prioritaire, tests rôle/session/pointage |
| DOCUMENTS | UI legacy sur table existante | Worker PDF + jobs + reçus/folios | `veraluz_documents` existe avec `title/category NOT NULL`; jobs absents | `document-worker` absent | UI online directe | Bloquant : migration locale suppose une autre structure et échoue telle quelle | Lot D : migration d'extension compatible, jamais une deuxième table |
| CONTACTS | Hybride publié | Inchangé | `veraluz_clients` existe; pas de `veraluz_contacts` canonique | Employés via `employees-secure` | Correspond à `main` | Moyen/élevé : réservations + fournisseurs + localStorage + contacts manuels | Conserver l'UI; futur lot Contacts SSOT après Recovery |
| FINANCE / Paiements | Finance et Paiements publiés | Trigger événement paiement proposé | 44 paiements `validated`; `paid`, paiements, caisse et refunds coexistent | Pas de Payment Orchestrator | Correspond à `main` | Critique : navigateur peut écrire paiement et `reservation.paid` directement | Préserver Finance actuel; traiter l'autorité paiement dans un lot dédié avant Finance Pro |
| REPORTS | Centre Rapports SSO | Inchangé | Sources métier présentes | 6 fonctions Rapports actives mais absentes du repo local | Rapports = blob `main` | Élevé de récupération, fonctionnement live à retester | Exporter/récupérer les sources EF avant toute évolution; smoke test SSO/rôles/filtres |
| MESSAGES / COMMS | Communications internes | Guest messages + durable comm queue | `guest_messages` et `communication_jobs` absentes | `comms-worker` absent; 2 EF locales plus récentes | Online interne à préserver | Élevé : triggers et workers non déployés | Lot E après events et migrations guest |
| EVENTBUS / INFRA | EventBus localStorage | Outbox/jobs/health/scheduler ajoutés | Tables events/jobs/runs absentes | 4 workers/health/scheduler absents | UI durable non publiée | Bloquant si UI locale publiée seule | Lot E progressif : DB, workers, health, puis UI |
| AI CENTER | Fonctions IA en prod | Sources locales partielles/legacy | Tables IA présentes; plusieurs sans RLS | 12 fonctions agent actives | État online à tester humainement | Élevé : noms/sources locaux et prod divergent | Ne pas ajouter Ollama; récupérer les sources prod et fermer les accès avant Agent Actions |
| Pré-SaaS | Tenant hardcodé dans CORE | Nouvelles infra explicitement single-property | `tenants` / `tenant_modules` sans RLS | Plusieurs EF figent `veraluz-001` | Failsafe active tous les modules | Élevé : branding/settings dupliqués, complexité sans valeur actuelle | Garder les identifiants nécessaires, simplifier seulement après Recovery |

## Valeur online vs valeur locale

| Domaine | Décision | Justification |
|---|---|---|
| Auth, Folio Guest, Restaurant H1, Rapports | KEEP ONLINE BEHAVIOR | Déjà publié et partiellement validé humainement; aucune dépendance aux nouvelles tables infra |
| Settings SSOT / catalogue / logo | MERGE BOTH | Bonne direction locale, mais backend/migrations doivent précéder l'interface |
| Guest services/messages/reçus | MERGE BOTH | Valeur locale réelle; découper pour ne jamais régresser GUEST-4A |
| Planning overstay | REWRITE SMALL SECTION | Le statut physique doit dominer la date jusqu'au checkout explicite |
| Room Service | REWRITE SMALL SECTION | Garder les écrans, unifier transitions et posting folio autour de l'ordre canonique |
| Documents | MERGE BOTH | Garder la table et les métadonnées online; adapter le worker local au schéma existant |
| Contacts | KEEP ONLINE BEHAVIOR | Hybride mais utile; attendre le chantier Contacts SSOT |
| Finance | KEEP ONLINE BEHAVIOR | Séparer stabilisation actuelle et futur Finance Pro; sécuriser les écritures d'abord |
| Events/Comms/Scheduler | KEEP LOCAL IMPLEMENTATION | Architecture utile mais non déployable tant que migrations et workers ne sont pas validés par étapes |
| AI Center | UNKNOWN — NEED HUMAN TEST | Production possède des fonctions dont la source n'est pas entièrement dans le repo |

## Statuts ciblés

- **RH SECURITY / SESSION** : `BLOCKING REGRESSION` — deux chemins resume CORE contradictoires, logout incomplet et autorité de session parallèle dans l'iframe RH.
- **PLANNING OVERSTAY** : `BLOCKING REGRESSION` — confirmé par le code et par 3 réservations de production `checkedin` au-delà du départ.
- **ROOM SERVICE SYNC** : `PARTIALLY BROKEN / NON PROUVÉ` — table ordre unique, mais 0/7 commandes room reliées à une charge et plusieurs statuts sont modifiés côté client.
- **GUEST** : online GUEST-4A `working-looking`; extensions locales `likely broken` sans migrations/EF.
- **DOCUMENTS** : `BLOCKED` — migration locale incompatible avec la table existante.
- **CONTACTS** : `HYBRID` — utile mais plusieurs sources et localStorage.
- **FINANCE** : lecture `working-looking`, autorité d'écriture `unsafe/hybrid`.
- **REPORTS** : `working-looking`, mais sources des EF de production à récupérer et test humain requis.

## Dette pré-SaaS

| Élément | Classe | Motif |
|---|---|---|
| Identifiant fixe `veraluz-001` dans les sessions | HARMLESS | N'ajoute pas à lui seul une autorité multi-tenant |
| Tables `veraluz_tenants` / `veraluz_tenant_modules` lues directement | BLOCKING REGRESSION | RLS désactivée, privilèges larges et failsafe « tous modules actifs » |
| Branding tenant + `veraluz_settings.branding` | SHOULD SIMPLIFY | Deux sources potentielles de présentation |
| `tenant_id` dans les tables communications déjà existantes | HARMLESS | Peut rester comme compatibilité tant qu'il n'est pas dupliqué ailleurs |
| Nouvelles tables events/jobs sans tenant | SAFE TO KEEP | Cohérentes avec une propriété unique |
| Toute extension SaaS/tenant supplémentaire | SHOULD SIMPLIFY | Hors priorité avant rétablissement fonctionnel et sécurité |
