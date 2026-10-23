'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  buildMcpAuthNotification,
  parseArgs,
  postNotification,
  slug,
} = require('../scripts/cursor-mcp-auth-notify');

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

test('cli args accept --service', () => {
  assert.deepEqual(parseArgs(['--service', 'Notion']), { service: 'Notion', dryRun: false });
  assert.deepEqual(parseArgs(['--dry-run', 'Slack']), { service: 'Slack', dryRun: true });
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
