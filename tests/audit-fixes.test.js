'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createMemoryStore } = require('../fnos/app/server/store');
const { createPersistentStore } = require('../fnos/app/server/persistentStore');
const { openSyncStore } = require('../sync-store');
const todos = require('../todos-sync');
const ws = require('../workspace-sync');
const { createSensitiveClipboardGuard, readClipboardObservation } = require('../main-services');
const { validatePublicHttpUrl, fetchPublicHttp, readLimitedBody } = require('../public-http');

function mutation(id, clientMutationId = id, op = 'upsert') {
  return { schemaVersion: 1, collection: 'todos', entityId: id, op,
    payload: op === 'delete' ? {} : { id, text: id, categoryId: 'P0', done: false, createdAt: 1, deadline: '', remindedAt: 0 },
    clientMutationId, deviceId: 'd1', baseServerRev: 0, clientTime: Date.now() };
}

function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-audit-fix-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'sync-state.bin');
}

test('NAS pairing, account key, workspace, deletion and migration survive a process restart', (t) => {
  const filePath = temp(t);
  const modulePath = path.resolve(__dirname, '../fnos/app/server/persistentStore');
  const setup = `const fs=require('node:fs'); const {createPersistentStore}=require(${JSON.stringify(modulePath)});
    const s=createPersistentStore({filePath:process.argv[1],serverId:'server'});
    const p=s.startPairing({uid:'u'}); const c=s.claimPairing({code:p.code});
    fs.writeFileSync(process.argv[1]+'.fixture',JSON.stringify(c),{mode:384});
    s.applyPush('u',[${JSON.stringify(mutation('live'))},${JSON.stringify(mutation('gone'))},${JSON.stringify(mutation('gone', 'del', 'delete'))}]);
    const m=s.startMigration('u');s.commitMigration('u',{migrationId:m.migrationId,expectedServerRev:3,authority:'nas'});`;
  const result = spawnSync(process.execPath, ['-e', setup, filePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const store = createPersistentStore({ filePath, serverId: 'server' });
  const claim = JSON.parse(fs.readFileSync(`${filePath}.fixture`));
  assert.equal(store.verifyToken(claim.deviceToken).uid, 'u');
  assert.equal(store.getOrCreateAccountSyncKey('u'), claim.accountSyncKey);
  assert.equal(store.listDevices('u').length, 1);
  assert.equal(store.syncState('u').live, 1);
  assert.equal(store.syncState('u').tombstones, 1);
  assert.equal(store.bucket('u').migrations.size, 1);
  assert.equal(store.claimPairing({ code: '000000' }).ok, undefined);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  store.revokeDevice('u', claim.deviceId);
  assert.equal(createPersistentStore({ filePath, serverId: 'server' }).verifyToken(claim.deviceToken), null);
});

test('NAS mutation idempotency spans requests, devices and restarts', (t) => {
  const filePath = temp(t);
  let store = createPersistentStore({ filePath, serverId: 's' });
  store.applyPush('u', [mutation('todo', 'request')]);
  store.applyPush('u', [mutation('todo', 'delete', 'delete')], { deviceId: 'd2' });
  store = createPersistentStore({ filePath, serverId: 's' });
  assert.equal(store.applyPush('u', [mutation('todo', 'request')]).applied[0].status, 'duplicate');
  assert.equal(store.syncState('u').live, 0);
  assert.equal(store.syncState('u').serverRev, 2);
  assert.equal(store.applyPush('u', [mutation('other', 'request')], { deviceId: 'd2' }).applied[0].status, 'applied');
});

test('failed NAS disk commit rolls back entities and idempotency keys', (t) => {
  const filePath = temp(t);
  createPersistentStore({ filePath, serverId: 's' });
  const failing = createPersistentStore({ filePath, serverId: 's', fileSystem: {
    ...fs, renameSync() { throw new Error('fixture_disk_full'); },
  } });
  assert.throws(() => failing.applyPush('u', [mutation('todo')]), /fixture_disk_full/);
  assert.equal(failing.syncState('u').live, 0);
  assert.equal(failing.bucket('u').mutationResults.size, 0);
  const reopened = createPersistentStore({ filePath, serverId: 's' });
  assert.equal(reopened.applyPush('u', [mutation('todo')]).applied[0].status, 'applied');
});

test('corrupt NAS snapshot fails startup without replacing the original', (t) => {
  const filePath = temp(t);
  fs.writeFileSync(filePath, 'corrupted');
  assert.throws(() => createPersistentStore({ filePath, serverId: 's' }));
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'corrupted');
});

test('copied passwords stay excluded even if the OS strips the sensitivity marker', async () => {
  const guard = createSensitiveClipboardGuard();
  guard.protect('fixture-password');
  const item = { types: ['text/plain'], getType: async () => new Blob(['fixture-password']) };
  const observation = await readClipboardObservation([item]);
  assert.equal(guard.isSensitive(observation.text), true);
  assert.equal(guard.isSensitive('ordinary text'), false);
  guard.protect('another-secret');
  assert.equal(guard.isSensitive('fixture-password'), true);
  for (const type of ['org.nspasteboard.ConcealedType', 'ExcludeClipboardContentFromMonitorProcessing']) {
    const sensitive = await readClipboardObservation([{ ...item, types: ['text/plain', `electron application/osclipboard;format="${type}"`] }]);
    assert.equal(sensitive.concealed, true);
    assert.equal(sensitive.text, '');
  }
});

test('501 offline mutations drain in bounded batches; partial failure retains only unacked entries', async () => {
  const store = openSyncStore(':memory:');
  const { accountId } = todos.ensureBoundAccount(store, { serverId: 's', uid: 'u', deviceId: 'd1' });
  try {
    for (let i = 0; i < 501; i++) assert.equal(store.writeLocalMutation({ accountId, ...mutation(`t${i}`) }).ok, true);
    const server = createMemoryStore();
    const sizes = [];
    const first = await todos.pushTodosOutbox(store, { accountId, pushMutations: async mutations => {
      sizes.push(mutations.length);
      return sizes.length === 2 ? { ok: false, error: 'offline' } : { ok: true, ...server.applyPush('u', mutations) };
    } });
    assert.equal(first.ok, false);
    assert.deepEqual(sizes, [500, 1]);
    assert.equal(first.pendingCount, 1);
    const second = await todos.pushTodosOutbox(store, { accountId, pushMutations: async mutations => ({ ok: true, ...server.applyPush('u', mutations) }) });
    assert.equal(second.pendingCount, 0);
    assert.equal(server.syncState('u').live, 501);
  } finally { store.close(); }
});

test('batches respect byte and count limits and reject a single oversize mutation', () => {
  const input = Array.from({ length: 501 }, (_, i) => mutation(`n${i}`));
  assert.deepEqual(ws.splitMutationBatches(input).map(batch => batch.length), [500, 1]);
  const maxBytes = Buffer.byteLength(JSON.stringify(input.slice(0, 2)));
  assert(ws.splitMutationBatches(input.slice(0, 7), maxBytes).every(batch => Buffer.byteLength(JSON.stringify(batch)) <= maxBytes));
  assert.throws(() => ws.splitMutationBatches([mutation('large')], 10), /push_mutation_too_large/);
});

test('offline changes created in the same millisecond preserve insertion order', async () => {
  const store = openSyncStore(':memory:');
  const { accountId } = todos.ensureBoundAccount(store, { serverId: 's', uid: 'u', deviceId: 'd' });
  const originalNow = Date.now;
  try {
    Date.now = () => 1700000000000;
    for (const [id, op] of [['z', 'upsert'], ['y', 'upsert'], ['a', 'delete']]) {
      assert.equal(store.writeLocalMutation({ accountId, ...mutation('todo', id, op) }).ok, true);
    }
  } finally { Date.now = originalNow; }
  try {
    const server = createMemoryStore();
    await todos.pushTodosOutbox(store, { accountId, pushMutations: async mutations => ({ ok: true, ...server.applyPush('u', mutations) }) });
    assert.equal(server.syncState('u').live, 0);
  } finally { store.close(); }
});

test('failed later collection leaves earlier cursor untouched; retry projects and commits all changes', async () => {
  const store = openSyncStore(':memory:');
  const { accountId } = todos.ensureBoundAccount(store, { serverId: 's', uid: 'u', deviceId: 'd' });
  let fail = true;
  const pullPage = async ({ collection }) => {
    if (collection === 'links' && fail) return { ok: false, error: 'offline' };
    return { ok: true, body: { changes: collection === 'notes' ? [{ entityId: 'note:n', collection,
      op: 'upsert', payload: { kind: 'archive', id: 'n', content: 'remote' }, serverRev: 1 }] : [],
    nextCursor: '1', hasMore: false, serverRev: 1, schemaVersion: 1 } };
  };
  try {
    const options = { store, accountId, pullPage, collections: ['notes', 'links'] };
    assert.equal((await ws.pullWorkspacePages(options)).ok, false);
    assert.equal(store.getPullCursor(accountId, 'notes').cursor, null);
    fail = false;
    const pulled = await ws.pullWorkspacePages(options);
    assert.equal(pulled.remoteChanges.length, 1);
    const plan = ws.planWorkspaceSync({ index: {}, localEntities: [], remoteChanges: pulled.remoteChanges });
    const projection = ws.projectWorkspaceEntities(plan.mergedEntities).snapshot;
    const storage = ws.workspaceProjectionToStorage({}, projection);
    assert.equal(JSON.parse(storage['notch-note-archive-v1'])[0].content, 'remote');
    ws.commitWorkspacePullPages(store, accountId, pulled.pages);
    assert.equal(store.getPullCursor(accountId, 'notes').cursor, '1');
  } finally { store.close(); }
});

test('workspace cursor commit is atomic across collections when a page is invalid', () => {
  const store = openSyncStore(':memory:');
  const { accountId } = todos.ensureBoundAccount(store, { serverId: 's', uid: 'u', deviceId: 'd' });
  try {
    const pull = { changes: [], nextCursor: '1', serverRev: 1, hasMore: false };
    assert.throws(() => ws.commitWorkspacePullPages(store, accountId, [{ collection: 'notes', pull },
      { collection: 'links', pull: { ...pull, changes: [{ entityId: 'link:x', op: 'invalid' }] } }]));
    assert.equal(store.getPullCursor(accountId, 'notes').cursor, null);
  } finally { store.close(); }
});

test('old remote echoes preserve unsynced local edits and deletes; clean local rows accept updates', () => {
  const old = { entityId: 'note:n', collection: 'notes', op: 'upsert', payload: { kind: 'archive', id: 'n', content: 'old' } };
  const edited = { ...old, payload: { ...old.payload, content: 'new' } };
  const index = ws.hashesForEntities([old]);
  const plan = ws.planWorkspaceSync({ index, localEntities: [edited], remoteChanges: [old] });
  assert.equal(plan.mergedEntities[0].payload.content, 'new');
  assert.equal(plan.toPush[0].payload.content, 'new');
  assert.equal(plan.appliedIndex['note:n'], index['note:n'], 'not acknowledged before push succeeds');
  const deletion = ws.planWorkspaceSync({ index, localEntities: [], remoteChanges: [old] });
  assert.equal(deletion.mergedEntities.length, 0);
  assert.equal(deletion.toPush[0].op, 'delete');
  const remote = ws.planWorkspaceSync({ index, localEntities: [old], remoteChanges: [edited] });
  assert.equal(remote.mergedEntities[0].payload.content, 'new');
  assert.equal(remote.toPush.length, 0);
  const historical = ws.planWorkspaceSync({ index, localEntities: [edited], remoteChanges: [
    { ...old, op: 'delete', payload: {}, serverRev: 1 }, { ...old, serverRev: 2 },
  ] });
  assert.equal(historical.mergedEntities[0].payload.content, 'new');
  assert.equal(historical.toPush[0].payload.content, 'new');
});

test('public HTTP pins the verified address; a subsequent private DNS answer prevents the request', async () => {
  let resolution = '93.184.216.34';
  let requests = 0;
  const dependencies = {
    lookup: async () => [{ address: resolution, family: 4 }],
    httpRequest(url, options, onResponse) {
      requests++;
      assert.equal(url.hostname, 'rebind.test');
      resolution = '127.0.0.1';
      options.lookup(url.hostname, { all: false }, (error, address) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); });
      options.lookup(url.hostname, { all: true }, (error, addresses) => { assert.equal(error, null); assert.equal(addresses[0].address, '93.184.216.34'); });
      const request = new EventEmitter();
      request.end = () => {
        const incoming = new PassThrough(); incoming.statusCode = 200; incoming.headers = { 'content-type': 'text/html' };
        onResponse(incoming); incoming.end('<title>ok</title>');
      };
      return request;
    },
  };
  const response = await fetchPublicHttp('http://rebind.test/', {}, dependencies);
  assert.equal(await response.text(), '<title>ok</title>');
  await assert.rejects(fetchPublicHttp('http://rebind.test/', {}, dependencies), /invalid_or_private_url/);
  assert.equal(requests, 1);
  assert.equal(await validatePublicHttpUrl('http://user:pass@example.test/', dependencies), null);
});

