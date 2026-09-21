'use strict';

const { schemaEnvelope, isSchemaCompatible, SCHEMA_VERSION } = require('./schema');
const { resolveIdentity, normalizeHeaderMap } = require('./auth');
const { validatePairOrigin, readCsrfHeader } = require('./csrf');

function sendJson(res, status, body) {
  const payload = JSON.stringify({ ...schemaEnvelope(), ...body });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Redact secrets from log-oriented fields — never put code/token in URL or error bodies echoed to logs by callers. */
function assertNoSecretLeak(body, secrets = []) {
  const text = JSON.stringify(body);
  for (const secret of secrets) {
    if (secret && text.includes(secret)) {
      throw Object.assign(new Error('secret_leak_guard'), { statusCode: 500 });
    }
  }
}

function readJsonBody(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('payload_too_large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('invalid_json'), { statusCode: 422, cause: err }));
      }
    });
    req.on('error', reject);
  });
}

function parseUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `http://${host}`);
}

function validateMutationShape(m) {
  if (!m || typeof m !== 'object') return 'mutation_not_object';
  const required = [
    'schemaVersion',
    'collection',
    'entityId',
    'op',
    'clientMutationId',
    'deviceId',
    'baseServerRev',
    'clientTime',
  ];
  for (const key of required) {
    if (m[key] === undefined || m[key] === null || m[key] === '') return `missing_${key}`;
  }
  if (m.op !== 'upsert' && m.op !== 'delete') return 'invalid_op';
  if (m.collection !== 'todos') return 'collection_not_enabled';
  if (!isSchemaCompatible(m.schemaVersion)) return 'schema_incompatible';
  return null;
}

