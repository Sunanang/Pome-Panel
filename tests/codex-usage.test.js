'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { codexHomes, parseUsageLine, withExpiry, readLatestUsage, readCodexUsage } = require('../codex-usage');
const timestamp = '2026-10-09T03:53:00Z';
const seconds = Date.parse(timestamp) / 1000;
function line(limits, time = timestamp) {
  return JSON.stringify({ timestamp: time, type: 'event_msg', payload: { type: 'token_count', rate_limits: limits } });
}
const limits = { primary: { used_percent: 86, window_minutes: 300, resets_at: seconds + 3600 },
  secondary: { used_percent: 15, window_minutes: 10080, resets_at: seconds + 86400 },
  plan_type: 'plus', credits: { has_credits: true, unlimited: false, balance: '12.5' } };
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pome-codex-usage-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'sessions', '2026', '10', '09');
  await fs.mkdir(dir, { recursive: true });
  return { home, dir };
}
test('Codex parses current windows, plan and credits using the record time', () => {
  const result = parseUsageLine(line(limits));
  assert.equal(result.primary.percent, 86);
  assert.equal(result.primary.windowMinutes, 300);
  assert.equal(result.secondary.windowMinutes, 10080);
  assert.equal(result.updatedAt, timestamp.replace('Z', '.000Z'));
  assert.deepEqual(result.credits, { hasCredits: true, unlimited: false, balance: 12.5 });
  assert.equal(result.plan, 'plus');
});
test('Codex supports relative resets and evaluates each window expiry independently', () => {
  const result = parseUsageLine(line({ primary: { used_percent: 5, resets_in_seconds: 100 }, secondary: { used_percent: 20, resets_in_seconds: 200 } }));
  assert.equal(result.primary.resetsAt, seconds + 100);
  assert.equal(result.secondary.resetsAt, seconds + 200);
  const expired = withExpiry(result, (seconds + 150) * 1000);
  assert.equal(expired.primary.expired, true);
  assert.equal(expired.secondary.expired, false);
  assert.equal(withExpiry(result, (seconds + 100) * 1000).primary.expired, true);
});
test('null limits, unrelated events, broken lines and invalid timestamps are skipped', () => {
  for (const value of [line(null), '{}', 'broken', line(limits, 'invalid'),
    JSON.stringify({ timestamp, type: 'response_item', payload: { type: 'token_count', rate_limits: limits } })]) {
    assert.equal(parseUsageLine(value), null);
  }
});
test('a non-null latest limits record with unknown windows still wins and never becomes zero usage', () => {
  const result = parseUsageLine(line({ primary: { used_percent: null }, secondary: null, plan_type: 'pro' }));
  assert.equal(result.detected, true);
  assert.equal(result.primary, null);
  assert.equal(result.secondary, null);
  assert.equal(result.plan, 'pro');
});
test('reverse chunk reader preserves split UTF-8 and skips null and truncated tail records', async (t) => {
  const { dir } = await fixture(t);
  const file = path.join(dir, 'rollout-test.jsonl');
  const text = `${line({ ...limits, plan_type: '测试 Plus' })}\r\n${line(null)}\n{"incomplete":`;
  await fs.writeFile(file, text);
  const before = await fs.readFile(file);
  const result = await readLatestUsage(file, { chunkBytes: 7 });
  assert.equal(result.primary.percent, 86);
  assert.equal(result.plan, '测试 Plus');
  assert.deepEqual(await fs.readFile(file), before, 'only reads the session file');
});
test('reverse reader bounds memory for huge irrelevant lines before and after usage', async (t) => {
  const { dir } = await fixture(t);
  const file = path.join(dir, 'rollout-large.jsonl');
  const huge = 'x'.repeat(3 * 1024 * 1024);
  await fs.writeFile(file, `${huge}\n${line(limits)}\n${huge}\n`);
  assert.equal((await readLatestUsage(file)).secondary.percent, 15);
});
test('scan falls back through files and homes without reading auth.json', async (t) => {
  const { home, dir } = await fixture(t);
  const old = path.join(dir, 'rollout-old.jsonl');
  const newer = path.join(dir, 'rollout-new.jsonl');
  await fs.writeFile(old, line(limits));
  await fs.utimes(old, 1, 1);
  await fs.writeFile(newer, `${line(null)}\n`);
  // auth is deliberately unreadable and invalid; detection must rely solely on sessions.
  await fs.writeFile(path.join(home, 'auth.json'), 'must never be parsed', { mode: 0 });
  const result = await readCodexUsage({ homes: [`${home}.missing`, home], now: (seconds + 3601) * 1000 });
  assert.equal(result.detected, true);
  assert.equal(result.primary.expired, true);
  assert.equal(result.secondary.expired, false);
  assert.equal(result.updatedAt, timestamp.replace('Z', '.000Z'));
});
test('newest modified rollout wins; missing local data retains manual configuration', async (t) => {
  const { home, dir } = await fixture(t);
  await fs.writeFile(path.join(dir, 'rollout-a.jsonl'), line(limits));
  await fs.utimes(path.join(dir, 'rollout-a.jsonl'), 1, 1);
  await fs.writeFile(path.join(dir, 'rollout-b.jsonl'), line({ ...limits, primary: { used_percent: 9 } }));
  assert.equal((await readCodexUsage({ homes: [home] })).primary.percent, 9);
  const missing = await readCodexUsage({ homes: [`${home}.missing`], configured: true });
  assert.equal(missing.configured, true);
  assert.equal(missing.detected, false);
  assert.equal(missing.ok, true);
});
test('Windows searches CODEX_HOME and desktop default, macOS follows CODEX_HOME', () => {
  const env = { CODEX_HOME: '/fixture/custom', USERPROFILE: '/fixture/user' };
  assert.deepEqual(codexHomes({ env, home: '/fixture/home', platform: 'win32' }), [path.resolve('/fixture/custom'), path.resolve('/fixture/user/.codex')]);
  assert.deepEqual(codexHomes({ env, home: '/fixture/home', platform: 'darwin' }), [path.resolve('/fixture/custom')]);
  assert.deepEqual(codexHomes({ env: {}, home: '/fixture/home', platform: 'win32' }), [path.resolve('/fixture/home/.codex')]);
});
