<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>Votre espace de travail, en un clic.</strong></p>
  <p>Tâches, notes, liens, enregistrements et alertes IA, prêts au bord de l’écran.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">Télécharger</a> ·
    <a href="#démarrer">Démarrer</a> ·
    <a href="docs/user-guide.en.md">Guide</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">Signaler un problème</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?logo=apple" alt="macOS 13+ Apple Silicon" />
    <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4" alt="Windows 10/11 x64" />
    <img src="https://img.shields.io/badge/License-MIT-35c58b" alt="MIT" />
  </p>
  <p>
    <a href="README.md">简体中文</a>
    ·
    <a href="README.zh-TW.md">繁體中文</a>
    ·
    <a href="README.en.md">English</a>
    ·
    <a href="README.ja.md">日本語</a>
    ·
    <a href="README.ko.md">한국어</a>
    ·
    <a href="README.es.md">Español</a>
    ·
    <strong>Français</strong>
    ·
    <a href="README.de.md">Deutsch</a>
    ·
    <a href="README.ru.md">Русский</a>
    ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Aperçu de Pome Panel](docs/screenshots/workspace-overview.png)

<p align="center"><sub>Cliquez sur la capsule pour l’ouvrir. Glissez-la repliée vers un bord. Organisez l’accueil comme vous voulez.</sub></p>

## Un panneau pour le quotidien

|  |  |
| --- | --- |
| **Accueil** | Widgets pour minuteur, notes rapides, almanach, lever et coucher du soleil |
| **Tâches et notes** | 1–8 catégories avec rappels ; notes Markdown et bibliothèque |
| **Liens et enregistrements** | Sites par groupe ; audio avec transcription optionnelle |
| **IA** | Quotas restants et alertes de fin depuis les sources connectées |
| **Presse-papiers et identifiants** | Historique à la demande ; clés dans le stockage sécurisé système |
| **Sync NAS** | Appariez un NAS fnOS pour synchroniser entre appareils |

<details>
<summary><strong>Voir tâches et notes</strong></summary>
<br />
<table>
  <tr>
    <td width="50%"><img src="website/public/product-captures/en/todo.jpg" alt="" /><p align="center">Planifier</p></td>
    <td width="50%"><img src="website/public/product-captures/en/notes.jpg" alt="" /><p align="center">Prendre des notes</p></td>
  </tr>
</table>
</details>

## Démarrer

1. Voir [Releases](https://github.com/Sunanang/Pome-Panel/releases) : `arm64.dmg` (Mac) ou `windows-x64-setup.exe` (Windows).
2. Ouvrez l’app et cliquez sur la capsule. Glissez-la repliée pour changer de bord.
3. Choisissez les fonctions dans Réglages. IA, transcription et NAS sont optionnels.

Les installateurs suivent Releases. Sinon, lancez depuis les sources. Voir le [changelog](CHANGELOG.en.md).

> Les données restent dans le dossier local `Pome Panel` (modifiable). La sync NAS est optionnelle. Certaines fonctions natives Windows sont désactivées par défaut ; voir le [guide](docs/user-guide.en.md#windows).

## Lancer depuis les sources

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+. Tests, site, NAS et builds dans [développement](docs/development.en.md).

## En savoir plus

[Guide](docs/user-guide.en.md) · [Développement](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS](fnos/)

L’interface prend en charge English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский et Português (Brasil). Les nouvelles traductions sont en relecture ; captures et textes traditionnels de l’almanach restent dans leur langue d’origine.

---

Basé sur [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel). Merci à l’auteur d’origine.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
