"use client";
import { useSiteLocale } from "./SiteLocale";
import { siteT } from "./siteI18n";


import { motion, useReducedMotion } from "framer-motion";

export default function ProductStory() {
  const locale = useSiteLocale();
  const reducedMotion = useReducedMotion();
  return (
    <section className="story-section" data-section="story" id="about">
      <span className="story-object story-object-moon" aria-hidden="true" />
      <span className="story-object story-object-loop" aria-hidden="true" />
      <motion.div className="story-copy" initial={reducedMotion ? false : { opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.45 }} transition={{ duration: 0.8 }}>
        <span className="section-kicker">WHY POME PANEL</span>
        <h2>ONE PLACE</h2>
        <p>{siteT(locale, "copy.keepTasksNotesLinksRecordingsAndLocal.705381")}</p>
      </motion.div>
    </section>
  );
}

