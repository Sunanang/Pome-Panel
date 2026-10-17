import messages from "./translations.json";

export type SiteLocale = "zh-CN" | "en-US";
const resources = messages as Record<SiteLocale, Record<string, string>>;
export function siteT(locale: SiteLocale, key: string, params: Record<string, unknown> = {}) {
  const text = resources[locale]?.[key] ?? resources["en-US"][key] ?? "";
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => String(params[name] ?? "—"));
}
