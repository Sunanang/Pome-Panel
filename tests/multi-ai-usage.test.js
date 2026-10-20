'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGrokbotUsageService, buildSnapshot: buildGrokbot } = require('../grokbot-usage');
const { createClaudeUsageService, buildSnapshot: buildClaude } = require('../claude-usage');
const { createCopilotUsageService, buildSnapshot: buildCopilot, readGhToken, githubTokenFromHosts } = require('../copilot-usage');
const { createGrokUsageService, buildSnapshot: buildGrok } = require('../grok-usage');
const { createAntigravityUsageService, buildSnapshot: buildAnti } = require('../antigravity-usage');
const { createManusUsageService, buildSnapshot: buildManus, USAGE_URL: MANUS_URL } = require('../manus-usage');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('grokbot maps sand usage into an independent primary pool', () => {
  const snap = buildGrokbot({ usagePercent: 25, nextResetTimestampUtc: 1_700_000_000, grokPlanLabel: 'Sand' }, { email: 'a@b.c' });
  assert.equal(snap.primary.percent, 25);
  assert.equal(snap.ownership, 'cursor-sand');
  assert.equal(snap.plan, 'Sand');
});

test('grokbot service uses Cursor token and never leaks it', async () => {
  const service = createGrokbotUsageService({
    readAuth: () => ({ ok: false, error: 'cursor_token_missing' }),
    fetchImpl: async (_url, options) => {
      assert.match(options.headers.Authorization, /^Bearer /);
      return json({ usagePercent: 40, nextResetTimestampUtc: 1700000000 });
    },
  });
  const result = await service.getUsage({ manualToken: 'secret-token' });
  assert.equal(result.ok, true);
  assert.equal(result.primary.percent, 40);
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('claude usage maps five_hour and seven_day windows', () => {
  const snap = buildClaude({
    five_hour: { utilization: 12, resets_at: '2026-10-19T12:00:00.000Z' },
    seven_day: { utilization: 55, resets_at: '2026-10-26T12:00:00.000Z' },
  });
  assert.equal(snap.windows.length, 2);
  assert.equal(snap.windows[0].percent, 12);
  assert.equal(snap.windows[1].windowMinutes, 10080);
});

test('claude service reads injected auth and fetches oauth usage', async () => {
  const service = createClaudeUsageService({
    readAuth: () => ({ ok: true, token: 'claude-token', source: 'file' }),
    fetchImpl: async (url, options) => {
      assert.match(url, /api\.anthropic\.com\/api\/oauth\/usage/);
      assert.equal(options.headers['anthropic-beta'], 'oauth-2025-04-20');
      return json({ five_hour: { utilization: 8 }, seven_day: { utilization: 20 } });
    },
  });
  const result = await service.getUsage({ force: true });
  assert.equal(result.ok, true);
  assert.equal(result.windows[0].percent, 8);
  assert.equal(JSON.stringify(result).includes('claude-token'), false);
});

test('copilot usage maps premium/chat/completions quotas', () => {
  const snap = buildCopilot({
    quota_snapshots: {
      premium_interactions: { remaining: 20, limit: 100, reset_date: '2026-11-01' },
      chat: { remaining: 50, limit: 100 },
      completions: { remaining: 0, limit: 100 },
    },
  });
  assert.equal(snap.windows.find((w) => w.id === 'premium').percent, 80);
  assert.equal(snap.windows.find((w) => w.id === 'completions').percent, 100);
});

test('copilot service uses manual token fixture', async () => {
  const service = createCopilotUsageService({
    readAuth: () => ({ ok: false, error: 'missing' }),
    fetchImpl: async () => json({ quota_snapshots: { chat: { remaining: 75, limit: 100 } } }),
  });
  const result = await service.getUsage({ manualToken: 'ghp_fixture', force: true });
  assert.equal(result.ok, true);
  assert.equal(result.windows[0].percent, 25);
});

test('grok reads inverted USD cents without inventing a quota', () => {
  const snap = buildGrok({ total: { val: '-2500' }, changes: [] });
  assert.equal(snap.windows[0].percent, null);
  assert.equal(snap.windows[0].balance, 25);
  assert.equal(snap.windows[0].currency, 'USD');
  assert.equal(snap.ownership, 'xai');
  assert.equal(buildGrok({ total: { val: '500' } }).balance, -5);
  assert.equal(buildGrok({ total: { val: '0' } }).balance, 0);
  for (const payload of [{}, { total: {} }, { total: { val: 'bad' } }, { total: { val: '1e3' } }]) assert.throws(() => buildGrok(payload));
});

test('antigravity maps model quotas', () => {
  const snap = buildAnti({ quotas: [{ model: 'flash', used: 30, limit: 100, reset_time: '2026-10-20T00:00:00Z' }] });
  assert.equal(snap.windows[0].percent, 30);
  assert.equal(snap.windows[0].label, 'flash');
});

test('Manus uses official v2 key authentication and authoritative spendable credits', async () => {
  const service = createManusUsageService({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.manus.ai/v2/usage.availableCredits');
    assert.equal(url, MANUS_URL); assert.equal(options.headers['x-manus-api-key'], 'manus-key');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.redirect, 'error');
    return json({ ok: true, data: { total_credits: 40, pro_monthly_credits: 1000, periodic_credits: 20, next_refresh_time: 1700000000 } });
  } });
  const result = await service.getUsage({ manualToken: 'manus-key', force: true });
  assert.equal(result.ok, true); assert.equal(result.credits.available, 40);
  assert.equal(result.windows[0].balance, 40); assert.equal(result.windows[0].percent, null);
  assert.equal(result.windows[0].resetsAt, 1700000000);
  assert(!JSON.stringify(result).includes('manus-key'));
  assert.equal(buildManus({ ok: true, data: { total_credits: 0 } }).credits.available, 0);
  for (const payload of [{}, { ok: true, data: {} }, { ok: true, data: { total_credits: null } }]) assert.throws(() => buildManus(payload));
});

