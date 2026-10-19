'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createMemoryStore } = require('../fnos/app/server/store');
const { MIGRATION_DECISIONS, classifyMigrationDecision } = require('../packages/sync-protocol');
const {
  countWorkspaceContent,
  buildWorkspaceEntities,
  projectWorkspaceEntities,
  planWorkspaceSync,
  selectWorkspaceChanges,
  dedupeWorkspaceSnapshot,
  hashesForEntities,
  AUDIO_CHUNK_RAW,
  workspaceProjectionToStorage,
} = require('../workspace-sync');

test('clipboard export, NAS projection and storage enforce 100 ordinary rows plus all favorites', () => {
  const history = Array.from({length:150}, (_, i) => ({id:`c-${i}`,type:'text',text:`copy ${i}`,timestamp:i}));
  const favorites = history.slice(0, 20).map(row => row.id);
  const snapshot = {clipboard:{history,favorites}};
  const built = buildWorkspaceEntities(snapshot).entities;
  assert.equal(built.filter(row => row.entityId !== 'clip:favorites').length, 120);
  const remote = history.map(row => ({entityId:`clip:${row.id}`,collection:'clipboardHistory',payload:row}));
  remote.push({entityId:'clip:favorites',collection:'clipboardHistory',payload:{ids:favorites}});
  const projected = projectWorkspaceEntities(remote).snapshot.clipboard;
  assert.equal(projected.history.length, 120);
  assert.equal(projected.history[0].id, 'c-149');
  assert.ok(favorites.every(id => projected.history.some(row => row.id === id)));
  const storage = workspaceProjectionToStorage({}, snapshot);
  assert.deepEqual(JSON.parse(storage['notch-clip-history']), projected.history.map(({imageBase64,mimeType,...row}) => row));
  assert.deepEqual(JSON.parse(storage['notch-clip-favorites']), favorites);
});

test('merged NAS clipboard overflow sends deletes and converges without resurrecting evicted rows', () => {
  const clip = i => ({entityId:`clip:c-${i}`,collection:'clipboardHistory',op:'upsert',payload:{id:`c-${i}`,type:'text',text:`copy ${i}`,timestamp:i}});
  const local = Array.from({length:90}, (_, i) => clip(i));
  const remote = Array.from({length:150}, (_, i) => clip(i));
  remote.push({entityId:'clip:favorites',collection:'clipboardHistory',op:'upsert',payload:{ids:['c-0','c-1']}});
  const plan = planWorkspaceSync({index:hashesForEntities(local),localEntities:local,remoteChanges:remote});
  const deletes = plan.toPush.filter(row => row.op === 'delete');
  assert.equal(deletes.length, 48);
  assert.ok(deletes.every(row => +row.entityId.slice('clip:c-'.length) >= 2 && +row.entityId.slice('clip:c-'.length) < 50));
  assert.equal(plan.mergedEntities.length, 103); // 100 ordinary, 2 favorites, favorites metadata
  const server = new Map(remote.map(row => [row.entityId,row]));
  for (const row of plan.toPush) row.op === 'delete' ? server.delete(row.entityId) : server.set(row.entityId,row);
  assert.equal(server.size, 103);
  const next = planWorkspaceSync({index:plan.nextIndex,localEntities:plan.mergedEntities,remoteChanges:[...server.values(),...deletes]});
  assert.deepEqual(next.toPush, []);
  assert.equal(next.mergedEntities.length, 103);
  // A failed delete keeps the remote baseline so the next cycle retries it.
  const retry = planWorkspaceSync({index:plan.appliedIndex,localEntities:plan.mergedEntities,remoteChanges:[]});
  assert.deepEqual(new Set(retry.toPush.map(row => row.entityId)), new Set(deletes.map(row => row.entityId)));
});

const SECRET = 'super-secret-value';

function accountKey() {
  return crypto.randomBytes(32).toString('base64');
}

