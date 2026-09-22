'use strict';

/**
 * Workspace sync projections: notes, links, clipboard, recordings, AI settings,
 * and the secrets vault. Todos stay on the existing todo entity path.
 * Secret and AI-key payloads are AES-GCM boxes; this module never logs them.
 */

const crypto = require('node:crypto');
const {
  COLLECTIONS,
  SCHEMA_VERSION,
  WORKSPACE_PUSH_MAX_BYTES,
  encryptJson,
  decryptJson,
  isSealedPayload,
} = require('./packages/sync-protocol');

const AUDIO_CHUNK_RAW = 512 * 1024;
const AUDIO_MAX_RAW = 6 * 1024 * 1024;
const IMAGE_MAX_RAW = 1536 * 1024;
const MIGRATION_INLINE_MAX_BYTES = 6 * 1024 * 1024;

const WORKSPACE_COLLECTIONS = Object.freeze([
  COLLECTIONS.NOTES,
  COLLECTIONS.LINKS,
  COLLECTIONS.CLIPBOARD_HISTORY,
  COLLECTIONS.RECORDINGS,
  COLLECTIONS.AI_SETTINGS,
  COLLECTIONS.SECRETS,
]);

const EMPTY_SYNC_HINT = '笔记、剪贴板、录音、链接、密钥和待办两边都是空的，已进入同步。';

