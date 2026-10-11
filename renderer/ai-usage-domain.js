(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchAiUsageDomain = api;
})(typeof window === 'object' ? window : globalThis, function () {
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
    return ['cursor', 'codex'].filter((id) => available(id === 'cursor' ? cursor : codex));
  }
  function title(ids) { return ids.length === 1 ? `${ids[0] === 'cursor' ? 'Cursor' : 'Codex'} 剩余额度` : 'AI 剩余额度'; }
  function percent(value) {
    if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
    const n = Number(value); return Number.isFinite(n) ? n : null;
  }
  // Keep raw used percentages in provider data; convert only for presentation.
  function remaining(used) { const n = percent(used); return n == null ? null : Math.max(0, 100 - n); }
  function lowestRemaining(data, id) {
    if (data?.ok === false) return null;
    const values = (id === 'cursor' ? [data?.auto, data?.other, data?.grokBot] : [data?.primary, data?.secondary])
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
    return expired(window, now) ? `已过 ${time} 重置 · 实际应更低` : `${time} 重置`;
  }
  function planLabel(plan) { return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : ''; }
  return { TAB_KEY, FALLBACK, available, providers, title, remaining, lowestRemaining, chooseTab, level, percent, formatPercent, clock, expired, resetText, planLabel };
});
