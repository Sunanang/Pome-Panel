import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("ru-RU");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="ru-RU">{children}</SiteRootLayout>; }
