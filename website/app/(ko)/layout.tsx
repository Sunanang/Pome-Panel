import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("ko-KR");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="ko-KR">{children}</SiteRootLayout>; }
