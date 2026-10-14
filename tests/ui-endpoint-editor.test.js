'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const settingsUi = require('../renderer/nas-sync-settings.js');

test('backup address is a single optional input inside advanced, with no endpoint list', () => {
  assert.match(html, /id="settings-nas-advanced"/);
  assert.match(html, /aria-label="备用外网地址"/);
  assert.match(html, /data-control-id="endpoint\.baseUrl"/);
  assert.match(html, /id="settings-nas-endpoint-add"/);
  assert.doesNotMatch(html, /settings-nas-endpoint-list|添加 endpoint|option value="device-port"/);
  assert.match(css, /\.settings-nas-disclosure/);
});

test('endpoint.baseUrl validation: empty / illegal / legal', () => {
  assert.equal(settingsUi.validateBaseUrlDraft('').ok, false);
  assert.equal(settingsUi.validateBaseUrlDraft('not-a-url').ok, false);
  assert.equal(settingsUi.validateBaseUrlDraft('https://user:x@host/app').ok, false);
  assert.equal(settingsUi.validateBaseUrlDraft('https://nas.local/app?x=1').ok, false);
  assert.equal(settingsUi.validateBaseUrlDraft('https://nas.local/app/pome-panel-sync').ok, true);
});

test('endpoint.add success / failure via mocked API', async () => {
  const ok = await settingsUi.runAddEndpoint({
    baseUrl: 'https://nas.local/app',
    kind: 'gateway',
    api: {
      syncAddEndpoint: async (payload) => ({ ok: true, endpoint: { ...payload, endpointId: 'e1' } }),
    },
  });
  assert.equal(ok.ok, true);

  const bad = await settingsUi.runAddEndpoint({
    baseUrl: '',
    api: { syncAddEndpoint: async () => ({ ok: true }) },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'empty');
});

test('backup save preserves endpoint update/delete and HTTP policy APIs, removes list controls', () => {
  assert.match(workspaceJs, /syncUpdateEndpoint/);
  assert.match(workspaceJs, /syncDeleteEndpoint/);
  assert.match(workspaceJs, /runToggleHttp/);
  assert.doesNotMatch(workspaceJs, /data-nas-test|data-nas-reorder|data-nas-enable/);
  assert.doesNotMatch(workspaceJs, /require\(['"]electron['"]\)/);
});

test('A.2 endpoint.delete confirm/cancel dialog dimensions (S3)', () => {
  const dialog = settingsUi.buildDeleteConfirmDialog({
    endpointId: 'e-del',
    baseUrl: 'https://nas.local/app',
  });
  assert.equal(dialog.role, 'dialog');
  assert.equal(dialog.controlId, settingsUi.DELETE_CONFIRM_CONTROL_ID);
  assert.match(dialog.body, /确认删除/);
  assert.equal(dialog.confirmLabel, '删除');
  assert.equal(dialog.cancelLabel, '取消');
  assert.match(workspaceJs, /buildDeleteConfirmDialog|openNasDialog/);
  assert.match(workspaceJs, /syncDeleteEndpoint/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test('A.2 endpoint.test-connection success / failure via mocked API', async () => {
  const ok = await settingsUi.runTestConnection({
    endpointId: 'e1',
    api: { syncTestEndpoint: async () => ({ ok: true, serverId: 'srv' }) },
  });
  assert.equal(ok.ok, true);

  const bad = await settingsUi.runTestConnection({
    endpointId: 'e1',
    api: { syncTestEndpoint: async () => ({ ok: false, error: 'timeout' }) },
  });
  assert.equal(bad.ok, false);

  const missing = await settingsUi.runTestConnection({ endpointId: 'e1', api: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'api_unavailable');
});

test('HTTP toggle disable and explicit confirmation paths remain wired in the merged card', () => {
  assert.match(workspaceJs, /data-nas-http-toggle/);
  assert.match(workspaceJs, /buildHttpConfirmDialog/);
  assert.match(workspaceJs, /httpConfirmAccepted: enable/);
  assert.match(workspaceJs, /target.checked = false/);
});

test('backup address feedback remains separate from pair feedback inside the same card', () => {
  assert.match(html, /id="settings-nas-sync-hint"/);
  assert.match(html, /id="settings-nas-endpoint-hint"/);
  const start = workspaceJs.indexOf('async function addNasEndpoint()');
  const save = workspaceJs.slice(start, workspaceJs.indexOf('if (settingsNasEndpointAdd)', start));
  assert.match(save, /setNasEndpointHint/);
  assert.doesNotMatch(save, /setNasSyncHint/);
});
