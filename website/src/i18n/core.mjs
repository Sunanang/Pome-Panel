export const LANGUAGE_KEY = 'pome-site-language-v1';

export function readmeFilename(locale) {
  if (locale === 'zh-CN') return 'README.md';
  if (locale === 'zh-TW') return 'README.zh-TW.md';
  if (locale === 'pt-BR') return 'README.pt-BR.md';
  return `README.${locale.split('-')[0]}.md`;
}

export function normalizePreference(value, catalog) {
  return value === 'system' || catalog.some(row => row.id === value) ? value : 'system';
}

// Same language matching policy as the desktop application's localization/runtime.js.
export function resolveLocale(preference, preferredLanguages, catalog) {
  if (normalizePreference(preference, catalog) !== 'system') return preference;
  for (const input of preferredLanguages || []) {
    const lang = String(input || '').replace(/_/g, '-').toLowerCase();
    if (/^zh-(?:tw|hk|mo)(?:-|$)/.test(lang) || lang.startsWith('zh-hant')) return 'zh-TW';
    if (lang === 'zh' || lang === 'zh-cn' || lang.startsWith('zh-hans')) return 'zh-CN';
    const base = lang.split('-')[0];
    const match = catalog.find(row => row.id.split('-')[0] === base);
    if (match) return match.id;
  }
  return 'en-US';
}

export function interpolate(value, parameters = {}) {
  return String(value).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : token);
}