function emptySnapshot() {
  return {
    notes: { home: '', archive: [], activeId: '' },
    links: [],
    clipboard: { history: [], favorites: [] },
    recordings: [],
    aiSettings: null,
    secrets: [],
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countWorkspaceContent(snapshot, { todoLive = 0 } = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const notes = source.notes && typeof source.notes === 'object' ? source.notes : {};
  const archive = asArray(notes.archive).filter((note) => note && String(note.content || note.markdown || '').trim());
  const noteCount = (String(notes.home || '').trim() ? 1 : 0) + archive.length;
  const links = asArray(source.links).filter((group) => group && (group.name || asArray(group.links).length));
  const clips = asArray(source.clipboard && source.clipboard.history);
  const recordings = asArray(source.recordings).filter((row) => row && row.isDraft !== true);
  const ai = source.aiSettings && typeof source.aiSettings === 'object' ? source.aiSettings : null;
  const aiCount = ai && (
    ai.apiKey || ai.llmApiKey || ai.workspaceId || ai.region || ai.llmBaseUrl || ai.llmModel || ai.hasStoredSecret
  ) ? 1 : 0;
  const secrets = asArray(source.secrets).filter((row) => row && (row.password || row.service));
  const counts = {
    todos: Math.max(0, Number(todoLive) || 0),
    notes: noteCount,
    links: links.length,
    clipboardHistory: clips.length,
    recordings: recordings.length,
    aiSettings: aiCount,
    secrets: secrets.length,
  };
  counts.total = counts.todos + counts.notes + counts.links + counts.clipboardHistory
    + counts.recordings + counts.aiSettings + counts.secrets;
  return counts;
}

function workspaceHasContent(snapshot, options) {
  return countWorkspaceContent(snapshot, options).total > 0;
}

function entityHash(entity) {
  return crypto.createHash('sha256').update(JSON.stringify({
    c: entity.collection,
    id: entity.entityId,
    p: entity.payload || {},
    op: entity.op || 'upsert',
  })).digest('hex');
}

function collectionForEntityId(entityId) {
  const id = String(entityId || '');
  if (id.startsWith('note:')) return COLLECTIONS.NOTES;
  if (id.startsWith('link:')) return COLLECTIONS.LINKS;
  if (id.startsWith('clip:')) return COLLECTIONS.CLIPBOARD_HISTORY;
  if (id.startsWith('recording')) return COLLECTIONS.RECORDINGS;
  if (id.startsWith('secret:')) return COLLECTIONS.SECRETS;
  if (id === 'ai:settings') return COLLECTIONS.AI_SETTINGS;
  return null;
}

function pushEntity(entities, collection, entityId, payload) {
  entities.push({
    entityId,
    collection,
    op: 'upsert',
    payload,
  });
}

function sealOrSkip(entities, warnings, collection, entityId, value, accountKey) {
  if (!accountKey) {
    warnings.push({ entityId, reason: 'account_key_required' });
    return false;
  }
  try {
    pushEntity(entities, collection, entityId, encryptJson(value, accountKey, { ivContext: entityId }));
    return true;
  } catch (error) {
    warnings.push({ entityId, reason: error && error.reason ? error.reason : 'seal_failed' });
    return false;
  }
}

function appendRecordingEntities(entities, warnings, recording) {
  const id = String(recording.id || '').trim();
  if (!id) return;
  const meta = {
    id,
    createdAt: Number(recording.createdAt) || 0,
    durationMs: Math.max(0, Number(recording.durationMs) || 0),
    transcript: String(recording.transcript || ''),
    mimeType: String(recording.mimeType || 'audio/webm'),
    title: String(recording.title || ''),
    category: String(recording.category || ''),
  };
  const audioBase64 = typeof recording.audioBase64 === 'string' ? recording.audioBase64 : '';
  if (!audioBase64) {
    pushEntity(entities, COLLECTIONS.RECORDINGS, `recording:${id}`, meta);
    return;
  }
  let raw;
  try {
    raw = Buffer.from(audioBase64, 'base64');
  } catch (error) {
    raw = Buffer.alloc(0);
  }
  if (!raw.length) {
    pushEntity(entities, COLLECTIONS.RECORDINGS, `recording:${id}`, meta);
    return;
  }
  if (raw.length > AUDIO_MAX_RAW) {
    meta.audioOmitted = true;
    warnings.push({ entityId: `recording:${id}`, reason: 'audio_too_large' });
    pushEntity(entities, COLLECTIONS.RECORDINGS, `recording:${id}`, meta);
    return;
  }
  meta.audioSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  if (raw.length <= AUDIO_CHUNK_RAW) {
    meta.audioBase64 = raw.toString('base64');
    pushEntity(entities, COLLECTIONS.RECORDINGS, `recording:${id}`, meta);
    return;
  }
  const chunks = Math.ceil(raw.length / AUDIO_CHUNK_RAW);
  meta.audioChunks = chunks;
  pushEntity(entities, COLLECTIONS.RECORDINGS, `recording:${id}`, meta);
  for (let index = 0; index < chunks; index += 1) {
    const slice = raw.subarray(index * AUDIO_CHUNK_RAW, (index + 1) * AUDIO_CHUNK_RAW);
    pushEntity(entities, COLLECTIONS.RECORDINGS, `recording-blob:${id}:${index}`, {
      recordingId: id,
      index,
      data: slice.toString('base64'),
    });
  }
}

/**
 * Build upsert entities for every non-empty workspace category.
 * API keys and vault passwords are sealed. Other fields stay structured JSON.
 */
function buildWorkspaceEntities(snapshot, { accountKey = null } = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const entities = [];
  const warnings = [];
  const notes = source.notes && typeof source.notes === 'object' ? source.notes : {};
  const home = String(notes.home || '');
  if (home.trim()) {
    pushEntity(entities, COLLECTIONS.NOTES, 'note:home', { kind: 'home', markdown: home });
  }
  for (const note of asArray(notes.archive)) {
    if (!note || !note.id) continue;
    const content = note.content == null ? '' : String(note.content);
    if (!content.trim() && !String(note.title || '').trim()) continue;
    pushEntity(entities, COLLECTIONS.NOTES, `note:${note.id}`, {
      kind: 'archive',
      id: String(note.id),
      title: String(note.title || ''),
      titleSource: note.titleSource === 'model' || note.titleSource === 'user' ? note.titleSource : '',
      content,
      createdAt: Number(note.createdAt) || 0,
      updatedAt: Number(note.updatedAt) || 0,
    });
  }
  if (notes.activeId) {
    pushEntity(entities, COLLECTIONS.NOTES, 'note:active', {
      kind: 'active',
      id: String(notes.activeId),
    });
  }

  for (const group of asArray(source.links)) {
    if (!group || !group.id) continue;
    pushEntity(entities, COLLECTIONS.LINKS, `link:${group.id}`, {
      id: String(group.id),
      name: String(group.name || ''),
      collapsed: group.collapsed === true,
      links: asArray(group.links).map((link) => ({
        id: String(link && link.id || ''),
        url: String(link && link.url || ''),
        title: String(link && link.title || ''),
        description: String(link && link.description || ''),
        icon: String(link && link.icon || ''),
        createdAt: Number(link && link.createdAt) || 0,
      })).filter((link) => link.id && link.url),
    });
  }

  const clipboard = source.clipboard && typeof source.clipboard === 'object' ? source.clipboard : {};
  for (const item of asArray(clipboard.history)) {
    if (!item || !item.id) continue;
    const payload = {
      id: String(item.id),
      type: item.type === 'image' || item.type === 'url' ? item.type : 'text',
      text: item.text == null ? '' : String(item.text),
      timestamp: Number(item.timestamp) || 0,
    };
    if (payload.type === 'image') {
      const imageBase64 = typeof item.imageBase64 === 'string' ? item.imageBase64 : '';
      if (imageBase64) {
        const raw = Buffer.from(imageBase64, 'base64');
        if (raw.length && raw.length <= IMAGE_MAX_RAW) {
          payload.imageBase64 = raw.toString('base64');
          payload.mimeType = 'image/png';
        } else if (raw.length > IMAGE_MAX_RAW) {
          warnings.push({ entityId: `clip:${item.id}`, reason: 'image_too_large' });
          continue;
        }
      }
      if (!payload.imageBase64 && !item.imagePath) continue;
    }
    pushEntity(entities, COLLECTIONS.CLIPBOARD_HISTORY, `clip:${item.id}`, payload);
  }
  const favorites = asArray(clipboard.favorites).map((id) => String(id)).filter(Boolean);
  if (favorites.length) {
    pushEntity(entities, COLLECTIONS.CLIPBOARD_HISTORY, 'clip:favorites', { ids: favorites });
  }

  for (const recording of asArray(source.recordings)) {
    if (!recording || recording.isDraft === true) continue;
    appendRecordingEntities(entities, warnings, recording);
  }

  const ai = source.aiSettings && typeof source.aiSettings === 'object' ? source.aiSettings : null;
  if (ai && (ai.apiKey || ai.llmApiKey || ai.workspaceId || ai.region || ai.llmBaseUrl || ai.llmModel)) {
    sealOrSkip(entities, warnings, COLLECTIONS.AI_SETTINGS, 'ai:settings', {
      apiKey: String(ai.apiKey || ''),
      llmApiKey: String(ai.llmApiKey || ''),
      workspaceId: String(ai.workspaceId || ''),
      region: String(ai.region || ''),
      llmBaseUrl: String(ai.llmBaseUrl || ''),
      llmModel: String(ai.llmModel || ''),
    }, accountKey);
  }

  for (const secret of asArray(source.secrets)) {
    if (!secret || !secret.id || !secret.password) continue;
    sealOrSkip(entities, warnings, COLLECTIONS.SECRETS, `secret:${secret.id}`, {
      id: String(secret.id),
      service: String(secret.service || ''),
      account: String(secret.account || ''),
      password: String(secret.password),
      createdAt: Number(secret.createdAt) || 0,
    }, accountKey);
  }

  return { entities, warnings };
}

function partitionEntities(entities, maxBytes = MIGRATION_INLINE_MAX_BYTES) {
  const inline = [];
  const deferred = [];
  let used = 2;
  for (const entity of entities || []) {
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(entity), 'utf8') + 1;
    } catch (error) {
      deferred.push(entity);
      continue;
    }
    if (inline.length && used + size > maxBytes) {
      deferred.push(entity);
      continue;
    }
    if (!inline.length && size > maxBytes) {
      deferred.push(entity);
      continue;
    }
    inline.push(entity);
    used += size;
  }
  return { inline, deferred };
}

