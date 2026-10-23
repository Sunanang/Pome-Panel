import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("de-DE");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="de-DE">{children}</SiteRootLayout>; }
