'use strict';

/**
 * Feiniu web Panel — browse synced workspace content.
 * Pairing stays on the devices section. Node tests require() this file;
 * the browser boots only when the content nav exists.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    root.PomeFnOsPanelUi = api;
    const start = () => {
      if (document.getElementById('nav-content')) api.boot(document, window);
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
    { id: 'notes', label: '笔记' },
    { id: 'clipboard', label: '剪贴板' },
    { id: 'recordings', label: '录音' },
    { id: 'links', label: '链接' },
    { id: 'todos', label: '待办' },
    { id: 'config', label: '配置' },
  ]);

  const EMPTY = Object.freeze({
    notes: '还没有笔记。',
    clipboard: '还没有剪贴板记录。',
    recordings: '还没有录音。',
    links: '还没有链接。',
    todos: '还没有待办。',
    config: '还没有 AI 配置或密钥。',
  });

  const CLIP_LABEL = Object.freeze({
    text: '文字',
    url: '链接',
    image: '图片',
  });

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

    const els = {
      status: doc && doc.getElementById('workspace-status'),
      list: doc && doc.getElementById('workspace-list'),
      empty: doc && doc.getElementById('workspace-empty'),
      tabs: doc && doc.getElementById('workspace-tabs'),
      content: doc && doc.getElementById('panel-content'),
      devices: doc && doc.getElementById('panel-devices'),
      navContent: doc && doc.getElementById('nav-content'),
      navDevices: doc && doc.getElementById('nav-devices'),
    };

    let view = null;
    let activeTab = 'notes';
    let section = 'content';
    const objectUrls = [];

    function setStatus(text, kind) {
      if (!els.status) return;
      els.status.textContent = text || '';
      if (kind) els.status.setAttribute('data-kind', kind);
      else els.status.removeAttribute('data-kind');
    }

    function setCurrent(button, on) {
      if (!button) return;
      if (on) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }

    function showSection(name) {
      section = name === 'devices' ? 'devices' : 'content';
      if (els.content) els.content.hidden = section !== 'content';
      if (els.devices) els.devices.hidden = section !== 'devices';
      setCurrent(els.navContent, section === 'content');
      setCurrent(els.navDevices, section === 'devices');
    }

    function revokeUrls() {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const url of objectUrls) {
          try { URL.revokeObjectURL(url); } catch (error) { /* already revoked */ }
        }
      }
      objectUrls.length = 0;
    }

    function article(title) {
      const node = doc.createElement('article');
      node.className = 'nas-web-item';
      const heading = doc.createElement('h3');
      heading.textContent = title || '';
      node.appendChild(heading);
      return node;
    }

    function addLine(node, text, className) {
      const line = doc.createElement('p');
      if (className) line.className = className;
      line.textContent = text == null ? '' : String(text);
      node.appendChild(line);
      return line;
    }

    function describe(data) {
      const counts = data && data.counts ? data.counts : {};
      return [
        `笔记 ${counts.notes || 0}`,
        `剪贴板 ${counts.clipboard || 0}`,
        `录音 ${counts.recordings || 0}`,
        `链接 ${counts.links || 0}`,
        `待办 ${counts.todos || 0}`,
        `密钥 ${counts.secrets || 0}`,
      ].join(' · ');
    }

    function cardsFor(tab, data) {
      const cards = [];
      if (tab === 'notes') {
        const notes = data.notes || {};
        if (notes.home && String(notes.home).trim()) {
          const node = article('首页速记');
          addLine(node, notes.home);
          cards.push({ node });
        }
        for (const note of notes.archive || []) {
          const node = article(note.title || '未命名');
          if (note.content) addLine(node, note.content);
          if (note.id && note.id === notes.activeId) addLine(node, '当前笔记', 'nas-web-meta');
          cards.push({ node });
        }
        return cards;
      }

      if (tab === 'clipboard') {
        for (const item of data.clipboard || []) {
          const node = article(CLIP_LABEL[item.type] || '文字');
          if (item.text) addLine(node, item.text);
          if (item.favorite) addLine(node, '已收藏', 'nas-web-meta');
          let media = null;
          if (item.hasImage && item.id) {
            const img = doc.createElement('img');
            img.alt = '剪贴板图片';
            node.appendChild(img);
            media = { node: img, entityId: `clip:${item.id}` };
          }
          cards.push({ node, media });
        }
        return cards;
      }

      if (tab === 'recordings') {
        for (const item of data.recordings || []) {
          const node = article(item.title || '录音');
          if (item.transcript) addLine(node, item.transcript);
          const bits = [];
          if (item.durationMs) bits.push(formatDuration(item.durationMs));
          if (item.category) bits.push(item.category);
          if (bits.length) addLine(node, bits.join(' · '), 'nas-web-meta');
          if (item.audioOmitted) addLine(node, '音频过大，未随同步上传', 'nas-web-meta');
          let media = null;
          if (item.hasAudio && !item.audioOmitted && item.id) {
            const audio = doc.createElement('audio');
            audio.controls = true;
            audio.preload = 'none';
            node.appendChild(audio);
            media = { node: audio, entityId: `recording:${item.id}` };
          }
          cards.push({ node, media });
        }
        return cards;
      }

      if (tab === 'links') {
        for (const group of data.links || []) {
          const links = Array.isArray(group.links) ? group.links : [];
          if (!links.length) continue;
          const node = article(group.name || '未分组');
          for (const link of links) {
            const href = safeHttpUrl(link.url);
            if (!href) {
              addLine(node, link.title || link.url || '');
              continue;
            }
            const anchor = doc.createElement('a');
            anchor.textContent = link.title || href;
            anchor.setAttribute('href', href);
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
            node.appendChild(anchor);
          }
          cards.push({ node });
        }
        return cards;
      }

      if (tab === 'todos') {
        const categories = data.categories || {};
        for (const item of data.todos || []) {
          const node = doc.createElement('article');
          node.className = 'nas-web-item';
          node.setAttribute('data-done', item.done ? 'true' : 'false');
          const row = doc.createElement('div');
          row.className = 'nas-web-todo';
          const dot = doc.createElement('span');
          dot.className = 'nas-web-dot';
          dot.setAttribute('data-priority', item.categoryId || 'P3');
          const heading = doc.createElement('h3');
          heading.textContent = item.text || '';
          row.appendChild(dot);
          row.appendChild(heading);
          node.appendChild(row);
          const bits = [categories[item.categoryId], item.deadline].filter(Boolean);
          if (bits.length) addLine(node, bits.join(' · '), 'nas-web-meta');
          if (item.done) addLine(node, '已完成', 'nas-web-meta');
          cards.push({ node });
        }
        return cards;
      }

      const ai = data.ai || {};
      const secrets = Array.isArray(data.secrets) ? data.secrets : [];
      const hasAi = Boolean(ai.configured || ai.model || ai.workspaceId || ai.asr === '已配置' || ai.llm === '已配置');
      if (hasAi) {
        const node = article('AI 配置');
        addLine(node, `语音转写：${ai.asr === '已配置' ? '已配置' : '未配置'}`);
        addLine(node, `对话模型：${ai.llm === '已配置' ? '已配置' : '未配置'}`);
        if (ai.model) addLine(node, `模型 ${ai.model}`, 'nas-web-meta');
        if (ai.region) addLine(node, `区域 ${ai.region}`, 'nas-web-meta');
        if (ai.workspaceId) addLine(node, `工作区 ${ai.workspaceId}`, 'nas-web-meta');
        cards.push({ node });
      }
      for (const secret of secrets) {
        const node = article(secret.service || '已配置');
        addLine(node, secret.account ? `账号 ${secret.account}` : '已配置');
        cards.push({ node });
      }
      return cards;
    }

    async function attachMedia(node, entityId) {
      if (!fetchImpl || !entityId) return;
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
    }

    async function renderActive() {
      revokeUrls();
      clearNode(els.list);
      const cards = view ? cardsFor(activeTab, view) : [];
      if (!cards.length) {
        if (els.empty) {
          els.empty.hidden = false;
          if (!view) {
            els.empty.textContent = '还没有同步内容。桌面完成配对并同步后，这里会显示笔记、剪贴板、录音、链接和待办。';
          } else {
            els.empty.textContent = EMPTY[activeTab] || EMPTY.notes;
          }
        }
        return;
      }
      if (els.empty) els.empty.hidden = true;
      const pending = [];
      for (const card of cards) {
        if (els.list) els.list.appendChild(card.node);
        if (card.media) pending.push(attachMedia(card.media.node, card.media.entityId));
      }
      await Promise.all(pending);
    }

    function renderTabs() {
      if (!els.tabs || !doc) return;
      clearNode(els.tabs);
      for (const tab of TABS) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'workspace-button compact';
        button.textContent = tab.label;
        button.setAttribute('role', 'tab');
        button.setAttribute('data-tab', tab.id);
        button.setAttribute('aria-selected', tab.id === activeTab ? 'true' : 'false');
        button.addEventListener('click', () => {
          void selectTab(tab.id);
        });
        els.tabs.appendChild(button);
      }
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
      if (!fetchImpl) {
        setStatus('内容加载失败，请刷新后重试', 'error');
        return null;
      }
      try {
        const { res, body } = await fetchJson('/api/v1/workspace');
        if (!res || !res.ok) {
          const status = res && res.status;
          setStatus(
            status === 401
              ? '未检测到飞牛登录会话，请在飞牛已登录状态下打开本页'
              : '内容加载失败，请刷新后重试',
            'error',
          );
          return null;
        }
        view = body && typeof body === 'object' ? body : {};
        setStatus(describe(view), 'ok');
        await renderActive();
        return view;
      } catch (error) {
        setStatus('内容加载失败，请刷新后重试', 'error');
        return null;
      }
    }

    async function selectTab(id) {
      if (!TABS.some((tab) => tab.id === id)) return;
      activeTab = id;
      renderTabs();
      await renderActive();
    }

    function bind() {
      if (els.navContent) {
        els.navContent.addEventListener('click', () => showSection('content'));
      }
      if (els.navDevices) {
        els.navDevices.addEventListener('click', () => showSection('devices'));
      }
    }

    async function init() {
      bind();
      renderTabs();
      showSection(section);
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
    EMPTY,
    resolveApiPrefix,
    apiUrl,
    safeHttpUrl,
    formatDuration,
    createPanelController,
    boot,
  };
});
