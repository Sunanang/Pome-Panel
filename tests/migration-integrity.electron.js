'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { TODO_PRIORITIES } = require('../sync-store');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const todos = Object.fromEntries(TODO_PRIORITIES.map((key, i) => [key, [{ id: `migration-${key}`,
  text: `保留 ${key}`, done: false, createdAt: i + 1, deadline: '', remindedAt: 0 }]]));
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'notch-todo-data': JSON.stringify(todos), 'notch-todo-category-order-v1': JSON.stringify(TODO_PRIORITIES),
} }));
const store = require('../fnos/app/server/store').createMemoryStore({ serverId: 'migration-fixture' });
const nas = require('../fnos/app/server/createApp').createApp({ listenMode: 'device-port', store });
const listening = new Promise(resolve => nas.server.listen(0, '127.0.0.1', resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false, phase = 'startup';
const watchdog = setTimeout(() => { console.error('Migration integrity timed out:', phase); app.exit(1); }, 30000);
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => {
    clearTimeout(watchdog); nas.server.close();
    console.log('First-bind migration: all eight columns survive local authority; NAS authority excludes duplicate history and keeps latest content');
    app.exit(0);
  }).catch(error => { console.error(phase, error); app.exit(1); });
}));
async function run(contents) {
  const js = code => contents.executeJavaScript(code);
  const until = async expression => {
    for (let i = 0; i < 300; i++) {
      try { if (await js(expression)) return; } catch {}
      await sleep(25);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const shots = process.env.POME_MIGRATION_SHOTS || path.join(__dirname, '../dist.noindex/migration-integrity');
  fs.mkdirSync(shots, { recursive: true });
  const applyAndCapture = async (projectionJson, name) => {
    // Same projection event used by the settings migration flow, with the
    // projection returned by the real main-process IPC / loopback NAS chain.
    await js(`(async () => {
      const todosJson=${JSON.stringify(projectionJson)};
      localStorage.setItem('notch-todo-data',todosJson);
      document.dispatchEvent(new CustomEvent('nas-sync:todos-projection',{detail:{todosJson}}));
      await setMode(true); await setActiveTab('todo');
      document.getElementById('ui-capsule-hint')?.querySelector('button')?.click();
      await document.fonts.ready;
    })()`);
    await sleep(650);
    const state = await js(`({keys:Object.keys(data),ids:PRIORITIES.flatMap(key=>data[key].map(item=>item.id)),count:document.querySelectorAll('#todo-sections .quadrant').length})`);
    assert.deepEqual(state.keys, TODO_PRIORITIES);
    assert.equal(state.ids.length, 8);
    assert.equal(new Set(state.ids).size, 8);
    assert.equal(state.count, 8);
    fs.writeFileSync(path.join(shots, `${name}.png`), (await contents.capturePage()).toPNG());
    await js(`document.querySelector('#todo-sections .quadrant:last-child').scrollIntoView({block:'nearest'})`);
    await sleep(150);
    fs.writeFileSync(path.join(shots, `${name}-last-columns.png`), (await contents.capturePage()).toPNG());
  };
  await until(`!!window.NotchWorkspace && !workspaceReloadPending && sessionStorage.getItem('notch-workspace-hydrated')==='1'`);
  await listening;
  phase = 'pair';
  const pairingCode = store.startPairing({ uid: 'u' }).code;
  const baseUrl = `http://127.0.0.1:${nas.server.address().port}`;
  const pair = await js(`window.notchAPI.syncPairClaim(${JSON.stringify({ baseUrl, pairingCode })})`);
  assert.equal(pair.ok, true, JSON.stringify(pair));
  phase = 'local authority';
  const local = await js(`window.notchAPI.syncRunMigration({localTodosJson:localStorage.getItem('notch-todo-data'),workspace:getWorkspaceSnapshotForSync()})`);
  assert.equal(local.ok, true, JSON.stringify(local));
  assert.deepEqual(JSON.parse(local.projectionJson), todos);
  for (const key of TODO_PRIORITIES) assert.equal(store.bucket('u').live.get(`migration-${key}`).payload.categoryId, key);
  await applyAndCapture(local.projectionJson, 'migration-local-eight-columns');
  phase = 'NAS edit history';
  for (let i = 1; i <= 2; i++) {
    store.applyPush('u', [{ schemaVersion: 1, collection: 'todos', entityId: 'migration-P7', op: 'upsert',
      payload: { ...todos.P7[0], text: `NAS 最新修改 ${i}`, categoryId: 'P7' }, clientMutationId: `edit-${i}`,
      deviceId: 'fixture-other', baseServerRev: store.bucket('u').serverRev, clientTime: Date.now() }], { deviceId: 'fixture-other' });
  }
  assert(store.pull('u', {}).changes.filter(row => row.entityId === 'migration-P7').length > 1);
  phase = 'NAS authority';
  const remote = await js(`window.notchAPI.syncRunMigration({choice:'use_nas',localTodosJson:localStorage.getItem('notch-todo-data'),workspace:getWorkspaceSnapshotForSync()})`);
  assert.equal(remote.ok, true, JSON.stringify(remote));
  const projected = JSON.parse(remote.projectionJson);
  assert.equal(projected.P7.length, 1);
  assert.equal(projected.P7[0].text, 'NAS 最新修改 2');
  for (const key of TODO_PRIORITIES) assert.equal(projected[key].length, 1);
  await applyAndCapture(remote.projectionJson, 'migration-nas-current-snapshot');
}
require('../main.js');
