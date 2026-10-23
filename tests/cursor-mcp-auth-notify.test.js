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

test('mcp auth notify payload uses awaiting authorization attention', () => {
  const payload = buildMcpAuthNotification({ service: 'Google Drive', now: 1_700_000_000_000 });
  assert.equal(payload.source, 'cursor');
  assert.equal(payload.status, 'awaiting');
  assert.equal(payload.attentionKind, 'authorization');
  assert.equal(payload.title, '请到 Cursor 完成 Google Drive 授权');
  assert.equal(payload.event_id, 'mcp-auth:google-drive');
  assert.equal(payload.completed_at, 1_700_000_000_000);
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
  assert.equal(seen.body.attentionKind, 'authorization');
  assert.match(seen.body.title, /Google Drive/);
});
