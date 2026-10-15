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
const SYNC_COLLECTIONS = ['todos', 'notes', 'links', 'commands', 'clipboardHistory', 'recordings', 'aiSettings', 'secrets'];
const DAY = 86400000;
const { createCsrfStore } = require('./csrf');

const WORKSPACE_ENTITY_PREFIXES = [
  ['note:', 'notes'],
  ['link:', 'links'],
  ['command:', 'commands'],
  ['clip:', 'clipboardHistory'],
  ['recording-blob:', 'recordings'],
  ['recording:', 'recordings'],
  ['secret:', 'secrets'],
  ['ai:', 'aiSettings'],
];

/** Earlier builds tagged migration deletes of workspace rows as `todos`; the entity prefix wins. */
function changeCollection(change) {
  const id = String((change && change.entityId) || '');
  const tagged = change && change.collection ? String(change.collection) : 'todos';
  if (tagged !== 'todos') return tagged;
  for (const [prefix, collection] of WORKSPACE_ENTITY_PREFIXES) {
    if (id.startsWith(prefix)) return collection;
  }
  return 'todos';
}

function createMemoryStore(options = {}) {
  const serverId = options.serverId || crypto.randomUUID();
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  const retentionMs = options.retentionMs ?? 90 * DAY;
  const rollbackWindowMs = options.rollbackWindowMs ?? 30 * DAY;
  if (!Number.isFinite(retentionMs) || retentionMs <= 0 || !Number.isFinite(rollbackWindowMs) || rollbackWindowMs <= 0) throw new Error('invalid_retention_policy');
  const snapshots = new Map(); // bounded-lived full pulls; not a second durable database
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
        mutationResults: new Map(),
        logFloor: 0, mutationFloor: 0,
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
    const ts = nowFn();
    const codeId = crypto.randomUUID();
    const expiresAt = ts + PAIRING_CODE_TTL_MS;
    const publicMetadata = JSON.stringify({ codeId, expiresAt });
    // Keep the route's leak guard intact when independent public metadata
    // happens to contain the same six digits as the random secret.
    let code;
    do { code = generatePairingCode(); } while (publicMetadata.includes(code));
    const codeHash = hashSecret(code);
    const row = {
      codeId,
      codeHash,
      uid: String(uid),
      sessionId: sessionId ? String(sessionId) : null,
      createdAt: ts,
      expiresAt,
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

  function peekAccountSyncKey(uid) {
    const existing = byUid.get(String(uid));
    return existing && existing.accountSyncKey ? existing.accountSyncKey : null;
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
      for (const [entityId, prev] of [...b.live.entries()]) {
        b.serverRev += 1;
        b.live.delete(entityId);
        b.tombstones.set(entityId, { entityId, serverRev: b.serverRev, deletedAt: ts });
        b.changeLog.push({
          serverRev: b.serverRev,
          entityId,
          collection: changeCollection({ entityId, collection: prev && prev.collection }),
          op: 'delete',
          at: ts,
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
          deviceId: deviceId || 'migration',
        });
        b.changeLog.push({
          serverRev: b.serverRev,
          entityId: ent.entityId,
          collection: ent.collection || 'todos',
          op: 'upsert',
          at: ts,
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
    const floor = Math.max(b.mutationFloor || 0, b.logFloor || 0);
    const needsRebase = mutations.some(m => {
      const base = Number(m.baseServerRev) || 0;
      return !b.mutationResults.has(JSON.stringify([deviceId || m.deviceId, m.clientMutationId])) && (base < floor || base > b.serverRev);
    });
    if (needsRebase) return { applied: mutations.map(m => ({ clientMutationId: m.clientMutationId, status: 'expired', error: 'mutation_expired_resync_required', serverRev: b.serverRev })), serverRev: b.serverRev };
    for (const m of mutations) {
      const key = JSON.stringify([deviceId || m.deviceId, m.clientMutationId]);
      if (b.mutationResults.has(key)) {
        applied.push({ clientMutationId: m.clientMutationId, status: 'duplicate', serverRev: b.mutationResults.get(key).serverRev ?? b.mutationResults.get(key) });
        continue;
      }
      const existing = b.live.get(m.entityId);
      const tombstone = b.tombstones.get(m.entityId);
      if (m.collection === 'notes' && tombstone && tombstone.serverRev > (Number(m.baseServerRev) || 0) && m.op !== 'delete') { applied.push({ clientMutationId: m.clientMutationId, status: 'conflict', serverRev: tombstone.serverRev }); continue; }
      if (m.collection === 'notes' && existing && existing.serverRev > (Number(m.baseServerRev) || 0) && m.op !== 'delete' && JSON.stringify(existing.payload) !== JSON.stringify(m.payload)) {
        applied.push({ clientMutationId: m.clientMutationId, status: 'conflict', serverRev: existing.serverRev }); continue;
      }
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
          deviceId: deviceId || m.deviceId,
        });
      }
      b.changeLog.push({
        serverRev: rev,
        at: nowFn(),
        entityId: m.entityId,
        collection: m.collection || 'todos',
        op: m.op,
        clientMutationId: m.clientMutationId,
        deviceId: deviceId || m.deviceId,
      });
      applied.push({ clientMutationId: m.clientMutationId, status: 'applied', serverRev: rev });
      b.mutationResults.set(key, { serverRev: rev, at: nowFn() });
    }
    return { applied, serverRev: b.serverRev };
  }

  function pull(uid, { cursor, collection, deviceId, full = false } = {}) {
    const b = bucket(uid);
    if (full || String(cursor || '').startsWith('full:')) return fullPull(uid, { cursor, collection, deviceId, full });
    const after = cursor == null || cursor === '' ? 0 : Number(cursor);
    if (!Number.isSafeInteger(after) || after < 0 || after > b.serverRev) return { error: 'invalid_cursor', status: 422 };
    if (after < (b.logFloor || 0)) return { error: 'full_resync_required', status: 409, logFloor: b.logFloor, serverRev: b.serverRev };
    const device = devices.get(deviceId);
    if (device && device.uid === String(uid) && !device.revokedAt) {
      const key = collection || '*';
      const old = device.ackCursors?.[key] || 0;
      if (after > old) device.ackCursors = { ...device.ackCursors, [key]: after };
    }
    return incrementalPull(uid, { cursor, collection });
  }

  function fullPull(uid, { cursor, collection, deviceId, full }) {
    const ts = nowFn();
    for (const [id, row] of snapshots) if (row.expiresAt <= ts) snapshots.delete(id);
    let snapshot, offset = 0, id;
    if (full && !String(cursor || '').startsWith('full:')) {
      // Limit concurrent snapshots per device/collection; restarting a failed full
      // pull cannot accumulate copies of audio forever.
      for (const [key, row] of snapshots) if (row.uid === String(uid) && row.deviceId === deviceId && row.collection === collection) snapshots.delete(key);
      const b = bucket(uid);
      const changes = [...b.live.values()].filter(e => !collection || changeCollection(e) === collection).map(e => {
        const writer = devices.get(e.deviceId);
        return { entityId: e.entityId, collection: changeCollection(e), op: 'upsert', payload: e.payload, serverRev: e.serverRev, deviceId: e.deviceId, deviceName: writer?.uid === String(uid) ? writer.name : '' };
      });
      changes.push(...[...b.tombstones.values()].filter(e => !collection || changeCollection(e) === collection).map(e => ({ entityId: e.entityId, collection: changeCollection(e), op: 'delete', tombstone: true, serverRev: e.serverRev })));
      id = crypto.randomUUID();
      snapshot = { uid: String(uid), deviceId, collection, changes, serverRev: b.serverRev, expiresAt: ts + 30 * 60000 };
      snapshots.set(id, snapshot);
    } else {
      const match = /^full:([a-f0-9-]+):(\d+)$/.exec(String(cursor || ''));
      if (match) { id = match[1]; offset = Number(match[2]); snapshot = snapshots.get(id); }
      if (!snapshot || snapshot.uid !== String(uid) || snapshot.deviceId !== deviceId || snapshot.collection !== collection || !Number.isSafeInteger(offset) || offset > snapshot.changes.length) return { error: 'full_snapshot_expired', status: 409 };
    }
    const changes = snapshot.changes.slice(offset, offset + 500), hasMore = offset + changes.length < snapshot.changes.length;
    return { changes, hasMore, nextCursor: hasMore ? `full:${id}:${offset + changes.length}` : String(snapshot.serverRev), serverRev: snapshot.serverRev, fullSnapshot: true };
  }

  // Called only as part of an atomic persistent checkpoint, never a journal trim.
  function compactRetention() {
    const ts = nowFn(), cutoff = ts - retentionMs;
    for (const [uid, b] of byUid) {
      const paired = [...devices.values()].filter(d => d.uid === uid && !d.revokedAt);
      const ack = paired.length ? Math.min(...paired.map(d => Math.max(d.ackCursors?.['*'] || 0, Math.min(...SYNC_COLLECTIONS.map(c => d.ackCursors?.[c] || 0))))) : 0;
      let count = 0;
      for (const entry of b.changeLog) { if (entry.serverRev <= ack || entry.at <= cutoff) count++; else break; }
      if (count) { b.logFloor = Math.max(b.logFloor || 0, b.changeLog[count - 1].serverRev); b.changeLog = b.changeLog.slice(count); }
      for (const [key, row] of b.mutationResults) if (row.at <= cutoff) { b.mutationFloor = Math.max(b.mutationFloor || 0, row.serverRev); b.mutationResults.delete(key); }
      const recoveries = b.recoveries || new Map();
      const completed = [...recoveries.values()].filter(r => r.status === 'committed' || r.status === 'rolled_back');
      const latest = recoveries.get(b.lastRecoveryId) || completed.sort((a, z) => (z.committedAt || z.createdAt || 0) - (a.committedAt || a.createdAt || 0) || (z.serverRev || 0) - (a.serverRev || 0))[0];
      for (const [id, r] of recoveries) {
        const active = r.status === 'prepared' && ts - r.createdAt < 24 * 3600000;
        const rollbackProtected = r.status === 'committed' && ts - (r.committedAt || r.createdAt) < rollbackWindowMs;
        if (!active && !rollbackProtected && r !== latest && ts - (r.committedAt || r.createdAt) >= retentionMs) recoveries.delete(id);
      }
    }
    return { ok: true };
  }

  function incrementalPull(uid, { cursor, collection } = {}) {
    const b = bucket(uid);
    const after = cursor == null || cursor === '' ? 0 : Number(cursor);
    const matched = b.changeLog.filter((c) => {
      if (c.serverRev <= after) return false;
      if (!collection) return true;
      return changeCollection(c) === collection;
    });
    const page = matched.slice(0, 500);
    const changes = [];
    for (const c of page) {
      const resolved = { ...c, collection: changeCollection(c) };
      if (c.op === 'delete') {
        changes.push({ ...resolved, tombstone: true });
        continue;
      }
      const ent = b.live.get(c.entityId);
      // A later delete supersedes this upsert; an empty payload would resurrect a ghost row.
      if (!ent) continue;
      const writer = devices.get(ent.deviceId || c.deviceId);
      changes.push({ ...resolved, serverRev: ent.serverRev, deviceId: ent.deviceId || c.deviceId, deviceName: writer?.uid === String(uid) ? writer.name : '', payload: ent.payload });
    }
    const hasMore = matched.length > page.length;
    const nextCursor = hasMore ? String(page[page.length - 1].serverRev) : String(b.serverRev);
    return {
      changes,
      nextCursor,
      hasMore,
      serverRev: b.serverRev,
    };
  }

  function exportState() {
    return structuredClone({ version: 1, serverId, tokens, devices, pairingCodes, byUid });
  }

  // Business payloads are immutable after insertion. Capture references for an
  // incremental transaction diff without cloning unrelated audio payloads.
  function persistenceView() {
    const rows = new WeakMap();
    const metadataMap = (map) => new Map([...map].map(([key, value]) => { if (!rows.has(value)) rows.set(value, { ...value }); return [key, rows.get(value)]; }));
    return { version: 1, serverId, tokens: metadataMap(tokens), devices: metadataMap(devices), pairingCodes: metadataMap(pairingCodes),
      byUid: new Map([...byUid].map(([uid, b]) => [uid, { ...b, live: new Map(b.live), tombstones: new Map(b.tombstones),
        migrations: metadataMap(b.migrations), mutationResults: new Map(b.mutationResults), changeLog: b.changeLog.slice(),
        ...(b.recoveries ? { recoveries: new Map([...b.recoveries].map(([id, r]) => [id, { ...r, chunks: new Map(r.chunks) }])) } : {}),
      }])) };
  }

  function importState(state) {
    if (!state || state.version !== 1 || state.serverId !== serverId
      || !['tokens', 'devices', 'pairingCodes', 'byUid'].every((key) => state[key] instanceof Map)) {
      throw new Error('invalid_store_snapshot');
    }
    for (const b of state.byUid.values()) {
      b.logFloor ||= 0; b.mutationFloor ||= 0;
      for (const row of b.changeLog) if (!Number.isFinite(row.at)) row.at = nowFn();
      for (const [key, row] of b.mutationResults) if (typeof row === 'number') b.mutationResults.set(key, { serverRev: row, at: nowFn() });
      if (!(b.live instanceof Map) || !(b.tombstones instanceof Map)
        || !(b.migrations instanceof Map) || !(b.mutationResults instanceof Map)
        || !Array.isArray(b.changeLog) || !Number.isSafeInteger(b.serverRev) || b.serverRev < 0) {
        throw new Error('invalid_store_snapshot');
      }
    }
    for (const [target, source] of [[tokens, state.tokens], [devices, state.devices],
      [pairingCodes, state.pairingCodes], [byUid, state.byUid]]) {
      target.clear();
      for (const [key, value] of source) target.set(key, value);
    }
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
    peekAccountSyncKey,
    _peekPairingByCode,
    syncState,
    startMigration,
    getMigration,
    commitMigration,
    applyPush,
    pull,
    compactRetention,
    now: nowFn,
    rollbackWindowMs,
    bucket,
    exportState,
    persistenceView,
    importState,
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
