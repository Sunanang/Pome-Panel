import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("pt-BR");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="pt-BR">{children}</SiteRootLayout>; }
