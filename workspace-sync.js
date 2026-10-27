'use strict';

/**
 * Workspace sync projections: notes, links, clipboard, AI completions, recordings, AI settings,
 * and the secrets vault. Todos stay on the existing todo entity path.
 * Secret and AI-key payloads are AES-GCM boxes; this module never logs them.
 */

const crypto = require('node:crypto');
const { trimClipboardHistory } = require('./renderer/domain');
const {
  COLLECTIONS,
  SCHEMA_VERSION,
  WORKSPACE_PUSH_MAX_BYTES,
  PUSH_BATCH_MAX_MUTATIONS,
  validatePullResponse,
  encryptJson,
  decryptJson,
  isSealedPayload,
  normalizeSyncedCompletion,
  mergeSyncedCompletions,
  trimCompletionHistory,
} = require('./packages/sync-protocol');

const AUDIO_CHUNK_RAW = 512 * 1024;
const AUDIO_MAX_RAW = 6 * 1024 * 1024;
const IMAGE_MAX_RAW = 1536 * 1024;
const MIGRATION_INLINE_MAX_BYTES = 6 * 1024 * 1024;

const WORKSPACE_COLLECTIONS = Object.freeze([
  COLLECTIONS.NOTES,
  COLLECTIONS.LINKS,
  COLLECTIONS.COMMANDS,
  COLLECTIONS.CLIPBOARD_HISTORY,
  COLLECTIONS.AI_COMPLETIONS,
  COLLECTIONS.RECORDINGS,
  COLLECTIONS.AI_SETTINGS,
  COLLECTIONS.SECRETS,
]);

const EMPTY_SYNC_HINT = '笔记、剪贴板、录音、链接、密钥和待办两边都是空的，已进入同步。';

