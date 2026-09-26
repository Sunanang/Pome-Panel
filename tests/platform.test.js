const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../platform');

// panelBounds 从 P1 起只服务 legacyWinLayout 回滚开关；统一布局见 tests/layout.test.js。
// W0-2：收起窗口等于胶囊本身，胶囊周围不再留下挡点击的透明区域。
test('the legacy Windows layout still collapses to the capsule itself below a top taskbar', () => {
  const display = { bounds: { x: -1920, y: -200, width: 1920, height: 1080 }, workArea: { x: -1920, y: -152, width: 1920, height: 1032 } };
  assert.deepEqual(platform.panelBounds('win32', display, false), { x: -1002, y: -152, width: 85, height: 9 });
  assert.deepEqual(platform.panelBounds('win32', display, true), { x: -1580, y: -152, width: 1240, height: 616 });
});

test('the legacy Windows layout leaves its own margins around constrained content', () => {
  const display = { bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 48, y: 0, width: 752, height: 560 } };
  assert.deepEqual(platform.panelBounds('win32', display, true), { x: 72, y: 0, width: 704, height: 536 });
});

test('a desktop narrower than the capsule never produces a wider window', () => {
  const display = { bounds: { x: 0, y: 0, width: 60, height: 400 }, workArea: { x: 0, y: 0, width: 60, height: 400 } };
  assert.deepEqual(platform.panelBounds('win32', display, false), { x: 0, y: 0, width: 60, height: 9 });
});

test('Windows capabilities cannot enable Mac-only integrations', () => {
  assert.deepEqual(platform.capabilities('win32').unavailableHomeModules, ['music', 'windows']);
  assert.equal(platform.capabilities('win32').automaticPaste, false);
  assert.equal(platform.capabilities('win32').autoLaunch, true);
  assert.deepEqual(platform.capabilities('darwin').unavailableHomeModules, []);
});

// ============ 能力层 v2（P0-1） ============
test('Mac has every integration and keeps the menu bar as its top inset', () => {
  const caps = platform.resolveCapabilities('darwin');
  assert.deepEqual(caps.unavailableHomeModules, []);
  assert.deepEqual(caps.features, {
    windowSwitcher: true,
    windowFocus: true,
    automaticPaste: true,
    musicControl: true,
    autoLaunch: true,
    firstRunAutoLaunch: true,
    permissionSelfCheck: true,
    mediaAccessStatus: true,
    winNativeSetting: false,
  });
  assert.deepEqual(caps.layout, { areaKind: 'bounds', topInsetKind: 'menuBar' });
  assert.deepEqual(caps.ui, { modifierStyle: 'symbols', metaAccelerator: 'Command' });
  assert.deepEqual(caps.privacyPanes, ['accessibility', 'screen-recording', 'microphone', 'camera']);
});

test('Windows native features stay off until the module loads and the switch is on', () => {
  const off = platform.resolveCapabilities('win32', { nativeAvailable: false, winNativeEnabled: true });
  assert.deepEqual(off.unavailableHomeModules, ['music', 'windows']);
  assert.equal(off.features.windowSwitcher, false);
  assert.equal(off.features.automaticPaste, false);

  const disabled = platform.resolveCapabilities('win32', { nativeAvailable: true, winNativeEnabled: false });
  assert.deepEqual(disabled.unavailableHomeModules, ['music', 'windows']);

  const on = platform.resolveCapabilities('win32', { nativeAvailable: true, winNativeEnabled: true });
  // D4：汽水音乐永久不可用，所以 native 全开时首页仍缺 music。
  assert.deepEqual(on.unavailableHomeModules, ['music']);
  assert.equal(on.features.musicControl, false);
  assert.equal(on.features.windowSwitcher, true);
  assert.equal(on.features.windowFocus, true);
  assert.equal(on.features.automaticPaste, true);
  assert.equal(on.features.permissionSelfCheck, false);
  // 实验开关这一行在 Windows 上恒定存在，关掉原生能力后用户还得能把它打开。
  assert.equal(off.features.winNativeSetting, true);
  assert.equal(disabled.features.winNativeSetting, true);
  assert.equal(on.features.winNativeSetting, true);
  assert.deepEqual(on.layout, { areaKind: 'workArea', topInsetKind: 'none' });
  assert.deepEqual(on.ui, { modifierStyle: 'words', metaAccelerator: 'Super' });
  assert.deepEqual(on.privacyPanes, ['microphone', 'camera']);
});

test('capabilities() stays an alias with the old flat fields', () => {
  assert.deepEqual(platform.capabilities('darwin'), platform.resolveCapabilities('darwin', {}));
  const caps = platform.resolveCapabilities('darwin');
  assert.equal(caps.automaticPaste, caps.features.automaticPaste);
  assert.equal(caps.autoLaunch, caps.features.autoLaunch);
});

test('baseCapabilities ignores the runtime and never enables Windows natives', () => {
  const base = platform.baseCapabilities('win32');
  assert.equal(base.features.windowSwitcher, false);
  assert.equal(base.unavailableHomeModules, undefined);
});

