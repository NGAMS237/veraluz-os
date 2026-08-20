# veraluz-dev

Skill de développement pour le projet Résidence Veraluz (NGAMS237/veraluz-os).

## Contexte

Projet : appartements meublés courte durée, Kribi Cameroun. Piloté depuis le Canada.
Stack : Supabase (PostgreSQL + Edge Functions Deno) + HTML/JS vanille embarqué.
Repo : https://github.com/NGAMS237/veraluz-os
Branche principale : main

## Bâtiment

- RDC : accueil, cuisine, stationnement, restaurant
- 1er : 4 chambres indépendantes + 1 appt 2 chambres, terrasse chacune
- 2ème : 2 grands studios (1 chambre + salon + cuisine américaine + grande terrasse)
- Dernier : Suite présidentielle 3 chambres salon cuisine + grande terrasse

## 7 Principes d'architecture (règles permanentes)

1. **SSOT** — une donnée = une source canonique. Jamais de vérité parallèle.
2. **Tenant-aware** — compatible futur SaaS multi-tenant (tenant_id/property_id).
3. **Thin Frontend / Explicit Backend** — règles métier côté serveur uniquement.
4. **Server computes, AI explains** — SQL/backend calcule. IA n'est pas source de vérité.
5. **Developer-readable** — noms explicites, responsabilités courtes.
6. **Stateless + graceful degradation** — panne IA/email ne bloque pas le cœur hôtelier.
7. **Extensibilité** — réutiliser sources canoniques et APIs existantes.

## Contraintes de sécurité

- Aucune impersonation. Aucun PIN partagé/hardcodé/plaintext.
- Ne jamais afficher les hashes. Ne jamais demander un PIN réel dans le chat.
- NE PAS MERGER MAIN sans autorisation explicite de Blaise.
- Ne modifier aucun PIN réel de Blaise.
- Ne demander aucune commande Git à Blaise.
- Ne pas utiliser Computer Use pour Git.

## Edge Functions actives (projet dfdmasejsoibxrvubegu)

employees-secure v4, auth-admin-secure v3, reset-employee-pin v10,
reservation-workflow v2, room-service v3, guest-access v6,
post-restaurant-folio, communications-secure v7, dispatch-client-email v5,
messages-secure v2, settings-secure v4, change-employee-pin v7

## Tables canoniques clés

veraluz_employees, veraluz_employee_sessions, veraluz_teams,
veraluz_reservations, veraluz_units, veraluz_food_orders,
veraluz_restaurant_products, veraluz_comm_templates, veraluz_comm_log,
veraluz_settings, veraluz_guest_sessions, veraluz_folio_entries
