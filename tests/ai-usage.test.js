'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/ai-usage-domain');
const absent = { ok: true, detected: false, configured: false };
const cursor = { detected: true, auto: { percent: 30 }, other: { percent: 45 }, grokBot: { percent: 10 } };
const codex = { detected: true, primary: { percent: 86 }, secondary: { percent: 15 } };
test('AI usage four visibility combinations and titles have no empty provider', () => {
  for (const [c, d, ids, title] of [[absent, absent, [], 'AI 剩余额度'], [cursor, absent, ['cursor'], 'Cursor 剩余额度'],
    [absent, codex, ['codex'], 'Codex 剩余额度'], [cursor, codex, ['cursor', 'codex'], 'AI 剩余额度']]) {
    assert.deepEqual(D.providers(c, d), ids);
    assert.equal(D.title(ids), title);
  }
});
test('manual-only and failing configured providers remain visible', () => {
  assert.deepEqual(D.providers({ ok: false, configured: true }, { ok: true, configured: true }), ['cursor', 'codex']);
  assert.equal(D.available({ ...absent, ok: true, authSource: 'local' }), false, 'cached Cursor usage must disappear after logout');
});
test('first tab uses the least remaining pool; persisted tab never follows changing percentages', () => {
  assert.equal(D.chooseTab(null, ['cursor', 'codex'], cursor, codex), 'codex');
  assert.equal(D.chooseTab('cursor', ['cursor', 'codex'], cursor, codex), 'cursor');
  assert.equal(D.chooseTab('codex', ['cursor', 'codex'], { ...cursor, auto: { percent: 100 } }, codex), 'codex');
  assert.equal(D.chooseTab('codex', ['cursor'], cursor, absent), 'cursor');
  assert.equal(D.chooseTab(null, [], absent, absent), null);
  assert.equal(D.chooseTab(null, ['cursor', 'codex'], {}, { primary: { percent: 0 } }), 'cursor', 'ties preserve Cursor default');
  assert.equal(D.chooseTab(null, ['cursor', 'codex'], {}, codex), 'codex');
  assert.equal(D.chooseTab(null, ['cursor', 'codex'], { auto: { percent: 79.6 } }, { primary: { percent: 79.7 } }), 'codex', 'compare unrounded remainders');
});
test('remaining presentation handles zero, full, excess, decimals and missing without changing used data', () => {
  for (const [used, remaining, text] of [[0, 100, '100%'], [100, 0, '0%'], [125, 0, '0%'],
    [41, 59, '59%'], [40.5, 59.5, '60%'], [40.6, 59.4, '59%'], ['41', 59, '59%']]) {
    assert.equal(D.remaining(used), remaining);
    assert.equal(D.formatPercent(D.remaining(used)), text);
  }
  for (const used of [null, undefined, '', ' ', NaN, Infinity, 'invalid', false]) {
    assert.equal(D.remaining(used), null);
    assert.equal(D.formatPercent(D.remaining(used)), '--%');
  }
  const snapshot = JSON.stringify({ cursor, codex });
  assert.equal(D.lowestRemaining(cursor, 'cursor'), 55);
  assert.equal(D.lowestRemaining(codex, 'codex'), 14);
  D.chooseTab(null, ['cursor', 'codex'], cursor, codex);
  assert.equal(JSON.stringify({ cursor, codex }), snapshot);
});
test('remaining warning thresholds and hidden tab indicators use unrounded values', () => {
  for (const [remaining, level] of [[100, 'ok'], [20.1, 'ok'], [20, 'warn'], [5.1, 'warn'], [5, 'critical'], [0, 'critical'], [null, 'ok'], [undefined, 'ok']]) {
    assert.equal(D.level(remaining), level);
  }
  for (const [used, level] of [[79.9, 'ok'], [80, 'warn'], [94.9, 'warn'], [95, 'critical'], [101, 'critical']]) {
    assert.equal(D.level(D.lowestRemaining({ primary: { percent: used } }, 'codex')), level);
    assert.equal(D.level(D.lowestRemaining({ auto: { percent: used } }, 'cursor')), level);
  }
  assert.equal(D.lowestRemaining({}, 'codex'), null);
  assert.equal(D.lowestRemaining({ ok: false, primary: { percent: 100 } }, 'codex'), null);
  assert.equal(D.level(D.remaining(79.6)), 'ok', 'rounded display must not create an early warning');
});
test('expired quota copy uses the record reset time without pretending to refresh', () => {
  const window = { resetsAt: 1000 };
  assert.equal(D.expired(window, 1000000), true);
  assert.match(D.resetText(window, 1000000), /^已过 .* 重置 · 待刷新$/);
  assert.match(D.resetText(window, 999000), /重置$/);
});
test('resetText uses local calendar dates for today, tomorrow, week, month and year boundaries', () => {
  const cases = [
    [new Date(2026, 9, 9, 10), new Date(2026, 9, 9, 21, 1), '21:01 重置'],
    [new Date(2026, 9, 9, 23), new Date(2026, 9, 10, 11, 1), '明天 11:01 重置'],
    [new Date(2026, 9, 9, 10), new Date(2026, 9, 16, 11, 1), '10/16 11:01 重置'],
    [new Date(2026, 9, 31, 10), new Date(2026, 10, 1, 11, 1), '明天 11:01 重置'],
    [new Date(2026, 9, 31, 10), new Date(2026, 10, 2, 11, 1), '11/2 11:01 重置'],
    [new Date(2026, 11, 31, 10), new Date(2027, 0, 1, 11, 1), '明天 11:01 重置'],
    [new Date(2026, 11, 31, 10), new Date(2027, 0, 7, 11, 1), '1/7 11:01 重置'],
  ];
  for (const [now, reset, text] of cases) assert.equal(D.resetText({ resetsAt: reset.getTime() / 1000 }, now.getTime()), text);
  assert.equal(D.resetText({ resetsAt: 'invalid' }), '重置时间未知');
});
test('fallback has calm copy for full and mini layouts', () => {
  assert.equal(D.FALLBACK.title, '还没有连接 AI 工具');
  assert.equal(D.FALLBACK.miniTitle, '未连接 AI 工具');
  assert.equal(D.FALLBACK.miniBody, 'Cursor、Codex 都未检测到');
  assert.match(D.FALLBACK.body, /在本机登录 Cursor，或用过一次 Codex/);
});

