'use strict';

/**
 * Sync collection names.
 * P0 enables only `todos`. Other names are placeholders and must not be wired
 * into push/pull until their P1/P2 phase.
 */
const COLLECTIONS = Object.freeze({
  TODOS: 'todos',
  NOTES: 'notes',
  LINKS: 'links',
  COMMANDS: 'commands',
  HOME_LAYOUT: 'homeLayout',
  CLIPBOARD_HISTORY: 'clipboardHistory',
});

/** Collections allowed for P0 sync I/O. */
const P0_ENABLED_COLLECTIONS = Object.freeze([COLLECTIONS.TODOS]);

const ALL_COLLECTION_NAMES = Object.freeze(Object.values(COLLECTIONS));

/**
 * @param {unknown} name
 * @returns {name is string}
 */
function isKnownCollection(name) {
  return typeof name === 'string' && ALL_COLLECTION_NAMES.includes(name);
}

/**
 * @param {unknown} name
 * @returns {boolean}
 */
function isP0EnabledCollection(name) {
  return typeof name === 'string' && P0_ENABLED_COLLECTIONS.includes(name);
}

/**
 * @param {unknown} name
 * @returns {{ ok: true, collection: string } | { ok: false, reason: string }}
 */
function assertP0Collection(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'collection_missing' };
  }
  if (!isKnownCollection(name)) {
    return { ok: false, reason: 'collection_unknown' };
  }
  if (!isP0EnabledCollection(name)) {
    return { ok: false, reason: 'collection_not_enabled' };
  }
  return { ok: true, collection: name };
}

module.exports = {
  COLLECTIONS,
  P0_ENABLED_COLLECTIONS,
  ALL_COLLECTION_NAMES,
  isKnownCollection,
  isP0EnabledCollection,
  assertP0Collection,
};
