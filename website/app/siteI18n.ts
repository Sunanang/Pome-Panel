import messages from "./translations.json";
import catalog from "./languages.json";

export type SiteLocale = keyof typeof messages;
export const siteLanguages = catalog as { id: SiteLocale; name: string; route: string }[];
export const siteRoute = (locale: SiteLocale) => siteLanguages.find(row => row.id === locale)?.route || "/";
const resources = messages as Record<SiteLocale, Record<string, string>>;
export function siteT(locale: SiteLocale, key: string, params: Record<string, unknown> = {}) {
  const text = resources[locale]?.[key] ?? resources["en-US"][key] ?? "";
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => String(params[name] ?? "—"));
}
