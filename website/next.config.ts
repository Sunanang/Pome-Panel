import type { NextConfig } from "next";

const pagesExport = process.env.GITHUB_PAGES === "true";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: pagesExport ? "export" : undefined,
  assetPrefix: basePath || undefined,
  // Vinext's RSC prerender requests use slashless routes. Canonical links
  // and the static export postprocessor provide directory URLs on Pages.
  trailingSlash: false,
};

export default nextConfig;
