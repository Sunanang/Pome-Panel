import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("en-US");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="en-US">{children}</SiteRootLayout>; }
