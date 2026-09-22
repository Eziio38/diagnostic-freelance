# EXCOMMUNICADO — gun-fu tactique en local

Jeu d'action **vue du dessus ou 3D à la première personne**, **100 % local** (HTML5 / Canvas / Web Audio, aucune dépendance, aucun asset externe), inspiré de l'univers de John Wick : combat rapproché mêlant judo et tir au pistolet, munitions comptées, létalité réaliste, protections balistiques, ennemis qui se mettent à couvert.

## Lancer le jeu

1. Ouvrir `excommunicado/index.html` dans un navigateur récent (Chrome, Edge, Firefox) — un double-clic suffit.
2. Ou servir le dossier en local si le navigateur bloque le `file://` :
   ```bash
   cd excommunicado && python3 -m http.server 8000
   # puis http://localhost:8000
   ```

Le son est synthétisé en temps réel (Web Audio) et démarre au premier clic.

## Vue 3D à la première personne

Options → Vue → « Première personne (3D) », ou `V` en jeu (pavé tactile sur la manette). Le rendu est un raycaster maison sans dépendance : murs, portes, piliers texturés, caisses et voitures à mi-hauteur (on tire par-dessus), vitres translucides qui éclatent, sol et plafond projetés avec le sang au sol, éclairage coloré par sources avec ombres portées par les murs, sprites des ennemis (debout, à terre, morts), ramassages, balles et flashs.

- Un clic dans la fenêtre capture la souris (regard libre) ; `Échap` la libère et met en pause. Sensibilité réglable.
- Déplacement relatif au regard (avancer / reculer, pas chassés). Clic droit ou `L2` pour épauler (champ de vision resserré).
- **La visée verticale compte** : viser au-dessus des épaules touche la tête, le buste touche le torse, plus bas les jambes ; trop haut, la balle passe au-dessus.
- Modèle d'arme en vue subjective animé : culasse qui recule à chaque tir, douilles éjectées, fumée, rechargement en phases (chargeur qui tombe, main qui en insère un neuf, culasse relâchée à vide, levier d'armement sur la carabine, cartouches insérées une à une au fusil), enchaînement gun-fu (frappe de paume, saisie et désarmement, projection avec roulis de caméra), coups de couteau avec traînée, exécution avec caméra qui plonge, esquive avec inclinaison, mains et bandage pendant les soins ; minimap en haut à droite.
- Ennemis animés par un rig procédural vu de face, de dos et de profil : cycle de marche et de course, garde, tir, rechargement, recul sous l'impact, étourdissement, garde et frappe au corps à corps, projection en vol, chute en trois temps, relevé ; casques brisés et armes arrachées qui volent.
- Résolution du rendu réglable (480 à 960 colonnes) selon la machine.

## Manette PS5 (DualSense)

Branchez la manette en USB ou Bluetooth, appuyez sur un bouton : elle est détectée par l'API Gamepad du navigateur (Chrome, Edge, Firefox, mapping « standard », donc aussi DualShock 4 et manettes Xbox). Les menus se pilotent au D-pad ou au stick, `✕` valide, `○` revient. Vibrations à chaque tir, impact, esquive et projection.

| Manette | Action |
|---|---|
| Stick gauche | Se déplacer, vitesse analogique (marche lente et silencieuse jusqu'au pas rapide) |
| Stick droit | Viser : le corps pivote avec une vitesse de rotation limitée ; légère aide à la visée (désactivable) |
| `R2` | Tirer (gâchette analogique ; en semi-auto, chaque pression = un tir) |
| `L2` (maintenu) | Visée précise |
| `R1` | Mêlée : frappe → désarmement → projection ; exécution sur un ennemi à terre |
| `✕` | Esquive |
| `□` | Recharger |
| `△` | Ramasser / interagir |
| `L1` | Lancer l'arme |
| `L3` | Courir |
| D-pad `↑` / `↓` | Kit de soins / mode de tir |
| D-pad `←` / `→` | Arme précédente / suivante |
| `Options` | Pause |

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
- **Corps** : inertie au démarrage et au freinage, rotation du buste limitée à la manette, armes lourdes qui ralentissent, main qui tremble quand vous êtes essoufflé.
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
    ├── input.js      clavier (event.code), souris, manette (API Gamepad, vibrations)
    ├── weapons.js    armes, munitions, chargeurs, rechargements
    ├── maps.js       niveaux en ASCII
    ├── world.js      grille, collisions, rayons, A*, portes, vitres, décals
    ├── entities.js   joueur, ennemis (IA), balles, ramassages, dégâts
    ├── render.js     rendu 2D, éclairage, brouillard de vision, HUD
    ├── fps.js        rendu 3D première personne (raycasting, lightmap, sprites, arme)
    └── game.js       boucle, niveaux, vagues, effets, interface
```

Projet original de fan, sans musique, image ni texte tirés des films.
