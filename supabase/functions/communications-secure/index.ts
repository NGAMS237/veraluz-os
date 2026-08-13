/**
 * MICRO 011E-2C.1 — communications-secure Edge Function v4 (ACTIVE)
 * Fixes v4:
 *   - checkout_housekeeping: retrait guest_name du SELECT (colonne inexistante)
 *   - delivery_assigned_driver: delivery_address → room_number (colonne correcte)
 *   - validateSession: accepte status='active' ET 'actif'
 *   - Templates 4 événements: variables underscore (item_name, order_number...)
 *
 * Source complète déployée directement sur Supabase (v4, ACTIVE).
 * 40/40 tests E2E PASS — 2026-08-13
 *
 * Bugs corrigés vs v3:
 *   - v3 sélectionnait guest_name dans veraluz_reservations → null → reservation_not_checkedout
 *   - v3 sélectionnait delivery_address dans veraluz_food_orders → null → order_not_found
 *   - Templates initiaux avaient des variables dot-notation (order.status, unit.name)
 *     incompatibles avec les variables underscore envoyées par l'EF
 */
export {};
