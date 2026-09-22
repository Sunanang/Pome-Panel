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
  AUDIO_CHUNK_RAW,
} = require('../workspace-sync');

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
