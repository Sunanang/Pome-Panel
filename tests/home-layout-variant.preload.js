const { contextBridge } = require('electron');
const catalog = require('../aiProviderCatalog');
let snapshots = {}, reads = 0;
const now = Date.parse('2026-11-04T04:30:00Z');
const records = Array.from({ length: 18 }, (_, i) => ({ id: `review-${i}`, source: ['codex', 'claude', 'cursor'][i % 3],
  status: i === 1 ? 'failed' : 'completed', readAt: null, receivedAt: now - (i + 1) * 60000,
  title: ['首页组件适配已完成', '修复通知转发并验证', '更新多语言资源与回归'][i % 3],
  completionSummary: ['已完成宽屏与纵向布局适配，保留原尺寸偏好。', '通知链路验证完成，已保留原命令。', '中文与英文资源检查通过。'][i % 3],
  sessionTitle: 'Pome Panel 本机回归', project: 'Pome Panel', titleIsFallback: false }));
const api = {
  localization: require('../localization/runtime').snapshot('zh-CN', ['zh-CN']),
  capabilities: require('../platform').resolveCapabilities('darwin'), platform: 'darwin',
  fixtureUsage(value) { snapshots = value; }, fixtureInboxReads() { return reads; },
  async getTaskInbox(options = {}) { reads++; return { ok: true, items: records.slice(options.offset || 0, (options.offset || 0) + (options.limit || 100)), total: records.length, unread: records.length }; },
  async getAiSources() { return { ok: true, sources: catalog.hookableIds().map(source => ({ source, state: 'connected', detected: true, label: catalog.get(source).label })), listener: { listening: true, topBubbleEnabled: true, meetingMode: false } }; },
  async getSunWeather() { return { temperature: 18, humidity: 60, code: 0, condition: '晴', windSpeed: 0, updatedAt: now }; },
  async scheduleTodoReminders() {},
};
for (const provider of catalog.usageProviders()) api[provider.request] = async () => snapshots[provider.id] || { ok: true, detected: false };
contextBridge.exposeInMainWorld('notchAPI', api);
