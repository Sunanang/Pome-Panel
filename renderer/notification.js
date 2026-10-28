'use strict';
const pomeLocaleRendererNotification = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;


const root = document.getElementById('notification-root');
const shell = document.getElementById('notification-shell');
const openButton = document.getElementById('notification-open');
const closeButton = document.getElementById('notification-close');
const titleElement = document.getElementById('notification-title');
const sourceElement = document.getElementById('notification-source');
const detailElement = document.getElementById('notification-detail');
const queueElement = document.getElementById('notification-queue');
const timeElement = document.getElementById('notification-time');
const progressElement = document.getElementById('notification-progress');
const progressFill = document.getElementById('notification-progress-fill');
const domain = window.PomeNotification;
const api = window.notchAPI;
let capabilities = api?.capabilities || null;
const platformName = String(capabilities?.platform || api?.platform || 'darwin');
if (/^[a-z0-9]+$/.test(platformName)) document.documentElement.dataset.platform = platformName;
const canFocusWindows = () => capabilities?.features?.windowFocus === true;
function applyShellLabel() {
  // Completion can still launch Terminal / the source app without windowFocus.
  openButton.setAttribute('aria-label', pomeLocaleRendererNotification.t("copy.openTheSourceApp.ce1839"));
  if (currentNotification?.attentionKind) renderAttention();
}
api?.onCapabilitiesChanged?.(next => { capabilities = next; applyShellLabel(); });

const HIDE_FALLBACK_MS = 420;
const cssNumber = (name, fallback) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
let hideFallback = null;
let enterFallback = null;
let timeTicker = null;
let progressFrame = null;
let currentNotification = null;
let isVisible = false;
let isHiding = false;
let isHovering = false;
let timing = null;
let lastHeight = 0;
let keepShell = false;
let activationError = false;
let activating = false;
applyShellLabel();

