# VERALUZ Signature UI System v1

## Intention

VERALUZ OS doit évoquer une hospitalité camerounaise premium, chaleureuse et opérationnelle : la profondeur de l'Atlantique, la lumière dorée, le sable clair et l'efficacité d'un outil hôtelier quotidien.

Le système doit rester :

- premium sans devenir décoratif ;
- chaleureux sans réduire les contrastes ;
- lisible sur mobile et sur les écrans opérationnels ;
- cohérent entre application, Guest Portal, emails, PDF et impressions ;
- léger, CSS-first et compatible avec l'architecture HTML/JS actuelle.

## Signature de marque

### Couleurs principales

| Rôle | Nom VERALUZ | Valeur de référence | Usage |
|---|---|---:|---|
| Structure | Nuit de Kribi | `#041B21` | navigation, surfaces fortes, CTA primaire |
| Encre | Atlantique profond | `#082B33` | titres, sidebar, entêtes |
| Interaction | Océan Veraluz | `#008C95` | sélection, information, liens graphiques |
| Interaction lisible | Océan profond | `#006A73` | texte interactif sur fond clair |
| Accent | Or Veraluz | `#C9A84C` | signature, CTA exceptionnel, détails premium |
| Accent lisible | Or profond | `#7A5C10` | texte doré sur fond clair uniquement |
| Fond | Ivoire sable | `#F5F2EA` | canevas clair |
| Surface | Blanc coquillage | `#FFFCF5` | cartes et panneaux |

L'or est un accent rare. Sur fond clair, `#C9A84C` ne doit pas servir aux petits textes ; utiliser `#7A5C10` ou l'encre. L'océan vif ne remplace pas les couleurs sémantiques.

### Couleurs sémantiques

- vert : succès, paiement reçu, actif, disponible ;
- ambre : attente, échéance, attention ;
- rouge : dette, retard, erreur, action destructive ;
- océan profond : information et sélection ;
- violet éventuel : réservé à une catégorie métier explicitement documentée, jamais comme accent générique.

Un statut comporte toujours un libellé. La couleur seule ne suffit jamais.

## Typographie

- Police UI cible : `Inter` si elle est déjà disponible ou auto-hébergée.
- Repli : `Segoe UI`, `system-ui`, sans-serif.
- Ne pas ajouter plusieurs polices ni une dépendance distante uniquement pour la marque.
- Les montants utilisent `font-variant-numeric: tabular-nums`.
- La typographie serif du logo ne doit pas devenir la police des interfaces opérationnelles.

## Géométrie

Échelle : 14, 18, 24, 32, 48 et 64 px, plus le format pilule.

La carte signature asymétrique est réservée aux surfaces majeures :

- synthèse Dashboard ;
- profil client ou séjour ;
- résumé financier/folio ;
- résumé contractuel ;
- accueil Guest Portal.

Tables, champs, petits widgets, KDS et cartes répétées restent réguliers. Une asymétrie sur chaque carte détruit la signature.

## Intensité par module

| Module | Intensité de la signature | Règle |
|---|---|---|
| Dashboard / Direction | Forte | hero de synthèse + métriques hiérarchisées |
| Guest Portal | Forte et chaleureuse | surfaces organiques, actions simples, mobile-first |
| Finance / Folio | Forte mais sobre | chiffres explicites, aucun montant ambigu |
| Profils clients / contrats | Moyenne à forte | résumé prioritaire, historique ensuite |
| Documents | Moyenne | lisibilité, métadonnées, aperçu et actions |
| Réservations / Planning | Moyenne | densité et états métier prioritaires |
| RH / Maintenance | Moyenne | listes, formulaires et statuts cohérents |
| Restaurant / Cuisine KDS | Faible | rapidité, contraste et densité avant décoration |
| Livreur | Faible à moyenne | mobile, boutons atteignables, états évidents |
| Emails / PDF / reçus | Adaptée au support | stabilité et impression avant géométrie applicative |

## Composants

### Navigation

- sidebar Atlantique profond ou Nuit de Kribi ;
- monogramme compact ;
- famille d'icônes linéaires cohérente ;
- état actif lisible avec Océan Veraluz et un accent or discret ;
- l'or ne colore pas tous les liens.

### Cartes

