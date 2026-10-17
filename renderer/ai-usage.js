const pomeLocaleRendererAiUsage = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(() => {
  'use strict';
  const D = window.NotchAiUsageDomain;
  const tile = document.getElementById('home-cursor');
  if (!tile || !D) return;
  const byId = (id) => document.getElementById(id);
  const registry = D.registry;
  const state = Object.fromEntries(registry.providers.map(({ id }) => [id, null]));
  let refreshTimer;
  const revisions = Object.fromEntries(registry.providers.map(({ id }) => [id, 0]));
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
    const card = byId(registry.get(provider)?.settingsCard || registry.providers[0].settingsCard);
    card?.scrollIntoView({ block: 'center', behavior: 'instant' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  }
  function errorSettings(footnote, message, provider) {
    footnote.replaceChildren();
    const copy = document.createElement('span'); copy.className = 'ai-footnote-message'; copy.textContent = `${message} · `;
    footnote.append(copy);
    const button = document.createElement('button');
    button.className = 'ai-inline-settings'; button.type = 'button'; pomeLocaleRendererAiUsage.bind(button, "textContent", () => (pomeLocaleRendererAiUsage.t("copy.openSettings.93112c")));
    button.addEventListener('click', () => openSettings(provider)); footnote.append(button);
  }
  function paintQuota(row, name, remaining) {
    const label = pomeLocaleRendererAiUsage.t("copy.remainingQuota.68dc7b", { arg1: (name) });
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
    const container = byId(`${provider}-usage-rows`);
    container.dataset.dynamic = String(specs.length > 3);
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
    pomeLocaleRendererAiUsage.bind(source, "textContent", () => (invalid ? data?.ok ? pomeLocaleRendererAiUsage.t("copy.tokenExpiredUsingLocalData.e4b132") : pomeLocaleRendererAiUsage.t("copy.tokenExpired.22c3fe")
      : data?.warning ? pomeLocaleRendererAiUsage.t("copy.requestFailedUsingLocalData.af9dba") : data?.authSource === 'manual' || data?.configured && !data?.ok ? pomeLocaleRendererAiUsage.t("copy.manualToken.bf90e7") : pomeLocaleRendererAiUsage.t("copy.localSignIn.8c966e")));
    source.classList.toggle('is-error', Boolean(invalid));
    renderQuotaRows('cursor', D.quotaRows(data, 'cursor').map(({ key, name, windowUsage }) => ({
      key, name, windowUsage: data?.ok ? windowUsage : null,
      help: data?.poolWarnings?.grokBot && key === 'grok' ? data.poolWarnings.grokBot : key === 'grok' ? (date(data?.grokBot?.resetAt) ? pomeLocaleRendererAiUsage.t("copy.weeklyReset.53a8a8", { arg1: (date(data.grokBot.resetAt)) }) : pomeLocaleRendererAiUsage.t("copy.weeklyResetTimeUnknown.3a21cf"))
        : (date(data?.billing?.cycleEnd) ? pomeLocaleRendererAiUsage.t("copy.billingPeriodEnds.eae9ee", { arg1: (date(data.billing.cycleEnd)) }) : pomeLocaleRendererAiUsage.t("copy.billingPeriodUnknown.dbb002")),
    })));
    const footnote = byId('cursor-usage-footnote');
    footnote.classList.toggle('is-stale', Boolean(data?.stale));
    if (!data?.ok) {
      if (invalid) errorSettings(footnote, pomeLocaleRendererAiUsage.t("copy.tokenExpiredAndLocalSignInIs.3cc6be"), 'cursor');
      else pomeLocaleRendererAiUsage.bind(footnote, "textContent", () => (pomeLocaleRendererAiUsage.t("copy.usageUnavailableRefreshToRetry.1ceded")));
      return;
    }
    pomeLocaleRendererAiUsage.bind(footnote, "textContent", () => (pomeLocaleRendererAiUsage.t("copy.lastRefreshed.c4c148", { arg1: (data.stale ? pomeLocaleRendererAiUsage.t("copy.refreshFailedShowingPreviousData.480e57") : data.cached ? pomeLocaleRendererAiUsage.t("copy.cached.00e684") : ''), arg2: (D.clock(data.fetchedAt)) })));
  }
  function paintCodex() {
    const data = state.codex;
    const plan = D.planLabel(data?.plan);
    const fromLocal = data?.authSource === 'local' || !data?.authSource && data?.detected;
    const sourceLabel = [fromLocal ? pomeLocaleRendererAiUsage.t("copy.localCodex.bbc04a") : pomeLocaleRendererAiUsage.t("copy.manualToken.bf90e7"), plan].filter(Boolean).join(' · ');
    const source = byId('ai-codex-source');
    pomeLocaleRendererAiUsage.bind(source, "textContent", () => (data?.manualTokenInvalid
      ? fromLocal && data.updatedAt ? pomeLocaleRendererAiUsage.t("copy.tokenExpiredUsingLocalData.e4b132") : pomeLocaleRendererAiUsage.t("copy.tokenExpired.22c3fe") : sourceLabel));
    source.classList.toggle('is-error', Boolean(data?.manualTokenInvalid));
    const quotaRows = D.quotaRows(data, 'codex');
    renderQuotaRows('codex', (quotaRows.length ? quotaRows : [{ key: 'primary', name: pomeLocaleRendererAiUsage.t("copy.quota.32ce9f"), windowUsage: null }]).map(({ key, name, windowUsage }) => ({
      key, name, windowUsage: data?.ok ? windowUsage : null, help: D.resetText(windowUsage),
    })));
    const stale = data?.stale || D.quotaRows(data, 'codex').some(row => D.expired(row.windowUsage));
    const foot = byId('codex-usage-footnote');
    foot.classList.toggle('is-stale', stale);
    foot.classList.toggle('is-error', Boolean(data?.manualTokenInvalid || data?.remoteError || !data?.ok || !data?.updatedAt));
    const windows = D.quotaRows(data, 'codex').map(row => row.windowUsage).filter((w) => w?.resetsAt != null);
    const earliest = windows.sort((a, b) => a.resetsAt - b.resetsAt)[0];
    const miniReset = byId('codex-usage-mini-reset');
    miniReset.textContent = D.resetText(earliest);
    miniReset.hidden = foot.classList.contains('is-error');
    miniReset.classList.toggle('is-stale', stale);
    if (data?.manualTokenInvalid) {
      errorSettings(foot, pomeLocaleRendererAiUsage.t("copy.codexTokenExpiredGetANewToken.a45565"), 'codex');
      if (data.updatedAt && tile.dataset.widgetSize !== 'mini') {
        const time = document.createElement('span'); time.className = 'ai-footnote-time'; pomeLocaleRendererAiUsage.bind(time, "textContent", () => (pomeLocaleRendererAiUsage.t("copy.updated.ad4d52", { arg1: (D.clock(data.updatedAt)) }))); foot.append(time);
      }
    } else if (data?.remoteError) {
      pomeLocaleRendererAiUsage.bind(foot, "textContent", () => ([pomeLocaleRendererAiUsage.t("copy.onlineUsageIsTemporarilyUnavailable.9b1e18"), data.updatedAt ? pomeLocaleRendererAiUsage.t("copy.updated.7114c0", { arg1: (D.clock(data.updatedAt)) }) : ''].filter(Boolean).join(' · ')));
    } else if (!data?.ok) pomeLocaleRendererAiUsage.bind(foot, "textContent", () => (pomeLocaleRendererAiUsage.t("copy.localCodexDataIsUnavailableRefreshTo.a5aa7b")));
    else if (!data.updatedAt) pomeLocaleRendererAiUsage.bind(foot, "textContent", () => (data.configured ? pomeLocaleRendererAiUsage.t("copy.tokenConfiguredNoUsageDataYet.f32418") : pomeLocaleRendererAiUsage.t("copy.noLocalCodexUsageDataYet.f38b07")));
    else pomeLocaleRendererAiUsage.bind(foot, "textContent", () => (pomeLocaleRendererAiUsage.t("copy.updated.7114c0", { arg1: (D.clock(data.updatedAt)) })));
    const credits = data?.credits;
    const creditLabel = !credits ? pomeLocaleRendererAiUsage.t("copy.noData.497c85") : credits.unlimited ? pomeLocaleRendererAiUsage.t("copy.unlimited.8651f5") : credits.balance != null ? String(credits.balance) : credits.hasCredits ? pomeLocaleRendererAiUsage.t("copy.available.4d99c9") : pomeLocaleRendererAiUsage.t("copy.none.484d55");
    byId('ai-codex-details').innerHTML = ("<div><dt><span data-i18n=\"copy.plan.c1cfa1\">" + (pomeLocaleRendererAiUsage.t("copy.plan.c1cfa1")) + "</span></dt><dd>" + (escape(plan || pomeLocaleRendererAiUsage.t("copy.unknown.4d8c1c"))) + "</dd></div><div><dt>Credits</dt><dd>" + (escape(creditLabel)) + "</dd></div><div><dt><span data-i18n=\"copy.source.a488e9\">" + (pomeLocaleRendererAiUsage.t("copy.source.a488e9")) + "</span></dt><dd>" + (fromLocal ? pomeLocaleRendererAiUsage.t("copy.localSessionRecords.45f182") : pomeLocaleRendererAiUsage.t("copy.manualToken.bf90e7")) + "</dd></div>");
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
    for (const { id } of registry.providers) {
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
      const name = registry.get(id).label;
      const hint = button.dataset.level === 'critical' ? pomeLocaleRendererAiUsage.t("copy.quotaRunningLow.f8e557") : button.dataset.level === 'warn' ? pomeLocaleRendererAiUsage.t("copy.lowRemainingQuota.f5107a") : '';
      pomeLocaleRendererAiUsage.bind(button, "title", () => (pomeLocaleRendererAiUsage.t("copy.lowestRemainingQuota.775faf", { arg1: (name), arg2: (D.formatPercent(remaining)), arg3: (hint) })));
      button.setAttribute('aria-label', button.title);
    }
    tile.querySelector('.ai-usage-providers').hidden = !ids.length;
    byId('ai-usage-empty').hidden = Boolean(ids.length);
    tile.querySelector('.ai-empty-title').textContent = size === 'mini' ? D.FALLBACK.miniTitle : D.FALLBACK.title;
    tile.querySelector('.ai-empty-body').textContent = size === 'mini' ? D.FALLBACK.miniBody : D.FALLBACK.body;
    if (!ids.length && size === 'mini') byId('ai-usage-title').hidden = true;
    paintCursor(); paintCodex();
    for (const { id } of registry.providers) {
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
      await Promise.all(registry.providers.map(async ({ id, request }) => {
        const revision = revisions[id];
        try {
          const result = api?.[request] ? await api[request]({ force }) : { detected: false };
          if (revisions[id] === revision) state[id] = result;
        } catch {
          if (revisions[id] === revision) state[id] = state[id]?.ok ? { ...state[id], stale: true, refreshError: 'ipc_failed' }
            : { detected: state[id]?.detected, configured: state[id]?.configured, ok: false };
        }
      }));
      render();
    })();
    try { await inFlight; }
    finally {
      inFlight = null; byId('cursor-usage-refresh').classList.remove('is-loading');
      scheduleRefresh();
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
  const usageVisible = () => document.visibilityState === 'visible' && document.getElementById('app')?.classList.contains('expanded')
    && document.getElementById('tab-button-home')?.classList.contains('active') && !tile.hidden;
  for (const event of ['visibilitychange', 'notch:modechange', 'notch:tabchange', 'notch:home-modules-changed']) {
    document.addEventListener(event, () => { if (usageVisible()) refresh(); else scheduleRefresh(); });
  }
  document.addEventListener('notch:cursor-token-changed', () => { revisions.cursor++; state.cursor = null; render(); refresh({ force: true }); });
  document.addEventListener('notch:codex-token-changed', (event) => {
    revisions.codex++;
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
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh({ force: usageVisible() }), D.refreshDelay(state, usageVisible()));
  }
  window.addEventListener('pome:language-changed', render);
  window.NotchAiUsage = { refresh, openSettings };
  refresh();
})();
