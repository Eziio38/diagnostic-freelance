# EXCOMMUNICADO — gun-fu tactique en local

Jeu d'action vue du dessus, **100 % local** (HTML5 / Canvas / Web Audio, aucune dépendance, aucun asset externe), inspiré de l'univers de John Wick : combat rapproché mêlant judo et tir au pistolet, munitions comptées, létalité réaliste, protections balistiques, ennemis qui se mettent à couvert.

## Lancer le jeu

1. Ouvrir `excommunicado/index.html` dans un navigateur récent (Chrome, Edge, Firefox) — un double-clic suffit.
2. Ou servir le dossier en local si le navigateur bloque le `file://` :
   ```bash
   cd excommunicado && python3 -m http.server 8000
   # puis http://localhost:8000
   ```

Le son est synthétisé en temps réel (Web Audio) et démarre au premier clic.

## Commandes

| Touche | Action |
|---|---|
| `Z Q S D` / `W A S D` / flèches | Se déplacer (AZERTY et QWERTY détectés automatiquement) |
| Souris | Viser — le personnage regarde toujours le curseur |
| Clic gauche | Tirer (semi-auto : un clic = un tir ; auto : maintenir) · couteau : frapper |
| Clic droit (maintenu) | Visée précise (dispersion réduite, marche lente) |
| `R` | Recharger (chargeur partiel conservé, +1 chambrée ; arme vide = culasse ouverte, plus long ; fusil à pompe cartouche par cartouche) |
| `F` | Mêlée gun-fu : frappe → **désarmement** (2ᵉ coup, vous récupérez l'arme) → **projection** (3ᵉ coup) → **exécution** (`F` sur un ennemi à terre) |
| `Espace` | Esquive (pas d'invulnérabilité, mais les tireurs ratent une cible rapide) |
| `Maj` | Courir (endurance, bruit, imprécision) |
| `E` | Ramasser arme / munitions / kit de soins / plaque |
| `G` | Lancer l'arme en main (étourdit l'ennemi, se ramasse ensuite) |
| `H` | Kit de soins (3 s, interrompu si touché) |
| `B` | Mode de tir auto / semi |
| `1`–`4`, molette, `Tab` | Changer d'arme (plus rapide que recharger) |
| `Échap` / `P` | Pause |

## Ce qui est simulé

- **Munitions** : chaque chargeur a son propre compte de cartouches ; la réserve est une liste de chargeurs, pas un total magique. Cartouche chambrée « +1 ». Culasse ouverte au dernier tir. Les armes des morts se ramassent avec ce qu'il leur reste.
- **Zones d'impact** : tête (létal), torse, membres (ralentissement). Plus le tir est centré sur la cible, plus il touche haut : la précision paie.
- **Protections** : costume balistique du joueur (absorbe l'essentiel des tirs au torse, s'use), gilets légers, plaques lourdes (le 9 mm ne passe pas) et casques (un premier tir de pistolet le brise, le second tue ; la carabine 5,56 traverse).
- **Balistique** : murs et piliers opaques ; portes en bois et vitres traversées avec perte d'énergie (les vitres éclatent) ; caisses/meubles arrêtent le pistolet mais pas la carabine, qui traverse aussi un corps.
- **Armes** : P-30L et G-34 (9 mm), 1911 (.45), G-19 (ennemis), MP-9 (PM 9 mm), TR-1 (carabine 5,56, auto/semi), M-4 tactique (calibre 12, 7+1, 8 plombs), couteau.
- **IA** : temps de réaction selon la compétence, rafales puis pause, repli à couvert pour recharger avec « peek », flanquement, alerte des alliés à la vue et au bruit (rayon réduit derrière les murs), fouille de la dernière position connue, désarmés qui vont chercher une arme au sol ou chargent au corps à corps, spécialistes au couteau en zigzag.
- **Vision** : brouillard de vision par lancer de rayons (on ne voit que ce qui est en ligne de vue), éclairage par sources, flashs de bouche qui éclairent.
- **Trois difficultés** : Cinéma, Réaliste (défaut), Baba Yaga.

## Niveaux

1. **Effraction** — la maison, de nuit : une douzaine d'intrus, un P-30L et trois chargeurs.
2. **Club Rouge** — sicaires équipés de PM et gilets, spa vitré, piste de danse à piliers.
3. **Le Continental** — galerie des miroirs, mercenaires blindés (plaques + casques), armurerie, le Contrat.
4. **Contrat ouvert** — mode survie par vagues, réapprovisionnement entre les vagues.

La progression et les meilleurs temps sont sauvegardés dans le navigateur (localStorage).

## Structure

```
excommunicado/
├── index.html        page, menus, briefing, écrans de fin
├── style.css
└── js/
    ├── util.js       maths, tas binaire, stockage
    ├── audio.js      synthèse des sons et musiques (Web Audio)
    ├── input.js      clavier (event.code) + souris
    ├── weapons.js    armes, munitions, chargeurs, rechargements
    ├── maps.js       niveaux en ASCII
    ├── world.js      grille, collisions, rayons, A*, portes, vitres, décals
    ├── entities.js   joueur, ennemis (IA), balles, ramassages, dégâts
    ├── render.js     rendu, éclairage, brouillard de vision, HUD
    └── game.js       boucle, niveaux, vagues, effets, interface
```

Projet original de fan, sans musique, image ni texte tirés des films.
