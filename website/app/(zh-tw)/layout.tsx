import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("zh-TW");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="zh-TW">{children}</SiteRootLayout>; }
