'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/ai-usage-domain');
const absent = { ok: true, detected: false, configured: false };
const cursor = { detected: true, auto: { percent: 30 }, other: { percent: 45 } };
const codex = { detected: true, primary: { percent: 86 }, secondary: { percent: 15 } };
const grokbot = { detected: true, ok: true, primary: { percent: 90 } };
test('an invalid manual Codex token does not hide usable local quotas or their stale state', () => {
  const local = { ok: true, detected: true, authSource: 'local', manualTokenInvalid: true,
    primary: { percent: 30 }, updatedAt: new Date().toISOString() };
  assert.equal(D.invalidToken(local), true, 'settings still need to repair the saved token');
  assert.equal(D.status(local, 'codex'), 'ok');
  assert.equal(D.status({ ...local, stale: true }, 'codex'), 'stale');
  assert.equal(D.status({ ...local, primary: null }, 'codex'), 'error');
  assert.equal(D.status({ ...local, ok: false }, 'codex'), 'error');
});
test('AI usage four visibility combinations and titles have no empty provider', () => {
  for (const [snapshots, ids, title] of [
    [{ cursor: absent, codex: absent }, [], 'AI 额度'],
    [{ cursor, codex: absent }, ['cursor'], 'AI 额度'],
    [{ cursor: absent, codex }, ['codex'], 'AI 额度'],
    [{ cursor, codex }, ['cursor', 'codex'], 'AI 额度'],
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
  assert.equal(D.dashboard(snapshots, 'small').shown.length, 4);
  assert.equal(D.dashboard({cursor,codex}, 'small').columns, 2);
  for (const size of ['medium', 'large']) assert.deepEqual(D.dashboard(snapshots, size).shown, ['cursor', 'codex', 'claude', 'grokbot', 'grok']);
  assert.equal(D.dashboard(snapshots, 'medium').columns, 3);
  assert.equal(D.dashboard(snapshots, 'medium').rows, 2);
  assert.equal(D.dashboard(snapshots, 'large').columns, 3);
  assert.equal(D.dashboard(snapshots, 'large').rows, 2);
  assert.equal(D.dashboard(snapshots, 'large').summary, false);
  delete snapshots.grok;
  assert.equal(D.dashboard(snapshots, 'mini').shown.length, 4);
  assert.equal(D.dashboard(snapshots, 'mini').hidden.length, 0);
  assert.equal(D.dashboard(snapshots, 'large').summary, false, 'four sources stay without a summary cell');
  const six = D.dashboard({ cursor, codex, claude: { detected: true }, grokbot, grok: { configured: true }, copilot: { detected: true } }, 'large');
  assert.equal(six.summary, false);
  assert.equal(six.rows, 2);
});
test('compact urgency ranks invalid, depleted, critical, warn, stale, normal by the bottleneck', () => {
  const snapshots = {
    cursor: { ...cursor, auto: { percent: 40 }, other: { percent: 0 } },
    codex: { ...codex, primary: { percent: 0 }, secondary: { percent: 0 } },
    claude: { detected: true, primary: { percent: 80 } },
    grokbot: { ...grokbot, primary: { percent: 95 } },
    grok: { configured: true, ok: false, status: 401 },
    copilot: { detected: true, windows: [{ percent: 39.9 }] },
    antigravity: { detected: true, stale: true, windows: [{ percent: 99 }] },
  };
  assert.deepEqual(D.dashboard(snapshots, 'small').ids, ['grok', 'antigravity', 'grokbot', 'claude', 'cursor', 'copilot', 'codex']);
  assert.equal(D.status({ detected: false, configured: false }, 'manus'), 'undetected');
  assert.equal(D.status({ ...cursor, manualTokenInvalid: true }, 'cursor'), 'error');
  assert.equal(D.status({ ...cursor, fetchedAt: '2020-01-01T00:00:00Z' }, 'cursor'), 'stale');
  assert.equal(D.status({ configured: true, ok: true, primary: { currency: 'USD', balance: 0 } }, 'grok'), 'depleted');
  assert.equal(D.urgencyRemaining({ configured: true, ok: true, primary: { unit: 'credits', balance: 0 } }, 'manus'), 0);
  const balances = { grok: { configured: true, ok: true, primary: { currency: 'USD', balance: 0 } }, manus: { configured: true, ok: true, primary: { unit: 'credits', balance: 0 } } };
  assert.deepEqual(D.dashboard({ ...snapshots, ...balances }, 'small').shown.slice(0,3), ['grok', 'manus', 'antigravity'], 'exhausted balances precede low quota while invalid remains the highest priority');
  assert.equal(D.status({ ...balances.grok, primary: { currency: 'USD', balance: 1 } }, 'grok'), 'ok');
  assert.equal(D.status({ ...balances.manus, stale: true }, 'manus'), 'depleted');
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
  assert.equal(D.displayRemaining(cursor, 'cursor'), 70);
  assert.equal(D.displayRemaining(codex, 'codex'), 14);
  D.dashboard({ cursor, codex }, 'small');
  assert.equal(JSON.stringify({ cursor, codex }), snapshot);
});
test('remaining warning thresholds and dashboard urgency use unrounded values', () => {
  for (const [remaining, level] of [[100, 'ok'], [20.1, 'ok'], [20, 'warn'], [10.1, 'warn'], [10, 'critical'], [0, 'critical'], [null, 'ok'], [undefined, 'ok']]) {
    assert.equal(D.level(remaining), level);
  }
  for (const [used, level] of [[79.9, 'ok'], [80, 'warn'], [89.9, 'warn'], [90, 'critical'], [101, 'critical']]) {
    assert.equal(D.level(D.displayRemaining({ primary: { percent: used } }, 'codex')), level);
    assert.equal(D.level(D.displayRemaining({ auto: { percent: used } }, 'cursor')), level);
  }
  assert.equal(D.displayRemaining({}, 'codex'), null);
  assert.equal(D.displayRemaining({ ok: false, primary: { percent: 100 } }, 'codex'), null);
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
  assert.equal(D.windowLabel({ windowMinutes: 10080 }), '周额度');
  assert.equal(D.windowLabel({ windowMinutes: 300 }), '5 小时额度');
  assert.equal(D.windowLabel({ windowMinutes: 60 }), '1 小时额度');
  assert.equal(D.windowLabel({ windowMinutes: 1440 }), '日额度');
  const rows = D.quotaRows({ primary: { percent: 20, windowMinutes: 10080 }, secondary: null }, 'codex');
  assert.equal(rows.length, 1); assert.equal(rows[0].name, '周额度');
  assert.equal(D.quotaRows({ primary: {} }, 'codex')[0].name, '主要额度');
});
test('registry catalogs eight providers and dynamic model rows participate in remaining quota', () => {
  assert.deepEqual(D.registry.ids(), ['cursor', 'codex', 'claude', 'grokbot', 'grok', 'copilot', 'antigravity', 'manus']);
  assert.equal(D.registry.get('cursor').pools.length, 2);
  assert.equal(D.registry.get('copilot').label, 'Copilot');
  assert.equal(D.registry.get('grokbot').capabilities.completion, 'unsupported');
  assert.deepEqual(D.registry.completionIds(), ['cursor', 'codex', 'claude', 'grok', 'copilot', 'antigravity', 'manus']);
  const data = { windows: [{ id: 'spark', label: 'Spark', percent: 98, windowMinutes: 300 }] };
  assert.equal(D.quotaRows(data, 'codex')[0].name, 'Spark · 5 小时额度');
  assert.equal(D.displayRemaining(data, 'codex'), 2);
});
test('quota refresh adapts to reset time and visibility without retrying expired snapshots in a loop', () => {
  const data = { codex: { primary: { resetsAt: 1001 } } };
  assert.equal(D.refreshDelay(data, true, 1000000), 2000);
  assert.equal(D.refreshDelay(data, false, 1000000), 900000);
  assert.equal(D.refreshDelay(data, true, 1002000), 300000);
});

test('balances and unlimited windows never manufacture a percent or a minimum', () => {
  for (const [id, window] of [['grok', { currency: 'USD', balance: 12, percent: 100 }], ['manus', { unit: 'credits', balance: 80, percent: 100 }], ['copilot', { unlimited: true, percent: 100 }]]) {
    assert.equal(D.displayRemaining({ ok: true, primary: window }, id), null);
  }
  assert.equal(D.displayRemaining({ windows: [{ unlimited: true, percent: 100 }, { percent: 30 }] }, 'copilot'), 70);
});


test('dashboard selects the smallest reported time window rather than the lowest remaining value', () => {
  const data = { detected: true, primary: { percent: 20, windowMinutes: 300 }, secondary: { percent: 99, windowMinutes: 10080 } };
  const original = JSON.stringify(data);
  assert.equal(D.displayRow(data, 'codex').key, 'primary');
  assert.equal(D.displayRemaining(data, 'codex'), 80);
  assert.equal(D.status(data, 'codex'), 'critical');
  assert.equal(D.displayRemaining({ ...data, secondary: { ...data.secondary, percent: 100 } }, 'codex'), 80);
  assert.equal(JSON.stringify(data), original, 'selection must not mutate source data');
  const reversed = { ...data, primary: data.secondary, secondary: data.primary };
  assert.equal(D.displayRow(reversed, 'codex').key, 'secondary');
  assert.equal(D.displayRemaining(reversed, 'codex'), 80, 'primary/secondary order cannot override measured cadence');
  const models = { windows: [{ id: 'week', percent: 99, windowMinutes: 10080 }, { id: 'five-hour', percent: 10, windowMinutes: 300 }, { id: 'other-five-hour', percent: 95, windowMinutes: 300 }] };
  assert.equal(D.displayRow(models, 'codex').key, 'five-hour');
  assert.equal(D.displayRemaining(models, 'codex'), 90, 'equal windows retain source order without falling back to the lowest balance');
});

test('bottleneck drives urgency and expiry independently of the displayed window', () => {
  const now = Date.now();
  const codex = { detected: true, primary: { percent: 20, windowMinutes: 300, resetsAt: (now + 3600000) / 1000 }, secondary: { percent: 99, windowMinutes: 10080, resetsAt: (now - 1000) / 1000 } };
  assert.equal(D.status(codex, 'codex', now), 'critical', 'critical is more urgent than freshness'
  );
  assert.equal(D.isStale(codex, 'codex', now), true, 'the bottleneck reset still controls freshness');
  assert.equal(D.urgencyRemaining(codex, 'codex'), 1);
  assert.deepEqual(D.dashboard({ codex, claude: { detected: true, primary: { percent: 85, windowMinutes: 300 } } }, 'small', now).shown, ['codex', 'claude']);
  const depleted = { ...codex, primary: { ...codex.primary, percent: 95 } };
  assert.equal(D.status(depleted, 'codex', now), 'critical');
  assert.equal(D.displayRemaining({ ...codex, primary: { ...codex.primary, percent: null } }, 'codex'), null, 'missing five-hour usage stays unknown instead of substituting the week');
  assert.equal(D.isStale({ ...codex, primary: { ...codex.primary, resetsAt: (now - 1000) / 1000 } }, 'codex', now), true);
});

test('weekly-only and unknown-cadence sources keep a stable reported scope', () => {
  assert.equal(D.displayRemaining({ primary: { percent: 60, windowMinutes: 10080 } }, 'codex'), 40);
  assert.equal(D.displayRow({ primary: { windowMinutes: null }, secondary: { windowMinutes: 0 } }, 'codex').key, 'primary');
  assert.equal(D.displayRemaining({ auto: { percent: 20 }, other: { percent: 99 } }, 'cursor'), 80);
  assert.equal(D.displayRow({ windows: [{ id: 'invalid', windowMinutes: -1 }, { id: 'short', windowMinutes: '300' }, { id: 'bad', windowMinutes: 'invalid' }] }, 'antigravity').key, 'short');
  assert.equal(D.displayRow({}, 'codex'), null);
  assert.equal(D.displayRow({ auto: null, other: { percent: 25 } }, 'cursor').key, 'other');
});


test('all reset labels use minute precision even when the timestamp includes seconds', () => {
  const now = new Date(2026, 9, 28, 8).getTime();
  const reset = new Date(2026, 9, 28, 13, 4, 9).getTime();
  assert.equal(D.resetText({ resetsAt: reset / 1000 }, now), '13:04 重置');
  assert.equal(D.clock(reset), '13:04');
  assert.equal(D.resetText({ resetsAt: 'invalid' }, now), '重置时间未知');
});


test('a full five-hour ring can be constrained by a depleted weekly quota', () => {
  const data = { ok: true, detected: true, primary: { percent: 0, windowMinutes: 300 }, secondary: { percent: 100, windowMinutes: 10080, resetsAt: 2000000000 } };
  assert.equal(D.displayRemaining(data, 'codex'), 100);
  assert.equal(D.urgencyRemaining(data, 'codex'), 0);
  assert.equal(D.status(data, 'codex', 1000000000), 'depleted');
  const b = D.bottleneckInfo(data, 'codex');
  assert.equal(b.name, '周');assert.equal(b.remaining, 0);assert.equal(b.badge, true);assert.equal(b.resetAt, 2000000000000);
  assert.equal(D.bottleneckInfo({ ...data, secondary: { ...data.secondary, resetsAt: null } }, 'codex').resetAt, null);
});
test('recovery copy uses weekday within a week and calendar dates beyond', () => {
  const I = require('../localization/runtime'), before = I.getState();
  const now = new Date(2026, 9, 21, 8).getTime();
  const later = new Date(2026, 9, 26, 16, 58, 42).getTime();
  const monthLater = new Date(2026, 10, 18, 16, 58, 42).getTime();
  const nextYear = new Date(2027, 0, 7, 9, 30).getTime();
  try {
    for (const locale of ['zh-CN', 'en-US']) {
      I.setState(I.snapshot(locale, [locale]));
      assert.equal(D.recoveryTime(now, now), '08:00');
      assert.equal(D.recoveryTime(later, now), locale === 'zh-CN' ? '周一 16:58' : 'Mon 16:58');
      assert.equal(D.recoveryTime(monthLater, now), '11/18 16:58');
      assert.equal(D.recoveryTime(nextYear, now), '2027/1/7 09:30');
      assert.equal(D.recoveryTime(later, now, { compact: true }), locale === 'zh-CN' ? '周一 16:58' : 'Mon 16:58');
      assert.equal(D.recoveryTime(monthLater, now, { compact: true }), '11/18');
      assert.equal(D.recoveryTime(nextYear, now, { compact: true }), '2027/1/7');
      assert.equal(D.recoveryTime(null, now), '');
    }
  } finally { I.setState({ ...before, revision: I.getState().revision + 1 }); }
});
test('mini summarizes multiple, all, mixed and critical constraints without invented reset times', () => {
  const now = new Date(2026, 9, 21, 8).getTime(), later = now + 86400000;
  const data = remaining => ({ ok:true, detected:true, primary: { percent:0, windowMinutes:300 }, secondary: { percent:100-remaining, windowMinutes:10080, resetsAt:later } });
  const all = { claude:data(0), codex:data(0), cursor:{ok:true, detected:true, auto:{percent:0}} };
  assert.match(D.miniSummary(all, now).text, /^2 家额度 0% · 最早/);
  assert.match(D.miniSummary({claude:data(0),codex:data(0)}, now).text, /^全部额度 0% · 最早/);
  assert.equal(D.miniSummary({claude:data(0),codex:data(6)}, now).text, 'Claude 0% · 另 1 家告急');
  assert.equal(D.miniSummary({claude:data(8),codex:data(6)}, now).text, '2 家告急 · 最低 Codex 6%');
  const noTime={...data(0),secondary:{percent:100,windowMinutes:10080}};
  assert.equal(D.miniSummary({codex:noTime}, now).text, '全部额度 0%');
  assert.equal(D.bottleneckInfo(noTime,'codex').resetAt, null);
});
test('Cursor same-cycle pools have no corner badge, but Other still constrains tone and order', () => {
  const data={ok:true,detected:true,auto:{percent:0,windowMinutes:43200},other:{percent:100,windowMinutes:43200}};
  assert.equal(D.bottleneckInfo(data,'cursor').badge,false);
  assert.equal(D.bottleneckInfo(data,'cursor').name,'Other');assert.equal(D.status(data,'cursor'),'depleted');
  assert.equal(D.bottleneckInfo({...data,other:{percent:100,windowMinutes:86400}},'cursor').badge,true);
  const snapshots={cursor:data,codex:{detected:true,primary:{percent:95}},claude:{detected:true,primary:{percent:81}}};
  assert.deepEqual(D.dashboard(snapshots,'mini').ids,['cursor','codex','claude']);
  assert.deepEqual(D.dashboard(snapshots,'large').ids,['cursor','codex','claude']);
});


test('provider names share one quota vocabulary without losing pool identities or inventing cadence', () => {
  const claude=require('../claude-usage').buildSnapshot({five_hour:{utilization:20},seven_day:{utilization:40}});
  assert.deepEqual(D.quotaRows(claude,'claude').map(r=>[r.name,r.short]),[['5 小时额度','5h'],['周额度','周']]);
  assert.equal(D.quotaRows({primary:{percent:20,windowMinutes:10080}},'codex')[0].name,'周额度');
  const bot=require('../grokbot-usage').buildSnapshot({usagePercent:20},{});
  assert.equal(D.quotaRows(bot,'grokbot')[0].name,'周额度');assert.equal(D.bottleneckInfo(bot,'grokbot').name,'周');
  const cursor={auto:{percent:20},other:{percent:40},billing:{cycleStart:'2026-10-01T00:00:00Z',cycleEnd:'2026-11-01T00:00:00Z'}};
  assert.deepEqual(D.quotaRows(cursor,'cursor').map(r=>[r.name,r.short,r.scopeShort]),[['Cursor · 月额度','Cursor','月'],['Other · 月额度','Other','月']]);
  assert.equal(D.quotaRows(cursor,'cursor')[0].windowUsage.windowMinutes,44640,'actual measured duration stays intact');
  assert.deepEqual(D.quotaRows({windows:[{id:'premium',label:'Premium',percent:30},{id:'chat',label:'Chat',percent:30},{id:'completions',label:'Completions',percent:30}]},'copilot').map(r=>r.name),['高级请求额度','聊天额度','补全额度']);
  assert.equal(D.quotaRows({windows:[{id:'model',label:'Gemini · Weekly',windowMinutes:10080,percent:20}]},'antigravity')[0].name,'Gemini · 周额度');
  assert.equal(D.quotaRows({windows:[{id:'model',label:'Gemini',percent:20}]},'antigravity')[0].name,'Gemini额度');
  assert.equal(D.quotaRows({windows:[{label:'Quota 1',percent:20}]},'antigravity')[0].name,'额度 1');
  assert.equal(D.quotaRows({primary:{currency:'USD',balance:10}},'grok')[0].name,'已入账预付余额');
  assert.equal(D.quotaRows({windows:[{unit:'credits',balance:100,label:'Credits'}]},'manus')[0].name,'可用积分');
  assert.equal(D.windowLabel({period:'month'}),'月额度');assert.equal(D.windowShortLabel({period:'month'}),'月');
});


test('final grids keep four urgent small sources and all larger sources, equal columns and no filler tile', () => {
  for (const count of [3,4,5,6]) {
    const data=Object.fromEntries(D.registry.ids().slice(0,count).map(id=>[id,{ok:true,detected:true,primary:{percent:30}}]));
    for(const size of ['small','medium','large']) {
      const layout=D.dashboard(data,size);
      assert.equal(layout.shown.length,size==='small'?Math.min(4,count):count);
      assert.equal(layout.columns,size==='small'?2:count<=4?count:3);
      assert.equal(layout.rows,Math.ceil(layout.shown.length/layout.columns));
      assert.equal(layout.summary,false);
    }
    assert.equal(D.dashboard(data,'small').ringSize,38);
    assert.equal(D.dashboard(data,'medium').ringSize,count===3?72:count===4?60:32);
    assert.equal(D.dashboard(data,'large').ringSize,count===3?140:count===4?120:80);
  }
});
test('invalid mini summary wins over depleted and critical without replacing the shortest window', () => {
  const data = value => ({ok:true,detected:true,primary:{percent:0,windowMinutes:300},secondary:{percent:100-value,windowMinutes:10080}});
  const snapshots={codex:data(6),claude:data(0),copilot:{ok:false,configured:true,status:401}};
  const summary=D.miniSummary(snapshots);
  assert.deepEqual(summary,{text:'Copilot 失效 · 去设置',severity:'error',repair:'copilot'});
  assert.equal(D.dashboard(snapshots,'mini').shown[0],'copilot');
  delete snapshots.copilot;
  assert.equal(D.miniSummary(snapshots).text,'Claude 0% · 另 1 家告急');
  assert.equal(D.displayRemaining(snapshots.claude,'claude'),100);
});
test('freshness retains its existing age threshold and gray age copy independently of urgency', () => {
  const now=Date.now(), source={ok:true,detected:true,fetchedAt:new Date(now-3*3600000).toISOString(),primary:{percent:20}};
  assert.equal(D.isStale(source,'codex',now),false);
  assert.equal(D.isStale(source,'codex',now+22*3600000),true);
  assert.equal(D.staleSummary({codex:source},false,now).text,'');
  const stale={...source,stale:true};
  assert.equal(D.staleSummary({codex:stale},false,now).text,'数据已过期 · 3 小时前');
  assert.equal(D.miniSummary({codex:stale},now).text,'已过期 3 小时');
  assert.equal(D.status({...stale,primary:{percent:100}},'codex',now),'depleted');
  assert.equal(D.status({...stale,primary:{percent:94}},'codex',now),'critical');
  assert.equal(D.status({...stale,primary:{percent:82}},'codex',now),'warn');
  assert.equal(D.status({...stale,manualTokenInvalid:true,primary:{percent:100}},'codex',now),'error');
  assert.equal(D.staleSummary({codex:{...stale,fetchedAt:null}},true,now).hours,null,'unknown age is not invented');
});

test('failed requests differ from expired credentials in mini summaries in both languages', () => {
  const I=require('../localization/runtime');
  for (const [locale,failed,invalid] of [['zh-CN','Cursor 获取失败 · 重试','Copilot 失效 · 去设置'],['en-US','Cursor failed · Retry','Copilot invalid · Settings']]) {
    I.setState(I.snapshot(locale,[locale]));
    const network={ok:false,detected:true,error:'network'};
    assert.deepEqual(D.miniSummary({cursor:network}),{text:failed,severity:'error',retry:'cursor'});
    assert.equal(D.miniSummary({cursor:network,copilot:{ok:false,configured:true,status:401}}).text,invalid,'credential failures retain the highest repair priority');
  }
  I.setState(I.snapshot('zh-CN',['zh-CN']));
});
test('recent stale data never claims zero hours or invents an unknown age', () => {
  const I=require('../localization/runtime'),now=Date.now();
  const source={ok:true,detected:true,stale:true,fetchedAt:new Date(now-20*60000).toISOString(),primary:{percent:20}};
  for (const locale of ['zh-CN','en-US']) {
    I.setState(I.snapshot(locale,[locale]));
    for(const compact of [true,false]) {
      const recent=D.staleSummary({codex:source},compact,now);
      assert.equal(recent.hours,0);
      assert.match(recent.text,locale==='zh-CN'?/不足 1 小时/:/<1h/);
      assert.doesNotMatch(recent.text,/0 小时|0h/);
      const hour=D.staleSummary({codex:{...source,fetchedAt:new Date(now-3600000).toISOString()}},compact,now);
      assert.match(hour.text,locale==='zh-CN'?/1 小时/:/1h/);
      assert.equal(D.staleSummary({codex:{...source,fetchedAt:null}},compact,now).text,I.t('quota.stale'));
    }
  }
  I.setState(I.snapshot('zh-CN',['zh-CN']));
});

test('quota percentages use the same terse copy at zero and above zero, without changing balance units', () => {
  const I=require('../localization/runtime');
  for(const locale of ['zh-CN','en-US']) {
    I.setState(I.snapshot(locale,[locale]));
    const name=locale==='zh-CN'?'周':'Week';
    assert.doesNotMatch(I.t('quota.windowRemaining',{source:'Codex',window:name,remaining:'18%',message:''}),/剩|remaining/i);
    const balance={ok:true,configured:true,primary:{currency:'USD',balance:0}};
    assert.doesNotMatch(D.miniSummary({grok:balance}).text,/%|已用完/,'a currency amount has no fabricated percentage denominator');
    assert.doesNotMatch(D.miniSummary({grok:balance,codex:{ok:true,detected:true,primary:{percent:95}}}).text,/%|已用完/,'mixed monetary and critical quotas retain their units');
  }
  I.setState(I.snapshot('zh-CN',['zh-CN']));
});

test('v9 compact rows omit the shortest window and single-window duplication, keeping genuine large rows', () => {
  const data={ok:true,detected:true,primary:{percent:0,windowMinutes:300},secondary:{percent:100,windowMinutes:10080,resetsAt:2000000000}};
  for(const size of ['small','medium'])assert.deepEqual(D.inlineRows(data,'codex',size).map(row=>row.key),['secondary']);
  assert.deepEqual(D.inlineRows(data,'codex','large').map(row=>row.key),['primary','secondary']);
  const single={ok:true,detected:true,primary:{percent:20,windowMinutes:10080}};
  for(const size of ['small','medium'])assert.deepEqual(D.inlineRows(single,'grokbot',size),[]);
  assert.equal(D.inlineRows(single,'grokbot','large').length,1);
  const cursor={ok:true,detected:true,auto:{percent:0,windowMinutes:43200},other:{percent:100,windowMinutes:43200}};
  assert.deepEqual(D.inlineRows(cursor,'cursor','small').map(row=>row.key),['other']);
  for(const size of ['small','medium','large'])assert.deepEqual(D.inlineRows({...data,manualTokenInvalid:true},'codex',size),[]);
  assert.equal(D.displayRemaining(data,'codex'),100);assert.equal(D.status(data,'codex'),'depleted');
});
test('v9 small keeps the four most urgent providers while mini ordering and wider settings order remain intact', () => {
  const data={cursor:{ok:true,detected:true,auto:{percent:10}},codex:{ok:true,detected:true,primary:{percent:100}},claude:{ok:true,detected:true,primary:{percent:95}},grokbot:{ok:true,detected:true,primary:{percent:81}},copilot:{ok:false,configured:true,status:401},antigravity:{ok:true,detected:true,primary:{percent:40}}};
  assert.deepEqual(D.dashboard(data,'small').shown,['copilot','codex','claude','grokbot']);
  assert.equal(D.dashboard(data,'small').hidden.length,2);
  assert.deepEqual(D.dashboard(data,'mini').shown,['copilot','codex','claude']);
  assert.deepEqual(D.dashboard(data,'medium').shown,D.providers(data));
});


test('Cursor pool display names and abbreviations preserve API keys across languages', () => {
  const I=require('../localization/runtime');
  const data={ok:true,detected:true,auto:{percent:0,windowMinutes:43200},other:{percent:100,windowMinutes:43200}};
  try {
    for(const locale of ['zh-CN','en-US']) {
      I.setState(I.snapshot(locale,[locale]));
      const rows=D.quotaRows(data,'cursor');
      assert.deepEqual(rows.map(r=>[r.key,r.short,r.compactShort]),[['auto','Cursor','Cur'],['other','Other','Oth']]);
      assert.equal(D.displayRow(data,'cursor').key,'auto');
      assert.equal(D.displayRemaining(data,'cursor'),100);
      assert.equal(D.bottleneckInfo(data,'cursor').key,'other');
      assert.equal(D.bottleneckInfo(data,'cursor').name,'Other');
      assert.equal(D.status(data,'cursor'),'depleted');
      assert.equal(D.bottleneckInfo(data,'cursor').badge,false);
    }
  } finally { I.setState(I.snapshot('zh-CN',['zh-CN'])); }
});
