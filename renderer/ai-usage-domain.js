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
    const minutes = percent(row.windowUsage?.windowMinutes);
    const name = id === 'cursor' ? row.name : minutes === 10080 ? pomeLocaleRendererAiUsageDomain.t('quota.week')
      : minutes === 1440 ? pomeLocaleRendererAiUsageDomain.t('quota.day')
      : row.windowUsage?.label && !row.windowUsage.labelIsFallback ? row.windowUsage.label
      : minutes > 0 && minutes % 60 === 0 ? `${minutes / 60}h` : row.name;
    return { ...row, name, level: row.remaining === 0 ? 'depleted' : level(row.remaining),
      badge: row.key !== display?.key && row.remaining <= 20 && !sameCycle,
      resetAt: typeof row.windowUsage?.resetsAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.windowUsage.resetsAt) ? null : toMillis(row.windowUsage?.resetsAt) };
  }
  function recoveryTime(value, now = Date.now()) {
    const ms = toMillis(value);
    if (ms == null) return '';
    const d = new Date(ms), today = new Date(now);
    const sameDay = d.toDateString() === today.toDateString();
    const day = sameDay ? '' : d.toLocaleDateString(pomeLocaleRendererAiUsageDomain.getState().formatLocale, { weekday: 'short' });
    return `${day}${clock(ms)}`;
  }
  function miniSummary(snapshots, now = Date.now()) {
    const ids = dashboard(snapshots, 'mini', now).ids;
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
      if (depleted.length > 1 || depleted.length === ids.length) text = t(depleted.length === ids.length ? 'quota.allDepleted' : 'quota.manyDepleted', { count: depleted.length }) + (time ? t('quota.earliest', { time }) : '');
      else if (critical.length) text = t('quota.depletedAndCritical', { source: label(depleted[0]), count: critical.length });
      else { const b = bottleneckInfo(snapshots[depleted[0]], depleted[0]); text = t('quota.oneDepleted', { source: label(depleted[0]), window: b.name }) + (time ? t('quota.recovers', { time }) : ''); }
    } else if (critical.length > 1) { severity = 'critical'; text = t('quota.manyCritical', { count: critical.length, source: label(critical[0]), value: Math.round(urgencyRemaining(snapshots[critical[0]], critical[0])) }); }
    else if (valid.length) {
      const id = valid[0], b = bottleneckInfo(snapshots[id], id);
      if (b) { severity = b.level; text = t('quota.lowestWindow', { source: label(id), window: b.name, value: Math.round(b.remaining) }) + (b.resetAt != null ? ` · ${recoveryTime(b.resetAt, now)}` : ''); }
    }
    return { text, severity };
  }
  function status(data, id, now = Date.now()) {
    if (!available(data)) return 'undetected';
    if (invalidToken(data) || data?.ok === false) return 'error';
    const stamp = timestamp(data);
    if (data?.stale || expired(bottleneck(data, id)?.windowUsage, now)
      || stamp != null && now - stamp > 86400000) return 'stale';
    const rem = urgencyRemaining(data, id);
    return rem === 0 ? 'depleted' : rem == null ? 'ok' : level(rem);
  }
  function dashboard(snapshots, size = 'small', now = Date.now()) {
    const ids = providers(snapshots);
    if (['mini', 'small'].includes(size)) {
      const rank = { depleted: 0, critical: 1, warn: 2, error: 3, ok: 4, stale: 5, undetected: 6 };
      const meta = Object.fromEntries(ids.map((id) => [id, {
        rank: rank[status(snapshots[id], id, now)] ?? 9,
        rem: urgencyRemaining(snapshots[id], id) ?? Infinity,
      }]));
      ids.sort((a, b) => meta[a].rank - meta[b].rank || meta[a].rem - meta[b].rem);
    }
    const limit = size === 'mini' ? ids.length <= 4 ? 4 : 3 : size === 'small' ? 3 : ids.length;
    const shown = ids.slice(0, limit), hidden = ids.slice(limit);
    const columns = size === 'mini' ? shown.length + (hidden.length ? 1 : 0)
      : size === 'small' && ids.length <= 2 ? ids.length
      : size === 'medium' ? Math.min(3, ids.length) : size === 'large' && ids.length >= 7 ? 3 : size === 'large' && ids.length >= 5 ? 2 : 1;
    const summary = size === 'large' && ids.length === 5;
    return { ids, shown, hidden, columns: Math.max(1, columns), summary,
      rows: Math.ceil((shown.length + Number(summary)) / Math.max(1, columns)),
      ringSize: size === 'mini' ? 32 : size === 'small' ? ids.length <= 2 ? 46 : 36
        : size === 'medium' ? ids.length <= 2 ? 64 : ids.length === 3 ? 52 : ids.length > 6 ? 22 : 28
          : ids.length <= 2 ? 84 : ids.length === 3 ? 66 : 50 };
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
    const minutes = percent(window?.windowMinutes);
    if (!(minutes > 0)) return fallback;
    if (minutes === 10080) return pomeLocaleRendererAiUsageDomain.t("copy.weeklyQuota.475811");
    if (minutes === 1440) return pomeLocaleRendererAiUsageDomain.t("copy.dailyQuota.ddea71");
    if (minutes % 1440 === 0) return pomeLocaleRendererAiUsageDomain.t("copy.dayQuota.9c5206", { arg1: (minutes / 1440) });
    if (minutes % 60 === 0) return pomeLocaleRendererAiUsageDomain.t("copy.hourQuota.d2ffb3", { arg1: (minutes / 60) });
    return pomeLocaleRendererAiUsageDomain.t("copy.minuteQuota.321677", { arg1: (minutes) });
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
      return { key, name, windowUsage };
    });
    if (Array.isArray(data?.windows) && data.windows.length) return data.windows.map((window, index) => ({
      key: window.id || `window-${index}`, name: [window.labelIsFallback ? pomeLocaleRendererAiUsageDomain.t("status.OtherQuota.1e9c5f") : window.label, windowLabel(window)].filter(Boolean).join(' · '), windowUsage: window,
    }));
    return ['primary', 'secondary'].filter(key => data?.[key]).map(key => ({ key,
      name: windowLabel(data[key], key === 'primary' ? pomeLocaleRendererAiUsageDomain.t("copy.primaryQuota.b2a098") : pomeLocaleRendererAiUsageDomain.t("copy.secondaryQuota.0a9d1a")), windowUsage: data[key] }));
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
  return { bottleneck, bottleneckInfo, miniSummary, recoveryTime, registry, windowLabel, quotaRows, refreshDelay, FALLBACK, available, providers, title, remaining, displayRow, displayRemaining, urgencyRemaining, level, percent, formatPercent, clock, expired, resetText, planLabel, asSnapshots, invalidToken, timestamp, toMillis, status, dashboard, shouldRefresh };
});
