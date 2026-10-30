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
    app: { isPackaged: true }, isQuitting: false,
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
  assert.deepEqual(events, ['notify', 'tray', 'permissions', 'error', 'recover']);
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
