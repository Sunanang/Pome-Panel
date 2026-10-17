"use client";
import { useSiteLocale } from "./SiteLocale";
import { siteT } from "./siteI18n";


import { useState } from "react";
import { initialMediaState, nextMediaState } from "./landingMedia.mjs";
import type { MediaKind } from "./landingContent";

type Props = {
  src: string;
  fallbackSrc?: string;
  posterSrc?: string;
  kind?: MediaKind;
  alt: string;
  className?: string;
  fullCapture?: boolean;
  missingLabel?: string;
  deferred?: boolean;
};

export default function RealProductMedia({
  src,
  fallbackSrc = "",
  posterSrc = "",
  kind = "image",
  alt,
  className = "",
  fullCapture = false,
  missingLabel = "真实截图 / 录屏待接入",
  deferred = false,
}: Props) {
  const locale = useSiteLocale();
  const displayMissingLabel = missingLabel === "真实截图 / 录屏待接入" ? siteT(locale, "copy.screenshotOrRecordingComingSoon.eff791") : missingLabel;
  const spec = { src, fallbackSrc, kind };
  const [media, setMedia] = useState(() => initialMediaState(spec));
  const handleError = () => setMedia((current) => nextMediaState(current, spec));

  return (
    <div className={`real-product-media ${className}`} data-full-capture={fullCapture ? "" : undefined}>
      {deferred ? (
        <div className="real-media-deferred" data-deferred-media aria-hidden="true" />
      ) : media.missing ? (
        <div className="real-media-missing" role="img" aria-label={siteT(locale, "website.mediaPending", {arg1: alt})}>
          <span>REAL PRODUCT CAPTURE</span>
          <small>{displayMissingLabel}</small>
        </div>
      ) : media.kind === "video" ? (
        <video src={media.src} poster={posterSrc || fallbackSrc || undefined} preload="metadata" muted loop playsInline autoPlay aria-label={alt} onError={handleError} />
      ) : (
        // The product capture is a real file-backed screenshot. It must never be replaced with drawn UI.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.src} alt={alt} loading="lazy" decoding="async" onError={handleError} />
      )}
    </div>
  );
}