test('Copilot selects only github.com credentials, including enterprise GH_HOST', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-hosts-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.config/gh'), { recursive: true });
  const text = 'enterprise.example:\n    oauth_token: ENTERPRISE_FIXTURE\ngithub.com:\n    oauth_token: "PUBLIC_FIXTURE" # comment\n';
  fs.writeFileSync(path.join(home, '.config/gh/hosts.yml'), text);
  assert.equal(githubTokenFromHosts(text), 'PUBLIC_FIXTURE');
  assert.equal(githubTokenFromHosts('enterprise.example:\n    oauth_token: ENTERPRISE_FIXTURE\n'), '');
  const auth = readGhToken({ home, env: { GH_HOST: 'enterprise.example', GH_TOKEN: 'ENTERPRISE_FIXTURE' }, exec: (_cmd, args, options) => {
    assert.deepEqual(args, ['auth', 'token', '--hostname', 'github.com']);
    assert.equal(options.env.GH_TOKEN, undefined);
    throw new Error('fixture no gh');
  } });
  assert.equal(auth.token, 'PUBLIC_FIXTURE');
});

test('Grok requires a team and pins Management API request and credential', async () => {
  const calls = [];
  const service = createGrokUsageService({ readAuth: () => ({ ok: false }), fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, 'Bearer management-fixture');
    assert.equal(options.redirect, 'error');
    return json({ total: { val: '-1000' }, changes: [] });
  } });
  assert.equal((await service.getUsage({ manualToken: 'management-fixture' })).error, 'grok_team_required');
  assert.equal(calls.length, 0);
  const result = await service.getUsage({ manualToken: 'management-fixture', teamId: 'team-fixture' });
  assert.deepEqual(calls, ['https://management-api.x.ai/v1/billing/teams/team-fixture/prepaid/balance']);
  assert.equal(result.balance, 10);
});

