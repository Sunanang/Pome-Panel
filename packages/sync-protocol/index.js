'use strict';

/**
 * @pome-panel/sync-protocol
 *
 * Shared contract for desktop (Electron) and fnOS FPK. Pure CommonJS, no build.
 * Consumers should relative-require this package:
 *   require('./packages/sync-protocol')           // from repo root / main process
 *   require('../../packages/sync-protocol')       // from nested paths
 *
 * Not an npm workspace member — keep packaging light; electron-builder
 * `build.files` must whitelist packages/sync-protocol (recursive glob).
 */

const schema = require('./schema');
const collections = require('./collections');
const mutation = require('./mutation');
const pull = require('./pull');
const pairing = require('./pairing');

module.exports = {
  ...schema,
  ...collections,
  ...mutation,
  ...pull,
  ...pairing,
};