test('HTTP body byte limit cancels oversized streams', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readLimitedBody(response, 50), /response_too_large/);
  assert.equal(cancelled, true);
});

test('link timeout remains active while reading the body after receiving headers', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('async function inspectLink(rawUrl)');
  const end = source.indexOf("ipcMain.handle('links:inspect'", start);
  const sandbox = { URL, Buffer, AbortController, setTimeout, clearTimeout,
    LINK_FETCH_TIMEOUT_MS: 20, LINK_FETCH_MAX_REDIRECTS: 3,
    validatePublicHttpUrl: async url => new URL(url),
    fetchPublicHttp: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) { signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); },
    }), { headers: { 'content-type': 'text/html' } }),
    readResponseText: async response => (await readLimitedBody(response, 1024)).toString(),
    extractPageTitle: () => 'title', fetchFaviconDataUrl: async () => '', enrichLinkMetadata: async () => ({ title: 'title' }) };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  const result = await sandbox.inspectLink('https://slow.test/');
  assert.equal(result.warning, 'timeout');
});

test('synced AI settings stop cursor advancement when encryption or persistence fails', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function writeSyncedAiSettings(plain)');
  const end = source.indexOf('function materializeWorkspaceSnapshot', start);
  let encrypted = 'sealed';
  let saved = false;
  let cursorSaved = true;
  const sandbox = {
    writeCursorManualToken: () => ({ ok: cursorSaved }),
    readStoredTranscriptionSettings: () => ({ encryptedApiKey: 'original' }),
    encryptStoredSecret: () => encrypted,
    getTranscriptionSettingsPath: () => 'fixture',
    writeJsonFile: () => saved,
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  assert.throws(() => sandbox.writeSyncedAiSettings({ apiKey: 'new' }), /ai_settings_save_failed/);
  saved = true;
  encrypted = '';
  assert.throws(() => sandbox.writeSyncedAiSettings({ apiKey: 'new' }), /ai_key_encrypt_failed/);
  cursorSaved = false;
  assert.throws(() => sandbox.writeSyncedAiSettings({ cursorToken: 'new' }), /cursor_token_save_failed/);
  encrypted = 'sealed';
  cursorSaved = true;
  assert.doesNotThrow(() => sandbox.writeSyncedAiSettings({ apiKey: 'new', cursorToken: 'new' }));
});
