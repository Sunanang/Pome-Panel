import { siteT, siteLanguages, siteRoute, type SiteLocale } from "./siteI18n";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { assetPath } from "./assetPath.mjs";

export function siteMetadata(locale: SiteLocale): Metadata {
const title = siteT(locale, "copy.pomePanelADesktopWorkspaceForMac.6be5f6");
const description = siteT(locale, "copy.aLocalWorkspaceForMacosAndWindows.0d2324");
const shareImage = assetPath(!locale.startsWith("zh-") ? "/product-captures/en/home.jpg" : "/product-captures/home.jpg");

const metadata: Metadata = {
  metadataBase: new URL("https://Sunanang.github.io/"),
  title,
  description,
  alternates: {
    canonical: assetPath(siteRoute(locale)),
    languages: Object.fromEntries(siteLanguages.map(row => [row.id, assetPath(row.route)])),
  },
  applicationName: "Pome Panel",
  keywords: ["Pome Panel", "macOS", "Windows", "Local workspace", "Tasks", "Apple Silicon"],
  icons: { icon: [{ url: assetPath("/favicon.png"), type: "image/png" }], shortcut: assetPath("/favicon.png"), apple: assetPath("/favicon.png") },
  openGraph: {
    type: "website",
    locale: locale.replace("-", "_"),
    siteName: "Pome Panel",
    title,
    description,
    images: [{ url: shareImage, alt: siteT(locale, "copy.pomePanelWebsiteShareImage.d7ee22") }],
  },
  twitter: { card: "summary_large_image", title, description, images: [shareImage] },
};

return metadata;
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "dark", themeColor: "#000000" };

export function SiteRootLayout({ children, locale }: Readonly<{ children: React.ReactNode; locale: SiteLocale }>) {
  return <html lang={locale}><body>{children}</body></html>;
}
