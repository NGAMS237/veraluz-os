# VERALUZ — Recovery Plan

## 1. État actuel vérifié

L'audit a été réalisé depuis le bundle complet `veraluz_infra_docs_1.bundle`, importé sur `codex/recovery-audit-1` sans modifier `main` ni la production.

### Git

- `origin/main` : `0e6158b432a4d8c39c95319fa40c4b6a593974a0`
- Branche distante historique : `origin/claude/settings-ssot-1a` à `512b2a74e86cb0c9597ee0641a4bb0f7f82856ce`
- Dernier HEAD bundle : `3f56b568deba1516c0fdc225fd82ac5e1b49c064`
- Écart bundle/main : 34 commits devant, 0 derrière; 44 fichiers, +9700/-332
- La branche distante est un ancêtre exact du bundle : aucun commit distant n'est absent du bundle.
- Tag : `backup/pre-sync-auth-009-20260808-0105` → `965599685613cf57962450e459f11a385040bb3e`
- Reflog/orphelins : un commit de documentation ancien `e1abdd0`; aucune récupération produit supplémentaire identifiée.
- `VERALUZ_ROADMAP.md` et `VERALUZ_PRODUCT_RULES.md` sont absents au HEAD audité. Ils n'ont pas été inventés.

### Chronologie courte des 34 commits non intégrés

| Domaine | Commits / lots |
|---|---|
| SETTINGS | `ff2dd79`, `e47a5ed`, `e958118`, `0bd31e1`, `7416774`, `f883b36`, `bb32ec3`, `512b2a7`, `b6657c1`, `21df6df` |
| GUEST | `5a8ba28`, `d0e98f2`, `0fd32db`, `3f56b56` |
| INFRA | `1e831b2`, `e5b0e37`, `a8dcae8`, `05d12ed`, `b85ea8a`, `fb9c95a`, `7fcc0c5` |
| COMMS | `1fa5fc8`, `84f00ff` |
| SCHEDULER | `fb9c95a`, `fe35b3a`, `7fcc0c5` |
| DOCUMENTS | `7cb8629`, `3f56b56` |
| FINANCE | `d0e98f2`, `fe35b3a` |
| OTHER / handoffs | `d4c5744`, `a985e04`, `44f9ef8`, `09c9411`, `20959c3`, `40dd75a`, `ccb86a4`, `c415cf6`, `bc3876f` |

### Bundles trouvés

22 bundles ont été localisés (5 dans le dossier projet, 17 dans `Downloads`). Les chaînes utiles les plus récentes sont : Settings/catalogue, Guest services/messages, Guest financial, Infra Ops/Comms/Scheduler et Infra Docs. Le bundle de référence est complet et englobe la branche distante jusqu'à `3f56b56`.

## 2. Écarts et migrations Supabase

### Inventaire local complet