function planWorkspaceSync({ index, localEntities, remoteChanges } = {}) {
  const prior = index && typeof index === 'object' ? index : {};
  const hashes = { ...prior };
  const remoteIds = new Set();
  const localList = Array.isArray(localEntities) ? localEntities : [];
  const merged = new Map(localList.map((entity) => [entity.entityId, entity]));

  for (const change of remoteChanges || []) {
    if (!change || !change.entityId) continue;
    remoteIds.add(change.entityId);
    if (change.op === 'delete') {
      merged.delete(change.entityId);
      delete hashes[change.entityId];
      continue;
    }
    const entity = {
      entityId: change.entityId,
      collection: change.collection || collectionForEntityId(change.entityId),
      op: 'upsert',
      payload: change.payload || {},
    };
    merged.set(change.entityId, entity);
    hashes[change.entityId] = entityHash(entity);
  }

  const toPush = [];
  const localIds = new Set(localList.map((entity) => entity.entityId));
  for (const entity of localList) {
    if (remoteIds.has(entity.entityId)) continue;
    const hash = entityHash(entity);
    if (hashes[entity.entityId] !== hash) {
      toPush.push(entity);
      hashes[entity.entityId] = hash;
    }
  }
  for (const entityId of Object.keys(prior)) {
    if (localIds.has(entityId) || remoteIds.has(entityId)) continue;
    const collection = collectionForEntityId(entityId);
    if (!collection) continue;
    toPush.push({ entityId, collection, op: 'delete', payload: {} });
    delete hashes[entityId];
  }

  return {
    toPush,
    nextIndex: hashes,
    mergedEntities: [...merged.values()],
  };
}