test('Antigravity parses grouped measured buckets and preserves unknown as unavailable', () => {
  const snap = buildAnti({ response: { groups: [
    { displayName: 'Gemini Models', buckets: [
      { bucketId: 'weekly', displayName: 'Weekly', remaining: { remainingFraction: 0.75 }, resetTime: '2026-10-26T00:00:00Z' },
      { bucketId: '5h', remainingFraction: 0 },
      { bucketId: 'unknown', remaining: {} },
      { bucketId: 'disabled', enabled: false, remainingFraction: 1 },
    ] },
    { displayName: 'Claude and GPT', buckets: [{ bucketId: 'weekly', remainingFraction: 1 }] },
  ] } });
  assert.equal(snap.windows.length, 3);
  assert.equal(snap.windows[0].percent, 25);
  assert.equal(snap.windows[0].windowMinutes, 10080);
  assert.equal(snap.windows[1].percent, 100);
  assert.equal(snap.windows[1].windowMinutes, 300);
  assert.notEqual(snap.windows[0].id, snap.windows[2].id);
  for (const payload of [{}, { response: { groups: [] } }, { response: { groups: [{ buckets: [{ remaining: {} }] }] } }]) {
    assert.equal(buildAnti(payload).ok, false);
    assert.equal(buildAnti(payload).error, 'antigravity_quota_unavailable');
  }
});

test('Antigravity resolves project read-only and forwards it to the summary request', async () => {
  const calls = [];
  const service = createAntigravityUsageService({ readAuth: () => ({ ok: true, token: 'fixture' }), fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) }); assert.equal(options.redirect, 'error');
    return json(calls.length === 1 ? { cloudaicompanionProject: { id: 'project-fixture' } }
      : { response: { groups: [{ buckets: [{ remainingFraction: 0.5 }] }] } });
  } });
  assert.equal((await service.getUsage()).ok, true);
  assert.equal(calls[0].url, 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist');
  assert.equal(calls[1].url, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary');
  assert.deepEqual(calls[1].body, { project: 'project-fixture' });
});

for (const [name, create, body] of [
  ['Copilot', createCopilotUsageService, { quota_snapshots: { chat: { remaining: 50, limit: 100 } } }],
  ['Grok', createGrokUsageService, { total: { val: '-1000' } }],
  ['Antigravity', createAntigravityUsageService, { response: { groups: [{ buckets: [{ remainingFraction: 0.5 }] }] } }],
  ['Manus', createManusUsageService, { ok: true, data: { total_credits: 60 } }],
]) for (const status of [401, 403]) {
  test(`${name}: ${status} clears success cache; later outage cannot revive invalid credentials`, async () => {
    let phase = 'success';
    const service = create({ readAuth: () => ({ ok: true, token: 'fixture', projectId: 'p', teamId: 'team' }), fetchImpl: async () => {
      if (phase === 'network') throw new Error('fixture offline');
      return json(body, phase === 'invalid' ? status : 200);
    } });
    const options = { force: true, teamId: 'team', ...(name === 'Manus' ? { manualToken: 'fixture' } : {}) };
    assert.equal((await service.getUsage(options)).ok, true);
    phase = 'network'; assert.equal((await service.getUsage(options)).stale, true);
    phase = 'invalid'; assert.equal((await service.getUsage(options)).ok, false);
    phase = 'network';
    const failed = await service.getUsage(options);
    assert.equal(failed.ok, false); assert.equal(failed.stale, undefined); assert.equal(failed.manualTokenInvalid, true);
    phase = 'success';
    const recovered = await service.getUsage(options);
    assert.equal(recovered.ok, true); assert(!recovered.manualTokenInvalid);
  });
}

