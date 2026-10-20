'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/ai-usage-domain');
const absent = { ok: true, detected: false, configured: false };
const cursor = { detected: true, auto: { percent: 30 }, other: { percent: 45 } };
const codex = { detected: true, primary: { percent: 86 }, secondary: { percent: 15 } };
const grokbot = { detected: true, ok: true, primary: { percent: 90 } };
test('AI usage four visibility combinations and titles have no empty provider', () => {
  for (const [snapshots, ids, title] of [
    [{ cursor: absent, codex: absent }, [], 'AI 剩余额度'],
    [{ cursor, codex: absent }, ['cursor'], 'AI 剩余额度'],
    [{ cursor: absent, codex }, ['codex'], 'AI 剩余额度'],
    [{ cursor, codex }, ['cursor', 'codex'], 'AI 剩余额度'],
  ]) {
    assert.deepEqual(D.providers(snapshots), ids);
    assert.equal(D.title(ids), title);
  }
  assert.deepEqual(D.providers(cursor, codex), ['cursor', 'codex'], 'legacy dual-arg signature still works');
});
test('manual-only and failing configured providers remain visible', () => {
  assert.deepEqual(D.providers({ cursor: { ok: false, configured: true }, codex: { ok: true, configured: true } }), ['cursor', 'codex']);
  assert.equal(D.available({ ...absent, ok: true, authSource: 'local' }), false, 'cached Cursor usage must disappear after logout');
});
test('dashboard folds only compact sizes and preserves settings order in larger sizes', () => {
  const snapshots = { cursor, codex, claude: { detected: true, primary: { percent: 82 } }, grokbot,
    grok: { configured: true, ok: true, primary: { currency: 'USD', balance: 20 } } };
  assert.deepEqual(D.dashboard(snapshots, 'mini').shown, ['grokbot', 'codex', 'claude']);
  assert.deepEqual(D.dashboard(snapshots, 'mini').hidden, ['cursor', 'grok']);
  assert.equal(D.dashboard(snapshots, 'mini').columns, 4);
  assert.equal(D.dashboard(snapshots, 'small').shown.length, 3);
  for (const size of ['medium', 'large']) assert.deepEqual(D.dashboard(snapshots, size).shown, ['cursor', 'codex', 'claude', 'grokbot', 'grok']);
  assert.equal(D.dashboard(snapshots, 'medium').columns, 3);
  assert.equal(D.dashboard(snapshots, 'medium').rows, 2);
  assert.equal(D.dashboard(snapshots, 'large').columns, 2);
  assert.equal(D.dashboard(snapshots, 'large').rows, 3);
  assert.equal(D.dashboard(snapshots, 'large').summary, true);
  delete snapshots.grok;
  assert.equal(D.dashboard(snapshots, 'mini').shown.length, 4);
  assert.equal(D.dashboard(snapshots, 'mini').hidden.length, 0);
  assert.equal(D.dashboard(snapshots, 'large').summary, false, 'four sources stay without a summary cell');
  const six = D.dashboard({ cursor, codex, claude: { detected: true }, grokbot, grok: { configured: true }, copilot: { detected: true } }, 'large');
  assert.equal(six.summary, false);
  assert.equal(six.rows, 3);
});
test('compact urgency ranks critical, warn, error, ok by unrounded minimum, then stale', () => {
  const snapshots = {
    cursor: { ...cursor, auto: { percent: 40 }, other: { percent: 0 } },
    codex: { ...codex, primary: { percent: 0 }, secondary: { percent: 0 } },
    claude: { detected: true, primary: { percent: 80 } },
    grokbot: { ...grokbot, primary: { percent: 95 } },
    grok: { configured: true, ok: false, status: 401 },
    copilot: { detected: true, windows: [{ percent: 39.9 }] },
    antigravity: { detected: true, stale: true, windows: [{ percent: 99 }] },
  };
  assert.deepEqual(D.dashboard(snapshots, 'small').ids, ['grokbot', 'claude', 'grok', 'cursor', 'copilot', 'codex', 'antigravity']);
  assert.equal(D.status({ detected: false, configured: false }, 'manus'), 'undetected');
  assert.equal(D.status({ ...cursor, manualTokenInvalid: true }, 'cursor'), 'error');
  assert.equal(D.status({ ...cursor, fetchedAt: '2020-01-01T00:00:00Z' }, 'cursor'), 'stale');
  assert.equal(D.status({ configured: true, ok: true, primary: { currency: 'USD', balance: 0 } }, 'grok'), 'critical');
  assert.equal(D.urgencyRemaining({ configured: true, ok: true, primary: { unit: 'credits', balance: 0 } }, 'manus'), 0);
  const balances = { grok: { configured: true, ok: true, primary: { currency: 'USD', balance: 0 } }, manus: { configured: true, ok: true, primary: { unit: 'credits', balance: 0 } } };
  assert.deepEqual(D.dashboard({ ...snapshots, ...balances }, 'small').shown, ['grok', 'manus', 'grokbot'], 'exhausted balances precede low quota and errors');
  assert.equal(D.status({ ...balances.grok, primary: { currency: 'USD', balance: 1 } }, 'grok'), 'ok');
  assert.equal(D.status({ ...balances.manus, stale: true }, 'manus'), 'stale');
});
test('all eight sources stay present in medium and large, no tab state remains', () => {
  const data = Object.fromEntries(D.registry.ids().map(id => [id, { detected: true }]));
  for (const size of ['medium', 'large']) assert.equal(D.dashboard(data, size).shown.length, 8);
  assert.equal(D.dashboard(data, 'large').summary, false);
  assert.equal('chooseTab' in D, false);
  assert.equal('TAB_KEY' in D, false);
});
test('timestamp and clock accept ISO, unix seconds, and millisecond epoch', () => {
  const iso = '2026-10-20T08:00:00.000Z';
  const sec = Date.parse(iso) / 1000;
  const ms = Date.parse(iso);
  assert.equal(D.timestamp({ fetchedAt: iso }), ms);
  assert.equal(D.timestamp({ fetchedAt: sec }), ms);
  assert.equal(D.timestamp({ fetchedAt: ms }), ms);
  assert.equal(D.toMillis(sec), ms);
  assert.equal(D.toMillis(ms), ms);
  assert.equal(D.status({ detected: true, ok: true, auto: { percent: 10 }, fetchedAt: ms - 2 * 86400000 }, 'cursor'), 'stale');
  assert.equal(D.clock(sec).includes(':'), true);
  assert.equal(D.clock(ms).includes(':'), true);
  assert.equal(D.shouldRefresh(null, { force: false, visible: false }), true);
  assert.equal(D.shouldRefresh({ detected: false, configured: false, ok: true }, { force: false, visible: false }), false);
  assert.equal(D.shouldRefresh({ detected: true, ok: true }, { force: false, visible: false }), true);
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
  D.dashboard({ cursor, codex }, 'small');
  assert.equal(JSON.stringify({ cursor, codex }), snapshot);
});
test('remaining warning thresholds and dashboard urgency use unrounded values', () => {
  for (const [remaining, level] of [[100, 'ok'], [20.1, 'ok'], [20, 'warn'], [10.1, 'warn'], [10, 'critical'], [0, 'critical'], [null, 'ok'], [undefined, 'ok']]) {
    assert.equal(D.level(remaining), level);
  }
  for (const [used, level] of [[79.9, 'ok'], [80, 'warn'], [89.9, 'warn'], [90, 'critical'], [101, 'critical']]) {
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
  assert.equal(D.FALLBACK.miniBody, '尚未检测到已连接的 AI 工具');
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
test('registry catalogs eight providers and dynamic model rows participate in remaining quota', () => {
  assert.deepEqual(D.registry.ids(), ['cursor', 'codex', 'claude', 'grokbot', 'grok', 'copilot', 'antigravity', 'manus']);
  assert.equal(D.registry.get('cursor').pools.length, 2);
  assert.equal(D.registry.get('grokbot').capabilities.completion, 'unsupported');
  assert.deepEqual(D.registry.completionIds(), ['cursor', 'codex', 'claude', 'grok', 'copilot', 'antigravity', 'manus']);
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

test('balances and unlimited windows never manufacture a percent or a minimum', () => {
  for (const [id, window] of [['grok', { currency: 'USD', balance: 12, percent: 100 }], ['manus', { unit: 'credits', balance: 80, percent: 100 }], ['copilot', { unlimited: true, percent: 100 }]]) {
    assert.equal(D.lowestRemaining({ ok: true, primary: window }, id), null);
  }
  assert.equal(D.lowestRemaining({ windows: [{ unlimited: true, percent: 100 }, { percent: 30 }] }, 'copilot'), 70);
});
