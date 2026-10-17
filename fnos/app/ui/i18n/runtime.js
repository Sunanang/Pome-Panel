(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? { 'zh-CN': require('./locales/zh-CN.json'), 'en-US': require('./locales/en-US.json') } : root.PomeTranslations || {});
  if (node) module.exports = api;
  else root.PomeI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (resources) {
  'use strict';
  const listeners = new Set();
  const formats = new Map();
  const knownMessages = new Map();
  const messagePatterns = [];
  const prefixMessages = [];
  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const locale of ['zh-CN', 'en-US']) for (const [key, entry] of Object.entries(resources[locale] || {})) {
    for (const text of typeof entry === 'string' ? [entry] : Object.values(entry || {})) {
      if (!/\{[A-Za-z]/.test(text)) {
        knownMessages.set(text, { key });
        if (['待同步：', '部分资料未传输：'].includes(resources['zh-CN']?.[key])) prefixMessages.push({ text, key });
      } else {
        const original = resources['zh-CN']?.[key];
        if (typeof original !== 'string' || !/^(?:已登录|上次同步|待同步|部分资料|配置异常|将追加|还原 notify|notify →|打开 |已打开 |未找到 |测试通知失败|接入状态暂时无法读取|已写入配置|操作失败|回退失败|主机：|指纹：|有效期：)/.test(original)) continue;
        const names = [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]);
        const pattern = escapePattern(text).replace(/\\\{([A-Za-z][A-Za-z0-9_]*)\\\}/g, '([\\s\\S]*?)');
        messagePatterns.push({ key, names, expression: new RegExp(`^${pattern}$`) });
      }
    }
  }
  let current = { preference: 'system', effectiveLocale: 'zh-CN', formatLocale: 'zh-CN', revision: 0 };
  function preference(value) { return ['system', 'zh-CN', 'en-US'].includes(value) ? value : 'system'; }
  function resolve(value, languages = []) {
    if (preference(value) !== 'system') return value;
    for (const input of languages) {
      const lang = String(input || '').replace(/_/g, '-').toLowerCase();
      if (lang === 'zh' || lang === 'zh-cn' || lang.startsWith('zh-hans')) return 'zh-CN';
      if (lang === 'en' || lang.startsWith('en-')) return 'en-US';
    }
    return 'en-US';
  }
  function snapshot(value = 'system', languages = [], formatLocale) {
    const effectiveLocale = resolve(value, languages);
    let format = formatLocale || effectiveLocale;
    try {
      // Keep regional conventions while the language of month/day names
      // follows the interface. English UI must not show Chinese date suffixes.
      const region = new Intl.Locale(format).region;
      format = region ? new Intl.Locale(effectiveLocale, { region }).toString() : effectiveLocale;
      new Intl.DateTimeFormat(format);
    } catch { format = effectiveLocale; }
    return { preference: preference(value), effectiveLocale, formatLocale: format };
  }
  function setState(next) {
    if (!next || !['zh-CN', 'en-US'].includes(next.effectiveLocale)) return false;
    if (Number.isInteger(next.revision) && next.revision < current.revision) return false;
    current = { ...current, ...snapshot(next.preference, [next.effectiveLocale], next.formatLocale), effectiveLocale: next.effectiveLocale,
      revision: Number.isInteger(next.revision) ? next.revision : current.revision + 1 };
    formats.clear();
    for (const fn of listeners) fn({ ...current });
    return true;
  }
  function getState() { return { ...current }; }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function formatter(kind, options = {}, locale = current.formatLocale) {
    const key = JSON.stringify([kind, locale, options]);
    if (!formats.has(key)) formats.set(key, new Intl[kind](locale, options));
    return formats.get(key);
  }
  function t(key, params = {}, locale = current.effectiveLocale) {
    let value = resources[locale]?.[key] ?? resources['en-US']?.[key];
    if (value && typeof value === 'object') {
      const count = Number(params.count ?? params.arg1 ?? 0);
      value = value[formatter('PluralRules', {}, locale).select(count)] ?? value.other;
    }
    if (typeof value !== 'string') return locale === 'zh-CN' ? '暂时无法显示，请重试。' : 'Unable to display this message. Try again.';
    return value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name) => Object.hasOwn(params, name) ? String(params[name] ?? '') : '—');
  }
  function date(value, options = {}) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : formatter('DateTimeFormat', options).format(parsed);
  }
  function number(value, options = {}) { return Number.isFinite(Number(value)) ? formatter('NumberFormat', options).format(Number(value)) : '—'; }
  function relativeTime(value, now = Date.now()) {
    const minutes = Math.floor(Math.max(0, now - Number(value)) / 60000);
    return t(minutes < 1 || !Number.isFinite(minutes) ? 'time.justNow' : 'time.minutesAgo', { count: minutes });
  }
  function transcriptionLanguage(value) { return value === 'en' ? 'en' : 'zh'; }
  // For known system messages and old system-state files only. Never apply to
  // task summaries, note content, project names or other user-authored text.
  function describeMessage(value) {
    if (knownMessages.has(value)) return { ...knownMessages.get(value), params: {} };
    for (const { text, key } of prefixMessages) if (String(value).startsWith(text)) return { key, params: {}, suffix: String(value).slice(text.length) };
    for (const { key, names, expression } of messagePatterns) {
      const match = expression.exec(String(value));
      if (match) return { key, params: Object.fromEntries(names.map((name, index) => [name, match[index + 1]])) };
    }
    return null;
  }
  function systemText(value) {
    const descriptor = typeof value === 'object' && value?.key ? value : describeMessage(value);
    return descriptor ? t(descriptor.key, descriptor.params) + (descriptor.suffix || '') : String(value ?? '');
  }
  function attribute(key, params = {}) {
    const sentinels = Object.fromEntries(Object.keys(params).map((name, index) => [name, `POMEARG${index}END`]));
    let value = t(key, sentinels).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    for (const [name, sentinel] of Object.entries(sentinels)) value = value.replaceAll(sentinel, String(params[name] ?? ''));
    return value;
  }
  function noteTitle(note) {
    const title = String(note?.title || '');
    const conflict = note?.conflict;
    // Only an explicitly generated suffix can change. Actual titles and hashes stay stored verbatim.
    if (!conflict?.originalTitle || !title.startsWith(`${conflict.originalTitle}（冲突副本 · `)) return title;
    return t('notes.conflictTitle', { title: conflict.originalTitle, device: conflict.deviceName || '—',
      time: Number(conflict.createdAt) > 0 ? date(conflict.createdAt, { hour12: false }) : '—' });
  }
  function bind(node, property, read) { return node ? (node[property] = read()) : ''; }
  return { preference, resolve, snapshot, setState, getState, onChange, t, attribute, date, number, relativeTime, formatter, transcriptionLanguage, describeMessage, systemText, noteTitle, bind };
});
