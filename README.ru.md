<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>Рабочее пространство в один клик.</strong></p>
  <p>Задачи, заметки, ссылки, записи и уведомления ИИ — у края экрана, всегда под рукой.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">Скачать</a> ·
    <a href="#начать">Начать</a> ·
    <a href="docs/user-guide.en.md">Руководство</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">Сообщить о проблеме</a>
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
    <a href="README.de.md">Deutsch</a>
    ·
    <strong>Русский</strong>
    ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Превью Pome Panel](docs/screenshots/workspace-overview.png)

<p align="center"><sub>Нажмите капсулу, чтобы раскрыть. В свёрнутом виде перетащите к краю экрана. Настройте виджеты на главной.</sub></p>

## Одна панель для повседневных дел

|  |  |
| --- | --- |
| **Главная** | Виджеты: таймер, быстрые заметки, календарь, рассвет и закат |
| **Задачи и заметки** | 1–8 категорий с напоминаниями; Markdown и библиотека заметок |
| **Ссылки и записи** | Сайты по группам; аудио с опциональной транскрипцией |
| **ИИ** | Остатки квот и уведомления о завершении от подключённых источников |
| **Буфер и секреты** | История по необходимости; ключи в системном защищённом хранилище |
| **Синхронизация NAS** | Опционально свяжите fnOS NAS и синхронизируйте устройства |

<details>
<summary><strong>Задачи и заметки</strong></summary>
<br />
<table>
  <tr>
    <td width="50%"><img src="website/public/product-captures/en/todo.jpg" alt="" /><p align="center">Планируйте задачи</p></td>
    <td width="50%"><img src="website/public/product-captures/en/notes.jpg" alt="" /><p align="center">Пишите заметки</p></td>
  </tr>
</table>
</details>

## Начать

1. Смотрите [Releases](https://github.com/Sunanang/Pome-Panel/releases): `arm64.dmg` для Mac или `windows-x64-setup.exe` для Windows.
2. Откройте приложение и нажмите капсулу у края. В свёрнутом виде перетащите, чтобы сменить сторону.
3. В настройках выберите нужные функции. ИИ, транскрипция и NAS необязательны.

Установщики берутся из Releases. Если пакета нет — запускайте из исходников. См. [changelog](CHANGELOG.en.md).

> Данные хранятся в локальной папке `Pome Panel` (можно сменить). Синхронизация NAS опциональна. Часть нативных возможностей Windows по умолчанию выключена; см. [руководство](docs/user-guide.en.md#windows).

## Запуск из исходников

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+. Тесты, сайт, NAS и сборки — в [документации для разработчиков](docs/development.en.md).

## Подробнее

[Руководство](docs/user-guide.en.md) · [Разработка](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS](fnos/)

Интерфейс поддерживает English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский и Português (Brasil). Новые переводы ещё проверяются; скриншоты и традиционные тексты календаря остаются на исходном языке.

---

Основано на [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel). Спасибо автору оригинала.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