function unseal(payload, accountKey) {
  if (!isSealedPayload(payload)) return { ok: false, reason: 'sealed_payload_required' };
  if (!accountKey) return { ok: false, reason: 'account_key_required' };
  try {
    return { ok: true, value: decryptJson(payload, accountKey) };
  } catch (error) {
    return { ok: false, reason: 'decrypt_failed' };
  }
}

function reassembleRecording(meta, blobs) {
  const recording = {
    id: meta.id,
    createdAt: Number(meta.createdAt) || 0,
    durationMs: Math.max(0, Number(meta.durationMs) || 0),
    transcript: String(meta.transcript || ''),
    mimeType: String(meta.mimeType || 'audio/webm'),
    title: String(meta.title || ''),
    category: String(meta.category || ''),
    audioOmitted: meta.audioOmitted === true,
    audioBase64: '',
  };
  if (typeof meta.audioBase64 === 'string' && meta.audioBase64) {
    recording.audioBase64 = meta.audioBase64;
    return recording;
  }
  if (!Array.isArray(blobs) || !blobs.length) return recording;
  const ordered = blobs.slice().sort((left, right) => left.index - right.index);
  const buffers = ordered.map((blob) => Buffer.from(String(blob.data || ''), 'base64'));
  recording.audioBase64 = Buffer.concat(buffers).toString('base64');
  return recording;
}

/**
 * Turn upsert entities into a local snapshot. Sealed rows stay omitted when
 * the account key is missing so callers do not wipe the local vault.
 */