| Migration | Domaine | Prod | Dépendances / risque |
|---|---|---|---|
| `20260627_employee_pin_secrets.sql` | AUTH | Appliquée sous migration équivalente | `pgcrypto`, employés; conserver deny-all client |
| `20260627_employees_public_view.sql` | AUTH | Appliquée | Dépend employés; projection minimale |
| `20260627_migrate_pins_to_hash.sql` | AUTH | Appliquée partiellement côté données | Dépend secrets; un compte sans hash demeure pour AUTH-R3 |
| `20260627_pin_hash_migration.sql` | AUTH | Appliquée/équivalente | Legacy `pin_code` conservé |
| `20260627_prompt010_pin_lifecycle.sql` | AUTH | Appliquée | Secrets + événements auth |
| `20260627_prompt013_ai_tables.sql` | AI | Appliquée/objets présents | Plusieurs tables IA ont encore RLS désactivée |
| `20260628_prompt020_create_veraluz_pay_periods.sql` | RH | Appliquée | Paie |
| `20260628_prompt020_create_veraluz_payroll_adjustments.sql` | RH | Appliquée | Périodes/employés |
| `20260628_prompt020_create_veraluz_payroll_items.sql` | RH | Appliquée | Périodes/employés |
| `20260808_prompt009_auth_change_tokens_and_reset_rpc.sql` | AUTH | Appliquée | Secrets/session |
| `20260818_guest_wifi_privacy.sql` | GUEST/SETTINGS | Appliquée | Wi-Fi serveur uniquement |
| `20260819_auth_r1_containment_employees.sql` | AUTH | Appliquée | `veraluz_employees` protégé |
| `20260819_auth_r1c2_delivery_login_public.sql` | LIVREUR | Appliquée | Équipe Livreurs |
| `20260819_auth_r2b1_revoke_sessions_rpc.sql` | AUTH | Appliquée | Sessions/resume |
| `20260819_auth_r2b1_rotate_resume_rpc.sql` | AUTH | Appliquée | Rotation atomique |
| `20260819_auth_r3a1_reset_pin_atomic.sql` | AUTH | Appliquée | Reset PIN atomique |
| `20260819_auth_r4_identity_columns.sql` | AUTH/RH | Appliquée | Dernière migration enregistrée en prod |
| `20260820_catalog_ssot_1.sql` | SETTINGS | Absente | Insert seulement si unités vides; vérifier intention avant seed |
| `20260820_settings_fiscal_1.sql` | SETTINGS/FINANCE | Absente | Ajout clé `fiscal` |
| `20260820_settings_ssot_1a.sql` | SETTINGS | Absente | Valeurs branding/localization existantes à préserver |
| `20260820_storage_logos_bucket.sql` | SETTINGS | Absente | Bucket `logos` absent; requis par upload sécurisé |
| `20260821_settings_cleanup2_guest_services_messages.sql` | SETTINGS/GUEST | Absente | Doit précéder Guest/Comms; crée services/messages |
| `20260821_infra_ops_1_events.sql` | INFRA | Absente | Crée events/event_jobs; ajoute Housekeeping |
| `20260821_infra_ops_1r_schema.sql` | INFRA | Absente | Dépend events + guest service requests + internal messages |
| `20260821_infra_comms_1a.sql` | COMMS | Absente | Dépend events + guest messages; modifie trigger réservation |
| `20260821_infra_sched_1.sql` | SCHEDULER | Absente | Dépend event_jobs + communication_jobs; crée infra_runs et trigger paiement |
| `20260821_infra_docs_1.sql` | DOCUMENTS | Absente et **bloquée** | Incompatible avec la table documents existante; dépend toute l'infra |

Total local : **27**. Migrations vraisemblablement non déployées : **10**.

### Conflits de migration confirmés

1. `20260821_infra_docs_1.sql` fait `CREATE TABLE IF NOT EXISTS veraluz_documents`, mais la table existe déjà avec un autre contrat (`id uuid`, `title` et `category` obligatoires). La création devient un no-op, puis l'index sur `reservation_id` échoue car la colonne n'existe pas.
2. La même migration utilise `CREATE POLICY IF NOT EXISTS`, syntaxe non supportée par PostgreSQL pour `CREATE POLICY`; elle ne doit pas être appliquée telle quelle.
3. `vz_emit_reservation_event()` et son trigger sont redéfinis dans Ops, Comms puis Docs. Un ordre incorrect écrase silencieusement des comportements; la version finale doit être une fonction fusionnée et testée.
4. Ops 1R, Comms, Scheduler et Docs font des `ALTER`/triggers sur des tables créées par d'autres fichiers. L'ordre n'est pas optionnel.

### Ordre recommandé

Cet ordre est une cible de dry-run, pas une autorisation de déploiement :

1. Sauvegarde schéma + données ciblées; exporter définitions policies/triggers/functions.
2. Settings : `catalog_ssot_1`, `settings_fiscal_1`, `settings_ssot_1a`.
3. Storage logo : `storage_logos_bucket`.
4. Guest foundations : `settings_cleanup2_guest_services_messages`.
5. Infra outbox : `infra_ops_1_events`.
6. Alignement : `infra_ops_1r_schema`.
7. Communications : `infra_comms_1a`.
8. Scheduler : `infra_sched_1`.
9. **Ne pas appliquer `infra_docs_1` actuel.** Préparer une migration d'extension compatible avec `title/category NOT NULL`, les champs existants et le bucket privé déjà présent; consolider le trigger réservation/paiement.

## 3. Edge Functions

### Production : 41 actives

`verify_jwt=false` ne signifie pas « public sans contrôle » : les fonctions AUTH/Guest/ops utilisent une session opaque ou un contrôle serveur propre. Les six fonctions Rapports utilisent `verify_jwt=true` et la session employé transmise par le broker CORE.

