'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const settingsUi = require('../renderer/nas-sync-settings.js');

test('A.1 settings.nas-sync.tab lives in #tab-settings settings-card (S3/S4)', () => {
  assert.match(html, /id="tab-settings"/);
  assert.match(html, /data-control-id="settings\.nas-sync\.tab"/);
  assert.match(html, /class="tile settings-card settings-nas-sync-card"/);
  assert.match(html, /id="settings-nas-sync-card"/);
  assert.match(html, /nas-sync-settings\.js/);
  assert.match(html, /settings-page/);
});

test('A.1 status-bar / retry / http-warning controls present with style tokens (S1/S3)', () => {
  assert.match(html, /data-control-id="settings\.nas-sync\.status-bar"/);
  assert.match(html, /data-control-id="settings\.nas-sync\.retry"/);
  assert.match(html, /data-control-id="settings\.nas-sync\.http-warning"/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-sync-retry"|id="settings-nas-sync-retry"[^>]*workspace-button/);
  assert.match(css, /\.settings-nas-status-meta/);
  assert.match(css, /var\(--text-2\)/);
  assert.match(css, /var\(--accent-orange\)/);
  const nasCard = html.match(/settings-nas-sync-card[\s\S]*?settings-nas-dialog-root/)?.[0] || '';
  assert.doesNotMatch(nasCard, /style\s*=\s*"[^"]*(?:color|background)\s*:/i);
});

test('status reducer maps hydrate fields', () => {
  let state = settingsUi.initialSettingsUiState();
  state = settingsUi.reduceSettingsUi(state, {
    type: 'hydrate',
    view: {
      insecureHttpWarning: true,
      devicePortGuidance: '引导',
      currentEndpoint: { baseUrl: 'https://nas/app' },
      lastSuccessAt: 1700000000000,
    },
    outboxCount: 3,
    uiState: 'offline_pending',
    uiLabel: '离线待传',
    channelLabel: 'https://nas/app',
  });
  assert.equal(state.outboxCount, 3);
  assert.equal(state.insecureWarningVisible, true);
  assert.equal(state.devicePortGuidanceVisible, true);
  assert.equal(state.uiLabel, '离线待传');
});

test('retry API wiring exists in workspace + preload', () => {
  assert.match(workspaceJs, /syncRetry/);
  assert.match(workspaceJs, /settings-nas-sync-retry/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /syncRetry/);
  assert.match(preload, /syncGetDashboard/);
});
