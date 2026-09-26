'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadAdapter } = require('../platform-adapters');
const { createWin32Native, loadWin32Native } = require('../platform-adapters/win32-user32');
const packageConfig = require('../package.json');

// 适配层的形状是 main.js 的唯一契约（方案 §2.5）：IPC 一律走这些方法，
// 缺失的能力（Windows 的汽水音乐、权限自检）表现为对应键不存在。
const REQUIRED_METHODS = {
  windows: ['list', 'focus', 'focusRow', 'appIcon'],
  paste: ['startTracking', 'stopTracking', 'captureTarget', 'rememberedTarget', 'permissionRequired', 'pasteTo'],
  media: ['status', 'request'],
};

function assertShape(adapter, platform) {
  assert.equal(adapter.id, platform);
  assert.equal(typeof adapter.native.available, 'boolean');
  assert.equal(typeof adapter.privacyPaneUrl, 'function');
  for (const [group, methods] of Object.entries(REQUIRED_METHODS)) {
    for (const method of methods) {
      assert.equal(typeof adapter[group][method], 'function', `${platform} 缺少 ${group}.${method}`);
    }
  }
}

test('both adapters expose the same window, paste and media interface', () => {
  assertShape(loadAdapter('darwin'), 'darwin');
  assertShape(loadAdapter('win32'), 'win32');
});

// 原生绑定不可用的形态：单测同时在 Mac 与 Windows runner 上跑，所以不能靠宿主平台
// 决定 koffi 能不能加载，一律注入降级后的原生层（P4-0）。
const UNAVAILABLE_NATIVE = { available: false, reason: 'load_failed' };

test('Windows has no music control and no Mac-only permission self-check', () => {
  const win32 = loadAdapter('win32', { native: UNAVAILABLE_NATIVE });
  assert.equal(win32.music, undefined, 'D4：Windows 永久没有汽水音乐控制');
  assert.equal(win32.permissions, undefined);
  assert.equal(win32.native.available, false);
  assert.equal(win32.native.reason, 'load_failed');

  const darwin = loadAdapter('darwin');
  assert.equal(typeof darwin.music.status, 'function');
  assert.equal(typeof darwin.music.control, 'function');
  assert.equal(typeof darwin.permissions.selfCheck, 'function');
  assert.equal(darwin.native.available, true);
});

test('Windows degrades to native_unavailable instead of throwing', async () => {
  // 原生绑定加载失败（或实验开关没开）时，每个入口都必须给出可预期的降级值，
  // main.js 不做平台判断就直接调这些方法。
  const win32 = loadAdapter('win32', { native: UNAVAILABLE_NATIVE });
  assert.deepEqual(await win32.windows.list(), { items: [], error: 'native_unavailable' });
  assert.equal(await win32.windows.focus('window-1-2'), false);
  assert.equal(await win32.paste.captureTarget(), null);
  assert.equal(await win32.paste.pasteTo({ pid: 1, handle: '1234' }), 'native_unavailable');
  assert.equal(win32.paste.permissionRequired(), false);
  assert.equal(win32.media.status('microphone'), 'unknown');
  assert.equal(await win32.media.request('microphone'), true);
  // 跟踪开关在不可用时也必须是安全的空操作，main.js 不做平台判断就直接调。
  win32.paste.startTracking();
  win32.paste.stopTracking();
});

// Mac 包里根本没有 koffi（build.mac.files 排除），所以在 darwin 上加载适配层时
// 连 require('koffi') 都不能发生，否则 Mac 版会启动即崩。
test('loading the adapters on macOS never pulls koffi into the process', (t) => {
  // Windows runner 上 koffi 本来就该加载成功，这条只在 Mac 上有意义。
  if (process.platform !== 'darwin') return t.skip('darwin only');
  loadAdapter('darwin');
  createWin32Native({ platform: 'darwin', env: {} });
  const loaded = Object.keys(require.cache).some((file) => /[\\/]node_modules[\\/](koffi|@koromix)[\\/]/.test(file));
  assert.equal(loaded, false, 'darwin 上不得加载 koffi');
});

