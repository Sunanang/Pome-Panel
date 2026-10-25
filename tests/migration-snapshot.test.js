'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createMemoryStore } = require('../fnos/app/server/store');
const { openSyncStore } = require('../sync-store');
const { runMigrationAttempt, classifyFromLocalAndNas } = require('../sync-migration');
const { pullFullSnapshot, WORKSPACE_COLLECTIONS } = require('../workspace-sync');

// Exercise the actual migration transport method without loading Electron or
// touching a real NAS. The production full-snapshot collector is unchanged.
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const handler = source.indexOf("ipcMain.handle('sync:run-migration'");
const from = source.indexOf('    async pullAll() {', handler);
const to = source.indexOf('\n  };\n\n  const credential', from);
assert(handler >= 0 && from > handler && to > from);
function transport(fetchBoundSyncJson, collector = pullFullSnapshot) {
  const context = { fetchBoundSyncJson, URLSearchParams, pullFullSnapshot: collector };
  vm.createContext(context);
  vm.runInContext(`migrationApi = ({${source.slice(from, to)}})`, context);
  return context.migrationApi;
}
function memoryTransport(nas) {
  const requests = [];
  const api = transport(async apiPath => {
    const url = new URL(apiPath, 'https://fixture.invalid/');
    requests.push(url);
    const body = nas.pull('u', { cursor: url.searchParams.get('cursor'),
      collection: url.searchParams.get('collection') || undefined,
      full: url.searchParams.get('full') === '1', deviceId: 'fixture-device' });
    return body.error ? { ok: false, error: body.error, body } : { ok: true, body };
  });
  return { api, requests };
}
const mutation = (id, text, serial) => ({ schemaVersion: 1, collection: 'todos', entityId: id, op: 'upsert',
  payload: { id, text, categoryId: 'P0', createdAt: 1 }, clientMutationId: `fixture-${serial}`,
  deviceId: 'fixture-device', baseServerRev: 0, clientTime: serial });

test('NAS-authority migration uses a current snapshot, not duplicate edit history, and keeps every collection', async t => {
  const nas = createMemoryStore();
  const migration = nas.startMigration('u');
  const entities = ['todos', ...WORKSPACE_COLLECTIONS].map((collection, i) => ({
    collection, entityId: i ? `fixture-${collection}` : 'todo-current',
    payload: i ? { fixture: collection } : { id: 'todo-current', text: 'initial', categoryId: 'P0', createdAt: 1 },
  }));
  nas.commitMigration('u', { migrationId: migration.migrationId, expectedServerRev: 0, authority: 'local', entities });
  nas.applyPush('u', [mutation('todo-current', 'edited once', 1), mutation('todo-current', 'edited twice', 2)], { deviceId: 'fixture-device' });
  assert(nas.pull('u', {}).changes.filter(row => row.entityId === 'todo-current').length > 1, 'fixture includes historical revisions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-migration-snapshot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = openSyncStore(':memory:'); t.after(() => store.close());
  store.ensureAccount({ accountId: 'a', uid: 'u', deviceId: 'fixture-device', serverId: 's' });
  const { api, requests } = memoryTransport(nas);
  const pull = await api.pullAll();
  assert.deepEqual(new Set(pull.changes.map(row => row.collection)), new Set(['todos', ...WORKSPACE_COLLECTIONS]));
  let projected;
  const result = await runMigrationAttempt({
    decision: classifyFromLocalAndNas(null, { live: entities.length, serverRev: pull.serverRev, changeLogCount: entities.length + 2, pristine: false }),
    authority: 'nas', localRaw: null, userDataPath: dir, accountId: 'a', deviceId: 'fixture-device', store,
    api: { ...api, startMigration: async () => ({ migrationId: 'nas-fixture', snapshotServerRev: pull.serverRev }),
      commitMigration: async () => ({ ok: true, body: { serverRev: pull.serverRev } }) },
    applyLocalProjection(json) { projected = JSON.parse(json); },
  });
  assert.equal(result.ok, true);
  assert.equal(projected.P0.length, 1);
  assert.equal(projected.P0[0].text, 'edited twice');
  assert.equal(store.buildTodosLocalStorageProjection('a').todos.P0.length, 1);
  assert(requests.every(url => url.searchParams.get('full') === '1' && !url.searchParams.has('collection')));
});

test('first-bind snapshot works after incremental history has been compacted', async () => {
  let now = 10;
  const nas = createMemoryStore({ now: () => now, retentionMs: 100 });
  nas.applyPush('u', [mutation('kept', 'still live', 1)], { deviceId: 'fixture-device' });
  now = 1000; nas.compactRetention();
  assert.equal(nas.pull('u', {}).error, 'full_resync_required');
  const { api } = memoryTransport(nas), pull = await api.pullAll();
  assert.equal(pull.changes.length, 1);
  assert.equal(pull.changes[0].payload.text, 'still live');
});

test('snapshot drains all pages and retains a deleted entity only as a tombstone', async () => {
  const nas = createMemoryStore();
  nas.applyPush('u', Array.from({ length: 505 }, (_, i) => mutation(`task-${i}`, `Task ${i}`, i + 1)), { deviceId: 'fixture-device' });
  nas.applyPush('u', [{ ...mutation('task-0', '', 999), op: 'delete', payload: {} }], { deviceId: 'fixture-device' });
  const { api, requests } = memoryTransport(nas), pull = await api.pullAll();
  assert.equal(requests.length, 2);
  assert.equal(pull.changes.filter(row => row.op === 'upsert').length, 504);
  assert.equal(pull.changes.find(row => row.entityId === 'task-0').op, 'delete');
  assert.equal(pull.hasMore, false);
});

test('migration rejects a page-limit, repeated cursor or failed later page instead of returning a truncated snapshot', async () => {
  const body = { changes: [], nextCursor: 'page-1', hasMore: true, serverRev: 2, fullSnapshot: true };
  let count = 0;
  const limited = transport(async () => ({ ok: true, body: { ...body, nextCursor: `page-${++count}` } }), args => pullFullSnapshot({ ...args, maxPages: 2 }));
  await assert.rejects(limited.pullAll(), /full_snapshot_page_limit/);
  const repeated = transport(async () => ({ ok: true, body }));
  await assert.rejects(repeated.pullAll(), /full_snapshot_cursor_loop/);
  count = 0;
  const failed = transport(async () => ++count === 1 ? { ok: true, body } : { ok: false, error: 'offline' });
  await assert.rejects(failed.pullAll(), /offline/);
});
