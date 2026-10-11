(() => {
  'use strict';
  const D = window.NotchAiUsageDomain;
  const tile = document.getElementById('home-cursor');
  if (!tile || !D) return;
  const byId = (id) => document.getElementById(id);
  const state = { cursor: null, codex: null };
  let remembered = null;
  try { remembered = localStorage.getItem(D.TAB_KEY); } catch {}
  let active = null;
  let inFlight = null;
  let queuedForce = false;
  const text = (id, value) => { byId(id).textContent = value; };
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = (value) => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? `${d.getMonth() + 1}/${d.getDate()}` : null; };
  function remember(id) { remembered = id; try { localStorage.setItem(D.TAB_KEY, id); } catch {} }
  async function openSettings(provider = active) {
    await setActiveTab('settings');
    // setActiveTab may queue during a transition; focus only once settings is visible.
    for (let i = 0; i < 75 && byId('tab-settings').getAttribute('aria-hidden') !== 'false'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (byId('tab-settings').getAttribute('aria-hidden') !== 'false') return;
    const card = byId(provider === 'codex' ? 'settings-codex-token-card' : 'settings-cursor-token-card');
    card?.scrollIntoView({ block: 'center', behavior: 'instant' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  }
  function errorSettings(footnote, message, provider) {
    footnote.replaceChildren();
    const copy = document.createElement('span'); copy.className = 'ai-footnote-message'; copy.textContent = `${message} · `;
    footnote.append(copy);
    const button = document.createElement('button');
    button.className = 'ai-inline-settings'; button.type = 'button'; button.textContent = '去设置';
    button.addEventListener('click', () => openSettings(provider)); footnote.append(button);
  }
  function paintQuota(row, name, remaining) {
    const label = `${name} 剩余额度`;
    const value = D.formatPercent(remaining);
    row.dataset.level = D.level(remaining);
    row.title = `${label}：${value}`;
    const track = row.querySelector('.cursor-usage-track');
    track.removeAttribute('aria-hidden');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', label);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuetext', value);
    if (remaining == null) track.removeAttribute('aria-valuenow');
    else track.setAttribute('aria-valuenow', String(Math.round(Math.min(100, remaining))));
    track.querySelector('i').style.width = `${Math.min(100, remaining ?? 0)}%`;
  }
  // Both providers use exactly this row component; size differences live in CSS.
  function renderQuotaRows(provider, specs) {
    const container = byId(provider === 'cursor' ? 'cursor-usage-rows' : 'codex-usage-rows');
    const rows = specs.map(({ key, name, windowUsage, help }) => {
      const row = document.createElement('div');
      row.className = 'cursor-usage-row ai-quota-row';
      row.dataset.provider = provider;
      row.dataset.pool = key;
      row.dataset.expired = String(provider === 'codex' && D.expired(windowUsage));
      row.innerHTML = `<div class="cursor-usage-meta"><span>${escape(name)}</span><strong>${escape(D.formatPercent(D.remaining(windowUsage?.percent)))}</strong></div><div class="cursor-usage-track"><i></i></div><small class="ai-quota-help">${escape(help)}</small>`;
      if (provider === 'cursor') {
        row.querySelector('strong').id = `cursor-usage-${key}-pct`;
        row.querySelector('i').id = `cursor-usage-${key}-fill`;
      }
      paintQuota(row, `${provider === 'cursor' ? 'Cursor' : 'Codex'} ${name}`, D.remaining(windowUsage?.percent));
      return row;
    });
    container.replaceChildren(...rows);
  }
  function paintCursor() {
    const data = state.cursor;
    const invalid = data?.manualTokenInvalid || data?.status === 401 || data?.status === 403;
    const source = byId('ai-cursor-source');
    source.textContent = invalid ? data?.ok ? 'Token 失效 · 已改用本机' : 'Token 失效'
      : data?.warning ? '请求失败 · 已改用本机' : data?.authSource === 'manual' || data?.configured && !data?.ok ? '手动 Token' : '本机登录';
    source.classList.toggle('is-error', Boolean(invalid));
    renderQuotaRows('cursor', [['auto', 'auto', 'Auto'], ['other', 'other', 'Other'], ['grok', 'grokBot', 'Grok Bot']].map(([key, pool, name]) => ({
      key, name, windowUsage: data?.ok ? data[pool] : null,
      help: key === 'grok' ? (date(data?.grokBot?.resetAt) ? `周重置 ${date(data.grokBot.resetAt)}` : '周重置时间未知')
        : (date(data?.billing?.cycleEnd) ? `账期至 ${date(data.billing.cycleEnd)}` : '账期未知'),
    })));
    const footnote = byId('cursor-usage-footnote');
    if (!data?.ok) {
      if (invalid) errorSettings(footnote, 'Token 已失效，本机登录也不可用', 'cursor');
      else footnote.textContent = '暂时读不到用量，点刷新重试';
      return;
    }
    footnote.textContent = `${data.cached ? '缓存 · ' : ''}最近刷新 ${D.clock(data.fetchedAt)}`;
  }
  function paintCodex() {
    const data = state.codex;
    const plan = D.planLabel(data?.plan);
    const fromLocal = data?.authSource === 'local' || !data?.authSource && data?.detected;
    const sourceLabel = [fromLocal ? '本机 Codex' : '手动 Token', plan].filter(Boolean).join(' · ');
    const source = byId('ai-codex-source');
    source.textContent = data?.manualTokenInvalid
      ? fromLocal && data.updatedAt ? 'Token 失效 · 已改用本机' : 'Token 失效' : sourceLabel;
    source.classList.toggle('is-error', Boolean(data?.manualTokenInvalid));
    renderQuotaRows('codex', [['primary', '5 小时额度'], ['secondary', '每周额度']].map(([key, name]) => {
      const windowUsage = data?.ok ? data[key] : null;
      return { key, name, windowUsage, help: D.resetText(windowUsage) };
    }));
    const stale = D.expired(data?.primary) || D.expired(data?.secondary);
    const foot = byId('codex-usage-footnote');
    foot.classList.toggle('is-stale', stale);
    foot.classList.toggle('is-error', Boolean(data?.manualTokenInvalid || data?.remoteError || !data?.ok || !data?.updatedAt));
    const windows = [data?.primary, data?.secondary].filter((w) => w?.resetsAt != null);
    const earliest = windows.sort((a, b) => a.resetsAt - b.resetsAt)[0];
    const miniReset = byId('codex-usage-mini-reset');
    miniReset.textContent = D.resetText(earliest);
    miniReset.hidden = foot.classList.contains('is-error');
    miniReset.classList.toggle('is-stale', stale);
    if (data?.manualTokenInvalid) {
      errorSettings(foot, 'Codex Token 已失效，请重新获取', 'codex');
      if (data.updatedAt && tile.dataset.widgetSize !== 'mini') {
        const time = document.createElement('span'); time.className = 'ai-footnote-time'; time.textContent = ` · 更新于 ${D.clock(data.updatedAt)}`; foot.append(time);
      }
    } else if (data?.remoteError) {
      foot.textContent = ['暂时无法联网查询', data.updatedAt ? `更新于 ${D.clock(data.updatedAt)}` : ''].filter(Boolean).join(' · ');
    } else if (!data?.ok) foot.textContent = '暂时无法读取本机 Codex，点刷新重试';
    else if (!data.updatedAt) foot.textContent = data.configured ? '已配置 Token，暂无用量数据' : '本机 Codex 暂无用量数据';
    else foot.textContent = `更新于 ${D.clock(data.updatedAt)}`;
    const credits = data?.credits;
    const creditLabel = !credits ? '暂无数据' : credits.unlimited ? '无限' : credits.balance != null ? String(credits.balance) : credits.hasCredits ? '可用' : '无';
    byId('ai-codex-details').innerHTML = `<div><dt>套餐</dt><dd>${escape(plan || '未知')}</dd></div><div><dt>Credits</dt><dd>${escape(creditLabel)}</dd></div><div><dt>来源</dt><dd>${fromLocal ? '本机会话记录' : '手动 Token'}</dd></div>`;
  }
  function render() {
    const ids = D.providers(state.cursor, state.codex);
    const size = tile.dataset.widgetSize;
    const previous = active;
    active = D.chooseTab(remembered, ids, state.cursor, state.codex);
    if (!remembered && active) remember(active);
    tile.dataset.aiSources = ids.join('-') || 'none';
    tile.dataset.aiActive = active || '';
    text('ai-usage-title', D.title(ids));
    tile.setAttribute('aria-label', D.title(ids));
    const switchable = ids.length === 2 && ['mini', 'small'].includes(size);
    const tabs = byId('ai-usage-tabs');
    tabs.hidden = !switchable;
    // In mini the switch lives in the heading, replacing the title.
    const head = tile.querySelector('.cursor-usage-head');
    if (size === 'mini') head.insertBefore(tabs, byId('cursor-usage-refresh'));
    else head.after(tabs);
    byId('ai-usage-title').hidden = size === 'mini' && switchable;
    for (const id of ['cursor', 'codex']) {
      const provider = byId(`ai-provider-${id}`);
      provider.hidden = !ids.includes(id) || switchable && active !== id;
      provider.setAttribute('role', switchable ? 'tabpanel' : 'region');
      if (switchable) provider.setAttribute('aria-labelledby', `ai-tab-${id}`);
      else provider.removeAttribute('aria-labelledby');
      const button = byId(`ai-tab-${id}`);
      button.hidden = !ids.includes(id);
      button.setAttribute('aria-selected', String(active === id));
      button.tabIndex = active === id ? 0 : -1;
      const remaining = D.lowestRemaining(state[id], id);
      button.dataset.level = active !== id ? D.level(remaining) : 'ok';
      const name = id === 'cursor' ? 'Cursor' : 'Codex';
      const hint = button.dataset.level === 'critical' ? ' · 剩余额度紧张' : button.dataset.level === 'warn' ? ' · 剩余额度较少' : '';
      button.title = `${name} 最少剩余额度：${D.formatPercent(remaining)}${hint}`;
      button.setAttribute('aria-label', button.title);
    }
    tile.querySelector('.ai-usage-providers').hidden = !ids.length;
    byId('ai-usage-empty').hidden = Boolean(ids.length);
    tile.querySelector('.ai-empty-title').textContent = size === 'mini' ? D.FALLBACK.miniTitle : D.FALLBACK.title;
    tile.querySelector('.ai-empty-body').textContent = size === 'mini' ? D.FALLBACK.miniBody : D.FALLBACK.body;
    if (!ids.length && size === 'mini') byId('ai-usage-title').hidden = true;
    paintCursor(); paintCodex();
    for (const id of ['cursor', 'codex']) {
      const source = byId(`ai-${id}-source`); source.title = source.textContent;
      const foot = byId(`${id === 'cursor' ? 'cursor' : 'codex'}-usage-footnote`); foot.title = foot.textContent;
    }
    if (previous !== active && tabs.contains(document.activeElement)) byId(`ai-tab-${active}`)?.focus();
    document.dispatchEvent(new CustomEvent('notch:ai-usage-updated', { detail: { codex: state.codex } }));
  }
  async function refresh({ force = false } = {}) {
    const api = window.notchAPI;
    if (inFlight) { queuedForce ||= force; return inFlight; }
    byId('cursor-usage-refresh').classList.add('is-loading');
    inFlight = (async () => {
      const tasks = [api?.getCursorUsage ? api.getCursorUsage({ force }) : Promise.resolve({ detected: false }),
        api?.getCodexUsage ? api.getCodexUsage({ force }) : Promise.resolve({ detected: false })];
      await Promise.all(tasks.map(async (task, index) => {
        const id = index === 0 ? 'cursor' : 'codex';
        try { state[id] = await task; }
        catch { state[id] = { detected: state[id]?.detected, configured: state[id]?.configured, ok: false }; }
      }));
      render();
    })();
    try { await inFlight; }
    finally {
      inFlight = null; byId('cursor-usage-refresh').classList.remove('is-loading');
      if (queuedForce) { queuedForce = false; refresh({ force: true }); }
    }
  }
  byId('cursor-usage-refresh').addEventListener('click', (event) => { event.stopPropagation(); refresh({ force: true }); });
  byId('ai-usage-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-ai-tab]');
    if (button) { event.stopPropagation(); remember(button.dataset.aiTab); render(); }
  });
  byId('ai-usage-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    remember(event.key === 'Home' ? 'cursor' : event.key === 'End' ? 'codex' : active === 'cursor' ? 'codex' : 'cursor');
    render(); byId(`ai-tab-${active}`).focus();
  });
  tile.querySelector('.ai-open-settings').addEventListener('click', () => openSettings());
  new MutationObserver(render).observe(tile, { attributes: true, attributeFilter: ['data-widget-size'] });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  document.addEventListener('notch:cursor-token-changed', () => refresh({ force: true }));
  document.addEventListener('notch:codex-token-changed', (event) => {
    if (state.codex) {
      state.codex = { ...state.codex, manualTokenInvalid: false, remoteError: null,
        configured: event.detail?.configured ?? state.codex.configured };
      if (state.codex.authSource === 'manual') {
        state.codex = { ok: true, detected: false, configured: state.codex.configured };
      }
      render();
    }
    refresh({ force: true });
  });
  // Expiry must update even when no new session record is written.
  setInterval(render, 30_000);
  setInterval(() => refresh(), 5 * 60_000);
  window.NotchAiUsage = { refresh, openSettings };
  refresh();
})();
