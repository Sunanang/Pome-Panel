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
    { mainWindow: { isDestroyed: () => false, isVisible: () => true } }, { mainWindow: null }]) {
    const h = harness(overrides); h.context.recoverStartupPanelVisibility(); assert.deepEqual(h.events, []);
  }
});

const services = source.slice(source.indexOf('  // An explicit test profile'), source.indexOf('  watchDisplayChanges();', source.indexOf('app.whenReady().then')));
function start({ profile = '', notifications = '', permissionError = false } = {}) {
  const events = [];
  const context = {
    process: { env: { TODO_TEST_USER_DATA: profile, POME_TEST_NOTIFICATIONS: notifications } },
    app: { isPackaged: true },
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
    const context = { process: { platform },
      mainWindow: { setAlwaysOnTop: (...args) => { panel = args; } },
      notificationWindow: { setAlwaysOnTop: (...args) => { notification = args; } } };
    vm.createContext(context);
    vm.runInContext(source.match(/mainWindow\.setAlwaysOnTop\(true,[^;]+;/)[0], context);
    vm.runInContext(source.match(/notificationWindow\.setAlwaysOnTop\(true,[^;]+;/)[0], context);
    assert.equal(notification[1], panel[1]); assert.equal(notification[2], 1);
  }
});
