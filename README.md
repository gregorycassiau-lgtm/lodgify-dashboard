# Lodgify — Tableau de bord + espace femmes de ménage

Projet complet à déployer sur **Netlify** (relié à ce dépôt GitHub).

## Structure (à respecter absolument)
```
lodgify-dashboard/
├── netlify.toml                     ← config (à la racine)
├── package.json
├── netlify/
│   └── functions/
│       └── reporting.js             ← fonction : lit Lodgify (clé API cachée)
└── public/
    ├── index.html                   ← ton tableau de bord
    └── menage.html                  ← page femmes de ménage
```
⚠️ Il ne doit y avoir **qu'un seul** `index.html`, dans `public/`. Rien à la racine à part `netlify.toml` et `package.json`.

## Réglages requis
1. **Netlify → Environment variables** : `LODGIFY_API_KEY` = ta clé Lodgify.
2. **Dans `public/menage.html`** : remplace `WHATSAPP_NUMERO = "33600000000"` par ton vrai numéro (format international, sans + ni espaces).

## Pages
- Tableau de bord : `https://TON-SITE.netlify.app/`
- Femmes de ménage : `.../menage/royan` et `.../menage/bordeaux`

## Base de données (déjà créée)
Les signalements des femmes de ménage sont stockés dans Supabase (projet « menage-conciergerie »).
La clé utilisée dans les pages est la clé **publique** (anon) : c'est normal et sans risque,
l'accès est limité à la seule table des signalements.
