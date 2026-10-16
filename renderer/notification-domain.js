(function (root, factory) {
  const domain = factory();
  if (typeof module === 'object' && module.exports) module.exports = domain;
  else root.PomeNotification = domain;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const sources = { codex: 'Codex', claude: 'Claude', cursor: 'Cursor', gpt: 'GPT', task: '任务', todo: '待办' };
  function sourceKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (key === 'claude-code' || key === 'claude code') return 'claude';
    return Object.hasOwn(sources, key) ? key : 'task';
  }
  function statusKey(value, source) {
    if (['completed', 'due', 'failed', 'awaiting'].includes(value)) return value;
    return sourceKey(source) === 'todo' ? 'due' : 'completed';
  }
  function fallbackTitle(source, status) {
    const name = sources[sourceKey(source)];
    if (status === 'due') return '待办即将截止';
    if (status === 'failed') return `${name}任务出错`;
    if (status === 'awaiting') return `${name}等待确认`;
    return sourceKey(source) === 'task' ? '任务已完成' : `${name} 已完成任务`;
  }
  function concreteTitle(value) {
    return /^(?:任务已完成|新的任务已经完成|任务完成)$/.test(value) ? '' : value;
  }
  function eventTime(value, fallback = Date.now()) {
    const timestamp = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value || ''))
      ? Number(value) : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
  }
  function relativeTime(timestamp, now = Date.now()) {
    const minutes = Math.floor(Math.max(0, now - eventTime(timestamp, now)) / 60000);
    return minutes < 1 ? '刚刚' : `${minutes} 分钟前`;
  }
  function queueCount(value) {
    const raw = Array.isArray(value) ? value.length : value && typeof value === 'object'
      ? value.queueCount ?? value.pendingCount ?? value.pending ?? value.count : value;
    return Math.min(99, Math.max(0, Math.floor(Number(raw) || 0)));
  }
  function normalize(payload, now = Date.now()) {
    const data = payload && typeof payload === 'object' ? payload : { title: typeof payload === 'string' ? payload : '' };
    const source = sourceKey(data.source || data.provider || data.agent || data.app || data.type);
    const status = statusKey(data.status, source);
    const text = values => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
    const project = text([data.project, data.projectName, data.workspace]);
    return {
      sourceKey: source, source: sources[source], status, project,
      title: concreteTitle(text([data.title, data.taskTitle, data.taskName, data.name])) || fallbackTitle(source, status),
      detail: status === 'due' ? '将在 1 小时内截止' : project,
      eventId: data.eventId ?? null,
      occurredAt: eventTime(data.occurredAt ?? data.completedAt ?? data.completed_at ?? data.timestamp ?? data.queuedAt, now),
      queueCount: queueCount(data.queueCount ?? data.pendingCount ?? data.pending),
    };
  }
  return { sourceKey, statusKey, fallbackTitle, concreteTitle, eventTime, relativeTime, queueCount, normalize };
});