| Fonction (version prod) | Rôle / dépendances principales | Auth attendue | État local |
|---|---|---|---|
| `netops` v4 | Réseau/ops, dépendances non récupérées | Contrôle propre | Source absente du repo |
| `veraluz-send-email` v3 | Envoi email | Contrôle propre | Source absente |
| `notify-new-quote` v3 | Notification devis | Contrôle propre | Source absente |
| `verify-employee-pin` v9 | Login, secrets/sessions/settings | PIN + rate limit serveur | Présente, non modifiée par le bundle |
| `verify-admin-login` v3 | Login admin legacy | Credentials serveur | Source absente |
| `reset-employee-pin` v10 | Reset atomique | Session + RBAC | Présente |
| `change-employee-pin` v7 | Changement PIN | Session employé | Présente |
| `change-admin-password` v3 | Admin legacy | Credentials serveur | Source absente |
| `logout-employee-session` v5 | Révocation session/resume | Token opaque | Présente |
| `run-report` v4 | Exécution rapports | JWT + session/RBAC | Source absente |
| `list-login-employees` v3 | Sélecteur Rapports | JWT/public minimal | Source absente |
| `list-report-suppliers` v3 | Filtre fournisseurs | JWT + session | Source absente |
| `list-report-units` v3 | Filtre unités | JWT + session | Source absente |
| `search-report-clients` v3 | Filtre clients | JWT + session | Source absente |
| `record-report-export` v3 | Audit export | JWT + session | Source absente |
| `complete-forced-pin-change` v3 | PIN provisoire | Change token | Présente |
| `revoke-employee-sessions` v4 | Révocation globale | Session + RBAC | Présente |
| `get-employee-access-status` v3 | État accès | Session + RBAC | Présente |
| `agent-run` v6 | Routeur agents | Sessions/employés/AI config | Présente |
| `agent-chat` v9 | Chat IA | Sessions + tables agent/métier | Présente |
| `agent-hr-run` v4 | Agent RH | Sessions/employés/auth events | Présente |
| `agent-legal-run` v4 | Agent juridique | Contrats/documents | Présente |
| `agent-finance-run` v4 | Agent Finance | Paiements/restaurant | Présente |
| `agent-commercial-run` v4 | Agent commercial | Réservations/unités | Présente |
| `agent-maintenance-run` v4 | Agent maintenance | Housekeeping/unités | Présente |
| `agent-security-run` v4 | Agent sécurité | Sessions/auth events | Présente |
| `agent-chloe-run` v2 | Chloé | Notifications/paiements/réservations | Présente |
| `agent-restaurant-run` v2 | Agent Restaurant | Commandes/fournisseurs | Présente |
| `agent-reservations-run` v2 | Agent Réservations | Réservations/unités | Présente |
| `agent-techops-run` v2 | Agent TechOps | Agents/auth/session | Présente |
| `resume-employee-session` v4 | F5/resume | Resume opaque + RPC atomique | Présente |
| `issue-resume-token` v4 | Émet resume | Session employé | Présente |
| `post-restaurant-folio` v3 | Charge Restaurant vers Folio | Session/RBAC; orders/charges | Présente |
| `messages-secure` v3 | Messages internes | Session/RBAC | **Locale plus récente**, probable non déployée |
| `communications-secure` v8 | Templates/log/dispatch | Session/RBAC | **Locale plus récente**, probable non déployée |
| `guest-access` v10 | Guest stay/folio | `guest_session` → réservation serveur | **Locale plus récente**, probable non déployée |
| `room-service` v3 | Affectation/livraison room | Session employé | Présente |
| `settings-secure` v4 | Settings sensibles | Session/RBAC | **Locale plus récente**, probable non déployée |
| `reservation-workflow` v2 | Transitions réservation | Session/RBAC | **Locale plus récente** (events), probable non déployée |
| `employees-secure` v4 | Employés/RH/Livreur | Session/RBAC | Présente |
| `auth-admin-secure` v3 | Console Auth | Session/RBAC | Présente |

### Fonctions locales absentes de production

