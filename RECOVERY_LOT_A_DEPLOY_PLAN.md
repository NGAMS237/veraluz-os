# RECOVERY LOT A — plan de déploiement ciblé

Ce fichier est un plan. Aucun élément n'a été déployé pendant le lot.

## Préconditions

1. Exporter versions actives des fonctions Auth/`employees-secure`, définitions policies/grants et compteurs des tables ciblées.
2. Rejouer les tests locaux au SHA approuvé.
3. Lever les deux dépendances avant la migration RLS complète :
   - `ANALYTICS_EMBEDDED.html` lit encore directement `veraluz_payroll`;
   - `LIVREUR.html` lit/écrit encore directement `veraluz_pointages` et `veraluz_employee_checkins`.
4. Faire un dry-run SQL sur un clone/staging du schéma production.

## Ordre

1. Déployer uniquement `employees-secure` du lot.
2. Smoke serveur sans frontend : aucune session 401; SELF sur `actor.id`; spoof refusé; RH capability; punch SELF; aucune donnée PIN/hash/token.
3. Publier `VERALUZ_OS_CORE.html` et `RH_EMBEDDED.html` ensemble.
4. Smoke avant RLS : login gérant, F5, RH admin, logout, employé SELF, spoof, logout employé, kiosque.
5. Après compatibilité Analytics/Livreur seulement, appliquer `20260824_recovery_lot_a_rh_privacy.sql`.
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

## Rollback

1. Suspendre les tests/utilisateurs; ne jamais faire de force push.
2. Revenir au SHA frontend précédent.
3. Redéployer la version `employees-secure` exportée avant le lot.
4. Si la migration a été appliquée, restaurer exactement les grants/policies exportés avant déploiement; ne supprimer aucune table/colonne/donnée.
5. Révoquer les sessions temporaires et confirmer CORE login/F5/logout.

## Gate

- Frontend + Edge Function : prêts pour revue humaine locale.
- Migration RLS complète : **bloquée** tant qu'Analytics et Livreur conservent leurs accès directs.
- Déploiement production : nécessite une autorisation séparée de Blaise.
