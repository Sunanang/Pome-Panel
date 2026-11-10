const pomeLocaleRendererNotificationDomain = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
const pomeNotificationProviders = typeof module === 'object' && module.exports ? require('../aiProviderCatalog') : globalThis.NotchAiProviders;
(function (root, factory) {
  const domain = factory();
  if (typeof module === 'object' && module.exports) module.exports = domain;
  else root.PomeNotification = domain;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const providers = Object.fromEntries(pomeNotificationProviders.completionIds().map(id => [id, pomeNotificationProviders.get(id)]));
  const sources = { ...Object.fromEntries(Object.entries(providers).map(([id, row]) => [id, row.label])), claude: 'Claude', gpt: 'GPT', get task() { return pomeLocaleRendererNotificationDomain.t("copy.task.525304"); }, get todo() { return pomeLocaleRendererNotificationDomain.t("copy.tasks.52fdbb"); } };
  function iconPath(source) {
    const key = sourceKey(source);
    return providers[key]?.icon || (key === 'gpt' ? 'assets/inbox/openai.svg' : `assets/notification/${key}.svg`);
  }
  function sourceKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (key === 'claude-code' || key === 'claude code') return 'claude';
    return Object.hasOwn(sources, key) ? key : 'task';
  }
  function statusKey(value, source) {
    if (['completed', 'due', 'overdue', 'failed', 'awaiting'].includes(value)) return value;
    return sourceKey(source) === 'todo' ? 'due' : 'completed';
  }
  function fallbackTitle(source, status, locale = pomeLocaleRendererNotificationDomain.getState().effectiveLocale) {
    const key = sourceKey(source);
    const name = key === 'task' ? pomeLocaleRendererNotificationDomain.t('copy.task.525304', {}, locale)
      : key === 'todo' ? pomeLocaleRendererNotificationDomain.t('copy.tasks.52fdbb', {}, locale) : sources[key];
    const message = status === 'due' ? 'copy.taskDueSoon.52facb'
      : status === 'overdue' ? 'copy.taskOverdue.d31df8'
      : status === 'failed' ? 'copy.taskFailed.5f588b'
      : status === 'awaiting' ? 'copy.isAwaitingConfirmation.74d3db'
      : key === 'task' ? 'copy.taskCompleted.e9a880' : 'copy.taskCompleted.80a4b4';
    return pomeLocaleRendererNotificationDomain.t(message, { arg1: name }, locale);
  }
  function concreteTitle(value) {
    return /^(?:已完成|完成了|完成|Done[.!]?|任务已完成|新的任务已经完成|任务完成)$/i.test(value) ? '' : value;
  }
  function eventTime(value, fallback = Date.now()) {
    const timestamp = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value || ''))
      ? Number(value) : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
  }
  function relativeTime(timestamp, now = Date.now()) {
    return pomeLocaleRendererNotificationDomain.relativeTime(eventTime(timestamp, now), now);
  }
  function queueCount(value) {
    const raw = Array.isArray(value) ? value.length : value && typeof value === 'object'
      ? value.queueCount ?? value.pendingCount ?? value.pending ?? value.count : value;
    return Math.min(99, Math.max(0, Math.floor(Number(raw) || 0)));
  }
  function attentionKind(value) {
    return ['input', 'choice', 'authorization'].includes(value) ? value : null;
  }
  function attentionCopy(kind, source, canFocus = true, manualResolution = false) {
    const t = (key, params) => pomeLocaleRendererNotificationDomain.t(`attention.${key}`, params);
    return {
      label: t(kind),
      action: canFocus ? t(`return.${kind}`, { source }) : t('return.manual'),
      hint: canFocus ? t(manualResolution ? 'hint.oauth' : 'hint', { source }) : t('hint.manual'),
    };
  }
  function normalize(payload, now = Date.now()) {
    const data = payload && typeof payload === 'object' ? payload : { title: typeof payload === 'string' ? payload : '' };
    const source = sourceKey(data.source || data.provider || data.agent || data.app || data.type);
    const status = statusKey(data.status, source);
    const text = values => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
    const project = text([data.project, data.projectName, data.workspace]);
    const todoSummary = source === 'todo' && data.todoSummary === true;
    const todoCount = Number.isSafeInteger(data.todoCount) && data.todoCount > 0 ? data.todoCount : 1;
    return {
      sourceKey: source, source: sources[source], status, project, todoSummary, todoCount,
      attentionKind: status === 'awaiting' ? attentionKind(data.attentionKind) : null,
      manualResolution: data.manualResolution === true,
      commandPreview: data.commandPreview === 'npm install' ? data.commandPreview : null,
      attentionTitleKey: ['attention.commandMasked', 'attention.sensitive', 'attention.generic'].includes(data.attentionTitleKey) ? data.attentionTitleKey : null,
      titleIsFallback: data.titleIsFallback === true || !concreteTitle(text([data.title, data.taskTitle, data.taskName, data.name])),
      title: todoSummary ? pomeLocaleRendererNotificationDomain.t('todo.overdueSummary', { count: todoCount }) : data.titleIsFallback === true ? fallbackTitle(source, status) : concreteTitle(text([data.title, data.taskTitle, data.taskName, data.name])) || fallbackTitle(source, status),
      completionSummary: text([data.completionSummary, data.completion_summary, data.title]).slice(0, 4096),
      sessionTitle: text([data.sessionTitle, data.session_title]).slice(0, 256),
      detail: todoSummary
        ? pomeLocaleRendererNotificationDomain.t('todo.overdueSummaryDetail')
        : status === 'due'
        ? pomeLocaleRendererNotificationDomain.t('copy.dueWithin1Hour.955b14')
        : status === 'overdue'
          ? pomeLocaleRendererNotificationDomain.t('copy.deadlineHasPassed.37e6a6')
          : project,
      eventId: data.eventId ?? null,
      occurredAt: eventTime(data.occurredAt ?? data.completedAt ?? data.completed_at ?? data.timestamp ?? data.queuedAt, now),
      queueCount: queueCount(data.queueCount ?? data.pendingCount ?? data.pending),
    };
  }
  return { sourceKey, statusKey, fallbackTitle, concreteTitle, eventTime, relativeTime, queueCount, attentionKind, attentionCopy, normalize, iconPath };
});