| Fonction | Dépendances | Décision |
|---|---|---|
| `catalog-secure` | employees/sessions/units/reservations | Déployer seulement après Settings DB |
| `logo-upload-secure` | sessions/employees/settings + bucket `logos` | Après bucket et test RBAC |
| `event-worker` | events/event_jobs/housekeeping/messages | Après Ops DB |
| `comms-worker` | communication_jobs/events/templates/messages/settings | Après Comms DB |
| `document-worker` | document_jobs/documents/payments/reservations/charges | Bloquée par alignement Documents |
| `infra-health` | events/jobs/documents/runs | Après toutes tables nécessaires |
| `infra-scheduler` | infra_runs + RPC recovery | Après Scheduler DB et workers |
| `veraluz-ai-runner` | Legacy | Référence seulement dans backup AI legacy; ne pas déployer sans décision |
| `veraluz-document-upload` | Legacy/local | Non référencée par le flux online actuel; clarifier avant action |

Écart pertinent au bundle : **7 nouvelles fonctions absentes + 5 fonctions déployées mais localement plus récentes = 12 probablement non déployées ou obsolètes côté prod**. Inversement, **11 fonctions actives de production n'ont pas leur source dans le repo audité**; il faut les exporter avant tout changement.

## 4. Régressions et dépendances frontend

### Confirmées ou fortement probables

1. **CORE session/F5** : deux implémentations resume coexistent. Le chemin récent stocke `vz_resume` dans `localStorage`, mais `checkAuth()` relit encore `sessionStorage`, exige des métadonnées locales non expirées avant de demander au serveur et reconstruit l'identité depuis le cache. `logout()` lit le resume local puis ne supprime que les clés sessionStorage. Les tests AUTH-R2C confirment deux échecs sur F5 et logout.
2. **RH / Mon espace** : `RH_EMBEDDED.html` recrée une connexion PIN (`LOGGED_EMP`) indépendante de CORE. `logoutEmp()` masque seulement les écrans RH et laisse apparaître la session gérant déjà ouverte. L'iframe charge aussi `rh_list`, donc la séparation « mon espace » / administration n'est pas une frontière de sécurité.
3. **Planning overstay** : l'unité reste marquée occupée par le statut `checkedin`, mais le Gantt affiche seulement `check_in <= jour < check_out` et `isUnitAvailable()` réutilise les dates. Après un départ dépassé, le client disparaît du planning et une future réservation peut considérer l'unité disponible.
4. **Room Service** : `veraluz_food_orders` est bien l'ordre canonique et l'index `uix_room_charges_order_original` évite les doubles charges. Néanmoins la prod contient 7 orders room et aucun lien `restaurant_order_id` vers une charge; Restaurant et Livreur modifient encore des statuts directement depuis le navigateur.
5. **Food Lounge** : la requête de suivi demande encore `assigned_livreur_id`, colonne legacy, en plus de `livreur_id`/`assigned_to`.
6. **Paiements/Finance** : `PAIEMENTS_EMBEDDED.html` insère directement dans `veraluz_payments`, puis met à jour `reservation.paid`; Finance écrit directement caisse/dépenses. Le navigateur reste une autorité financière.
7. **Documents** : l'UI online écrit directement la table legacy; la nouvelle infra locale cible un contrat différent.
8. **Guest local** : services/messages/reçus/documents visibles dans le code local dépendent de tables et actions EF absentes en prod.
9. **EventBus local** : l'onglet durable appelle `infra-health`/`infra-scheduler`, absentes en prod.

### Modules hybrides / inconnus

- Contacts agrège cache réservations, DB réservations, employés via serveur, fournisseurs et contacts manuels localStorage.
- Finance agrège paiements, commandes restaurant, room charges, caisse et dépenses; ce n'est pas encore Finance Pro.
- Rapports possède le broker SSO correct et toutes ses EF sont actives, mais leur source manque au repo; validation humaine requise.
- AI Center a 12 fonctions prod actives, mais plusieurs tables AI/ops ont RLS désactivée et une partie du code de déploiement est absente/divergente.

### État des tests locaux existants

