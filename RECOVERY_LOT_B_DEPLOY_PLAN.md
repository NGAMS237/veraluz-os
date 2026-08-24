# RECOVERY LOT B — plan de déploiement ciblé

## Fichiers produit

- `RESERVATIONS_EMBEDDED.html`
- `BOOKING_ENGINE.html`
- `ANALYTICS_EMBEDDED.html`
- `HOUSEKEEPING_EMBEDDED.html`
- `supabase/functions/reservation-workflow/index.ts`
- `supabase/migrations/20260824_recovery_lot_b_booking_overstay_guard.sql`

Les deux documents Recovery et le test accompagnent la revue mais ne sont pas des composants runtime.

## Préflight obligatoire

1. Confirmer que `main` est toujours la base attendue et que les correctifs Lot A restent publiés.
2. Vérifier en lecture seule qu'aucune unité ne possède plusieurs lignes `checkedin`/`checked_in`.
3. Comparer la signature et la définition live de `create_booking_hold` à celle auditée le 2026-08-24.
4. Confirmer que `booking.checkout_time` est présent; ne modifier aucune réservation client réelle.
5. Confirmer le schéma `veraluz_housekeeping` : `id TEXT` clé primaire et colonnes `unit_id`, `type`, `status`, `priority`, `scheduled_for`, `task_label`, `notes`, `reported_by`.

## Ordre recommandé

1. Appliquer `20260824_recovery_lot_b_booking_overstay_guard.sql` : index d'invariant + RPC public + trigger atomique checkout/ménage.
2. Déployer uniquement `reservation-workflow`.
3. Publier les quatre frontends ciblés depuis le commit validé.
4. Attendre GitHub Pages puis effectuer les smoke tests.

Cet ordre ferme d'abord les écritures concurrentes serveur; le frontend n'est jamais la seule protection.

## Smoke tests live

Avec une réservation de simulation explicitement autorisée :

1. Connexion gérant, ouverture Planning.
2. Vérifier un `checkedin` dont le départ prévu est dépassé : visible, badge discret et unité occupée.
3. Vérifier Analytics et Housekeeping : unité occupée, aucune tâche ménage créée par la date seule.
4. Vérifier Booking Engine : même unité refusée tant que le séjour reste checkedin.
5. F5 puis lendemain simulé/contrôlé : séjour toujours visible et checkedin.
6. Vérifier Guest : Wi-Fi/services restent gouvernés par checkedin, Folio inchangé.
7. Effectuer un checkout staff contrôlé : transition unique, unité libérée et tâche `checkout-<reservation_id>` créée dans la même transaction PostgreSQL.
8. Réessayer le checkout : réponse idempotente, même ID ménage et aucune seconde tâche.
9. Vérifier une réservation checkedout et une cancelled ordinaires.

`checkout-completed` est seulement une notification frontend legacy. Il ne prouve pas un événement durable et ne crée pas la tâche ménage canonique. Ce lot ne crée ni `veraluz_events` ni `veraluz_event_jobs`.

Le trigger DB est l'autorité atomique. `ensureCheckoutEffects` dans l'Edge Function reste une défense idempotente et répare aussi un checkout antérieur auquel la tâche manquerait.

## Rollback

1. Revenir au commit frontend précédent.
2. Redéployer la version précédente de `reservation-workflow`.
3. Restaurer la définition auditée précédente de `create_booking_hold` seulement si le RPC produit une régression.
4. Conserver par défaut l'index d'unicité `checkedin`; ne le retirer qu'après preuve d'incompatibilité et validation explicite, car il protège l'invariant physique.
5. Conserver par défaut `trg_veraluz_checkout_housekeeping`; ne le retirer avec sa fonction qu'après preuve d'une régression, car il garantit l'atomicité checkout/ménage.
6. Conserver les tâches ménage déjà créées : leurs IDs déterministes évitent toute duplication lors d'un retry ou d'un redéploiement.

Le rollback ne modifie aucune donnée de réservation et ne transforme jamais un `checkedin` en `checkedout`.
