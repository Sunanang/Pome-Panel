import { siteT, type SiteLocale } from "./siteI18n";
import { assetPath } from "./assetPath.mjs";

export const DOWNLOAD_URL = "https://github.com/Sunanang/Pome-Panel/releases/latest";
export const GITHUB_URL = "https://github.com/Sunanang/Pome-Panel";

export type MediaKind = "image" | "video";

export type MediaItem = {
  id: string;
  src: string;
  fallbackSrc: string;
  kind: MediaKind;
  alt: string;
};

export type TabItem = {
  id: "todo" | "clipboard" | "notes" | "links" | "recordings" | "credentials";
  eyebrow: string;
  title: string;
  description: string;
  capture: string;
  capturePoster: string;
  captureKind: MediaKind;
  accent: string;
};

export function getLandingContent(locale: SiteLocale) {
const NAV_ITEMS = [
  ["GITHUB", GITHUB_URL],
  ["FEATURES", "#features"],
  ["TABS", "#tabs"],
] as const;

const MARQUEE_ITEMS: MediaItem[] = [
  { id: "todo", src: assetPath("/product-captures/todo.webp"), fallbackSrc: "", kind: "image", alt: siteT(locale, "copy.pomePanelTasksView.580a50") },
  { id: "clipboard", src: assetPath("/product-captures/clipboard.webp"), fallbackSrc: "", kind: "image", alt: siteT(locale, "copy.pomePanelClipboardView.9683d3") },
  { id: "notes", src: assetPath("/product-captures/notes.webp"), fallbackSrc: "", kind: "image", alt: siteT(locale, "copy.pomePanelNotesView.ee0c13") },
  { id: "links", src: assetPath("/product-captures/links.webp"), fallbackSrc: "", kind: "image", alt: siteT(locale, "copy.pomePanelLinksView.e5dcc1") },
  { id: "recordings", src: assetPath("/product-captures/recordings.webp"), fallbackSrc: "", kind: "image", alt: siteT(locale, "copy.pomePanelRecordingsView.0e96db") },
  { id: "credentials", src: assetPath("/product-captures/credentials.webp"), fallbackSrc: "", kind: "image", alt: siteT(locale, "copy.pomePanelCredentialsView.721abf") },
];

const CAPABILITIES = [
  ["01", siteT(locale, "copy.readyAtTheScreenEdge.4ce687"), siteT(locale, "copy.expandWhenNeededCollapseWhenDone.bc23cd")],
  ["02", siteT(locale, "copy.taskReminders.f741f8"), siteT(locale, "copy.fourWorkflowsWithClearDeadlines.e93cbe")],
  ["03", siteT(locale, "copy.captureAsYouGo.3bb8e1"), siteT(locale, "copy.notesLinksAndClipboardHistoryInOne.dd8395")],
  ["04", siteT(locale, "copy.localRecording.895688"), siteT(locale, "copy.recordWhenYouChooseWithOptionalLive.466e17")],
  ["05", siteT(locale, "copy.aiNotifications.d94669"), siteT(locale, "copy.localTaskNotificationsFromCodexClaudeCode.8c8b56")],
  ["06", siteT(locale, "copy.yourDataStaysLocal.076404"), siteT(locale, "copy.yourWorkStaysOnYourOwnComputer.635445")],
] as const;

const TAB_ITEMS: TabItem[] = [
  { id: "todo", eyebrow: "PLAN THE DAY", title: siteT(locale, "copy.tasks.52fdbb"), description: siteT(locale, "copy.fourWorkflowsYouCanRenameSortedBy.cfe3e2"), capture: assetPath("/tab-captures/todo.mp4"), capturePoster: assetPath("/product-captures/todo.webp"), captureKind: "video", accent: "red" },
  { id: "clipboard", eyebrow: "CAPTURE FAST", title: siteT(locale, "copy.clipboard.658c84"), description: siteT(locale, "copy.optionalLocalClipboardHistoryForTextImages.d1c5a0"), capture: assetPath("/tab-captures/clipboard.mp4"), capturePoster: assetPath("/product-captures/clipboard.webp"), captureKind: "video", accent: "amber" },
  { id: "notes", eyebrow: "THINK IN TEXT", title: siteT(locale, "copy.notes.b778e3"), description: siteT(locale, "copy.writeOnHomeThenSaveToYour.c4232e"), capture: assetPath("/tab-captures/notes.mp4"), capturePoster: assetPath("/product-captures/notes.webp"), captureKind: "video", accent: "green" },
  { id: "links", eyebrow: "SAVE THE WEB", title: siteT(locale, "copy.links.305378"), description: siteT(locale, "copy.pasteAPublicUrlToFetchIts.96c0d6"), capture: assetPath("/tab-captures/links.mp4"), capturePoster: assetPath("/product-captures/links.webp"), captureKind: "video", accent: "blue" },
  { id: "recordings", eyebrow: "RECORD THE MOMENT", title: siteT(locale, "copy.recordings.4b6ef7"), description: siteT(locale, "copy.theMicrophoneStartsOnlyWhenYouChoose.8f8615"), capture: assetPath("/tab-captures/recordings.mp4"), capturePoster: assetPath("/product-captures/recordings.webp"), captureKind: "video", accent: "rose" },
  { id: "credentials", eyebrow: "KEEP IT SAFE", title: siteT(locale, "copy.credentials.f67bca"), description: siteT(locale, "copy.accountsPasswordsAndApiKeysAreEncrypted.73f485"), capture: assetPath("/tab-captures/credentials.mp4"), capturePoster: assetPath("/product-captures/credentials.webp"), captureKind: "video", accent: "violet" },
];

if (!locale.startsWith("zh-")) {
  for (const item of MARQUEE_ITEMS) item.src = assetPath(`/product-captures/en/${item.id}.jpg`);
  for (const item of TAB_ITEMS) {
    item.capture = assetPath(`/product-captures/en/${item.id}.jpg`);
    item.capturePoster = item.capture;
    item.captureKind = "image";
  }
}
return { NAV_ITEMS, MARQUEE_ITEMS, CAPABILITIES, TAB_ITEMS };
}
export const { NAV_ITEMS, MARQUEE_ITEMS, CAPABILITIES, TAB_ITEMS } = getLandingContent("zh-CN");
