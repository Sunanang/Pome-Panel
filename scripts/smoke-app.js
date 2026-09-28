// Exercises the actual packaged application through Chromium's test-only debugging switch.
// No testing IPC, test flags or remote debugging are enabled during ordinary launches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/smoke-app.js <executable> [profile] [retained]');
const profile = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'todo-smoke-'));
const retained = process.argv[4] === 'retained';
const evidence = process.env.SMOKE_ARTIFACT_DIR || path.join(profile, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const smokeSettingsPath = path.join(profile, 'app-settings.json');
const firstRunMarker = path.join(profile, '.first-run-done');
// P3-1（D13）：fresh 轮是真正的全新安装（profile 里没有本应用写过的任何文件），
// 首启应自动打开开机自启。retained 轮反过来模拟从旧版本升级：旧版本从未写过
// 首启标记，删掉它之后自启状态必须保持 fresh 轮末尾留下的"关"。
if (retained) {
  // P1-1：顺带模拟老用户保存过侧边位置；启动时的一次性迁移应把它清掉。
  let smokeSettings = {};
  try {
    if (fs.existsSync(smokeSettingsPath)) {
      smokeSettings = JSON.parse(fs.readFileSync(smokeSettingsPath, 'utf8'));
    }
  } catch {
    smokeSettings = {};
  }
  smokeSettings.panelPosition = { x: 0, y: 300, edge: 'left', displayId: null };
  delete smokeSettings.layoutVersion;
  fs.writeFileSync(smokeSettingsPath, JSON.stringify(smokeSettings, null, 2));
  fs.rmSync(firstRunMarker, { force: true });
}
const activePortFile = path.join(profile, 'DevToolsActivePort');
if (fs.existsSync(activePortFile)) fs.unlinkSync(activePortFile);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (data) => { log += data; });
child.stderr.on('data', (data) => { log += data; });
child.on('error', (error) => { log += error.stack; });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}; ${last || log.slice(-2000)}`);
}
let socket;
let sequence = 0;
const pending = new Map();
const exceptions = [];
const deadline = setTimeout(() => { console.error('Application smoke timed out'); cleanup(); process.exit(1); }, 150000);
function cleanup() {
  clearTimeout(deadline);
  socket?.close();
  fs.writeFileSync(path.join(evidence, retained ? 'retained.log' : 'app.log'), log);
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function main() {
  const port = await until(() => {
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return match[1];
    return fs.existsSync(activePortFile) && fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0];
  }, 'DevTools startup');
  const page = await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return pages.find((item) => item.url.endsWith('/renderer/index.html'));
  }, 'application renderer');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (data) => {
    const value = JSON.parse(data);
    if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails);
    if (!value.id) return;
    const call = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) call?.reject(new Error(JSON.stringify(value.error)));
    else call?.resolve(value.result);
  });
  await send('Runtime.enable');
  await until(() => evaluate('Boolean(window.NotchHome && window.NotchWorkspace && window.notchAPI)'), 'renderer initialization');
  assert.equal(await evaluate('window.notchAPI.platform'), 'win32');
  // 能力层 v2：主进程下发的 capabilities 与渲染层的平台标识必须都到位。
  assert.equal(await evaluate('window.notchAPI.capabilities.platform'), 'win32');
  assert.equal(await evaluate('document.documentElement.dataset.platform'), 'win32');
  assert.equal(await evaluate('window.notchAPI.capabilities.features.musicControl'), false);
  assert.deepEqual(await evaluate('window.notchAPI.capabilities.unavailableHomeModules'), ['music', 'windows']);
  assert.equal(await evaluate('window.notchAPI.getAppSettings().then(s => s.features.clip)'), false);
  assert.equal(await evaluate('document.getElementById("mirror-video").srcObject === null'), true);
  assert.deepEqual(await evaluate('window.NotchHome.getVisibility().visibleIds'), ['pomodoro', 'recorder', 'mirror', 'note', 'commands']);
  assert.equal(await evaluate('window.NotchHome.setModuleVisible("music", true).ok'), false);
  // P4（D16）：WIN_NATIVE_DEFAULT=false，启动时原生能力是关的——「当前窗口」不可用，
  // 错误码取决于是被能力层挡住（unsupported）还是适配层报告原生不可用（native_unavailable）。
  // 展开后再通过设置开关真正加载 koffi 验一次，见下方 setWinNative 往返。
  assert.equal(await evaluate('window.notchAPI.capabilities.features.windowSwitcher'), false);
  assert.equal(await evaluate('window.notchAPI.capabilities.features.automaticPaste'), false);
  assert.equal(await evaluate('window.notchAPI.capabilities.features.winNativeSetting'), true);
  assert.equal(await evaluate('window.notchAPI.getAppSettings().then(s => s.winNative)'), false);
  assert.ok(
    ['unsupported', 'native_unavailable'].includes(await evaluate('window.notchAPI.listWindows().then(r => r.error)')),
    '原生能力关闭时窗口列表必须明确不可用'
  );
  // P1-1：迁移把老用户保存的 left 位置清掉，胶囊回到工作区顶部，拖动重新可用。
  const layoutMetrics = await evaluate('window.notchAPI.getMetrics()');
  assert.equal(layoutMetrics.dockEdge, 'top');
  assert.equal(layoutMetrics.dockAlign, 'center');
  assert.equal(layoutMetrics.collapsedWidth, 85);
  assert.equal(layoutMetrics.collapsedHeight, 9);
  assert.equal(layoutMetrics.menuBarHeight, 0);
  assert.equal(layoutMetrics.dragEnabled, true);
  if (retained) assert.equal(JSON.parse(fs.readFileSync(smokeSettingsPath, 'utf8')).panelPosition, null);
  // P3-1：全新安装默认开自启；升级用户保持原状（fresh 轮末尾把它设成了关）。
  // 必须在下面的 setAutoLaunch(true/false) 往返之前断言。
  assert.equal(await evaluate('window.notchAPI.getAppSettings().then(r => r.autoLaunch)'), !retained);
  assert.ok(fs.existsSync(firstRunMarker), '首启标记必须补写，否则每次启动都会重来一次');
  // 拖动只在收起态可用；拿到后立即结束并复位，免得留下拖动状态或侧边位置。
  assert.equal(await evaluate('window.notchAPI.startPanelDrag()'), true);
  await evaluate('window.notchAPI.endPanelDrag()');
  await evaluate('window.notchAPI.resetPanelPosition()');
  await evaluate('document.getElementById("notch").click()');
  await until(() => evaluate('document.getElementById("app").classList.contains("expanded")'), 'expand');
  assert.equal(await evaluate('window.notchAPI.getMetrics().then(m => m.stripHeight)'), 38);
  // 原生能力关闭时自动粘贴被能力层挡在最前面：只写系统剪贴板，不发任何按键（P4-1）。
  const pasted = await evaluate('window.notchAPI.pasteClipboard({type:"text", text:"Windows smoke copy"})');
  assert.equal(pasted.ok, true);
  assert.equal(pasted.pasted, false);
  // P4-0：安装版必须真的能加载 koffi 并枚举窗口（开关默认关，这里走用户打开开关的同一条 IPC）。
  // 验完立即关回，后续断言与 retained 轮仍按默认关的状态检查。
  const nativeOn = await evaluate('window.notchAPI.setWinNative(true)');
  assert.equal(nativeOn.ok, true);
  assert.equal(nativeOn.nativeAvailable, true, `koffi 必须能在安装版中加载：${nativeOn.nativeReason}`);
  assert.equal(nativeOn.capabilities.features.windowSwitcher, true);
  assert.equal(nativeOn.capabilities.features.windowFocus, true);
  assert.equal(nativeOn.capabilities.features.automaticPaste, true);
  const listed = await evaluate('window.notchAPI.listWindows()');
  assert.equal(listed.error, null);
  assert.ok(Array.isArray(listed.items), '原生能力开启后窗口列表必须是数组');
  const nativeOff = await evaluate('window.notchAPI.setWinNative(false)');
  assert.equal(nativeOff.ok, true);
  assert.equal(nativeOff.capabilities.features.windowSwitcher, false);
  assert.equal(await evaluate('window.notchAPI.listWindows().then(r => r.error)'), 'unsupported');
  assert.equal(await evaluate('window.notchAPI.setAutoLaunch(true).then(r => r.ok)'), true);
  assert.equal(await evaluate('window.notchAPI.getAppSettings().then(r => r.autoLaunch)'), true);
  assert.equal(await evaluate('window.notchAPI.setAutoLaunch(false).then(r => r.ok)'), true);
  assert.equal(await evaluate('window.notchAPI.setPanelShortcut("Control+Shift+F9").then(r => r.ok)'), true);
  assert.equal(await evaluate('window.notchAPI.setPanelShortcut("Space").then(r => r.ok)'), true);
  if (retained) {
    assert.equal(await evaluate('localStorage.getItem("notch-home-note")'), 'Windows retained data');
    assert.equal(await evaluate('window.notchAPI.listCredentials().then(r => r.items.some(i => i.service === "CI smoke"))'), true);
    assert.equal(await evaluate('window.notchAPI.listCredentials().then(async r => (await window.notchAPI.getCredential(r.items.find(i => i.service === "CI smoke").id)).item.password)'), 'test-only-password');
    const recordings = await evaluate('JSON.parse(localStorage.getItem("notch-recordings") || "[]")');
    assert.ok(recordings.some((item) => item.audioPath), 'Saved recording survives reinstall');
    assert.equal(await evaluate('window.notchAPI.readRecording(JSON.parse(localStorage.getItem("notch-recordings"))[0].audioPath).then(r => r.bytes.length > 0)'), true);
  } else {
    const credentials = await evaluate('window.notchAPI.saveCredential({service:"CI smoke",account:"test",password:"test-only-password"})');
    assert.equal(credentials.ok, true);
    assert.equal(await evaluate('window.notchAPI.listCredentials().then(r => r.items.some(i => Object.hasOwn(i, "password")))'), false);
    const vault = fs.readFileSync(path.join(profile, 'credentials.vault.json'), 'utf8');
    assert.ok(!vault.includes('test-only-password'), 'Password is encrypted at rest');
    await evaluate(`(() => {
      window.smokeTracks = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await original(...args); window.smokeTracks.push(...stream.getTracks()); return stream;
      };
      document.getElementById('mirror-stage').click();
    })()`);
    await until(() => evaluate('window.smokeTracks.some(t => t.kind === "video" && t.readyState === "live")'), 'fake camera starts on click');
    await evaluate('document.getElementById("tab-button-todo").click()');
    await until(() => evaluate('window.smokeTracks.every(t => t.readyState === "ended")'), 'camera released leaving home');
    await evaluate('document.getElementById("tab-button-home").click(); document.getElementById("record-start").click()');
    await until(() => evaluate('window.NotchWorkspace.isRecordingActive() && window.smokeTracks.some(t => t.kind === "audio" && t.readyState === "live")'), 'fake recording starts');
    await delay(1500);
    await evaluate('document.getElementById("record-stop").click()');
    await until(() => evaluate('!window.NotchWorkspace.isRecordingActive() && window.smokeTracks.every(t => t.readyState === "ended")'), 'microphone released');
    await until(() => evaluate('JSON.parse(localStorage.getItem("notch-recordings") || "[]").some(r => r.audioPath)'), 'recording persisted');
    assert.ok(fs.readdirSync(path.join(profile, 'recordings')).some((file) => fs.statSync(path.join(profile, 'recordings', file)).size > 0));
    await evaluate('document.getElementById("home-note").value = "Windows retained data"; document.getElementById("home-note").dispatchEvent(new Event("input", {bubbles:true}))');
    await until(() => evaluate('localStorage.getItem("notch-home-note") === "Windows retained data"'), 'note persisted');
    await evaluate('window.notchAPI.saveWorkspaceData(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))');
  }
  const notify = await fetch('http://127.0.0.1:43821/notify/gpt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Windows smoke complete', task_id: `smoke-${Date.now()}` }) });
  assert.equal(notify.ok, true);
  assert.equal((await fetch('http://127.0.0.1:43821/notify/unknown', { method: 'POST' })).status, 404);
  await until(() => evaluate('window.notchAPI.listTaskCompletions().then(r => r.some(i => i.title === "Windows smoke complete"))'), 'notification recorded');
  await evaluate('document.getElementById("tab-button-settings").click()');
  await delay(300);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-settings-home-module]")).filter(i => !i.closest("label").hidden).map(i => i.dataset.settingsHomeModule)'), ['pomodoro', 'recorder', 'mirror', 'note', 'commands']);
  // 「实验功能」这一行只在 Windows 上出现，是用户唯一的原生能力入口（D16）。
  assert.equal(await evaluate('document.getElementById("settings-win-native-row").hidden'), false);
  assert.equal(await evaluate('document.getElementById("settings-win-native").checked'), false);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, retained ? 'retained.png' : 'windows-settings.png'), Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(exceptions, [], 'No uncaught renderer errors');
  // Exercise an ordinary application shutdown, not taskkill /F: Chromium flushes
  // profile preferences (including Windows OS-crypt metadata) during shutdown.
  // Browser.close is Electron's own CDP shutdown path; no testing IPC is shipped.
  const browser = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const shutdown = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { shutdown.once('open', resolve); shutdown.once('error', reject); });
  shutdown.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
  await until(() => child.exitCode !== null, 'normal application exit');
  shutdown.close();
  assert.equal(child.exitCode, 0, 'Application exits cleanly before reinstall/uninstall');
  fs.writeFileSync(path.join(evidence, retained ? 'retained.json' : 'smoke.json'), JSON.stringify({ ok: true, platform: process.platform, retained, profile, checks: ['real startup', 'five Windows home modules', 'IPC', 'native koffi load and window list', 'clipboard copy', 'first-run auto-launch', 'auto-launch', 'shortcuts', 'encrypted credentials', 'fake camera release', 'fake recording release and persistence', 'notifications', 'settings'] }, null, 2));
  console.log(`Windows application smoke passed (${retained ? 'retained profile' : 'fresh profile'})`);
}
main().catch(async (error) => {
  console.error(error);
  console.error('Renderer exceptions:', JSON.stringify(exceptions));
  process.exitCode = 1;
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      console.error('Renderer state:', await evaluate('JSON.stringify({home:!!window.NotchHome,workspace:!!window.NotchWorkspace,api:!!window.notchAPI,ready:document.readyState,storage:Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))})'));
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(evidence, 'failure.png'), Buffer.from(screenshot.data, 'base64'));
    } catch { /* Startup logs remain available even if the renderer has crashed. */ }
  }
}).finally(cleanup);
