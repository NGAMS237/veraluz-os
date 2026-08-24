# RECOVERY LOT A — carte des sessions

État vérifié sur la base `725a0cc`, le code local et les métadonnées DB production lues sans écriture le 2026-08-24.

## CORE

```text
verify-employee-pin
  → session_token opaque (mémoire uniquement)
  → issue-resume-token (attendu avant ouverture)
  → resume_token opaque (localStorage:vz_resume)
  → identité/rôle/capabilities issus de la réponse serveur
```

Au F5, `checkAuth()` ne relit plus `veraluz_auth_v1` comme autorité. Il échange uniquement `vz_resume` auprès de `resume-employee-session`; le serveur décide expiration/révocation, tourne les deux jetons et renvoie l'identité fraîche. Un 401/403 efface le resume et revient au login. Les métadonnées `veraluz_auth_v1`/`veraluz_session` restent un cache d'affichage/transport pour les modules legacy, jamais une preuve d'autorisation.

Le login admin legacy ne fournit pas de session employé canonique : il reste en mémoire et n'est plus restauré après F5. Les appels sécurisés RH exigent une vraie session employé.

Le logout appelle `logout-employee-session` avec les jetons de l'appareil, puis efface toujours mémoire, `localStorage` et anciennes clés `sessionStorage`, même en erreur réseau.

## Employé / Mon espace

Il n'existe plus de seconde session PIN dans `RH_EMBEDDED.html`. Un employé se connecte par CORE, arrive sur `employee_home`, et les données personnelles viennent de `employees-secure:get_my_rh_workspace`. L'identité est exclusivement `actor.id`, résolue depuis le hash de la session serveur.

Les données SELF couvertes sont profil, présence, tâches, paie, planning, avances, documents, contrats et primes. Le client ne transmet aucun `employee_id` pour cette lecture. `punch_self` et `complete_my_task` contraignent aussi les écritures à `actor.id`.

## Kiosque pointage

L'ancien pseudo-kiosque RH était une connexion parallèle dans l'iframe et conservait la session gérant derrière. Il est neutralisé.

```text
RH « Mon espace »
  → message contrôlé vers l'iframe active CORE
  → révocation + effacement de la session CORE courante
  → contexte local non autoritaire vz_core_context=kiosk
  → écran kiosque verrouillé
  → PIN employé → session serveur en mémoire, sans resume
  → punch_self(actor.id)
  → révocation immédiate + wipe
  → kiosque verrouillé
```

Le kiosque ne construit ni navigation, ni dashboard, ni module. Un F5 supprime tout resume éventuel et reste verrouillé. Un second employé obtient nécessairement une nouvelle session serveur.

## RH administration

`RH_EMBEDDED.html` n'appelle plus directement les tables RH. Le broker CORE garde `session_token` en mémoire et appelle `employees-secure` :

- `rh_read` : ressource serveur allowlistée, capability explicite `employees.manage`;
- `rh_write` : ressource, opération et colonnes allowlistées; champs d'audit réécrits avec `actor.id`;
- `rh_update_settings` : clés fermées et aucun `default_pin`;
- actions employé existantes : protections de cible privilégiée conservées.

Le rôle/employee_id reçu par `postMessage` sert à l'affichage seulement; il ne crée plus `LOGGED_EMP`.

## Endpoints RH examinés

| Domaine | Chemin actuel | Autorité après Lot A |
|---|---|---|
| Liste/profil employés | `employees-secure:rh_list/get_my_profile` | session + capability/actor serveur |
| Profil SELF | `get_my_rh_workspace` | `actor.id` |
| Pointage SELF/kiosque | `punch_self` | `actor.id`, heure serveur Douala |
| Contrats/planning/paie/avances/documents/tâches | `rh_read/rh_write` | `employees.manage` + allowlists |
| Checkins photo | `rh_read` | `employees.manage` |
| Paramètres RH | `rh_update_settings` | `employees.manage`, clés fermées |
| Credentials/sessions | fonctions Auth existantes | token opaque serveur; aucune table client |

## Policies observées en production

| Classement | Objets |
|---|---|
| SAFE | `veraluz_employees`, `veraluz_employee_sessions`, `veraluz_employee_auth_secrets` : RLS active et aucun grant client utile |
| TOO PERMISSIVE | `attendance`, `contracts`, `advances`, `hr_documents`, `hr_tasks`, `payroll`, `schedules` : `rh_anon_all` avec `USING true/WITH CHECK true` |
| TOO PERMISSIVE | `employee_bonuses`, `hr_settings` : policy anon `ALL true` |
| TOO PERMISSIVE | `pay_periods`, `payroll_items` : SELECT/INSERT/UPDATE anon ouverts |
| TOO PERMISSIVE | `pointages` : `anon_all_pointages ALL true` |
| TOO PERMISSIVE | `employee_checkins` : RLS désactivée avec grants anon/authenticated complets |
| LEGACY | `pointages` et le login PIN interne RH |
| UNKNOWN | effet fonctionnel complet des fermetures sur les anciens écrans non testés en navigateur production |

La migration locale ferme ces objets, mais ne doit pas être appliquée avant les compatibilités Analytics/Livreur recensées dans le plan de déploiement.
