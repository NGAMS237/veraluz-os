# RECOVERY LOT B — tests lifecycle / overstay

## Contrat vérifié

- `status = checkedin` est la source de vérité de l'occupation physique.
- `check_out` reste une date de départ prévue; elle ne déclenche aucune transition.
- `overstay` est calculé pour l'UI avec `booking.checkout_time`, sans modifier `status`.
- Un vrai checkout staff est le seul passage vers `checkedout`; `reservation-workflow` garantit ensuite la tâche ménage canonique par ID déterministe.
- `checkout-completed` reste une notification UI legacy, non canonique et non durable. Aucune infrastructure `veraluz_events` / `veraluz_event_jobs` n'est créée par ce lot.

## Diagnostic production en lecture seule — 2026-08-24

- `veraluz_settings.booking.checkout_time` : configuré à `12:00`.
- Réservations `checkedin` : 3; overstays antérieurs à aujourd'hui : 3.
- Unités avec plusieurs réservations `checkedin` simultanées : 0.
- `create_booking_hold` sérialise déjà par unité, mais son ancien conflit ne couvrait un `checkedin` que si ses dates planifiées chevauchaient la nouvelle demande.
- Aucun trigger réservation ne fait de checkout automatique; seul `veraluz_touch_updated_at()` est présent.

## Matrice B01–B25

| ID | Vérification | Preuve automatisée |
|---|---|---|
| B01 | confirmed futur visible | filtre Planning conserve les statuts actifs |
| B02 | confirmed aujourd'hui ne devient pas checkedin automatiquement | aucune transition par date |
| B03 | checkedin avant départ visible | helper Planning lifecycle |
| B04 | checkedin après départ reste visible | fin ouverte jusqu'au checkout réel |
| B05 | overstay conserve checkedin | état dérivé sans écriture status |
| B06 | badge/durée overstay | UI Planning/liste/détail |
| B07 | unité overstay occupée | disponibilité interne bloque tout checkedin |
| B08 | nouvelle réservation incompatible refusée | frontend + RPC sérialisé + index unique |
| B09 | Dashboard compte l'overstay | Réservations et Analytics basés sur checkedin |
| B10 | Guest actif pendant overstay | validation Guest basée sur status |
| B11 | Wi-Fi basé sur checkedin | aucune condition de date |
| B12 | pas de ménage par date seule | tâche départ exige checkedout |
| B13 | pas d'événement checkout par date seule | aucune dérivation temporelle |
| B14 | checkout staff vers checkedout | transition serveur stricte |
| B15 | checkout libère l'occupation | rafraîchissement statut/ménage après transition |
| B16 | ménage canonique garanti avant réponse succès | compare-and-set + `ensureCheckoutEffects` |
| B17 | retry/double checkout idempotent | réponse `idempotent` ou conflit 409 |
| B18 | F5 conserve overstay | données DB rechargées puis état redérivé |
| B19 | lendemain conserve overstay | aucune borne `check_out` pour checkedin |
| B20 | historique n'absorbe pas overstay | aucun classement par date |
| B21 | aucune nouvelle constante 11:00/15:00 | helper lifecycle sans fallback horaire codé |
| B22 | checkout_time Settings | RPC `get_public_booking_settings` |
| B23 | checkedout normal préservé | transition canonique inchangée |
| B24 | cancelled préservé | transition canonique inchangée |
| B25 | Lot A et consommateurs ciblés préservés | aucune dépendance Auth/RH ajoutée |

Commande :

`node tests/recovery-lot-b-reservation-overstay.test.mjs`

Résultat local : **34 PASS / 0 FAIL**.

## Matrice B1-01–B1-11 — durabilité checkout

| ID | Vérification | Preuve automatisée |
|---|---|---|
| B1-01 | transition checkout crée le ménage | insertion serveur avant réponse succès |
| B1-02 | double checkout sans doublon | PK `checkout-<reservation_id>` + contrôle `23505` |
| B1-03 | retry réparateur | `ensureCheckoutEffects` même si déjà checkedout ou CAS concurrent |
| B1-04 | overstay seul sans ménage | aucun appel par date/état dérivé |
| B1-05 | tâches distinctes par réservation | ID dérivé de la réservation |
| B1-06 | échec effet sans rollback lifecycle | réponse 503 retryable; retry répare |
| B1-07 | frontend non canonique | suppression de `vlz_hk_checkout` |
| B1-08 | aucune table Events | absence DDL/appel events |
| B1-09 | date check-in Douala | `Intl.DateTimeFormat` avec `Africa/Douala` |
| B1-10 | Lot B inchangé fonctionnellement | suite 34/34 |
| B1-11 | Lot A/A.1/A.2 non touché | contrôle du diff depuis le HEAD B |

Commande :

`node tests/recovery-lot-b1-checkout-durability.test.mjs`

Résultat local : **11 PASS / 0 FAIL**.

Baselines Recovery exécutées sur le code de cette branche :

- Lot A.1 consommateurs RH : **16/16 PASS**.
- Lot A.2 live cleanup : **15/15 PASS**.
- Lot A historique : **28/30**, résultat strictement identique au `main` de base; les deux assertions statiques A09/A20 sont déjà obsolètes sur `f772ebd` alors que leurs équivalents runtime passent. Donc : **0 nouvelle régression Lot A**.

Validation navigateur locale avec données live lues sans écriture :

- Desktop : 3 overstays affichés, 3/11 unités comptées occupées, aucun débordement de page et aucune erreur console.
- Mobile 390×844 : résumé overstay visible, Planning horizontal défilable dans son conteneur, aucun débordement global et aucune erreur console.
- Aucune réservation, fixture ou donnée production modifiée.

La validation live reste à exécuter après revue et déploiement ciblé. Aucune fixture production n'a été créée.
