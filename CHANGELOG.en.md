# Changelog

[简体中文](CHANGELOG.md) · [English guide](README.en.md)

Important features, fixes and release changes. Unreleased changes are archived under a version when its tag is created. Historical version numbers and dates below are preserved from the original record.

## [Unreleased]

- Simplify UI throughout: benefit-focused settings names, a concise NAS summary with troubleshooting, one-step encrypted local-token saving and folded manual entry, short overwrite summaries with details, and repairable errors with redacted diagnostics. Add three-step first-run welcome, four-widget defaults and layout presets while preserving existing users. Add quick-note/recording library links, three initial activation hints, and an inline Windows native switch. Quota shows one value with hover/click details. Preserve liquid glass, frosted white primary buttons, navigation, and two-column display settings; clarify the Cursor Sand source of Grok Bot quota.

- Slim settings: merge completion and quota into one AI configuration card (inline tokens, no capability matrix or Send test UI); combine workspace/home display toggles; move language under Device & activation; open pending requests as an in-place home list. Primary column mirror → API → AI; secondary NAS → Display → Device.
- Settings follow-ups: close the pending dialog on collapse/leave-home and when the list clears; focus token inputs when jumping to a source; compact paths with the user home prefix; label Manus as API-managed instead of “no setup”; disable other connect actions while a preview is open; refresh dynamic token copy on language changes.
- Replace home AI quota tabs with the B dashboard mosaic: simultaneous provider rings and window bars, urgency-based compact folding, settings order in larger sizes, and a lowest-remaining summary for five-source large cards. Critical now starts at ≤10%. Preserve balance/credit units, stale/error fallbacks, source and reset details; update Grok, Grok Bot and Manus branding.
- Quota mosaic follow-ups: normalize second/ms timestamps; retain critical → warn → error compact ordering and available local remaining on auth-error rings; show depleted balances/credits in red; show all four mini sources, fold five or more into three rings +N, and keep small at three; skip persistently absent providers in background polls; drop the dedicated Inter font.
- Preserve the trigger button during connection preview rendering so the confirmation stays anchored and Cancel/Escape restores focus.

### Multi-AI providers (usage + completion matrix)

- Manus follow-up fixes: overdue tasks no longer shorten rate-limit or offline backoff. Compact cold task content while retaining consumed-event checkpoints so old tasks cannot replay after confirmed identities expire.

- Fix Manus scan starvation, lost background/long-conversation completions, checkpoint loss on same-account key changes, and cross-account pending delivery. Persist pagination and terminal candidates transactionally, acknowledge queued notifications, redact task titles and synced fields, and remove delivered outbox bodies. Update listener status live and distinguish checking a connection from enabling collection.

- Add Manus completion (phase 1): a separate local “Receive completion alerts” switch (off by default) reuses the existing API key to poll the official read-only task API while the panel runs; completions/failures enter history and bubbles, open `manus.im` task pages, and sync over NAS. HTTP `/notify/manus` stays closed. Waiting for input/approval remains unsupported; capability stays partial pending live-account acceptance.

- Add partial completion integration for Copilot CLI and Antigravity, including configuration lifecycle/test, bubbles/history, platform source opening and NAS sync. Copilot deduplicates current results and filters child/recoverable errors. Antigravity requires full idle and an explicit outcome, with a default summary title. Grok Bot and Copilot VS Code/cloud remain unsupported.

- Fix Grok turn deduplication, subagent/teardown false notifications, NAS source validation, source branding and terminal opening. Honor `GROK_HOME` and preserve unrelated configuration when connecting, repairing or disconnecting. Cover two-device read sync, latest-100 retention, real forwarding and Windows fallback.

- Wire Grok completion through official `~/.grok/hooks` Stop / StopFailure into a owned `pome-panel.json`, local forwarder, and HTTP allowlist. Claude/Cursor hooks that Grok also loads no longer report as those sources. Marked partial; attention remains unsupported.

- Correct Copilot unlimited buckets and root reset dates; show Unlimited when every reported bucket is unlimited. Parse Grok Bot ISO and epoch timestamps for reset scheduling, and Antigravity summary wrappers, aliases and tagged remaining fractions. Add representative response fixtures and UI regression coverage.

