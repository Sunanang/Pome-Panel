'use strict';
const crypto = require('node:crypto');
const SCOPE = Object.freeze(['todos', 'notes', 'links', 'commands', 'clipboardHistory', 'recordings']);
const owner = (id) => id.startsWith('note:') ? 'notes' : id.startsWith('link:') ? 'links' : id.startsWith('command:') ? 'commands' : id.startsWith('clip:') ? 'clipboardHistory' : id.startsWith('recording:') || id.startsWith('recording-blob:') ? 'recordings' : id.startsWith('secret:') ? 'secrets' : id.startsWith('ai:') ? 'aiSettings' : 'todos';
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createRecovery(store) {
  const bucket = (uid) => { const b = store.bucket(uid); b.recoveries ||= new Map(); return b; };
  const rows = (b) => [...b.live.values()].filter((e) => SCOPE.includes(e.collection || 'todos')).sort((a,b) => a.entityId.localeCompare(b.entityId));
  function state(uid) { const b = bucket(uid), entities = rows(b); return { version: 1, serverRev: b.serverRev, fingerprint: digest(entities), scope: SCOPE, entities: entities.map((e) => ({ entityId: e.entityId, collection: e.collection, hash: digest(e.payload), label: String(e.payload?.title || e.payload?.text || e.payload?.name || (e.entityId === 'note:home' ? '首页速记' : e.entityId)).slice(0,240), hasAudio: Boolean(e.payload?.audioBase64 || e.payload?.audioChunks) })) }; }
  function find(uid, operationId, deviceId) { const row = bucket(uid).recoveries.get(operationId); if (!row || row.deviceId !== deviceId) throw new Error('recovery_not_found'); return row; }
  function prepare(uid, { operationId, baseServerRev, fingerprint }, deviceId) {
    if (typeof operationId !== 'string' || operationId.length > 100) throw new Error('invalid_operation');
    const b = bucket(uid);
    if (b.recoveries.has(operationId)) return get(uid, operationId, deviceId);
    const current = state(uid);
    if (current.serverRev !== baseServerRev || current.fingerprint !== fingerprint) throw new Error('preview_expired');
    const snapshot = structuredClone(rows(b));
    const row = { operationId, deviceId, baseServerRev, fingerprint, snapshot, snapshotHash: digest(snapshot), verified: false, chunks: new Map(), status: 'prepared', createdAt: store.now() };
    b.recoveries.set(operationId, row);
    return get(uid, operationId, deviceId);
  }
  function get(uid, operationId, deviceId) { const r = find(uid, operationId, deviceId); return { operationId, snapshotHash: r.snapshotHash, verified: r.verified, status: r.status, baseServerRev: r.baseServerRev, serverRev: r.serverRev, rollbackRev: r.rollbackRev, createdAt: r.createdAt, rollbackExpiresAt: (r.committedAt || r.createdAt) + store.rollbackWindowMs }; }
  function verify(uid, operationId, deviceId, persisted) {
    const r = find(uid, operationId, deviceId);
    if (!persisted || persisted.snapshotHash !== r.snapshotHash || digest(persisted.snapshot) !== r.snapshotHash) throw new Error('snapshot_verification_failed');
    r.verified = true; return get(uid, operationId, deviceId);
  }
  function stage(uid, { operationId, chunkId, entities }, deviceId) {
    const r = find(uid, operationId, deviceId);
    if (store.now() - r.createdAt >= 24 * 3600000) throw new Error('recovery_expired');
    if (r.status !== 'prepared' || !r.verified) throw new Error('snapshot_not_verified');
    if (!Number.isSafeInteger(chunkId) || chunkId < 0 || chunkId > 100000 || !Array.isArray(entities) || entities.length > 500) throw new Error('invalid_chunk');
    if (entities.some((e) => !e || typeof e.entityId !== 'string' || !SCOPE.includes(e.collection) || owner(e.entityId) !== e.collection || !e.payload || typeof e.payload !== 'object')) throw new Error('invalid_entity');
    if (r.chunks.has(chunkId) && digest(r.chunks.get(chunkId)) !== digest(entities)) throw new Error('chunk_mismatch');
    r.chunks.set(chunkId, structuredClone(entities)); return { ok: true };
  }
  function replace(uid, entities, operationId, deviceId) {
    const b = bucket(uid), incoming = new Map(entities.map((e) => [e.entityId, e]));
    const changes = rows(b).filter((e) => !incoming.has(e.entityId)).map((e) => ({ entityId: e.entityId, collection: e.collection || 'todos', op: 'delete', payload: {} }));
    changes.push(...entities.map((e) => ({ ...e, op: 'upsert' })));
    const mutations = changes.map((e, i) => ({ ...e, clientMutationId: `${operationId}:${i}`, deviceId, baseServerRev: b.serverRev }));
    return store.applyPush(uid, mutations, { deviceId }).serverRev;
  }
  function commit(uid, { operationId, chunkCount, entitiesHash }, deviceId) {
    const b = bucket(uid), r = find(uid, operationId, deviceId);
    if (r.status === 'committed' || r.status === 'rolled_back') return get(uid, operationId, deviceId);
    if (store.now() - r.createdAt >= 24 * 3600000) throw new Error('recovery_expired');
    if (!r.verified || digest(r.snapshot) !== r.snapshotHash) throw new Error('snapshot_not_verified');
    if (b.serverRev !== r.baseServerRev || state(uid).fingerprint !== r.fingerprint) throw new Error('preview_expired');
    if (!Number.isSafeInteger(chunkCount) || chunkCount !== r.chunks.size) throw new Error('incomplete_staging');
    const entities = [];
    for (let i=0; i<chunkCount; i++) { if (!r.chunks.has(i)) throw new Error('incomplete_staging'); entities.push(...r.chunks.get(i)); }
    if (digest(entities) !== entitiesHash || new Set(entities.map((e) => e.entityId)).size !== entities.length) throw new Error('staging_checksum_mismatch');
    r.serverRev = replace(uid, entities, operationId, deviceId); r.status = 'committed'; r.committedAt = store.now(); b.lastRecoveryId = operationId; r.chunks.clear(); return get(uid, operationId, deviceId);
  }
  function rollback(uid, operationId, deviceId) {
    const b = bucket(uid), r = find(uid, operationId, deviceId);
    if (r.status === 'rolled_back') return get(uid, operationId, deviceId);
    const latest = b.recoveries.get(b.lastRecoveryId) || [...b.recoveries.values()].filter(row => ['committed','rolled_back'].includes(row.status)).sort((a,z) => (z.serverRev || 0) - (a.serverRev || 0))[0];
    if (r !== latest && store.now() - (r.committedAt || r.createdAt) >= store.rollbackWindowMs) throw new Error('rollback_expired');
    if (r.status !== 'committed' || !r.verified || digest(r.snapshot) !== r.snapshotHash) throw new Error('snapshot_not_verified');
    if (b.serverRev !== r.serverRev) throw new Error('preview_expired');
    r.rollbackRev = replace(uid, r.snapshot, `${operationId}:rollback`, deviceId); r.status = 'rolled_back'; return get(uid, operationId, deviceId);
  }
  return { state, prepare, get, verify, stage, commit, rollback };
}
module.exports = { createRecovery, SCOPE, digest };
