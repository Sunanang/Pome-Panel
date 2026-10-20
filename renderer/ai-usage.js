const pomeLocaleRendererAiUsage = typeof module === 'object' && module.exports ? require('../localization/runtime') : globalThis.PomeI18n;
(() => {
  'use strict';
  const D = window.NotchAiUsageDomain;
  const tile = document.getElementById('home-cursor');
  if (!tile || !D) return;
  const byId = id => document.getElementById(id);
  const I = pomeLocaleRendererAiUsage;
  const t = (key, args) => I.t(key, args);
  const registry = D.registry;
  const usageProviders = () => registry.usageProviders();
  const state = Object.fromEntries(usageProviders().map(({ id }) => [id, null]));
  const revisions = Object.fromEntries(usageProviders().map(({ id }) => [id, 0]));
  let refreshTimer, inFlight = null, queuedForce = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => { const d = new Date(value); return value && !Number.isNaN(d.getTime()) ? `${d.getMonth() + 1}/${d.getDate()}` : null; };
  const pct = value => value == null ? '--<small>%</small>' : `${Math.round(value)}<small>%</small>`;
  const icon = id => `<span class="q-icon${id === 'grokbot' ? ' q-icon-tiled' : ''}" data-provider="${id}" aria-hidden="true" style="--q-icon-url:url('${escape(registry.get(id).icon)}')"><i></i></span>`;

  async function openSettings(provider) {
    await setActiveTab('settings');
    for (let i = 0; i < 75 && byId('tab-settings').getAttribute('aria-hidden') !== 'false'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (byId('tab-settings').getAttribute('aria-hidden') !== 'false') return;
    const card = byId(registry.get(provider)?.settingsCard || 'settings-ai-usage-card');
    card?.scrollIntoView({ block: 'center', behavior: 'instant' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  }
  function sourceLabel(id, data) {
    if (D.invalidToken(data)) {
      const fallback = data?.ok && (id !== 'codex' || data.updatedAt && (data.authSource === 'local' || !data.authSource && data.detected));
      return t(fallback ? 'copy.tokenExpiredUsingLocalData.e4b132' : 'copy.tokenExpired.22c3fe');
    }
    if (data?.warning) return t('copy.requestFailedUsingLocalData.af9dba');
    if (data?.authSource === 'manual' || data?.configured && !data?.ok) return t('copy.manualToken.bf90e7');
    if (id === 'codex') return t('copy.localCodex.bbc04a');
    if (id === 'grokbot') return sourceLabel('cursor', { ...data, authSource: data?.authSource || state.cursor?.authSource });
    if (['local', 'file', 'keychain', 'gh', 'hosts.yml'].includes(data?.authSource)) return t('copy.localSignIn.8c966e');
    return t(data?.configured ? 'copy.manualToken.bf90e7' : 'copy.localSignIn.8c966e');
  }
  function errorCopy(data) {
    return t(D.invalidToken(data) ? 'quota.tokenRequired' : data?.error === 'antigravity_quota_unavailable'
      ? 'providers.quotaUnavailable' : data?.error === 'grok_team_required' ? 'providers.grokTeamRequired' : 'copy.usageUnavailableRefreshToRetry.1ceded');
  }
  function shortLabel(window, fallback) {
    const minutes = D.percent(window?.windowMinutes);
    if (minutes === 10080) return t('quota.week');
    if (minutes === 1440) return t('quota.day');
    if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
    return fallback;
  }
  function rowHelp(id, data, window) {
    if (window?.resetsAt != null) return D.resetText(window);
    if (id === 'cursor' && date(data?.billing?.cycleEnd)) return t('copy.billingPeriodEnds.eae9ee', { arg1: date(data.billing.cycleEnd) });
    return D.resetText(window);
  }
  function model(id, size, count) {
    const data = state[id], status = D.status(data, id);
    const rows = D.quotaRows(data, id);
    if (id === 'grokbot') rows.forEach(row => { row.name = t('copy.quota.32ce9f'); });
    if (!rows.length) rows.push({ key: 'primary', name: t('copy.quota.32ce9f'), windowUsage: data?.unlimited ? { unlimited: true } : null });
    const values = rows.map(row => {
      const w = data?.ok === false ? null : row.windowUsage;
      let value = D.remaining(w?.percent), kind = 'percent', display;
      if (w?.unlimited === true) { value = null; kind = 'unlimited'; display = t('copy.unlimited.8651f5'); }
      else if ((w?.currency === 'USD' || w?.unit === 'credits') && Number.isFinite(w.balance)) {
        value = null; kind = w.currency === 'USD' ? 'currency' : 'credits';
        display = I.number(w.balance, kind === 'currency' ? { style: 'currency', currency: 'USD' } : {});
      } else display = D.formatPercent(value);
      return { ...row, value, kind, display, short: row.windowUsage?.label && !row.windowUsage.labelIsFallback ? row.windowUsage.label : shortLabel(row.windowUsage, row.name), help: rowHelp(id, data, row.windowUsage) };
    });
    const remaining = D.lowestRemaining(data, id);
    const lowest = values.filter(row => row.value != null).sort((a, b) => a.value - b.value)[0] || values[0];
    const source = sourceLabel(id, data);
    const stamp = D.timestamp(data);
    const updated = stamp == null ? '' : t('copy.updated.7114c0', { arg1: D.clock(new Date(stamp).toISOString()) });
    const message = status === 'error' ? errorCopy(data) : status === 'stale' ? t('quota.stale') : '';
    const reset = [values.length > 1 ? lowest.short : '', lowest.help].filter(Boolean).join(' · ');
    return { id, data, status, rows: values, remaining, lowest, source, updated, message, reset,
      title: [registry.get(id).label, source, message, ...values.map(row => `${row.name}: ${row.display} · ${row.help}`),
        id === 'codex' && data?.plan ? D.planLabel(data.plan) : '',
        id === 'codex' && data?.credits ? `Credits: ${data.credits.unlimited ? t('copy.unlimited.8651f5') : data.credits.balance ?? '--'}` : '', updated].filter(Boolean).join('\n'),
      vertical: size === 'medium' && count <= 6 || size === 'large' && count >= 4,
      expanded: size === 'large' && count <= 3 };
  }
  function ring(m, size) {
    const sw = size === 32 ? 3 : size <= 40 ? 3.5 : size >= 80 ? 6 : size >= 64 ? 5 : 4.5;
    const radius = (size - sw) / 2, c = size / 2, length = 2 * Math.PI * radius;
    const bad = m.status === 'error', unknown = m.remaining == null;
    const dashed = bad || m.status === 'undetected' || unknown;
    const center = size === 32 ? icon(m.id) : bad
      ? '<span class="q-alert" aria-hidden="true"></span>'
      : unknown ? `<span class="q-ring-unknown">${m.lowest.kind === 'unlimited' ? '∞' : '—'}</span>` : `<span class="q-pct">${pct(m.remaining)}</span>`;
    const label = t('copy.lowestRemainingQuota.775faf', { arg1: registry.get(m.id).label, arg2: D.formatPercent(m.remaining), arg3: m.message });
    return `<div class="q-ring" style="--q-ring-size:${size}px" ${!bad && !unknown ? `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.remaining}"` : 'role="img"'} aria-label="${escape(label)}">
      <svg class="q-ring-svg" viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><linearGradient id="quota-gradient-${m.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="q-gradient-start"/><stop offset="1" class="q-gradient-end"/></linearGradient></defs>
      <circle class="q-ring-track" cx="${c}" cy="${c}" r="${radius}" fill="none" stroke-width="${dashed ? sw * .7 : sw}"${dashed ? ' stroke-dasharray="2 3.2"' : ''}/>
      ${dashed ? '' : `<circle class="q-ring-value" cx="${c}" cy="${c}" r="${radius}" fill="none" stroke="url(#quota-gradient-${m.id})" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${length * m.remaining / 100} ${length}"${m.remaining === 0 ? ' visibility="hidden"' : ''}/>`}</svg><span class="q-ring-center">${center}</span></div>`;
  }
  function quotaRows(m) {
    return `<div class="cursor-usage-rows" id="${m.id}-usage-rows">${m.rows.map(row => {
      const name = row.kind === 'currency' ? t('providers.prepaidBalance') : row.kind === 'credits' ? t('providers.availableCredits') : row.name;
      const special = row.kind !== 'percent', value = special ? escape(row.display) : pct(row.value);
      return `<div class="cursor-usage-row ai-quota-row" data-pool="${escape(row.key)}" data-level="${D.level(row.value)}" data-kind="${row.kind}" data-expired="${D.expired(row.windowUsage)}" title="${escape(`${name}: ${row.display} · ${row.help}`)}">
        <div class="cursor-usage-meta"><span class="q-window-short">${escape(special ? name : row.short)}</span><span class="q-window-full">${escape(name)} <small class="q-window-reset">${escape(row.help)}</small></span><strong class="q-pct"${m.id === 'cursor' ? ` id="cursor-usage-${escape(row.key)}-pct"` : ''}>${value}</strong></div>
        <div class="cursor-usage-track"${special ? ' hidden' : ` role="progressbar" aria-label="${escape(t('copy.remainingQuota.68dc7b', { arg1: `${registry.get(m.id).label} ${name}` }))}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escape(row.display)}"${row.value == null ? '' : ` aria-valuenow="${row.value}"`}`}><i${m.id === 'cursor' ? ` id="cursor-usage-${escape(row.key)}-fill"` : ''} style="width:${row.value ?? 0}%"></i></div>
        <small class="ai-quota-help">${escape(row.help)}</small></div>`;
    }).join('')}</div>`;
  }
  function provider(m, layout) {
    const chip = m.status === 'error' ? m.source : m.message || m.source;
    const errorAction = m.status === 'error' ? `<button class="ai-inline-settings" type="button" data-quota-settings="${m.id}">${escape(t('copy.openSettings.93112c'))}</button>` : '';
    const foot = [m.status === 'error' && !m.expanded && D.invalidToken(m.data) ? t('copy.tokenExpired.22c3fe') : m.message, m.updated].filter(Boolean).join(' · ');
    return `<section class="ai-usage-provider${m.vertical ? ' q-vertical' : ' q-horizontal'}" id="ai-provider-${m.id}" data-provider="${m.id}" data-state="${m.status}" data-level="${D.level(m.remaining)}" aria-label="${escape(registry.get(m.id).label)}" aria-description="${escape(m.title)}" title="${escape(m.title)}">
      ${ring(m, layout.ringSize)}<div class="q-provider-body">
      <div class="ai-usage-source">${icon(m.id)}<b>${escape(registry.get(m.id).label)}</b><span class="q-chip" id="ai-${m.id}-source">${escape(chip)}</span></div>
      ${quotaRows(m)}<div class="q-compact-caption">${escape(m.message || m.reset)}</div>
      <p class="cursor-usage-footnote" id="${m.id}-usage-footnote"><span>${escape(foot)}</span>${errorAction}</p></div>
      <div class="q-mini-value">${m.status === 'error' ? escape(D.invalidToken(m.data) ? 'Token' : t('quota.error')) : m.remaining == null ? escape(m.lowest.display) : `<span class="q-pct">${pct(m.remaining)}</span>`}</div></section>`;
  }
  function summary(models) {
    const low = models.filter(m => m.remaining != null).sort((a, b) => a.remaining - b.remaining)[0];
    const errors = models.filter(m => m.status === 'error').length;
    return `<div class="q-summary" data-level="${D.level(low?.remaining)}"><span class="q-caption">${escape(t('quota.lowest'))}</span>${low
      ? `<div class="ai-usage-source">${icon(low.id)}<b>${escape(registry.get(low.id).label)}</b></div><strong class="q-pct">${pct(low.remaining)}</strong><span class="q-caption">${escape(low.message || low.reset)}</span>`
      : `<strong>—</strong>`}${errors ? `<button class="ai-inline-settings" data-quota-settings="" type="button">${escape(t('quota.sourcesNeedAttention', { count: errors }))}</button>` : ''}</div>`;
  }
  function render() {
    const size = tile.dataset.widgetSize || 'small', layout = D.dashboard(state, size);
    const ids = layout.ids;
    tile.dataset.aiSources = ids.length === 2 ? ids.join('-') : ids.length > 2 ? `n-${ids.length}` : (ids[0] || 'none');
    tile.dataset.aiCount = String(ids.length);
    tile.dataset.aiDensity = ids.length >= 4 ? 'dense' : ids.length === 3 ? 'three' : 'few';
    tile.dataset.aiRows = String(layout.rows);
    tile.dataset.aiMany = String(ids.length > 6);
    byId('ai-usage-title').textContent = D.title();
    tile.setAttribute('aria-label', D.title());
    const models = ids.map(id => model(id, size, ids.length));
    const visible = layout.shown.map(id => models.find(m => m.id === id));
    const providers = byId('ai-usage-providers');
    const focused = tile.contains(document.activeElement) ? document.activeElement?.dataset.quotaSettings : undefined;
    const scroll = providers.scrollTop;
    const rowScroll = new Map([...providers.querySelectorAll('.cursor-usage-rows')].map(el => [el.id, el.scrollTop]));
    providers.style.setProperty('--q-columns', layout.columns);
    providers.style.setProperty('--q-rows', layout.rows);
    providers.innerHTML = visible.map(m => provider(m, layout)).join('') + (layout.summary ? summary(models) : '')
      + (size === 'mini' && layout.hidden.length ? `<button class="q-more-ring" type="button" data-quota-settings="" title="${escape(layout.hidden.map(id => models.find(m => m.id === id).title).join('\n\n'))}" aria-label="${escape(t('quota.moreSources', { count: layout.hidden.length }))}">+${layout.hidden.length}</button>` : '');
    providers.scrollTop = scroll;
    for (const [id, offset] of rowScroll) if (byId(id)) byId(id).scrollTop = offset;
    providers.hidden = !ids.length;
    byId('ai-usage-empty').hidden = Boolean(ids.length);
    tile.querySelector('.ai-empty-bars').innerHTML = ids.length ? '' : ['cursor', 'codex'].map(id => `<div><span>${escape(registry.get(id).label)}</span><i></i><small>${escape(t('copy.notDetected.156219'))}</small></div>`).join('');
    tile.querySelector('.ai-empty-title').textContent = size === 'mini' ? D.FALLBACK.miniTitle : D.FALLBACK.title;
    tile.querySelector('.ai-empty-body').textContent = size === 'mini' ? D.FALLBACK.miniBody : D.FALLBACK.body;
    const stamps = models.map(m => D.timestamp(m.data)).filter(n => n != null);
    const updated = stamps.length ? t('copy.updated.7114c0', { arg1: D.clock(new Date(Math.min(...stamps)).toISOString()) }) : '';
    byId('ai-usage-updated').textContent = updated;
    byId('ai-usage-updated').title = models.map(m => `${registry.get(m.id).label}: ${m.updated || '--'}`).join('\n');
    const footer = byId('ai-usage-footer');
    footer.hidden = !ids.length || size === 'medium' || size === 'large' && ids.length >= 4;
    const first = visible[0];
    footer.innerHTML = size === 'mini' ? escape(first ? first.message ? `${registry.get(first.id).label} · ${first.message}` : t('quota.minimumReset', { source: registry.get(first.id).label, reset: first.reset }) : '')
      : size === 'large' ? escape(t('quota.refreshOrder')) : `${layout.hidden.length ? `<button class="ai-inline-settings" type="button" data-quota-settings="" title="${escape(layout.hidden.map(id => models.find(m => m.id === id).title).join('\n\n'))}">${escape(t('quota.moreSources', { count: layout.hidden.length }))}</button> · ` : `${escape(t('quota.compactOrder'))} · `}${escape(updated)}`;
    footer.title = [footer.textContent, updated].filter(Boolean).join(' · ');
    if (focused !== undefined) [...tile.querySelectorAll('[data-quota-settings]')].find(el => el.dataset.quotaSettings === focused)?.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('notch:ai-usage-updated', { detail: { codex: state.codex, ids } }));
  }
  async function refresh({ force = false } = {}) {
    const api = window.notchAPI;
    if (inFlight) { queuedForce ||= force; return inFlight; }
    byId('cursor-usage-refresh')?.classList.add('is-loading');
    inFlight = (async () => {
      await Promise.all(usageProviders().map(async ({ id, request }) => {
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
      inFlight = null; byId('cursor-usage-refresh')?.classList.remove('is-loading');
      scheduleRefresh();
      // Await the queued force refresh so callers (settings save, tests) see fresh data.
      if (queuedForce) { queuedForce = false; await refresh({ force: true }); }
    }
  }
  byId('cursor-usage-refresh')?.addEventListener('click', (event) => { event.stopPropagation(); refresh({ force: true }); });
  tile.addEventListener('click', (event) => {
    const action = event.target.closest('[data-quota-settings]');
    if (action) { event.stopPropagation(); void openSettings(action.dataset.quotaSettings || undefined); }
  });
  tile.querySelector('.ai-open-settings')?.addEventListener('click', () => openSettings());
  new MutationObserver(render).observe(tile, { attributes: true, attributeFilter: ['data-widget-size'] });
  const usageVisible = () => document.visibilityState === 'visible' && document.getElementById('app')?.classList.contains('expanded')
    && document.getElementById('tab-button-home')?.classList.contains('active') && !tile.hidden;
  for (const event of ['visibilitychange', 'notch:modechange', 'notch:tabchange', 'notch:home-modules-changed']) {
    document.addEventListener(event, () => { if (usageVisible()) refresh(); else scheduleRefresh(); });
  }
  document.addEventListener('notch:cursor-token-changed', () => {
    // Bump revisions so any in-flight snapshot for the previous credential is dropped.
    revisions.cursor++; state.cursor = null;
    if ('grokbot' in revisions) { revisions.grokbot++; state.grokbot = null; }
    render();
    void refresh({ force: true });
  });
  document.addEventListener('notch:codex-token-changed', (event) => {
    revisions.codex++;
    state.codex = {
      ok: true,
      detected: false,
      configured: event.detail?.configured === true,
      manualTokenInvalid: false,
      remoteError: null,
    };
    render();
    void refresh({ force: true });
  });
  document.addEventListener('notch:ai-provider-token-changed', (event) => {
    const id = event.detail?.providerId;
    if (!id || !(id in revisions)) return;
    revisions[id]++; state[id] = null; render();
    void refresh({ force: true });
  });
  setInterval(render, 30_000);
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh({ force: usageVisible() }), D.refreshDelay(state, usageVisible()));
  }
  window.addEventListener('pome:language-changed', render);
  window.NotchAiUsage = { refresh, openSettings };
  refresh();
})();
