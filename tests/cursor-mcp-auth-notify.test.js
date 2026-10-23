'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {
  buildMcpAuthNotification,
  buildMcpAuthResolvedNotification,
  expandMcpAuthSessionResolution,
  isMcpAuthSessionResolution,
  parseArgs,
  postNotification,
  slug,
} = require('../scripts/cursor-mcp-auth-notify');
const { classifyAiEvent } = require('../aiEventPolicy');
const { createAiAttentionStore } = require('../aiAttentionStore');

function ingestMcpAuth(store, payload) {
  const policy = classifyAiEvent(payload, 'cursor');
  assert.ok(policy.event);
  if (isMcpAuthSessionResolution(policy.event)) {
    const receipt = store.apply(policy.event);
    if (receipt.duplicate) return { result: 'duplicate' };
    const expansions = expandMcpAuthSessionResolution(policy.event, store.list());
    if (expansions.length) store.applyBatch(expansions);
    return { result: expansions.length ? 'accepted' : 'ignored' };
  }
  store.apply(policy.event);
  return { result: 'accepted' };
}

test('mcp auth notify is a valid v2 authorization request, not a completion', () => {
  const payload = buildMcpAuthNotification({ service: 'Google Drive', now: 1_700_000_000_000, requestId: 'request-one' });
  assert.equal(payload.source, 'cursor');
  const policy = require('../aiEventPolicy').classifyAiEvent(payload, 'cursor');
  assert.equal(policy.category, 'attention');
  assert.equal(policy.event.action, 'approve');
  assert.equal(policy.event.question, '请到 Cursor 完成 Google Drive 授权');
  assert.equal(policy.event.eventId, 'mcp-auth:google-drive:request-one');
  assert.equal(policy.event.occurredAt, 1_700_000_000_000);
});

test('separate OAuth invocations have unique identities even for the same service and timestamp', () => {
  const options = { service: 'Google Drive', now: 1_700_000_000_000 };
  const first = buildMcpAuthNotification(options), second = buildMcpAuthNotification(options);
  assert.notEqual(first.eventId, second.eventId);
  assert.notEqual(first.requestId, second.requestId);
  assert.notEqual(first.turnId, second.turnId);
  const retry = buildMcpAuthNotification({ ...options, requestId: first.requestId });
  assert.deepEqual(retry, first, 'retransmitting the same invocation retains its identity');
});

test('service slug stays stable for Chinese and spaced names', () => {
  assert.equal(slug('Google Drive'), 'google-drive');
  assert.equal(slug('飞书文档'), '飞书文档');
  assert.equal(slug(''), 'mcp');
});

test('cli args accept --service and --resolved', () => {
  assert.deepEqual(parseArgs(['--service', 'Notion']), { service: 'Notion', dryRun: false, resolved: false });
  assert.deepEqual(parseArgs(['--dry-run', 'Slack']), { service: 'Slack', dryRun: true, resolved: false });
  assert.deepEqual(parseArgs(['--service', 'Google Drive', '--resolved']), { service: 'Google Drive', dryRun: false, resolved: true });
});

test('resolved payload is a session-level attention.resolved for the same service', () => {
  const payload = buildMcpAuthResolvedNotification({ service: 'Google Drive', now: 1_700_000_000_000, requestId: 'done-one' });
  const policy = require('../aiEventPolicy').classifyAiEvent(payload, 'cursor');
  assert.equal(policy.category, 'stateOnly');
  assert.equal(policy.event.kind, 'attention.resolved');
  assert.equal(policy.event.reason, 'answered');
  assert.equal(policy.event.sessionId, 'mcp-auth:google-drive');
  assert.equal(policy.event.evidence.signal, 'mcp-auth-done');
});

test('session resolution expands onto pending rows open at resolve time only', () => {
  const done = buildMcpAuthResolvedNotification({ service: 'Google Drive', requestId: 'done', now: 1_000 });
  const a = buildMcpAuthNotification({ service: 'Google Drive', requestId: 'a', now: 100 });
  const b = buildMcpAuthNotification({ service: 'Google Drive', requestId: 'b', now: 200 });
  const other = buildMcpAuthNotification({ service: 'Notion', requestId: 'c', now: 100 });
  const expanded = expandMcpAuthSessionResolution(done, [
    { event: a, firstSeenAt: 100 },
    { event: b, firstSeenAt: 200 },
    { event: other, firstSeenAt: 100 },
  ]);
  assert.equal(expanded.length, 2);
  assert.deepEqual(expanded.map((row) => row.requestId).sort(), ['a', 'b']);
  assert.equal(expandMcpAuthSessionResolution(done, []).length, 0);
});

test('stale resolve does not expand onto a later auth for the same service', () => {
  const doneA = buildMcpAuthResolvedNotification({ service: 'Google Drive', requestId: 'done-a', now: 1_000 });
  const laterB = buildMcpAuthNotification({ service: 'Google Drive', requestId: 'b', now: 2_000 });
  const expanded = expandMcpAuthSessionResolution(doneA, [
    { event: laterB, firstSeenAt: 2_000 },
  ]);
  assert.equal(expanded.length, 0);
});

test('replaying an old MCP auth success must not close a later request', (t) => {
  let clock = 1_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-mcp-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createAiAttentionStore({ filePath: path.join(dir, 'ai-attention.json'), now: () => clock });

  clock = 1_000;
  assert.equal(ingestMcpAuth(store, buildMcpAuthNotification({ service: 'Google Drive', requestId: 'a', now: clock })).result, 'accepted');
  clock = 1_500;
  const doneA = buildMcpAuthResolvedNotification({ service: 'Google Drive', requestId: 'done-a', now: clock });
  assert.equal(ingestMcpAuth(store, doneA).result, 'accepted');
  assert.equal(store.list().length, 0);

  clock = 2_000;
  assert.equal(ingestMcpAuth(store, buildMcpAuthNotification({ service: 'Google Drive', requestId: 'b', now: clock })).result, 'accepted');
  assert.equal(store.list().length, 1);

  assert.equal(ingestMcpAuth(store, doneA).result, 'duplicate');
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].event.requestId, 'b');

  const staleOtherId = buildMcpAuthResolvedNotification({ service: 'Google Drive', requestId: 'forged-old', now: 1_500 });
  assert.equal(ingestMcpAuth(store, staleOtherId).result, 'ignored');
  assert.equal(store.list()[0].event.requestId, 'b');
});

test('postNotification reaches the local Pome notify port', async () => {
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
  const payload = buildMcpAuthNotification({ service: 'Google Drive' });
  const result = await postNotification(payload, { port });
  server.close();
  assert.equal(result.ok, true);
  assert.equal(seen.url, '/notify/cursor');
  assert.equal(seen.body.action, 'approve');
  assert.match(seen.body.question, /Google Drive/);
});
