import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("zh-CN");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="zh-CN">{children}</SiteRootLayout>; }
