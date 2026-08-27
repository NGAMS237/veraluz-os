# Mission agent — UI-0 VERALUZ Signature

## But

Installer la documentation de la fondation artistique et auditer l'interface existante. UI-0 ne restyle aucun écran.

## Autorisé

- lire tout le frontend et les générateurs email/PDF ;
- cartographier les tokens, polices, rayons, ombres, icônes et thèmes ;
- produire `VERALUZ_UI_AUDIT.md` ;
- produire `VERALUZ_UI_PILOT_PLAN.md` ;
- documenter les exceptions opérationnelles par module ;
- mettre à jour le handoff et la roadmap sur une branche dédiée.

## Interdit

- importer globalement `VERALUZ_TOKENS.css` ;
- modifier HTML, JavaScript applicatif, Supabase, Auth, RLS, routes ou API ;
- remplacer les logos existants ;
- ajouter une police, bibliothèque UI ou dépendance ;
- démarrer UI-1, Lot D ou une refonte globale ;
- merger `main` ou déployer sans autorisation explicite.

## Audit minimum

Examiner :

- styles globaux et surcharges tardives ;
- variables CSS concurrentes ;
- clair/sombre ;
- typographie ;
- boutons, cartes, formulaires, tableaux et navigation ;
- Dashboard, Guest Portal, Réservations, Restaurant/KDS, Livreur, RH, Finance et Documents ;
- emails, `VERALUZ_PDF_THEME.js`, impressions et reçus ;
- mobile, focus clavier, contrastes et reduced motion ;
- coût probable d'une migration progressive.

## Livrable attendu

Un rapport factuel contenant :

1. inventaire des systèmes actuels ;
2. correspondance vers les tokens `--vlz-*` ;
3. conflits et risques ;
4. trois surfaces proposées pour UI-1 ;
5. tests et critères d'acceptation ;
6. ordre de migration par petits lots ;
7. verdict `READY FOR UI-1 PILOT : OUI/NON`.