// ============ 快捷键显示（P2-3） ============
test('accelerators keep one storage format and two platform renderings', () => {
  const mac = platform.resolveCapabilities('darwin');
  const win = platform.resolveCapabilities('win32');
  assert.equal(platform.formatAccelerator('Command+Shift+K', mac), '⇧⌘K');
  assert.equal(platform.formatAccelerator('Command+Shift+K', win), 'Ctrl+Shift+K');
  assert.equal(platform.formatAccelerator('Control+Alt+Shift+P', mac), '⌃⌥⇧P');
  assert.equal(platform.formatAccelerator('Super+K', win), 'Win+K');
  assert.equal(platform.formatAccelerator('Super+K', mac), '⌘K');
  assert.equal(platform.formatAccelerator('Space', mac), 'Space');
  assert.equal(platform.formatAccelerator('Space', win), 'Space');
  // 缺省 caps 时按 Mac 渲染，和 index.html 的静态兜底保持一致。
  assert.equal(platform.formatAccelerator('CommandOrControl+J'), '⌘J');
  assert.equal(platform.formatAccelerator(''), '');
  assert.equal(platform.formatAccelerator(null), '');
});

test('the modifier hint lists the keys each platform actually has', () => {
  assert.deepEqual(platform.modifierHints(platform.resolveCapabilities('darwin')), ['⌃', '⌥', '⇧', '⌘']);
  assert.deepEqual(platform.modifierHints(platform.resolveCapabilities('win32')), ['Ctrl', 'Alt', 'Shift', 'Win']);
});

test('a failed registration tells Win combinations apart from a busy shortcut', () => {
  const win = platform.resolveCapabilities('win32');
  const mac = platform.resolveCapabilities('darwin');
  assert.equal(platform.shortcutFailureReason('Super+D', win), 'system_reserved');
  assert.equal(platform.shortcutFailureReason('Control+Shift+K', win), 'occupied');
  // Mac 上 Super 就是 ⌘，不是系统保留键。
  assert.equal(platform.shortcutFailureReason('Super+D', mac), 'occupied');
});

// ============ 媒体权限提示（P3-2） ============
test('a blocked microphone names the right settings app on each platform', () => {
  const mac = platform.resolveCapabilities('darwin');
  const win = platform.resolveCapabilities('win32');

  const onMac = platform.mediaAccessPrompt('microphone', 'denied', mac);
  assert.equal(onMac.denied, true);
  assert.equal(onMac.pane, 'microphone');
  assert.equal(onMac.actionLabel, '打开系统设置');
  assert.match(onMac.message, /系统设置/);
  assert.equal(onMac.canOpenSettings, true);

  const onWin = platform.mediaAccessPrompt('camera', 'denied', win);
  assert.equal(onWin.pane, 'camera');
  assert.equal(onWin.actionLabel, '打开 Windows 隐私设置');
  assert.match(onWin.message, /摄像头/);
  assert.match(onWin.message, /Windows 设置/);
  assert.equal(onWin.canOpenSettings, true);
});

test('an undetermined status still offers the settings shortcut, worded as a check', () => {
  const win = platform.resolveCapabilities('win32');
  const prompt = platform.mediaAccessPrompt('microphone', 'not-determined', win);
  assert.equal(prompt.denied, false);
  assert.match(prompt.message, /请检查/);
  assert.equal(prompt.canOpenSettings, true);
  // Windows 没有辅助功能面板，落到不认识的 pane 时不能给出一个点不开的按钮。
  assert.equal(platform.mediaAccessPrompt('accessibility', 'denied', win).pane, 'microphone');
  assert.equal(platform.mediaAccessPrompt('microphone', 'denied', { platform: 'linux' }).canOpenSettings, false);
});

test('platform filtering leaves saved preferences intact and recovers a usable home', () => {
  const registry = ['music', 'pomodoro', 'cursor', 'recorder', 'windows', 'mirror', 'note', 'commands'];
  const hidden = ['pomodoro', 'recorder', 'mirror', 'note', 'commands'];
  const before = [...hidden];
  // cursor stays visible, so the "all available hidden" recovery does not strip pomodoro.
  assert.deepEqual(platform.effectiveHiddenModules(hidden, registry, ['music', 'windows']), ['music', 'pomodoro', 'recorder', 'windows', 'mirror', 'note', 'commands']);
  assert.deepEqual(hidden, before);
  assert.deepEqual(platform.effectiveHiddenModules(hidden, registry, []), hidden);
});

test('media references use portable separators for both Windows and Mac workspace files', () => {
  assert.equal(platform.portableMediaPath('recordings', 'C:\\Users\\me\\recordings\\recording-123.webm'), 'recordings/recording-123.webm');
  assert.equal(platform.portableMediaPath('clipboard-images', '/Users/me/clipboard-images/clip-123.png'), 'clipboard-images/clip-123.png');
});