function createRequestHandler({ store, listenMode, allowedOrigins } = {}) {
  return async function handle(req, res) {
    const url = parseUrl(req);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // Effective headers: device-port ignores X-Trim-* entirely (never trust).
    let headers = normalizeHeaderMap(req.headers);
    if (listenMode === 'device-port') {
      delete headers['x-trim-userid'];
      delete headers['x-trim-username'];
    }

    try {
      if (method === 'GET' && path === '/api/v1/health') {
        sendJson(res, 200, {
          ok: true,
          serverId: store.serverId,
          gatewayMode: listenMode === 'gateway',
          listenMode,
        });
        return;
      }

      if (method === 'GET' && path === '/api/v1/me') {
        if (listenMode === 'device-port') {
          // Device port has no gateway session; do not use /me for binding checks.
          sendJson(res, 404, { error: 'me_unavailable_on_device_port' });
          return;
        }
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok || id.authMode !== 'gatewaySession') {
          // Prefer gateway session for /me; bare token alone is not a Web session.
          if (!id.ok) {
            sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
            return;
          }
          sendJson(res, 401, { error: 'gateway_session_required' });
          return;
        }
        sendJson(res, 200, { uid: id.uid, username: id.username });
        return;
      }

      if (method === 'GET' && path === '/api/v1/auth-probe') {
        if (listenMode === 'device-port') {
          const id = resolveIdentity(headers, { listenMode, store });
          sendJson(res, id.ok ? 200 : id.status, {
            authMode: id.authMode,
            uid: id.uid,
            tokenAccepted: Boolean(id.tokenAccepted),
            ...(id.ok ? {} : { error: id.reason }),
          });
          return;
        }
        const bearerId = resolveIdentity(headers, { listenMode, store });
        if (bearerId.tokenAccepted && bearerId.ok) {
          sendJson(res, 200, {
            authMode: 'deviceToken',
            uid: bearerId.uid,
            tokenAccepted: true,
          });
          return;
        }
        if (bearerId.reason === 'uid_mismatch') {
          sendJson(res, 403, {
            authMode: 'conflict',
            uid: null,
            tokenAccepted: true,
            error: 'uid_mismatch',
          });
          return;
        }
        // No / invalid token on gateway: report probe failure without echoing secrets.
        sendJson(res, 401, {
          authMode: null,
          uid: null,
          tokenAccepted: false,
          error: 'token_required',
        });
        return;
      }

      // --- Pairing / devices (T3) -------------------------------------------------

      if (method === 'GET' && path === '/api/v1/pair/csrf') {
        if (listenMode === 'device-port') {
          sendJson(res, 404, { error: 'pair_start_gateway_only' });
          return;
        }
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok || id.authMode !== 'gatewaySession') {
          sendJson(res, id.ok ? 401 : id.status, { error: 'gateway_session_required' });
          return;
        }
        const csrfToken = store.csrf.issue(id.uid);
        sendJson(res, 200, { csrfToken, expiresInSec: 1800 });
        return;
      }

      if (method === 'POST' && path === '/api/v1/pair/start') {
        if (listenMode === 'device-port') {
          sendJson(res, 404, { error: 'pair_start_gateway_only' });
          return;
        }
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok || id.authMode !== 'gatewaySession') {
          sendJson(res, id.ok ? 401 : id.status, { error: 'gateway_session_required' });
          return;
        }
        const originCheck = validatePairOrigin(headers.origin, {
          allowedOrigins,
          requestHost: headers.host,
        });
        if (!originCheck.ok) {
          sendJson(res, 403, { error: originCheck.reason });
          return;
        }
        const csrfHeader = readCsrfHeader(headers);
        const csrfResult = store.csrf.consume(csrfHeader, id.uid);
        if (!csrfResult.ok) {
          sendJson(res, 403, { error: csrfResult.reason });
          return;
        }
        // Code must never appear in the URL (POST body empty / unused).
        if (url.searchParams.has('code') || url.searchParams.has('pairingCode')) {
          sendJson(res, 400, { error: 'code_must_not_be_in_url' });
          return;
        }
        const started = store.startPairing({ uid: id.uid });
        if (started.error) {
          sendJson(res, 422, { error: started.error });
          return;
        }
        // Response includes code exactly once for the logged-in Web UI; never log it.
        const body = {
          codeId: started.codeId,
          pairingCode: started.code,
          expiresAt: started.expiresAt,
        };
        assertNoSecretLeak({ codeId: body.codeId, expiresAt: body.expiresAt }, [started.code]);
        sendJson(res, 200, body);
        return;
      }

      if (
        method === 'POST'
        && (path === '/api/v1/pair/claim' || path === '/api/v1/pair/complete')
      ) {
        let body;
        try {
          body = (await readJsonBody(req, { maxBytes: 16 * 1024 })) || {};
        } catch (err) {
          sendJson(res, err.statusCode || 422, { error: err.message });
          return;
        }
        if (url.searchParams.has('code') || url.searchParams.has('pairingCode')) {
          sendJson(res, 400, { error: 'code_must_not_be_in_url' });
          return;
        }
        const result = store.claimPairing({
          code: body.pairingCode || body.code,
          deviceName: body.deviceName || body.name,
          insecureBound: Boolean(body.insecureBound),
        });
        if (!result.ok) {
          sendJson(res, result.status || 400, { error: result.error });
          return;
        }
        const response = {
          deviceToken: result.deviceToken,
          deviceId: result.deviceId,
          uid: result.uid,
          serverId: result.serverId,
          expiresAt: result.expiresAt,
          insecureBound: result.insecureBound,
        };
        sendJson(res, 200, response);
        return;
      }

      if (method === 'GET' && path === '/api/v1/devices') {
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok) {
          sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
          return;
        }
        sendJson(res, 200, { devices: store.listDevices(id.uid) });
        return;
      }

      {
        const revokeMatch = /^\/api\/v1\/devices\/([^/]+)\/revoke$/.exec(path);
        if (method === 'POST' && revokeMatch) {
          const id = resolveIdentity(headers, { listenMode, store });
          if (!id.ok) {
            sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
            return;
          }
          const deviceId = decodeURIComponent(revokeMatch[1]);
          const result = store.revokeDevice(id.uid, deviceId);
          if (!result.ok) {
            sendJson(res, 404, { error: result.reason || 'not_found' });
            return;
          }
          sendJson(res, 200, { ok: true, device: result.device });
          return;
        }
      }

      if (method === 'GET' && path === '/api/v1/sync/state') {
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok) {
          sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
          return;
        }
        const collection = url.searchParams.get('collection') || 'todos';
        if (collection !== 'todos') {
          sendJson(res, 422, { error: 'collection_not_enabled' });
          return;
        }
        sendJson(res, 200, { collection, ...store.syncState(id.uid) });
        return;
      }

      if (method === 'POST' && path === '/api/v1/migration/start') {
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok) {
          sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
          return;
        }
        const body = (await readJsonBody(req)) || {};
        const row = store.startMigration(id.uid, {
          snapshotServerRev: body.snapshotServerRev,
        });
        sendJson(res, 200, {
          migrationId: row.migrationId,
          snapshotServerRev: row.snapshotServerRev,
          state: row.state,
        });
        return;
      }

      if (method === 'POST' && path === '/api/v1/migration/commit') {
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok) {
          sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
          return;
        }
        const body = (await readJsonBody(req)) || {};
        if (!body.migrationId || body.expectedServerRev == null) {
          sendJson(res, 422, { error: 'missing_migration_fields' });
          return;
        }
        const result = store.commitMigration(id.uid, {
          migrationId: body.migrationId,
          expectedServerRev: body.expectedServerRev,
        });
        if (result.error === 'not_found') {
          sendJson(res, 404, { error: 'migration_not_found' });
          return;
        }
        if (result.error === 'cas_conflict') {
          sendJson(res, 409, {
            error: 'cas_conflict',
            currentServerRev: result.currentServerRev,
          });
          return;
        }
        sendJson(res, 200, {
          state: result.migration.state,
          serverRev: result.migration.serverRev,
          backupId: result.migration.backupId,
        });
        return;
      }

      {
        const migMatch = /^\/api\/v1\/migration\/([^/]+)$/.exec(path);
        if (method === 'GET' && migMatch) {
          const id = resolveIdentity(headers, { listenMode, store });
          if (!id.ok) {
            sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
            return;
          }
          const row = store.getMigration(id.uid, decodeURIComponent(migMatch[1]));
          if (!row) {
            sendJson(res, 404, { error: 'migration_not_found' });
            return;
          }
          sendJson(res, 200, {
            state: row.state,
            serverRev: row.serverRev,
            migrationId: row.migrationId,
            snapshotServerRev: row.snapshotServerRev,
          });
          return;
        }
      }

      if (method === 'POST' && path === '/api/v1/sync/push') {
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok) {
          sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
          return;
        }
        let body;
        try {
          body = (await readJsonBody(req, { maxBytes: 1024 * 1024 })) || {};
        } catch (err) {
          sendJson(res, err.statusCode || 422, { error: err.message });
          return;
        }
        const mutations = Array.isArray(body.mutations) ? body.mutations : null;
        if (!mutations) {
          sendJson(res, 422, { error: 'mutations_required' });
          return;
        }
        if (mutations.length > 500) {
          sendJson(res, 413, { error: 'batch_too_large' });
          return;
        }
        for (const m of mutations) {
          const shapeErr = validateMutationShape(m);
          if (shapeErr) {
            sendJson(res, shapeErr === 'schema_incompatible' ? 422 : 422, {
              error: shapeErr,
              schemaVersion: SCHEMA_VERSION,
            });
            return;
          }
        }
        const result = store.applyPush(id.uid, mutations, { deviceId: id.deviceId });
        sendJson(res, 200, result);
        return;
      }

      if (method === 'GET' && path === '/api/v1/sync/pull') {
        const id = resolveIdentity(headers, { listenMode, store });
        if (!id.ok) {
          sendJson(res, id.status, { error: id.reason || 'unauthenticated' });
          return;
        }
        const cursor = url.searchParams.get('cursor');
        sendJson(res, 200, store.pull(id.uid, { cursor }));
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { error: err.message || 'internal_error' });
    }
  };
}

module.exports = {
  createRequestHandler,
  sendJson,
  readJsonBody,
  validateMutationShape,
};
