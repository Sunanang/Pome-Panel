'use strict';

// macOS 适配层（P0-2）：main.js 里所有 JXA / osascript 逻辑原样迁入，行为不变。
// 模块级状态（窗口扫描缓存、图标缓存与队列、上一个粘贴目标、汽水音乐播放态）随代码迁入实例。
// Electron 依赖全部由 main.js 注入，模块本身不在加载时触碰 Electron，方便单测。

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  normalizeWindowRows,
  screenRecordingProbePolicy,
  sodaShortcutSpec,
  controlSodaMusic,
} = require('../main-services');

const SODA_MUSIC_APP = '/Applications/汽水音乐.app';
const PERMISSION_PROMPT_SKIP_FILE = 'permission-prompt-skipped';
const SELF_BUNDLE_IDS = ['com.github.Electron', 'com.vibecoding.notch-todo', 'com.dynamicpanel.app'];

// 只放行固定的几个隐私面板，渲染层传来的值只能当作枚举的键来查，
// 绝不能拼进 URL：x-apple.systempreferences: 能打开任意设置面板。
const PRIVACY_SETTINGS_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};

const WINDOWS_LIST_JXA = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run() {
  const rows = [];
  let candidates = 0;
  let titled = 0;
  const options = $.kCGWindowListOptionAll | $.kCGWindowListExcludeDesktopElements;
  const windowList = ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID)
  );
  const appPaths = {};
  for (let index = 0; index < Number(windowList.count); index++) {
    const info = windowList.objectAtIndex(index);
    const get = (key) => ObjC.unwrap(info.objectForKey($(key)));
    const layer = Number(get('kCGWindowLayer'));
    const pid = Number(get('kCGWindowOwnerPID'));
    const appName = String(get('kCGWindowOwnerName') || '').trim();
    const title = String(get('kCGWindowName') || '').replace(/\\s+/g, ' ').trim();
    const windowNumber = Number(get('kCGWindowNumber'));
    // 没有「屏幕录制」权限时 CGWindowList 仍会返回别的应用的窗口，只是 kCGWindowName
    // 一律为空，系统不报任何错。于是下面这句会把所有行丢掉、列表看起来像「真的没窗口」。
    // 统计候选数与其中有标题的条数，好让主进程区分这两种情况。
    if (layer === 0 && pid && appName && windowNumber) {
      candidates += 1;
      if (title) titled += 1;
    }
    if (layer !== 0 || !pid || !appName || !title || !windowNumber) continue;
    if (!Object.prototype.hasOwnProperty.call(appPaths, pid)) {
      const meta = { appPath: '', policy: -1 };
      try {
        const runningApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
        if (runningApp && !runningApp.isNil()) {
          meta.policy = Number(runningApp.activationPolicy);
          if (runningApp.bundleURL && !runningApp.bundleURL.isNil()) {
            meta.appPath = String(ObjC.unwrap(runningApp.bundleURL.path) || '');
          }
        }
      } catch (error) {}
      appPaths[pid] = meta;
    }
    const appMeta = appPaths[pid];
    // activationPolicy 2 = NSApplicationActivationPolicyProhibited：XPC 与系统辅助进程
    // （如 AuthenticationServicesHelper，bundle 是 .xpc 不是 .app）。它们在系统层面就
    // 不能被激活，列出来点了也不会有任何反应，属于纯粹的假窗口。
    // 注意不能用 kCGWindowIsOnscreen 过滤：真实窗口在其他 Space 或被遮挡时该字段也是
    // nil，实测微信 / Arc / Chrome / 飞书都会被误删。
    if (appMeta.policy === 2) continue;
    rows.push({ pid, appName, appPath: appMeta.appPath, title, windowIndex: index, windowNumber });
  }
  // candidates 是本可列出的窗口数，titled 是其中拿到标题的数量。
  // candidates > 0 而 titled === 0 时几乎一定是缺「屏幕录制」权限，不是真的没窗口。
  return JSON.stringify({ rows: rows, candidates: candidates, titled: titled });
}`;

const WINDOW_FOCUS_JXA = `
function run(argv) {
  const pid = Number(argv[0]);
  const wantedTitle = String(argv[1] || '');
  const fallbackIndex = Number(argv[2] || 0);
  const se = Application('System Events');
  const matches = se.applicationProcesses.whose({ unixId: pid })();
  if (!matches.length) return 'false';
  const process = matches[0];
  process.frontmost = true;
  delay(0.08);
  const windows = process.windows();
  let target = windows[fallbackIndex];
  for (let i = 0; i < windows.length; i++) {
    try {
      if (String(windows[i].name()) === wantedTitle) { target = windows[i]; break; }
    } catch (error) {}
  }
  if (target) {
    try { target.actions.byName('AXRaise').perform(); } catch (error) {}
  }
  try {
    const menuBarItems = process.menuBars[0].menuBarItems();
    let windowMenu = null;
    for (let i = 0; i < menuBarItems.length; i++) {
      const name = String(menuBarItems[i].name());
      if (name === 'Window' || name === '窗口') { windowMenu = menuBarItems[i]; break; }
    }
    if (windowMenu) {
      const items = windowMenu.menus[0].menuItems();
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].name()) === wantedTitle) {
          items[i].click();
          break;
        }
      }
    }
  } catch (error) {}
  return 'true';
}`;

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
  const { app, systemPreferences, shell, dialog, desktopCapturer } = electron;
  const hooks = options.hooks || {};
  const mediaPermissionCoordinator = options.mediaPermissionCoordinator || null;

  // 模块级状态随代码迁入实例。
  let windowScanCache = new Map();
  const windowIconCache = new Map();
  let previousPasteTarget = null;
  let sodaMusicPlaying = false;
  let systemIconActive = 0;
  const systemIconQueue = [];

  function runJxa(script, args = []) {
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
    try {
      const raw = await runJxa(WINDOWS_LIST_JXA);
      const parsed = JSON.parse(raw || '{}');
      // 兼容旧格式（裸数组），新格式是 { rows, candidates, titled }。
      const payload = Array.isArray(parsed)
        ? { rows: parsed, candidates: parsed.length, titled: parsed.length }
        : parsed;
      const rows = normalizeWindowRows(payload.rows || []).filter((item) => item.pid !== process.pid);
      // 有候选窗口却一个标题都读不到 = 缺「屏幕录制」权限。macOS 10.15 起读取其他应用的
      // 窗口标题需要该权限，系统不会报错也不会弹提示，只是静默返回空标题，
      // 结果界面上只剩一句「没有读取到可切换窗口」，把权限问题伪装成了「真的没窗口」。
      if (rows.length === 0 && Number(payload.candidates) > 0 && Number(payload.titled) === 0) {
        windowScanCache = new Map();
        return { items: [], error: 'screen_recording_permission_required' };
      }
      const appPaths = [...new Set(rows.map((item) => item.appPath).filter(Boolean))];
      await Promise.all(appPaths.map(async (appPath) => {
        if (windowIconCache.has(appPath)) return;
        const icon = await withTimeout(readWindowAppIcon(appPath), 3500, null);
        windowIconCache.set(appPath, icon);
      }));
      rows.forEach((item) => {
        item.icon = item.appPath ? windowIconCache.get(item.appPath) || null : null;
      });
      windowScanCache = new Map(rows.map((item) => [item.id, item]));
      return { items: rows, error: null };
    } catch (error) {
      windowScanCache = new Map();
      return { items: [], error: 'accessibility_permission_required' };
    }
  }

  async function focusWindowRow(target) {
    if (!target) return false;
    try {
      return (await runJxa(WINDOW_FOCUS_JXA, [target.pid, target.title, target.windowIndex])) === 'true';
    } catch (error) {
      return false;
    }
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

  // 先尊重系统的明确状态，尤其不能在 not-determined 时调用 desktopCapturer，
  // 否则启动自检本身就会抢先弹出系统录屏框。只有系统报告 granted 时才通过
  // 无缩略图的窗口标题做二次确认；未知状态 fail-open，等用户实际使用时再申请。
  async function hasScreenRecordingAccess() {
    const policy = screenRecordingProbePolicy(systemPreferences.getMediaAccessStatus('screen'));
    if (!policy.inspectWindowTitles) return policy.hasAccess;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      if (sources.length === 0) return true; // 拿不到源无法判定，不误报
      return sources.some((source) => String(source.name || '').trim().length > 0);
    } catch (error) {
      return true; // 探测本身失败时不打扰用户
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
    if (!await hasScreenRecordingAccess()) missing.push('screen-recording');
    if (missing.length === 0) return;

    const names = missing.map((key) => (key === 'accessibility' ? '辅助功能' : '屏幕录制'));
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'info',
      message: `Pome Panel 需要「${names.join('」和「')}」权限`,
      detail: [
        '缺少这些权限时，「当前窗口」会读不到任何窗口，汽水音乐的播放控制也不会生效。',
        '',
        '授权后需要重新启动 Pome Panel 才会生效。',
        'ad-hoc 签名的应用每次重新打包都要重新授权一次，这是没有开发者账号分发的固有限制。',
      ].join('\n'),
      buttons: ['打开系统设置', '以后再说'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: '不再提示',
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
    native: { available: true },
    windows: {
      list: listWindows,
      focus(windowId) {
        return focusWindowRow(windowScanCache.get(windowId));
      },
      // 通知点击聚焦不经过渲染层的窗口 ID，直接拿扫描结果里的行。
      focusRow: focusWindowRow,
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
