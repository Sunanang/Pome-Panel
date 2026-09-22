'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const pairUi = require('../renderer/nas-sync-pair.js');
const fnosUi = fs.readFileSync(path.join(__dirname, '..', 'fnos', 'app', 'ui', 'index.html'), 'utf8');
const fnosCss = fs.readFileSync(path.join(__dirname, '..', 'fnos', 'app', 'ui', 'styles.css'), 'utf8');

test('desktop settings do not show the paired-device list', () => {
  assert.doesNotMatch(html, /id="settings-nas-devices"/);
  assert.doesNotMatch(html, /已配对设备/);
  assert.doesNotMatch(html, /data-control-id="devices\.list"/);
  assert.doesNotMatch(workspaceJs, /syncListDevices/);
  assert.doesNotMatch(workspaceJs, /syncRevokeDevice/);
  assert.match(fnosUi, /data-control-id="fnos.devices.list"/);
  assert.match(fnosUi, /生成配对码/);
});

test('A.6 devices.revoke stays on the NAS web UI', () => {
  assert.match(fnosUi, /device-list/);
  assert.match(fnosCss, /\.settings-nas-device-badge|\.badge-insecure/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /workspace-button/);
});

test('devices reducer lists insecureBound rows', () => {
  let state = pairUi.initialPairUiState();
  state = pairUi.reducePairUi(state, {
    type: 'devices',
    devices: [
      { deviceId: 'd1', name: 'Desk', insecureBound: true },
      { deviceId: 'd2', name: 'Safe', insecureBound: false },
    ],
  });
  assert.equal(state.devices.length, 2);
  assert.equal(state.devices[0].insecureBound, true);
});

test('FPK web device list keeps desktop semantic tokens (S7)', () => {
  assert.match(fnosUi, /device-list/);
  assert.match(fnosUi, /生成配对码/);
  assert.match(fnosCss, /--bg-base:\s*#000000/);
  assert.match(fnosCss, /--accent-orange/);
  assert.match(fnosCss, /\.settings-nas-device-badge|\.badge-insecure/);
  assert.doesNotMatch(fnosCss, /linear-gradient\(\s*[^)]*(?:purple|indigo|#7c3aed)/i);
});

test('preload exposes sync device IPC without rendering electron', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /syncListDevices/);
  assert.match(preload, /syncRevokeDevice/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '..', 'renderer', 'nas-sync-pair.js'), 'utf8'),
    /require\(['"]electron['"]\)/,
  );
});
