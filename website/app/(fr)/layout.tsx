import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("fr-FR");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="fr-FR">{children}</SiteRootLayout>; }
