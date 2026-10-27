# Website Instructions

## Pome direction, 2026-10-26

User rejected the first three concepts as posters. They prefer TO-DO-Panel's complete website experience: dimensional opening scene, dark materials, scroll narrative, product transitions. The captured reference is the selected experience target; follow the user's stronger instruction to create different composition, identity and narrative. Do not reproduce its metallic all-caps masthead, laptop-on-stone scene or collage wall. Build an interactive website, preserve real product screenshots, support reduced motion, and keep the website self-contained under `website/`.

User accepted the overall style and requested softer controls: use rounded capsules and subtle glass surfaces consistently across every action. Top navigation must show the current section during clicks, manual scrolling, reverse scrolling and direct section links. Preserve all section links on narrow screens. Use a consistent icon library and smooth, reduced-motion-aware state changes for expand/collapse, previous/next, FAQ and dialog close controls.

Website languages must match the current desktop `localization/languages.json` exactly. Default to browser language, remember explicit language choices, and support returning to browser-follow mode. Translate all page copy, accessibility labels and metadata; product screenshots must follow the same locale. Traditional almanac content retains its original language, as documented in the desktop README. Preserve existing interaction state when changing language, and verify long translations on narrow viewports.

Copy tone: small, light capsule tucked at the desktop edge, a gentle tap unfolds the space, appearing just when needed and quietly withdrawing during focus. User-provided simplified Chinese wording is authoritative; adapt this tone naturally across the other nine locales. Fit the longer headlines without overlapping the product imagery or controls.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Repository delivery, 2026-10-26

The user explicitly authorized integrating this website into `Pome-Panel/website` and committing all current repository changes to `dev`. This supersedes the earlier standalone-preview scope. Keep website dependencies and build output separate from the desktop app. Do not deploy, publish, tag or push to `main` without separate authorization.

## Image delivery, 2026-10-27

Publish website raster assets as lossless WebP. Preserve original dimensions, alpha, invisible RGB values and embedded ICC profiles; do not resize or use lossy encoding for size savings. Decode each converted file and compare its RGBA pixels and ICC profile with the source before replacing it. Update all references and the locale screenshot check together.