// Windows runner 上这条是 koffi 声明的唯一实机校验：打包前就能看出某个原型串写错了
// （所有 FFI 调用都被 try/catch 包着，否则只会静默退化成"读不到"）。
test('koffi bindings load and answer on Windows', (t) => {
  if (process.platform !== 'win32') return t.skip('win32 only');
  const native = loadWin32Native();
  assert.equal(native.available, true, `koffi 必须能加载：${native.reason || ''} ${native.detail || ''}`);
  assert.ok(Array.isArray(native.enumWindows()), 'EnumWindows 必须回调出句柄数组');
  assert.equal(typeof native.selfIntegrityRid(), 'number', '自身令牌的完整性级别必须读得到');
  const rows = native.enumWindows().filter((handle) => native.isWindowVisible(handle));
  assert.ok(rows.length > 0, 'CI runner 上也应有可见窗口');
  assert.equal(typeof native.windowProcessId(rows[0]), 'number');
  assert.equal(typeof native.windowTitle(rows[0]), 'string');
});

test('POME_DISABLE_WIN_NATIVE=1 forces the native layer off', () => {
  assert.deepEqual(
    createWin32Native({ platform: 'win32', env: { POME_DISABLE_WIN_NATIVE: '1' } }),
    { available: false, reason: 'disabled_by_env' }
  );
  // Mac / Linux 上连 koffi 都不 require，理由与环境变量分开，便于排障。
  assert.deepEqual(createWin32Native({ platform: 'darwin', env: {} }), { available: false, reason: 'not_win32' });
});

test('Windows window rows and paste targets carry the HWND as a decimal string', async () => {
  // 原生层用一个假实现替掉：koffi 只在真机上加载，这里验证适配层的过滤与映射。
  const native = {
    available: true,
    handles: [10n, 11n, 12n, 13n, 14n],
    foregroundWindow: () => 10n,
    enumWindows() { return this.handles; },
    isWindow: () => true,
    isWindowVisible: (handle) => handle !== 11n,
    windowOwner: (handle) => (handle === 12n ? 99n : null),
    isToolWindow: (handle) => handle === 13n,
    isCloaked: (handle) => handle === 14n,
    windowTitle: (handle) => (handle === 10n ? 'alpha - Visual Studio Code' : 'other'),
    windowProcessId: () => 4242,
    processImagePath: () => 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    processIntegrityRid: () => 0x2000,
    selfIntegrityRid: () => 0x2000,
    restoreWindow: () => false,
    setForeground: () => true,
    releaseStuckModifiers: () => false,
    sendCtrlV: () => true,
  };
  const win32 = loadAdapter('win32', { native });
  const { items, error } = await win32.windows.list();
  assert.equal(error, null);
  assert.deepEqual(items.map((item) => item.handle), ['10']);
  assert.equal(items[0].appName, 'Code');
  assert.equal(items[0].appPath, 'C:\\Program Files\\Microsoft VS Code\\Code.exe');
  assert.equal(items[0].id, 'window-4242-10');
  assert.equal(await win32.windows.focus(items[0].id), true);
  assert.equal(await win32.windows.focus('window-1-2'), false);

  const target = await win32.paste.captureTarget();
  assert.deepEqual(target, {
    handle: '10',
    pid: 4242,
    appPath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  });
  assert.equal(await win32.paste.pasteTo(target), 'pasted');
  assert.equal(await win32.paste.pasteTo({ pid: 4242 }), 'target_gone');
});

