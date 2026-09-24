'use strict';

/**
 * Schema negotiation for FPK. Source of truth is packages/sync-protocol,
 * vendored beside this server at ../packages/sync-protocol.
 * Do not duplicate SCHEMA_VERSION / min / max constants locally.
 */
const path = require('node:path');
const protocol = require(path.join(__dirname, '..', 'packages', 'sync-protocol'));

const SCHEMA_VERSION = protocol.SCHEMA_VERSION;
const MIN_SUPPORTED = protocol.MIN_SUPPORTED_SCHEMA_VERSION;
const MAX_SUPPORTED = protocol.MAX_SUPPORTED_SCHEMA_VERSION;

function schemaEnvelope(overrides = {}) {
  return protocol.schemaEnvelope({
    schemaVersion: overrides.schemaVersion ?? SCHEMA_VERSION,
    minSupported: overrides.minSupported ?? MIN_SUPPORTED,
    maxSupported: overrides.maxSupported ?? MAX_SUPPORTED,
  });
}

function isSchemaCompatible(clientVersion) {
  const n = Number(clientVersion);
  if (!Number.isFinite(n)) return false;
  return n >= MIN_SUPPORTED && n <= MAX_SUPPORTED;
}

/**
 * Server-side check of a client-advertised range (pair / health probe body).
 * Returns the same stopPull/stopPush flags the desktop client uses.
 */
function evaluateClientSchema(clientPeer) {
  return protocol.evaluateSchemaNegotiation(clientPeer, {
    minSupported: MIN_SUPPORTED,
    maxSupported: MAX_SUPPORTED,
  });
}

module.exports = {
  SCHEMA_VERSION,
  MIN_SUPPORTED,
  MAX_SUPPORTED,
  schemaEnvelope,
  isSchemaCompatible,
  evaluateClientSchema,
  evaluateSchemaNegotiation: protocol.evaluateSchemaNegotiation,
  negotiateSchema: protocol.negotiateSchema,
};