function projectWorkspaceEntities(entities, { accountKey = null } = {}) {
  const snapshot = emptySnapshot();
  const warnings = [];
  let secretsApplied = false;
  let aiApplied = false;
  const recordingMeta = new Map();
  const recordingBlobs = new Map();

  for (const entity of entities || []) {
    if (!entity || entity.op === 'delete') continue;
    const payload = entity.payload || {};
    const id = String(entity.entityId || '');
    if (id === 'note:home') {
      snapshot.notes.home = String(payload.markdown || '');
      continue;
    }
    if (id === 'note:active') {
      snapshot.notes.activeId = String(payload.id || '');
      continue;
    }
    if (id.startsWith('note:') && payload.kind === 'archive') {
      snapshot.notes.archive.push({
        id: String(payload.id || id.slice(5)),
        title: String(payload.title || ''),
        titleSource: payload.titleSource || '',
        content: String(payload.content || ''),
        createdAt: Number(payload.createdAt) || 0,
        updatedAt: Number(payload.updatedAt) || 0,
      });
      continue;
    }
    if (id.startsWith('link:')) {
      snapshot.links.push({
        id: String(payload.id || id.slice(5)),
        name: String(payload.name || ''),
        collapsed: payload.collapsed === true,
        links: asArray(payload.links),
      });
      continue;
    }
    if (id === 'clip:favorites') {
      snapshot.clipboard.favorites = asArray(payload.ids).map((item) => String(item));
      continue;
    }
    if (id.startsWith('clip:')) {
      snapshot.clipboard.history.push({
        id: String(payload.id || id.slice(5)),
        type: payload.type || 'text',
        text: payload.text == null ? '' : String(payload.text),
        timestamp: Number(payload.timestamp) || 0,
        imageBase64: typeof payload.imageBase64 === 'string' ? payload.imageBase64 : '',
        mimeType: payload.mimeType || '',
      });
      continue;
    }
    if (id.startsWith('recording-blob:')) {
      const recordingId = String(payload.recordingId || '');
      if (!recordingId) continue;
      const list = recordingBlobs.get(recordingId) || [];
      list.push({ index: Number(payload.index) || 0, data: String(payload.data || '') });
      recordingBlobs.set(recordingId, list);
      continue;
    }
    if (id.startsWith('recording:')) {
      recordingMeta.set(String(payload.id || id.slice('recording:'.length)), payload);
      continue;
    }
    if (id === 'ai:settings') {
      const opened = unseal(payload, accountKey);
      if (!opened.ok) {
        warnings.push({ entityId: id, reason: opened.reason });
        continue;
      }
      snapshot.aiSettings = opened.value;
      aiApplied = true;
      continue;
    }
    if (id.startsWith('secret:')) {
      const opened = unseal(payload, accountKey);
      if (!opened.ok) {
        warnings.push({ entityId: id, reason: opened.reason });
        continue;
      }
      snapshot.secrets.push(opened.value);
      secretsApplied = true;
    }
  }

  for (const [id, meta] of recordingMeta) {
    snapshot.recordings.push(reassembleRecording(meta, recordingBlobs.get(id)));
  }
  if (snapshot.secrets.length) secretsApplied = true;
  return { snapshot, warnings, secretsApplied, aiApplied };
}

function hashesForEntities(entities) {
  const hashes = {};
  for (const entity of entities || []) {
    if (!entity || !entity.entityId || entity.op === 'delete') continue;
    hashes[entity.entityId] = entityHash(entity);
  }
  return hashes;
}

function mutationFromEntity(entity, { deviceId, baseServerRev = 0, clientTime = Date.now(), clientMutationId } = {}) {
  const op = entity.op === 'delete' ? 'delete' : 'upsert';
  return {
    schemaVersion: SCHEMA_VERSION,
    collection: entity.collection,
    entityId: entity.entityId,
    op,
    payload: op === 'delete' ? {} : (entity.payload || {}),
    clientMutationId: clientMutationId || `ws-${crypto.randomBytes(8).toString('hex')}`,
    deviceId: String(deviceId || ''),
    baseServerRev: Math.max(0, Number(baseServerRev) || 0),
    clientTime: Number(clientTime) || Date.now(),
  };
}

function splitMutationBatches(mutations, maxBytes = WORKSPACE_PUSH_MAX_BYTES) {
  const batches = [];
  let current = [];
  for (const mutation of mutations || []) {
    const trial = current.concat(mutation);
    const size = Buffer.byteLength(JSON.stringify(trial), 'utf8');
    if (current.length && size > maxBytes) {
      batches.push(current);
      current = [mutation];
      continue;
    }
    current = trial;
  }
  if (current.length) batches.push(current);
  return batches;
}

module.exports = {
  AUDIO_CHUNK_RAW,
  AUDIO_MAX_RAW,
  IMAGE_MAX_RAW,
  MIGRATION_INLINE_MAX_BYTES,
  WORKSPACE_COLLECTIONS,
  EMPTY_SYNC_HINT,
  emptySnapshot,
  countWorkspaceContent,
  workspaceHasContent,
  collectionForEntityId,
  buildWorkspaceEntities,
  partitionEntities,
  planWorkspaceSync,
  projectWorkspaceEntities,
  hashesForEntities,
  mutationFromEntity,
  splitMutationBatches,
  entityHash,
};