- Fix host-scoped Copilot credentials, xAI team configuration and posted USD balance, grouped Antigravity quotas, invalid-auth cache recovery, Claude hook capability gates and token-card localization. Preserve encrypted provider settings across writes and restart. Use the official Manus v2 availableCredits endpoint and API key header; display authoritative spendable credits without fabricating a percentage.

- Added a shared `aiProviderCatalog` covering Cursor / Codex / Claude / Grok Bot / Grok / Copilot / Antigravity / Manus with separate usage and completion capability bits; unverified capabilities stay `partial`/`unsupported`.
- Home AI quota UI supports N providers with dynamic panels/tabs; Grok Bot is a separate card from Cursor’s main pools (requires Cursor sign-in); Grok is labeled as standalone xAI.
- Added Claude / Copilot / Grok / Antigravity / Manus usage adapters (local credentials or safeStorage tokens, host allowlists). Completion HTTP accepts Codex / Claude / Cursor / Grok, catalog-driven.
- Settings shows completion and usage capabilities on one provider list, with ownership notes, icons, and zh/en copy. Reference repos are credited for endpoint knowledge only—no embedded menu-bar apps.

### History retention

- Clipboard history consistently retains the latest 100 ordinary records. Favorites are exempt and retained indefinitely; removing a favorite restores the ordinary limit. Local copies, load, restore and NAS merges share trimming, propagate overflow deletes and preserve referenced images.
- AI completion history retains the latest 100 records, including unread records, and removes evicted deduplication data. Startup also trims existing history, replacing read-based 30-day expiry. Completion history and read marks now sync through the NAS using source/stable-event identities. Desktop and NAS share trimming and eviction tombstones; imports do not replay notifications. Native window/directory metadata stays local. Older NAS companions require an update.

### AI attention reminders

- Bubble `+N` now counts every remaining waiting and completion item after the current one; hidden waiting requests stay excluded. Settings and docs state that completion reminders work for all three sources, waiting actions currently cover Claude (partial), and Codex/Cursor waiting observers are off without inventing waiting states. Removed the unused Chinese `retentionLabel` API field; UI retention copy stays on i18n keys.
- Fixed distinct Claude approvals collapsing after redaction. Native or per-invocation observation IDs separate retries from new requests. Hidden requests no longer count in waiting +N; batch resolution uses one atomic write and handles post-rename errors. Fixed command previews now support English prefixes.
- Added separate pending input, choice and approval requests with the final blue B design: 400×146 on macOS and a 384×114 Windows card. Existing completion sizes remain intact. Waiting has no countdown; competing requests use 8-second slots with hover pause and preserved completion time.
- Resolutions match source, surface, session, turn and request. Closing or returning to an app never answers a request; pending entries remain available in Home and Settings. Restart/disconnect requires reconfirmation.
- Added validated v2 events, safe summaries before persistence, out-of-order tombstones, atomic storage and confirmed backup repair. Exact Codex empty suggestions/exclude envelopes are filtered; a common projection hides historical noise without deleting original records or deduplication identities.
- Claude setup previews include observation-only hooks and preserve other configuration and permission decisions. Capabilities remain partial pending live verification; permission notifications may be delayed about 6 seconds and lack request IDs. Codex desktop and Cursor IDE waiting observers are not enabled. Fixtures do not establish live-client support.

### Chinese and English

- Added shared Chinese/English resources across desktop, NAS pages, native dialogs, tray, notifications, AI modules, safety/recovery prompts and website. First launch follows the system language, with English fallback; manual language preferences stay local.
- NAS install/configuration/upgrade/uninstall and Windows setup/uninstall include only Chinese and English and follow the system. macOS permission purpose strings are localized before signing.
- Recording recognition has an independent Chinese/English setting, preserved during language changes and reconnections. Smart naming follows content language. Existing user content and event identities remain unchanged.
- Added English website pages, actual English product captures, user guide and historical release notes. Resource parity, placeholders, duplicate keys and generated output are checked in tests.

### AI quota and notification reliability

