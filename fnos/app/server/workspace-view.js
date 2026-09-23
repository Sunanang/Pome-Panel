'use strict';

/**
 * Public projection of synced workspace entities for the Feiniu web Panel.
 * Secrets and API keys stay off the response. Media bytes are served separately.
 */

const { decryptJson, isSealedPayload } = require('../../../packages/sync-protocol');

const TODO_LABELS = Object.freeze({
  P0: '课程',
  P1: '自媒体&写作',
  P2: 'Vibe coding',
  P3: '日常',
});

const AUDIO_MIMES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/x-m4a']);

function clipText(value, limit) {
  const text = value == null ? '' : String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

function maskAccount(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 2) return '已配置';
  return `${text.slice(0, 1)}…${text.slice(-1)}`;
}

function openSealed(payload, accountKey) {
  if (!isSealedPayload(payload) || !accountKey) return null;
  try {
    return decryptJson(payload, accountKey);
  } catch (error) {
    return null;
  }
}

function buildWorkspaceView(entities, accountKey) {
  const notes = { home: '', activeId: '', archive: [] };
  const clipboard = [];
  const favorites = new Set();
  const recordings = [];
  const links = [];
  const commands = [];
  const todos = [];
  const categories = { ...TODO_LABELS };
  const secrets = [];
  let ai = {
    configured: false,
    asr: '未配置',
    llm: '未配置',
    model: '',
    region: '',
    workspaceId: '',
  };

  for (const entity of entities || []) {
    if (!entity || !entity.entityId) continue;
    const id = String(entity.entityId);
    const collection = entity.collection || 'todos';
    const payload = entity.payload && typeof entity.payload === 'object' ? entity.payload : {};

    if (collection === 'notes') {
      if (id === 'note:home') notes.home = clipText(payload.markdown, 8000);
      else if (id === 'note:active') notes.activeId = String(payload.id || '');
      else if (payload.kind === 'archive' || id.startsWith('note:')) {
        const content = clipText(payload.content, 8000);
        if (!content.trim() && !String(payload.title || '').trim()) continue;
        notes.archive.push({
          id: String(payload.id || id.slice(5)),
          title: String(payload.title || '未命名'),
          content,
          updatedAt: Number(payload.updatedAt) || 0,
        });
      }
      continue;
    }

    if (collection === 'clipboardHistory') {
      if (id === 'clip:favorites') {
        for (const fav of Array.isArray(payload.ids) ? payload.ids : []) favorites.add(String(fav));
        continue;
      }
      clipboard.push({
        id: String(payload.id || id.slice(5)),
        type: payload.type === 'image' || payload.type === 'url' ? payload.type : 'text',
        text: clipText(payload.text, 2000),
        timestamp: Number(payload.timestamp) || 0,
        hasImage: payload.type === 'image' && typeof payload.imageBase64 === 'string' && payload.imageBase64.length > 0,
      });
      continue;
    }

    if (collection === 'recordings') {
      if (id.startsWith('recording-blob:')) continue;
      const hasInline = typeof payload.audioBase64 === 'string' && payload.audioBase64.length > 0;
      const chunks = Number(payload.audioChunks) || 0;
      recordings.push({
        id: String(payload.id || id.slice('recording:'.length)),
        title: String(payload.title || '录音'),
        transcript: clipText(payload.transcript, 4000),
        category: String(payload.category || ''),
        durationMs: Math.max(0, Number(payload.durationMs) || 0),
        mimeType: String(payload.mimeType || 'audio/webm'),
        createdAt: Number(payload.createdAt) || 0,
        hasAudio: hasInline || chunks > 0,
        audioOmitted: payload.audioOmitted === true,
      });
      continue;
    }

    if (collection === 'commands' || id.startsWith('command:')) {
      const text = String(payload.text || '').trim();
      if (!text) continue;
      commands.push({
        id: String(payload.id || (id.startsWith('command:') ? id.slice('command:'.length) : id)),
        text: clipText(text, 2000),
        createdAt: Number(payload.createdAt) || 0,
      });
      continue;
    }

    if (collection === 'links') {
      links.push({
        id: String(payload.id || id.slice(5)),
        name: String(payload.name || '未分组'),
        links: (Array.isArray(payload.links) ? payload.links : []).map((link) => ({
          id: String(link && link.id || ''),
          url: String(link && link.url || ''),
          title: String(link && link.title || link.url || ''),
        })).filter((link) => link.url),
      });
      continue;
    }

    if (collection === 'todos') {
      if (id.startsWith('category:')) {
        const priority = id.slice('category:'.length);
        if (TODO_LABELS[priority] && typeof payload.name === 'string' && payload.name.trim()) {
          categories[priority] = payload.name.trim();
        }
        continue;
      }
      const text = String(payload.text || '').trim();
      if (!text) continue;
      todos.push({
        id: String(payload.id || id),
        text: clipText(text, 500),
        done: payload.done === true,
        categoryId: TODO_LABELS[payload.categoryId] ? payload.categoryId : 'P3',
        deadline: typeof payload.deadline === 'string' ? payload.deadline : '',
      });
      continue;
    }

    if (collection === 'aiSettings') {
      const plain = openSealed(payload, accountKey);
      if (plain) {
        ai = {
          configured: Boolean(plain.apiKey || plain.llmApiKey || plain.workspaceId || plain.llmModel),
          asr: plain.apiKey ? '已配置' : '未配置',
          llm: plain.llmApiKey ? '已配置' : '未配置',
          model: String(plain.llmModel || ''),
          region: String(plain.region || ''),
          workspaceId: String(plain.workspaceId || ''),
        };
      } else if (isSealedPayload(payload)) {
        ai = { configured: true, asr: '已配置', llm: '已配置', model: '', region: '', workspaceId: '' };
      }
      continue;
    }

    if (collection === 'secrets') {
      const plain = openSealed(payload, accountKey);
      if (plain) {
        secrets.push({
          id: String(plain.id || id.slice(7)),
          service: String(plain.service || '已配置'),
          account: maskAccount(plain.account),
          configured: true,
        });
      } else if (isSealedPayload(payload)) {
        secrets.push({
          id: id.startsWith('secret:') ? id.slice(7) : id,
          service: '已配置',
          account: '',
          configured: true,
        });
      }
    }
  }

  notes.archive.sort((left, right) => right.updatedAt - left.updatedAt);
  clipboard.forEach((item) => {
    item.favorite = favorites.has(item.id);
  });
  clipboard.sort((left, right) => right.timestamp - left.timestamp);
  recordings.sort((left, right) => right.createdAt - left.createdAt);
  commands.sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
  todos.sort((left, right) => Number(left.done) - Number(right.done));

  return {
    notes,
    clipboard,
    recordings,
    links,
    commands,
    todos,
    categories,
    ai,
    secrets,
    counts: {
      notes: (notes.home.trim() ? 1 : 0) + notes.archive.length,
      clipboard: clipboard.length,
      recordings: recordings.length,
      links: links.reduce((sum, group) => sum + group.links.length, 0),
      commands: commands.length,
      todos: todos.length,
      secrets: secrets.length,
    },
  };
}

