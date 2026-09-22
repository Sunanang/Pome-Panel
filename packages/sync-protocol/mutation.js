'use strict';

const { SCHEMA_VERSION, isPositiveInt, isNonNegativeInt } = require('./schema');
const { assertP0Collection } = require('./collections');

const MUTATION_OPS = Object.freeze(['upsert', 'delete']);

/** Suggested push batch caps (server may still reject oversize). */
const PUSH_BATCH_MAX_MUTATIONS = 500;
const PUSH_BATCH_MAX_BYTES = 1024 * 1024;
/** Workspace batches may carry recording / clipboard blobs. */
const WORKSPACE_PUSH_MAX_BYTES = 8 * 1024 * 1024;

const REQUIRED_MUTATION_FIELDS = Object.freeze([
  'schemaVersion',
  'collection',
  'entityId',
  'op',
  'payload',
  'clientMutationId',
  'deviceId',
  'baseServerRev',
  'clientTime',
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a single mutation. Rejects unknown fields and illegal values.
 *
 * @param {unknown} input
 * @param {{ allowPlaceholderCollections?: boolean }} [options]
 * @returns {{ ok: true, mutation: object } | { ok: false, reason: string, field?: string }}
 */
function validateMutation(input, options = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'mutation_not_object' };
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (!REQUIRED_MUTATION_FIELDS.includes(key)) {
      return { ok: false, reason: 'mutation_unknown_field', field: key };
    }
  }
  for (const field of REQUIRED_MUTATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      return { ok: false, reason: 'mutation_missing_field', field };
    }
  }

  if (!isPositiveInt(input.schemaVersion)) {
    return { ok: false, reason: 'mutation_schema_version_invalid', field: 'schemaVersion' };
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: 'mutation_schema_version_mismatch', field: 'schemaVersion' };
  }

  if (options.allowPlaceholderCollections) {
    if (typeof input.collection !== 'string' || input.collection.length === 0) {
      return { ok: false, reason: 'collection_missing', field: 'collection' };
    }
  } else {
    const collectionCheck = assertP0Collection(input.collection);
    if (!collectionCheck.ok) {
      return { ok: false, reason: collectionCheck.reason, field: 'collection' };
    }
  }

  if (!isNonEmptyString(input.entityId)) {
    return { ok: false, reason: 'mutation_entity_id_invalid', field: 'entityId' };
  }
  if (!MUTATION_OPS.includes(input.op)) {
    return { ok: false, reason: 'mutation_op_invalid', field: 'op' };
  }
  if (input.payload == null || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    return { ok: false, reason: 'mutation_payload_invalid', field: 'payload' };
  }
  if (input.op === 'delete' && Object.keys(input.payload).length !== 0) {
    return { ok: false, reason: 'mutation_delete_payload_must_be_empty', field: 'payload' };
  }
  if (!isNonEmptyString(input.clientMutationId)) {
    return { ok: false, reason: 'mutation_client_mutation_id_invalid', field: 'clientMutationId' };
  }
  if (!isNonEmptyString(input.deviceId)) {
    return { ok: false, reason: 'mutation_device_id_invalid', field: 'deviceId' };
  }
  if (!isNonNegativeInt(input.baseServerRev)) {
    return { ok: false, reason: 'mutation_base_server_rev_invalid', field: 'baseServerRev' };
  }
  if (!isPositiveInt(input.clientTime)) {
    return { ok: false, reason: 'mutation_client_time_invalid', field: 'clientTime' };
  }

  return {
    ok: true,
    mutation: {
      schemaVersion: input.schemaVersion,
      collection: input.collection,
      entityId: input.entityId,
      op: input.op,
      payload: input.payload,
      clientMutationId: input.clientMutationId,
      deviceId: input.deviceId,
      baseServerRev: input.baseServerRev,
      clientTime: input.clientTime,
    },
  };
}

/**
 * Build a mutation object after validation.
 *
 * @param {object} fields
 * @returns {{ ok: true, mutation: object } | { ok: false, reason: string, field?: string }}
 */
function createMutation(fields) {
  const withDefaults = {
    schemaVersion: SCHEMA_VERSION,
    payload: {},
    ...fields,
  };
  return validateMutation(withDefaults);
}

/**
 * @param {unknown} mutations
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function assertPushBatchLimits(mutations, options = {}) {
  if (!Array.isArray(mutations)) {
    return { ok: false, reason: 'push_batch_not_array' };
  }
  if (mutations.length === 0) {
    return { ok: false, reason: 'push_batch_empty' };
  }
  if (mutations.length > PUSH_BATCH_MAX_MUTATIONS) {
    return { ok: false, reason: 'push_batch_too_many' };
  }
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : PUSH_BATCH_MAX_BYTES;
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(mutations), 'utf8');
  } catch {
    return { ok: false, reason: 'push_batch_not_serializable' };
  }
  if (bytes > maxBytes) {
    return { ok: false, reason: 'push_batch_too_large' };
  }
  return { ok: true, bytes };
}

module.exports = {
  MUTATION_OPS,
  PUSH_BATCH_MAX_MUTATIONS,
  PUSH_BATCH_MAX_BYTES,
  WORKSPACE_PUSH_MAX_BYTES,
  REQUIRED_MUTATION_FIELDS,
  validateMutation,
  createMutation,
  assertPushBatchLimits,
};
