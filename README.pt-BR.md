<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>Seu espaço de trabalho, a um clique.</strong></p>
  <p>Tarefas, notas, links, gravações e alertas de IA, prontos na borda da tela.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">Baixar</a> ·
    <a href="#começar">Começar</a> ·
    <a href="docs/user-guide.en.md">Guia</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">Reportar um problema</a>
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
    <a href="README.ru.md">Русский</a>
    ·
    <strong>Português (Brasil)</strong>
  </p>
</div>

![Prévia do Pome Panel](docs/screenshots/workspace-overview.png)

<p align="center"><sub>Clique na cápsula para expandir. Arraste-a recolhida até qualquer borda. Organize a Home do seu jeito.</sub></p>

## Um painel para o dia a dia

|  |  |
| --- | --- |
| **Home** | Widgets de timer, notas rápidas, almanaque, nascer e pôr do sol |
| **Tarefas e notas** | 1–8 categorias com lembretes; Markdown e biblioteca de notas |
| **Links e gravações** | Sites por grupo; áudio com transcrição opcional |
| **IA** | Cotas restantes e alertas de conclusão das fontes conectadas |
| **Área de transferência e credenciais** | Histórico sob demanda; chaves no armazenamento seguro do sistema |
| **Sincronização NAS** | Emparelhe opcionalmente um NAS fnOS para sincronizar entre dispositivos |

<details>
<summary><strong>Ver tarefas e notas</strong></summary>
<br />
<table>
  <tr>
    <td width="50%"><img src="website/public/product-captures/en/todo.jpg" alt="" /><p align="center">Planeje tarefas</p></td>
    <td width="50%"><img src="website/public/product-captures/en/notes.jpg" alt="" /><p align="center">Registre notas</p></td>
  </tr>
</table>
</details>

## Começar

1. Veja [Releases](https://github.com/Sunanang/Pome-Panel/releases): `arm64.dmg` no Mac ou `windows-x64-setup.exe` no Windows.
2. Abra o app e clique na cápsula. Arraste-a recolhida para mudar a borda.
3. Escolha os recursos em Ajustes. IA, transcrição e NAS são opcionais.

Os instaladores seguem o Releases. Se não houver pacote, execute a partir do código. Veja o [changelog](CHANGELOG.en.md).

> Os dados ficam na pasta local `Pome Panel` (pode trocar). A sincronização NAS é opcional. Alguns recursos nativos do Windows vêm desligados; veja o [guia](docs/user-guide.en.md#windows).

## Executar a partir do código

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+. Testes, site, NAS e builds em [desenvolvimento](docs/development.en.md).

## Saiba mais

[Guia](docs/user-guide.en.md) · [Desenvolvimento](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS](fnos/)

A interface oferece English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский e Português (Brasil). Novas traduções ainda estão em revisão; capturas e textos tradicionais do almanaque mantêm o idioma original.

---

Baseado em [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel). Obrigado ao autor original.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
