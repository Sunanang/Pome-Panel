'use strict';

const crypto = require('node:crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function createMemoryStore(options = {}) {
  const serverId = options.serverId || crypto.randomUUID();
  /** @type {Map<string, { uid: string, deviceId: string, revokedAt: number|null, insecureBound?: boolean }>} */
  const tokens = new Map();
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
      };
      byUid.set(key, b);
    }
    return b;
  }

  function issueToken({ uid, deviceId, insecureBound = false }) {
    const raw = crypto.randomBytes(32).toString('base64url');
    tokens.set(hashToken(raw), {
      uid: String(uid),
      deviceId: String(deviceId || crypto.randomUUID()),
      revokedAt: null,
      insecureBound: Boolean(insecureBound),
    });
    return raw;
  }

  function verifyToken(raw) {
    if (!raw) return null;
    const row = tokens.get(hashToken(raw));
    if (!row || row.revokedAt) return null;
    return { ...row };
  }

  function revokeToken(raw) {
    const h = hashToken(raw);
    const row = tokens.get(h);
    if (!row) return false;
    row.revokedAt = Date.now();
    return true;
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
      createdAt: Date.now(),
    };
    b.migrations.set(migrationId, row);
    return { ...row };
  }

  function getMigration(uid, migrationId) {
    return bucket(uid).migrations.get(String(migrationId)) || null;
  }

  function commitMigration(uid, { migrationId, expectedServerRev }) {
    const b = bucket(uid);
    const row = b.migrations.get(String(migrationId));
    if (!row) return { error: 'not_found' };
    if (Number(expectedServerRev) !== b.serverRev) {
      return { error: 'cas_conflict', currentServerRev: b.serverRev };
    }
    if (row.state === 'committed' || row.state === 'applied') {
      return { ok: true, migration: { ...row } };
    }
    row.state = 'committed';
    row.backupId = row.backupId || `bak-${migrationId}`;
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
        b.tombstones.set(m.entityId, { entityId: m.entityId, serverRev: rev, deletedAt: Date.now() });
      } else {
        b.tombstones.delete(m.entityId);
        b.live.set(m.entityId, {
          entityId: m.entityId,
          collection: m.collection || 'todos',
          payload: m.payload || {},
          serverRev: rev,
          updatedAt: Date.now(),
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

  function pull(uid, { cursor } = {}) {
    const b = bucket(uid);
    const after = cursor == null || cursor === '' ? 0 : Number(cursor);
    const changes = b.changeLog
      .filter((c) => c.serverRev > after)
      .slice(0, 500)
      .map((c) => {
        if (c.op === 'delete') {
          return { ...c, tombstone: true };
        }
        const ent = b.live.get(c.entityId);
        return { ...c, payload: ent ? ent.payload : undefined };
      });
    const nextCursor = changes.length ? String(changes[changes.length - 1].serverRev) : String(after);
    const hasMore = b.changeLog.some((c) => c.serverRev > Number(nextCursor));
    return {
      changes,
      nextCursor,
      hasMore,
      serverRev: b.serverRev,
    };
  }

  return {
    serverId,
    issueToken,
    verifyToken,
    revokeToken,
    syncState,
    startMigration,
    getMigration,
    commitMigration,
    applyPush,
    pull,
    bucket,
  };
}

module.exports = {
  createMemoryStore,
  hashToken,
};
