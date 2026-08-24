# RECOVERY LOT A — tests

## Automatisé local

Commande principale : `node tests/recovery-lot-a-session-security.test.mjs`.

| ID | Contrat | Résultat local |
|---|---|---|
| A01 | gérant login → CORE | PASS statique : login normal attend la stabilisation serveur |
| A02 | gérant F5 → même rôle | PASS statique : identité reconstruite depuis réponse resume |
| A03 | gérant logout → login | PASS statique : révocation best-effort + wipe local complet |
| A04 | employé login → Mon espace | PASS statique : session CORE → `employee_home` |
| A05 | employé F5 → Mon espace | PASS statique : resume tourne puis `employee_home` |
| A06 | employé logout → login | PASS statique : chemin logout unique |
| A07 | logout employé ne révèle jamais gérant | PASS statique : session parallèle RH supprimée |
| A08 | employé ne voit pas RH admin | PASS statique : `rh_read/rh_write` exigent `employees.manage` |
| A09 | spoof employee_id → 403/refus | PASS statique + exécution isolée de l'Edge Function : payload SELF fermé, requêtes sur `actor.id` |
| A10 | RH autorisé lit autre employé | PASS statique + exécution isolée : capability explicite sur actions admin |
| A11 | gérant garde accès RH | PASS statique : capability canonique `employees.manage` |
| A12 | session expirée → login | PASS statique : 401/403 efface resume |
| A13 | session révoquée → login | PASS statique : cache local jamais reconstruit en identité |
| A14 | pointage → retour kiosque | PASS statique : `finishCoreKioskPunch()` après succès |
| A15 | kiosque ne navigue pas CORE | PASS statique : aucun `buildNav/loadDashboardData/goTo` |
| A16 | deux utilisateurs kiosque isolés | PASS statique : révocation + wipe après chaque pointage |
| A17 | F5 kiosque reste locked | PASS statique : contexte kiosque prioritaire et resume supprimé |
| A18 | aucun PIN/token brut exposé | PASS scan ciblé |
| A19 | localStorage seul ne donne pas RH | PASS statique : broker exige token mémoire |
| A20 | endpoint RH cross-employee refusé | PASS statique + exécution isolée : SELF/punch utilisent `actor.id` |

Résultats exécutés :

- Recovery Lot A : **30/30 PASS** (dont 4 scénarios serveur exécutés dans un harnais isolé);
- AUTH-R2C : **18/18 PASS**;
- broker AUTH/RH : **11/11 PASS**;
- non-transmission du token aux iframes : **5/5 PASS**;
- AUTH-R1 containment : **15/15 PASS**;
- AUTH-R1C2 Livreur : **14/14 PASS**;
- AUTH-R1C2.1 éligibilité Livreur : **13/13 PASS**;
- parsing JavaScript inline CORE/RH : **PASS**;
- parsing TypeScript `employees-secure` : **PASS**;
- `git diff --check` : **PASS**.

Total des assertions automatisées ciblées exécutées : **106/106 PASS**.

## Compatibilité RLS consommateurs — Lot A.1

Commande : `node tests/recovery-lot-a1-rh-consumers.test.mjs`.

- nouveaux contrats A1-01 à A1-12, scénarios serveur isolés et syntaxe Analytics/Livreur : **16/16 PASS**;
- suites originales du Lot A rejouées après adaptation structurelle de deux assertions devenues obsolètes : **106/106 PASS**;
- total Lot A + A.1 : **122/122 PASS**.

## Validation live requise après autorisation de déploiement

Les A01–A20 doivent être rejoués avec des sessions/fixtures temporaires nettoyées et sans PIN réel. Vérifier sur desktop et mobile : absence de flash CORE/PIN, rotation du resume, session désactivée/révoquée, SELF Marie versus Paul, gérant/RH, kiosque avec deux employés successifs, réseau/console sans token/PIN.

Ne pas déclarer le déploiement PASS tant que la migration SQL n'a pas été testée en staging/dry-run et que les consommateurs Analytics/Livreur ne sont pas compatibles.
