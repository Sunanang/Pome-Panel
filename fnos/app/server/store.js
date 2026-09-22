'use strict';

const crypto = require('node:crypto');
const {
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  hashSecret,
  generatePairingCode,
  generateDeviceTokenRaw,
  isValidPairingCodeFormat,
  computeTokenExpiresAt,
  maybeSlideTokenExpiry,
  isTokenExpired,
  publicDeviceRow,
} = require('./pairing');
const { createCsrfStore } = require('./csrf');

function createMemoryStore(options = {}) {
  const serverId = options.serverId || crypto.randomUUID();
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  const csrf = options.csrfStore || createCsrfStore();

  /** @type {Map<string, TokenRow>} tokenHash → row */
  const tokens = new Map();
  /** @type {Map<string, DeviceRow>} deviceId → row (includes tokenHash for revoke) */
  const devices = new Map();
  /** @type {Map<string, PairingRow>} codeHash → row */
  const pairingCodes = new Map();
  /** @type {Map<string, UidBucket>} */
  const byUid = new Map();

  function bucket(uid) {
    const key = String(uid);
    let b = byUid.get(key);
    if (!b) {
      b = {
        live: new Map(),
        tombstones: new Map(),
        changeLog: [],
        serverRev: 0,
        migrations: new Map(),
        accountSyncKey: null,
      };
      byUid.set(key, b);
    }
    return b;
  }

  function issueToken({ uid, deviceId, name, insecureBound = false, now } = {}) {
    const ts = now == null ? nowFn() : Number(now);
    const raw = generateDeviceTokenRaw();
    const device = String(deviceId || crypto.randomUUID());
    const expiresAt = computeTokenExpiresAt({ insecureBound, now: ts });
    const row = {
      uid: String(uid),
      deviceId: device,
      name: name ? String(name).slice(0, 80) : '',
      revokedAt: null,
      insecureBound: Boolean(insecureBound),
      createdAt: ts,
      lastUsedAt: ts,
      expiresAt,
      tokenHash: hashSecret(raw),
    };
    tokens.set(row.tokenHash, row);
    devices.set(device, row);
    return raw;
  }

  function issueTokenRecord({ uid, deviceId, name, insecureBound = false, now } = {}) {
    const ts = now == null ? nowFn() : Number(now);
    const raw = generateDeviceTokenRaw();
    const device = String(deviceId || crypto.randomUUID());
    const expiresAt = computeTokenExpiresAt({ insecureBound, now: ts });
    const row = {
      uid: String(uid),
      deviceId: device,
      name: name ? String(name).slice(0, 80) : '',
      revokedAt: null,
      insecureBound: Boolean(insecureBound),
      createdAt: ts,
      lastUsedAt: ts,
      expiresAt,
      tokenHash: hashSecret(raw),
    };
    tokens.set(row.tokenHash, row);
    devices.set(device, row);
    return { raw, deviceId: device, expiresAt, insecureBound: row.insecureBound, uid: row.uid };
  }

  function verifyToken(raw, { touch = true } = {}) {
    if (!raw) return null;
    const row = tokens.get(hashSecret(raw));
    if (!row || row.revokedAt) return null;
    const ts = nowFn();
    if (isTokenExpired(row, ts)) return null;
    if (touch) {
      row.lastUsedAt = ts;
      row.expiresAt = maybeSlideTokenExpiry(row, { now: ts });
    }
    return { ...row };
  }

  function revokeToken(raw) {
    const h = hashSecret(raw);
    const row = tokens.get(h);
    if (!row) return false;
    row.revokedAt = nowFn();
    return true;
  }

  function revokeDevice(uid, deviceId) {
    const row = devices.get(String(deviceId));
    if (!row || row.uid !== String(uid)) return { ok: false, reason: 'not_found' };
    if (row.revokedAt) return { ok: true, already: true, device: publicDeviceRow(row) };
    row.revokedAt = nowFn();
    return { ok: true, device: publicDeviceRow(row) };
  }

  function listDevices(uid) {
    const id = String(uid);
    return [...devices.values()]
      .filter((d) => d.uid === id && !d.revokedAt)
      .map(publicDeviceRow)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /**
   * Create a pairing code for an authenticated gateway session.
   * Stores only the hash; returns plaintext code once.
   */
  function startPairing({ uid, sessionId } = {}) {
    if (!uid) return { error: 'uid_required' };
    const code = generatePairingCode();
    const codeHash = hashSecret(code);
    const ts = nowFn();
    const codeId = crypto.randomUUID();
    const row = {
      codeId,
      codeHash,
      uid: String(uid),
      sessionId: sessionId ? String(sessionId) : null,
      createdAt: ts,
      expiresAt: ts + PAIRING_CODE_TTL_MS,
      attempts: 0,
      maxAttempts: PAIRING_MAX_ATTEMPTS,
      consumedAt: null,
      purpose: 'device_pair',
    };
    pairingCodes.set(codeHash, row);
    return {
      codeId,
      code,
      expiresAt: row.expiresAt,
      uid: row.uid,
    };
  }

  /**
   * Claim a pairing code → deviceToken in a single logical transaction.
   * Single-use: concurrent second claim fails.
   */
  function claimPairing({ code, deviceName, insecureBound = false } = {}) {
    if (!isValidPairingCodeFormat(code || '')) {
      return { error: 'invalid_code_format', status: 422 };
    }
    const trimmed = String(code).trim();
    const codeHash = hashSecret(trimmed);
    const row = pairingCodes.get(codeHash);
    if (!row) return { error: 'code_not_found', status: 404 };
    const ts = nowFn();
    if (row.consumedAt) return { error: 'code_consumed', status: 409 };
    if (row.expiresAt <= ts) {
      row.attempts += 1;
      return { error: 'code_expired', status: 410 };
    }
    if (row.attempts >= row.maxAttempts) return { error: 'code_locked', status: 429 };

    row.attempts += 1;
    const issued = issueTokenRecord({
      uid: row.uid,
      name: deviceName,
      insecureBound: Boolean(insecureBound),
      now: ts,
    });
    row.consumedAt = ts;
    row.deviceId = issued.deviceId;

    return {
      ok: true,
      deviceToken: issued.raw,
      deviceId: issued.deviceId,
      uid: row.uid,
      serverId,
      expiresAt: issued.expiresAt,
      insecureBound: Boolean(insecureBound),
      codeId: row.codeId,
      accountSyncKey: getOrCreateAccountSyncKey(row.uid),
    };
  }

  /**
   * Per-uid key for sealing workspace secrets. Returned only to an authenticated
   * device. Never written into entity payloads.
   */
  function getOrCreateAccountSyncKey(uid) {
    const b = bucket(uid);
    if (!b.accountSyncKey) {
      b.accountSyncKey = crypto.randomBytes(32).toString('base64');
    }
    return b.accountSyncKey;
  }

  /** Test helper: peek pairing row by plaintext code (never expose in HTTP). */
  function _peekPairingByCode(code) {
    return pairingCodes.get(hashSecret(String(code).trim())) || null;
  }

  function syncState(uid) {
    const b = bucket(uid);
    const live = b.live.size;
    const tombstones = b.tombstones.size;
    const changeLogCount = b.changeLog.length;
    const pristine = live === 0 && tombstones === 0 && changeLogCount === 0 && b.serverRev === 0;
    let latestUpdatedAt = null;
    for (const ent of b.live.values()) {
      if (ent.updatedAt && (!latestUpdatedAt || ent.updatedAt > latestUpdatedAt)) {
        latestUpdatedAt = ent.updatedAt;
      }
    }
    return {
      live,
      tombstones,
      changeLogCount,
      serverRev: b.serverRev,
      pristine,
      latestUpdatedAt,
    };
  }

  function startMigration(uid, { snapshotServerRev } = {}) {
    const b = bucket(uid);
    const migrationId = crypto.randomUUID();
    const snap = snapshotServerRev == null ? b.serverRev : Number(snapshotServerRev);
    const row = {
      migrationId,
      snapshotServerRev: snap,
      state: 'pending',
      serverRev: b.serverRev,
      backupId: null,
      createdAt: nowFn(),
    };
    b.migrations.set(migrationId, row);
    return { ...row };
  }

  function getMigration(uid, migrationId) {
    return bucket(uid).migrations.get(String(migrationId)) || null;
  }

  function commitMigration(uid, {
    migrationId,
    expectedServerRev,
    authority,
    entities,
    deviceId,
  } = {}) {
    const b = bucket(uid);
    const row = b.migrations.get(String(migrationId));
    if (!row) return { error: 'not_found' };
    if (Number(expectedServerRev) !== b.serverRev) {
      return { error: 'cas_conflict', currentServerRev: b.serverRev };
    }
    if (row.state === 'committed' || row.state === 'applied') {
      return { ok: true, migration: { ...row } };
    }

    row.backupId = row.backupId || `bak-${migrationId}`;
    row.authority = authority === 'local' || authority === 'nas' ? authority : 'nas';

    if (row.authority === 'local' && Array.isArray(entities)) {
      // Snapshot current NAS live into change-log as deletes, then upsert local entities.
      const ts = nowFn();
      for (const entityId of [...b.live.keys()]) {
        b.serverRev += 1;
        b.live.delete(entityId);
        b.tombstones.set(entityId, { entityId, serverRev: b.serverRev, deletedAt: ts });
        b.changeLog.push({
          serverRev: b.serverRev,
          entityId,
          collection: 'todos',
          op: 'delete',
          clientMutationId: `mig-del-${migrationId}-${entityId}`,
          deviceId: deviceId || 'migration',
        });
      }
      for (const ent of entities) {
        if (!ent || !ent.entityId) continue;
        if (ent.op === 'delete') continue;
        b.serverRev += 1;
        b.tombstones.delete(ent.entityId);
        b.live.set(ent.entityId, {
          entityId: ent.entityId,
          collection: ent.collection || 'todos',
          payload: ent.payload || {},
          serverRev: b.serverRev,
          updatedAt: ts,
        });
        b.changeLog.push({
          serverRev: b.serverRev,
          entityId: ent.entityId,
          collection: ent.collection || 'todos',
          op: 'upsert',
          clientMutationId: `mig-up-${migrationId}-${ent.entityId}`,
          deviceId: deviceId || 'migration',
          payload: ent.payload || {},
        });
      }
    }

    row.state = 'committed';
    row.serverRev = b.serverRev;
    return { ok: true, migration: { ...row } };
  }

  function applyPush(uid, mutations, { deviceId } = {}) {
    const b = bucket(uid);
    const applied = [];
    const seen = new Set();
    for (const m of mutations) {
      const key = `${deviceId || m.deviceId}:${m.clientMutationId}`;
      if (seen.has(key)) {
        applied.push({ clientMutationId: m.clientMutationId, status: 'duplicate' });
        continue;
      }
      seen.add(key);
      b.serverRev += 1;
      const rev = b.serverRev;
      if (m.op === 'delete') {
        b.live.delete(m.entityId);
        b.tombstones.set(m.entityId, { entityId: m.entityId, serverRev: rev, deletedAt: nowFn() });
      } else {
        b.tombstones.delete(m.entityId);
        b.live.set(m.entityId, {
          entityId: m.entityId,
          collection: m.collection || 'todos',
          payload: m.payload || {},
          serverRev: rev,
          updatedAt: nowFn(),
        });
      }
      b.changeLog.push({
        serverRev: rev,
        entityId: m.entityId,
        collection: m.collection || 'todos',
        op: m.op,
        clientMutationId: m.clientMutationId,
        deviceId: deviceId || m.deviceId,
      });
      applied.push({ clientMutationId: m.clientMutationId, status: 'applied', serverRev: rev });
    }
    return { applied, serverRev: b.serverRev };
  }

  function pull(uid, { cursor, collection } = {}) {
    const b = bucket(uid);
    const after = cursor == null || cursor === '' ? 0 : Number(cursor);
    const matched = b.changeLog.filter((c) => {
      if (c.serverRev <= after) return false;
      if (!collection) return true;
      return (c.collection || 'todos') === collection;
    });
    const changes = matched
      .slice(0, 500)
      .map((c) => {
        if (c.op === 'delete') {
          return { ...c, tombstone: true };
        }
        const ent = b.live.get(c.entityId);
        return { ...c, payload: ent ? ent.payload : undefined };
      });
    const nextCursor = changes.length ? String(changes[changes.length - 1].serverRev) : String(after);
    const hasMore = matched.length > changes.length;
    return {
      changes,
      nextCursor,
      hasMore,
      serverRev: b.serverRev,
    };
  }

  return {
    serverId,
    csrf,
    issueToken,
    issueTokenRecord,
    verifyToken,
    revokeToken,
    revokeDevice,
    listDevices,
    startPairing,
    claimPairing,
    getOrCreateAccountSyncKey,
    _peekPairingByCode,
    syncState,
    startMigration,
    getMigration,
    commitMigration,
    applyPush,
    pull,
    bucket,
    // test seams
    _tokens: tokens,
    _devices: devices,
    _pairingCodes: pairingCodes,
  };
}

module.exports = {
  createMemoryStore,
  hashToken: hashSecret,
};
