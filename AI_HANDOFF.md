# Handoff actif Claude–Codex — `ai/coordination`

Règles : `AI_COLLABORATION.md`. Skills : `.agents/skills/veraluz-*`.
Conserver les tâches actives et environ 10 transmissions récentes.

## LOCK actifs

*(aucun LOCK actif)*

## Lots actifs

SETTINGS-SSOT-1A | claude/settings-ssot-1a | HEAD b6657c1 | READY LOCAL — push manuel requis (bundle: veraluz_predeploy_guards.bundle)
SETTINGS-FISCAL-1 | claude/settings-ssot-1a | HEAD f883b36 | READY LOCAL (review fixes appliqués — commit pending)
CATALOG-SSOT-1 | claude/settings-ssot-1a | HEAD bb32ec3 | READY LOCAL (review fixes appliqués — commit pending)
REVIEW-FIX-FISCAL-CATALOG | claude/settings-ssot-1a | HEAD pending | PRÊT COMMIT — 7 blockers fermés (amenities JSONB, status active/maint/oos, delete unit_id FK, tourist_tax_type pct cap, LS SSOT import, DB KO branding/restaurant/localisation, fiscal fallback supprimé)

Prochaine phase : notifications / system / integrations / email cleanup → Guest Portal

## Transmissions récentes

`2026-08-21 | Claude | MICRO-PATCH-PREDEPLOY | claude/settings-ssot-1a | b6657c1 | 10 cas H1–H10 ajoutés SETTINGS_SSOT_1A_TESTS.md | READY LOCAL push bloqué CCR → bundle veraluz_predeploy_guards.bundle | aucun LOCK | 7 fixes : _LS_CANONICAL+devises/fiscal, exportSettings() filtre canonical, saveCanonical() guard DB KO, logo-upload-secure branding error+old_path_removed réel, legacy logoUrl migration, fiscal partial update bypass fermé (existing DB read avant validation), guest-access checkout_time '12:00'`

`2026-08-20 | Claude | REVIEW-FIX-FISCAL-CATALOG | claude/settings-ssot-1a | pending | 11 cas CATALOG + 11 cas FISCAL (STATIC+runtime) | PRÊT COMMIT | aucun LOCK | 7 blockers fermés : catalog-secure v2 (statuts active/maintenance/out_of_service, amenities JSONB array, delete .eq('unit_id') FK correcte, countErr guard), migration catalog (amenities::jsonb, status='active'), settings-secure tourist_tax_type pct cap, SETTINGS_EMBEDDED importSettings() + loadSettings() filtrent _LS_CANONICAL, DB KO branding/restaurant/localisation, RESERVATIONS tax_pct fallback supprimé, texte UI fiscal non-trompeur`

`2026-08-20 | Claude | CATALOG-SSOT-1 | claude/settings-ssot-1a | bb32ec3 | 10 cas CATALOG_SSOT_1_TESTS.md | READY LOCAL | aucun LOCK | HUMAN RETEST puis merge main si OK — catalog-secure EF (get_catalog anon, upsert_unit+delete_unit settings.manage), SETTINGS_EMBEDDED renderChambres() via veraluz_units DB, migration 20260820_catalog_ssot_1.sql seed 3 unités. S.chambres localStorage éliminé.`

`2026-08-20 | Claude | SETTINGS-FISCAL-1 | claude/settings-ssot-1a | f883b36 | 7 cas SETTINGS_FISCAL_1_TESTS.md | READY LOCAL | aucun LOCK | HUMAN RETEST puis merge main si OK — settings-secure EF ajout fiscal key+validation, SETTINGS_EMBEDDED renderTarifs() lit _dbSett.fiscal, saveFiscalCanonical(), RESERVATIONS_EMBEDDED tax readonly depuis DB, migration 20260820_settings_fiscal_1.sql. S.tarifs localStorage éliminé.`

`2026-08-20 | Claude | SETTINGS-SSOT-1A | claude/settings-ssot-1a | 7416774 | 17/17 checks PASS | READY LOCAL — push manuel requis (push_settings_ssot_1a.bat) | aucun LOCK | HUMAN RETEST 20 cas (tests/SETTINGS_SSOT_1A_TESTS.md) puis merge main si OK — Fichiers: migration 20260820_settings_ssot_1a.sql (branding+localization seed, restaurant extend idempotent, legacy camelCase→snake_case), settings-secure v2 (localization WRITABLE, base64 reject, whitelist), logo-upload-secure v2 (path unique, atomicité Storage+DB), SETTINGS_EMBEDDED (DB canonical branding/localization/restaurant, tri-state badge, saveAll() filtre canonical), CORE (vz_locale localStorage supprimé)`

`2026-08-20 | Claude | AUTH CLOSED + MERGE MAIN | main | merge claude/auth-final-integration | AUTH PHASE TERMINÉE — anomalie UI AUTH-UI-1 en backlog (Profil/Users vue croisée, non bloquante sécurité). Livrés : profil serveur, team_name, PIN/reset/forced change, sessions/F5, multi-session, RBAC serveur, Sessions/Audit/Sécurité réels, IP/UA tracking, security settings SSOT, X-Veraluz-Session header only, session_token hors body. Prochaine phase : SETTINGS-SSOT-1 | AUTH CLOSED | aucun LOCK | démarrer SETTINGS-SSOT-1`

