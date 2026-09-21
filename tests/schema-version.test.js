'use strict';

/**
 * T7 — schemaVersion negotiation acceptance.
 *
 * ① Server range above client max → stop pull+push, upgrade desktop
 * ② Client range above server max → stop pull+push, upgrade FPK
 * ③ Overlapping ranges with different schemaVersion → sync continues
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SCHEMA_VERSION,
  evaluateSchemaNegotiation,
  SCHEMA_UI_STATE_INCOMPATIBLE,
  SCHEMA_UPGRADE_MESSAGES,
  schemaEnvelope,
} = require('../packages/sync-protocol');
const { openSyncStore } = require('../sync-store');
const {
  ensureBoundAccount,
  writeTodoUpsert,
  runTodosSyncCycle,
  gateSchemaCompatibility,
  buildTodoEntityPayload,
} = require('../todos-sync');
const {
  SCHEMA_VERSION: FN_SCHEMA,
  schemaEnvelope: fnSchemaEnvelope,
  isSchemaCompatible,
} = require('../fnos/app/server/schema');

function tempDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pome-schema-t7-')), 'sync.db');
}

function boundStore() {
  const store = openSyncStore(tempDb());
  const binding = {
    serverId: 'srv-t7',
    uid: 'uid-t7',
    deviceId: 'dev-t7',
    boundAt: Date.now(),
  };
  const { accountId, deviceId } = ensureBoundAccount(store, binding);
  return { store, accountId, ctx: { accountId, deviceId } };
}

function peerEnvelope({ schemaVersion, minSupported, maxSupported, ...rest }) {
  return {
    schemaVersion,
    minSupported,
    maxSupported,
    ...rest,
  };
}

test('T7-① server above client max → stop pull and push; upgrade desktop', async () => {
  const evaluation = evaluateSchemaNegotiation(
    { schemaVersion: 5, minSupported: 3, maxSupported: 5 },
    { minSupported: 1, maxSupported: 2 },
  );
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.reason, 'peer_too_new');
  assert.equal(evaluation.stopPull, true);
  assert.equal(evaluation.stopPush, true);
  assert.equal(evaluation.upgradeTarget, 'desktop');
  assert.equal(evaluation.uiState, SCHEMA_UI_STATE_INCOMPATIBLE);
  assert.equal(evaluation.message, SCHEMA_UPGRADE_MESSAGES.desktop);

  const { store, accountId, ctx } = boundStore();
  try {
    writeTodoUpsert(store, ctx, {
      item: {
        id: 'todo-local',
        text: 'queued',
        done: false,
        createdAt: 1,
        deadline: '',
        remindedAt: 0,
      },
      categoryId: 'P0',
      clientMutationId: 'cm-t7-1',
    });
    assert.equal(store.listPendingOutbox(accountId).length, 1);

    let pullCalls = 0;
    let pushCalls = 0;
    const result = await runTodosSyncCycle(store, {
      accountId,
      localSchema: { minSupported: 1, maxSupported: 2 },
      pullPage: async () => {
        pullCalls += 1;
        return {
          ok: true,
          body: peerEnvelope({
            schemaVersion: 5,
            minSupported: 3,
            maxSupported: 5,
            changes: [
              {
                entityId: 'should-not-apply',
                op: 'upsert',
                payload: buildTodoEntityPayload(
                  {
                    id: 'should-not-apply',
                    text: 'poison',
                    done: false,
                    createdAt: 2,
                    deadline: '',
                    remindedAt: 0,
                  },
                  'P1'
                ),
                serverRev: 9,
              },
            ],
            nextCursor: '9',
            hasMore: false,
            serverRev: 9,
          }),
        };
      },
      pushMutations: async () => {
        pushCalls += 1;
        throw new Error('push_must_not_run');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, SCHEMA_UI_STATE_INCOMPATIBLE);
    assert.equal(result.stopPull, true);
    assert.equal(result.stopPush, true);
    assert.equal(result.upgradeTarget, 'desktop');
    assert.match(result.message, /升级桌面端/);
    assert.equal(pullCalls, 1);
    assert.equal(pushCalls, 0);
    // Pull must not apply remote changes; outbox must remain (push stopped).
    assert.equal(store.listPendingOutbox(accountId).length, 1);
    const projection = store.buildTodosLocalStorageProjection(accountId);
    assert.equal(projection.todos.P1.some((t) => t.id === 'should-not-apply'), false);
  } finally {
    store.close();
  }
});

test('T7-② client above server max → stop pull and push; upgrade FPK', async () => {
  const evaluation = evaluateSchemaNegotiation(
    { schemaVersion: 1, minSupported: 1, maxSupported: 1 },
    { minSupported: 2, maxSupported: 3 },
  );
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.reason, 'peer_too_old');
  assert.equal(evaluation.stopPull, true);
  assert.equal(evaluation.stopPush, true);
  assert.equal(evaluation.upgradeTarget, 'fpk');
  assert.equal(evaluation.message, SCHEMA_UPGRADE_MESSAGES.fpk);

  const { store, accountId, ctx } = boundStore();
  try {
    writeTodoUpsert(store, ctx, {
      item: {
        id: 'todo-local-2',
        text: 'queued',
        done: false,
        createdAt: 1,
        deadline: '',
        remindedAt: 0,
      },
      categoryId: 'P2',
      clientMutationId: 'cm-t7-2',
    });

    let pullCalls = 0;
    let pushCalls = 0;
    const result = await runTodosSyncCycle(store, {
      accountId,
      localSchema: { minSupported: 2, maxSupported: 3 },
      pullPage: async () => {
        pullCalls += 1;
        return {
          ok: true,
          body: peerEnvelope({
            schemaVersion: 1,
            minSupported: 1,
            maxSupported: 1,
            changes: [],
            nextCursor: null,
            hasMore: false,
            serverRev: 0,
          }),
        };
      },
      pushMutations: async () => {
        pushCalls += 1;
        throw new Error('push_must_not_run');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, SCHEMA_UI_STATE_INCOMPATIBLE);
    assert.equal(result.upgradeTarget, 'fpk');
    assert.match(result.message, /升级 NAS/);
    assert.equal(result.stopPull, true);
    assert.equal(result.stopPush, true);
    assert.equal(pullCalls, 1);
    assert.equal(pushCalls, 0);
    assert.equal(store.listPendingOutbox(accountId).length, 1);
  } finally {
    store.close();
  }
});

test('T7-③ overlapping ranges with different schemaVersion → normal sync', async () => {
  // Client understands 1–2; server advertises schemaVersion=2 within that overlap.
  const evaluation = evaluateSchemaNegotiation(
    { schemaVersion: 2, minSupported: 1, maxSupported: 2 },
    { minSupported: 1, maxSupported: 2 },
  );
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.stopPull, false);
  assert.equal(evaluation.stopPush, false);
  assert.equal(evaluation.schemaVersion, 2);

  const { store, accountId, ctx } = boundStore();
  try {
    writeTodoUpsert(store, ctx, {
      item: {
        id: 'todo-local-3',
        text: 'local-ok',
        done: false,
        createdAt: 3,
        deadline: '',
        remindedAt: 0,
      },
      categoryId: 'P3',
      clientMutationId: 'cm-t7-3',
    });

    let pullCalls = 0;
    let pushCalls = 0;
    const result = await runTodosSyncCycle(store, {
      accountId,
      localSchema: { minSupported: 1, maxSupported: 2 },
      pullPage: async () => {
        pullCalls += 1;
        return {
          ok: true,
          body: peerEnvelope({
            schemaVersion: 2,
            minSupported: 1,
            maxSupported: 2,
            changes: [
              {
                entityId: 'todo-remote-ok',
                op: 'upsert',
                payload: buildTodoEntityPayload(
                  {
                    id: 'todo-remote-ok',
                    text: 'from-nas-ok',
                    done: false,
                    createdAt: 4,
                    deadline: '',
                    remindedAt: 0,
                  },
                  'P0'
                ),
                serverRev: 2,
              },
            ],
            nextCursor: '2',
            hasMore: false,
            serverRev: 2,
          }),
        };
      },
      pushMutations: async (mutations) => {
        pushCalls += 1;
        assert.ok(mutations.length >= 1);
        return {
          ok: true,
          applied: mutations.map((m) => ({
            clientMutationId: m.clientMutationId,
            status: 'applied',
          })),
          serverRev: 3,
          body: peerEnvelope({
            schemaVersion: 2,
            minSupported: 1,
            maxSupported: 2,
            applied: mutations.map((m) => ({
              clientMutationId: m.clientMutationId,
              status: 'applied',
            })),
            serverRev: 3,
          }),
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(pullCalls, 1);
    assert.equal(pushCalls, 1);
    assert.equal(result.projection.todos.P0.some((t) => t.id === 'todo-remote-ok'), true);
    assert.equal(result.projection.todos.P3.some((t) => t.id === 'todo-local-3'), true);
    assert.equal(store.listPendingOutbox(accountId).length, 0);
  } finally {
    store.close();
  }
});

test('pair/sync gate + FPK envelope advertise min/max', () => {
  const env = schemaEnvelope();
  assert.deepEqual(env, {
    schemaVersion: SCHEMA_VERSION,
    minSupported: SCHEMA_VERSION,
    maxSupported: SCHEMA_VERSION,
  });
  assert.deepEqual(fnSchemaEnvelope(), env);
  assert.equal(FN_SCHEMA, SCHEMA_VERSION);
  assert.equal(isSchemaCompatible(SCHEMA_VERSION), true);
  assert.equal(isSchemaCompatible(99), false);

  const pairOk = gateSchemaCompatibility(env);
  assert.equal(pairOk.ok, true);

  const pairFail = gateSchemaCompatibility({
    schemaVersion: 9,
    minSupported: 8,
    maxSupported: 9,
  });
  assert.equal(pairFail.ok, false);
  assert.equal(pairFail.stopPull, true);
  assert.equal(pairFail.stopPush, true);
  assert.equal(pairFail.upgradeTarget, 'desktop');
});

test('UI status surface: schema incompatible uses existing hint/error tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /#settings-nas-sync-status\[data-state="error"\]/);
  assert.match(css, /var\(--p0\)/);
  const pairUi = require('../renderer/nas-sync-pair.js');
  const next = pairUi.reducePairUi(pairUi.initialPairUiState(), {
    type: 'set_status',
    status: {
      bound: true,
      schemaIncompatible: true,
      schemaUpgradeTarget: 'desktop',
      schemaMessage: SCHEMA_UPGRADE_MESSAGES.desktop,
    },
  });
  assert.match(next.error, /升级桌面端/);
});