- Hovering pauses the notification countdown; leaving resumes its remaining time without adding 1.5 seconds. The progress bar no longer grows near expiry, with regression checks for remaining time and progress continuity.
- Removed stacked external shadows and the XOR mask border from the top bubble. A single thin border and separate drawing bounds avoid double outlines at rest and during animation.
- Cursor caches use full credential fingerprints and request generations. Account changes cancel old requests. Unknown quota is no longer full quota; optional Grok Bot failures do not block the main quota. Network failures retain the same account's last successful value and original timestamp; invalid authentication clears it.
- Added a quota provider registry. Codex rows use real periods and extra-model quotas; refresh follows visibility and known resets. Extra rows scroll inside the card.
- Cursor native errors become failed notifications; aborted events are not reported as success. `afterAgentResponse` and `stop` associate actual summaries, retaining stop-only compatibility and repair upgrades.
- Summaries skip generic first lines and retain up to 4096 characters. Codex reads native session titles by exact thread ID and stores them separately. Inbox records retain status, session name and full summary with legacy compatibility.
- Failed application launches keep the bubble open, show the reason, pause its timer and allow retry or close.

### Windows Home and sunrise/sunset

- Fresh Windows Home enables sunrise/sunset and fills the grid with available modules. Untouched old defaults are repaired; Mac defaults and custom layouts remain unchanged.
- The city popover avoids window/panel boundaries using actual content height. Long results scroll separately; manual location fields and validation remain accessible.
- Collapse, blur, page changes or hiding the module close the popover on both platforms. It does not reopen automatically or erase an active location draft when a card refreshes.

### Windows installation and shortcuts

- Setup explains custom installation folders and desktop/Start menu shortcuts. Manual reinstall repairs a missing desktop shortcut.
- Installation checks cover a custom directory containing spaces, shortcut target/working directory, reinstall repair and uninstall cleanup.

### NAS automated builds

- GitHub Actions builds a universal NAS FPK with a pinned, SHA-256-verified official fnpack. Temporary staging avoids modifying source protocol/icon copies.
- Mac, Windows and NAS builds must all succeed before a tagged release uploads installers and checksums. Desktop and both NAS manifests must have matching versions.

### Cross-platform testing and backups

- Work Hub and Bento pagination tests wait for asynchronously loaded page labels, including delayed IPC. Console-error, damaged-inbox rejection and rebuild checks remain.
- Windows backup/restore uses writable file handles for fsync, retaining verification and rollback. Native caches honor platform and force-disable settings.
- Windows PowerShell hooks inherit stdin directly, avoiding .NET pipe-reading/transcoding losses. Regression tests cover every source and Chinese paths.
- Checkouts use LF consistently. Hook-path and PowerShell fixtures isolate macOS process enumeration. Only Unix-socket gateway runtime tests are skipped on Windows; pairing and safety tests remain.
- NAS restore integration waits for workspace loading and navigation after refresh, avoiding scripts in destroyed pages; timeouts identify the stage.
- Bento fixtures use cross-platform modules and verify Current windows remains hidden with native support off, without assuming Mac defaults on Windows.
- Installed Windows smoke checks cover current Home/Settings modules, native controls, encryption, media release, reinstall retention and uninstall.
- Electron 44 startup-state queries quote Windows executable paths containing spaces and continue respecting Task Manager overrides.
- Pairing codes are regenerated if they accidentally appear in public metadata, preserving leakage protection, expiry and single-use consumption.

### One-click AI activity connections

- Settings adds Codex/Claude Code/Cursor connection, repair, disconnect and test. Confirm exact files and backups before atomic writes. TOML uses syntax-tree edits; JSON changes marked nodes only. Existing `notify` forwarding is restored on disconnect; corrupt/stale configurations are rejected.
- Notification sources are codex/claude/cursor; old GPT history appears as Other. Legacy hook events without explicit identity remain accepted. Claude tool-call rounds use the current message identity. Media migration uses confirmed versions and retries once after a full pull/rebase on expiry.
- Home adds connection empty states and initial detection guidance. Disabled modules show Add module; small/medium/large paginate at 3/5/10. Empty states hide Mark all read, badges align consistently, and corruption shows the filename/full hover path.
- Summon avoids duplicate detection and fixed content delays while preserving safety frames and performance thresholds; raw samples are retained.

### Home AI activity