function emptySnapshot() {
  return {
    notes: { home: '', archive: [], activeId: '' },
    links: [],
    commands: [],
    clipboard: { history: [], favorites: [] },
    aiCompletions: [],
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
  const commands = asArray(source.commands).filter((row) => row && String(row.text || '').trim());
  const clips = asArray(source.clipboard && source.clipboard.history);
  const recordings = asArray(source.recordings).filter((row) => row && row.isDraft !== true);
  const ai = source.aiSettings && typeof source.aiSettings === 'object' ? source.aiSettings : null;
  const aiCount = ai && (
    ai.apiKey || ai.llmApiKey || ai.cursorToken || ai.workspaceId || ai.region || ai.llmBaseUrl || ai.llmModel || ai.hasStoredSecret
  ) ? 1 : 0;
  const secrets = asArray(source.secrets).filter((row) => row && (row.password || row.service));
  const counts = {
    todos: Math.max(0, Number(todoLive) || 0),
    notes: noteCount,
    links: links.length,
    commands: commands.length,
    clipboardHistory: clips.length,
    aiCompletions: asArray(source.aiCompletions).length,
    recordings: recordings.length,
    aiSettings: aiCount,
    secrets: secrets.length,
  };
  counts.total = counts.todos + counts.notes + counts.links + counts.commands
    + counts.clipboardHistory + counts.aiCompletions + counts.recordings + counts.aiSettings + counts.secrets;
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
  if (id.startsWith('command:')) return COLLECTIONS.COMMANDS;
  if (id.startsWith('clip:')) return COLLECTIONS.CLIPBOARD_HISTORY;
  if (id.startsWith('completion:')) return COLLECTIONS.AI_COMPLETIONS;
  if (id.startsWith('recording')) return COLLECTIONS.RECORDINGS;
  if (id.startsWith('secret:')) return COLLECTIONS.SECRETS;
  if (id === 'ai:settings') return COLLECTIONS.AI_SETTINGS;
  return null;
}

/**
 * Keep the pulled changes that belong to `collection`. Ownership follows the
 * entity prefix because older NAS builds tagged migration deletes as `todos`
 * and ignored the collection filter. Upserts without a payload are superseded
 * rows; merging them would resurrect empty ghosts.
 */
function selectWorkspaceChanges(changes, collection) {
  const selected = [];
  for (const change of asArray(changes)) {
    if (!change || !change.entityId) continue;
    const owner = collectionForEntityId(change.entityId) || change.collection || collection;
    if (owner !== collection) continue;
    if (change.op === 'delete') {
      selected.push({ ...change, collection: owner });
      continue;
    }
    if (!change.payload || typeof change.payload !== 'object') continue;
    selected.push({ ...change, collection: owner });
  }
  return selected;
}

function preferEarlier(left, right) {
  const leftAt = Number(left.createdAt) || Number.MAX_SAFE_INTEGER;
  const rightAt = Number(right.createdAt) || Number.MAX_SAFE_INTEGER;
  if (leftAt !== rightAt) return leftAt < rightAt ? left : right;
  return String(left.id) <= String(right.id) ? left : right;
}

function preferNewerClip(left, right) {
  const leftAt = Number(left.timestamp) || 0;
  const rightAt = Number(right.timestamp) || 0;
  if (leftAt !== rightAt) return leftAt > rightAt ? left : right;
  return String(left.id) <= String(right.id) ? left : right;
}

/**
 * Collapse rows with identical content but different ids (created on several
 * devices, or left behind by a union merge). The survivor must be the same on
 * every device, otherwise each device would delete the other's copy.
 * Returns the dropped ids so references (favorites, active note) can follow.
 */
function dedupeRows(rows, keyOf, prefer) {
  const winners = new Map();
  const order = [];
  for (const row of rows) {
    const key = row ? keyOf(row) : null;
    if (key == null) {
      order.push({ row });
      continue;
    }
    if (!winners.has(key)) {
      winners.set(key, row);
      order.push({ key });
      continue;
    }
    winners.set(key, prefer(winners.get(key), row));
  }
  const kept = order.map((slot) => (slot.key == null ? slot.row : winners.get(slot.key)));
  const keptIds = new Set(kept.map((row) => row && row.id));
  const remap = new Map();
  for (const row of rows) {
    if (!row || keptIds.has(row.id)) continue;
    const key = keyOf(row);
    if (key != null) remap.set(String(row.id), String(winners.get(key).id));
  }
  return { rows: kept, remap };
}

function dedupeWorkspaceSnapshot(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const next = { ...source };
  if (Array.isArray(source.aiCompletions)) {
    const unique = new Map();
    for (const row of source.aiCompletions) {
      const normalized = normalizeSyncedCompletion(row);
      if (!normalized) throw new Error('invalid_ai_completion_history');
      unique.set(normalized.id, unique.has(normalized.id) ? mergeSyncedCompletions(unique.get(normalized.id), normalized) : normalized);
    }
    next.aiCompletions = trimCompletionHistory([...unique.values()]);
  }

  if (Array.isArray(source.commands)) {
    next.commands = dedupeRows(source.commands, (row) => {
      const text = String(row.text || '').trim();
      return text ? text : null;
    }, preferEarlier).rows;
  }

  if (source.notes && typeof source.notes === 'object' && Array.isArray(source.notes.archive)) {
    const result = dedupeRows(source.notes.archive, (row) => {
      const content = String(row.content || '');
      if (!content.trim()) return null;
      return `${String(row.title || '')}\u0000${content}`;
    }, preferEarlier);
    const activeId = String(source.notes.activeId || '');
    next.notes = {
      ...source.notes,
      archive: result.rows,
      activeId: result.remap.get(activeId) || activeId,
    };
  }

  if (Array.isArray(source.links)) {
    const groups = source.links.map((group) => {
      if (!group || !Array.isArray(group.links)) return group;
      const seen = new Set();
      const links = group.links.filter((link) => {
        const url = String((link && link.url) || '');
        if (!url) return true;
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
      return links.length === group.links.length ? group : { ...group, links };
    });
    next.links = dedupeRows(groups, (group) => {
      const urls = asArray(group.links).map((link) => String((link && link.url) || '')).sort();
      if (!String(group.name || '').trim() && !urls.length) return null;
      return `${String(group.name || '')}\u0000${urls.join('\u0001')}`;
    }, preferEarlier).rows;
  }

  const clipboard = source.clipboard && typeof source.clipboard === 'object' ? source.clipboard : null;
  if (clipboard && Array.isArray(clipboard.history)) {
    const result = dedupeRows(clipboard.history, (row) => {
      if (row.type === 'image') return null;
      const text = row.text == null ? '' : String(row.text);
      return text ? `${row.type === 'url' ? 'url' : 'text'}\u0000${text}` : null;
    }, preferNewerClip);
    const favorites = [];
    for (const id of asArray(clipboard.favorites)) {
      const mapped = result.remap.get(String(id)) || String(id);
      if (!favorites.includes(mapped)) favorites.push(mapped);
    }
    next.clipboard = { ...clipboard, history: trimClipboardHistory(result.rows, favorites).history, favorites };
  }

  if (Array.isArray(source.secrets)) {
    next.secrets = dedupeRows(source.secrets, (row) => {
      if (!row.password) return null;
      return `${String(row.service || '')}\u0000${String(row.account || '')}\u0000${String(row.password)}`;
    }, preferEarlier).rows;
  }

  return next;
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
    audioSyncReason: String(recording.audioSyncReason || ''),
    audioOmitted: recording.audioOmitted === true,
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
    meta.audioSyncReason = 'audio_too_large';
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
  const source = dedupeWorkspaceSnapshot(snapshot);
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
      ...(note.conflict ? { conflict: note.conflict } : {}),
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

  for (const command of asArray(source.commands)) {
    if (!command || !command.id) continue;
    const text = String(command.text || '').trim();
    if (!text) continue;
    pushEntity(entities, COLLECTIONS.COMMANDS, `command:${command.id}`, {
      id: String(command.id),
      text,
      createdAt: Number(command.createdAt) || 0,
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

  for (const row of asArray(source.aiCompletions)) {
    pushEntity(entities, COLLECTIONS.AI_COMPLETIONS, `completion:${row.id}`, row);
  }

  for (const recording of asArray(source.recordings)) {
    if (!recording || recording.isDraft === true) continue;
    appendRecordingEntities(entities, warnings, recording);
  }

  const ai = source.aiSettings && typeof source.aiSettings === 'object' ? source.aiSettings : null;
  if (ai && (ai.apiKey || ai.llmApiKey || typeof ai.cursorToken === 'string' || ai.workspaceId || ai.region || ai.llmBaseUrl || ai.llmModel)) {
    sealOrSkip(entities, warnings, COLLECTIONS.AI_SETTINGS, 'ai:settings', {
      apiKey: String(ai.apiKey || ''),
      llmApiKey: String(ai.llmApiKey || ''),
      ...(typeof ai.cursorToken === 'string' ? { cursorToken: ai.cursorToken } : {}),
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

function planWorkspaceSync({ index, localEntities, remoteChanges, deviceName = '本机' } = {}) {
  const prior = index && typeof index === 'object' ? index : {};
  const hashes = { ...prior };
  const remoteIds = new Set();
  const completionMerges = new Map();
  const localList = Array.isArray(localEntities) ? [...localEntities] : [];
  function noteVersion(local) { const p = local.payload; const rootTitle = p.conflict?.originalTitle || p.title || (local.entityId === 'note:home' ? '首页笔记' : '笔记'); const title = p.conflict && String(p.title || '').startsWith(`${rootTitle}（冲突副本 · `) ? rootTitle : p.title || rootTitle; return crypto.createHash('sha256').update(JSON.stringify({ title, content: p.content ?? p.markdown ?? '' })).digest('hex'); }
  function preserveNote(local, provenance = null) {
    const p = local.payload, rootId = p.conflict?.originId || local.entityId;
    const originalTitle = p.conflict?.originalTitle || p.title || (local.entityId === 'note:home' ? '首页笔记' : '笔记');
    const versionHash = noteVersion(local);
    const id = `conflict-${crypto.createHash('sha256').update(`${rootId}:${versionHash}`).digest('hex').slice(0,32)}`;
    if (merged.has(`note:${id}`)) return;
    const at = Number(p.updatedAt || p.createdAt) || 0;
    const conflict = { originId: rootId, originalTitle, versionHash, deviceName: String(provenance ? provenance.deviceName || provenance.deviceId || '未知设备' : deviceName), ...(provenance?.deviceId ? { deviceId: provenance.deviceId } : {}), createdAt: at };
    const entity = { entityId: `note:${id}`, collection: COLLECTIONS.NOTES, op: 'upsert', payload: { kind: 'archive', id, title: `${originalTitle}（冲突副本 · ${conflict.deviceName} · ${at ? new Date(at).toLocaleString('zh-CN', { hour12: false }) : '时间未知'}）`, titleSource: 'user', content: String(p.content ?? p.markdown ?? ''), createdAt: at, updatedAt: at, conflict } };
    merged.set(entity.entityId, entity); localList.push(entity);
  }
  const localById = new Map(localList.map((entity) => [entity.entityId, entity]));
  const merged = new Map(localList.map((entity) => [entity.entityId, entity]));
  const latestChanges = new Map();
  for (const change of remoteChanges || []) {
    if (!change || !change.entityId) continue;
    const previous = latestChanges.get(change.entityId);
    if (!previous || (Number(change.serverRev) || 0) >= (Number(previous.serverRev) || 0)) {
      latestChanges.set(change.entityId, change);
    }
  }

  for (const change of latestChanges.values()) {
    if (!change || !change.entityId) continue;
    if (change.op !== 'delete' && (!change.payload || typeof change.payload !== 'object')) continue;
    const localNote = localById.get(change.entityId);
    if (change.op === 'delete') {
      if (change.collection === COLLECTIONS.NOTES && localNote && prior[change.entityId] !== undefined && entityHash(localNote) !== prior[change.entityId]) preserveNote(localNote);
      remoteIds.add(change.entityId);
      merged.delete(change.entityId);
      delete hashes[change.entityId];
      continue;
    }
    const entity = {
      entityId: change.entityId,
      collection: change.collection || collectionForEntityId(change.entityId),
      op: 'upsert',
      payload: change.payload,
    };
    const local = localById.get(change.entityId);
    const baseline = prior[change.entityId];
    if (entity.collection === COLLECTIONS.AI_COMPLETIONS && local) {
      const payload = mergeSyncedCompletions(local.payload, entity.payload);
      const combined = { ...entity, payload };
      remoteIds.add(entity.entityId); merged.set(entity.entityId, combined); hashes[entity.entityId] = entityHash(entity);
      if (entityHash(combined) !== entityHash(entity)) completionMerges.set(entity.entityId, combined);
      continue;
    }
    if (entity.collection === COLLECTIONS.NOTES && change.entityId !== 'note:active' && local && (baseline === undefined || entityHash(local) !== baseline) && entityHash(entity) !== baseline && entityHash(local) !== entityHash(entity)) {
      if (noteVersion(local) === noteVersion(entity)) { remoteIds.add(entity.entityId); merged.set(entity.entityId, entity); hashes[entity.entityId] = entityHash(entity); continue; }
      preserveNote(local); remoteIds.add(entity.entityId); merged.set(entity.entityId, entity); hashes[entity.entityId] = entityHash(entity); continue;
    }
    if (entity.collection === COLLECTIONS.NOTES && entity.entityId !== 'note:active' && baseline !== undefined && !local && entityHash(entity) !== baseline) { preserveNote(entity, change); merged.delete(entity.entityId); continue; }
    // A previous push may echo back after another local edit (or delete).
    // Keep local changes relative to the acknowledged baseline. Remote deletes
    // still win, so an edited stale copy cannot resurrect a tombstone.
    if (baseline !== undefined && (!local || (entityHash(local) !== baseline
      && entityHash(local) !== entityHash(entity)))) continue;
    remoteIds.add(change.entityId);
    merged.set(change.entityId, entity);
    hashes[change.entityId] = entityHash(entity);
  }

  const appliedIndex = { ...hashes };
  const toPush = [...completionMerges.values()];
  for (const entity of completionMerges.values()) hashes[entity.entityId] = entityHash(entity);
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

  // Apply the same capacity after the complete local/remote merge. Send deletes
  // for evicted remote rows so another pull cannot restore them indefinitely.
  const clips = [...merged.values()].filter(entity => entity.collection === COLLECTIONS.CLIPBOARD_HISTORY && entity.entityId !== 'clip:favorites');
  const favorites = asArray(merged.get('clip:favorites')?.payload?.ids);
  const trimmed = trimClipboardHistory(clips.map(entity => ({ ...entity.payload, id: entity.entityId })),
    favorites.map(id => `clip:${id}`));
  const completions = [...merged.values()].filter(entity => entity.collection === COLLECTIONS.AI_COMPLETIONS);
  const keptCompletions = new Set(trimCompletionHistory(completions.map(entity => ({ ...entity.payload, syncEntityId: entity.entityId }))).map(row => row.syncEntityId));
  const evictedIds = new Set([...trimmed.evicted.map(row => row.id), ...completions.filter(entity => !keptCompletions.has(entity.entityId)).map(entity => entity.entityId)]);
  for (let i = toPush.length - 1; i >= 0; i--) {
    if (evictedIds.has(toPush[i].entityId)) toPush.splice(i, 1);
  }
  for (const entityId of evictedIds) {
    merged.delete(entityId);
    delete hashes[entityId];
    if (prior[entityId] !== undefined || remoteIds.has(entityId)) {
      toPush.push({ entityId, collection: collectionForEntityId(entityId), op: 'delete', payload: {} });
    }
  }
  return { toPush, appliedIndex, nextIndex: hashes, mergedEntities: [...merged.values()] };
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
    audioSyncReason: String(meta.audioSyncReason || ''),
    audioBase64: '',
  };
  function unavailable(reason) { recording.audioOmitted = true; recording.audioSyncReason = reason; return recording; }
  if (typeof meta.audioBase64 === 'string' && meta.audioBase64) {
    const raw = Buffer.from(meta.audioBase64, 'base64');
    if (meta.audioSha256 && crypto.createHash('sha256').update(raw).digest('hex') !== meta.audioSha256) return unavailable('audio_checksum_mismatch');
    recording.audioBase64 = raw.toString('base64'); return recording;
  }
  if (!meta.audioChunks) return recording;
  if (!Array.isArray(blobs) || blobs.length !== meta.audioChunks) return unavailable('audio_incomplete');
  const ordered = blobs.slice().sort((left, right) => left.index - right.index);
  if (ordered.some((blob, index) => blob.index !== index)) return unavailable('audio_incomplete');
  const raw = Buffer.concat(ordered.map((blob) => Buffer.from(String(blob.data || ''), 'base64')));
  if (meta.audioSha256 && crypto.createHash('sha256').update(raw).digest('hex') !== meta.audioSha256) return unavailable('audio_checksum_mismatch');
  recording.audioBase64 = raw.toString('base64');
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
        ...(payload.conflict ? { conflict: payload.conflict } : {}),
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
    if (id.startsWith('command:')) {
      const text = String(payload.text || '').trim();
      if (!text) continue;
      snapshot.commands.push({
        id: String(payload.id || id.slice('command:'.length)),
        text,
        createdAt: Number(payload.createdAt) || 0,
      });
      continue;
    }
    if (id === 'clip:favorites') {
      snapshot.clipboard.favorites = asArray(payload.ids).map((item) => String(item));
      continue;
    }
    if (id.startsWith('completion:')) {
      const row = normalizeSyncedCompletion(payload);
      if (!row || id !== `completion:${row.id}`) throw new Error('invalid_ai_completion_history');
      snapshot.aiCompletions.push(row);
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
    const recording = reassembleRecording(meta, recordingBlobs.get(id));
    snapshot.recordings.push(recording);
    if (['audio_incomplete', 'audio_checksum_mismatch'].includes(recording.audioSyncReason)) warnings.push({ entityId: `recording:${id}`, reason: recording.audioSyncReason });
  }
  snapshot.commands.sort((left, right) => {
    const delta = (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0);
    if (delta) return delta;
    return String(left.id).localeCompare(String(right.id));
  });
  if (snapshot.secrets.length) secretsApplied = true;
  return { snapshot: dedupeWorkspaceSnapshot(snapshot), warnings, secretsApplied, aiApplied };
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
    if (Buffer.byteLength(JSON.stringify([mutation]), 'utf8') > maxBytes) {
      throw Object.assign(new Error('push_mutation_too_large'), { reason: 'push_mutation_too_large' });
    }
    const trial = current.concat(mutation);
    const size = Buffer.byteLength(JSON.stringify(trial), 'utf8');
    if (current.length && (size > maxBytes || trial.length > PUSH_BATCH_MAX_MUTATIONS)) {
      batches.push(current);
      current = [mutation];
      continue;
    }
    current = trial;
  }
  if (current.length) batches.push(current);
  return batches;
}

// Stage the whole pull before changing durable cursors. A later collection or
// page failing must leave every page available for the next attempt.
async function pullFullSnapshot({ pullPage, collection, maxPages = 10000 }) {
  let cursor = null, serverRev = null;
  const changes = [], visited = new Set();
  for (let page = 0; page < maxPages; page++) {
    const response = await pullPage({ cursor, collection, full: true });
    if (!response?.ok) return { ok: false, error: response?.error || 'full_pull_failed' };
    const body = response.body || {};
    const checked = validatePullResponse({ changes: body.changes, nextCursor: body.nextCursor, hasMore: body.hasMore, serverRev: body.serverRev });
    if (!checked.ok || body.fullSnapshot !== true || (serverRev !== null && body.serverRev !== serverRev)) return { ok: false, error: 'full_snapshot_invalid' };
    serverRev = body.serverRev;
    changes.push(...body.changes);
    if (!body.hasMore) return { ok: true, changes, serverRev, nextCursor: body.nextCursor, peer: body };
    if (visited.has(body.nextCursor)) return { ok: false, error: 'full_snapshot_cursor_loop' };
    cursor = body.nextCursor; visited.add(cursor);
  }
  return { ok: false, error: 'full_snapshot_page_limit' };
}

async function pullWorkspacePages({ store, accountId, pullPage, collections = WORKSPACE_COLLECTIONS, maxPages = Infinity }) {
  const pages = [];
  const remoteChanges = [];
  const fullCollections = [];
  for (const collection of collections) {
    let cursor = store.getPullCursor(accountId, collection).cursor;
    const visited = new Set([cursor]);
    for (let page = 0; page < maxPages; page += 1) {
      const response = await pullPage({ cursor, collection });
      if (!response?.ok && ['full_resync_required', 'mutation_expired_resync_required'].includes(response?.error)) {
        const full = await pullFullSnapshot({ pullPage, collection, maxPages });
        if (!full.ok) return full;
        const selected = selectWorkspaceChanges(full.changes, collection);
        remoteChanges.push(...selected);
        fullCollections.push({ collection, serverRev: full.serverRev, ids: selected.map(e => e.entityId) });
        // SQLite still applies bounded pages, all within the final transaction.
        const chunks = full.changes.length ? Array.from({length: Math.ceil(full.changes.length / 500)}, (_, i) => full.changes.slice(i*500, (i+1)*500)) : [[]];
        for (const changes of chunks) pages.push({ collection, pull: { changes, nextCursor: full.nextCursor, serverRev: full.serverRev, hasMore: false } });
        break;
      }
      if (!response || !response.ok) return { ok: false, error: response?.error || 'pull_failed' };
      const body = response.body || {};
      const check = validatePullResponse({ changes: body.changes, nextCursor: body.nextCursor,
        hasMore: body.hasMore, serverRev: body.serverRev });
      if (!check.ok) return { ok: false, error: check.reason };
      const pull = check.pull;
      pages.push({ collection, pull });
      remoteChanges.push(...selectWorkspaceChanges(pull.changes, collection));
      if (!pull.hasMore) break;
      if (page + 1 === maxPages || visited.has(pull.nextCursor)) return { ok: false, error: 'pull_page_limit' };
      cursor = pull.nextCursor;
      visited.add(cursor);
    }
  }
  return { ok: true, pages, remoteChanges, fullCollections };
}

function commitWorkspacePullPages(store, accountId, pages) {
  store._runInTransaction(() => {
    for (const { collection, pull } of pages) {
      const applied = store.applyPullPage({ accountId, collection, pull });
      if (!applied.ok) throw new Error(applied.reason || 'apply_pull_failed');
    }
  });
}

function workspaceProjectionToStorage(storage, projection) {
  const next = { ...storage };
  if (projection.notes) {
    next['notch-home-note'] = projection.notes.home || '';
    next['notch-note-archive-v1'] = JSON.stringify(projection.notes.archive || []);
    next['notch-note-active-archive-v1'] = projection.notes.activeId || '';
  }
  for (const [field, key] of [['links', 'notch-link-groups'], ['commands', 'notch-home-commands'],
    ['recordings', 'notch-recordings']]) {
    if (Array.isArray(projection[field])) next[key] = JSON.stringify(projection[field]);
  }
  if (projection.clipboard) {
    next['notch-clip-history'] = JSON.stringify(trimClipboardHistory(projection.clipboard.history, projection.clipboard.favorites).history);
    next['notch-clip-favorites'] = JSON.stringify(projection.clipboard.favorites || []);
  }
  return next;
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
  selectWorkspaceChanges,
  dedupeWorkspaceSnapshot,
  buildWorkspaceEntities,
  partitionEntities,
  planWorkspaceSync,
  projectWorkspaceEntities,
  hashesForEntities,
  mutationFromEntity,
  splitMutationBatches,
  pullWorkspacePages,
  pullFullSnapshot,
  commitWorkspacePullPages,
  workspaceProjectionToStorage,
  entityHash,
};

// A server push can accept independent mutations and reject a competing note.
// Continue later batches and acknowledge only the entities actually accepted.
async function pushWorkspaceEntities({ entities, deviceId, baseServerRev = 0, pushMutations }) {
  const confirmedIds = [], conflictIds = [];
  for (const batch of splitMutationBatches((entities || []).map(entity => mutationFromEntity(entity, { deviceId, baseServerRev })))) {
    const result = await pushMutations(batch);
    if (!result?.ok) return { ok: false, error: result?.error || 'push_failed', pushed: confirmedIds.length, confirmedIds, conflictIds };
    const statuses = new Map((result.applied || []).map(row => [row.clientMutationId, row.status]));
    for (const mutation of batch) {
      const status = statuses.get(mutation.clientMutationId);
      if (status === 'expired') return { ok: false, error: 'mutation_expired_resync_required', pushed: confirmedIds.length, confirmedIds, conflictIds };
      if (status === 'conflict') conflictIds.push(mutation.entityId);
      else if (status === 'applied' || status === 'duplicate') confirmedIds.push(mutation.entityId);
      else return { ok: false, error: 'push_ack_incomplete', pushed: confirmedIds.length, confirmedIds, conflictIds };
    }
  }
  return { ok: conflictIds.length === 0, ...(conflictIds.length ? { error: 'note_conflict_retry' } : {}), pushed: confirmedIds.length, confirmedIds, conflictIds };
}
module.exports.pushWorkspaceEntities = pushWorkspaceEntities;

// Migration deferred media must use the migration's acknowledged revision.
// A compacted history requires a real full snapshot before one bounded retry.
async function pushMigrationWorkspaceEntities({ entities, deviceId, baseServerRev, pushMutations, pullPage }) {
  let result = await pushWorkspaceEntities({ entities, deviceId, baseServerRev, pushMutations });
  if (result.ok || !['mutation_expired_resync_required', 'full_resync_required'].includes(result.error)) return result;
  const snapshots = [];
  for (const collection of WORKSPACE_COLLECTIONS) {
    const snapshot = await pullFullSnapshot({ pullPage, collection });
    if (!snapshot.ok) return snapshot;
    snapshots.push(snapshot);
  }
  const rebasedRev = Math.max(0, ...snapshots.map(snapshot => Number(snapshot.serverRev) || 0));
  result = await pushWorkspaceEntities({ entities, deviceId, baseServerRev: rebasedRev, pushMutations });
  return { ...result, resynced: true, rebasedRev };
}
module.exports.pushMigrationWorkspaceEntities = pushMigrationWorkspaceEntities;
