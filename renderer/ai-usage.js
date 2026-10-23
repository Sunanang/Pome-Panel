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
  const A = window.NotchQuotaAnimation;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const animation = A.createValueStore();
  const visualStates = new Map();
  let lastRequest = null;
  let renderedSize = null, renderedOrder = '';
  let pinnedDetails = null;
  let hoverDetailsTimer = null;
  let hoverDetailsId = null; // pending or currently hovered provider
  let openDetailsId = null; // provider whose popover is visible
  const HOVER_DETAILS_DELAY_MS = 1000;
  function clearHoverDetailsTimer() {
    if (hoverDetailsTimer) clearTimeout(hoverDetailsTimer);
    hoverDetailsTimer = null;
  }
  function hideOpenPopover() {
    tile.querySelectorAll('.cursor-usage-rows:popover-open').forEach(node => node.hidePopover());
    tile.querySelectorAll('[data-quota-toggle]').forEach(node => node.setAttribute('aria-expanded', 'false'));
    openDetailsId = null;
  }
  function closeDetails() {
    clearHoverDetailsTimer();
    hoverDetailsId = null;
    hideOpenPopover();
  }
  function showDetails(id) {
    clearHoverDetailsTimer();
    hideOpenPopover();
    const provider = byId(`ai-provider-${id}`), rows = byId(`${id}-usage-rows`);
    if (!provider || !rows) {
      hoverDetailsId = null;
      if (pinnedDetails === id) pinnedDetails = null;
      return;
    }
    hoverDetailsId = id;
    const r = provider.getBoundingClientRect();
    rows.style.width = `${Math.min(240, innerWidth - 24)}px`;
    rows.style.left = `${Math.max(12, Math.min(innerWidth - 252, r.left))}px`;
    rows.style.top = `${Math.max(12, Math.min(innerHeight - 190, r.bottom - 8))}px`;
    rows.showPopover();
    openDetailsId = id;
    tile.querySelectorAll('[data-quota-toggle]').forEach(node => { if (node.dataset.quotaToggle === id) node.setAttribute('aria-expanded', 'true'); });
  }
  function scheduleHoverDetails(id) {
    if (pinnedDetails || hoverDetailsId === id) return;
    clearHoverDetailsTimer();
    hoverDetailsId = id;
    // Switching providers: drop the previous bubble immediately, then wait again.
    if (openDetailsId && openDetailsId !== id) hideOpenPopover();
    hoverDetailsTimer = setTimeout(() => {
      hoverDetailsTimer = null;
      if (!pinnedDetails && hoverDetailsId === id) showDetails(id);
    }, HOVER_DETAILS_DELAY_MS);
  }
  tile.addEventListener('click', event => {
    const toggle = event.target.closest('[data-quota-toggle]');
    if (!toggle) return;
    const id = toggle.dataset.quotaToggle;
    if (pinnedDetails === id) { pinnedDetails = null; closeDetails(); }
    else { pinnedDetails = id; showDetails(id); }
  });
  tile.addEventListener('pointerover', event => {
    const provider = event.target.closest('.ai-usage-provider');
    if (pinnedDetails || !provider || provider.contains(event.relatedTarget)) return;
    scheduleHoverDetails(provider.dataset.provider);
  });
  tile.addEventListener('pointerout', event => {
    const provider = event.target.closest('.ai-usage-provider');
    if (!provider || provider.contains(event.relatedTarget)) return;
    // Moving to another provider in this tile: pointerover retargets. Closing here
    // races hidePopover layout with the next hover and drops the new timer.
    const next = event.relatedTarget?.closest?.('.ai-usage-provider');
    if (next && tile.contains(next)) return;
    if (!pinnedDetails) closeDetails();
    else clearHoverDetailsTimer();
  });
  tile.addEventListener('keydown', event => { if (event.target.matches('#ai-usage-footer[role=button]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); } if (event.key === 'Escape') { pinnedDetails = null; closeDetails(); event.stopPropagation(); } });
  document.addEventListener('pointerdown', event => { if (!tile.contains(event.target)) { pinnedDetails = null; closeDetails(); } });
  for (const name of ['notch:tabchange', 'notch:modechange']) document.addEventListener(name, () => { pinnedDetails = null; closeDetails(); });
  const revisions = Object.fromEntries(usageProviders().map(({ id }) => [id, 0]));
  let refreshTimer, inFlight = null, queuedForce = false;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => {
    const ms = D.toMillis(value);
    if (ms == null) return null;
    const dayOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    return I.date(dayOnly ? `${value}T00:00:00` : ms, dayOnly
      ? { month: 'numeric', day: 'numeric' }
      : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const pct = value => value == null ? '--<small>%</small>' : `${Math.round(value)}<small>%</small>`;
  const icon = id => `<span class="q-icon${id === 'grokbot' ? ' q-icon-tiled' : ''}" data-provider="${id}" aria-hidden="true" style="--q-icon-url:url('${escape(registry.get(id).icon)}')"><i></i></span>`;

  async function openSettings(provider) {
    await setActiveTab('settings');
    for (let i = 0; i < 75 && byId('tab-settings').getAttribute('aria-hidden') !== 'false'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (byId('tab-settings').getAttribute('aria-hidden') !== 'false') return;
    const card = byId(registry.get(provider)?.settingsCard || 'settings-ai-sources');
    card?.scrollIntoView({ block: provider ? 'center' : 'start', behavior: 'instant' });
    window.NotchUi?.openManual(provider);
    card?.querySelector('input')?.focus({ preventScroll: true });
  }
  function sourceLabel(id, data) {
    if (id === 'grokbot') return `${t('ui.grokbot.pool')} · ${sourceLabel('cursor', { ...data, authSource:data?.authSource || state.cursor?.authSource })}`;
    if (D.invalidToken(data)) {
      const fallback = data?.ok && (id !== 'codex' || data.updatedAt && (data.authSource === 'local' || !data.authSource && data.detected));
      return t(fallback ? 'copy.tokenExpiredUsingLocalData.e4b132' : 'copy.tokenExpired.22c3fe');
    }
    if (data?.warning) return t('copy.requestFailedUsingLocalData.af9dba');
    if (data?.authSource === 'manual' || data?.configured && !data?.ok) return t('copy.manualToken.bf90e7');
    if (id === 'codex') return t('copy.localCodex.bbc04a');
    if (['local', 'file', 'keychain', 'gh', 'hosts.yml'].includes(data?.authSource)) return t('copy.localSignIn.8c966e');
    return t(data?.configured ? 'copy.manualToken.bf90e7' : 'copy.localSignIn.8c966e');
  }
  function errorCopy(data) {
    return t(D.invalidToken(data) ? 'quota.tokenRequired' : data?.error === 'antigravity_quota_unavailable'
      ? 'providers.quotaUnavailable' : data?.error === 'grok_team_required' ? 'providers.grokTeamRequired' : 'copy.usageUnavailableRefreshToRetry.1ceded');
  }
  function rowHelp(id, data, window) {
    if (window?.resetsAt != null) return D.resetText(window);
    if (id === 'cursor' && date(data?.billing?.cycleEnd)) return t('copy.billingPeriodEnds.eae9ee', { arg1: date(data.billing.cycleEnd) });
    return D.resetText(window);
  }
  function model(id, size) {
    const data = state[id], status = D.status(data, id);
    const rows = D.quotaRows(data, id);
    if (!rows.length) rows.push({ key: 'primary', name: t('copy.quota.32ce9f'), windowUsage: data?.unlimited ? { unlimited: true } : null });
    const values = rows.map(row => {
      const w = data?.ok === false ? null : row.windowUsage;
      let value = D.remaining(w?.percent), kind = 'percent', display;
      if (w?.unlimited === true) { value = null; kind = 'unlimited'; display = t('copy.unlimited.8651f5'); }
      else if ((w?.currency === 'USD' || w?.unit === 'credits') && Number.isFinite(w.balance)) {
        value = null; kind = w.currency === 'USD' ? 'currency' : 'credits';
        display = I.number(w.balance, kind === 'currency' ? { style: 'currency', currency: 'USD' } : {});
      } else display = D.formatPercent(value);
      const repeated = rows.filter(item => item.short === row.short).length > 1;
      return { ...row, value, kind, display, short: repeated && row.scopeShort ? row.scopeShort : row.short || row.name, help: rowHelp(id, data, row.windowUsage) };
    });
    const inlineKeys = new Set(D.inlineRows(data, id, size).map(row => row.key));
    const inlineRows = values.filter(row => inlineKeys.has(row.key));
    const remaining = D.displayRemaining(data, id);
    const bottleneck = D.bottleneckInfo(data, id);
    const depleted = status === 'depleted';
    const exhausted = depleted && remaining == null;
    const selectedKey = D.displayRow(data, id)?.key;
    const selected = values.find(row => row.key === selectedKey) || values[0];
    const source = sourceLabel(id, data);
    const stamp = D.timestamp(data);
    const updated = stamp == null ? '' : t('copy.updated.7114c0', { arg1: D.clock(new Date(stamp).toISOString()) });
    const message = status === 'error' ? errorCopy(data) : status === 'stale' ? t('quota.stale')
      : exhausted ? t(selected.kind === 'credits' ? 'quota.creditsDepleted' : 'quota.balanceDepleted') : '';
    return { id, size, data, status, stale: D.isStale(data, id), rows: values, inlineRows, remaining, exhausted, depleted, bottleneck, level: depleted ? 'critical' : D.level(bottleneck?.remaining), selected, updated, message,
      title: [registry.get(id).label, source, message, ...values.map(row => `${row.name}: ${row.display} · ${row.help}`),
        id === 'codex' && data?.plan ? D.planLabel(data.plan) : '',
        id === 'codex' && data?.credits ? `Credits: ${data.credits.unlimited ? t('copy.unlimited.8651f5') : data.credits.balance ?? '--'}` : '', updated].filter(Boolean).join('\n') };
  }
  function ring(m, size) {
    const amount = m.selected.kind === 'currency' ? I.number(m.selected.windowUsage.balance, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }) : m.selected.display;
    const priorValue = animation.value(`${m.id}/${m.selected.key}/${['currency', 'credits'].includes(m.selected.kind) ? 'amount' : 'main'}`);
    const priorAmount = priorValue == null ? '' : m.selected.kind === 'currency' ? I.number(priorValue, { style:'currency', currency:'USD', currencyDisplay:'narrowSymbol' }) : m.selected.kind === 'credits' ? I.number(Math.round(priorValue)) : `${Math.round(priorValue)}%`;
    const valueLength = Math.max(3, [...String(amount)].length, [...priorAmount].length);
    const sw = m.size === 'mini' ? 3 : size <= 40 ? 3.5 : size >= 80 ? size * .075 : size >= 64 ? 5 : 4.5;
    const radius = (size - sw) / 2, c = size / 2, length = 2 * Math.PI * radius;
    const bad = m.status === 'error', unknown = m.remaining == null;
    const showPct = !unknown && m.status !== 'undetected';
    const dashed = bad || m.status === 'undetected' || unknown;
    const center = bad ? '<span class="q-alert" aria-hidden="true"></span>'
      : m.size === 'mini' ? icon(m.id)
      : m.exhausted ? `<span class="q-pct" data-main-amount>${escape(amount)}</span>`
      : unknown ? `<span class="q-ring-unknown"${['currency','credits'].includes(m.selected.kind) ? ' data-main-amount' : ''}>${m.selected.kind === 'unlimited' ? '∞' : ['currency','credits'].includes(m.selected.kind) ? escape(amount) : '—'}</span>` : `<span class="q-pct" data-main-number>${pct(m.remaining)}</span>`;
    const label = t('quota.windowRemaining', { source: registry.get(m.id).label, window: m.selected.name, remaining: m.selected.display, message: m.message ? ` · ${m.message}` : '' });
    return `<div class="q-ring" style="--q-ring-size:${size}px;--q-value-length:${valueLength}" ${showPct && !bad ? `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.remaining}"` : 'role="img"'} aria-label="${escape(label)}">
      <svg class="q-ring-svg" viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><linearGradient id="quota-gradient-${m.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="q-gradient-start"/><stop offset="1" class="q-gradient-end"/></linearGradient></defs>
      <circle class="q-ring-track" cx="${c}" cy="${c}" r="${radius}" fill="none" stroke-width="${dashed ? sw * .7 : sw}"${dashed ? ' stroke-dasharray="2 3.2"' : ''}/>
      ${dashed || unknown ? '' : `<circle class="q-ring-value" cx="${c}" cy="${c}" r="${radius}" fill="none" stroke="url(#quota-gradient-${m.id})" stroke-width="${sw}" stroke-linecap="round" data-length="${length}" stroke-dasharray="${length} ${length}" stroke-dashoffset="${length * (1 - m.remaining / 100)}"${m.remaining === 0 ? ' visibility="hidden"' : ''}/>`}</svg><span class="q-ring-center">${center}</span>
      ${m.size === 'mini' ? bottleneckDot(m) : ''}</div>`;
  }
  function bottleneckDot(m) {
    const b = m.bottleneck;
    if (!b || m.status === 'error' || b.remaining > 20) return '';
    return `<span class="q-bottleneck" data-state-fade="${m.status}" data-badge="${b.badge}" data-level="${b.level}" aria-hidden="true"></span>`;
  }

  function quotaRows(m, inline = false) {
    const updated = !inline && m.updated
      ? `<p class="ai-usage-detail-updated">${escape(m.updated)}</p>`
      : '';
    return `<div class="cursor-usage-rows${inline ? ' q-inline-rows' : ''}" ${inline ? 'aria-hidden="true"' : `popover="manual" id="${m.id}-usage-rows"`}>${inline ? '<div class="q-inline-content">' : ''}${(inline ? m.inlineRows : m.rows).map(row => {
      const name = row.kind === 'currency' ? t('providers.prepaidBalance') : row.kind === 'credits' ? t('providers.availableCredits') : row.name;
      const special = row.kind !== 'percent', value = special ? escape(row.display) : pct(row.value);
      const short = inline && m.size !== 'mini' ? (row.compactShort || row.short) : row.short;
      return `<div class="cursor-usage-row ai-quota-row" data-pool="${escape(row.key)}" data-bottleneck="${row.key === m.bottleneck?.key}" data-level="${D.level(row.value)}" data-kind="${row.kind}" data-expired="${D.expired(row.windowUsage)}">
        <div class="cursor-usage-meta"><span class="q-window-short">${escape(special ? name : short)}</span><span class="q-window-full">${escape(name)} <small class="q-window-reset">${escape(row.help)}</small></span><strong class="q-pct"${!inline && m.id === 'cursor' ? ` id="cursor-usage-${escape(row.key)}-pct"` : ''}>${value}</strong></div>
        <div class="cursor-usage-track"${special ? ' hidden' : ` role="progressbar" aria-label="${escape(t('copy.remainingQuota.68dc7b', { arg1: `${registry.get(m.id).label} ${name}` }))}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escape(row.display)}"${row.value == null ? '' : ` aria-valuenow="${row.value}"`}`}><i${!inline && m.id === 'cursor' ? ` id="cursor-usage-${escape(row.key)}-fill"` : ''} style="transform:scaleX(${(row.value ?? 0) / 100})"></i></div>
        <small class="ai-quota-help">${escape(row.help)}</small></div>`;
    }).join('')}${updated}${inline ? '</div>' : ''}</div>`;
  }
  function captionLines(m, { compact = false } = {}) {
    if (m.size === 'mini') return [];
    const constrained = m.bottleneck && m.bottleneck.remaining <= 20;
    const raw = constrained ? m.bottleneck.resetAt : m.selected.windowUsage?.resetsAt || (m.id === 'cursor' ? m.data?.billing?.cycleEnd : null);
    if (D.toMillis(raw) == null) return [];
    const time = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? date(raw)
      : D.recoveryTime(raw, Date.now(), compact ? { compact: true } : {});
    if (constrained) return [t(m.depleted ? 'quota.recoveryAt' : 'quota.resetAt', { time })];
    return [t('quota.resetAt', { time })];
  }
  function provider(m, layout) {
    const error = m.status === 'error', caption = captionContent(m);
    const invalid = D.invalidToken(m.data), errorLabel = t(invalid ? 'quota.status.invalid' : 'quota.status.error');
    const settings = invalid || m.data?.error === 'grok_team_required';
    const repair = error ? `<button class="ai-inline-settings" type="button" data-quota-${settings ? 'settings' : 'retry'}="${m.id}" aria-label="${escape(`${registry.get(m.id).label} · ${t(settings ? 'copy.openSettings.93112c' : 'ui.retry')}`)}">${escape(t(settings ? 'quota.repair' : 'ui.retry'))}</button>` : '';
    // No native title tooltip — details live in the progress popover (with updated time).
    return `<section class="ai-usage-provider" id="ai-provider-${m.id}" data-provider="${m.id}" data-state="${m.status}" data-stale="${m.stale}" data-level="${m.level}" data-unit="${m.selected.kind}" data-quota-window="${escape(m.selected.key)}" data-balance-empty="${m.exhausted}" data-has-bars="${m.inlineRows.length > 0 && !error}" data-depleted="${!error && visualStates.get(`${m.id}/depleted`) === true}" aria-label="${escape(registry.get(m.id).label)}" aria-description="${escape(m.title)}">
      <button class="q-detail-toggle" data-quota-toggle="${m.id}" type="button" aria-controls="${m.id}-usage-rows" aria-expanded="false" aria-label="${escape(t('ui.quota.details', { source: registry.get(m.id).label }))}"></button>
      <div class="q-provider-body">
        <div class="ai-usage-source">${icon(m.id)}<b style="--q-name-length:${registry.get(m.id).label.length}">${escape(registry.get(m.id).label)}</b></div>
        <div class="q-gauge-group">${ring(m, layout.ringSize)}${m.inlineRows.length && !error ? quotaRows(m, true) : ''}</div>
        <div class="q-compact-caption" data-state-fade="${m.status}"${caption.title ? ` title="${escape(caption.title)}"` : ''}>${caption.html}</div>
        <p class="cursor-usage-footnote" id="${m.id}-usage-footnote">${error ? `<span>${escape(errorLabel)}</span>${repair}` : ''}</p>
      </div>${quotaRows(m)}
      <div class="q-mini-value">${error ? escape(errorLabel) : m.remaining == null ? `<span data-main-amount>${escape(m.selected.display)}</span>` : `<span class="q-pct" data-main-number>${pct(m.remaining)}</span>`}</div></section>`;
  }

  function captionContent(m) {
    const fullLines = captionLines(m).filter(Boolean);
    const displayLines = captionLines(m, { compact: m.size === 'small' }).filter(Boolean);
    const zhSmall = m.size === 'small' && I.getState().effectiveLocale.startsWith('zh-');
    return {
      title: fullLines.join(' · '),
      html: displayLines.map((line) => {
        // Weekday captions may drop spaces ("周一16:58重置"). Calendar dates keep
        // spaces ("11/20 重置") after the clock was already omitted for small.
        const stripSpaces = zhSmall && !/\d+\//.test(line);
        return `<span>${escape(stripSpaces ? line.replace(/\s+/g, '') : line)}</span>`;
      }).join(''),
    };
  }

  function fadeState(node, key, next) {
    const previous = visualStates.get(key);
    if (previous && previous.state !== next && !motion.matches && node.checkVisibility()) {
      const ghost = document.createElement('span');
      ghost.className = 'q-fade-previous'; ghost.innerHTML = previous.html;
      node.append(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards', easing: 'ease-out' }).finished.then(() => ghost.remove()).catch(() => ghost.remove());
      node.animate([{ opacity: .15 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    }
    visualStates.set(key, { state: next, html: node.innerHTML.replace(/<span class="q-fade-previous"[\s\S]*$/, '') });
  }
  let currentLayout = null, currentModels = [];
  const compactNames = { claude:'Claude', antigravity:'Antigrav' };
  const textWidths = new Map();
  function textWidth(style, text) {
    const properties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'fontFeatureSettings', 'fontVariationSettings', 'letterSpacing'];
    const key = text + '|' + properties.map(name => style[name]).join('|');
    if (textWidths.has(key)) return textWidths.get(key);
    const probe = document.createElement('span');
    Object.assign(probe.style, { position:'fixed', left:'-10000px', visibility:'hidden', display:'inline-block', whiteSpace:'nowrap', padding:'0', border:'0', margin:'0' });
    properties.forEach(name => { probe.style[name] = style[name]; });
    probe.textContent = text;
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    // Reuse measurements across refreshes/resizes without retaining arbitrary labels forever.
    if (textWidths.size >= 256) textWidths.delete(textWidths.keys().next().value);
    textWidths.set(key, width);
    return width;
  }
  function syncGeometry(layout = currentLayout, models = currentModels) {
    currentLayout = layout; currentModels = models;
    if (!layout || !models.length) return;
    const size = tile.dataset.widgetSize || 'small';
    tile.dataset.quotaNarrow = String(tile.clientWidth < 600);
    const tall = size === 'medium' && layout.rows === 1 && models.length >= 3 && models.length <= 4;
    tile.dataset.quotaTall = String(tall);
    const css = getComputedStyle(tile);
    const number = key => parseFloat(css.getPropertyValue(key)) || 0;
    const cells = models.map(m => byId(`ai-provider-${m.id}`)).filter(Boolean);
    const rowCounts = models.map((m,index) => Math.min(3, Math.max(0, ...models.slice(Math.floor(index/layout.columns)*layout.columns,(Math.floor(index/layout.columns)+1)*layout.columns).map(item=>item.inlineRows.length))));
    let diameter = layout.ringSize;
    cells.forEach((card,index) => {
      const m = models[index], rows = m.inlineRows.length ? rowCounts[index] : 0;
      if (size !== 'mini') {
        const name = card.querySelector('.ai-usage-source b'), header = card.querySelector('.ai-usage-source');
        const target = number('--q-name-font');
        name.style.fontSize = `${target}px`;
        const font = getComputedStyle(name);
        const available = header.getBoundingClientRect().width - number('--q-icon-size') - 3 - .5;
        const fullName = registry.get(m.id).label;
        const readable = Math.min(target, 9.5);
        const fullSize = target * available / (textWidth(font, fullName) + .5);
        const label = fullSize < readable && compactNames[m.id] ? compactNames[m.id] : fullName;
        name.textContent = label;
        name.title = fullName;
        name.setAttribute('aria-label', fullName);
        name.style.fontSize = `${Math.max(8, Math.min(target, target*available/(textWidth(font, label)+.5)))}px`;
        // Variable fonts can change optical metrics as their size shrinks.
        // Check the actual text box as well, so a subpixel overflow cannot
        // silently replace the last letters with an ellipsis.
        const glyph = document.createRange();
        glyph.selectNodeContents(name);
        for (let attempt = 0; attempt < 3; attempt++) {
          const width = glyph.getBoundingClientRect().width;
          const room = name.getBoundingClientRect().width;
          if (width <= room + .01) break;
          if (name.textContent === fullName && compactNames[m.id]) name.textContent = compactNames[m.id];
          else name.style.fontSize = `${Math.max(8, parseFloat(getComputedStyle(name).fontSize) * (room - .75) / width)}px`;
          glyph.selectNodeContents(name);
        }
      }
      const rowHeight = rows ? rows*number('--q-window-line')+(rows-1)*number('--q-window-gap') : 0;
      card.style.setProperty('--q-window-height', `${rowHeight}px`);
      if (size !== 'mini') {
        const group = card.querySelector('.q-gauge-group'), area = group.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(group).paddingBottom) || 0;
        if (tall) {
          const center = area.top + area.height / 2;
          const nameBottom = card.querySelector('.ai-usage-source').getBoundingClientRect().bottom;
          const footerTop = card.querySelector('.q-compact-caption').getBoundingClientRect().top;
          const below = footerTop - center - rowHeight - (rows ? number('--q-tall-row-gap') : 0);
          diameter = Math.min(diameter, area.width - 2 * number('--q-cell-pad-x'), 2 * Math.min(center - nameBottom, below));
        } else diameter = Math.min(diameter, area.width, area.height-padding-rowHeight);
      }
      const labels = [...card.querySelectorAll('.q-inline-rows .q-window-short')];
      if (!labels.length) { animation.remove(`${m.id}/rows-offset`); return; }
      const font = getComputedStyle(labels[0]);
      const labelWidth = Math.ceil(Math.max(...labels.map(label => textWidth(font, label.textContent))));
      const valueStyle = getComputedStyle(card.querySelector('.q-inline-rows .q-pct'));
      const valueWidth = Math.ceil(textWidth(valueStyle, '100%') * 10) / 10 + .25;
      card.style.setProperty('--q-window-label-width', `${Math.min(labelWidth, card.clientWidth*.36)}px`);
      card.style.setProperty('--q-window-value-width', `${valueWidth}px`);
      // Keep the 100% column and track widths fixed; center the visible row,
      // excluding its unused numeric reserve. Reuse the value store so a refresh
      // during this adjustment continues from the currently painted transform.
      const visibleWidth = Math.max(...m.inlineRows.map(row => row.kind === 'percent'
        ? textWidth(valueStyle, `${Math.round(row.value ?? 0)}%`) : valueWidth));
      const pad = number('--q-cell-pad-x'), inset = Math.min(pad, number('--q-window-end-inset'));
      const offset = (inset + Math.max(0, valueWidth - visibleWidth) - pad) / 2;
      const content = card.querySelector('.q-inline-content');
      animation.set(`${m.id}/rows-offset`, offset, value => { content.style.transform = `translateX(${value}px)`; },
        { reduced:motion.matches, from:offset, delay:Math.min(180, Math.max(0, m.rows.length - 1) * 60) });
    });
    diameter = Math.max(10, Math.floor(diameter*10)/10);
    tile.style.setProperty('--q-render-size', `${diameter}px`);
    tile.style.setProperty('--q-ring-font', `${diameter*(diameter <= 40 ? .28 : .25)}px`);
  }
  function animatePositions(previous, models) {
    for (const m of models) {
      const node = byId(`ai-provider-${m.id}`)?.querySelector('.q-ring'), before = previous.get(m.id);
      if (!node || !before) continue;
      const after = node.getBoundingClientRect();
      if (Math.abs(before.width - after.width) > .5) continue;
      const dx = before.left - after.left, dy = before.top - after.top;
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5) continue;
      // Reuse the existing value store for FLIP adaptation; a second refresh
      // measures the current visual frame before rebinding the new DOM.
      animation.remove(`${m.id}/position`);
      animation.set(`${m.id}/position`, 0, value => { node.style.transform = value ? `translate(${dx * value}px,${dy * value}px)` : ''; }, { from:1, reduced:motion.matches });
    }
  }
  function animateModels(models) {
    const palette = getComputedStyle(tile);
    const rgb = token => (palette.getPropertyValue(token).trim().match(/[a-f0-9]{2}/gi) || []).map(n => parseInt(n, 16));
    function animateTone(key, level, nodes, reduced, delay = 0) {
      const tone = level === 'warn' ? 'warn' : level === 'critical' ? 'crit' : 'ok';
      for (const channel of ['a', 'b', 'text']) {
        const base = channel === 'text' ? [238,238,240] : rgb(`--q-ok-${channel}`);
        const target = channel === 'text' ? tone === 'ok' ? base : rgb(`--q-${tone}-t`) : rgb(`--q-${tone}-${channel}`);
        const current = target.map((n, i) => animation.value(`${key}/color-${channel}-${i}`) ?? base[i]);
        target.forEach((n, i) => animation.set(`${key}/color-${channel}-${i}`, n, value => {
          current[i] = value;
          nodes.forEach(node => node.style.setProperty(channel === 'text' ? '--q-number-color' : `--q-ring-color-${channel}`, `rgb(${current.join(' ')})`));
        }, { reduced, delay, from: base[i] }));
      }
    }
    for (const m of models) {
      const el = byId(`ai-provider-${m.id}`);
      const reduced = motion.matches;
      const priorDepleted = m.status !== 'error' && visualStates.get(`${m.id}/depleted`) === true;
      el.dataset.depleted = String(priorDepleted);
      const finish = () => { el.dataset.animating = 'false'; };
      animation.set(`${m.id}/depletion`, Number(m.depleted), () => {}, { reduced,
        from:Number(priorDepleted), delay:Math.min(180, Math.max(0, m.rows.length - 1) * 60),
        onEnd:() => { el.dataset.depleted=String(m.depleted); visualStates.set(`${m.id}/depleted`, m.depleted); } });
      const mainKey = `${m.id}/${m.selected.key}/main`;
      const ring = el.querySelector('.q-ring-value');
      const running = animation.set(mainKey, m.remaining, value => {
        for (const number of el.querySelectorAll('[data-main-number]')) number.innerHTML = pct(value);
        if (ring) { const length = Number(ring.dataset.length); ring.setAttribute('stroke-dashoffset', String(length * (1 - value / 100))); ring.setAttribute('visibility', value === 0 ? 'hidden' : 'visible'); }
      }, { reduced, onEnd: finish });
      el.dataset.animating = String(running);
      if (!running) finish();
      if (['currency', 'credits'].includes(m.selected.kind)) {
        const amountRunning = animation.set(`${m.id}/${m.selected.key}/amount`, m.selected.windowUsage?.balance, value => {
          const text = I.number(m.selected.kind === 'credits' ? Math.round(value) : value, m.selected.kind === 'currency' ? { style:'currency', currency:'USD', currencyDisplay:'narrowSymbol' } : {});
          el.querySelectorAll('[data-main-amount]').forEach(node => { node.textContent = text; });
        }, { reduced, onEnd: finish });
        el.dataset.animating = String(amountRunning);
      }
      m.rows.forEach((row, index) => {
        const nodes = [...el.querySelectorAll('.ai-quota-row')].filter(node => node.dataset.pool === String(row.key));
        animateTone(`${m.id}/${row.key}/row`, D.level(row.value), nodes, reduced, index * 60);
        animation.set(`${m.id}/${row.key}/row`, row.value, value => {
          for (const node of el.querySelectorAll('.ai-quota-row')) {
            if (node.dataset.pool !== String(row.key)) continue;
            node.querySelector('strong').innerHTML = pct(value);
            node.querySelector('.cursor-usage-track > i').style.transform = `scaleX(${value / 100})`;
          }
        }, { reduced, delay: index * 60 });
      });
      animateTone(m.id, m.level, [el], reduced);
      el.querySelectorAll('[data-state-fade]').forEach(node => fadeState(node, `${m.id}/label/${node.className}`, `${m.status}/${Boolean(m.bottleneck?.badge)}`));
    }
  }
  function render() {
    const size = tile.dataset.widgetSize || 'small', layout = D.dashboard(state, size);
    const ids = layout.ids;
    // Keep hidden compact sources cached, but release detached DOM sinks and
    // pending frames as soon as a source is disconnected.
    const connected = new Set(ids);
    animation.prune(key => connected.has(key.split('/')[0]));
    for (const key of visualStates.keys()) if (key !== 'footer' && !connected.has(key.split('/')[0])) visualStates.delete(key);
    tile.dataset.aiSources = ids.length === 2 ? ids.join('-') : ids.length > 2 ? `n-${ids.length}` : (ids[0] || 'none');
    tile.dataset.aiCount = String(ids.length);
    tile.dataset.aiDensity = ids.length >= 4 ? 'dense' : ids.length === 3 ? 'three' : 'few';
    tile.dataset.aiRows = String(layout.rows);
    tile.dataset.aiMany = String(ids.length > 6);
    byId('ai-usage-title').textContent = D.title();
    let more = byId('ai-usage-more');
    if (!more) { more = document.createElement('button'); more.id='ai-usage-more'; more.className='ai-usage-more'; more.type='button'; more.dataset.quotaSettings=''; tile.querySelector('.cursor-usage-head').insertBefore(more,byId('cursor-usage-refresh')); }
    more.hidden = size !== 'small' || !layout.hidden.length;
    more.textContent = `+${layout.hidden.length}`;
    more.setAttribute('aria-label',t('quota.moreSources',{count:layout.hidden.length}));
    tile.setAttribute('aria-label', D.title());
    const models = ids.map(id => model(id, size));
    const visible = layout.shown.map(id => models.find(m => m.id === id));
    const providers = byId('ai-usage-providers');
    const hoverToRestore = !pinnedDetails && openDetailsId
      && byId(`${openDetailsId}-usage-rows`)?.matches(':popover-open') ? openDetailsId : null;
    const focused = tile.contains(document.activeElement) ? document.activeElement?.dataset.quotaSettings : undefined;
    const order = visible.map(m => m.id).join('/');
    const sameLayout = renderedSize === size && renderedOrder === order;
    if (!sameLayout) animation.prune(key => !key.endsWith('/position'));
    const oldRings = sameLayout ? new Map([...providers.querySelectorAll('.ai-usage-provider')].map(el => [el.dataset.provider, el.querySelector('.q-ring').getBoundingClientRect()])) : new Map();
    renderedSize = size; renderedOrder = order;
    const scroll = providers.scrollTop;
    const rowScroll = new Map([...providers.querySelectorAll('.cursor-usage-rows')].map(el => [el.id, el.scrollTop]));
    providers.style.setProperty('--q-columns', layout.columns);
    providers.style.setProperty('--q-rows', layout.rows);
    providers.innerHTML = visible.map(m => provider(m, layout)).join('')
      + (size === 'mini' && layout.hidden.length ? `<button class="q-more-ring" type="button" data-quota-settings="" title="${escape(layout.hidden.map(id => models.find(m => m.id === id).title).join('\n\n'))}" aria-label="${escape(t('quota.moreSources', { count: layout.hidden.length }))}">+${layout.hidden.length}</button>` : '');
    openDetailsId = null; // The previous popover node was removed with the grid.
    providers.scrollTop = scroll;
    for (const [id, offset] of rowScroll) if (byId(id)) byId(id).scrollTop = offset;
    providers.hidden = !ids.length;
    byId('ai-usage-empty').hidden = Boolean(ids.length);
    tile.querySelector('.ai-empty-bars').innerHTML = ids.length ? '' : ['cursor', 'codex'].map(id => `<div><span>${escape(registry.get(id).label)}</span><i></i><small>${escape(t('copy.notDetected.156219'))}</small></div>`).join('');
    tile.querySelector('.ai-empty-title').textContent = size === 'mini' ? D.FALLBACK.miniTitle : D.FALLBACK.title;
    tile.querySelector('.ai-empty-body').textContent = size === 'mini' ? D.FALLBACK.miniBody : D.FALLBACK.body;
    const stamps = models.map(m => D.timestamp(m.data)).filter(n => n != null);
    const updated = stamps.length ? t('copy.updated.7114c0', { arg1: D.clock(new Date(Math.min(...stamps)).toISOString()) }) : '';
    const stale = D.staleSummary(state, ['mini', 'small'].includes(size));
    tile.dataset.stale = String(stale.stale);
    byId('ai-usage-updated').textContent = stale.text || updated;
    byId('ai-usage-updated').title = models.map(m => `${registry.get(m.id).label}: ${m.updated || '--'}`).join('\n');
    const footer = byId('ai-usage-footer');
    footer.hidden = !ids.length || size !== 'mini';
    const first = visible[0];
    const miniSummary = size === 'mini' ? D.miniSummary(state) : { severity:'ok' };
    footer.dataset.severity = miniSummary.severity;
    footer.textContent = size === 'mini' ? miniSummary.text || (first ? t('quota.windowSummary', { source: registry.get(first.id).label, window: D.percent(first.selected.windowUsage?.windowMinutes) > 0 ? `${first.selected.scopeShort || first.selected.short} · ` : '', remaining: first.status === 'error' ? t(D.invalidToken(first.data) ? 'quota.status.invalid' : 'quota.status.error') : first.selected.display }) : '') : '';
    // No native title on the mini footer — full dump duplicated the progress popover.
    footer.removeAttribute('title');
    delete footer.dataset.quotaSettings;
    delete footer.dataset.quotaRetry;
    if (size === 'mini' && miniSummary.repair) {
      delete footer.dataset.quotaToggle; footer.dataset.quotaSettings = miniSummary.repair; footer.tabIndex = 0; footer.setAttribute('role', 'button');
      footer.removeAttribute('aria-controls'); footer.setAttribute('aria-label', miniSummary.text);
    } else if (size === 'mini' && miniSummary.retry) {
      delete footer.dataset.quotaToggle; footer.dataset.quotaRetry = miniSummary.retry; footer.tabIndex = 0; footer.setAttribute('role', 'button');
      footer.removeAttribute('aria-controls'); footer.setAttribute('aria-label', miniSummary.text);
    } else if (size === 'mini' && first) {
      footer.dataset.quotaToggle = first.id; footer.tabIndex = 0; footer.setAttribute('role', 'button');
      footer.setAttribute('aria-controls', `${first.id}-usage-rows`);
      footer.setAttribute('aria-label', `${registry.get(first.id).label}: ${first.selected.display}`);
    } else {
      delete footer.dataset.quotaToggle; footer.removeAttribute('tabindex'); footer.removeAttribute('role');
      footer.removeAttribute('aria-controls'); footer.removeAttribute('aria-label');
    }
    if (size === 'mini' && footer.dataset.quotaToggle) footer.setAttribute('aria-expanded', String(pinnedDetails === first.id));
    else footer.removeAttribute('aria-expanded');
    if (focused !== undefined) [...tile.querySelectorAll('[data-quota-settings]')].find(el => el.dataset.quotaSettings === focused)?.focus({ preventScroll: true });
    syncGeometry(layout, visible);
    // Refreshes replace the grid even while the pointer stays still. Restore
    // visible details after geometry is settled, alongside the existing pin.
    if (pinnedDetails || hoverToRestore) showDetails(pinnedDetails || hoverToRestore);
    else if (hoverDetailsId && !byId(`ai-provider-${hoverDetailsId}`)) closeDetails();
    animateModels(visible);
    animatePositions(oldRings, visible);
    fadeState(footer, 'footer', miniSummary.severity);
    document.dispatchEvent(new CustomEvent('notch:ai-usage-updated', { detail: { ...state, ids } }));
  }
  async function refresh({ force = false } = {}) {
    const api = window.notchAPI;
    if (inFlight) { queuedForce ||= force; return inFlight; }
    byId('cursor-usage-refresh')?.classList.add('is-loading');
    const visible = usageVisible();
    lastRequest = Date.now();
    inFlight = (async () => {
      await Promise.all(usageProviders().map(async ({ id, request }) => {
        if (!D.shouldRefresh(state[id], { force, visible })) return;
        const revision = revisions[id];
        try {
          const result = api?.[request] ? await api[request]({ force }) : { detected: false };
          const hasReading = D.quotaRows(result, id).some(row => D.percent(row.windowUsage?.percent) != null || Number.isFinite(row.windowUsage?.balance) || row.windowUsage?.unlimited);
          const failed = result?.ok === false || Boolean(result?.remoteError && !hasReading);
          if (revisions[id] === revision) state[id] = failed && state[id]?.ok && D.available(state[id])
            ? { ...state[id], stale: true, refreshError: result.error || result.remoteError || 'request_failed', manualTokenInvalid: result.manualTokenInvalid ?? state[id].manualTokenInvalid, status: result.status ?? state[id].status } : result;
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
    if (event.target.closest('[data-quota-retry]')) { event.stopPropagation(); void refresh({ force:true }); return; }
    const action = event.target.closest('[data-quota-settings]');
    if (action) { event.stopPropagation(); void openSettings(action.dataset.quotaSettings || undefined); }
  });
  tile.querySelector('.ai-open-settings')?.addEventListener('click', () => openSettings());
  new MutationObserver(render).observe(tile, { attributes: true, attributeFilter: ['data-widget-size'] });
  new ResizeObserver(() => syncGeometry()).observe(tile);
  const usageVisible = () => document.visibilityState === 'visible' && document.getElementById('app')?.classList.contains('expanded')
    && document.getElementById('tab-button-home')?.classList.contains('active') && !tile.hidden;
  for (const event of ['visibilitychange', 'notch:modechange', 'notch:tabchange', 'notch:home-modules-changed']) {
    document.addEventListener(event, () => {
      syncTick();
      if (usageVisible()) {
        render();
        if (A.shouldRefreshOnShow(lastRequest, Date.now())) void refresh({ force: true });
      }
      else scheduleRefresh();
    });
  }
  document.addEventListener('notch:cursor-token-changed', () => {
    // Bump revisions so any in-flight snapshot for the previous credential is dropped.
    revisions.cursor++; state.cursor = null;
    for (const key of ['auto','other']) { animation.remove(`cursor/${key}/main`); animation.remove(`cursor/${key}/row`); }
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
  // Soft tick: only while the home tile is visible; skips a full rebuild when nothing expired.
  let tickTimer = null;
  function softTick() {
    if (!usageVisible()) return;
    const now = Date.now();
    const needs = usageProviders().some(({ id }) => {
      const data = state[id];
      if (!data || !D.available(data)) return false;
      const next = D.status(data, id, now);
      return next !== D.status(data, id, now - 30_000) || D.isStale(data, id, now) !== D.isStale(data, id, now - 30_000) || D.quotaRows(data, id).some(row => {
        const resetMs = D.toMillis(row.windowUsage?.resetsAt);
        return resetMs != null && resetMs > now - 30_000 && resetMs <= now;
      });
    });
    if (needs) render();
    else {
      const stale = D.staleSummary(state, ['mini','small'].includes(tile.dataset.widgetSize));
      if (stale.stale) byId('ai-usage-updated').textContent = stale.text;
      // Still refresh relative reset copy ("明天 …") once a minute without tearing the grid.
      for (const el of tile.querySelectorAll('.ai-usage-provider')) {
        const id = el.dataset.provider;
        const m = model(id, tile.dataset.widgetSize || 'small');
        const caption = el.querySelector('.q-compact-caption');
        if (caption) {
          const content = captionContent(m);
          if (caption.innerHTML !== content.html) caption.innerHTML = content.html;
          if (content.title) caption.title = content.title;
          else caption.removeAttribute('title');
        }
      }
    }
  }
  function syncTick() {
    clearInterval(tickTimer);
    tickTimer = usageVisible() ? setInterval(softTick, 30_000) : null;
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh({ force: usageVisible() }), D.refreshDelay(state, usageVisible()));
  }
  motion.addEventListener('change', render);
  function resetTextMeasurements() { textWidths.clear(); syncGeometry(); }
  document.fonts.ready.then(resetTextMeasurements);
  document.fonts.addEventListener('loadingdone', resetTextMeasurements);
  window.addEventListener('pome:language-changed', render);
  window.NotchAiUsage = { refresh, openSettings };
  syncTick();
  refresh();
})();
