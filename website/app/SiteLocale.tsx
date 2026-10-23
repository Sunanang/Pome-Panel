"use client";

import { createContext, useContext, type ReactNode } from "react";
import { siteLanguages, siteT, type SiteLocale } from "./siteI18n";
import { assetPath } from "./assetPath.mjs";

const LocaleContext = createContext<SiteLocale>("zh-CN");
export const useSiteLocale = () => useContext(LocaleContext);
export function SiteLocaleProvider({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function SiteLanguageMenu() {
  const locale = useSiteLocale();
  const name = siteLanguages.find(row => row.id === locale)?.name;
  return <details className="site-language">
      <summary aria-label={siteT(locale, "settings.language")} title={name}>{name}</summary>
      <nav aria-label={siteT(locale, "settings.language")}>
        {siteLanguages.map(row => <a key={row.id} href={assetPath(row.route)} lang={row.id} hrefLang={row.id} aria-current={locale === row.id ? "page" : undefined}>{row.name}</a>)}
      </nav>
    </details>;
}
