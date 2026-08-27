# VERALUZ Signature UI System v1

Fondation artistique canonique de VERALUZ OS, validée par Blaise le 2026-08-27.

Cette fondation est dérivée des principes utiles du paquet de référence « Horizon Signature UI System », mais elle possède désormais une identité, des tokens et des règles propres à VERALUZ. Le paquet Horizon original reste une source d'inspiration et ne doit pas être installé tel quel dans le produit.

## Autorité

Ordre de priorité :

1. règles métier, sécurité, accessibilité et données canoniques de VERALUZ ;
2. ce dossier `docs/design/veraluz-signature/` ;
3. styles historiques des écrans, jusqu'à leur migration contrôlée.

La présence de cette documentation n'autorise pas une refonte globale. Toute intégration suit le protocole :

`audit → petit pilote → tests → validation humaine → déploiement progressif`

## Fichiers

- `VERALUZ_SIGNATURE_UI_SYSTEM.md` — identité, usages et règles UX/UI.
- `VERALUZ_TOKENS.css` — tokens de référence, non importés automatiquement.
- `BRAND_ASSET_USAGE.md` — rôle officiel de chaque variante du logo.
- `AGENT_UI0_PROMPT.md` — mission d'audit UI-0 pour un agent.

## Statut de déploiement

- Fondation artistique : **décision validée**.
- Documentation : **v1**.
- Import global des tokens : **non effectué**.
- Refonte des écrans : **non autorisée par ce document**.
- Modification métier, Supabase, Auth, RLS ou API : **hors périmètre**.

## Séquencement

1. UI-0 documente et audite, sans restyler le produit.
2. Recovery Lot D reste le prochain lot métier.
3. Les nouvelles surfaces Documents utilisent les rôles sémantiques VERALUZ sans déclencher une refonte globale.
4. Un futur UI-1 pilote la direction sur trois surfaces représentatives avant tout déploiement étendu.

