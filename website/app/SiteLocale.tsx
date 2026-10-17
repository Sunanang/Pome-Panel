"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteLocale } from "./siteI18n";
import { assetPath } from "./assetPath.mjs";

const LocaleContext = createContext<SiteLocale>("zh-CN");
export const useSiteLocale = () => useContext(LocaleContext);
export function SiteLocaleProvider({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>
    <nav className="site-language" aria-label={locale === "en-US" ? "Language" : "语言"}>
      <a href={assetPath("/")} lang="zh-CN" aria-current={locale === "zh-CN" ? "page" : undefined}>简体中文</a>
      <a href={assetPath("/en/")} lang="en" aria-current={locale === "en-US" ? "page" : undefined}>English</a>
    </nav>
    {children}
  </LocaleContext.Provider>;
}
