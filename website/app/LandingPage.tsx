"use client";
import { SiteLocaleProvider } from "./SiteLocale";
import { siteT, type SiteLocale } from "./siteI18n";
import HeroSection from "./HeroSection";
import OperationMarquee from "./OperationMarquee";
import ProductStory from "./ProductStory";
import CapabilitiesSection from "./CapabilitiesSection";
import TabStack from "./TabStack";
import EndingSection from "./EndingSection";

export default function LandingPage({ locale = "zh-CN" }: { locale?: SiteLocale }) {
  return (
    <SiteLocaleProvider locale={locale}><main className="landing-page">
      <HeroSection />
      <OperationMarquee />
      <ProductStory />
      <CapabilitiesSection />
      <section className="tabs-intro" data-section="tabs-intro" id="tabs"><span className="section-kicker">SIX WORKSPACES</span><h2>EVERY TAB</h2><p>{siteT(locale, "copy.oneTabForEveryEverydayTask.d5b881")}</p></section>
      <section className="tab-stack-section" data-section="tab-stack"><TabStack /></section>
      <EndingSection />
    </main></SiteLocaleProvider>
  );
}