- 13 suites `.mjs` statiques/non destructives exécutées; les 2 suites de fixtures production avec anciens tokens n'ont pas été lancées.
- 8 suites PASS; 5 suites FAIL.
- `auth-r2c-frontend` : 16/18, deux défauts réels confirmés dans le chemin F5/logout.
- `auth-r1c1-employees-secure` : harnais devenu incompatible avec les imports `_rbac.ts`, puis nombreuses assertions anciennes; il ne constitue plus une preuve fiable.
- `guest-portal-correctness` : 10/11, assertion obsolète attendant `DIRECTION_ROLES` alors que le code utilise le RBAC canonique `hasCapability`.
- `auth-broker-only` et `session-token-not-postmessaged` : expressions de test obsolètes par rapport au contrat header/broker et à la forme actuelle de `sendAuthContext`.
- Conclusion : la baseline automatisée doit être réparée dans le Lot A; aucun PASS global ne peut être revendiqué avec les suites actuelles.

## 5. Sécurité directement liée à la récupération

La table `veraluz_employees` est bien protégée par AUTH-R1. En revanche :

- `veraluz_payments`, `veraluz_reservations`, `veraluz_room_charges`, `veraluz_food_orders`, `veraluz_housekeeping` et `veraluz_documents` ont encore des policies anon très larges.
- `veraluz_employee_checkins`, `veraluz_tenants`, `veraluz_tenant_modules` et 13 autres tables Veraluz exposées ont RLS désactivée.
- Les privilèges SQL restent larges; l'efficacité dépend entièrement des policies. Toute fermeture doit être précédée d'un inventaire frontend/serveur et déployée par domaine, jamais globalement.
- Supabase recommande RLS sur toutes les tables exposées par la Data API; les migrations doivent également anticiper le changement d'exposition par défaut annoncé pour 2026-10-30.

Références : https://supabase.com/docs/guides/database/postgres/row-level-security et https://supabase.com/changelog?types=breaking-change

## 6. Plan de récupération progressif

### Lot A — Security / session blockers

- **Commits inclus** : base `main` AUTH final; nouveau correctif ciblé, aucun commit Infra bundle.
- **DB** : inventaire puis policies ciblées RH/pointage; pas de fermeture globale.
- **EF** : réutiliser `employees-secure` et sessions canoniques; aucune nouvelle auth parallèle.
- **Frontend** : supprimer/neutraliser le login RH interne quand embarqué; Mon espace dérive uniquement de la session CORE.
- **Session CORE** : supprimer le chemin resume legacy, laisser le serveur décider de l'expiration, reconstruire l'identité depuis la réponse et nettoyer la clé locale au logout.
- **Risques** : bloquer le pointage ou les écrans Direction.
- **Rollback** : revert Git du lot; restaurer uniquement les policies exportées.
- **Smoke** : gérant, RH, employé; pointage; logout; F5; accès dossier; tentative cross-employee.
- **Humain** : employé ne voit jamais la session gérant ni les données globales après logout.

### Lot B — Reservation lifecycle / Planning overstay

- **Commits inclus** : nouveau micro-lot sur `main`; ne pas prendre les changements Settings du bundle.
- **DB** : aucune migration par défaut; ajouter une contrainte/RPC seulement si la validation atomique serveur l'exige.
- **EF** : `reservation-workflow` canonique pour checkin/checkout/disponibilité.
- **Frontend** : afficher `checkedin` même après `check_out`; badge retard/overstay; empêcher l'unité d'être libre avant checkout explicite.
- **Risques** : faux blocage d'une unité ou régression des réservations confirmées futures.
- **Rollback** : revert frontend/EF à la version notée; aucune mutation de réservation.
- **Smoke** : confirmed futur, checkedin normal, checkedin dépassé, checkout, no-show, chevauchements.
- **Humain** : Planning, Liste, Chambre et Booking montrent la même occupation.

### Lot C — Room Service sync

- **Commits inclus** : conserver les flux main; petit correctif ciblé, puis seulement les éléments Guest nécessaires.
- **DB** : conserver `food_orders.id` et `room_charges.restaurant_order_id`; aucune deuxième table/order.
- **EF** : transitions via `room-service`; posting via `post-restaurant-folio`, idempotence garantie par l'index unique.
- **Frontend** : Guest/Restaurant/Livreur lisent les mêmes statuts; supprimer les mutations client sensibles et la colonne livreur legacy.
- **Risques** : double posting, commande livrée non facturée, historique ancien incohérent.
- **Rollback** : version EF précédente + revert UI; l'index idempotent reste.
- **Smoke** : création Guest, KDS, affectation, acceptation, livraison, confirmation, charge unique, annulation/retry.
- **Humain** : même commande et même statut sur trois interfaces; Folio n'augmente qu'une fois.