test('dynamic quota labels use actual cadence including weekly-only primary and unknown windows', () => {
  assert.equal(D.windowLabel({ windowMinutes: 10080 }), '每周额度');
  assert.equal(D.windowLabel({ windowMinutes: 300 }), '5 小时额度');
  assert.equal(D.windowLabel({ windowMinutes: 60 }), '1 小时额度');
  assert.equal(D.windowLabel({ windowMinutes: 1440 }), '每日额度');
  const rows = D.quotaRows({ primary: { percent: 20, windowMinutes: 10080 }, secondary: null }, 'codex');
  assert.equal(rows.length, 1); assert.equal(rows[0].name, '每周额度');
  assert.equal(D.quotaRows({ primary: {} }, 'codex')[0].name, '主要额度');
});
test('registry describes only implemented providers and dynamic model rows participate in remaining quota', () => {
  assert.deepEqual(D.registry.providers.map(provider => provider.id), ['cursor', 'codex']);
  const data = { windows: [{ id: 'spark', label: 'Spark', percent: 98, windowMinutes: 300 }] };
  assert.equal(D.quotaRows(data, 'codex')[0].name, 'Spark · 5 小时额度');
  assert.equal(D.lowestRemaining(data, 'codex'), 2);
});
test('quota refresh adapts to reset time and visibility without retrying expired snapshots in a loop', () => {
  const data = { codex: { primary: { resetsAt: 1001 } } };
  assert.equal(D.refreshDelay(data, true, 1000000), 2000);
  assert.equal(D.refreshDelay(data, false, 1000000), 900000);
  assert.equal(D.refreshDelay(data, true, 1002000), 300000);
});
