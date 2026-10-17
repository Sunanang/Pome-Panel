"use client";
import { useSiteLocale } from "./SiteLocale";
import { siteT } from "./siteI18n";


import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { assetPath } from "./assetPath.mjs";
import Prism from "./reactbits/Prism/Prism";

export default function EndingSection() {
  const locale = useSiteLocale();
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end end"] });
  const wordmarkY = useTransform(scrollYProgress, [0, 0.55, 1], [100, 0, -18]);
  const islandY = useTransform(scrollYProgress, [0, 0.62, 1], [90, 0, -8]);
  const islandScale = useTransform(scrollYProgress, [0, 0.62, 1], [0.45, 1, 1]);

  return (
    <section className="ending-section" data-section="ending" ref={sectionRef}>
      <div className="ending-stage">
        <div
          className="ending-prism"
          data-prism-animation="hover"
          data-prism-noise="0.12"
          data-prism-scale="3"
          aria-hidden="true"
        >
          {reducedMotion !== true && <Prism animationType="hover" noise={0.12} scale={3} />}
        </div>

        <motion.h2
          className="ending-wordmark"
          style={reducedMotion ? undefined : { y: wordmarkY }}
        >
          POME PANEL
        </motion.h2>

        <motion.div
          className="ending-island"
          style={reducedMotion ? undefined : { y: islandY, scale: islandScale }}
        >
          {/* This is the real collapsed-state capture from the running product. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assetPath("/hero/panel-collapsed.png")} alt={siteT(locale, "copy.pomePanelCollapsedView.378ce5")} />
        </motion.div>

        <motion.div className="ending-copy">
          <span>BACK TO FLOW</span>
          <p>{siteT(locale, "copy.expandWhenNeededCollapseWhenDone.e2ded7")}</p>
        </motion.div>

        <footer><span>macOS 13+ · Windows 10/11 x64 · MIT</span><span>© 2026 Pome Panel</span></footer>
      </div>
    </section>
  );
}
