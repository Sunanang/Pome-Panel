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

test('retry not_bound is Chinese and is not shown as a raw code', () => {
  assert.equal(
    settingsUi.humanizeSyncError({ ok: false, error: 'not_bound' }, '重试失败'),
    '请先完成配对再同步',
  );
  assert.equal(
    settingsUi.humanizeSyncError({ error: 'binding_incomplete' }, '重试失败'),
    '配对信息不完整，请重新配对',
  );
  assert.equal(settingsUi.humanizeSyncError({ error: 'some_new_code' }, '重试失败'), '重试失败');
  assert.equal(
    settingsUi.humanizeSyncError({ error: 'not_bound', message: 'not_bound' }, '重试失败'),
    '请先完成配对再同步',
  );
  assert.doesNotMatch(
    settingsUi.humanizeSyncError({ ok: false, error: 'not_bound' }, '重试失败'),
    /not_bound/,
  );
  const hangup = settingsUi.humanizeSyncError({ error: 'socket hang up', message: 'socket hang up' }, '配对失败');
  assert.match(hangup, /同步服务没有回应/);
  assert.match(hangup, /http:\/\//);
  assert.doesNotMatch(hangup, /socket hang up/);
  assert.match(
    settingsUi.humanizeSyncError({ error: 'remote_closed' }, '配对失败'),
    /同步服务没有回应/,
  );
  assert.match(
    settingsUi.humanizeSyncError({ code: 'ECONNRESET', message: 'socket hang up' }, '配对失败'),
    /同步服务没有回应/,
  );
  assert.match(
    settingsUi.humanizeSyncError('Empty reply from server', '配对失败'),
    /同步服务没有回应/,
  );
  assert.match(
    settingsUi.humanizeSyncError({ error: 'ECONNREFUSED' }, '配对失败'),
    /连不上同步端口/,
  );
  assert.doesNotMatch(
    settingsUi.humanizeSyncError({ error: 'UND_ERR_SOCKET' }, '配对失败'),
    /UND_ERR_SOCKET/,
  );
  const retryBlock = workspaceJs.slice(
    workspaceJs.indexOf('settingsNasSyncRetry.addEventListener'),
  );
  const retryHead = retryBlock.slice(0, retryBlock.indexOf('if (settingsNasExportBackup)'));
  assert.match(retryHead, /if \(!nasPairUi\.bound\) return;/);
  assert.doesNotMatch(retryHead, /请先完成配对再同步/);
  assert.match(retryHead, /describeNasSyncError\(result, '重试失败'\)/);
  assert.doesNotMatch(retryHead, /setNasStatusHint\(\s*\(?result && result\.error\)/);
});

test('unpaired status hides channel and retry; lost token is one line', () => {
  assert.match(html, />未配对</);
  assert.match(html, /id="settings-nas-status-meta"[^>]*hidden|id="settings-nas-status-meta"[^>]*\shidden/);
  assert.match(html, /id="settings-nas-sync-retry"[^>]*hidden/);
  assert.match(workspaceJs, /settingsNasStatusMeta\.hidden = !bound/);
  assert.match(workspaceJs, /settingsNasSyncRetry\.hidden = !bound/);
  assert.match(workspaceJs, /textContent = '未配对'/);
  assert.match(workspaceJs, /textContent = '已连接'/);
  assert.match(workspaceJs, /本机曾配置同步地址，但设备令牌已丢失，请重新配对/);
  assert.equal(settingsUi.LOST_DEVICE_TOKEN_HINT, '本机曾配置同步地址，但设备令牌已丢失，请重新配对');
  assert.equal(settingsUi.shouldPromptLostDeviceToken({
    bound: false,
    endpoints: [{ baseUrl: 'http://nas:1' }],
  }), true);
  assert.equal(settingsUi.shouldPromptLostDeviceToken({
    bound: false,
    lastSuccessAt: 1700000000000,
    endpoints: [],
  }), false);
  assert.equal(settingsUi.shouldPromptLostDeviceToken({
    bound: true,
    endpoints: [{ serverId: 'srv' }],
  }), false);
  assert.equal(settingsUi.shouldPromptLostDeviceToken({
    bound: false,
    schemaIncompatible: true,
    endpoints: [{ serverId: 'srv' }],
  }), false);
  assert.match(css, /#settings-nas-sync-retry\[hidden\]/);
  assert.match(css, /\.settings-nas-status-meta\[hidden\]/);
});

test('successful pairing opens sync options once; the sync button can open them again', () => {
  assert.match(html, /id="settings-nas-sync-open"[^>]*hidden>同步</);
  assert.match(html, /id="settings-nas-sync-options"/);
  assert.match(html, /id="settings-nas-sync-options-start"/);
  assert.match(workspaceJs, /function openNasSyncOptions\(\)/);
  const successAt = workspaceJs.indexOf("setNasSyncHint('配对成功', 'success')");
  assert.ok(successAt > 0);
  const successTail = workspaceJs.slice(successAt, successAt + 280);
  assert.match(successTail, /openNasSyncOptions\(\)/);
  assert.doesNotMatch(successTail, /startNasMigration|syncRetry/);
  assert.match(workspaceJs, /settingsNasSyncOpen\.addEventListener/);
  assert.match(workspaceJs, /settingsNasSyncOptionsStart\.addEventListener/);
});

test('retry API wiring exists in workspace + preload', () => {
  assert.match(workspaceJs, /syncRetry/);
  assert.match(workspaceJs, /settings-nas-sync-retry/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /syncRetry/);
  assert.match(preload, /syncGetDashboard/);
});

test('S5: NAS HTTP toggle has prefers-reduced-motion degrade path', () => {
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.settings-nas-http-toggle/);
  assert.match(css, /\.settings-nas-http-toggle input:focus-visible \+ i[\s\S]*?var\(--focus-ring\)/);
});

test('hydrate carries schema incompatible fields for T7 status', () => {
  let state = settingsUi.initialSettingsUiState();
  state = settingsUi.reduceSettingsUi(state, {
    type: 'hydrate',
    uiState: 'schema_incompatible',
    uiLabel: '协议不兼容',
    schemaIncompatible: true,
    schemaUpgradeTarget: 'desktop',
    schemaMessage: '请升级桌面端',
  });
  assert.equal(state.schemaIncompatible, true);
  assert.equal(state.schemaUpgradeTarget, 'desktop');
  assert.equal(state.schemaMessage, '请升级桌面端');
});
