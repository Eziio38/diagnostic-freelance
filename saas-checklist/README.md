# SaaS Daily — Check-list quotidienne

Application mobile (PWA installable) qui **génère chaque jour une nouvelle
check-list** pour t'aider à développer ton SaaS, répartie en catégories :

- 🖱️ **Cursor / Dev** — tâches concrètes de développement et d'usage de Cursor
- 🎯 **Stratégie** — positionnement, priorités, métriques nord
- 📣 **Marketing** — contenu, acquisition, landing page
- 🧩 **Produit & Clients** — feedback, onboarding, backlog
- 📈 **Croissance** — métriques, conversion, expérimentations
- 🧠 **Focus & Routine** — deep work, bilan quotidien

## Comment ça marche

- Chaque jour, l'app pioche automatiquement quelques tâches par catégorie
  (11 tâches/jour par défaut). La sélection est **déterministe** : tu vois la
  même liste toute la journée, et une **nouvelle liste demain**.
- La rotation parcourt **tout le réservoir** de tâches avant de boucler — tu ne
  retombes pas tout de suite sur les mêmes.
- Tu peux **cocher** les tâches, **ajouter tes propres tâches** du jour, et
  naviguer vers les jours précédents.
- Un compteur de **série (streak) 🔥** récompense la régularité.
- **100 % local** : tout est stocké sur ton téléphone (`localStorage`), aucun
  serveur, aucun compte. Fonctionne **hors-ligne**.

## Installer sur mobile

1. Héberge le dossier `saas-checklist/` sur n'importe quel hébergement statique
   (GitHub Pages, Netlify, Vercel…) **ou** ouvre-le via un petit serveur local.
2. Ouvre l'URL dans **Safari (iOS)** ou **Chrome (Android)**.
3. Menu **Partager → « Sur l'écran d'accueil »** (iOS) ou
   **⋮ → « Installer l'application »** (Android).

L'app apparaît alors comme une vraie application mobile (plein écran, icône,
hors-ligne).

## Lancer en local

```bash
cd saas-checklist
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

> Un service worker exige `http(s)` ou `localhost` (pas `file://`).

## Personnaliser les tâches

Toutes les tâches vivent dans [`tasks.js`](./tasks.js). Ajoute, retire ou
modifie librement les entrées de chaque catégorie, et ajuste `perDay` pour
changer le nombre de tâches tirées par catégorie chaque jour.

## Régénérer les icônes

```bash
python3 icons/make_icons.py
```

(Générateur PNG en Python pur, sans dépendance.)

## Structure

```
saas-checklist/
├── index.html            # interface
├── styles.css            # thème sombre, mobile-first
├── tasks.js              # banque de tâches par catégorie
├── app.js                # génération du jour + persistance locale
├── sw.js                 # service worker (hors-ligne)
├── manifest.webmanifest  # métadonnées PWA
└── icons/                # icônes + générateur
```
