'use strict';

/**
 * Feiniu web Panel. Tab order follows the desktop bar, with 设备 in the 首页 slot.
 * Node tests require() this file; the browser boots only when the device tab exists.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    root.PomeFnOsPanelUi = api;
    const start = () => {
      if (document.getElementById('tab-button-devices')) api.boot(document, window);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_GATEWAY_PREFIX = '/app/pome-panel';

  const TABS = Object.freeze([
    { id: 'devices', label: '设备' },
    { id: 'todo', label: '待办' },
    { id: 'clip', label: '剪贴' },
    { id: 'notes', label: '笔记' },
    { id: 'commands', label: '常用命令' },
    { id: 'links', label: '链接' },
    { id: 'recordings', label: '录制' },
    { id: 'credentials', label: '密钥' },
  ]);

  const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

  function resolveApiPrefix(pathname, metaPrefix) {
    if (metaPrefix != null && String(metaPrefix).trim() !== '') {
      return String(metaPrefix).trim().replace(/\/$/, '');
    }
    const raw = String(pathname || '/');
    const withoutFile = raw.replace(/\/[^/]*\.[a-zA-Z0-9]+$/, '');
    const cleaned = withoutFile.replace(/\/$/, '');
    if (cleaned) return cleaned;
    return '';
  }

  function apiUrl(prefix, path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    if (!prefix) return p;
    return `${prefix.replace(/\/$/, '')}${p}`;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (error) {
      return '';
    }
    return '';
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function clearNode(node) {
    if (!node) return;
    if (typeof node.replaceChildren === 'function') {
      node.replaceChildren();
      return;
    }
    if (Array.isArray(node.children)) node.children.length = 0;
    node.textContent = '';
  }

  function createPanelController(opts = {}) {
    const doc = opts.document;
    const win = opts.window || (typeof window !== 'undefined' ? window : null);
    const fetchImpl = opts.fetch || (win && win.fetch && win.fetch.bind(win)) || globalThis.fetch;
    const metaEl = doc && doc.querySelector('meta[name="gateway-prefix"]');
    const pathname = (win && win.location && win.location.pathname) || opts.pathname || '/';
    let apiPrefix = resolveApiPrefix(
      pathname,
      opts.gatewayPrefix != null ? opts.gatewayPrefix : (metaEl && metaEl.getAttribute('content')),
    );
    if (!apiPrefix && opts.preferDefaultPrefix !== false) {
      apiPrefix = DEFAULT_GATEWAY_PREFIX;
    }

    const byId = (id) => (doc ? doc.getElementById(id) : null);
    let view = null;
    let activeTab = 'devices';
    let clipFilter = 'all';
    let noteQuery = '';
    let selectedNote = '';
    let selectedRecording = '';
    const objectUrls = [];

    function revokeUrls() {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const url of objectUrls) {
          try { URL.revokeObjectURL(url); } catch (error) { /* already revoked */ }
        }
      }
      objectUrls.length = 0;
    }

    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function noteItems() {
      const notes = (view && view.notes) || {};
      const items = [];
      if (notes.home && String(notes.home).trim()) {
        items.push({ id: 'home', title: '首页速记', content: notes.home });
      }
      for (const note of notes.archive || []) {
        items.push({
          id: note.id || '',
          title: note.title || '未命名',
          content: note.content || '',
          active: note.id && note.id === notes.activeId,
        });
      }
      const query = noteQuery.trim().toLowerCase();
      if (!query) return items;
      return items.filter((item) => `${item.title}\n${item.content}`.toLowerCase().includes(query));
    }

    function renderNotes() {
      const list = byId('notes-list');
      const detail = byId('notes-detail');
      const count = byId('notes-count');
      const items = noteItems();
      if (count) count.textContent = `${(view && view.counts && view.counts.notes) || items.length} 篇`;
      if (!list || !doc) return;
      clearNode(list);
      if (!selectedNote || !items.some((item) => item.id === selectedNote)) {
        selectedNote = items[0] ? items[0].id : '';
      }
      for (const item of items) {
        const button = el('button', item.id === selectedNote ? 'notes-list-item active' : 'notes-list-item');
        button.type = 'button';
        button.appendChild(el('strong', '', item.title));
        if (item.content) button.appendChild(el('span', '', item.content.replace(/\s+/g, ' ').slice(0, 80)));
        if (item.active) button.appendChild(el('span', '', '当前笔记'));
        button.addEventListener('click', () => {
          selectedNote = item.id;
          renderNotes();
        });
        list.appendChild(button);
      }
      if (!detail) return;
      clearNode(detail);
      const current = items.find((item) => item.id === selectedNote);
      if (!current) return;
      const head = el('div', 'notes-detail-head');
      head.appendChild(el('span', 'tile-label', '笔记'));
      head.appendChild(el('strong', '', current.title));
      detail.appendChild(head);
      detail.appendChild(el('p', 'notes-body', current.content || ''));
    }

    function filteredClips() {
      const items = (view && view.clipboard) || [];
      if (clipFilter === 'faved') return items.filter((item) => item.favorite);
      if (clipFilter === 'image') return items.filter((item) => item.type === 'image' || item.hasImage);
      if (clipFilter === 'text') return items.filter((item) => item.type !== 'image');
      return items;
    }

    function renderClips() {
      const list = byId('clip-list');
      if (!list || !doc) return;
      clearNode(list);
      const items = filteredClips();
      if (!items.length) return;
      for (const item of items) {
        const type = item.type === 'url' || item.type === 'image' ? item.type : 'text';
        const card = el('article', `clip-item clip-item-${type} clip-type-${type}`);
        if (item.hasImage && item.id) {
          const wrap = el('div', 'clip-thumb-wrap');
          const img = el('img', 'clip-thumb');
          img.alt = '剪贴板图片';
          wrap.appendChild(img);
          card.appendChild(wrap);
          attachMedia(img, `clip:${item.id}`);
        }
        if (item.text) card.appendChild(el('p', 'clip-text', item.text));
        const meta = el('div', 'clip-meta');
        meta.appendChild(el('span', 'clip-time', item.favorite ? '已收藏' : (type === 'url' ? '链接' : type === 'image' ? '图片' : '文字')));
        card.appendChild(meta);
        list.appendChild(card);
      }
    }

    function renderRecordings() {
      const list = byId('recording-list');
      const detail = byId('recording-detail');
      const count = byId('recording-count');
      const items = (view && view.recordings) || [];
      if (count) count.textContent = `${items.length} 条`;
      if (!list || !doc) return;
      if (!selectedRecording || !items.some((item) => item.id === selectedRecording)) {
        selectedRecording = items[0] ? items[0].id : '';
      }
      clearNode(list);
      for (const item of items) {
        const button = el('button', item.id === selectedRecording ? 'recording-item active' : 'recording-item');
        button.type = 'button';
        button.appendChild(el('strong', '', item.title || '录音'));
        const bits = [];
        if (item.durationMs) bits.push(formatDuration(item.durationMs));
        if (item.category) bits.push(item.category);
        if (item.transcript) bits.push(item.transcript.replace(/\s+/g, ' ').slice(0, 42));
        if (bits.length) button.appendChild(el('span', '', bits.join(' · ')));
        button.addEventListener('click', () => {
          selectedRecording = item.id;
          renderRecordings();
        });
        list.appendChild(button);
      }
      if (!detail) return;
      clearNode(detail);
      const current = items.find((item) => item.id === selectedRecording);
      if (!current) return;
      const head = el('div', 'recording-detail-head');
      head.appendChild(el('strong', '', current.title || '录音'));
      const meta = [];
      if (current.durationMs) meta.push(formatDuration(current.durationMs));
      if (current.category) meta.push(current.category);
      if (current.audioOmitted) meta.push('音频过大，未随同步上传');
      if (meta.length) head.appendChild(el('span', '', meta.join(' · ')));
      detail.appendChild(head);
      if (current.hasAudio && !current.audioOmitted && current.id) {
        const holder = el('div', 'recording-audio');
        const audio = el('audio');
        audio.controls = true;
        audio.preload = 'none';
        holder.appendChild(audio);
        detail.appendChild(holder);
        attachMedia(audio, `recording:${current.id}`);
      }
      if (current.transcript) detail.appendChild(el('p', 'recording-transcript', current.transcript));
    }

    function renderCommands() {
      const list = byId('command-list');
      if (!list || !doc) return;
      clearNode(list);
      const items = (view && view.commands) || [];
      for (const item of items) {
        const text = item && item.text ? String(item.text) : '';
        if (!text) continue;
        const row = el('article', 'nas-command-item');
        row.appendChild(el('p', 'nas-command-text', text));
        list.appendChild(row);
      }
    }

    function renderLinks() {
      const host = byId('link-groups');
      if (!host || !doc) return;
      clearNode(host);
      const groups = (view && view.links) || [];
      const visible = groups.filter((group) => group.links && group.links.length);
      if (!visible.length) return;
      for (const group of visible) {
        const card = el('section', 'link-group tile');
        const head = el('div', 'link-group-head');
        head.appendChild(el('strong', '', group.name || '未分组'));
        head.appendChild(el('span', 'group-count', String(group.links.length)));
        card.appendChild(head);
        const body = el('div', 'link-group-body');
        for (const link of group.links) {
          const href = safeHttpUrl(link.url);
          if (!href) {
            body.appendChild(el('p', 'link-plain', link.title || link.url || ''));
            continue;
          }
          const row = el('a', 'link-item');
          row.setAttribute('href', href);
          row.setAttribute('target', '_blank');
          row.setAttribute('rel', 'noopener noreferrer');
          const mark = el('span', 'link-favicon', (link.title || href).slice(0, 1).toUpperCase());
          const copy = el('span', 'link-open');
          copy.appendChild(el('strong', '', link.title || href));
          copy.appendChild(el('span', '', href));
          row.appendChild(mark);
          row.appendChild(copy);
          body.appendChild(row);
        }
        card.appendChild(body);
        host.appendChild(card);
      }
    }

    function renderTodos() {
      if (!doc) return;
      const categories = (view && view.categories) || {};
      const todos = (view && view.todos) || [];
      for (const priority of PRIORITIES) {
        const name = byId(`todo-name-${priority}`);
        const count = byId(`todo-count-${priority}`);
        const list = byId(`todo-list-${priority}`);
        if (name && categories[priority]) name.textContent = categories[priority];
        const rows = todos.filter((item) => (item.categoryId || 'P3') === priority);
        if (count) count.textContent = String(rows.length);
        if (!list) continue;
        clearNode(list);
        if (!rows.length) continue;
        for (const item of rows) {
          const row = el('li', item.done ? 'todo-item done' : 'todo-item');
          row.setAttribute('data-priority', priority);
          const box = el('span', 'checkbox');
          box.setAttribute('aria-hidden', 'true');
          const mark = doc.createElementNS ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg') : el('span');
          if (mark.setAttribute) {
            mark.setAttribute('viewBox', '0 0 12 12');
            const path = doc.createElementNS ? doc.createElementNS('http://www.w3.org/2000/svg', 'path') : null;
            if (path) {
              path.setAttribute('d', 'M2 6.2 4.6 9 10 3');
              path.setAttribute('fill', 'none');
              path.setAttribute('stroke', 'white');
              path.setAttribute('stroke-width', '1.6');
              mark.appendChild(path);
            }
          }
          box.appendChild(mark);
          row.appendChild(box);
          row.appendChild(el('span', 'todo-text', item.text || ''));
          if (item.deadline) row.appendChild(el('span', 'todo-deadline', item.deadline));
          list.appendChild(row);
        }
      }
    }

    function setConfigState(id, value) {
      const node = byId(id);
      if (!node) return;
      const on = value === '已配置';
      node.textContent = on ? '已配置' : '未配置';
      node.setAttribute('data-state', on ? 'saved' : 'empty');
    }

    function renderCredentials() {
      const list = byId('credential-list');
      const count = byId('credential-count');
      const meta = byId('nas-ai-meta');
      const ai = (view && view.ai) || {};
      const secrets = (view && view.secrets) || [];
      setConfigState('nas-asr-status', ai.asr);
      setConfigState('nas-llm-status', ai.llm);
      if (meta) {
        const bits = [];
        if (ai.model) bits.push(`模型 ${ai.model}`);
        if (ai.region) bits.push(`区域 ${ai.region}`);
        if (ai.workspaceId) bits.push(`工作区 ${ai.workspaceId}`);
        meta.textContent = bits.join(' · ');
      }
      if (count) count.textContent = `${secrets.length} 项`;
      if (!list || !doc) return;
      clearNode(list);
      if (!secrets.length) return;
      for (const secret of secrets) {
        const card = el('article', 'credential-item');
        card.appendChild(el('strong', '', secret.service || '已配置'));
        card.appendChild(el('span', '', secret.account ? `账号 ${secret.account}` : '已配置'));
        card.appendChild(el('code', '', '已加密'));
        list.appendChild(card);
      }
    }

    async function attachMedia(node, entityId) {
      if (!fetchImpl || !entityId) return;
      try {
        const url = apiUrl(apiPrefix, `/api/v1/workspace/media/${encodeURIComponent(entityId)}`);
        const res = await fetchImpl(url, { credentials: 'same-origin' });
        if (!res || !res.ok || typeof res.blob !== 'function') return;
        const blob = await res.blob();
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
        let local = '';
        try {
          local = URL.createObjectURL(blob);
        } catch (error) {
          return;
        }
        objectUrls.push(local);
        node.src = local;
      } catch (error) {
        /* leave the card without media */
      }
    }

    function renderAll() {
      renderNotes();
      renderCommands();
      renderClips();
      renderRecordings();
      renderLinks();
      renderTodos();
      renderCredentials();
    }

    function selectTab(id) {
      if (!TABS.some((tab) => tab.id === id)) return Promise.resolve();
      activeTab = id;
      for (const tab of TABS) {
        const button = byId(`tab-button-${tab.id}`);
        const panel = byId(`tab-${tab.id}`);
        const on = tab.id === id;
        if (button) {
          button.className = on ? 'tab active' : 'tab';
          button.setAttribute('aria-selected', on ? 'true' : 'false');
          if (on) button.removeAttribute('tabindex');
          else button.setAttribute('tabindex', '-1');
        }
        if (panel) {
          panel.hidden = !on;
          panel.className = on ? 'tab-panel active' : 'tab-panel';
        }
      }
      if (id === 'devices') {
        const pair = win && win.PomeFnOsPairUi;
        const active = pair && typeof pair.getActiveController === 'function'
          ? pair.getActiveController()
          : null;
        if (active && typeof active.loadDevicePort === 'function') {
          void active.loadDevicePort();
        }
      }
      return Promise.resolve();
    }

    function showSection(name) {
      return selectTab(name === 'devices' ? 'devices' : 'todo');
    }

    function bindFilters() {
      for (const filter of ['all', 'text', 'image', 'faved']) {
        const button = byId(`clip-filter-${filter}`);
        if (!button) continue;
        button.addEventListener('click', () => {
          clipFilter = filter;
          for (const name of ['all', 'text', 'image', 'faved']) {
            const peer = byId(`clip-filter-${name}`);
            if (peer) peer.className = name === filter ? 'clip-filter active' : 'clip-filter';
          }
          renderClips();
        });
      }
      const search = byId('notes-search');
      if (search) {
        search.addEventListener('input', () => {
          noteQuery = search.value || '';
          renderNotes();
        });
      }
    }

    function bind() {
      for (const tab of TABS) {
        const button = byId(`tab-button-${tab.id}`);
        if (!button) continue;
        button.addEventListener('click', () => {
          void selectTab(tab.id);
        });
      }
      bindFilters();
    }

    async function fetchJson(path) {
      const url = apiUrl(apiPrefix, path);
      const res = await fetchImpl(url, { credentials: 'same-origin' });
      let body = {};
      if (res && typeof res.json === 'function') {
        try {
          body = await res.json();
        } catch (error) {
          body = {};
        }
      }
      return { res, body };
    }

    async function load() {
      if (!fetchImpl) return null;
      try {
        const { res, body } = await fetchJson('/api/v1/workspace');
        if (!res || !res.ok) return null;
        revokeUrls();
        view = body && typeof body === 'object' ? body : {};
        renderAll();
        return view;
      } catch (error) {
        return null;
      }
    }

    async function init() {
      bind();
      await selectTab(activeTab);
      await load();
    }

    return {
      apiPrefix,
      init,
      load,
      selectTab,
      showSection,
      safeHttpUrl,
    };
  }

  function boot(doc, win) {
    const controller = createPanelController({ document: doc, window: win });
    void controller.init();
    return controller;
  }

  return {
    TABS,
    resolveApiPrefix,
    apiUrl,
    safeHttpUrl,
    formatDuration,
    createPanelController,
    boot,
  };
});
