import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("ja-JP");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="ja-JP">{children}</SiteRootLayout>; }
