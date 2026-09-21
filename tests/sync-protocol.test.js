'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const protocol = require('../packages/sync-protocol');
const {
  SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  COLLECTIONS,
  P0_ENABLED_COLLECTIONS,
  negotiateSchema,
  validateMutation,
  createMutation,
  assertPushBatchLimits,
  validatePullResponse,
  validatePullCursor,
  PUSH_BATCH_MAX_MUTATIONS,
  PULL_PAGE_MAX_CHANGES,
} = protocol;

function validMutation(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    collection: COLLECTIONS.TODOS,
    entityId: 'todo-abc',
    op: 'upsert',
    payload: { text: 'hello', done: false },
    clientMutationId: 'cm-1',
    deviceId: 'dev-1',
    baseServerRev: 0,
    clientTime: Date.now(),
    ...overrides,
  };
}

test('schema constants expose a closed supported range', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(MIN_SUPPORTED_SCHEMA_VERSION, 1);
  assert.equal(MAX_SUPPORTED_SCHEMA_VERSION, 1);
  assert.ok(MIN_SUPPORTED_SCHEMA_VERSION <= SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION <= MAX_SUPPORTED_SCHEMA_VERSION);
});

test('negotiateSchema accepts overlapping peer range', () => {
  const result = negotiateSchema({
    schemaVersion: 1,
    minSupported: 1,
    maxSupported: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1);
});

test('negotiateSchema rejects peer that is too new or too old', () => {
  assert.equal(
    negotiateSchema({ schemaVersion: 9, minSupported: 5, maxSupported: 9 }).ok,
    false
  );
  assert.equal(
    negotiateSchema({ schemaVersion: 9, minSupported: 5, maxSupported: 9 }).reason,
    'peer_too_new'
  );
  assert.equal(
    negotiateSchema({ schemaVersion: 1, minSupported: 1, maxSupported: 1 }, { minSupported: 2, maxSupported: 3 }).reason,
    'peer_too_old'
  );
  assert.equal(negotiateSchema(null).reason, 'peer_schema_missing');
  assert.equal(negotiateSchema({ schemaVersion: 1 }).reason, 'peer_schema_invalid');
});

test('evaluateSchemaNegotiation stops both directions and names upgrade target', () => {
  const {
    evaluateSchemaNegotiation,
    SCHEMA_UI_STATE_INCOMPATIBLE,
    SCHEMA_UPGRADE_MESSAGES,
    schemaEnvelope,
  } = protocol;
  const tooNew = evaluateSchemaNegotiation(
    { schemaVersion: 5, minSupported: 3, maxSupported: 5 },
    { minSupported: 1, maxSupported: 2 }
  );
  assert.equal(tooNew.ok, false);
  assert.equal(tooNew.stopPull, true);
  assert.equal(tooNew.stopPush, true);
  assert.equal(tooNew.upgradeTarget, 'desktop');
  assert.equal(tooNew.uiState, SCHEMA_UI_STATE_INCOMPATIBLE);
  assert.equal(tooNew.message, SCHEMA_UPGRADE_MESSAGES.desktop);

  const tooOld = evaluateSchemaNegotiation(
    { schemaVersion: 1, minSupported: 1, maxSupported: 1 },
    { minSupported: 2, maxSupported: 3 }
  );
  assert.equal(tooOld.upgradeTarget, 'fpk');
  assert.equal(tooOld.message, SCHEMA_UPGRADE_MESSAGES.fpk);

  const ok = evaluateSchemaNegotiation(schemaEnvelope());
  assert.equal(ok.ok, true);
  assert.equal(ok.stopPull, false);
  assert.equal(ok.stopPush, false);
});

test('P0 enables only todos; placeholders are known but rejected for wiring', () => {
  assert.deepEqual(P0_ENABLED_COLLECTIONS, [COLLECTIONS.TODOS]);
  assert.equal(protocol.isP0EnabledCollection('todos'), true);
  assert.equal(protocol.isP0EnabledCollection('notes'), false);
  assert.equal(protocol.isKnownCollection('notes'), true);
  assert.equal(protocol.assertP0Collection('notes').reason, 'collection_not_enabled');
  assert.equal(protocol.assertP0Collection('vault').reason, 'collection_unknown');
});

test('validateMutation accepts a well-formed upsert', () => {
  const result = validateMutation(validMutation());
  assert.equal(result.ok, true);
  assert.equal(result.mutation.collection, 'todos');
  assert.equal(result.mutation.op, 'upsert');
});

test('validateMutation accepts delete with empty payload', () => {
  const result = validateMutation(validMutation({ op: 'delete', payload: {} }));
  assert.equal(result.ok, true);
});

test('validateMutation rejects illegal inputs', () => {
  assert.equal(validateMutation(null).reason, 'mutation_not_object');
  assert.equal(validateMutation(validMutation({ extra: 1 })).reason, 'mutation_unknown_field');
  assert.equal(validateMutation(validMutation({ schemaVersion: 99 })).reason, 'mutation_schema_version_mismatch');
  assert.equal(validateMutation(validMutation({ collection: 'notes' })).reason, 'collection_not_enabled');
  assert.equal(validateMutation(validMutation({ op: 'patch' })).reason, 'mutation_op_invalid');
  assert.equal(validateMutation(validMutation({ entityId: '' })).reason, 'mutation_entity_id_invalid');
  assert.equal(validateMutation(validMutation({ baseServerRev: -1 })).reason, 'mutation_base_server_rev_invalid');
  assert.equal(validateMutation(validMutation({ clientTime: 0 })).reason, 'mutation_client_time_invalid');
  assert.equal(
    validateMutation(validMutation({ op: 'delete', payload: { text: 'x' } })).reason,
    'mutation_delete_payload_must_be_empty'
  );
  const missing = { ...validMutation() };
  delete missing.deviceId;
  assert.equal(validateMutation(missing).reason, 'mutation_missing_field');
});

test('createMutation fills schemaVersion and validates', () => {
  const result = createMutation({
    collection: 'todos',
    entityId: 'todo-1',
    op: 'upsert',
    payload: { text: 'a' },
    clientMutationId: 'cm-2',
    deviceId: 'dev-2',
    baseServerRev: 3,
    clientTime: 1_700_000_000_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mutation.schemaVersion, SCHEMA_VERSION);
});

test('assertPushBatchLimits enforces size caps', () => {
  assert.equal(assertPushBatchLimits('nope').reason, 'push_batch_not_array');
  assert.equal(assertPushBatchLimits([]).reason, 'push_batch_empty');
  assert.equal(assertPushBatchLimits([validMutation()]).ok, true);
  const tooMany = Array.from({ length: PUSH_BATCH_MAX_MUTATIONS + 1 }, (_, i) =>
    validMutation({ clientMutationId: `cm-${i}`, entityId: `e-${i}` })
  );
  assert.equal(assertPushBatchLimits(tooMany).reason, 'push_batch_too_many');
});

test('validatePullResponse accepts opaque cursor and serverRev', () => {
  const result = validatePullResponse({
    changes: [{ entityId: 'todo-1', serverRev: 2 }],
    nextCursor: 'opaque-hwm-2',
    hasMore: false,
    serverRev: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.pull.nextCursor, 'opaque-hwm-2');
  assert.equal(result.pull.serverRev, 2);
});

test('validatePullResponse rejects illegal envelopes', () => {
  assert.equal(validatePullResponse(null).reason, 'pull_not_object');
  assert.equal(
    validatePullResponse({
      changes: [],
      nextCursor: null,
      hasMore: false,
      serverRev: 0,
      extra: true,
    }).reason,
    'pull_unknown_field'
  );
  assert.equal(
    validatePullResponse({
      changes: [],
      nextCursor: '',
      hasMore: false,
      serverRev: 0,
    }).reason,
    'pull_next_cursor_invalid'
  );
  assert.equal(
    validatePullResponse({
      changes: [],
      nextCursor: null,
      hasMore: true,
      serverRev: 1,
    }).reason,
    'pull_has_more_without_cursor'
  );
  const huge = {
    changes: Array.from({ length: PULL_PAGE_MAX_CHANGES + 1 }, () => ({})),
    nextCursor: 'c',
    hasMore: false,
    serverRev: 1,
  };
  assert.equal(validatePullResponse(huge).reason, 'pull_page_too_large');
});

test('validatePullCursor allows null or opaque non-empty string', () => {
  assert.equal(validatePullCursor(null).ok, true);
  assert.equal(validatePullCursor('rev:12').ok, true);
  assert.equal(validatePullCursor('').reason, 'pull_cursor_invalid');
  assert.equal(validatePullCursor(12).reason, 'pull_cursor_invalid');
});

test('desktop and package entry resolve the same contract exports', () => {
  const fromPackageJsonMain = require(path.join(__dirname, '..', 'packages', 'sync-protocol'));
  assert.equal(fromPackageJsonMain.SCHEMA_VERSION, SCHEMA_VERSION);
  assert.equal(typeof fromPackageJsonMain.validateMutation, 'function');
  assert.equal(typeof fromPackageJsonMain.validatePullResponse, 'function');
});

test('sync-protocol sources parse under node --check', () => {
  const root = path.join(__dirname, '..', 'packages', 'sync-protocol');
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});
