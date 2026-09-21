'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const settingsUi = require('../renderer/nas-sync-settings.js');
const {
  applyAllowInsecureHttpToggle,
  endpointHttpPolicy,
  shouldShowInsecureHttpWarning,
} = require('../packages/sync-protocol/endpoints');

test('A.3 HTTP toggle markup + confirm dialog roles (S3)', () => {
  assert.match(html, /data-control-id="settings\.nas-sync\.http-warning"/);
  assert.match(html, /id="settings-nas-dialog"[^>]*role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(css, /\.settings-nas-http-toggle/);
  assert.match(css, /settings-feature-grid/);
  assert.match(css, /var\(--focus-ring\)/);
  assert.match(css, /var\(--accent-orange\)/);
  assert.match(workspaceJs, /data-nas-http-toggle/);
  assert.match(workspaceJs, /buildHttpConfirmDialog/);
  assert.match(workspaceJs, /允许明文 HTTP/);
});

test('HTTP confirm dialog copy mentions eavesdrop/tamper risk', () => {
  const dialog = settingsUi.buildHttpConfirmDialog();
  assert.equal(dialog.role, 'dialog');
  assert.equal(dialog.controlId, 'endpoint.allowInsecureHttp.confirm');
  assert.match(dialog.body, /窃听|篡改/);
});

test('toggle open requires confirm; cancel keeps off; close → disabledByPolicy', () => {
  const ep = {
    endpointId: 'e1',
    baseUrl: 'http://192.168.1.9/app',
    allowInsecureHttp: false,
    enabled: true,
    disabledByPolicy: false,
  };
  const blocked = applyAllowInsecureHttpToggle(ep, true, { confirmed: false });
  assert.equal(blocked.error, 'http_confirm_required');

  const on = applyAllowInsecureHttpToggle(ep, true, { confirmed: true });
  assert.equal(on.endpoint.allowInsecureHttp, true);

  const off = applyAllowInsecureHttpToggle(on.endpoint, false);
  assert.equal(off.endpoint.disabledByPolicy, true);
  assert.equal(off.rewrittenToHttps, false);
});

test('loopback exempt from switch + warning', () => {
  const policy = endpointHttpPolicy({ baseUrl: 'http://localhost:8080/sync' });
  assert.equal(policy.allowed, true);
  assert.equal(policy.exemptLoopback, true);
  assert.equal(
    shouldShowInsecureHttpWarning([
      { baseUrl: 'http://127.0.0.1:9/app', enabled: true, allowInsecureHttp: false },
    ]),
    false,
  );
});

test('persistent warning visible only when insecure HTTP enabled', () => {
  let state = settingsUi.initialSettingsUiState();
  state = settingsUi.reduceSettingsUi(state, {
    type: 'hydrate',
    view: { insecureHttpWarning: true },
  });
  assert.equal(state.insecureWarningVisible, true);
  state = settingsUi.reduceSettingsUi(state, {
    type: 'hydrate',
    view: { insecureHttpWarning: false },
  });
  assert.equal(state.insecureWarningVisible, false);
  assert.match(html, /id="settings-nas-http-warning"/);
});
