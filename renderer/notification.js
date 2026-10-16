'use strict';

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
  openButton.setAttribute('aria-label', canFocusWindows() ? '打开任务对应窗口' : '关闭任务提醒');
}
applyShellLabel();
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

function updateHeight() {
  if (!currentNotification || !isVisible || isHiding) return;
  const height = cssNumber('--nb-base-height', 92) + (titleElement.offsetHeight > 18 ? 18 : 0);
  document.documentElement.style.setProperty('--nb-window-h', `${height}px`);
  if (height === lastHeight) return;
  lastHeight = height;
  api?.taskNotificationResize?.({ eventId: currentNotification.eventId, height });
}
function setQueueCount(value) {
  const count = domain.queueCount(value);
  queueElement.textContent = `+${count}`;
  queueElement.hidden = count === 0;
  updateHeight();
}
function updateTime() {
  if (!currentNotification) return;
  const text = domain.relativeTime(currentNotification.occurredAt);
  if (timeElement.textContent !== text) { timeElement.textContent = text; updateHeight(); }
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
  api?.taskNotificationHover?.(hovering);
  updateHeight();
}
function stopTickers() {
  clearTimeout(enterFallback);
  clearInterval(timeTicker);
  cancelAnimationFrame(progressFrame);
}
function showNotification(payload) {
  stopTickers();
  clearTimeout(hideFallback);
  currentNotification = domain.normalize(payload);
  const notification = currentNotification;
  isVisible = true;
  isHiding = false;
  timing = null;
  keepShell = false;
  const replace = payload?.replace === true && root.classList.contains('is-visible');
  lastHeight = 0;
  titleElement.textContent = notification.title;
  titleElement.title = notification.title;
  sourceElement.textContent = notification.source;
  detailElement.textContent = notification.detail;
  detailElement.hidden = !notification.detail;
  document.getElementById('notification-separator').hidden = !notification.detail;
  shell.dataset.source = notification.sourceKey;
  shell.dataset.status = notification.status;
  const brandPath = ['codex','claude','cursor'].includes(notification.sourceKey)
    ? `./assets/inbox/${notification.sourceKey}.svg` : `./assets/notification/${notification.sourceKey}.svg`;
  document.getElementById('notification-brand').style.setProperty('--nb-brand', `url("${brandPath}")`);
  document.getElementById('notification-status-glyph').setAttribute('href', `./assets/notification/glyphs.svg#${notification.status}`);
  document.getElementById('notification-status').setAttribute('aria-label', { completed: '已完成', due: '即将截止', failed: '出错', awaiting: '等待确认' }[notification.status]);
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
      api?.taskNotificationHover?.(isHovering);
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
shell.addEventListener('pointerleave', () => reportHover(false));
openButton.addEventListener('click', async () => {
  if (!isVisible || isHiding) return;
  const eventId = currentNotification.eventId;
  if (canFocusWindows() && api?.activateTaskNotification) {
    try { await api.activateTaskNotification(eventId); } catch (error) { /* Dismiss still works when activation fails. */ }
  }
  if (currentNotification?.eventId === eventId) dismissNotification();
});
closeButton.addEventListener('click', event => { event.stopPropagation(); dismissNotification(); });
shell.addEventListener('keydown', event => {
  if (event.key === 'Escape' && currentNotification?.status !== 'awaiting') { event.preventDefault(); dismissNotification(); }
});
window.addEventListener('blur', () => reportHover(false));
window.addEventListener('resize', updateHeight);
window.addEventListener('beforeunload', stopTickers);
api?.onTaskNotification?.(showNotification);
api?.onTaskNotificationQueue?.(setQueueCount);
api?.onTaskNotificationHide?.(hideNotification);
api?.onTaskNotificationTiming?.(applyTiming);
