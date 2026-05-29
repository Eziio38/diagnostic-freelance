# MeetTranscriber — Web App (PWA)

Application web de transcription de réunions (Google Meet, etc.) en texte,
utilisable directement depuis Safari sur iPhone — **sans Mac ni Xcode**.

Tout tourne dans le navigateur et appelle directement l'API Whisper d'OpenAI.

## Fonctionnalités

- 🎙️ **Enregistrer** depuis le micro
- 📄 **Importer** un fichier (mp4, m4a, mp3, wav — max 25 Mo)
- 🔗 **URL directe** (liens autorisant le CORS : Dropbox, exports… pas YouTube)
- 📋 **Copier / Partager** la transcription (feuille de partage iOS native)
- 🕑 **Historique** local
- ⚙️ **Réglages** : clé API, langue

## Mise en ligne (GitHub Pages)

L'app a besoin d'une URL **HTTPS** (le micro et l'installation iOS l'exigent).
Un workflow GitHub Actions est déjà fourni (`.github/workflows/deploy-pages.yml`).

1. Sur GitHub : **Settings → Pages**
2. **Source** : choisir **GitHub Actions**
3. Le workflow déploie automatiquement le dossier `web/` à chaque push.
   (Sinon, onglet **Actions → Deploy PWA to GitHub Pages → Run workflow**.)
4. L'URL publique s'affiche à la fin du job (ex. `https://<user>.github.io/<repo>/`).

## Installer sur iPhone

1. Ouvrir l'URL dans **Safari**
2. Bouton **Partager** → **Sur l'écran d'accueil**
3. Lancer l'app depuis l'icône — elle s'ouvre en plein écran
4. Dans **Réglages**, coller votre clé API OpenAI (`sk-…`)

## Sécurité

La clé API est stockée **uniquement sur l'appareil** (localStorage) et envoyée
directement à OpenAI. Utilisez une clé avec un **plafond de dépense**
(platform.openai.com → Limits).

## Développement local

```bash
cd web
python3 -m http.server 8000
# http://localhost:8000  (micro OK sur localhost ; sinon HTTPS requis)
```

Régénérer les icônes : `python3 web/icons/make_icons.py` (nécessite Pillow).
