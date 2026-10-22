'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../renderer/notification-domain');

test('notification branding resolves real assets for providers, aliases, legacy events and internal reminders', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const source of [...require('../aiProviderCatalog').completionIds(), 'gpt', 'task', 'todo', 'unknown', 'Claude Code', ' CODEX ']) {
    assert(fs.existsSync(path.join(__dirname, '../renderer', domain.iconPath(source))), source + ' must have a loadable icon');
  }
  assert.equal(domain.iconPath('Claude Code'), domain.iconPath('claude'));
  assert.equal(domain.iconPath('unknown'), domain.iconPath('task'));
});

test('notification source names remain normalized without enabling new hook endpoints', () => {
  for (const [input, key, label] of [
    ['CODEX','codex','Codex'], ['Claude Code','claude','Claude'], ['claude-code','claude','Claude'],
    [' Cursor ','cursor','Cursor'], [' Grok ','grok','Grok'], ['gpt','gpt','GPT'], ['task','task','任务'], ['todo','todo','待办'], ['unknown','task','任务'],
  ]) {
    const value = domain.normalize({ source: input });
    assert.equal(value.sourceKey, key);
    assert.equal(value.source, label);
  }
  assert.equal(domain.normalize({ provider: 'cursor' }).sourceKey, 'cursor');
});

test('old events retain timed completion and todo defaults, while status is explicit', () => {
  assert.equal(domain.normalize({ source: 'codex' }).status, 'completed');
  assert.equal(domain.normalize({ source: 'todo' }).status, 'due');
  assert.equal(domain.normalize({ source: 'cursor', status: 'invalid' }).status, 'completed');
  for (const status of ['completed','due','failed','awaiting']) {
    assert.equal(domain.normalize({ source: 'claude', status }).status, status);
  }
  assert.equal(domain.normalize({ source: 'todo' }).detail, '将在 1 小时内截止');
});

test('notification copy shows actual work, falls back by source, and has no repeated completion subtitle', () => {
  const value = domain.normalize({ source: 'codex', title: '重构通知队列', project: 'Pome-Panel' });
  assert.equal(value.title, '重构通知队列');
  assert.equal(value.detail, 'Pome-Panel');
  assert.equal(domain.normalize({ source: 'codex' }).title, 'Codex 已完成任务');
  assert.equal(domain.normalize({ source: 'claude', title: '  ' }).title, 'Claude 已完成任务');
  assert.equal(domain.normalize({ source: 'cursor' }).title, 'Cursor 已完成任务');
  assert.equal(domain.normalize({ source: 'grok' }).title, 'Grok 已完成任务');
  assert.equal(domain.normalize({ source: 'gpt' }).project, '');
  assert.equal(domain.normalize('导出账单').title, '导出账单');
  assert.equal(domain.normalize(null).title, '任务已完成');
});

test('relative time uses event time including queued events, ISO timestamps, invalid and future times', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  for (const [offset, expected] of [[0,'刚刚'],[59999,'刚刚'],[60000,'1 分钟前'],[120000,'2 分钟前'],[300000,'5 分钟前'],[-20000,'刚刚']]) {
    assert.equal(domain.relativeTime(now - offset, now), expected);
  }
  const queued = domain.normalize({ completedAt: new Date(now-300000).toISOString(), queuedAt: now }, now);
  assert.equal(domain.relativeTime(queued.occurredAt, now), '5 分钟前');
  assert.equal(domain.normalize({ completedAt: 'broken' }, now).occurredAt, now);
  assert.equal(domain.normalize({ queuedAt: now-120000 }, now).occurredAt, now-120000);
  assert.equal(domain.eventTime(String(now)), now);
  assert.equal(domain.relativeTime(null, now), '刚刚');
});

test('queue indicator is hidden for zero and bounded for invalid or excessive counts', () => {
  assert.equal(domain.queueCount(0), 0);
  assert.equal(domain.queueCount(-1), 0);
  assert.equal(domain.queueCount('bad'), 0);
  assert.equal(domain.queueCount(3), 3);
  assert.equal(domain.queueCount({pendingCount: 3}), 3);
  assert.equal(domain.queueCount(999), 99);
});