- une surface porte une information significative ;
- éviter les cartes imbriquées sans nécessité ;
- bordure subtile et ombre diffuse ;
- la mise en page doit rester compréhensible sans ombre.

### Boutons

- primaire : Atlantique/Nuit avec texte clair ;
- accent exceptionnel : Or Veraluz avec texte Nuit ;
- secondaire : surface neutre ;
- danger : rouge seulement pour erreur/destruction ;
- focus clavier visible sur toutes les variantes.

### Formulaires

- rayons réguliers de 14 à 18 px ;
- fond légèrement teinté ;
- bordure et focus visibles ;
- aucun champ asymétrique ;
- libellés persistants pour les données critiques.

### Tables

- chiffres alignés à droite et tabulaires ;
- séparateurs minimaux ;
- en-tête calme ;
- densité conservée pour les opérations ;
- carte mobile dédiée lorsque le tableau ne peut pas rester lisible.

### Données financières

Toujours afficher le sens du montant :

- `55 000 XAF — Solde dû` ;
- `20 000 XAF — Crédit disponible` ;
- jamais un nombre négatif isolé sans explication.

Hiérarchie : solde ou dette, montant à payer, date, dernier paiement, puis registre détaillé.

## Modes clair et sombre

### Clair

- canevas Ivoire sable ;
- cartes Blanc coquillage ou blanc ;
- contrôles légèrement teintés ;
- éviter les grands champs blanc pur sans séparation.

### Sombre

- bases Nuit/Atlantique ;
- surfaces légèrement plus claires ;
- l'or et l'océan restent des accents ;
- ne pas teinter toute l'application en vert ou turquoise.

## Logos et imagerie

Les rôles détaillés vivent dans `BRAND_ASSET_USAGE.md`.

- monogramme VR : navigation compacte, PWA et favicon ;
- blason doré : identité premium principale ;
- monochrome : impressions et contraintes techniques ;
- coucher de soleil : marketing et accueil éditorial, jamais thème global de l'OS.

Les photographies de Kribi peuvent enrichir l'accueil Guest et les surfaces marketing. Elles ne doivent pas réduire la lisibilité des écrans métier.

## Emails, PDF et impressions

- reprendre la structure Atlantique + Or avec sobriété ;
- utiliser des polices sûres pour email ;
- ne pas forcer la géométrie asymétrique dans les clients email ;
- conserver des tableaux et sauts de page stables en PDF ;
- utiliser la variante monochrome pour reçus thermiques si nécessaire ;
- faire évoluer `VERALUZ_PDF_THEME.js` dans un lot séparé, après audit, jamais automatiquement depuis UI-0.

## Accessibilité et performance

- HTML sémantique, libellés et focus visibles ;
- zones tactiles suffisantes ;
- contrastes vérifiés dans les deux thèmes ;
- prise en charge de `prefers-reduced-motion` ;
- aucune donnée fictive pour remplir une maquette ;
- aucune bibliothèque lourde pour les arrondis ou animations ;
- pas de flou plein écran, grosse vidéo ou bundle d'icônes ajouté pour le style.

## Migration contrôlée

### UI-0 — fondation

Documentation, cartographie et audit uniquement. Aucun import CSS global.

### Recovery Lot D

Le travail Documents respecte les rôles sémantiques définis ici sans transformer les autres modules.

### UI-1 — pilote futur

Trois surfaces représentatives :

1. Dashboard/accueil ;
2. profil client ou séjour ;
3. folio/résumé financier.

Le pilote doit démontrer clair, sombre, mobile, accessibilité, performances et absence de régression métier.

### Déploiement progressif

Après validation humaine du pilote : listes, détails, formulaires, settings, auth, tables, notifications, emails, PDF et rapports, par petits lots indépendants.

## Interdictions

- ne pas installer le paquet Horizon générique en parallèle ;
- ne pas renommer ou modifier des statuts métier pour le style ;
- ne pas modifier DB, RLS, Auth, routes ou contrats API ;
- ne pas multiplier les systèmes de tokens ;
- ne pas faire de refonte big-bang ;
- ne pas utiliser l'or comme couleur de succès ;
- ne pas sacrifier la densité de Restaurant, KDS ou Planning ;
- ne jamais inventer des données, soldes ou graphiques.

