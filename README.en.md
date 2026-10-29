<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>Your workspace, one click away.</strong></p>
  <p>Tasks, notes, links, recordings and AI alerts, ready at the edge of your screen.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">Get the app</a> ·
    <a href="#get-started">Get started</a> ·
    <a href="docs/user-guide.en.md">User guide</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">Report an issue</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?logo=apple" alt="macOS 13+ Apple Silicon" />
    <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4" alt="Windows 10/11 x64" />
    <img src="https://img.shields.io/badge/License-MIT-35c58b" alt="MIT" />
  </p>
  <p>
    <a href="README.md">简体中文</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <strong>English</strong> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Pome Panel workspace preview](docs/screenshots/workspace-overview.png)

<p align="center"><sub>Click the capsule to expand. Drag it while collapsed to dock on any screen edge. Arrange Home to suit your workflow.</sub></p>

## One panel for everyday work

| Feature | What it does |
| --- | --- |
| **Home workspace** | Arrange widgets for focus timers, quick notes, the almanac, sunrise, sunset and current weather |
| **Tasks and notes** | Organize 1–8 task categories with due reminders; write Markdown notes and keep a searchable library |
| **Links and recordings** | Save websites by group, record audio, and optionally enable live transcription and smart naming |
| **AI assistants** | Check remaining quotas across providers and receive task completion alerts from connected sources |
| **Clipboard and credentials** | Enable clipboard history when needed; encrypt accounts and keys with system secure storage |
| **NAS sync** | Optionally pair a fnOS NAS to sync workspace content across devices |

Home quick notes remain recoverable editable drafts. Save collects the text into the Notes library and clears Home. The entire quick-note widget, including its background, title, controls and text, narrows into a curved funnel and is absorbed into the Notes tab; a fresh empty widget appears in place, and you can type the next draft during the flight. Reduced motion uses brief feedback. In Notes, click the body to edit; Save or Ctrl/Cmd+S returns to preview at the current reading position. Background autosave keeps editing active. Links and text selection retain their usual behavior; failed saves retain the text and offer retry in the error bar.

Notes and Recordings use a narrow library on the left and a larger detail card on the right. Credentials keeps its creation form on the left and search and management on the right. Recording playback supports seeking, volume and speed controls.

Tasks remind one hour before their deadline and catch up if no reminder was displayed. A batch of at least three overdue tasks becomes one summary that opens Tasks and highlights its members. Only a displayed reminder consumes its state; unseen tasks recover after re-enabling or restarting. Receipts persist in the workspace’s `todo-reminders.json` and sync with task state. Older values cannot reset a mark for the same task and deadline; changing the deadline starts a new reminder. Two devices running offline can each remind before their states synchronize. With Windows native features disabled, clicking a bubble only dismisses it; open Tasks to review its contents.

On macOS, Current windows enumerates and focuses standard windows exposed through Accessibility. Real same-title windows remain separate. Closed or unavailable targets offer refresh instead of opening a different window; minimized targets can be restored. Rows prioritize the window title and show the application underneath. Narrow widgets use one scrollable column, and every entry remains reachable. Hold and drag a row out to hide that window; Restore reveals hidden rows. Existing hidden preferences are retained. Reading window titles requires Accessibility, without requesting screen-recording access.

The Mac app uses the distinct `com.pomepanel.app` identity and can coexist with legacy TO-DO Panel. After first updating to this identity, authorize the installed Pome Panel in System Settings → Privacy & Security → Accessibility; the old app's permission does not transfer automatically. The data directory remains Pome Panel. After source changes reach `dev`, rebuild that branch and replace the installed app; pulling source alone does not update a running installation.

## Get started

The current source development version is **0.11.0**. No formal Release installers are published yet; run the source with the development commands below. Published installers will be available from Releases.

1. Check [Releases](https://github.com/Sunanang/Pome-Panel/releases) for installers: `arm64.dmg` for Mac or `windows-x64-setup.exe` for Windows.
2. Open the app and click the capsule at the screen edge. Drag it while collapsed to change its position.
3. Choose your features in Settings. AI connections, transcription and NAS sync are optional.

Home keeps all enabled widgets reachable by scrolling in narrow windows. Use the context menu to resize or enter **Edit layout**, without a permanent Home toolbar. Settings provides task shortcuts and **Data & backup** without a NAS; temperature units and interface motion are independent preferences.

Hiding the native window pauses weather and background effects, releases the mirror camera, pauses audio playback and masks credentials. Showing it again still requires an explicit click to start the mirror. An active recording continues while the panel is hidden.

Installer availability follows Releases. If no installer is available, run from source. See the [changelog](CHANGELOG.en.md) for work in progress.

> Data stays in your local `Pome Panel` folder unless you choose another location. NAS sync is optional. Some Windows native features are off by default; see the [user guide](docs/user-guide.en.md#windows).

## Run from source

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Use Node.js 18+. See [development docs](docs/development.en.md) for tests, the NAS companion and builds.

## Learn more

[User guide](docs/user-guide.en.md) · [Development](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS companion](fnos/)

The interface supports English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Russian and Brazilian Portuguese. New translations await native-speaker review; screenshots and traditional almanac content retain their original language.

---

Based on [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel). Thanks to the original author for making it open source.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