`2026-08-20 | Claude | AUTH UI BLOCKERS FINAL | claude/auth-final-integration | 363797a | settings-secure v4: WRITABLE_KEYS+security, SECURITY_ALLOWED_FIELDS whitelist 5 champs, SECRET_PATTERNS dans else seulement — resume_token_days sauvegardable. AUTH_EMBEDDED: _renderGen counter + renderProfil(gen)/_renderGen!==gen double-guard + renderUsers(gen)/loadSBEmployees double-guard + renderProfilReload guard. 15/15 tests PASS. EF déployé ACTIVE | AUTH LAST HUMAN RETEST READY | aucun LOCK | tester: Settings→Sécurité save 12→13→reload→13 puis 12→reload→12 | Profil/Users navigation rapide sans pollution croisée`

`2026-08-20 | Claude | AUTH UI POLISH | claude/auth-final-integration | eaa1b05 | AUTH_EMBEDDED: loadSBEmployees cb guarded (currentTabId==='users'); renderProfil .then() guarded (currentTabId!=='profil'); Sessions affiche IP réelle / 'Non disponible' si null; statusBadge dupliqué supprimé. SETTINGS_EMBEDDED: card imbriquée retirée renderSysteme; renderSecuriteCard() réécriture classes natives .row/.toggle-info/.toggle-label/.toggle-track/.row-hint. 17/17 tests PASS | AUTH UI FINAL RETEST READY | aucun LOCK | tester: Profil≠Utilisateurs, Sessions affiche IP, Settings Sécurité lisible et champs éditables`

`2026-08-20 | Claude | AUTH-SECURITY-FINAL-PATCH | claude/auth-final-integration | ca4569b | CORE: issueCoreResumeToken+direct fetch+change-pin fetch → X-Veraluz-Session header (session_token hors body); issue-resume-token v4 (header + resume_token_days SSOT); reset-employee-pin v10 (header + temp_pin_expiry_hours SSOT + p_expires_at RPC); change-employee-pin v7 (header auth); auth-admin-secure v3 (_rbac.ts manager sans auth.sessions/audit.read); SETTINGS_EMBEDDED renderSecuriteCard() standalone (SyntaxErrors apostrophes résolus); 18/18 tests PASS | AUTH FINAL HUMAN TEST READY | aucun LOCK | tester login+F5, Settings→Sécurité éditables, reset PIN direction, resume_token_days appliqué, no session_token dans body réseau`

`2026-08-20 | Claude | AUTH-SECURITY-FINAL | claude/auth-final-integration | 0289347 | verify-employee-pin v9 (IP/UA tracking, session_lifetime depuis DB); resume-employee-session v4 (post-RPC last_ip/ua); auth-admin-secure v2 (IMMUTABLE+configurable policies, device/ip réels); settings-secure v3 (security key + validation ranges); _rbac.ts (auth.sessions/audit.read manager); VERALUZ_OS_CORE: reqBody.session_token supprimé; SETTINGS_EMBEDDED: section Sécurité Authentification; AUTH_EMBEDDED: polBool notes et feat card nettoyée; veraluz-git skill: token éphémère | PRÊT POUR RETEST | aucun LOCK | tester connexion (IP enregistrée), Auth→Sécurité (params DB), Settings→Système→Sécurité (éditables)`

`2026-08-20 | Claude | AUTH-FINAL-FIX | claude/auth-final-integration | 167d400 | fix(auth): team_name résolu depuis veraluz_teams, dept filtre ID techniques; employees-secure v4 déployé; AUTH_EMBEDDED.html patchés | COMPLET | aucun LOCK | AUTH-SECURITY-FINAL`

`2026-08-19 | Claude | AUTH SyntaxError fixes | claude/auth-final-integration | d7486e2 | AUTH_EMBEDDED 3 apostrophes + SETTINGS_EMBEDDED 2 apostrophes corrigés via GitHub web editor | COMPLET | aucun LOCK | AUTH-FINAL-FIX`

`2026-08-19 | Claude | AUTH FINAL INTEGRATION | claude/auth-final-integration | 0e57dc8 | cherry-pick R6 (288ce19); conflit CORE résolu; 35/35 tests PASS | COMPLET | aucun LOCK | SyntaxError fixes`

`2026-08-19 | Claude | AUTH-R6 | claude/auth-r6 | 288ce19 | auth-admin-secure EF; DEMO supprimés; sessions réelles; audit events; 16/16 tests | COMPLET | aucun LOCK | FINAL INTEGRATION`

`2026-08-19 | Claude | AUTH-R5 | main | 7ead666 | _rbac.ts; employees-secure v3; room-service v3; reservation-workflow v2; AUTH_EMBEDDED matrice read-only; 11/11 tests | COMPLET | aucun LOCK | AUTH-R6`

`2026-08-19 | Claude | AUTH-R3A.1 LIVE | claude/auth-r3a-pin-reset | b40ebc7 | migration PROD appliquée; EF v8 ACTIVE; flux complet validé (reset→must_change_pin→change_token→session) | LIVE VALIDATED | aucun LOCK | AUTH-R5`

`2026-08-19 | Claude | AUTH-R2 PUBLISHED | main | e2f4629 | merge ff-only; 126/126 PASS; live 6/6 PASS | PUBLIÉ | aucun LOCK | validation humaine`

`2026-08-19 | Codex | AUTH-R2C | codex/auth-r2c-frontend | d7e64b7 | AUTH-R2C 18/18; éligibilité 13/13 | READY FOR REVIEW | aucun LOCK | intégration AUTH-R2D`

`2026-08-19 | Codex | AUTH-R1D PHASE C | main | 6c76f8f | containment LIVE VALIDÉ; Pages 7/7 | COMPLET | aucun LOCK | aucune`

## Format

`date | agent | lot | branche | commit | tests | statut | fichiers réservés | prochaine action`

LOCK : `LOCK | agent | branche | tâche | fichiers/zones`
