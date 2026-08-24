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

## Ordre recommandé

1. Appliquer `20260824_recovery_lot_b_booking_overstay_guard.sql` : index d'invariant + RPC public atomique.
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
7. Effectuer un checkout staff contrôlé : transition unique, unité libérée, ménage/événement créés une seule fois.
8. Réessayer le checkout : réponse idempotente, aucun second effet.
9. Vérifier une réservation checkedout et une cancelled ordinaires.

## Rollback

1. Revenir au commit frontend précédent.
2. Redéployer la version précédente de `reservation-workflow`.
3. Restaurer la définition auditée précédente de `create_booking_hold` seulement si le RPC produit une régression.
4. Conserver par défaut l'index d'unicité `checkedin`; ne le retirer qu'après preuve d'incompatibilité et validation explicite, car il protège l'invariant physique.

Le rollback ne modifie aucune donnée de réservation et ne transforme jamais un `checkedin` en `checkedout`.
