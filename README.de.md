<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>Dein Arbeitsbereich, einen Klick entfernt.</strong></p>
  <p>Aufgaben, Notizen, Links, Aufnahmen und KI-Hinweise – bereit am Bildschirmrand.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">App holen</a> ·
    <a href="#loslegen">Loslegen</a> ·
    <a href="docs/user-guide.en.md">Anleitung</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">Problem melden</a>
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
    <a href="README.fr.md">Français</a>
    ·
    <strong>Deutsch</strong>
    ·
    <a href="README.ru.md">Русский</a>
    ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Pome Panel Vorschau](docs/screenshots/workspace-overview.png)

<p align="center"><sub>Kapsel anklicken zum Öffnen. Eingeklappt an einen Rand ziehen. Home nach Bedarf anordnen.</sub></p>

## Ein Panel für den Alltag

|  |  |
| --- | --- |
| **Home** | Widgets für Timer, Kurznotizen, Almanach, Sonnenauf- und -untergang |
| **Aufgaben & Notizen** | 1–8 Kategorien mit Erinnerungen; Markdown und Notizbibliothek |
| **Links & Aufnahmen** | Websites gruppieren; Audio mit optionaler Transkription |
| **KI** | Kontingente prüfen und Abschlussmeldungen verbundener Quellen empfangen |
| **Zwischenablage & Zugangsdaten** | Verlauf bei Bedarf; Schlüssel im System-Secure-Storage |
| **NAS-Sync** | Optional mit fnOS-NAS koppeln und geräteübergreifend synchronisieren |

<details>
<summary><strong>Aufgaben und Notizen</strong></summary>
<br />
<table>
  <tr>
    <td width="50%"><img src="website/public/product-captures/en/todo.jpg" alt="" /><p align="center">Aufgaben planen</p></td>
    <td width="50%"><img src="website/public/product-captures/en/notes.jpg" alt="" /><p align="center">Notizen erfassen</p></td>
  </tr>
</table>
</details>

## Loslegen

1. [Releases](https://github.com/Sunanang/Pome-Panel/releases): `arm64.dmg` (Mac) oder `windows-x64-setup.exe` (Windows).
2. App öffnen und die Kapsel am Rand anklicken. Eingeklappt ziehen, um die Position zu ändern.
3. In den Einstellungen Funktionen wählen. KI, Transkription und NAS sind optional.

Installer folgen Releases. Sonst aus dem Quellcode starten. Siehe [Changelog](CHANGELOG.en.md).

> Daten liegen im lokalen Ordner `Pome Panel` (änderbar). NAS-Sync ist optional. Einige Windows-Native-Funktionen sind standardmäßig aus; siehe [Anleitung](docs/user-guide.en.md#windows).

## Aus dem Quellcode

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+. Tests, Website, NAS und Builds in den [Entwicklungsdocs](docs/development.en.md).

## Mehr erfahren

[Anleitung](docs/user-guide.en.md) · [Entwicklung](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS](fnos/)

Die Oberfläche unterstützt English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский und Português (Brasil). Neue Übersetzungen werden noch geprüft; Screenshots und traditionelle Almanach-Texte behalten die Originalsprache.

---

Basierend auf [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel). Danke an den ursprünglichen Autor.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
