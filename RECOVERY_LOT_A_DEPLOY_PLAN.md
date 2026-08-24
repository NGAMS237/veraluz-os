# RECOVERY LOT A — plan de déploiement ciblé

Ce fichier est un plan. Aucun élément n'a été déployé pendant le lot.

## Préconditions

1. Exporter versions actives des fonctions Auth/`employees-secure`, définitions policies/grants et compteurs des tables ciblées.
2. Rejouer les tests locaux au SHA approuvé.
3. Vérifier le contrat Lot A.1 : Analytics reçoit la projection paie minimale via
   `employees-secure:list_analytics`; Livreur utilise les actions SELF
   `get_my_delivery_shift_status`, `punch_my_delivery_shift` et
   `record_my_delivery_checkin`.
4. Confirmer par scan que les consommateurs navigateur ne font plus d'accès direct
   à `veraluz_payroll`, `veraluz_pointages` ou `veraluz_employee_checkins`.
5. Faire un dry-run SQL sur un clone/staging du schéma production.

## Ordre

1. Déployer `employees-secure` du Lot A + A.1.
2. Smoke serveur sans frontend : aucune session 401; SELF sur `actor.id`; spoof refusé;
   `finance.read` requis pour Analytics; shift Livreur limité à l'acteur et à l'équipe Livreurs;
   aucune donnée PIN/hash/token.
3. Publier ensemble `VERALUZ_OS_CORE.html`, `RH_EMBEDDED.html`,
   `ANALYTICS_EMBEDDED.html` et `LIVREUR.html`.
4. Smoke avant RLS : Analytics sécurisé, Livreur shift/selfie, login gérant, F5,
   RH admin, logout, employé SELF, spoof, logout employé et kiosque.
5. Appliquer seulement ensuite `20260824_recovery_lot_a_rh_privacy.sql`.
6. Read-back grants/RLS/policies puis rejouer tous les smokes.

## Smoke immédiat

- gérant : login, F5, même identité/rôle, RH admin, logout;
- employé : login, F5, profil/pointage/tâches/paie SELF, aucun autre employé, logout;
- requête manipulée `employee_id=autre` : refus/ignorée côté serveur;
- session expirée puis révoquée : login;
- kiosque : locked → employé A → arrivée/départ → locked → employé B → locked;
- F5 kiosque : locked, aucun CORE derrière;
- console/réseau : aucune erreur bloquante, aucun PIN/token brut;
- RLS : anon/authenticated refusés sur les tables ciblées, service_role fonctionnel via EF.
- Analytics : agrégats de masse salariale inchangés, détails limités à la projection
  `employee_id,period_month,period_year,net_salary`, rôle sans `finance.read` refusé;
- Livreur : arrivée/départ et historique du jour proviennent de `veraluz_attendance`;
  selfie de prise de service écrit avec `actor.id`; autre `employee_id` rejeté.

## Rollback

1. Suspendre les tests/utilisateurs; ne jamais faire de force push.
2. Revenir au SHA frontend précédent pour les quatre fichiers publiés ensemble.
3. Redéployer la version `employees-secure` exportée avant le lot.
4. Si la migration a été appliquée, restaurer exactement les grants/policies exportés avant déploiement; ne supprimer aucune table/colonne/donnée.
5. Révoquer les sessions temporaires et confirmer CORE login/F5/logout, Analytics et Livreur.

## Gate

- Frontend + Edge Function : prêts pour revue humaine locale.
- Migration RLS complète : consommateurs Analytics/Livreur compatibles localement;
  elle reste soumise au dry-run, au déploiement backend/frontend préalable et aux smokes.
- Déploiement production : nécessite une autorisation séparée de Blaise.
