<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>すぐ開けるデスクトップワークスペース。</strong></p>
  <p>タスク、メモ、リンク、録音、AI 通知を画面端にまとめて、いつでも取り出せます。</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">インストール</a> ·
    <a href="#はじめに">はじめに</a> ·
    <a href="docs/user-guide.en.md">ユーザーガイド</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">問題を報告</a>
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
    <strong>日本語</strong>
    ·
    <a href="README.ko.md">한국어</a>
    ·
    <a href="README.es.md">Español</a>
    ·
    <a href="README.fr.md">Français</a>
    ·
    <a href="README.de.md">Deutsch</a>
    ·
    <a href="README.ru.md">Русский</a>
    ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Pome Panel のプレビュー](docs/screenshots/workspace-overview.png)

<p align="center"><sub>カプセルをクリックして展開。折りたたみ時は四辺にドラッグしてドック。ホームの配置も自由です。</sub></p>

## 日常をひとつのパネルで

|  |  |
| --- | --- |
| **ホーム** | タイマー、メモ、暦、日の出・日の入りなどを並べて表示 |
| **タスクとメモ** | 1〜8 のタスク分類と期限通知、Markdown メモとライブラリ |
| **リンクと録音** | サイトを分類保存。録音と任意のリアルタイム文字起こし・命名 |
| **AI** | 各サービスの残枠を確認し、接続元の完了通知を受け取る |
| **クリップボードと認証情報** | 必要なら履歴を有効化し、鍵はシステムの安全な保存領域へ |
| **NAS 同期** | fnOS NAS と任意でペアリングし、端末間で同期 |

## はじめに

1. [Releases](https://github.com/Sunanang/Pome-Panel/releases) から入手：Mac は `arm64.dmg`、Windows は `windows-x64-setup.exe`。
2. アプリを開き、画面端のカプセルをクリック。折りたたみ時にドラッグして位置を変えられます。
3. 「設定」で必要な機能を選びます。AI、文字起こし、NAS は任意です。

配布物は Releases が正です。無い場合はソースから実行。[変更履歴](CHANGELOG.en.md)も参照してください。

> データはローカルの `Pome Panel` フォルダに保存（変更可）。NAS 同期は任意。Windows の一部ネイティブ機能は既定でオフです（[ガイド](docs/user-guide.en.md#windows)）。

## ソースから実行

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+。[開発ドキュメント](docs/development.en.md)にテスト、サイト、NAS、ビルドがあります。

## もっと見る

[ユーザーガイド](docs/user-guide.en.md) · [開発](docs/development.en.md) · [変更履歴](CHANGELOG.en.md) · [NAS](fnos/)

UI は English、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch、Русский、Português (Brasil) に対応。新規翻訳は校正中で、スクリーンショットや暦の伝統表現は元の言語のままです。

---

[TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel) を基にしています。原作者に感謝します。

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
