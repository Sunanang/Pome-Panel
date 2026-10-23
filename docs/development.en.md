# Development and validation

[Back to overview](../README.en.md) · [User guide](user-guide.en.md)

## Run from source

Desktop requires Node.js 18+:

```bash
git clone https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
git switch dev
npm install
npm run setup:hooks
npm test
npm start
```

There is no renderer build step. `npm start` runs the complete Electron desktop app. `dev` is the long-lived development branch; `main` only receives `dev → main` pull requests for releases. Local hooks refuse commits on main and all direct pushes to remote main, including force pushes/deletion. Do not bypass them. After release, sync main back into dev. Hooks do not replace remote branch protection.

| Command | Purpose |
| --- | --- |
| `npm test` | Localization checks, Node tests, Electron integration tests and JavaScript syntax checks |
| `npm run i18n:generate` | Validate shared dictionaries and regenerate browser, native and website resources |
| `npm run i18n:check` | Verify generated resources are current, without writing |
| `npm start` | Start desktop development app |
| `npm run pack` | Create an unpacked app directory |
| `npm run build` | Build Apple Silicon macOS artifacts |
| `npm run build:win` | Build Windows x64 artifacts |
| `npm run build:zip` | Build ZIP artifacts |
| `node scripts/build-fpk.js` | Build a universal NAS FPK and SHA-256 in a temporary staging directory with official fnpack |

Packaging and publishing require explicit approval. GitHub Actions tests/builds Mac DMG, Windows EXE and NAS FPK; only a matching `v*.*.*` tag with all three jobs successful publishes one Release with checksums. Desktop and both NAS manifests must match. fnpack is version-pinned and checksum-verified; it does not require NAS credentials. Actual installation checks remain separate. `scripts/pack-fpk.sh` refreshes protocol/icon copies only.

Website (`website/`) requires Node.js 22.13.0+, React 19 and Vinext:

```bash
cd website
npm install
npm run dev
# Verification
npm test
npm run lint
npm run build:pages
```

The shared `localization/` dictionaries feed desktop, NAS pages, installer resources and the website. Native package localization does not translate arbitrary HTML. User content and protocol identifiers are not translation keys.

`npm run check:work-hub` measures an isolated fixture of 250 notes, 200 tasks, 100 links, 20 recordings and 50 completion records, with 20 normal and 20 simulated NAS-load summons. Environment, raw samples, P95, geometry and sync results go to `dist.noindex/iteration-validation/<run-id>/`; generated reports are not committed. Windows hardware, actual monitors/DPI and native installers need separate validation.

Main entry points: `main.js` and `main-services.js`; safe IPC in `preload.js`; desktop UI in `renderer/`; shared sync protocol in `packages/sync-protocol/`; NAS companion in `fnos/`; tests in `tests/`; packaging assets in `build/`; design/ADR documents in `docs/`; website in `website/`.