function sampleSnapshot() {
  const audio = Buffer.alloc(AUDIO_CHUNK_RAW + 32, 7);
  return {
    notes: {
      home: '首页速记',
      archive: [{
        id: 'n1',
        title: '归档',
        titleSource: 'user',
        content: '正文',
        createdAt: 10,
        updatedAt: 20,
      }],
      activeId: 'n1',
    },
    links: [{
      id: 'g1',
      name: '资料',
      collapsed: false,
      links: [{ id: 'l1', url: 'https://example.com', title: 'Example', description: '', createdAt: 1 }],
    }],
    commands: [
      { id: 'cmd-old', text: 'git status', createdAt: 2 },
      { id: 'cmd-new', text: 'npm test', createdAt: 9 },
    ],
    clipboard: {
      history: [{
        id: 'c1',
        type: 'text',
        text: 'copied',
        timestamp: 5,
      }, {
        id: 'c2',
        type: 'image',
        text: '',
        imageBase64: Buffer.from('png-bytes').toString('base64'),
        timestamp: 6,
      }],
      favorites: ['c1'],
    },
    recordings: [{
      id: 'rec1',
      createdAt: 30,
      durationMs: 1200,
      transcript: '你好',
      mimeType: 'audio/webm',
      title: '录音',
      category: '未分类',
      audioBase64: audio.toString('base64'),
    }],
    aiSettings: {
      apiKey: 'dashscope-key',
      llmApiKey: 'llm-key',
      workspaceId: 'ws',
      region: 'beijing',
      llmBaseUrl: 'https://api.deepseek.com',
      llmModel: 'deepseek-v4-flash',
    },
    secrets: [{
      id: 'sec1',
      service: 'GitHub',
      account: 'me',
      password: SECRET,
      createdAt: 40,
    }],
  };
}

test('any workspace category counts as non-empty', () => {
  assert.equal(countWorkspaceContent({ notes: { home: '', archive: [] } }, { todoLive: 0 }).total, 0);
  const notesOnly = countWorkspaceContent({
    notes: { home: '', archive: [{ id: 'n', content: '有内容', title: '' }] },
  });
  assert.equal(notesOnly.notes, 1);
  assert.equal(notesOnly.total, 1);
  const commandsOnly = countWorkspaceContent({
    commands: [{ id: 'cmd', text: 'npm test', createdAt: 1 }],
  });
  assert.equal(commandsOnly.commands, 1);
  assert.equal(commandsOnly.total, 1);
  assert.equal(countWorkspaceContent({ commands: [{ id: 'blank', text: '   ' }] }).total, 0);
  const decision = classifyMigrationDecision({
    localOk: true,
    localLive: notesOnly.total,
    nas: { live: 0, tombstones: 0, changeLogCount: 0, serverRev: 0, pristine: true },
  });
  assert.equal(decision.decision, MIGRATION_DECISIONS.AUTO_UPLOAD_LOCAL);
});

test('secrets and AI keys round-trip as ciphertext', () => {
  const key = accountKey();
  const built = buildWorkspaceEntities(sampleSnapshot(), { accountKey: key });
  const encoded = JSON.stringify(built.entities);
  assert.equal(encoded.includes(SECRET), false);
  assert.equal(encoded.includes('dashscope-key'), false);
  assert.equal(encoded.includes('llm-key'), false);
  assert.equal(built.entities.some((entity) => entity.collection === 'notes' && entity.entityId === 'note:home'), true);
  assert.equal(built.entities.some((entity) => entity.collection === 'links'), true);
  assert.equal(built.entities.some((entity) => entity.entityId === 'command:cmd-new' && entity.collection === 'commands'), true);
  assert.equal(built.entities.some((entity) => entity.collection === 'clipboardHistory'), true);
  assert.equal(built.entities.some((entity) => entity.entityId === 'recording:rec1'), true);
  assert.equal(built.entities.some((entity) => entity.entityId.startsWith('recording-blob:')), true);

  const again = buildWorkspaceEntities(sampleSnapshot(), { accountKey: key });
  const sealed = built.entities.find((entity) => entity.entityId === 'secret:sec1');
  const resealed = again.entities.find((entity) => entity.entityId === 'secret:sec1');
  assert.equal(sealed.payload.ct, resealed.payload.ct);

  const projected = projectWorkspaceEntities(built.entities, { accountKey: key });
  assert.equal(projected.snapshot.notes.home, '首页速记');
  assert.equal(projected.snapshot.notes.archive[0].content, '正文');
  assert.equal(projected.snapshot.links[0].links[0].url, 'https://example.com');
  assert.deepEqual(projected.snapshot.commands.map((item) => item.text), ['npm test', 'git status']);
  assert.equal(projected.snapshot.clipboard.history.length, 2);
  assert.equal(projected.snapshot.clipboard.favorites[0], 'c1');
  assert.equal(projected.snapshot.recordings[0].transcript, '你好');
  assert.equal(
    Buffer.from(projected.snapshot.recordings[0].audioBase64, 'base64').length,
    AUDIO_CHUNK_RAW + 32,
  );
  assert.equal(projected.snapshot.aiSettings.apiKey, 'dashscope-key');
  assert.equal(projected.snapshot.secrets[0].password, SECRET);
  assert.equal(projected.secretsApplied, true);
});