function updateHeight() {
  if (!currentNotification || !isVisible || isHiding) return;
  const height = currentNotification.attentionKind ? cssNumber('--at-window-height', 146)
    : cssNumber('--nb-base-height', 92) + (titleElement.offsetHeight > 18 ? 18 : 0);
  document.documentElement.style.setProperty('--nb-window-h', `${height}px`);
  if (height === lastHeight) return;
  lastHeight = height;
  api?.taskNotificationResize?.({ eventId: currentNotification.eventId, height });
}
function setQueueCount(value) {
  const count = domain.queueCount(value);
  queueElement.textContent = `+${count}`;
  queueElement.hidden = count === 0;
  const attentionQueue = document.getElementById('attention-queue');
  document.getElementById('attention-queue-count').textContent = `+${count}`; attentionQueue.hidden = count === 0;
  updateHeight();
}
function updateTime() {
  if (!currentNotification) return;
  const text = domain.relativeTime(currentNotification.occurredAt);
  if (timeElement.textContent !== text) { timeElement.textContent = text; updateHeight(); }
  document.getElementById('attention-time').textContent = text;
}
function renderProgress() {
  cancelAnimationFrame(progressFrame);
  if (!timing || !isVisible || isHiding || currentNotification?.status === 'awaiting') return;
  const remaining = Math.max(0, timing.remainingMs - (timing.paused ? 0 : Math.max(0, Date.now() - timing.startedAt)));
  progressFill.style.transform = `scaleX(${Math.min(1, remaining / timing.durationMs)})`;
  if (!timing.paused && remaining > 0) progressFrame = requestAnimationFrame(renderProgress);
}
function applyTiming(value) {
  if (!currentNotification || value?.eventId !== currentNotification.eventId) return;
  timing = value;
  renderProgress();
}
function reportHover(hovering) {
  if (isHovering === hovering) return;
  isHovering = hovering;
  shell.classList.toggle('is-hover', hovering);
  api?.taskNotificationHover?.(hovering, currentNotification?.eventId);
  updateHeight();
}
function stopTickers() {
  clearTimeout(enterFallback);
  clearInterval(timeTicker);
  cancelAnimationFrame(progressFrame);
  enterFallback = null;
  timeTicker = null;
  progressFrame = null;
}
function showNotification(payload) {
  stopTickers();
  clearTimeout(hideFallback);
  currentNotification = domain.normalize(payload);
  const notification = currentNotification;
  document.documentElement.dataset.attention = String(Boolean(notification.attentionKind));
  shell.classList.toggle('is-attention', Boolean(notification.attentionKind));
  document.getElementById('attention-content').hidden = !notification.attentionKind;
  shell.querySelector('.attention-seam').hidden = !notification.attentionKind;
  isVisible = true;
  activationError = false;
  activating = false;
  isHiding = false;
  timing = null;
  keepShell = false;
  const replace = payload?.replace === true && root.classList.contains('is-visible');
  lastHeight = 0;
  titleElement.textContent = notification.title;
  titleElement.title = [notification.sessionTitle, notification.titleIsFallback ? notification.title : notification.completionSummary || notification.title].filter(Boolean).join('\n');
  sourceElement.textContent = notification.source;
  detailElement.textContent = notification.detail;
  detailElement.hidden = !notification.detail;
  document.getElementById('notification-separator').hidden = !notification.detail;
  shell.classList.remove('has-activation-error');
  shell.dataset.source = notification.sourceKey;
  shell.dataset.status = notification.status;
  const brandPath = `./${domain.iconPath(notification.sourceKey)}`;
  document.getElementById('notification-brand').style.setProperty('--nb-brand', `url("${brandPath}")`);
  document.getElementById('attention-brand').src = brandPath;
  if (notification.attentionKind) renderAttention();
  document.getElementById('notification-status-glyph').setAttribute('href', `./assets/notification/glyphs.svg#${notification.status}`);
  document.getElementById('notification-status').setAttribute('aria-label', {
    completed: pomeLocaleRendererNotification.t('copy.completed.f28461'),
    due: pomeLocaleRendererNotification.t('copy.dueSoon.ea0afa'),
    overdue: pomeLocaleRendererNotification.t('copy.overdue.13c68d'),
    failed: pomeLocaleRendererNotification.t('copy.failed.01ad2b'),
    awaiting: pomeLocaleRendererNotification.t('copy.awaitingConfirmation.e5d218'),
  }[notification.status]);
  progressElement.hidden = notification.status === 'awaiting';
  progressFill.style.transform = 'scaleX(1)';
  root.hidden = false;
  if (!replace) root.classList.remove('is-visible', 'is-hiding', 'is-switching', 'is-replacing');
  else root.classList.add('is-replacing');
  updateTime();
  setQueueCount(notification.queueCount);
  updateHeight();
  void root.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!isVisible || isHiding || notification !== currentNotification) return;
    root.classList.add('is-visible');
    root.classList.remove('is-switching');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    enterFallback = setTimeout(() => {
      if (!isVisible || isHiding || notification !== currentNotification) return;
      api?.taskNotificationShown?.(notification.eventId);
      reportHover(shell.matches(':hover'));
      // A reused window may still be under the pointer when the next item appears.
      api?.taskNotificationHover?.(isHovering, notification.eventId);
    }, reduce ? 120 : replace ? 180 : cssNumber('--nb-enter-ms', 300));
  }));
  timeTicker = setInterval(updateTime, 1000);
}
function finishHide() {
  if (!isHiding) return;
  clearTimeout(hideFallback);
  stopTickers();
  reportHover(false);
  isVisible = false;
  isHiding = false;
  if (!keepShell) {
    root.classList.remove('is-visible', 'is-hiding', 'is-switching', 'is-replacing');
    root.hidden = true;
  }
  api?.taskNotificationDismissed?.(currentNotification?.eventId);
}
function hideNotification(value) {
  const eventId = value && typeof value === 'object' ? value.eventId : value;
  if (!isVisible || isHiding || (eventId != null && eventId !== currentNotification?.eventId)) return;
  isHiding = true;
  keepShell = value?.keepShell === true;
  stopTickers();
  reportHover(false);
  if (keepShell) root.classList.add('is-switching');
  else { root.classList.remove('is-visible'); root.classList.add('is-hiding'); }
  hideFallback = setTimeout(finishHide, keepShell ? 120 : matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : cssNumber('--nb-hide-ms', HIDE_FALLBACK_MS));
}
function dismissNotification() {
  if (!isVisible || isHiding) return;
  if (api?.dismissTaskNotification) api.dismissTaskNotification(currentNotification.eventId);
  else hideNotification(currentNotification.eventId);
}
shell.addEventListener('pointerenter', () => reportHover(true));
shell.addEventListener('pointerleave', () => { if (!activationError && !shell.matches(':focus-within')) reportHover(false); });
shell.addEventListener('focusin', () => reportHover(true));
shell.addEventListener('focusout', () => { if (!activationError && !shell.matches(':hover') && !shell.matches(':focus-within')) reportHover(false); });
function renderAttention() {
  const notification = currentNotification;
  if (notification.attentionTitleKey) notification.title = pomeLocaleRendererNotification.t(notification.attentionTitleKey, { command: notification.commandPreview });
  const copy = domain.attentionCopy(notification.attentionKind, notification.source, canFocusWindows(), notification.manualResolution);
  document.getElementById('attention-label').textContent = copy.label;
  document.getElementById('attention-source').textContent = notification.source;
  const project = document.getElementById('attention-project');
  project.textContent = notification.project; project.hidden = !notification.project;
  const title = document.getElementById('attention-title'); title.textContent = notification.title; title.title = notification.title;
  if (notification.commandPreview) {
    const marker = `${notification.commandPreview} ••••`, parts = notification.title.split(marker);
    if (parts.length === 2) {
      const command = document.createElement('span'); command.className = 'attention-command'; command.textContent = `${notification.commandPreview} `;
      const mask = document.createElement('span'); mask.className = 'attention-command-mask'; mask.textContent = '••••'; command.append(mask);
      title.replaceChildren(document.createTextNode(parts[0]), command, document.createTextNode(parts[1]));
    }
  }
  document.getElementById('attention-action-label').textContent = copy.action;
  document.getElementById('attention-action').classList.toggle('is-manual', !canFocusWindows());
  document.getElementById('attention-hint').textContent = copy.hint;
}
async function activateNotification() {
  if (!isVisible || isHiding || activating) return;
  const eventId = currentNotification.eventId;
  const isAttention = Boolean(currentNotification.attentionKind);
  // Attention return needs an existing window focus path; completion can launch.
  if (isAttention && !canFocusWindows()) {
    dismissNotification();
    return;
  }
  if (api?.activateTaskNotification) {
    activating = true;
    let result;
    try { result = await api.activateTaskNotification(eventId); } catch { result = { ok: false }; }
    if (currentNotification?.eventId !== eventId) return;
    activating = false;
    if (result !== true && result?.ok !== true) {
      activationError = true;
      pomeLocaleRendererNotification.bind(detailElement, "textContent", () => (result?.message || pomeLocaleRendererNotification.t("copy.couldnTOpenTheSourceAppTry.180b9d")));
      detailElement.title = detailElement.textContent;
      detailElement.hidden = false;
      document.getElementById('notification-separator').hidden = false;
      shell.classList.add('has-activation-error');
      if (isAttention) document.getElementById('attention-hint').textContent = detailElement.textContent;
      reportHover(true);
      return;
    }
    if (isAttention) {
      activationError = false;
      shell.classList.remove('has-activation-error');
      renderAttention();
      api?.taskNotificationHover?.(isHovering, eventId);
    }
  }
  if (currentNotification?.eventId === eventId && !isAttention) dismissNotification();
}
openButton.addEventListener('click', activateNotification);
document.getElementById('attention-action').addEventListener('click', event => { event.stopPropagation(); void activateNotification(); });
document.getElementById('attention-close').addEventListener('click', event => { event.stopPropagation(); dismissNotification(); });
closeButton.addEventListener('click', event => { event.stopPropagation(); dismissNotification(); });
shell.addEventListener('keydown', event => {
  if (event.key === 'Escape' && currentNotification?.status !== 'awaiting') { event.preventDefault(); dismissNotification(); }
});
window.addEventListener('blur', () => { if (!activationError) reportHover(false); });
window.addEventListener('resize', updateHeight);
window.addEventListener('beforeunload', stopTickers);
api?.onTaskNotification?.(showNotification);
api?.onTaskNotificationQueue?.(setQueueCount);
api?.onTaskNotificationHide?.(hideNotification);
api?.onTaskNotificationTiming?.(applyTiming);

window.addEventListener('pome:language-changed', () => {
  applyShellLabel();
  if (!currentNotification) return;
  if (currentNotification.attentionKind) renderAttention();
  if (currentNotification.titleIsFallback) { titleElement.textContent = domain.fallbackTitle(currentNotification.sourceKey, currentNotification.status); titleElement.title = [currentNotification.sessionTitle, titleElement.textContent].filter(Boolean).join('\n'); }
  if (!activationError && currentNotification.status === 'due') {
    detailElement.textContent = pomeLocaleRendererNotification.t('copy.dueWithin1Hour.955b14');
  } else if (!activationError && currentNotification.status === 'overdue') {
    detailElement.textContent = pomeLocaleRendererNotification.t('copy.deadlineHasPassed.37e6a6');
  }
  updateTime(); updateHeight();
});
