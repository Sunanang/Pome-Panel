'use strict';

/**
 * Trust boundary helpers for FPK gateway vs device-port paths.
 *
 * - Gateway (Unix socket / controlled reverse proxy): trust X-Trim-* only after
 *   client-supplied same-name headers are stripped and the gateway re-injects them.
 * - Device TCP port: NEVER trust X-Trim-*; only deviceToken (Bearer).
 */

const TRIM_USERID = 'x-trim-userid';
const TRIM_USERNAME = 'x-trim-username';

function normalizeHeaderMap(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

/**
 * Simulate / apply gateway entry hygiene: drop client X-Trim-*, then optionally re-inject.
 * Used by tests and by a future reverse-proxy adapter; device-port paths must not call this
 * with inject values derived from client headers.
 */
function applyGatewayTrimHygiene(headers, { injectUid, injectUsername } = {}) {
  const cleaned = normalizeHeaderMap(headers);
  delete cleaned[TRIM_USERID];
  delete cleaned[TRIM_USERNAME];
  if (injectUid != null && injectUid !== '') {
    cleaned[TRIM_USERID] = String(injectUid);
  }
  if (injectUsername != null && injectUsername !== '') {
    cleaned[TRIM_USERNAME] = String(injectUsername);
  }
  return cleaned;
}

function stripTrimHeaders(headers) {
  const cleaned = normalizeHeaderMap(headers);
  delete cleaned[TRIM_USERID];
  delete cleaned[TRIM_USERNAME];
  return cleaned;
}

function readTrimIdentity(headers) {
  const h = normalizeHeaderMap(headers);
  const uid = h[TRIM_USERID];
  const username = h[TRIM_USERNAME];
  if (uid == null || uid === '') return null;
  return { uid: String(uid), username: username != null ? String(username) : undefined };
}

function parseBearer(authorization) {
  if (!authorization || typeof authorization !== 'string') return null;
  const m = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  return m ? m[1] : null;
}

/**
 * Resolve request identity for a given listen mode.
 * @param {'gateway'|'device-port'} listenMode
 */
function resolveIdentity(reqHeaders, { listenMode, store }) {
  const headers = normalizeHeaderMap(reqHeaders);
  const bearer = parseBearer(headers.authorization);
  const tokenInfo = bearer ? store.verifyToken(bearer) : null;

  if (listenMode === 'device-port') {
    // Never trust X-Trim-* on TCP device port, even if present.
    if (!tokenInfo) {
      return {
        ok: false,
        status: 401,
        reason: 'device_token_required',
        authMode: null,
        uid: null,
        tokenAccepted: false,
      };
    }
    return {
      ok: true,
      status: 200,
      authMode: 'deviceToken',
      uid: tokenInfo.uid,
      deviceId: tokenInfo.deviceId,
      tokenAccepted: true,
      insecureBound: Boolean(tokenInfo.insecureBound),
    };
  }

  // gateway mode
  const trim = readTrimIdentity(headers);
  if (tokenInfo && trim && tokenInfo.uid !== trim.uid) {
    return {
      ok: false,
      status: 403,
      reason: 'uid_mismatch',
      authMode: 'conflict',
      uid: null,
      tokenAccepted: true,
    };
  }
  if (tokenInfo) {
    return {
      ok: true,
      status: 200,
      authMode: 'deviceToken',
      uid: tokenInfo.uid,
      deviceId: tokenInfo.deviceId,
      tokenAccepted: true,
      insecureBound: Boolean(tokenInfo.insecureBound),
      gatewayUid: trim ? trim.uid : undefined,
    };
  }
  if (trim) {
    return {
      ok: true,
      status: 200,
      authMode: 'gatewaySession',
      uid: trim.uid,
      username: trim.username,
      tokenAccepted: false,
    };
  }
  return {
    ok: false,
    status: 401,
    reason: 'unauthenticated',
    authMode: null,
    uid: null,
    tokenAccepted: false,
  };
}

module.exports = {
  TRIM_USERID,
  TRIM_USERNAME,
  normalizeHeaderMap,
  applyGatewayTrimHygiene,
  stripTrimHeaders,
  readTrimIdentity,
  parseBearer,
  resolveIdentity,
};
