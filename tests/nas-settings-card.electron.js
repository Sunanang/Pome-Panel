'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { app, ipcMain, dialog } = require('electron');
const { syncPairHttpPolicy } = require('../main-services');
const { syncUiStateLabel } = require('../packages/sync-protocol/endpoints');
app.commandLine.appendSwitch('user-data-dir', process.env.TODO_TEST_USER_DATA);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS = '1';
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const adapters = require('../platform-adapters'), originalAdapter = adapters.loadAdapter;
adapters.loadAdapter = (...args) => { const adapter = originalAdapter(...args); adapter.windows.list = async () => ({ items: [], error: null }); return adapter; };
const primary = { endpointId: 'main', baseUrl: 'https://nas.example/sync', kind: 'gateway', priority: 0, enabled: true };
const backup = { endpointId: 'backup', baseUrl: 'https://outside.example/sync', kind: 'frp', priority: 1, enabled: true };
let credentials = { bound: false, baseUrl: null, recovery: { paused: false } };
let settings = { endpoints: [], lastSuccessAt: null }, uiState = 'unbound', contents = {}, schemaMessage = null;
let pairFailure = null, retryFailure = null, confirmation = 0;
const claims = [], updates = [], additions = [], confirmations = [], recoveryCalls = [];
dialog.showMessageBox = async (...args) => { confirmations.push(args.at(-1)); return { response: confirmation }; };
const handlers = {
  'sync:get-status': () => ({ ...credentials, schemaIncompatible: uiState === 'schema_incompatible', schemaMessage }),
  'sync:get-dashboard': () => ({ ok: true, credentials: handlers['sync:get-status'](), settings,
    uiState, uiLabel: syncUiStateLabel(uiState), recovery: credentials.recovery, contentResults: contents,
    outboxCount: 2, schemaIncompatible: uiState === 'schema_incompatible', schemaMessage }),
  'sync:pair-http-policy': (_event, url) => syncPairHttpPolicy(url),
  'sync:pair-claim': (_event, payload) => {
    claims.push(payload);
    if (pairFailure) return pairFailure;
    credentials = { bound: true, baseUrl: payload.baseUrl, insecureBound: payload.allowInsecureHttp, recovery: { paused: false } };
    settings = { endpoints: [{ ...primary, baseUrl: payload.baseUrl, allowInsecureHttp: payload.allowInsecureHttp }], insecureHttpWarning: payload.allowInsecureHttp };
    uiState = 'synced'; return { ok: true, status: credentials };
  },
  'sync:clear-binding': () => { credentials = { bound: false, baseUrl: null, recovery: { paused: false } }; uiState = 'unbound'; return { ok: true }; },
  'sync:retry': () => retryFailure || { ok: true },
  'sync:add-endpoint': (_event, payload) => {
    additions.push(payload); const endpoint = { ...payload, endpointId: 'new-backup', allowInsecureHttp: false };
    settings.endpoints.push(endpoint); return { ok: true, endpoint };
  },
  'sync:update-endpoint': (_event, payload) => {
    updates.push(payload); const endpoint = settings.endpoints.find(row => row.endpointId === payload.endpointId); Object.assign(endpoint, payload);
    settings.insecureHttpWarning = settings.endpoints.some(row => row.allowInsecureHttp); return { ok: true, endpoint };
  },
  'recovery:preview': () => { recoveryCalls.push('preview'); return { ok: true, previewId: 'preview', adds: [], updates: [], deletes: [] }; },
  'recovery:execute': () => { recoveryCalls.push('execute'); credentials.recovery = { paused: false, completedAt: Date.now(), operationId: 'operation' }; return { ok: true }; },
  'recovery:rollback': () => { recoveryCalls.push('rollback'); credentials.recovery.paused = true; return { ok: true }; },
};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, handlers[channel] || handler);
const errors = [], artifacts = path.join(__dirname, '../dist.noindex/nas-settings-card'); fs.mkdirSync(artifacts, { recursive: true });
let started = false;
const watchdog = setTimeout(() => { console.error('NAS settings card timed out', errors); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, c) => {
  c.on('console-message', details => { if (details.level === 'error' && !details.message.includes('ERR_')) errors.push(details.message); });
  c.once('did-finish-load', () => {
    if (started || !c.getURL().endsWith('/renderer/index.html')) return; started = true;
    run(c).then(() => { clearTimeout(watchdog); console.log('Merged NAS card: placement, independent timestamps, unbound/lost-token/recovery, timeout, pair code, HTTP, certificate, schema and migration UI passed'); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run(c) {
  const js = code => c.executeJavaScript(code), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(expression) { for (let i = 0; i < 300; i++) { if (await js(expression).catch(() => false)) return; await sleep(20); } throw new Error('Timeout: ' + expression); }
  async function emit(label) { c.send('sync:status', handlers['sync:get-status']()); await until(`document.getElementById('settings-nas-sync-status').textContent==='${label}'`); await sleep(50); }
  async function capture(name) { await js(`document.getElementById('settings-nas-sync-card').scrollIntoView({block:'start'})`); await sleep(300); fs.writeFileSync(path.join(artifacts, name + '.png'), (await c.capturePage()).toPNG()); }
  await until('!!window.NotchWorkspace'); await js(`setMode(true)`); await sleep(650); await js(`setActiveTab('settings')`);
  await until(`document.getElementById('settings-nas-content-results').children.length===10`);
  const placement = await js(`(()=>({left:!!document.querySelector('.settings-column-primary #settings-nas-sync-card'),right:!!document.querySelector('.settings-column-secondary #settings-nas-sync-card'),cards:document.querySelectorAll('#settings-nas-sync-card').length,last:document.getElementById('settings-nas-sync-card').nextElementSibling===null,before:document.getElementById('settings-nas-sync-card').previousElementSibling.classList.contains('settings-display-card')}))()`);
  assert.deepEqual(placement, { left: false, right: true, cards: 1, last: true, before: true });
  assert.equal(await js(`document.getElementById('settings-nas-advanced').open || document.getElementById('settings-nas-details').open`), false);
  assert.equal(await js(`document.getElementById('settings-nas-sync-open').disabled`), true);
  await capture('unpaired');
  await js(`document.getElementById('settings-nas-sync-base-url').value='https://nas.example/sync';document.getElementById('settings-nas-pair-submit').click()`);
  await until(`!document.getElementById('ui-error-bar').hidden && document.querySelector('#ui-error-details pre').textContent.includes('请输入配对码')`);
  assert.equal(await js(`document.getElementById('settings-nas-sync-hint').textContent`),'');
  pairFailure = { ok: false, error: 'code_expired' };
  await js(`document.getElementById('settings-nas-pair-code').value='123456';document.getElementById('settings-nas-pair-submit').click()`);
  await until(`!document.getElementById('ui-error-bar').hidden && document.querySelector('#ui-error-details pre').textContent.includes('配对码已过期')`);
  pairFailure = null;
  await js(`document.getElementById('settings-nas-pair-submit').click()`);
  await until(`!document.getElementById('settings-nas-sync-options').hidden`);
  await js(`document.getElementById('settings-nas-sync-options-cancel').click()`);
  credentials = { bound: true, baseUrl: primary.baseUrl, recovery: { paused: false } };
  settings = { endpoints: [primary, backup], currentEndpointId: backup.endpointId, currentEndpoint: backup, lastSuccessAt: 1700007200000 };
  contents = Object.fromEntries(['待办', '笔记', '链接', '常用指令', '剪贴板', 'AI 完成', '录音元数据', '录音音频', 'AI 配置', '密钥'].map((name, index) => [name, { message: '上次同步已确认', at: 1700000000000 + index * 3600000 }]));
  await emit('已同步');
  await until(`document.querySelector('[data-content-type="待办"] time').dateTime==='${new Date(contents.待办.at).toISOString()}'`);
  assert.equal(await js(`document.getElementById('settings-nas-sync-base-url').value`), primary.baseUrl);
  assert.equal(await js(`document.getElementById('settings-nas-endpoint-url').value`), backup.baseUrl);
  assert.equal(await js(`document.getElementById('settings-nas-pair-fields').hidden`), true);
  assert.notEqual(await js(`document.querySelector('[data-content-type="待办"] time').textContent`), await js(`document.querySelector('[data-content-type="笔记"] time').textContent`));
  assert.equal(await js(`Array.from(document.querySelectorAll('.settings-nas-content-row time')).every(time => Boolean(time.dateTime))`), true);
  await capture('paired');
  await js(`document.getElementById('settings-nas-details').open=true`); await capture('details');
  contents.录音音频 = { message: '尚未确认全部音频传输' };
  await emit('已同步');
  assert.equal(await js(`document.querySelector('[data-content-type="录音音频"] time').textContent`), '· —');
  await js(`document.getElementById('settings-nas-details').open=false`);
  credentials.recovery = { paused: true, completedAt: 1, operationId: 'operation' };
  await emit('同步已暂停');
  assert.equal(await js(`document.getElementById('settings-nas-recovery').hidden || document.getElementById('settings-nas-recovery').disabled || document.getElementById('settings-nas-rollback').hidden`), false);
  assert.equal(await js(`document.getElementById('settings-nas-secret-hint').hidden`), false);
  await capture('paused');
  confirmation = 0;
  await js(`document.getElementById('settings-nas-recovery').click()`); await until(`document.getElementById('settings-nas-sync-status').textContent==='同步已暂停'`); await sleep(100);
  await until(`document.getElementById('ui-data-confirm').open`);
  assert.equal(await js(`document.getElementById('ui-data-confirm-details').open`),false);
  assert.match(await js(`document.querySelector('#ui-data-confirm-details pre').textContent`),/密钥和 AI 配置保留/);
  await capture('overwrite-summary');
  await js(`document.querySelector('#ui-data-confirm button').click()`);
  assert.deepEqual(recoveryCalls, ['preview']);
  confirmation = 1;
  await js(`document.getElementById('settings-nas-recovery').click()`); await until(`document.getElementById('ui-data-confirm').open`); await js(`document.querySelector('#ui-data-confirm button.primary').click()`); await until(`document.getElementById('settings-nas-recovery').hidden`);
  assert.deepEqual(recoveryCalls, ['preview', 'preview', 'execute']);
  await js(`document.getElementById('settings-nas-rollback').click()`); await until(`document.getElementById('ui-data-confirm').open`); await js(`document.querySelector('#ui-data-confirm button.primary').click()`); await until(`document.getElementById('settings-nas-sync-status').textContent==='同步已暂停'`);
  assert.equal(recoveryCalls.at(-1), 'rollback');
  credentials.recovery = { paused: false }; retryFailure = { ok: false, error: 'timeout' };
  await emit('已同步'); await js(`document.getElementById('settings-nas-details').open=true;document.getElementById('settings-nas-sync-retry').click()`);
  await until(`document.getElementById('settings-nas-status-hint').textContent.includes('连接超时')`); await sleep(100);
  assert(await js(`document.getElementById('settings-nas-status-hint').textContent.includes('设备同步端口')`));
  await js(`document.getElementById('settings-nas-details').open=false`); await capture('timeout');
  credentials = { bound: false, baseUrl: null, recovery: { paused: false } }; uiState = 'unbound';
  await emit('出错');
  await until(`document.getElementById('settings-nas-status-hint').textContent.includes('设备令牌已丢失')`);
  assert.equal(await js(`document.getElementById('settings-nas-pair-submit').textContent`), '重新配对');
  assert.equal(await js(`document.getElementById('settings-nas-sync-open').disabled`), true); await capture('lost-token');
  settings = { endpoints: [] }; await emit('未配对');
  await js(`document.getElementById('settings-nas-sync-base-url').value='http://192.0.2.5:31880';document.getElementById('settings-nas-pair-code').value='123456'`);
  const before = claims.length;
  await js(`document.getElementById('settings-nas-pair-submit').click()`);
  await until(`!document.getElementById('settings-nas-dialog-root').hidden`);
  assert.equal(await js(`document.getElementById('settings-nas-dialog-title').textContent`), '允许明文 HTTP 配对？');
  assert.equal(claims.length, before);
  await js(`document.getElementById('settings-nas-dialog-cancel').click()`); await sleep(50); assert.equal(claims.length, before);
  await js(`document.getElementById('settings-nas-pair-submit').click()`); await until(`!document.getElementById('settings-nas-dialog-root').hidden`);
  await js(`document.getElementById('settings-nas-dialog-confirm').click()`); await until(`!document.getElementById('settings-nas-sync-options').hidden`);
  assert.equal(claims.at(-1).httpConfirmAccepted, true); assert.equal(claims.at(-1).allowInsecureHttp, true);
  await js(`document.getElementById('settings-nas-sync-options-cancel').click()`);
  assert.equal(await js(`document.getElementById('settings-nas-http-warning').hidden`), false);
  credentials = { bound: true, baseUrl: primary.baseUrl, recovery: { paused: false } }; settings = { endpoints: [primary] };
  await emit('已同步');
  await js(`document.getElementById('settings-nas-advanced').open=true;document.getElementById('settings-nas-endpoint-url').value='http://192.0.2.6:31880';document.getElementById('settings-nas-endpoint-url').dispatchEvent(new Event('input'));document.getElementById('settings-nas-endpoint-add').click()`);
  await until(`!document.getElementById('settings-nas-dialog-root').hidden`);
  await js(`document.getElementById('settings-nas-dialog-cancel').click()`); assert.equal(additions.length, 0);
  await js(`document.getElementById('settings-nas-endpoint-add').click()`); await until(`!document.getElementById('settings-nas-dialog-root').hidden`);
  await js(`document.getElementById('settings-nas-dialog-confirm').click()`); await until(`document.getElementById('settings-nas-endpoint-hint').textContent.includes('持续警告')`);
  assert.equal(additions.length, 1); assert.equal(updates.at(-1).httpConfirmAccepted, true);
  assert.equal(await js(`document.getElementById('settings-nas-sync-base-url').value`), primary.baseUrl);
  await js(`document.getElementById('settings-nas-advanced').open=false`);
  credentials = { bound: false, recovery: { paused: false } }; settings = { endpoints: [] }; uiState = 'unbound';
  pairFailure = { ok: false, error: 'certificate_error', certificateError: true, needsTrustConfirm: true, fingerprint256: 'AA:BB', hostKey: 'nas.example:443' };
  await emit('未配对');
  await js(`document.getElementById('settings-nas-sync-base-url').value='https://nas.example/sync';document.getElementById('settings-nas-pair-code').value='123456';document.getElementById('settings-nas-pair-submit').click()`);
  await until(`!document.getElementById('settings-nas-dialog-root').hidden`);
  assert.equal(await js(`document.getElementById('settings-nas-dialog-title').textContent`), '信任此 NAS 证书？');
  assert(await js(`document.getElementById('settings-nas-dialog-body').textContent.includes('AA:BB')`));
  await js(`document.getElementById('settings-nas-dialog-cancel').click()`);
  credentials = { bound: true, baseUrl: primary.baseUrl, recovery: { paused: false } }; settings = { endpoints: [primary] };
  uiState = 'schema_incompatible'; schemaMessage = '协议不兼容：请升级桌面端 Pome Panel 后再同步';
  await emit('schema 不兼容'); assert.equal(await js(`document.getElementById('settings-nas-status-hint').textContent`), schemaMessage); await capture('schema');
  schemaMessage = null; uiState = 'migrating'; await emit('迁移中，稍候');
  assert.equal(await js(`document.getElementById('settings-nas-status-hint').textContent.includes('协议不兼容') || document.getElementById('settings-nas-sync-hint').textContent.includes('协议不兼容')`), false);
  assert.equal(await js(`document.getElementById('settings-nas-migration-banner').hidden`), false);
  uiState = 'migration_failed'; await emit('迁移失败');
  assert.equal(await js(`document.getElementById('settings-nas-migration-retry').hidden || document.getElementById('settings-nas-migration-actions').hidden`), false);
  assert.equal(await js(`document.getElementById('settings-nas-migration-restore').hidden`), false); await capture('migration-failed');
  assert.equal(await js(`Array.from(document.querySelectorAll('[id]')).length===new Set(Array.from(document.querySelectorAll('[id]'),node=>node.id)).size`), true);
  assert.deepEqual(errors, []);
}
require('../main.js');
