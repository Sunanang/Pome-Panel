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
  function lowestRemaining(data, id) {
    if (data?.ok === false) return null;
    const values = quotaRows(data, id).map(row => row.windowUsage)
      .filter(window => !window?.unlimited && !window?.currency && window?.unit !== 'credits')
      .map((window) => remaining(window?.percent)).filter((value) => value != null);
    return values.length ? Math.min(...values) : null;
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
  // Lowest percent remaining, or 0 when a balance/credits window is empty — for urgency only.
  function urgencyRemaining(data, id) {
    const rem = lowestRemaining(data, id);
    if (rem != null) return rem;
    const balances = quotaRows(data, id).map(row => row.windowUsage)
      .filter(window => window && (window.currency || window.unit === 'credits') && Number.isFinite(window.balance))
      .map(window => window.balance);
    if (!balances.length) return null;
    return Math.min(...balances) <= 0 ? 0 : null;
  }
  function status(data, id, now = Date.now()) {
    if (!available(data)) return 'undetected';
    if (invalidToken(data) || data?.ok === false) return 'error';
    const stamp = timestamp(data);
    if (data?.stale || quotaRows(data, id).some(row => expired(row.windowUsage, now))
      || stamp != null && now - stamp > 86400000) return 'stale';
    const rem = urgencyRemaining(data, id);
    return rem == null ? 'ok' : level(rem);
  }
  function dashboard(snapshots, size = 'small', now = Date.now()) {
    const ids = providers(snapshots);
    if (['mini', 'small'].includes(size)) {
      const rank = { critical: 0, warn: 1, error: 2, ok: 3, stale: 4, undetected: 5 };
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
      : size === 'medium' ? Math.min(3, ids.length) : size === 'large' && ids.length >= 7 ? 3 : size === 'large' && ids.length >= 4 ? 2 : 1;
    const summary = size === 'large' && ids.length === 5;
    return { ids, shown, hidden, columns: Math.max(1, columns), summary,
      rows: Math.ceil((shown.length + Number(summary)) / Math.max(1, columns)),
      ringSize: size === 'mini' ? 32 : size === 'small' ? ids.length <= 2 ? 46 : 36
        : size === 'medium' ? ids.length <= 2 ? 64 : ids.length === 3 ? 52 : ids.length > 6 ? 28 : 40
          : ids.length <= 2 ? 84 : ids.length === 3 ? 66 : 50 };
  }
  function formatPercent(value) { const n = percent(value); return n == null ? '--%' : `${Math.round(n)}%`; }
  function clock(value) {
    if (value == null) return '--:--';
    const ms = toMillis(value);
    if (ms == null) return '--:--';
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString(pomeLocaleRendererAiUsageDomain.getState().formatLocale, { hour: '2-digit', minute: '2-digit' });
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
    if (provider?.pools) return provider.pools.map(([key, pool, name]) => ({ key, name, windowUsage: data?.[pool] }));
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
  return { registry, windowLabel, quotaRows, refreshDelay, FALLBACK, available, providers, title, remaining, lowestRemaining, urgencyRemaining, level, percent, formatPercent, clock, expired, resetText, planLabel, asSnapshots, invalidToken, timestamp, toMillis, status, dashboard, shouldRefresh };
});