test('Windows refuses to send keystrokes into a more privileged window', async () => {
  const native = {
    available: true,
    foregroundWindow: () => 10n,
    enumWindows: () => [],
    isWindow: () => true,
    windowProcessId: () => 4242,
    processImagePath: () => 'C:\\Windows\\regedit.exe',
    processIntegrityRid: () => 0x3000, // SECURITY_MANDATORY_HIGH_RID
    selfIntegrityRid: () => 0x2000,
    restoreWindow: () => false,
    setForeground: () => {
      throw new Error('提权窗口必须在发送前被挡住，不能走到聚焦');
    },
    sendCtrlV: () => true,
  };
  const win32 = loadAdapter('win32', { native });
  assert.equal(await win32.paste.pasteTo({ handle: '10', pid: 4242 }), 'elevated');
});

test('Windows gives up when the target loses focus before Ctrl+V', async () => {
  const native = {
    available: true,
    foregroundWindow: () => 77n, // 用户在 60ms 等待期里切走了
    enumWindows: () => [],
    isWindow: () => true,
    windowProcessId: () => 4242,
    processImagePath: () => '',
    processIntegrityRid: () => 0x2000,
    selfIntegrityRid: () => 0x2000,
    restoreWindow: () => false,
    setForeground: () => true,
    releaseStuckModifiers: () => false,
    sendCtrlV: () => {
      throw new Error('前台复核失败时绝不能发送按键');
    },
  };
  const win32 = loadAdapter('win32', { native });
  assert.equal(await win32.paste.pasteTo({ handle: '10', pid: 4242 }), 'focus_failed');
});

test('privacy panes stay an allow-list keyed by name, never a built URL', () => {
  const win32 = loadAdapter('win32');
  assert.equal(win32.privacyPaneUrl('microphone'), 'ms-settings:privacy-microphone');
  assert.equal(win32.privacyPaneUrl('camera'), 'ms-settings:privacy-webcam');
  assert.equal(win32.privacyPaneUrl('accessibility'), null);
  assert.equal(win32.privacyPaneUrl('ms-settings:anything'), null);

  const darwin = loadAdapter('darwin');
  assert.match(darwin.privacyPaneUrl('accessibility'), /^x-apple\.systempreferences:/);
  assert.match(darwin.privacyPaneUrl('screen-recording'), /Privacy_ScreenCapture$/);
  assert.equal(darwin.privacyPaneUrl('nonsense'), null);
});

test('unsupported platforms still get a callable adapter', async () => {
  const linux = loadAdapter('linux');
  assertShape(linux, 'linux');
  assert.equal(linux.native.available, false);
  assert.deepEqual(await linux.windows.list(), { items: [], error: 'unsupported' });
});

test('build.files ships platform-adapters so the packaged app can load them', () => {
  assert.ok(
    packageConfig.build.files.includes('platform-adapters/**/*'),
    'DMG / EXE 必须带上适配层，否则打包后启动即崩'
  );
  const testDesktop = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'scripts', 'test-desktop.js'),
    'utf8'
  );
  for (const file of ['index', 'darwin', 'win32', 'win32-user32']) {
    assert.match(testDesktop, new RegExp(`platform-adapters/${file}\\.js`));
  }
});

// P4-0：Mac 包不使用 koffi，必须整包排除——否则 build/afterPack.js 的 ad-hoc 签名与
// codesign --verify --deep --strict 会碰到额外的 Mach-O。
test('koffi is pinned to 3.x and excluded from the Mac build', () => {
  assert.match(packageConfig.dependencies.koffi, /^~?3\.\d+\.\d+$/, 'koffi 必须锁定 3.x');
  const macFiles = packageConfig.build.mac.files || [];
  assert.ok(macFiles.includes('!node_modules/koffi/**'), 'Mac 包必须排除 koffi');
  assert.ok(macFiles.includes('!node_modules/@koromix/**'), 'Mac 包必须排除 koffi 的平台子包');
  const lockfile = require('../package-lock.json');
  assert.ok(
    Object.hasOwn(lockfile.packages, 'node_modules/@koromix/koffi-win32-x64'),
    'lockfile 必须含 Windows x64 原生子包，否则 Windows runner 的 npm ci 装不上'
  );
});