function safeAudioMime(value) {
  const mime = String(value || '').split(';')[0].trim().toLowerCase();
  return AUDIO_MIMES.has(mime) ? mime : 'audio/webm';
}

function buildWorkspaceMedia(entities, entityId) {
  const id = String(entityId || '');
  if (!id || id.startsWith('secret:') || id === 'ai:settings') return null;
  const byId = new Map();
  for (const entity of entities || []) {
    if (entity && entity.entityId) byId.set(String(entity.entityId), entity);
  }
  if (id.startsWith('clip:')) {
    const entity = byId.get(id);
    const payload = entity && entity.payload;
    if (!payload || typeof payload.imageBase64 !== 'string' || !payload.imageBase64) return null;
    return { mime: 'image/png', bytes: Buffer.from(payload.imageBase64, 'base64') };
  }
  if (id.startsWith('recording:') && !id.startsWith('recording-blob:')) {
    const entity = byId.get(id);
    const payload = entity && entity.payload;
    if (!payload) return null;
    if (typeof payload.audioBase64 === 'string' && payload.audioBase64) {
      return { mime: safeAudioMime(payload.mimeType), bytes: Buffer.from(payload.audioBase64, 'base64') };
    }
    const chunks = Number(payload.audioChunks) || 0;
    if (!chunks) return null;
    const recordingId = String(payload.id || id.slice('recording:'.length));
    const parts = [];
    for (let index = 0; index < chunks; index += 1) {
      const blob = byId.get(`recording-blob:${recordingId}:${index}`);
      const data = blob && blob.payload && blob.payload.data;
      if (typeof data !== 'string' || !data) return null;
      parts.push(Buffer.from(data, 'base64'));
    }
    return { mime: safeAudioMime(payload.mimeType), bytes: Buffer.concat(parts) };
  }
  return null;
}

module.exports = {
  TODO_LABELS,
  buildWorkspaceView,
  buildWorkspaceMedia,
  maskAccount,
};