test('missing account key does not emit plaintext secrets', () => {
  const built = buildWorkspaceEntities(sampleSnapshot(), { accountKey: null });
  const encoded = JSON.stringify(built.entities);
  assert.equal(encoded.includes(SECRET), false);
  assert.equal(built.entities.some((entity) => entity.collection === 'secrets'), false);
  assert.equal(built.warnings.some((warning) => warning.reason === 'account_key_required'), true);
  assert.equal(built.entities.some((entity) => entity.collection === 'notes'), true);
});

test('a Cursor-only configuration syncs in a sealed AI payload, including explicit clearing', () => {
  const key = accountKey();
  const token = 'fixture-cursor-nas-token';
  assert.equal(countWorkspaceContent({ aiSettings: { cursorToken: token } }).total, 1);
  for (const value of [token, '']) {
    const built = buildWorkspaceEntities({ aiSettings: { cursorToken: value } }, { accountKey: key });
    assert.equal(built.entities.length, 1);
    assert.equal(built.entities[0].entityId, 'ai:settings');
    assert.equal(built.entities[0].payload.sealed, true);
    assert.equal(JSON.stringify(built.entities).includes(token), false);
    const projected = projectWorkspaceEntities(built.entities, { accountKey: key });
    assert.equal(projected.aiApplied, true);
    assert.equal(projected.snapshot.aiSettings.cursorToken, value);
    const wrongKey = projectWorkspaceEntities(built.entities, { accountKey: accountKey() });
    assert.equal(wrongKey.aiApplied, false);
  }
  const blocked = buildWorkspaceEntities({ aiSettings: { cursorToken: token } }, { accountKey: null });
  assert.equal(blocked.entities.length, 0);
  assert.equal(JSON.stringify(blocked).includes(token), false);
});

test('legacy AI payloads keep Cursor Token absent instead of requesting a clear', () => {
  const key = accountKey();
  const built = buildWorkspaceEntities({ aiSettings: { apiKey: 'legacy-asr-key' } }, { accountKey: key });
  const projected = projectWorkspaceEntities(built.entities, { accountKey: key });
  assert.equal(Object.hasOwn(projected.snapshot.aiSettings, 'cursorToken'), false);
});

test('local delete becomes a delete mutation', () => {
  const key = accountKey();
  const built = buildWorkspaceEntities(sampleSnapshot(), { accountKey: key });
  const index = {};
  for (const entity of built.entities) index[entity.entityId] = 'stale';
  const plan = planWorkspaceSync({
    index,
    localEntities: built.entities.filter((entity) => entity.entityId !== 'note:home'),
    remoteChanges: [],
  });
  assert.equal(plan.toPush.some((entity) => entity.entityId === 'note:home' && entity.op === 'delete'), true);
});

