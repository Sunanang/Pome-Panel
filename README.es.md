<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>Tu espacio de trabajo, a un clic.</strong></p>
  <p>Tareas, notas, enlaces, grabaciones y avisos de IA, listos en el borde de la pantalla.</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">Descargar</a> ·
    <a href="#empezar">Empezar</a> ·
    <a href="docs/user-guide.en.md">Guía</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">Informar un problema</a>
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
    <strong>Español</strong>
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

![Vista previa de Pome Panel](docs/screenshots/workspace-overview.png)

<p align="center"><sub>Haz clic en la cápsula para expandir. Arrástrala plegada hacia cualquier borde. Organiza el inicio a tu gusto.</sub></p>

## Un panel para el día a día

|  |  |
| --- | --- |
| **Inicio** | Widgets para temporizador, notas rápidas, almanaque, amanecer y atardecer |
| **Tareas y notas** | 1–8 categorías con recordatorios; Markdown y biblioteca de notas |
| **Enlaces y grabaciones** | Guarda sitios por grupo; graba audio con transcripción opcional |
| **IA** | Consulta cuotas restantes y recibe avisos de finalización de fuentes conectadas |
| **Portapapeles y credenciales** | Historial bajo demanda; cuentas y claves en el almacenamiento seguro del sistema |
| **Sincronización NAS** | Empareja opcionalmente un NAS fnOS para sincronizar entre dispositivos |

<details>
<summary><strong>Ver tareas y notas</strong></summary>
<br />
<table>
  <tr>
    <td width="50%"><img src="website/public/product-captures/en/todo.jpg" alt="" /><p align="center">Planifica tareas</p></td>
    <td width="50%"><img src="website/public/product-captures/en/notes.jpg" alt="" /><p align="center">Guarda notas</p></td>
  </tr>
</table>
</details>

## Empezar

1. Consulta [Releases](https://github.com/Sunanang/Pome-Panel/releases): `arm64.dmg` en Mac o `windows-x64-setup.exe` en Windows.
2. Abre la app y haz clic en la cápsula. Arrástrala plegada para cambiar de borde.
3. Elige funciones en Ajustes. IA, transcripción y NAS son opcionales.

Los instaladores siguen Releases. Si no hay paquete, ejecuta desde el código. Ver el [changelog](CHANGELOG.en.md).

> Los datos viven en la carpeta local `Pome Panel` (se puede cambiar). La sincronización NAS es opcional. Algunas funciones nativas de Windows van desactivadas por defecto; ver la [guía](docs/user-guide.en.md#windows).

## Ejecutar desde el código

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

Node.js 18+. Tests, web, NAS y builds en [desarrollo](docs/development.en.md).

## Más información

[Guía](docs/user-guide.en.md) · [Desarrollo](docs/development.en.md) · [Changelog](CHANGELOG.en.md) · [NAS](fnos/)

La interfaz admite English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский y Português (Brasil). Las traducciones nuevas siguen en revisión; capturas y textos tradicionales del almanaque conservan el idioma original.

---

Basado en [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel). Gracias al autor original.

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)