- Damaged cold startup retains rebuild access and current guidance; errors hide Mark all read. Home-selected badges are hidden; other tabs keep digits clear of text, and a disabled module shows a dot. Disable/restart/re-enable preserves other modules. Medium shows five records; small restores Mark all read. Full title hover and contrast are improved.
- The inbox now lives in Home Bento with four sizes, inline details, local pagination and Mark all read. The Home badge highlights it or opens settings if disabled. Old floating top-bar UI and extra Links spacing are removed; backend APIs, deduplication and confirmed rebuild remain.
- Defaults put AI activity top-right and a medium Current windows module bottom-right. Untouched defaults upgrade automatically. Custom sizes/positions are retained; only AI activity shrinks if necessary. Completely full custom layouts retain previous choices and use badge guidance.

### Inbox and NAS retention

- Stable source event IDs or task/time/turn identities persist deduplication across delayed delivery and restart. New turns remain distinct. Insufficient identity returns 422; Claude preserves message UUID/time. Deduplication follows retention; unread remains.
- Explicit damaged-inbox rebuild displays original/full backup paths. Original bytes are saved and verified before atomic replacement; cancellation/failure never silently empties it.
- NAS defaults to 90-day log/idempotency retention and a 30-day rollback window, tracking device/collection acknowledgements. Truncated cursors fully resync; expired requests rebuild without reviving deletions. Cleanup, protected snapshots and watermarks share an atomic checkpoint.
- NAS v3 checkpoints read v1/v2; older companions reject v3. The last committed overwrite, valid staged operations and snapshots within the rollback window are protected rather than deleted by count.

### NAS companion (FPK)

- Checksummed incremental transactions and periodic checkpoints avoid serializing old audio for ordinary edits. v1 upgrades automatically. Back up both checkpoint and transaction directory; old companions must not read the new format. Safe compaction preserves snapshots and idempotency.
- Note conflicts use actual editing device/local time. Some rejected notes do not block other batches; only server-confirmed items are acknowledged.
- Sync data, pairing tokens, account keys, migration state and deduplication survive restarts with atomic persistence. Corruption refuses empty startup. Identical requests apply once across connections/retries/restarts.
- FPK **0.9.14** adds LAN binding (`0.0.0.0`), retaining loopback (`127.0.0.1`) by default. Install/upgrade/settings expose Listen scope. LAN sync uses the LAN address; external use needs port forwarding/DDNS, or loopback forwarding via FRP, reverse proxy or VPN. The default sync port is plain HTTP; direct internet exposure risks scanning/access. `device-bind` takes effect after restart.
- Fixed duplicated commands, links, notes and clipboard after local-authoritative migration: deletion records now retain the correct collection; pull filters collections; deleted old upserts no longer appear as empty content/groups.

### Desktop