### Lot D — Documents infra alignment

- **Commits inclus** : examiner `7cb8629` et `3f56b56`; ne pas cherry-pick la migration actuelle sans réécriture compatible.
- **DB** : étendre la table `veraluz_documents` existante ou créer uniquement une table jobs distincte; préserver `title/category NOT NULL`, champs GED et bucket privé.
- **EF** : adapter `document-worker` aux colonnes réelles; signed URLs; génération déterministe.
- **Frontend** : garder l'UI Documents utile; ajouter reçus/folios Guest seulement après read-back.
- **Dépendances** : events/comms/scheduler doivent exister avant activation automatique; le travail D peut préparer le schéma sans activer les triggers.
- **Risques** : seconde source documentaire, migration bloquée, documents invisibles, URL publique.
- **Rollback** : désactiver triggers/jobs, revenir EF; ne jamais supprimer les colonnes GED ni les objets Storage existants.
- **Smoke** : ancien document, création metadata, job idempotent, PDF, signed URL expirante, `title/category`, folio exact.
- **Humain** : Documents historique intact + reçu/folio Guest accessible selon permissions.

### Lot E — Remaining migrations / functions

- **Commits inclus** : Settings jusqu'à `512b2a7`, Guest `5a8ba28`/`d0e98f2`, Infra `1e831b2`→`7fcc0c5`, Comms `1fa5fc8`/`84f00ff`; intégrer par sous-lots, pas en bloc.
- **Ordre DB** : Settings → Guest foundations → Events/Ops1R → Comms → Scheduler → Documents corrigé.
- **Ordre EF** : settings/catalog/logo → guest/messages → event-worker/health → communications/comms-worker → scheduler → document-worker.
- **Frontend** : publier chaque écran seulement après son backend et ses tests live.
- **Risques** : fonctions absentes, trigger écrasé, emails dupliqués, jobs bloqués, UI visible sans données.
- **Rollback** : feature flag UI, revert Git, redeploy version EF notée, suspendre triggers/workers; conserver données/jobs pour reprise.
- **Smoke** : Settings read-back, Guest services/messages, événement unique, job claim/retry, provider absent fail-closed, health, scheduler manuel.
- **Humain** : chaque sous-lot est validé avant le suivant.

Après ces lots seulement : Contacts SSOT, RH2, Finance Pro, Reports2, Documents/OCR, Agent Actions, Ollama, Reservation Changes/No-show/Credits et SaaS futur.

## 7. Stratégie de rollback commune

1. Avant chaque lot : noter SHA `main`, versions EF, définitions policies/triggers/functions et comptes de lignes.
2. GitHub Pages : revert explicite du commit du lot; jamais de force push.
3. Edge Functions : conserver/exporter la source de la version active avant remplacement, surtout les 11 fonctions absentes du repo.
4. DB : privilégier migrations additives; pour policies/triggers, fournir un script de restauration vérifié. Ne jamais supprimer une colonne ou table contenant des données pour « rollback ».
5. Jobs : arrêter le scheduler/worker avant rollback, conserver les lignes pour reprise et vérifier l'idempotence.
6. Validation : automatisé + DB read-back + navigateur desktop/mobile + test humain avant lot suivant.

## 8. Blockers avant tout déploiement du bundle

1. Migration Documents incompatible et syntaxiquement invalide.
2. Dix migrations absentes et fortement ordonnées.
3. Douze fonctions du bundle absentes ou plus récentes que la prod.
4. Onze fonctions actives de prod sans source locale de référence.
5. Régression critique F5/logout et session/visibilité RH.
6. Overstay Planning confirmé.
7. Policies anon très larges et 16 tables Veraluz avec RLS désactivée.
8. Room Service non prouvé jusqu'à une charge Folio unique.
9. Autorité financière encore dans le navigateur; aucun Payment Orchestrator.
10. Baseline tests non verte (5/13 suites) et sources multiples Contacts/Settings/Tenant.

## 9. Décision

**READY FOR PROGRESSIVE RECOVERY : NON**, tant que les Lots A et B ne sont pas définis/testés et que la migration Documents n'est pas remplacée par un alignement compatible. Le projet est toutefois récupérable sans big bang : le bundle est complet, `main` est un ancêtre propre, la version online est identifiable, et les écarts DB/EF sont maintenant cartographiés.