test('Copilot finite quotas exclude unlimited buckets and inherit root UTC reset', () => {
  const payload = require('./fixtures/ai-usage/copilot-unlimited.json');
  const snapshot = buildCopilot(payload);
  assert.equal(snapshot.unlimited, false);
  assert.deepEqual(snapshot.windows.map(w => [w.id, w.percent, w.resetsAt]), [
    ['premium', 75, Date.parse(payload.quota_reset_date_utc) / 1000],
  ]);
  assert.equal(buildCopilot({ ...payload, quota_reset_date_utc: undefined }).windows[0].resetsAt, Date.parse(payload.quota_reset_date) / 1000);
  const ownReset = 1794000000;
  const override = buildCopilot({ ...payload, quota_snapshots: { premium_interactions: { ...payload.quota_snapshots.premium_interactions, quota_reset_at: ownReset } } });
  assert.equal(override.windows[0].resetsAt, ownReset);
  assert.equal(buildCopilot({ quota_reset_date_utc: 'invalid', quota_snapshots: { chat: { remaining: 0, entitlement: 100 } } }).windows[0].resetsAt, null);
});

test('Copilot all-unlimited has no false exhausted or critical window', () => {
  const data = buildCopilot({ quota_snapshots: { chat: { unlimited: true, remaining: 0, entitlement: 0, percent_remaining: 0 }, completions: { unlimited: true } } });
  assert.equal(data.unlimited, true); assert.deepEqual(data.windows, []);
  const domain = require('../renderer/ai-usage-domain');
  assert.equal(domain.lowestRemaining(data, 'copilot'), null);
  assert.equal(domain.level(domain.lowestRemaining(data, 'copilot')), 'ok');
  assert.equal(buildCopilot({}).unlimited, false, 'missing fields do not imply unlimited');
});

test('Grok Bot ISO and epoch timestamps retain precision and drive reset refresh scheduling', () => {
  const payload = require('./fixtures/ai-usage/grokbot-iso.json');
  const snapshot = buildGrokbot(payload, {});
  assert.equal(snapshot.primary.resetsAt, Date.parse(payload.nextResetTimestampUtc) / 1000);
  assert.equal(snapshot.periodStart, payload.currentPeriodStart);
  const stamp = Date.parse(payload.nextResetTimestampUtc);
  for (const value of [stamp, stamp / 1000, String(stamp), String(stamp / 1000)]) {
    const parsed = buildGrokbot({ ...payload, nextResetTimestampUtc: value, currentPeriodStart: value }, {});
    assert.equal(parsed.primary.resetsAt, stamp / 1000);
    assert.equal(parsed.periodStart, payload.nextResetTimestampUtc);
  }
  for (const value of [undefined, null, false, '', 'not-a-time', 0]) {
    const unknown = buildGrokbot({ nextResetTimestampUtc: value, currentPeriodStart: value, usagePercent: 0 }, {});
    assert.equal(unknown.primary.resetsAt, null); assert.equal(unknown.periodStart, null); assert.equal(unknown.primary.percent, 0);
  }
  const now = Date.now(), future = new Date(now + 10000).toISOString();
  const scheduled = buildGrokbot({ ...payload, nextResetTimestampUtc: future }, {});
  assert.equal(require('../renderer/ai-usage-domain').refreshDelay({ grokbot: scheduled }, true, now), 11000);
});

test('Antigravity handles all summary wrappers, aliases and tagged remaining fractions', () => {
  const payload = require('./fixtures/ai-usage/antigravity-summary.json');
  for (const body of [payload, { response: payload.summary }, payload.summary]) {
    const data = buildAnti(body);
    assert.equal(data.ok, true); assert.equal(data.windows.length, 2);
    assert.equal(data.windows[0].percent, 25);
    assert.equal(data.windows[0].label, 'Gemini Models · Weekly Limit');
    assert.equal(data.windows[0].resetsAt, Date.parse('2026-11-01T00:00:00Z') / 1000);
    assert.equal(data.windows[1].percent, 100, 'known zero remaining is exhausted');
  }
  for (const remaining of [{ case: 'remainingFraction', value: null }, { case: 'unknown', value: 0.75 }, { case: 'remainingFraction' }, { case: 'remainingFraction', value: false }]) {
    const data = buildAnti({ summary: { groups: [{ buckets: [{ bucketId: 'unknown', remaining }] }] } });
    assert.equal(data.ok, false); assert.deepEqual(data.windows, []);
  }
});
