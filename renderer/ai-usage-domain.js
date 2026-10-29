const pomeLocaleRendererAiUsageDomain = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./ai-provider-registry') : root.NotchAiProviders);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchAiUsageDomain = api;
})(typeof window === 'object' ? window : globalThis, function (registry) {
  'use strict';
  const FALLBACK = {
    get title() { return pomeLocaleRendererAiUsageDomain.t("copy.noAiToolsConnectedYet.91c4b3"); },
    get body() { return pomeLocaleRendererAiUsageDomain.t("copy.signInToCursorLocallyOrUse.3b099a"); },
    get miniTitle() { return pomeLocaleRendererAiUsageDomain.t("copy.noAiToolsConnected.116356"); },
    get miniBody() { return pomeLocaleRendererAiUsageDomain.t("copy.neitherCursorNorCodexWasDetected.243e58"); },
  };
  function available(data) {
    if (!data) return false;
    if ('detected' in data || 'configured' in data) return Boolean(data.detected || data.configured || data.manualTokenConfigured);
    return Boolean(data.manualTokenConfigured || data.ok && (data.updatedAt || data.authSource || data.fetchedAt));
  }
  function asSnapshots(first, second) {
    if (first && typeof first === 'object' && !Array.isArray(first) && (second === undefined || second === null)
      && !('detected' in first || 'configured' in first || 'ok' in first || 'authSource' in first || 'manualTokenConfigured' in first
        || 'auto' in first || 'primary' in first || 'windows' in first)) {
      return first;
    }
    // Backward-compatible (cursor, codex) signature used by older tests/callers.
    return { cursor: first, codex: second };
  }
  function providers(first, second) {
    const snapshots = asSnapshots(first, second);
    return registry.usageProviders().map((provider) => provider.id).filter((id) => available(snapshots[id]));
  }
  function title() { return pomeLocaleRendererAiUsageDomain.t('copy.aiQuota.faa20c'); }
  function percent(value) {
    if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
    const n = Number(value); return Number.isFinite(n) ? n : null;
  }
  function remaining(used) { const n = percent(used); return n == null ? null : Math.min(100, Math.max(0, 100 - n)); }
  // Prefer the shortest explicitly reported window. Equal durations retain source order.
  // Without cadence metadata, use the source's first bounded pool rather than its lowest value.
  function displayRow(data, id) {
    const rows = quotaRows(data, id).filter(row => row.windowUsage);
    let selected = null, shortest = Infinity;
    for (const row of rows) {
      const minutes = percent(row.windowUsage.windowMinutes);
      if (minutes > 0 && minutes < shortest) { selected = row; shortest = minutes; }
    }
    return selected || rows.find(row => !row.windowUsage.unlimited) || rows[0] || null;
  }
  function displayRemaining(data, id) {
    if (data?.ok === false) return null;
    const window = displayRow(data, id)?.windowUsage;
    return window?.unlimited || window?.currency || window?.unit === 'credits' ? null : remaining(window?.percent);
  }
  function level(value) { const n = percent(value); return n == null ? 'ok' : n <= 10 ? 'critical' : n <= 20 ? 'warn' : 'ok'; }
  function invalidToken(data) { return Boolean(data?.manualTokenInvalid || data?.status === 401 || data?.status === 403); }
  function cursorLoginBlocked(data) { return ['cursor_token_decrypt_failed', 'cursor_token_encrypted_unsupported'].includes(data?.error); }
  // Numbers: < 1e12 treated as unix seconds (resetsAt / legacy), otherwise milliseconds.
  function toMillis(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return value < 1e12 ? value * 1000 : value;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function timestamp(data) {
    return toMillis(data?.fetchedAt || data?.updatedAt);
  }
  // Presentation and constraint are independent: the shortest window owns the
  // number; every bounded pool participates in the bottleneck.
  function bottleneck(data, id) {
    if (data?.ok === false) return null;
    const rows = quotaRows(data, id);
    let selected = null;
    for (const row of rows) {
      const w = row.windowUsage;
      if (!w || w.unlimited) continue;
      const balance = w.currency || w.unit === 'credits';
      const value = balance ? Number.isFinite(w.balance) && w.balance <= 0 ? 0 : null : remaining(w.percent);
      if (value != null && (!selected || value < selected.remaining)) selected = { ...row, remaining: value };
    }
    return selected;
  }
  function urgencyRemaining(data, id) { return bottleneck(data, id)?.remaining ?? null; }
  function bottleneckInfo(data, id) {
    const row = bottleneck(data, id), display = displayRow(data, id);
    if (!row) return null;
    const a = percent(row.windowUsage?.windowMinutes), b = percent(display?.windowUsage?.windowMinutes);
    const sameCycle = id === 'cursor' && (a > 0 && b > 0 ? a === b
      : toMillis(row.windowUsage?.resetsAt) != null && toMillis(row.windowUsage.resetsAt) === toMillis(display?.windowUsage?.resetsAt));
    const name = id === 'cursor' ? row.short : row.scopeShort || row.short;
    return { ...row, name, level: row.remaining === 0 ? 'depleted' : level(row.remaining),
      badge: row.key !== display?.key && row.remaining <= 20 && !sameCycle,
      resetAt: typeof row.windowUsage?.resetsAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.windowUsage.resetsAt) ? null : toMillis(row.windowUsage?.resetsAt) };
  }
  function recoveryTime(value, now = Date.now(), options = {}) {
    const ms = toMillis(value);
    if (ms == null) return '';
    const d = new Date(ms), today = new Date(now);
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return clock(ms);
    // Within a week, weekday is enough for weekly quotas. Farther out (typical
    // monthly Cursor cycles) weekday alone is misleading — show the calendar day.
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startReset = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayDiff = Math.round((startReset - startToday) / 86400000);
    let day;
    let weekdayForm = false;
    if (dayDiff >= 1 && dayDiff <= 7) {
      day = d.toLocaleDateString(pomeLocaleRendererAiUsageDomain.getState().formatLocale, { weekday: 'short' });
      weekdayForm = true;
    } else if (d.getFullYear() === today.getFullYear()) {
      day = `${d.getMonth() + 1}/${d.getDate()}`;
    } else {
      day = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    // Small cards: keep weekday + clock (spaces may be stripped in zh UI), but
    // calendar dates drop the clock so "11/20 重置" stays readable.
    if (options.compact && !weekdayForm) return day;
    return `${day} ${clock(ms)}`;
  }
  function miniSummary(snapshots, now = Date.now()) {
    const ids = dashboard(snapshots, 'mini', now).ids;
    const errors = ids.filter(id => status(snapshots[id], id, now) === 'error');
    const blocked = errors.find(id => cursorLoginBlocked(snapshots[id]));
    if (blocked) return { text: pomeLocaleRendererAiUsageDomain.t('providers.cursorLoginBlockedSummary', { source: registry.get(blocked).label }), severity: 'error', repair: blocked };
    const invalid = errors.find(id => invalidToken(snapshots[id]));
    if (invalid) return { text: pomeLocaleRendererAiUsageDomain.t('quota.invalidSummary', { source: registry.get(invalid).label }), severity: 'error', repair: invalid };
    if (errors.length) return { text: pomeLocaleRendererAiUsageDomain.t('quota.failedSummary', { source: registry.get(errors[0]).label }), severity: 'error', retry: errors[0] };
    const valid = ids.filter(id => !['error', 'stale'].includes(status(snapshots[id], id, now)));
    const depleted = valid.filter(id => urgencyRemaining(snapshots[id], id) === 0);
    const critical = valid.filter(id => { const n = urgencyRemaining(snapshots[id], id); return n > 0 && n <= 10; });
    const label = id => id === 'claude' ? 'Claude' : registry.get(id).label;
    const t = (key, args) => pomeLocaleRendererAiUsageDomain.t(key, args);
    const earliest = depleted.map(id => bottleneckInfo(snapshots[id], id)?.resetAt).filter(ms => ms != null && ms > now);
    const time = earliest.length ? recoveryTime(Math.min(...earliest), now) : '';
    let text = '', severity = 'ok';
    if (depleted.length) {
      severity = 'depleted';
      const percentages = depleted.every(id => { const w = bottleneck(snapshots[id], id)?.windowUsage; return !w?.currency && w?.unit !== 'credits'; });
      if (depleted.length > 1 || depleted.length === ids.length) text = t(depleted.length === ids.length ? percentages ? 'quota.allDepleted' : 'quota.allZero' : percentages ? 'quota.manyDepleted' : 'quota.manyZero', { count: depleted.length }) + (time ? t('quota.earliest', { time }) : '');
      else if (critical.length) text = t(percentages ? 'quota.depletedAndCritical' : 'quota.zeroAndCritical', { source: label(depleted[0]), count: critical.length });
      else { const b = bottleneckInfo(snapshots[depleted[0]], depleted[0]); text = t(percentages ? 'quota.oneDepleted' : 'quota.oneZero', { source: label(depleted[0]), window: b.name }) + (time ? t('quota.recovers', { time }) : ''); }
    } else if (critical.length > 1) { severity = 'critical'; text = t('quota.manyCritical', { count: critical.length, source: label(critical[0]), value: Math.round(urgencyRemaining(snapshots[critical[0]], critical[0])) }); }
    else if (valid.some(id => { const n = urgencyRemaining(snapshots[id], id); return n != null && n <= 20; })) {
      const id = valid[0], b = bottleneckInfo(snapshots[id], id);
      if (b) { severity = b.level; text = t('quota.lowestWindow', { source: label(id), window: b.name, value: Math.round(b.remaining) }) + (b.resetAt != null ? ` · ${recoveryTime(b.resetAt, now)}` : ''); }
    } else if (staleSummary(snapshots, true, now).stale) {
      severity = 'stale'; text = staleSummary(snapshots, true, now).text;
    } else if (valid.length) {
      const id = valid[0], b = bottleneckInfo(snapshots[id], id);
      if (b) text = t('quota.lowestWindow', { source: label(id), window: b.name, value: Math.round(b.remaining) });
    }
    return { text, severity };
  }
  function isStale(data, id, now = Date.now()) {
    if (!available(data) || data?.ok === false || invalidToken(data) && !usableLocalQuota(data, id)) return false;
    const stamp = timestamp(data);
    return Boolean(data?.stale || expired(bottleneck(data, id)?.windowUsage, now) || stamp != null && now - stamp > 86400000);
  }
  function staleSummary(snapshots, compact = false, now = Date.now()) {
    const ids = providers(snapshots).filter(id => isStale(snapshots[id], id, now));
    const stamps = ids.map(id => timestamp(snapshots[id])).filter(n => n != null);
    const hours = stamps.length ? Math.max(0, Math.floor((now - Math.min(...stamps)) / 3600000)) : null;
    const key = hours == null ? 'quota.stale' : hours === 0 ? compact ? 'quota.staleRecentShort' : 'quota.staleRecent' : compact ? 'quota.staleShort' : 'quota.staleAge';
    return { stale: ids.length > 0, hours, text: !ids.length ? '' : pomeLocaleRendererAiUsageDomain.t(key, { hours }) };
  }
  function status(data, id, now = Date.now()) {
    if (!available(data)) return 'undetected';
    if (data?.ok === false || invalidToken(data) && !usableLocalQuota(data, id)) return 'error';
    const rem = urgencyRemaining(data, id);
    if (rem != null && rem <= 20) return rem === 0 ? 'depleted' : level(rem);
    return isStale(data, id, now) ? 'stale' : 'ok';
  }
  function usableLocalQuota(data, id) {
    // Manual token may be stale while a local CLI/app session still has quota.
    return data?.ok === true
      && ['local', 'file', 'keychain', 'gh', 'hosts.yml'].includes(data.authSource)
      && quotaRows(data, id).some(row =>
        percent(row.windowUsage?.percent) != null || Number.isFinite(row.windowUsage?.balance) || row.windowUsage?.unlimited === true);
  }
  function dashboard(snapshots, size = 'small', now = Date.now()) {
    const ids = providers(snapshots);
    if (['mini', 'small'].includes(size)) {
      const rank = { error: 0, depleted: 1, critical: 2, warn: 3, stale: 4, ok: 5, undetected: 6 };
      const meta = Object.fromEntries(ids.map((id) => [id, {
        rank: rank[status(snapshots[id], id, now)] ?? 9,
        rem: urgencyRemaining(snapshots[id], id) ?? Infinity,
      }]));
      ids.sort((a, b) => meta[a].rank - meta[b].rank || meta[a].rem - meta[b].rem);
    }
    const limit = size === 'mini' ? ids.length <= 4 ? 4 : 3 : size === 'small' ? 4 : ids.length;
    const shown = ids.slice(0, limit), hidden = ids.slice(limit);
    const columns = size === 'mini' ? shown.length + (hidden.length ? 1 : 0)
      : size === 'small' ? Math.min(2, ids.length)
      : ids.length <= 4 ? ids.length : 3;
    const summary = false;
    return { ids, shown, hidden, columns: Math.max(1, columns), summary,
      rows: Math.ceil((shown.length + Number(summary)) / Math.max(1, columns)),
      ringSize: size === 'mini' ? 30 : size === 'small' ? 38
        : size === 'medium' ? ids.length <= 3 ? 72 : ids.length === 4 ? 60 : 32
          : ids.length <= 3 ? 140 : ids.length === 4 ? 120 : 80 };
  }
  function inlineRows(data, id, size) {
    const rows = quotaRows(data, id);
    if (status(data, id) === 'error') return [];
    if (size === 'large' || size === 'mini') return rows;
    if (rows.length <= 1) return [];
    const primary = displayRow(data, id);
    return rows.filter(row => row.key !== primary?.key);
  }
  function formatPercent(value) { const n = percent(value); return n == null ? '--%' : `${Math.round(n)}%`; }
  function clock(value) {
    if (value == null) return '--:--';
    const ms = toMillis(value);
    if (ms == null) return '--:--';
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString(pomeLocaleRendererAiUsageDomain.getState().formatLocale, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function expired(window, now = Date.now()) {
    const resetMs = toMillis(window?.resetsAt);
    return resetMs != null && resetMs <= now;
  }
  function resetText(window, now = Date.now()) {
    if (window?.resetsAt == null) return pomeLocaleRendererAiUsageDomain.t("copy.resetTimeUnknown.2446e1");
    const resetMs = toMillis(window.resetsAt);
    if (resetMs == null) return pomeLocaleRendererAiUsageDomain.t("copy.resetTimeUnknown.2446e1");
    const reset = new Date(resetMs);
    if (Number.isNaN(reset.getTime())) return pomeLocaleRendererAiUsageDomain.t("copy.resetTimeUnknown.2446e1");
    const today = new Date(now);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const prefix = sameDay(reset, today) ? '' : sameDay(reset, tomorrow) ? pomeLocaleRendererAiUsageDomain.t("copy.tomorrow.1e5e5b") : `${reset.getMonth() + 1}/${reset.getDate()} `;
    const time = `${prefix}${clock(window.resetsAt)}`;
    return expired(window, now) ? pomeLocaleRendererAiUsageDomain.t("copy.resetAtHasPassedRefreshNeeded.84cb42", { arg1: (time) }) : pomeLocaleRendererAiUsageDomain.t("copy.resets.b9a32b", { arg1: (time) });
  }
  function windowLabel(window, fallback = pomeLocaleRendererAiUsageDomain.t("copy.quota.32ce9f")) {
    if (window?.period === 'month') return pomeLocaleRendererAiUsageDomain.t('quota.monthly');
    const minutes = percent(window?.windowMinutes);
    if (!(minutes > 0)) return fallback;
    if (minutes === 10080) return pomeLocaleRendererAiUsageDomain.t("copy.weeklyQuota.475811");
    if (minutes === 1440) return pomeLocaleRendererAiUsageDomain.t("copy.dailyQuota.ddea71");
    if (minutes % 1440 === 0) return pomeLocaleRendererAiUsageDomain.t("copy.dayQuota.9c5206", { arg1: (minutes / 1440) });
    if (minutes % 60 === 0) return pomeLocaleRendererAiUsageDomain.t("copy.hourQuota.d2ffb3", { arg1: (minutes / 60) });
    return pomeLocaleRendererAiUsageDomain.t("copy.minuteQuota.321677", { arg1: (minutes) });
  }
  function windowShortLabel(window, fallback = '') {
    if (window?.period === 'month') return pomeLocaleRendererAiUsageDomain.t('quota.month');
    const minutes = percent(window?.windowMinutes);
    if (minutes === 10080) return pomeLocaleRendererAiUsageDomain.t('quota.week');
    if (minutes === 1440) return pomeLocaleRendererAiUsageDomain.t('quota.day');
    if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
    return minutes > 0 ? `${minutes}m` : fallback;
  }
  function isCadenceLabel(label, window) {
    const text = String(label).trim().toLowerCase().replace(/(?:quota|额度)$/u, '').trim();
    const minutes = percent(window?.windowMinutes);
    if (minutes === 10080 && /^(?:每?周|week(?:ly)?|7\s*天|seven[_ -]day)$/.test(text)) return true;
    if (minutes === 1440 && /^(?:每?日|daily|day)$/.test(text)) return true;
    if (window?.period === 'month' && /^(?:每?月|month(?:ly)?)$/.test(text)) return true;
    const units = text.replaceAll('-', ' ').match(/^(\d+(?:\.\d+)?)\s*(h|hours?|小时|d|days?|天|m|mins?|minutes?|分钟)$/);
    return Boolean(units && Number(units[1]) * (/^(?:h|hour|小时)/.test(units[2]) ? 60 : /^(?:d|day|天)/.test(units[2]) ? 1440 : 1) === minutes);
  }
  // One vocabulary supplies full names, compact labels and scope captions. Raw
  // model/pool identities stay intact; only redundant cadence aliases are removed.
  function rowLabels(row, id) {
    const t = (key, args) => pomeLocaleRendererAiUsageDomain.t(key, args);
    const w = row.windowUsage;
    if (w?.currency || w?.unit === 'credits') {
      const name = t(w.currency ? 'providers.prepaidBalance' : 'providers.availableCredits');
      return { ...row, name, short:name, scopeShort:'', periodLabel:'' };
    }
    const scope = id === 'cursor' ? { period:'month' } : id === 'grokbot' ? { windowMinutes:10080 } : w;
    const periodLabel = windowLabel(scope, ''), scopeShort = windowShortLabel(scope);
    if (id === 'cursor') return { ...row, name:`${row.name} · ${periodLabel}`, short:row.name, compactShort:({auto:'Cur',other:'Oth'})[row.key] || row.name, periodLabel, scopeShort };
    if (id === 'grokbot') return { ...row, name:periodLabel, short:scopeShort, periodLabel, scopeShort };
    const categories = { premium:'quota.pool.premium', chat:'quota.pool.chat', completions:'quota.pool.completions' };
    const raw = id === 'copilot' && categories[row.key] ? t(categories[row.key])
      : w?.labelIsFallback ? t('status.OtherQuota.1e9c5f') : String(w?.label || '').trim();
    let identity = raw.split('·').map(part => part.trim()).filter(part => part && !isCadenceLabel(part, scope)).join(' · ');
    const numbered = identity.match(/^quota\s+(\d+)$/i);
    if (numbered) identity = `${t('copy.quota.32ce9f')} ${numbered[1]}`;
    const quotaWord = /额度$|quota$|^(?:额度|quota) \d+$/i.test(identity);
    const name = identity ? periodLabel ? `${identity} · ${periodLabel}` : quotaWord ? identity : t('quota.named', { name:identity })
      : periodLabel || row.name || t('copy.quota.32ce9f');
    return { ...row, name, short:identity || scopeShort || name, periodLabel, scopeShort };
  }
  function quotaRows(data, id) {
    const provider = registry.get(id);
    if (provider?.pools) return provider.pools.map(([key, pool, name]) => {
      let windowUsage = data?.[pool];
      if (id === 'cursor' && windowUsage) {
        const raw = data?.billing?.cycleEnd;
        const end = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? null : toMillis(raw);
        const start = toMillis(data?.billing?.cycleStart);
        windowUsage = { ...windowUsage, resetsAt: windowUsage.resetsAt ?? end,
          windowMinutes: windowUsage.windowMinutes ?? (start != null && end > start ? (end - start) / 60000 : null) };
      }
      return rowLabels({ key, name, windowUsage }, id);
    });
    if (Array.isArray(data?.windows) && data.windows.length) return data.windows.map((window, index) => ({
      key: window.id || `window-${index}`, name:pomeLocaleRendererAiUsageDomain.t('copy.quota.32ce9f'), windowUsage: window,
    })).map(row => rowLabels(row, id));
    return ['primary', 'secondary'].filter(key => data?.[key]).map(key => ({ key,
      name: windowLabel(data[key], key === 'primary' ? pomeLocaleRendererAiUsageDomain.t("copy.primaryQuota.b2a098") : pomeLocaleRendererAiUsageDomain.t("copy.secondaryQuota.0a9d1a")), windowUsage: data[key] })).map(row => rowLabels(row, id));
  }
  function refreshDelay(snapshots, visible, now = Date.now()) {
    const normal = visible ? 5 * 60000 : 15 * 60000;
    if (!visible) return normal;
    const resets = registry.usageProviders().flatMap(({ id }) => quotaRows(snapshots[id], id))
      .map(row => toMillis(row.windowUsage?.resetsAt)).filter(time => Number.isFinite(time) && time > now);
    return Math.max(1000, Math.min(normal, ...resets.map(time => time - now + 1000)));
  }
  function planLabel(plan) { return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : ''; }
  // Background polls skip providers that stayed absent after at least one successful probe.
  function shouldRefresh(data, { force = false, visible = true } = {}) {
    if (force || visible || data == null) return true;
    return available(data) || Boolean(data.configured || data.manualTokenConfigured || data.ok === false);
  }
  return { windowShortLabel, bottleneck, bottleneckInfo, miniSummary, recoveryTime, isStale, staleSummary, registry, windowLabel, quotaRows, inlineRows, refreshDelay, FALLBACK, available, providers, title, remaining, displayRow, displayRemaining, urgencyRemaining, level, percent, formatPercent, clock, expired, resetText, planLabel, asSnapshots, invalidToken, cursorLoginBlocked, timestamp, toMillis, status, dashboard, shouldRefresh };
});
