# Reporting locatif Lodgify — tableau de bord + email quotidien

Deux briques :

1. **Tableau de bord en direct** (Netlify) : affiche taux de remplissage, revenus et prix moyen par propriété, en récupérant les données Lodgify en temps réel.
2. **Email quotidien** (n8n) : chaque matin, un récapitulatif des réservations à venir et des conseils tarifaires.

La clé API Lodgify reste **toujours côté serveur** — jamais dans le navigateur.

---

## Prérequis

- Un compte Lodgify avec l'API activée. Récupère ta clé dans **Réglages → Public API**.
- Un compte Netlify (gratuit).
- Ton instance n8n (déjà connectée) pour l'email.

---

## 1. Déployer le tableau de bord sur Netlify

### Option A — via l'interface Netlify (le plus simple)
1. Pousse ce dossier sur un dépôt GitHub (privé de préférence).
2. Sur Netlify : **Add new site → Import an existing project**, choisis le dépôt.
3. Netlify détecte `netlify.toml` automatiquement (publish = `public`, functions = `netlify/functions`).
4. **Site settings → Environment variables**, ajoute :
   - `LODGIFY_API_KEY` = ta clé API Lodgify
5. **Deploy**. Ton tableau de bord est en ligne ; il appelle la fonction `/.netlify/functions/reporting`.

### Option B — en local (test)
```bash
npm install -g netlify-cli
netlify login
LODGIFY_API_KEY=ta_cle netlify dev
```
Puis ouvre l'URL locale affichée (souvent http://localhost:8888).

### Structure
```
lodgify-dashboard/
├─ netlify/functions/reporting.js   # proxy sécurisé + calcul des stats
├─ public/index.html                # le tableau de bord (charts + tableau)
├─ netlify.toml                     # config Netlify
└─ package.json
```

> **Sécurité** : la clé n'apparaît que dans la variable d'environnement Netlify.
> Le navigateur n'appelle que ta fonction, jamais Lodgify directement.

---

## 2. Email quotidien via n8n

1. Dans n8n : **Workflows → Import from File**, sélectionne `n8n-workflow.json`.
2. Ajoute la clé API : **Settings → Variables** (ou variable d'environnement `LODGIFY_API_KEY`),
   référencée dans le nœud HTTP par `{{$env.LODGIFY_API_KEY}}`.
3. Ouvre le nœud **« Envoyer l'email »** :
   - remplace `TON_EMAIL@exemple.fr` par ton adresse ;
   - choisis tes identifiants SMTP, **ou** remplace ce nœud par le nœud **Gmail** (tu as Gmail connecté).
4. Ajuste l'heure d'envoi dans le nœud **« Chaque jour à 8h »** si besoin.
5. Active le workflow (interrupteur en haut à droite).

### Ce que contient l'email
- Le nombre total de réservations à venir.
- Par propriété : les arrivées dans les 14 prochains jours.
- Par propriété : les conseils tarifaires sur les 3 prochains mois
  (alerte renforcée si un mois de haute saison — juin à août — est sous-rempli).

Le seuil de déclenchement des conseils (`SEUIL = 35 %`) se règle en haut du nœud **« Calcul & conseils »**.

---

## Aller plus loin
- **Webhooks Lodgify** : recevoir une alerte instantanée à chaque nouvelle réservation (plutôt qu'un point quotidien).
- **Écriture des prix** : Lodgify permet aussi de *pousser* des tarifs. On pourrait, à terme, appliquer automatiquement les baisses suggérées (à activer prudemment, avec validation manuelle d'abord).
- **Historique** : stocker chaque exécution dans une base (Supabase, que tu as connecté) pour suivre l'évolution dans le temps.