- Inbox corruption/save failures show on Home and refuse false acceptance. External file changes preserve the original; repaired files can be reread. An empty-profile startup regression uses normal bootstrap.
- Fixed overlapping Home note previews, removed the 200-note storage cutoff and added on-demand lists. ZIP v1 backups verify media, preview restore impact, snapshot before restore and roll back failure. Restored NAS sync remains paused; expired previews require confirmation.
- NAS overwrite persists/read-verifies a snapshot, commits atomically against a version and resumes only after verification. Ordinary-data rollback leaves pairing/tokens/keys untouched. Conflicting notes preserve versions without recursive/duplicate copies.
- Per-content results distinguish missing/oversized audio. Credentials are masked when added/edited. Local/encrypted-sync/backup exclusion explanations are consistent.
- Local AI activity saves three sources before notifying. The initial 20-item view, pagination, read status, deduplication and 30-day read retention persist; unread is retained. Window returns revalidate targets and honor Windows native restrictions.
- Content fade delay drops from 110ms to 70ms. Audio chunk/hash failures preserve original media for retry. `check:work-hub` retains fixed-fixture performance/geometry baselines, environment, raw samples and P95.
- Copied credential passwords receive sensitive system markers and are excluded from local clipboard capture.
- Data-folder switching saves the previous workspace before loading the target. Late writes from the old page cannot overwrite it; copy/save failure keeps the original folder.
- Pull cursors advance only after every collection and projection saves successfully. Edits made during sync use the last confirmed baseline and survive old push echoes. Cycles run serially.
- Task/workspace pushes obey both 500-item and byte limits, acknowledge each batch and retain unconfirmed operations. Same-millisecond operations preserve write order.
- Link, icon and smart-organizing requests pin validated public DNS addresses, bound response/time limits and reject private-network redirects.
- Home drag swaps positions only, preserving sizes, clamping to the grid and repacking conflicts. Hole filling fixes the swapped pair; previews use original size. Insufficient space restores the old layout with feedback.
- Cursor/Codex share quota rows: periods/reset labels below full-width bars, provider/plan in titles and one refresh footer. Mini uses 12px text/4px bars and equal row heights. Reset labels handle today, tomorrow, month/year boundaries.
- Manual Codex access tokens query real quota in the main process at chatgpt.com with a 10-second timeout. Failure falls back locally; network errors preserve the previous sample. 401/403 requests reacquisition; saving clears invalid state. Tokens are encrypted locally, never synced/logged/refreshed, and local acquisition extracts access tokens only.
- Home/Settings show remaining quota, warning at ≤20%/≤5%, retaining unknown `--%` and raw used data. Provider titles are larger across sizes.
- Settings merges Cursor/Codex into AI quota. Codex Get local token reads login files only on request; Save encrypts/applies it. Mac/Windows directories and local session fallback are supported; failed reads preserve input.
- Home combines providers, remembers mini/small selection, uses side-by-side medium/stacked large, and retains module ID/background/layout. Codex scans recent sessions in reverse chunks, supporting legacy reset fields and expired data; connection/error guidance stays inline.
- Cursor Get local token works on Mac/Windows without sqlite3/Python. Save/clear sync encrypted AI configuration; failed reads preserve drafts and older NAS settings without a token retain local values.
- Sync deduplicates commands by text, notes by title/body, link groups by name/URLs, clipboard by text and credentials by service/account/password. Devices keep the same earliest item (most recent clipboard item), remove extras from NAS and reject duplicate commands. Prefix-based handling repairs old misclassified tombstones. Re-pair migration resets cursors after NAS restarts.
- Pairing prompts before trusting an untrusted HTTPS certificate, scoped to its exact host/port/certificate. Changes require confirmation; validation stays enabled globally. Timeout guidance explains HTTP mappings, matching device/FRP ports and trying LAN IPs.
- Version becomes **0.11.0**, introducing Windows native capabilities through koffi 3.x. Windows ships only x64 native binaries; Mac excludes them. Current windows lists front-to-back, excluding tools/other desktops, uses system icons, supports clipboard paste and notification project focus.
- Native capabilities remain **off by default** until Windows Defender, Huorong and 360 checks pass. Settings enables them; failed loading reports unavailable. `POME_DISABLE_WIN_NATIVE=1` prevents loading.
- UWP windows show actual app names/icons rather than ApplicationFrameHost; suspended windows fall back to their titles.
- Windows releases held Ctrl before paste. Reserved Alt+Tab/Alt+Esc combinations report system occupation separately from other-app conflicts.
- Automatic paste sends one Ctrl+V after a user click, without global keyboard hooks. Elevated targets warn to paste manually; closed/changed targets fall back to Copied.
- Windows 9px/10.5px text becomes 10px/11px for clarity at 100–125% scaling; Mac sizes stay unchanged.
- Changes prepared as **0.10.1** were folded into 0.11.0: centralized font tokens, Windows Segoe UI Variable/Segoe UI/Microsoft YaHei and Cascadia Mono/Consolas; looser Pomodoro digits; unchanged Mac fonts.
- All Windows scroll areas use 3px tracks; Mac retains system overlay scrollbars.
- Shortcut symbols follow the platform; Windows accepts Win combinations and distinguishes OS-reserved from app-occupied shortcuts.
- Windows tray/setup use multi-size 16–256 ICOs for 125–200% scaling, generated with `make-ico`.
- Blocked camera/microphone feedback links directly to the corresponding Windows privacy page or Mac System Settings.
- Fresh Windows installs enable launch at login; upgrades retain the prior choice. The UI reads actual OS state, including Task Manager disabling. Uninstall removes startup registration; upgrades retain it.
- README adds Windows hook paths/examples, SmartScreen guidance and limitations: unsigned packages, virtual desktops, no Soda Music, untested ARM64 and the 9px capsule/browser strip overlap.
- Version becomes **0.10.0**: Windows adopts Mac's four-edge docking, saved expansion alignment, reset-to-top, `1240 × 638` size and 24px work-area margins. An ignored old position resets once. `POME_LEGACY_WIN_LAYOUT=1`/`legacyWinLayout` temporarily restores the previous layout for one version.
- Platform differences move into shared capabilities (`platform.js`) and native adapters. Mac window enumeration, paste, music, icons and permission checks move into `darwin.js`. Renderers read capability flags; disabled Windows modules remain hidden.
- **0.9.14** work folded into 0.10.0: Mac defaults below the menu bar (`workArea.y`), normal height 638; transcription dialog loses excess top space. Windows collapses to `85 × 9` without a click-blocking border; its temporary pre-unification drag restriction ignored old off-top positions. Geometry moves to pure functions.
- Version becomes **0.9.13**. About shows Pome Panel, Lando and the current version; GitHub opens this repository.
- Tray/menu bar keeps five items: show features, shortcut, launch at login, About and Quit. Show features opens the panel.
- Sync options open once after pairing, can be reopened with Sync, and do not repeatedly appear on startup or later synchronization.
- NAS settings become address → pairing → one status row. Unpaired state hides channels/time/retry; connection requires actual pairing and Retry only retries synchronization.
- Device tokens use encrypted `userData/sync-credentials.json`; addresses/last success use plaintext `sync-settings.json`. Replacing an ad-hoc-signed Mac app may leave tokens unreadable. The saved address then shows an error and requests pairing again; unreadable ciphertext is preserved. A decryptable legacy Application Support token can migrate without overwriting unreadable current data.
- Paired devices are listed only in the NAS web page. Any supported collection counts during migration; credentials/AI keys use account-key AES-GCM with ciphertext only on NAS.
- Unfilled addresses no longer report a successful connection. Endpoint/retry/backup feedback stays in its own area; pairing feedback is reserved for pairing, reauthentication and migration. Raw sync error codes are humanized.
- HTTPS sent to a plain HTTP/FRP endpoint reports the protocol mismatch rather than requesting certificate trust. Genuine untrusted HTTPS still follows certificate confirmation.
- Fixed packaged Mac startup missing `workspace-sync.js` from the file list.
- Home commands sync using `notch-home-commands`, collection `commands` and entities `command:<id>`.
- Immediate disconnects/empty responses explain that the host is reachable but the sync service is unresponsive, asking to check the app, current device port and FRP/LAN mapping; plain mappings use HTTP.

