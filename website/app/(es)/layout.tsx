import { SiteRootLayout, siteMetadata, viewport } from "../SiteLayout";
export { viewport };
export const metadata = siteMetadata("es-ES");
export default function Layout({ children }: { children: React.ReactNode }) { return <SiteRootLayout locale="es-ES">{children}</SiteRootLayout>; }