test('NAS stores sealed secrets and a paired device can read them', () => {
  const store = createMemoryStore({ serverId: 'srv-workspace' });
  const started = store.startPairing({ uid: 'uid-workspace' });
  const claim = store.claimPairing({ code: started.code, deviceName: 'mac' });
  assert.equal(claim.ok, true);
  assert.equal(store.getOrCreateAccountSyncKey('uid-workspace'), claim.accountSyncKey);

  const built = buildWorkspaceEntities(sampleSnapshot(), { accountKey: claim.accountSyncKey });
  const secret = built.entities.find((entity) => entity.entityId === 'secret:sec1');
  store.applyPush('uid-workspace', [{
    collection: 'secrets',
    entityId: secret.entityId,
    op: 'upsert',
    payload: secret.payload,
    clientMutationId: 'cm-secret',
    deviceId: claim.deviceId,
  }], { deviceId: claim.deviceId });

  const live = store.bucket('uid-workspace').live.get('secret:sec1');
  assert.equal(JSON.stringify(live.payload).includes(SECRET), false);
  const pulled = store.pull('uid-workspace', { collection: 'secrets' });
  assert.equal(pulled.changes.length, 1);
  assert.equal(pulled.changes[0].collection, 'secrets');
  const projected = projectWorkspaceEntities(pulled.changes.map((change) => ({
    entityId: change.entityId,
    collection: change.collection,
    op: change.op,
    payload: change.payload,
  })), { accountKey: claim.accountSyncKey });
  assert.equal(projected.snapshot.secrets[0].password, SECRET);
  const notesPull = store.pull('uid-workspace', { collection: 'notes' });
  assert.equal(notesPull.changes.length, 0);
});

function pushCommands(store, uid, deviceId, commands) {
  const built = buildWorkspaceEntities({ commands }, {});
  store.applyPush(uid, built.entities.map((entity, index) => ({
    collection: entity.collection,
    entityId: entity.entityId,
    op: 'upsert',
    payload: entity.payload,
    clientMutationId: `${deviceId}-${index}`,
    deviceId,
  })), { deviceId });
  return built.entities;
}

test('local-authority migration on another device removes old commands instead of duplicating', () => {
  const store = createMemoryStore({ serverId: 'srv-dup' });
  const uid = 'uid-dup';
  const deviceA = pushCommands(store, uid, 'mac', [{ id: 'a1', text: 'npm start', createdAt: 1 }]);
  const cursor = String(store.syncState(uid).serverRev);

  const started = store.startMigration(uid);
  const fromB = buildWorkspaceEntities({
    commands: [
      { id: 'b1', text: 'npm start', createdAt: 5 },
      { id: 'b2', text: 'git status', createdAt: 6 },
    ],
  }, {}).entities;
  const committed = store.commitMigration(uid, {
    migrationId: started.migrationId,
    expectedServerRev: store.syncState(uid).serverRev,
    authority: 'local',
    entities: fromB,
    deviceId: 'win',
  });
  assert.equal(committed.ok, true);

  const pulled = store.pull(uid, { cursor, collection: 'commands' });
  const deleted = pulled.changes.find((change) => change.entityId === 'command:a1');
  assert.equal(deleted.op, 'delete');
  assert.equal(deleted.collection, 'commands');

  const plan = planWorkspaceSync({
    index: hashesForEntities(deviceA),
    localEntities: deviceA,
    remoteChanges: selectWorkspaceChanges(pulled.changes, 'commands'),
  });
  const projected = projectWorkspaceEntities(plan.mergedEntities);
  assert.deepEqual(projected.snapshot.commands.map((row) => row.text).sort(), ['git status', 'npm start']);
});

test('pull honours legacy todos-tagged workspace deletes and drops superseded upserts', () => {
  const store = createMemoryStore({ serverId: 'srv-legacy' });
  const uid = 'uid-legacy';
  pushCommands(store, uid, 'mac', [{ id: 'a1', text: 'npm start', createdAt: 1 }]);
  const b = store.bucket(uid);
  b.serverRev += 1;
  b.live.delete('command:a1');
  b.changeLog.push({ serverRev: b.serverRev, entityId: 'command:a1', collection: 'todos', op: 'delete' });

  const full = store.pull(uid, { cursor: '', collection: 'commands' });
  assert.deepEqual(full.changes.map((change) => [change.entityId, change.op]), [['command:a1', 'delete']]);
  assert.equal(full.nextCursor, String(b.serverRev));
  assert.equal(store.pull(uid, { cursor: '', collection: 'todos' }).changes.length, 0);
});

