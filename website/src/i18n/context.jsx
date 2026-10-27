import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import languages from './languages.json';
import { LANGUAGE_KEY, normalizePreference, resolveLocale, interpolate } from './core.mjs';

const resources = Object.fromEntries(Object.entries(import.meta.glob('./locales/*.json', { eager:true, import:'default' }))
  .map(([path, messages]) => [path.split('/').at(-1).replace('.json',''), messages]));
const LanguageContext = createContext(null);
const browserLanguages = () => navigator.languages?.length ? [...navigator.languages] : [navigator.language];

export function LanguageProvider({ children }) {
  const [preference,setPreference] = useState(() => {
    try { return normalizePreference(localStorage.getItem(LANGUAGE_KEY), languages); }
    catch { return 'system'; }
  });
  const [preferred,setPreferred] = useState(browserLanguages);
  const locale = resolveLocale(preference, preferred, languages);
  const t = useCallback((key, parameters) => interpolate(resources[locale]?.[key] ?? resources['en-US']?.[key] ?? key, parameters), [locale]);
  const selectPreference = useCallback(value => {
    const next = normalizePreference(value, languages);
    if (next === preference) return;
    setPreference(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Use the selection for this tab when storage is unavailable. */ }
  }, [preference]);
  useEffect(() => {
    const updateBrowser = () => setPreferred(browserLanguages());
    const updateStored = event => {
      if (event.key === LANGUAGE_KEY || event.key === null) setPreference(normalizePreference(event.newValue, languages));
    };
    addEventListener('languagechange', updateBrowser);addEventListener('storage', updateStored);
    return () => {removeEventListener('languagechange', updateBrowser);removeEventListener('storage', updateStored);};
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.script = /^(zh|ja|ko)-/.test(locale) ? 'cjk' : 'latin';
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  }, [locale,t]);
  const value = useMemo(() => ({locale,preference,languages,t,selectPreference}), [locale,preference,t,selectPreference]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }
