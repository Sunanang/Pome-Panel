'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildGateNotification,
  buildGateResolvedNotification,
  expandAgentGateSessionResolution,
  isAgentGateSessionResolution,
  parseArgs,
  postNotification,
  questionFor,
  sessionIdFor,
  slug,
} = require('../scripts/agent-gate-notify');
const { classifyAiEvent } = require('../aiEventPolicy');
const { createAiAttentionStore } = require('../aiAttentionStore');

function ingest(store, payload) {
  const policy = classifyAiEvent(payload, payload.source);
  assert.ok(policy.event);
  if (isAgentGateSessionResolution(policy.event)) {
    const expansions = expandAgentGateSessionResolution(policy.event, store.list());
    const [receipt] = store.applyBatch([policy.event, ...expansions], { dedupeFirst: true });
    if (receipt.duplicate) return { result: 'duplicate' };
    return { result: expansions.length ? 'accepted' : 'ignored' };
  }
  store.apply(policy.event);
  return { result: 'accepted' };
}

test('command-run gate is a valid authorize bubble for Cursor and Codex', () => {
  for (const source of ['cursor', 'codex']) {
    const payload = buildGateNotification({
      source, gate: 'command-run', label: '完整权限命令', now: 1_700_000_000_000, requestId: 'req-1',
    });
    const policy = classifyAiEvent(payload, source);
    assert.equal(policy.category, 'attention');
    assert.equal(policy.event.action, 'approve');
    assert.match(policy.event.question, /点 Run 批准/);
    assert.equal(payload.sessionId, sessionIdFor(source, 'command-run', '完整权限命令'));
  }
});

test('question copy covers each gate type', () => {
  assert.match(questionFor('cursor', 'mcp-auth', 'Notion'), /完成 Notion 授权/);
  assert.match(questionFor('claude', 'permission', '麦克风'), /Claude Code.*权限确认.*麦克风/);
  assert.match(questionFor('codex', 'review', 'Auto-review'), /Codex.*审批.*Auto-review/);
  assert.match(questionFor('cursor', 'attention', '其它'), /处理：其它/);
});

test('cli args accept source, gate, label and resolved', () => {
  assert.deepEqual(parseArgs(['--source', 'codex', '--gate', 'command-run', '--label', 'npm test']), {
    source: 'codex', gate: 'command-run', action: '', label: 'npm test', dryRun: false, resolved: false, help: false,
  });
  assert.equal(parseArgs(['--gate', 'attention', '--action', 'select', '--label', '方案']).action, 'select');
  assert.equal(parseArgs(['--service', 'Drive', '--resolved']).resolved, true);
  assert.equal(parseArgs(['--service', 'Drive', '--resolved']).label, 'Drive');
});

test('Cursor choice (AskQuestion) is a select bubble, not an authorization bubble', () => {
  const payload = buildGateNotification({ source: 'cursor', gate: 'attention', action: 'select', label: '选方案A或B', requestId: 'choice-1' });
  assert.equal(payload.action, 'select');
  assert.match(payload.question, /做选择/);
  const policy = classifyAiEvent(payload, 'cursor');
  assert.equal(policy.category, 'attention');
  assert.equal(policy.event.action, 'select');
  // 同一 attention 标签的 resolve 必须能收起 select 气泡：会话键不随动作变化。
  const done = buildGateResolvedNotification({ source: 'cursor', gate: 'attention', label: '选方案A或B', requestId: 'done' });
  const expanded = expandAgentGateSessionResolution(done, [{ event: payload, firstSeenAt: payload.occurredAt }]);
  assert.equal(expanded.length, 1);
});

test('default action stays approve and invalid action is rejected', () => {
  assert.equal(buildGateNotification({ source: 'cursor', gate: 'command-run', label: 'x' }).action, 'approve');
  assert.throws(() => buildGateNotification({ source: 'cursor', gate: 'attention', action: 'pick', label: 'x' }), /unknown action/);
});

test('unknown source or gate is rejected instead of silently remapped', () => {
  assert.throws(() => buildGateNotification({ source: 'gpt', gate: 'command-run', label: 'x' }), /unknown source/);
  assert.throws(() => buildGateNotification({ source: 'cursor', gate: 'run', label: 'x' }), /unknown gate/);
});

test('cursor mcp-auth shares the legacy session id so either script can resolve', () => {
  const viaGate = buildGateNotification({ source: 'cursor', gate: 'mcp-auth', label: 'Google Drive', requestId: 'a' });
  assert.equal(viaGate.sessionId, 'mcp-auth:google-drive');
  assert.match(viaGate.eventId, /^mcp-auth:google-drive:a$/);
  const legacyOpen = {
    source: 'cursor', schemaVersion: 2, kind: 'attention.required', action: 'approve',
    question: '请到 Cursor 完成 Google Drive 授权', project: 'Google Drive',
    eventId: 'mcp-auth:google-drive:legacy', sessionId: 'mcp-auth:google-drive',
    turnId: 'legacy', requestId: 'legacy', occurredAt: 100,
    evidence: { adapter: 'cursor-mcp-auth-notify', surface: 'ide', providerVersion: 'manual', signal: 'mcp-needs-auth', gate: 'mcp-auth' },
  };
  const migratedOpen = {
    ...viaGate,
    sessionId: 'gate:cursor:mcp-auth:google-drive',
    eventId: 'gate:mcp-auth:google-drive:migrated',
    requestId: 'migrated',
    turnId: 'migrated',
    occurredAt: 200,
  };
  const done = buildGateResolvedNotification({
    source: 'cursor', gate: 'mcp-auth', label: 'Google Drive', requestId: 'done', now: 1_000,
  });
  const expanded = expandAgentGateSessionResolution(done, [
    { event: legacyOpen, firstSeenAt: 100 },
    { event: migratedOpen, firstSeenAt: 200 },
  ]);
  assert.deepEqual(expanded.map((row) => row.requestId).sort(), ['legacy', 'migrated']);
});

test('session resolve expands only open rows for the same gate+label', () => {
  const done = buildGateResolvedNotification({
    source: 'cursor', gate: 'command-run', label: '完整权限', requestId: 'done', now: 1_000,
  });
  const a = buildGateNotification({ source: 'cursor', gate: 'command-run', label: '完整权限', requestId: 'a', now: 100 });
  const later = buildGateNotification({ source: 'cursor', gate: 'command-run', label: '完整权限', requestId: 'b', now: 2_000 });
  const other = buildGateNotification({ source: 'cursor', gate: 'permission', label: '屏幕录制', requestId: 'c', now: 100 });
  const expanded = expandAgentGateSessionResolution(done, [
    { event: a, firstSeenAt: 100 },
    { event: later, firstSeenAt: 2_000 },
    { event: other, firstSeenAt: 100 },
  ]);
  assert.deepEqual(expanded.map((row) => row.requestId), ['a']);
});

test('gate success is atomic and does not close a later request', (t) => {
  let clock = 1_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-agent-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createAiAttentionStore({ filePath: path.join(dir, 'ai-attention.json'), now: () => clock });
  ingest(store, buildGateNotification({ source: 'cursor', gate: 'command-run', label: 'all', requestId: 'a', now: clock }));
  clock = 1_500;
  const done = buildGateResolvedNotification({ source: 'cursor', gate: 'command-run', label: 'all', requestId: 'done', now: clock });
  assert.equal(ingest(store, done).result, 'accepted');
  assert.equal(store.list().length, 0);
  clock = 2_000;
  ingest(store, buildGateNotification({ source: 'cursor', gate: 'command-run', label: 'all', requestId: 'b', now: clock }));
  assert.equal(ingest(store, done).result, 'duplicate');
  assert.equal(store.list()[0].event.requestId, 'b');
});

test('the general gate script ships with the desktop app', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('scripts/agent-gate-notify.js'));
  assert.ok(pkg.build.mac.files.includes('scripts/agent-gate-notify.js'));
  assert.ok(pkg.build.files.includes('scripts/cursor-mcp-auth-notify.js'));
});

test('postNotification routes to the matching /notify/<source> path', async () => {
  let seen = null;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      seen = { url: request.url, body: JSON.parse(body) };
      response.writeHead(202);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const payload = buildGateNotification({ source: 'claude', gate: 'permission', label: '钥匙串' });
  const result = await postNotification(payload, { port });
  server.close();
  assert.equal(result.ok, true);
  assert.equal(seen.url, '/notify/claude');
  assert.equal(seen.body.action, 'approve');
  assert.equal(slug('完整 权限'), '完整-权限');
});
