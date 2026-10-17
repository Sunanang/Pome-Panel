import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LandingPage from "../app/LandingPage";
import { getLandingContent } from "../app/landingContent";


const read = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
test("website translations match their shared source, including named parameters", () => {
  const catalog = read("../../localization/catalog.json");
  const website = read("../app/translations.json");
  const keys = new Set(catalog.filter((row: { locations: { file: string }[] }) => row.locations.some(location => location.file.startsWith("website/"))).map((row: { key: string }) => row.key));
  for (const locale of ["en-US", "zh-CN"]) {
    const source = read(`../../localization/locales/${locale}.json`);
    const expected = Object.fromEntries(Object.entries(source).filter(([key]) => keys.has(key) || key.startsWith("website.")));
    assert.deepEqual(website[locale], expected, "Run npm run i18n:generate from the repository root");
  }
});

test("English website renders English copy and English product screenshots", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { locale: "en-US" }));
  assert.match(html, /Download for Windows/);
  assert.match(html, /Download for macOS/);
  assert.doesNotMatch(html.replaceAll("简体中文", ""), /[\p{sc=Han}]/u);
  const content = getLandingContent("en-US");
  for (const item of content.TAB_ITEMS) {
    assert.equal(item.captureKind, "image");
    assert.match(item.capture, /product-captures\/en\//);
    assert(existsSync(new URL(`../public/product-captures/en/${item.id}.jpg`, import.meta.url)));
  }
  const metadata = readFileSync(new URL("../app/SiteLayout.tsx", import.meta.url), "utf8");
  assert.match(metadata, /en_US/); assert.match(metadata, /zh_CN/);
});