### Earlier NAS companion changes

- NAS pages adopt desktop-style tabs, task quadrants, notes, clipboard, links, recordings and credentials. Devices replaces desktop Home and contains pairing/devices. Credentials/AI show configured or masked values. No outer gradient border, footer counts, empty-state prose or memory hints; lists fill height and scroll.
- Commands follows Notes, showing synced commands or an empty view.
- **0.9.13** uses official pomegranate icons instead of black placeholders; root ICON.PNG matches the desktop icon and ICON_256.PNG is its 256px version.
- **0.9.12** aligns clipboard filters, fixed cards, type borders, four-line truncation, relative time, favorites and clear UI with Mac. Web deletion/clear do not mutate NAS data.
- **0.9.11** restores ID `pome-panel` and `/app/pome-panel`; dotted IDs were mistaken for static files. Desktop icon paths are complete. Uninstall defaults to retaining data, with explicit deletion also cleaning legacy `com.pomepanel.sync` data. `TRIM_APPDEST` uses `$TRIM_APPDEST/server/index.js`; protocol stays under `target/packages/sync-protocol`; PID/logs stay in `TRIM_PKGVAR/runtime`. Publisher remains Lando, entry `pome-panel.main`, runtime `nodejs_v22`.
- Without a device port, the Unix gateway still starts so App Settings opens; device TCP remains off, never random or hardcoded 5001. A saved 1–65535 port binds after restart. Missing Node writes the reason to `TRIM_TEMP_LOGFILE` and exits.
- Install/configuration/upgrade validate 1–65535 and save `wizard_port`/uppercase aliases in `TRIM_PKGETC/device-port` and the data directory.
- **0.9.8** fixes the `/app/pome-panel` upgrade prefix blank page and missing server/protocol paths. Earlier 1.1.x→0.9.x transitions may be rejected as downgrades by the host.
- Setup requests a fixed sync port; occupied ports fail startup. Without a port, the gateway works and Devices requests configuration. Loopback is default; external clients use the forwarded public address/port.
- Signed in reflects the current NAS session, not a separate application account. The NAS username enables pairing; missing sessions disable it without another login button.
- FPK **1.1.3** fixes pairing-code generation/refresh under the gateway prefix and aligns desktop controls/visual tokens.

