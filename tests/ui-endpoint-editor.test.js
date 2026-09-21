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
