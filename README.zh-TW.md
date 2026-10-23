<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>隨手展開的桌面工作臺。</strong></p>
  <p>待辦、筆記、連結、錄音與 AI 提醒，放在螢幕邊緣，隨時取用。</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">取得安裝包</a> ·
    <a href="#開始使用">快速開始</a> ·
    <a href="docs/user-guide.md">使用指南</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">回報問題</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?logo=apple" alt="macOS 13+ Apple Silicon" />
    <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4" alt="Windows 10/11 x64" />
    <img src="https://img.shields.io/badge/License-MIT-35c58b" alt="MIT" />
  </p>
  <p>
    <a href="README.md">简体中文</a>
    ·
    <strong>繁體中文</strong>
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
    <a href="README.de.md">Deutsch</a>
    ·
    <a href="README.ru.md">Русский</a>
    ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Pome Panel 工作臺預覽](docs/screenshots/workspace-overview.png)

<p align="center"><sub>點擊膠囊展開，收起後拖到螢幕四邊；首頁元件可以自由調整。</sub></p>

## 一個面板，處理日常小事

|  |  |
| --- | --- |
| **首頁工作臺** | 自訂元件與版面，集中查看專注計時、速記、黃曆、日出日落等資訊 |
| **待辦與筆記** | 1–8 個待辦分類、到期提醒，搭配 Markdown 速記與筆記庫 |
| **連結與錄音** | 分類收藏網址，錄製音訊，可選即時轉寫與智慧命名 |
| **AI 助手** | 查看多家 AI 剩餘額度，接收已接來源的任務完成提醒 |
| **剪貼簿與金鑰** | 按需開啟剪貼簿歷史，用系統安全儲存加密帳號與金鑰 |
| **NAS 多端同步** | 可選配對飛牛 NAS，在多台裝置之間同步工作區內容 |

<details>
<summary><strong>看看待辦和筆記介面</strong></summary>
<br />
<table>
  <tr>
    <td width="50%"><img src="website/public/product-captures/todo.webp" alt="" /><p align="center">分類安排待辦</p></td>
    <td width="50%"><img src="website/public/product-captures/notes.webp" alt="" /><p align="center">記錄和整理筆記</p></td>
  </tr>
</table>
</details>

## 開始使用

1. 在 [Releases](https://github.com/Sunanang/Pome-Panel/releases) 查看安裝包：Mac 選擇 `arm64.dmg`，Windows 選擇 `windows-x64-setup.exe`。
2. 開啟應用，點擊螢幕邊緣的膠囊展開；收起後可以拖動，調整停靠位置。
3. 在「設定」裡選擇需要的功能。AI 接入、錄音轉寫和 NAS 同步均按需設定。

安裝包以 Releases 實際發布為準；尚無安裝包時可從原始碼執行。開發中的功能與修復見[更新日誌](CHANGELOG.md)。

> 資料預設保存在本機 `Pome Panel` 資料夾，可自行更換；NAS 同步是可選功能。Windows 的部分原生能力預設關閉，詳見[使用指南](docs/user-guide.md#windows-上的几件事)。

## 從原始碼執行

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

使用 Node.js 18+。測試、官網開發、NAS 伴侶與建置說明見[開發文件](docs/development.md)。

## 更多說明

[使用指南](docs/user-guide.md) · [開發文件](docs/development.md) · [更新日誌](CHANGELOG.md) · [NAS 伴侶](fnos/)

介面支援簡體中文、繁體中文、English、日本語、한국어、Español、Français、Deutsch、Русский、Português (Brasil)。新增翻譯仍在校對，截圖與黃曆傳統內容保留原語言。

---

基於 [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel) 二次開發，感謝原作者的開源貢獻。

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
