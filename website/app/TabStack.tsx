"use client";
import { useSiteLocale } from "./SiteLocale";
import { siteT } from "./siteI18n";


import { motion, type MotionValue, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { type CSSProperties, useRef, useState } from "react";
import RealProductMedia from "./RealProductMedia";
import { type TabItem, getLandingContent } from "./landingContent";
import { shouldLoadTabMedia, tabCardVisualState } from "./landingTabs.mjs";

function TabCard({ item, index, progress, reducedMotion, loadMedia }: { item: TabItem; index: number; progress: MotionValue<number>; reducedMotion: boolean; loadMedia: boolean }) {
  const locale = useSiteLocale();
  const { TAB_ITEMS } = getLandingContent(locale);
  const y = useTransform(progress, (value) => `${tabCardVisualState(value, index, 6).yPercent}%`);
  const opacity = useTransform(progress, (value) => tabCardVisualState(value, index, TAB_ITEMS.length).opacity);
  const scale = useTransform(progress, (value) => tabCardVisualState(value, index, TAB_ITEMS.length).scale);
  const layerStyle = { "--stack-index": index + 1 } as CSSProperties;

  return (
    <section className="tab-card-track" data-tab-id={item.id} data-stack-layer={index + 1} style={layerStyle}>
      <motion.article className={`tab-card tab-accent-${item.accent}`} style={reducedMotion ? undefined : { y, scale, opacity }}>
        <header><strong>{String(index + 1).padStart(2, "0")}</strong><div><span>{item.eyebrow}</span><h3>{item.title}</h3><p>{item.description}</p></div></header>
        <RealProductMedia
          src={item.capture}
          fallbackSrc={item.capturePoster}
          posterSrc={item.capturePoster}
          kind={item.captureKind}
          alt={siteT(locale, "website.fullCapture", {arg1: item.title})}
          className="tab-capture"
          fullCapture
          deferred={!loadMedia}
          missingLabel={siteT(locale, "copy.desktopLoopVideoComingSoon.b312de")}
        />
      </motion.article>
    </section>
  );
}

export default function TabStack() {
  const contentLocale = useSiteLocale();
  const { TAB_ITEMS } = getLandingContent(contentLocale);
  const stackRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() === true;
  const { scrollYProgress } = useScroll({ target: stackRef, offset: ["start start", "end end"] });
  const [mediaProgress, setMediaProgress] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", setMediaProgress);

  return (
    <div className={`tab-stack${reducedMotion ? " is-reduced-motion" : ""}`} ref={stackRef}>
      <div className="tab-stack-stage">
        {TAB_ITEMS.map((item, index) => (
          <TabCard
            item={item}
            index={index}
            progress={scrollYProgress}
            reducedMotion={reducedMotion}
            loadMedia={shouldLoadTabMedia(mediaProgress, index, TAB_ITEMS.length, reducedMotion)}
            key={item.id}
          />
        ))}
      </div>
    </div>
  );
}
