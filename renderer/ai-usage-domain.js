(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./ai-provider-registry') : root.NotchAiProviders);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchAiUsageDomain = api;
})(typeof window === 'object' ? window : globalThis, function (registry) {
  'use strict';
  const TAB_KEY = 'notch-ai-usage-tab-v1';
  const FALLBACK = {
    title: '还没有连接 AI 工具',
    body: '在本机登录 Cursor，或用过一次 Codex，额度会自动出现在这里；也可以在设置里手动填写 Token。',
    miniTitle: '未连接 AI 工具', miniBody: 'Cursor、Codex 都未检测到',
  };
  function available(data) {
    if (!data) return false;
    if ('detected' in data || 'configured' in data) return Boolean(data.detected || data.configured || data.manualTokenConfigured);
    return Boolean(data.manualTokenConfigured || data.ok && (data.updatedAt || data.authSource));
  }
  function providers(cursor, codex) {
    return registry.providers.map(provider => provider.id).filter((id) => available(id === 'cursor' ? cursor : codex));
  }
  function title(ids) { return ids.length === 1 ? `${registry.get(ids[0])?.label || ids[0]} 剩余额度` : 'AI 剩余额度'; }
  function percent(value) {
    if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
    const n = Number(value); return Number.isFinite(n) ? n : null;
  }
  // Keep raw used percentages in provider data; convert only for presentation.
  function remaining(used) { const n = percent(used); return n == null ? null : Math.min(100, Math.max(0, 100 - n)); }
  function lowestRemaining(data, id) {
    if (data?.ok === false) return null;
    const values = quotaRows(data, id).map(row => row.windowUsage)
      .map((window) => remaining(window?.percent)).filter((value) => value != null);
    return values.length ? Math.min(...values) : null;
  }
  function chooseTab(saved, ids, cursor, codex) {
    if (ids.includes(saved)) return saved;
    if (ids.length === 1) return ids[0];
    if (!ids.length) return null;
    return (lowestRemaining(codex, 'codex') ?? 100) < (lowestRemaining(cursor, 'cursor') ?? 100) ? 'codex' : 'cursor';
  }
  // Thresholds use the unrounded remainder so warning behavior stays equivalent.
  function level(value) { const n = percent(value); return n == null ? 'ok' : n <= 5 ? 'critical' : n <= 20 ? 'warn' : 'ok'; }
  function formatPercent(value) { const n = percent(value); return n == null ? '--%' : `${Math.round(n)}%`; }
  function clock(value) {
    if (value == null) return '--:--';
    const d = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function expired(window, now = Date.now()) { return window?.resetsAt != null && window.resetsAt * 1000 <= now; }
  function resetText(window, now = Date.now()) {
    if (window?.resetsAt == null) return '重置时间未知';
    const reset = new Date(window.resetsAt * 1000);
    if (Number.isNaN(reset.getTime())) return '重置时间未知';
    const today = new Date(now);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const prefix = sameDay(reset, today) ? '' : sameDay(reset, tomorrow) ? '明天 ' : `${reset.getMonth() + 1}/${reset.getDate()} `;
    const time = `${prefix}${clock(window.resetsAt)}`;
    return expired(window, now) ? `已过 ${time} 重置 · 待刷新` : `${time} 重置`;
  }
  function windowLabel(window, fallback = '额度') {
    const minutes = percent(window?.windowMinutes);
    if (!(minutes > 0)) return fallback;
    if (minutes === 10080) return '每周额度';
    if (minutes === 1440) return '每日额度';
    if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`;
    if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
    return `${minutes} 分钟额度`;
  }
  function quotaRows(data, id) {
    const provider = registry.get(id);
    if (provider?.pools) return provider.pools.map(([key, pool, name]) => ({ key, name, windowUsage: data?.[pool] }));
    if (Array.isArray(data?.windows) && data.windows.length) return data.windows.map((window, index) => ({
      key: window.id || `window-${index}`, name: [window.label, windowLabel(window)].filter(Boolean).join(' · '), windowUsage: window,
    }));
    return ['primary', 'secondary'].filter(key => data?.[key]).map(key => ({ key,
      name: windowLabel(data[key], key === 'primary' ? '主要额度' : '次要额度'), windowUsage: data[key] }));
  }
  // Poll active views normally and once just after a known reset. An unchanged,
  // expired snapshot must not produce a tight retry loop.
  function refreshDelay(snapshots, visible, now = Date.now()) {
    const normal = visible ? 5 * 60000 : 15 * 60000;
    if (!visible) return normal;
    const resets = registry.providers.flatMap(({ id }) => quotaRows(snapshots[id], id))
      .map(row => row.windowUsage?.resetsAt * 1000).filter(time => Number.isFinite(time) && time > now);
    return Math.max(1000, Math.min(normal, ...resets.map(time => time - now + 1000)));
  }
  function planLabel(plan) { return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : ''; }
  return { registry, windowLabel, quotaRows, refreshDelay, TAB_KEY, FALLBACK, available, providers, title, remaining, lowestRemaining, chooseTab, level, percent, formatPercent, clock, expired, resetText, planLabel };
});
