'use strict';
const fs = require('node:fs');
const { readJsonStrict, writeJsonAtomic, writeAtomic } = require('./atomicStorage');
const { requestKey, classifyAiEvent } = require('./aiEventPolicy');
const TOMBSTONE_MS = 24 * 60 * 60 * 1000;
const pending = row => ['pending', 'unverified'].includes(row.state);
function createAiAttentionStore({ filePath, now = Date.now, disk = fs } = {}) {
  const corrupt = () => Object.assign(new Error('attention_storage_corrupt'), { code: 'storage_corrupt' });
  const bytes = () => disk.existsSync(filePath) ? disk.readFileSync(filePath, 'utf8') : null;
  const initialBytes = bytes();
  let state = readJsonStrict(filePath, { version: 1, records: [], turns: [] }, disk);
  if (state?.version !== 1 || !Array.isArray(state.records) || !Array.isArray(state.turns)
    || state.records.some(row => !row || typeof row.key !== 'string' || !['pending', 'resolved', 'cancelled', 'unverified'].includes(row.state) || !row.event?.evidence
      || !Number.isFinite(row.firstSeenAt) || !Number.isFinite(row.lastSeenAt) || classifyAiEvent(row.event, row.event.source).category === 'invalid')
    || state.turns.some(row => !row?.event || !Number.isFinite(row.at) || classifyAiEvent(row.event, row.event.source).category === 'invalid')
    || new Set(state.records.map(row => row.key)).size !== state.records.length) throw corrupt();
  let saved = initialBytes;
  if (bytes() !== saved) throw Object.assign(new Error('attention_storage_changed'), { code: 'storage_changed' });
  function commit(next) {
    if (bytes() !== saved) throw Object.assign(new Error('attention_storage_changed'), { code: 'storage_changed' });
    writeJsonAtomic(filePath, next, disk); state = next; saved = `${JSON.stringify(next)}\n`;
  }
  // A restarted observer has no evidence that a former request is still waiting.
  if (state.records.some(row => row.state === 'pending')) commit({ ...state, records: state.records.map(row => row.state === 'pending' ? { ...row, state: 'unverified' } : row) });
  const sameTurn = (a, b) => a.source === b.source && a.evidence.surface === b.evidence.surface && a.sessionId === b.sessionId && a.turnId === b.turnId;
  function reduceEvent(state, event) {
    const unchanged = () => ({ next: state, result: { duplicate: true, changed: false } });
    const ts = now(), key = requestKey(event);
    let records = state.records.filter(row => pending(row) || ts - row.lastSeenAt < TOMBSTONE_MS);
    let turns = state.turns.filter(row => ts - row.at < TOMBSTONE_MS);
    const row = records.find(record => record.key === key);
    const boundary = turns.find(turn => sameTurn(turn.event, event));
    if (event.kind === 'attention.required') {
      // A resolved identity is final, regardless of delivery order or wall clock.
      if (row && !pending(row) || boundary && boundary.event.kind !== 'turn.started'
        && (event.sequence === undefined || boundary.event.sequence === undefined || event.sequence <= boundary.event.sequence)) return unchanged();
      if (row && event.sequence !== undefined && row.event.sequence !== undefined && event.sequence < row.event.sequence) return unchanged();
      const duplicate = Boolean(row);
      const next = row ? { ...row, state: 'pending', lastSeenAt: ts, event } : { key, event, state: 'pending', hidden: false, viewed: false, firstSeenAt: ts, lastSeenAt: ts };
      records = row ? records.map(record => record.key === key ? next : record) : [...records, next];
      return { next: { version: 1, records, turns }, result: { duplicate, changed: true, record: structuredClone(next) } };
    }
    if (event.kind === 'attention.resolved') {
      if (row && !pending(row)) return unchanged();
      if (row && event.sequence !== undefined && row.event.sequence !== undefined && event.sequence < row.event.sequence) return unchanged();
      const next = { ...(row || { key, firstSeenAt: ts, hidden: true }), event, state: event.reason === 'cancelled' ? 'cancelled' : 'resolved', lastSeenAt: ts };
      records = row ? records.map(record => record.key === key ? next : record) : [...records, next];
    } else {
      if (!['turn.started', 'turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.kind)) return { next: state, result: { changed: false } };
      if (boundary && event.sequence !== undefined && boundary.event.sequence !== undefined && event.sequence <= boundary.event.sequence) return unchanged();
      turns = turns.filter(turn => !sameTurn(turn.event, event)); turns.push({ event, at: ts });
      records = records.map(record => pending(record) && sameTurn(record.event, event)
        && (event.sequence === undefined || record.event.sequence === undefined || event.sequence >= record.event.sequence)
        ? { ...record, state: event.kind === 'turn.cancelled' ? 'cancelled' : 'resolved', lastSeenAt: ts } : record);
    }
    return { next: { version: 1, records, turns }, result: { changed: true } };
  }
  function applyBatch(events) {
    let next = state;
    const results = [];
    for (const event of events) {
      if (classifyAiEvent(event, event?.source).category === 'invalid') throw new Error('invalid_attention_event');
      const reduced = reduceEvent(next, event);
      next = reduced.next; results.push(reduced.result);
    }
    if (next !== state) {
      try { commit(next); }
      catch (error) {
        // Rename may have succeeded before a directory fsync failed. Keep the
        // adapter consistent with the whole batch actually visible on disk.
        const serialized = `${JSON.stringify(next)}\n`;
        try { if (bytes() === serialized) { state = next; saved = serialized; error.attentionBatchCommitted = true; } } catch {}
        throw error;
      }
    }
    return results;
  }
  const apply = event => applyBatch([event])[0];
  function display(key, hidden) {
    const row = state.records.find(record => record.key === key && pending(record));
    if (!row) return { ok: false, error: 'not_found' };
    commit({ ...state, records: state.records.map(record => record.key === key ? { ...record, hidden, viewed: true } : record) });
    return { ok: true };
  }
  const list = () => {
    if (bytes() !== saved) throw Object.assign(new Error('attention_storage_changed'), { code: 'storage_changed' });
    return structuredClone(state.records.filter(pending));
  };
  const get = key => list().find(record => record.key === key) || null;
  return { apply, applyBatch, list, get, display, disconnect(source) {
    commit({ ...state, records: state.records.map(row => row.event.source === source && row.state === 'pending' ? { ...row, state: 'unverified' } : row) });
  } };
}
function rebuildAiAttention({ filePath, confirmed = false, expectedDigest, disk = fs } = {}) {
  if (!confirmed) return { ok: false, canceled: true };
  const original = disk.readFileSync(filePath);
  const digest = require('node:crypto').createHash('sha256').update(original).digest('hex');
  if (digest !== expectedDigest) return { ok: false, error: 'preview_expired' };
  const backupPath = `${filePath}.corrupt-${require('node:crypto').randomUUID()}`;
  writeAtomic(backupPath, original, disk);
  if (!disk.readFileSync(backupPath).equals(original)) throw new Error('backup_verification_failed');
  writeJsonAtomic(filePath, { version: 1, records: [], turns: [] }, disk);
  return { ok: true, backupPath };
}
module.exports = { createAiAttentionStore, rebuildAiAttention, TOMBSTONE_MS };
