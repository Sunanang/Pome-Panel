'use strict';

/**
 * Schema negotiation for FPK — single source of truth is packages/sync-protocol.
 * Do not duplicate SCHEMA_VERSION / min / max constants locally.
 */
const path = require('node:path');
const protocol = require(path.join(__dirname, '..', '..', '..', 'packages', 'sync-protocol'));

const SCHEMA_VERSION = protocol.SCHEMA_VERSION;
const MIN_SUPPORTED = protocol.MIN_SUPPORTED_SCHEMA_VERSION;
const MAX_SUPPORTED = protocol.MAX_SUPPORTED_SCHEMA_VERSION;

function schemaEnvelope() {
  return {
    schemaVersion: SCHEMA_VERSION,
    minSupported: MIN_SUPPORTED,
    maxSupported: MAX_SUPPORTED,
  };
}

function isSchemaCompatible(clientVersion) {
  const n = Number(clientVersion);
  if (!Number.isFinite(n)) return false;
  return n >= MIN_SUPPORTED && n <= MAX_SUPPORTED;
}

module.exports = {
  SCHEMA_VERSION,
  MIN_SUPPORTED,
  MAX_SUPPORTED,
  schemaEnvelope,
  isSchemaCompatible,
};
