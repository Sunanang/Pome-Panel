'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const recovery = source.slice(source.indexOf('function recoverStartupPanelVisibility()'), source.indexOf('function hideWindowAfterCollapse()'));

function harness(overrides = {}) {
  const events = [];
  const context = {
    mainWindow: { isDestroyed: () => false, isVisible: () => false,
      showInactive: () => events.push('show-inactive'), focus: () => events.push('focus') },
    isQuitting: false, startupRecoveryDismissed: false, mediaPermissionRequests: 0,
    process: { env: {} }, applyMainWindowLayer: () => events.push('layer'), ...overrides,
  };
  vm.createContext(context); vm.runInContext(recovery, context);
  return { context, events };
}

test('startup recovery shows an ordered-out capsule without stealing typing focus', () => {
  const h = harness(); h.context.recoverStartupPanelVisibility();
  assert.deepEqual(h.events, ['show-inactive', 'layer']);
});

test('startup recovery respects an explicit hide, test isolation, permission prompts and shutdown', () => {
  for (const overrides of [{ startupRecoveryDismissed: true }, { isQuitting: true },
    { mediaPermissionRequests: 1 }, { process: { env: { TODO_TEST_USER_DATA: '/fixture/profile' } } },
    { mainWindow: null }]) {
    const h = harness(overrides); h.context.recoverStartupPanelVisibility(); assert.deepEqual(h.events, []);
  }
});

test('a visible-but-ordered-out capsule is reordered without stealing focus', () => {
 const h=harness();h.context.mainWindow.isVisible=()=>true;
 h.context.recoverStartupPanelVisibility();assert.deepEqual(h.events,['show-inactive','layer']);
});

const servicesStart = source.indexOf('  const testUserData = Boolean(process.env.TODO_TEST_USER_DATA);', source.indexOf('app.whenReady().then'));
assert.notEqual(servicesStart, -1, 'whenReady desktop-chrome boot block must exist');
const services = source.slice(servicesStart, source.indexOf('  watchDisplayChanges();', servicesStart));
function start({ profile = '', notifications = '', permissionError = false } = {}) {
  const events = [];
  const context = {
    process: { env: { TODO_TEST_USER_DATA: profile, POME_PACKAGED_TEST_MODE: '1', POME_TEST_NOTIFICATIONS: notifications } },
    app: { isPackaged: true, on: () => {} }, isQuitting: false,
    readAppSettings: () => ({ autoMeetingMode: true }),
    meetingMonitor: { setEnabled: () => {}, start: () => events.push('meeting-monitor') },
    startTaskNotificationServer: () => events.push('notify'), createTray: () => events.push('tray'),
    setImmediate: fn => fn(), promptForMissingPermissions: async () => {
      events.push('permissions'); if (permissionError) throw Error('fixture');
    },
    recoverStartupPanelVisibility: () => events.push('recover'),
    getManusCompletionService: () => ({ status: () => ({ enabled: false }) }),
    console: { error: () => events.push('error') },
  };
  vm.createContext(context); vm.runInContext(services, context);
  return events;
}

test('packaged test profiles do not enable real desktop services or permission prompts', () => {
  assert.deepEqual(start({ profile: '/fixture/profile' }), []);
  assert.deepEqual(start({ profile: '/fixture/profile', notifications: '1' }), ['notify']);
});

test('permission self-check failure is handled and keeps startup recovery available', async () => {
  const events = start({ permissionError: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['notify', 'tray', 'permissions', 'meeting-monitor', 'error', 'recover']);
});

test('notifications remain one level above the panel on both desktop platforms', () => {
  for (const platform of ['darwin', 'win32']) {
    let panel, notification;
    const context = { process: { platform }, platformPolicy:require('../platform'),
      mainWindow: { setAlwaysOnTop: (...args) => { panel = args; } },
      notificationWindow: { setAlwaysOnTop: (...args) => { notification = args; } } };
    vm.createContext(context);
    vm.runInContext(source.match(/mainWindow\.setAlwaysOnTop\(true,[^;]+;/)[0], context);
    vm.runInContext(source.match(/const notificationLayer = [^;]+;/)[0]+'\n'+source.match(/notificationWindow\.setAlwaysOnTop\(true,[^;]+;/)[0], context);
    assert.equal(notification[1], panel[1]); assert.equal(notification[2], 1);
  }
});

test('macOS yields only the editing panel layer to IME candidates', () => {
  const { windowLayer } = require('../platform');
  assert.equal(windowLayer('darwin').level, 'status');
  assert.equal(windowLayer('darwin', { typingFocus: true }).level, 'floating');
  assert.deepEqual(windowLayer('darwin', { notification: true, typingFocus: true }), { level: 'status', relativeLevel: 1 });
  assert.equal(windowLayer('win32', { typingFocus: true }).level, 'floating');
});

test('layer reapplication respects editing, collapse and active system prompts', () => {
  const layers = [];
  const scope = vm.createContext({ platformPolicy: require('../platform'), process: { platform: 'darwin' },
    currentMode: 'expanded', typingFocusActive: true, mediaPermissionRequests: 0,
    mainWindow: { isDestroyed: () => false, setAlwaysOnTop: (...args) => layers.push(args), setVibrancy() {} } });
  vm.runInContext(source.slice(source.indexOf('function applyMainWindowLayer()'), source.indexOf("ipcMain.handle('window:set-typing-focus'")), scope);
  scope.applyMainWindowLayer();
  assert.deepEqual(layers.at(-1), [true, 'floating']);
  scope.currentMode = 'collapsed'; scope.applyMainWindowLayer();
  assert.deepEqual(layers.at(-1), [true, 'status']);
  scope.currentMode = 'expanded'; scope.typingFocusActive = false; scope.applyMainWindowLayer();
  assert.deepEqual(layers.at(-1), [true, 'status']);
  scope.mediaPermissionRequests = 1; scope.applyMainWindowLayer();
  assert.equal(layers.length, 3);
});

test('typing focus IPC accepts only the live panel main frame', () => {
  let handler, updates = 0;
  const contents = { mainFrame: {} };
  const scope = vm.createContext({ ipcMain: { handle: (_channel, fn) => { handler = fn; } },
    mainWindow: { isDestroyed: () => false, webContents: contents }, typingFocusActive: false,
    cameraBlurDeferred: false, applyMainWindowLayer: () => updates++ });
  vm.runInContext(source.slice(source.indexOf("ipcMain.handle('window:set-typing-focus'"), source.indexOf("ipcMain.handle('settings:get'")), scope);
  assert.equal(handler({ sender: {}, senderFrame: contents.mainFrame }, true), false);
  assert.equal(handler({ sender: contents, senderFrame: {} }, true), false);
  assert.equal(updates, 0);
  assert.equal(handler({ sender: contents, senderFrame: contents.mainFrame }, true), true);
  assert.equal(updates, 1);
});