test('selectWorkspaceChanges tolerates an old NAS that ignores the collection filter', () => {
  const changes = [
    { entityId: 'command:a1', collection: 'todos', op: 'delete', serverRev: 3 },
    { entityId: 'command:b1', collection: 'commands', op: 'upsert', serverRev: 4, payload: { id: 'b1', text: 'x' } },
    { entityId: 'command:gone', collection: 'commands', op: 'upsert', serverRev: 2 },
    { entityId: 'link:g1', collection: 'links', op: 'upsert', serverRev: 5, payload: { id: 'g1' } },
    { entityId: 'todo-1', collection: 'todos', op: 'delete', serverRev: 6 },
  ];
  const selected = selectWorkspaceChanges(changes, 'commands');
  assert.deepEqual(selected.map((change) => change.entityId), ['command:a1', 'command:b1']);
  assert.equal(selected[0].collection, 'commands');
  assert.deepEqual(selectWorkspaceChanges(changes, 'links').map((change) => change.entityId), ['link:g1']);
});

test('payload-less upserts never resurrect ghost rows', () => {
  const plan = planWorkspaceSync({
    index: {},
    localEntities: [],
    remoteChanges: [{ entityId: 'link:ghost', collection: 'links', op: 'upsert' }],
  });
  assert.equal(plan.mergedEntities.length, 0);
  assert.equal(plan.nextIndex['link:ghost'], undefined);
});

test('content duplicates collapse to the same survivor on every device', () => {
  const rows = [
    { id: 'b1', text: 'npm start', createdAt: 5 },
    { id: 'a1', text: 'npm start', createdAt: 1 },
    { id: 'c1', text: 'git status', createdAt: 2 },
  ];
  const forward = dedupeWorkspaceSnapshot({ commands: rows }).commands;
  const reverse = dedupeWorkspaceSnapshot({ commands: rows.slice().reverse() }).commands;
  assert.deepEqual(forward.map((row) => row.id).sort(), ['a1', 'c1']);
  assert.deepEqual(reverse.map((row) => row.id).sort(), ['a1', 'c1']);

  const snapshot = dedupeWorkspaceSnapshot({
    notes: {
      home: '',
      activeId: 'n2',
      archive: [
        { id: 'n1', title: 't', content: 'body', createdAt: 1 },
        { id: 'n2', title: 't', content: 'body', createdAt: 2 },
      ],
    },
    links: [
      { id: 'g2', name: '资料', createdAt: 0, links: [{ id: 'l2', url: 'https://a.com' }] },
      { id: 'g1', name: '资料', createdAt: 0, links: [{ id: 'l1', url: 'https://a.com' }, { id: 'l3', url: 'https://a.com' }] },
      { id: 'g3', name: '', links: [] },
    ],
    clipboard: {
      history: [
        { id: 'c-old', type: 'text', text: 'hi', timestamp: 1 },
        { id: 'c-new', type: 'text', text: 'hi', timestamp: 9 },
        { id: 'img', type: 'image', text: '', timestamp: 3 },
      ],
      favorites: ['c-old'],
    },
    secrets: [
      { id: 's2', service: 'gh', account: 'me', password: 'p', createdAt: 2 },
      { id: 's1', service: 'gh', account: 'me', password: 'p', createdAt: 1 },
    ],
  });
  assert.deepEqual(snapshot.notes.archive.map((row) => row.id), ['n1']);
  assert.equal(snapshot.notes.activeId, 'n1');
  assert.deepEqual(snapshot.links.map((group) => group.id), ['g1', 'g3']);
  assert.equal(snapshot.links[0].links.length, 1);
  assert.deepEqual(snapshot.clipboard.history.map((row) => row.id), ['c-new', 'img']);
  assert.deepEqual(snapshot.clipboard.favorites, ['c-new']);
  assert.deepEqual(snapshot.secrets.map((row) => row.id), ['s1']);
});

test('a device already showing duplicates heals NAS by deleting the loser', () => {
  const local = [
    { id: 'a1', text: 'npm start', createdAt: 1 },
    { id: 'b1', text: 'npm start', createdAt: 5 },
  ];
  const withDup = [
    ...buildWorkspaceEntities({ commands: [local[0]] }, {}).entities,
    ...buildWorkspaceEntities({ commands: [local[1]] }, {}).entities,
  ];
  const plan = planWorkspaceSync({
    index: hashesForEntities(withDup),
    localEntities: buildWorkspaceEntities({ commands: local }, {}).entities,
    remoteChanges: [],
  });
  assert.deepEqual(plan.toPush.map((entity) => [entity.entityId, entity.op]), [['command:b1', 'delete']]);
});