## [1.1.2] - 2026-09-12

- Fixed new task dates remaining on yesterday or a previously selected default after midnight. Wake, expand, Tasks entry, input and submit reset the automatic date to today at 23:30; a manually chosen date remains.

## [1.1.1] - 2026-09-11

- Live transcription reconnects after disconnects, errors or session completion, with heartbeat checks and up to 30 seconds of queued audio; previous text is retained.
- Existing text no longer hides connection errors; ending during reconnect cleans up and saves trailing text.
- Website downloads stack in equal-width Mac/Windows buttons, retaining style and dynamic asset URLs.

## [1.1.0] - 2026-09-07

- Added Windows 10/11 x64 setup sharing Mac code/version, with tray, launch at login, top-work-area positioning and system encryption.
- Windows hides unsupported Current windows/music without losing preferences; clipboard copies for manual Ctrl+V.
- Windows runners verify installation, real startup, core IPC, simulated media release, retained data and uninstall. Both desktop platforms must pass before release.
- Website resolves separate Windows/Mac assets from the latest Release.
- Workspace restore no longer blocks its own reload through navigation protection; recording initialization and stale note editor overwrites are fixed. External navigation/local-file opening stays restricted.

## [1.0.7] - 2026-09-04

- Mac media permission prompts are no longer covered by the always-on-top panel. Requests temporarily lower/activate it, then safely restore stacking.
- Overlapping camera/microphone requests do not restore topmost status before all prompts finish.
- Repeated recording clicks during permission wait share one pending start and one clear status instead of duplicate requests/errors.

## [1.0.6] - 2026-09-04

- Settings adds a default expanded page using currently visible tabs.
- New tasks reset to today at 23:30 after submission instead of retaining the previous task's manual deadline.

## [1.0.5] - 2026-08-31

- Long task deadlines no longer overflow Node timers into 1ms loops; long delays are checked in segments.
- Home size changes use cancellable card FLIP transitions, retaining visible content without black blocks or queued animations.
- Cold expansion avoids scaling the whole content layer and replaying all seven staggered card entrances together.

## [1.0.4] - 2026-08-30

- Clicking selected credentials again deselects them and immediately hides batch deletion.
- Batch Delete stays to the right of the search field instead of wrapping below it.

## [1.0.3] - 2026-08-30

- Enabling clipboard history does not capture old clipboard contents; alternating text/images no longer duplicates the same image. Fresh profiles have no sample records.
- Image deduplication uses content hashes rather than dimensions/file length.
- Electron 44 ClipboardItem PNG bytes are reused; image polling runs every three seconds to avoid repeatedly encoding 4K images.
- Mirror/workspace file dialogs attach to the panel and do not trigger blur-collapse or hide behind other apps.
- Expansion/collapse/idle GPU work is reduced: no large content-layer clipping and WebGL runs only on hover.
- Transparent split-tab containers no longer block top-center click-to-collapse; tabs and Space retain behavior.
- Renderer sandbox is explicit; local navigation and child windows are rejected.
- Upgraded Electron 44/electron-builder 26.15.7, minimum Mac 13, and cleared known full dependency audit findings.
- Tightened Mac entitlements; startup does not invoke screen capture before consent.
- Empty notification queues destroy their independent window rather than retaining a hidden renderer.
- Website adds a loading/wake sequence inside the Mac display, waiting for screenshots/first video with an eight-second static fallback. Tab demos use faststart silent H.264 instead of GIF, with WebP posters; product captures are WebP, including the updated clipboard. Breathing, copy size, corners and wallpaper transitions are refined.

## [1.0.2] - 2026-08-29

- Added in-panel settings for APIs, mirror, visible features, shortcut, data folder and launch at login; added single credential deletion.
- Task deadlines correctly cross months/years and sort chronologically.

## [1.0.1] - 2026-08-28

- Recordings page restores complete start, pause and finish controls.

## [1.0.0] - 2026-08-26

- First stable release, establishing fixed-name Apple Silicon DMG publishing.

[Unreleased]: https://github.com/Sunanang/Pome-Panel/commits/main
[1.1.0]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.7...v1.1.0
[1.0.7]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Sunanang/Pome-Panel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Sunanang/Pome-Panel/releases/tag/v1.0.0
