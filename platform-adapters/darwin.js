'use strict';
const pomeLocalePlatformAdaptersDarwin = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;


// macOS 适配层（P0-2）：main.js 里所有 JXA / osascript 逻辑原样迁入，行为不变。
// 模块级状态（窗口扫描缓存、图标缓存与队列、上一个粘贴目标、汽水音乐播放态）随代码迁入实例。
// Electron 依赖全部由 main.js 注入，模块本身不在加载时触碰 Electron，方便单测。

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { createTaskApps } = require('./task-apps');
const {
  normalizeWindowRows,
  sodaShortcutSpec,
  controlSodaMusic,
  taskAppMatches,
} = require('../main-services');

const SODA_MUSIC_APP = '/Applications/汽水音乐.app';
const PERMISSION_PROMPT_SKIP_FILE = 'permission-prompt-skipped';
const SELF_BUNDLE_IDS = ['com.github.Electron', 'com.pomepanel.app'];

// 只放行固定的几个隐私面板，渲染层传来的值只能当作枚举的键来查，
// 绝不能拼进 URL：x-apple.systempreferences: 能打开任意设置面板。
const PRIVACY_SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};

const { WINDOWS_LIST_JXA, WINDOW_FOCUS_JXA } = require('./darwin-windows');

const SYSTEM_ICON_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const size = 96;
  const source = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
  image.lockFocus;
  source.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSZeroRect,
    $.NSCompositingOperationSourceOver,
    1
  );
  image.unlockFocus;
  const rep = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
  const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  return ObjC.unwrap(data.base64EncodedStringWithOptions(0));
}`;

const FRONTMOST_APP_JXA = `
ObjC.import('AppKit');
function run() {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (!app) return '{}';
  return JSON.stringify({
    name: ObjC.unwrap(app.localizedName) || '',
    bundleId: ObjC.unwrap(app.bundleIdentifier) || '',
    path: app.bundleURL ? (ObjC.unwrap(app.bundleURL.path) || '') : ''
  });
}`;

const RUNNING_APPS_JXA = `
ObjC.import('AppKit');
function run() {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  const frontmost = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const rows = [];
  for (let i = 0; i < Number(apps.count); i++) {
    const app = apps.objectAtIndex(i);
    if (Number(app.activationPolicy) !== 0) continue;
    rows.push({ pid: Number(app.processIdentifier), appName: String(ObjC.unwrap(app.localizedName) || ''),
      bundleId: String(ObjC.unwrap(app.bundleIdentifier) || ''),
      appPath: app.bundleURL ? String(ObjC.unwrap(app.bundleURL.path) || '') : '',
      frontmost: frontmost && Number(frontmost.processIdentifier) === Number(app.processIdentifier) });
  }
  return JSON.stringify(rows.sort((a, b) => Number(b.frontmost) - Number(a.frontmost)));
}`;

const PASTE_TO_APP_JXA = `
ObjC.import('AppKit');
function run(argv) {
  const bundleId = String(argv[0] || '');
  if (!bundleId) return 'missing';
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleId);
  if (!apps || apps.count === 0) return 'missing';
  apps.objectAtIndex(0).activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
  delay(0.18);
  Application('System Events').keystroke('v', { using: 'command down' });
  return 'ok';
}`;

const SODA_SHORTCUT_JXA = `
function run(argv) {
  const keyCode = Number(argv[0]);
  const usesCommand = String(argv[1] || '') === '1';
  const dismissOverlays = String(argv[2] || '') === '1';
  const processes = Application('System Events').applicationProcesses.whose({ bundleIdentifier: 'com.soda.music' })();
  if (!processes.length) return 'missing';
  processes[0].frontmost = true;
  delay(0.35);
  const systemEvents = Application('System Events');
  if (!Number.isFinite(keyCode)) return 'invalid';
  if (dismissOverlays) {
    systemEvents.keyCode(53);
    delay(0.15);
  }
  if (usesCommand) systemEvents.keyCode(keyCode, { using: 'command down' });
  else systemEvents.keyCode(keyCode);
  return 'ok';
}`;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// icns 内 PNG 块按"贴近 48px 网格展示"优先：128 → 256 → 64@2x …
const ICNS_PREF = ['ic07', 'ic12', 'ic08', 'ic11', 'ic13', 'ic09', 'ic14', 'ic05', 'ic04'];
const SYSTEM_ICON_CONCURRENCY = 2;
const SYSTEM_ICON_QUEUE_TIMEOUT_MS = 10000;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function extractPngFromIcns(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'icns') return null;
  const candidates = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const type = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32BE(off + 4);
    if (len < 8 || off + len > buf.length) break;
    const data = buf.subarray(off + 8, off + len);
    if (data.length > 8 && data.subarray(0, 4).equals(PNG_SIG)) {
      candidates.push({ type, data });
    }
    off += len;
  }
  if (!candidates.length) return null; // 老式 RLE 图标 → 交给渲染层首字母兜底
  candidates.sort((a, b) => {
    const ia = ICNS_PREF.indexOf(a.type);
    const ib = ICNS_PREF.indexOf(b.type);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return candidates[0].data;
}

async function readEmbeddedAppIcon(appPath) {
  try {
    const resDir = path.join(appPath, 'Contents', 'Resources');
    const files = await fs.promises.readdir(resDir);
    const icns = files.filter((f) => f.toLowerCase().endsWith('.icns'));
    if (!icns.length) return null;
    // 优先 AppIcon.icns，其次名字含 app/icon 的，避免选中文档类型图标
    const score = (n) => {
      const s = n.toLowerCase();
      if (s === 'appicon.icns') return 0;
      if (s.includes('app')) return 1;
      if (s.includes('icon')) return 2;
      return 3;
    };
    icns.sort((a, b) => score(a) - score(b) || a.length - b.length);
    const buf = await fs.promises.readFile(path.join(resDir, icns[0]));
    const png = extractPngFromIcns(buf);
    return png ? `data:image/png;base64,${png.toString('base64')}` : null;
  } catch (e) {
    return null; // 单个应用读不到图标不影响整体
  }
}

function createDarwinAdapter(options = {}) {
  const electron = options.electron || {};
  const { app, systemPreferences, shell, dialog } = electron;
  const hooks = options.hooks || {};
  const mediaPermissionCoordinator = options.mediaPermissionCoordinator || null;

  // 模块级状态随代码迁入实例。
  let windowScanCache = new Map();
  let windowScanRevision = 0;
  const windowIconCache = new Map();
  let previousPasteTarget = null;
  let sodaMusicPlaying = false;
  let systemIconActive = 0;
  const systemIconQueue = [];

  function runJxa(script, args = []) {
    if (options.runJxa) return options.runJxa(script, args);
    return new Promise((resolve, reject) => {
      execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', script, '--', ...args.map(String)],
        { timeout: 6000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => error ? reject(error) : resolve(String(stdout || '').trim())
      );
    });
  }

  function readSystemAppIconNow(appPath) {
    return new Promise((resolve) => {
      execFile(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', SYSTEM_ICON_JXA, appPath],
        { timeout: 4000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => {
          const base64 = typeof stdout === 'string' ? stdout.trim() : '';
          if (error || !base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
            resolve(null);
            return;
          }
          resolve(`data:image/png;base64,${base64}`);
        }
      );
    });
  }

  function pumpSystemIconQueue() {
    while (systemIconActive < SYSTEM_ICON_CONCURRENCY && systemIconQueue.length) {
      const job = systemIconQueue.shift();
      if (job.cancelled) continue;
      systemIconActive++;
      readSystemAppIconNow(job.appPath)
        .then(job.finish, () => job.finish(null))
        .finally(() => {
          systemIconActive--;
          pumpSystemIconQueue();
        });
    }
  }

  function readSystemAppIcon(appPath) {
    return new Promise((resolve) => {
      const job = {
        appPath,
        cancelled: false,
        settled: false,
        timer: null,
        finish(value) {
          if (job.settled) return;
          job.settled = true;
          if (job.timer) clearTimeout(job.timer);
          resolve(value);
        },
      };
      job.timer = setTimeout(() => {
        job.cancelled = true;
        job.finish(null);
      }, SYSTEM_ICON_QUEUE_TIMEOUT_MS);
      systemIconQueue.push(job);
      pumpSystemIconQueue();
    });
  }

  async function readWindowAppIcon(appPath) {
    const systemIcon = await withTimeout(readSystemAppIcon(appPath), 2800, null);
    return systemIcon || readEmbeddedAppIcon(appPath);
  }

  async function listWindows() {
    const revision=++windowScanRevision;
    if (systemPreferences?.isTrustedAccessibilityClient && !systemPreferences.isTrustedAccessibilityClient(false)) {
      windowScanCache = new Map();
      return { items: [], error: 'accessibility_permission_required' };
    }
    try {
      const raw = await runJxa(WINDOWS_LIST_JXA,[process.pid]);
      const parsed = JSON.parse(raw || '{}');
      const payload=Array.isArray(parsed)?{rows:parsed}:parsed;
      if(payload.error){if(revision===windowScanRevision)windowScanCache=new Map();return {items:[],error:payload.error};}
      const rows=normalizeWindowRows(payload.rows||[]).filter(item=>item.pid!==process.pid);
      const appPaths = [...new Set(rows.map((item) => item.appPath).filter(Boolean))];
      await Promise.all(appPaths.map(async (appPath) => {
        if (windowIconCache.has(appPath)) return;
        const icon = await withTimeout(readWindowAppIcon(appPath), 3500, null);
        windowIconCache.set(appPath, icon);
      }));
      rows.forEach((item) => {
        item.icon = item.appPath ? windowIconCache.get(item.appPath) || null : null;
      });
      if(revision!==windowScanRevision)return {items:[...windowScanCache.values()],error:null};
      windowScanCache = new Map(rows.map((item) => [item.id, item]));
      return { items: rows, error: null };
    } catch (error) {
      if(revision===windowScanRevision)windowScanCache = new Map();
      return { items: [], error: 'window_scan_failed' };
    }
  }

  async function focusWindowRow(target) {
    if (!target?.axWindowId) return false;
    try {
      return (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.axWindowId])) === 'true';
    } catch (error) {
      return false;
    }
  }

  async function resolveTaskApp(source, { window, senderPid } = {}) {
    const apps = JSON.parse(await runJxa(RUNNING_APPS_JXA) || '[]');
    // CLI sources run inside a terminal (or an editor's integrated terminal).
    // Walk its hook process ancestry instead of capturing an unrelated foreground app.
    const pid = Number(senderPid);
    const terminalSource = ['claude', 'grok', 'copilot'].includes(source) || source === 'antigravity' && window?.app === 'Terminal';
    if (terminalSource && Number.isSafeInteger(pid) && pid > 1) {
      const parents = await new Promise(resolve => (options.execFile || execFile)('/bin/ps', ['-axo', 'pid=,ppid='], { timeout: 1000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
        resolve(new Map(error ? [] : String(stdout).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))));
      }));
      const seen = new Set();
      for (let ancestor = pid; ancestor > 1 && !seen.has(ancestor); ancestor = parents.get(ancestor) || 0) {
        seen.add(ancestor);
        const app = apps.find(row => row.pid === ancestor);
        if (app) return app;
      }
    }
    const candidates = apps.filter(row => taskAppMatches({ source, window }, row));
    // With no sender identity, prefer an exact terminal title later instead of
    // assigning an arbitrary terminal when several are running.
    if (terminalSource && !window?.app && !window?.bundleId && candidates.length !== 1) return null;
    return candidates[0] || null;
  }

  function readFrontmostApp() {
    return new Promise((resolve) => {
      execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONTMOST_APP_JXA], { timeout: 2200 }, (error, stdout) => {
        if (error) return resolve(null);
        try {
          const value = JSON.parse(String(stdout || '').trim());
          resolve(value && value.path ? value : null);
        } catch (parseError) {
          resolve(null);
        }
      });
    });
  }

  function sodaMusicRunning() {
    return new Promise((resolve) => {
      execFile('/usr/bin/pgrep', ['-f', '^/Applications/汽水音乐\\.app/Contents/MacOS/汽水音乐$'], { timeout: 1500 }, (error) => resolve(!error));
    });
  }

  function launchSodaMusic() {
    return new Promise((resolve) => {
      const cleanEnvironment = { ...process.env };
      delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
      cleanEnvironment.XPC_SERVICE_NAME = '0';
      execFile(
        '/usr/bin/open',
        [SODA_MUSIC_APP],
        { timeout: 4000, env: cleanEnvironment },
        (error) => resolve(!error)
      );
    });
  }

  async function sendSodaShortcut(action) {
    if (!systemPreferences.isTrustedAccessibilityClient(true)) {
      return { ok: false, error: 'accessibility_permission_required' };
    }
    const shortcut = sodaShortcutSpec(action);
    if (!shortcut) return { ok: false, error: 'invalid_action' };
    try {
      const result = await runJxa(SODA_SHORTCUT_JXA, [
        shortcut.keyCode,
        shortcut.command ? '1' : '0',
        shortcut.dismissOverlays ? '1' : '0',
      ]);
      return result === 'ok' ? { ok: true } : { ok: false, error: 'soda_control_failed' };
    } catch (error) {
      console.warn('[music] failed to send Soda Music shortcut', error && error.message || error);
      return { ok: false, error: 'soda_control_failed' };
    }
  }

  // ============ 启动时的权限自检 ============
  // DMG 装的是全新二进制，TCC 授权不会从开发版继承，而这几项缺失时的表现都是「静默失效」：
  // 缺「屏幕录制」→ CGWindowList 照样返回窗口但标题全空，当前窗口看起来像真的没窗口；
  // 缺「辅助功能」→ 枚举、聚焦窗口和汽水音乐发按键全部无效。
  // 系统对前者根本不弹提示，所以只能由应用自己说，否则用户完全无从下手。
  async function selfCheckPermissions() {
    const skipFlag = path.join(app.getPath('userData'), PERMISSION_PROMPT_SKIP_FILE);
    if (fs.existsSync(skipFlag)) return;

    const missing = [];
    // 传 false 只查询不弹系统框：先把缺失项攒齐一次性告知，避免连弹两个系统对话框。
    if (!systemPreferences.isTrustedAccessibilityClient(false)) missing.push('accessibility');
    // AX enumerates titles and focuses windows without capturing screen pixels.
    if (missing.length === 0) return;

    const names = missing.map((key) => (key === 'accessibility' ? pomeLocalePlatformAdaptersDarwin.t("copy.accessibility.b8f88a") : pomeLocalePlatformAdaptersDarwin.t("copy.screenRecording.77dfb4")));
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'info',
      message: pomeLocalePlatformAdaptersDarwin.t("copy.pomePanelNeedsPermission.f16466", { arg1: (names.join(pomeLocalePlatformAdaptersDarwin.t("copy.and.545349"))) }),
      detail: [
        pomeLocalePlatformAdaptersDarwin.t("copy.withoutThesePermissionsCurrentWindowsCannotRead.d29b9c"),
        '',
        pomeLocalePlatformAdaptersDarwin.t("copy.restartPomePanelAfterGrantingPermissionTo.dace8e"),
        pomeLocalePlatformAdaptersDarwin.t("copy.adHocSignedBuildsMayNeedPermission.5e8b38"),
      ].join('\n'),
      buttons: [pomeLocalePlatformAdaptersDarwin.t("copy.openSystemSettings.0407db"), pomeLocalePlatformAdaptersDarwin.t("copy.later.9d2055")],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: pomeLocalePlatformAdaptersDarwin.t("copy.donTAskAgain.a54a0a"),
      checkboxChecked: false,
    });

    if (checkboxChecked) {
      try { fs.writeFileSync(skipFlag, new Date().toISOString()); } catch (error) {}
    }
    if (response !== 0) return;

    // 顺带用 true 触发一次系统的辅助功能提示：这一步会把应用登记进系统设置的列表里，
    // 否则用户打开设置面板可能找不到 Pome Panel 这一项、只能手动拖进去。
    if (missing.includes('accessibility')) systemPreferences.isTrustedAccessibilityClient(true);
    shell.openExternal(PRIVACY_SETTINGS_PANES[missing[0]]);
  }

  return {
    id: 'darwin',
    taskApps: createTaskApps('darwin', { ...options.taskApps, resolveTaskApp }),
    native: { available: true },
    windows: {
      list: listWindows,
      focus(windowId) {
        return focusWindowRow(windowScanCache.get(windowId));
      },
      // 通知点击聚焦不经过渲染层的窗口 ID，直接拿扫描结果里的行。
      focusRow: focusWindowRow,
      resolveTaskApp,
      appIcon: readWindowAppIcon,
    },
    paste: {
      startTracking() {},
      stopTracking() {},
      async captureTarget() {
        const current = await readFrontmostApp();
        if (current && !SELF_BUNDLE_IDS.includes(current.bundleId)) {
          previousPasteTarget = current;
        }
        return previousPasteTarget;
      },
      rememberedTarget() {
        return previousPasteTarget;
      },
      // macOS 上发 ⌘V 需要辅助功能权限，未授权时内容仍留在系统剪贴板作为可靠降级。
      permissionRequired() {
        return !systemPreferences.isTrustedAccessibilityClient(true);
      },
      pasteTo(target) {
        return new Promise((resolve) => {
          const bundleId = String(target && target.bundleId || '');
          if (!bundleId) return resolve('target_gone');
          execFile('/usr/bin/osascript', [
            '-l', 'JavaScript', '-e', PASTE_TO_APP_JXA, bundleId,
          ], { timeout: 3000 }, (error, stdout) => {
            resolve(!error && String(stdout || '').trim() === 'ok' ? 'pasted' : 'focus_failed');
          });
        });
      },
    },
    music: {
      async status() {
        const installed = fs.existsSync(SODA_MUSIC_APP);
        const running = installed ? await sodaMusicRunning() : false;
        if (!running) sodaMusicPlaying = false;
        return {
          installed,
          running,
          sessionActive: running,
          playing: running && sodaMusicPlaying,
          title: '',
          artist: '',
          icon: installed ? await readSystemAppIconNow(SODA_MUSIC_APP) : null,
        };
      },
      async control(action) {
        if (!fs.existsSync(SODA_MUSIC_APP)) return { ok: false, error: 'not_installed' };
        const result = await controlSodaMusic(action, {
          isRunning: sodaMusicRunning,
          launch: launchSodaMusic,
          sendShortcut: sendSodaShortcut,
        }, sodaMusicPlaying);
        if (result && result.ok) sodaMusicPlaying = result.playing;
        return result;
      },
    },
    media: {
      status(mediaType) {
        try {
          return systemPreferences.getMediaAccessStatus(mediaType);
        } catch (error) {
          return 'unknown';
        }
      },
      // macOS 渲染层 getUserMedia 不会自动弹 TCC 授权，必须由主进程申请。
      // screen-saver 层级会压住 TCC 气泡，所以请求前经协调器临时降层并激活应用。
      request(mediaType) {
        if (systemPreferences.getMediaAccessStatus(mediaType) === 'granted') return Promise.resolve(true);
        if (!mediaPermissionCoordinator) return systemPreferences.askForMediaAccess(mediaType);
        return mediaPermissionCoordinator.run({
          owner: typeof hooks.getOwnerWindow === 'function' ? hooks.getOwnerWindow() : null,
          activate: () => app.focus({ steal: true }),
          track: (delta) => {
            if (typeof hooks.trackMediaPermission === 'function') hooks.trackMediaPermission(delta, mediaType);
          },
          request: () => systemPreferences.askForMediaAccess(mediaType),
        });
      },
    },
    permissions: { selfCheck: selfCheckPermissions },
    privacyPaneUrl(pane) {
      return PRIVACY_SETTINGS_PANES[String(pane || '')] || null;
    },
  };
}

module.exports = { createDarwinAdapter, PRIVACY_SETTINGS_PANES };
