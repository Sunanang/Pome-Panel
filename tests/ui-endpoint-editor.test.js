'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const settingsUi = require('../renderer/nas-sync-settings.js');

test('A.2 endpoint editor controls exist (S3)', () => {
  assert.match(html, /data-control-id="endpoint\.add"/);
  assert.match(html, /data-control-id="endpoint\.baseUrl"/);
  assert.match(html, /data-control-id="endpoint\.kind-device-port"/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-endpoint-add"|id="settings-nas-endpoint-add"[^>]*workspace-button/);
  assert.match(html, /option value="device-port"/);
  assert.match(css, /\.settings-nas-endpoint-list/);
  assert.match(css, /var\(--r-tile/);
  assert.match(css, /var\(--r-input/);
  assert.doesNotMatch(css, /\.settings-nas-endpoint[^{]*\{[^}]*\b(?:Inter|Roboto|Arial)\b/);
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

test('workspace wires edit/delete/enable/reorder/test-connection', () => {
  assert.match(workspaceJs, /data-nas-test/);
  assert.match(workspaceJs, /data-nas-delete/);
  assert.match(workspaceJs, /data-nas-enable/);
  assert.match(workspaceJs, /data-nas-reorder/);
  assert.match(workspaceJs, /syncTestEndpoint/);
  assert.match(workspaceJs, /syncDeleteEndpoint/);
  assert.match(workspaceJs, /syncReorderEndpoint/);
  assert.match(workspaceJs, /disabled_by_policy/);
  assert.match(workspaceJs, /endpoint\.test-connection/);
  assert.doesNotMatch(workspaceJs, /require\(['"]electron['"]\)/);
});

test('device-port shares same list UI — no second skin (S6)', () => {
  assert.match(workspaceJs, /kindLabel/);
  assert.match(workspaceJs, /device-port/);
  assert.match(html, /settings-nas-endpoint-list/);
  // Single list container; no alternate device-port-only card
  assert.doesNotMatch(html, /settings-nas-device-port-card/);
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

test('A.2 endpoint.enable / HTTP toggle disable paths wired', async () => {
  assert.match(workspaceJs, /data-nas-enable/);
  assert.match(workspaceJs, /syncUpdateEndpoint/);
  const toggled = await settingsUi.runToggleHttp({
    endpointId: 'e1',
    enable: true,
    httpConfirmAccepted: true,
    api: {
      syncUpdateEndpoint: async (payload) => {
        assert.equal(payload.allowInsecureHttp, true);
        assert.equal(payload.httpConfirmAccepted, true);
        return { ok: true };
      },
    },
  });
  assert.equal(toggled.ok, true);
});
