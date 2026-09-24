'use strict';

const { isNonNegativeInt } = require('./schema');

/** Suggested pull page size (server may still reject oversize). */
const PULL_PAGE_MAX_CHANGES = 500;

const REQUIRED_PULL_FIELDS = Object.freeze([
  'changes',
  'nextCursor',
  'hasMore',
  'serverRev',
]);

/**
 * Opaque pull cursor: high-water mark encoded as a non-empty string, or null
 * when the client has no prior cursor (initial pull). Clients must not parse
 * cursor contents; only compare / store / resend.
 *
 * @param {unknown} cursor
 * @returns {boolean}
 */
function isValidPullCursor(cursor) {
  if (cursor === null) return true;
  return typeof cursor === 'string' && cursor.length > 0;
}

/**
 * Validate a pull response envelope.
 * `nextCursor` is an opaque high-water mark; `serverRev` is the uid-global
 * monotonic revision after this page.
 *
 * @param {unknown} input
 * @returns {{ ok: true, pull: object } | { ok: false, reason: string, field?: string }}
 */
function validatePullResponse(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'pull_not_object' };
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (!REQUIRED_PULL_FIELDS.includes(key)) {
      return { ok: false, reason: 'pull_unknown_field', field: key };
    }
  }
  for (const field of REQUIRED_PULL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      return { ok: false, reason: 'pull_missing_field', field };
    }
  }

  if (!Array.isArray(input.changes)) {
    return { ok: false, reason: 'pull_changes_invalid', field: 'changes' };
  }
  if (input.changes.length > PULL_PAGE_MAX_CHANGES) {
    return { ok: false, reason: 'pull_page_too_large', field: 'changes' };
  }
  if (typeof input.hasMore !== 'boolean') {
    return { ok: false, reason: 'pull_has_more_invalid', field: 'hasMore' };
  }
  if (!isNonNegativeInt(input.serverRev)) {
    return { ok: false, reason: 'pull_server_rev_invalid', field: 'serverRev' };
  }
  if (!isValidPullCursor(input.nextCursor)) {
    return { ok: false, reason: 'pull_next_cursor_invalid', field: 'nextCursor' };
  }
  if (input.hasMore && input.nextCursor === null) {
    return { ok: false, reason: 'pull_has_more_without_cursor', field: 'nextCursor' };
  }

  return {
    ok: true,
    pull: {
      changes: input.changes,
      nextCursor: input.nextCursor,
      hasMore: input.hasMore,
      serverRev: input.serverRev,
    },
  };
}

/**
 * Validate a client pull request cursor argument.
 *
 * @param {unknown} cursor
 * @returns {{ ok: true, cursor: string | null } | { ok: false, reason: string }}
 */
function validatePullCursor(cursor) {
  if (!isValidPullCursor(cursor)) {
    return { ok: false, reason: 'pull_cursor_invalid' };
  }
  return { ok: true, cursor };
}

module.exports = {
  PULL_PAGE_MAX_CHANGES,
  REQUIRED_PULL_FIELDS,
  isValidPullCursor,
  validatePullResponse,
  validatePullCursor,
};
