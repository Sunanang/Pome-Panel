'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseArgs,
  buildAttentionNotification,
  buildResolvedNotification,
} = require('../scripts/ai-attention-notify');
const { classifyAiEvent } = require('../aiEventPolicy');
const { createAiAttentionStore } = require('../aiAttentionStore');

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-attention-notify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createAiAttentionStore({ filePath: path.join(dir, 'ai-attention.json') });
}

test('a waiting question from a client without a waiting hook becomes a top-bubble request', () => {
  const payload = buildAttentionNotification({ source: 'codex', action: 'select',
    question: '这次修改直接上线，还是先预览？', project: 'Pome-Panel', requestId: 'req-1', occurredAt: 1_700_000_000_000 });
  const policy = classifyAiEvent(payload, 'codex');
  assert.equal(policy.category, 'attention');
  assert.equal(policy.event.action, 'select');
  assert.equal(policy.event.question, '这次修改直接上线，还是先预览？');
  assert.equal(policy.event.project, 'Pome-Panel');
  assert.equal(policy.event.requestId, 'req-1');
  assert.equal(policy.event.occurredAt, 1_700_000_000_000);
  assert.equal(policy.event.evidence.adapter, 'pome-attention-notify');
  assert.equal(policy.event.evidence.surface, 'desktop');
});

test('cursor keeps its IDE surface and free-text waits stay input', () => {
  const payload = buildAttentionNotification({ source: 'cursor', action: 'input', question: '请补充要改哪个文件', requestId: 'req-2' });
  const policy = classifyAiEvent(payload, 'cursor');
  assert.equal(policy.category, 'attention');
  assert.equal(policy.event.action, 'input');
  assert.equal(policy.event.evidence.surface, 'ide');
});

test('secret-bearing questions are masked, and approvals keep only a safe command label', () => {
  const payload = buildAttentionNotification({ source: 'codex', action: 'approve',
    question: 'allow running npm install now; token=sk-1234567890abcdef', requestId: 'req-3' });
  assert.equal(payload.sensitive, true);
  assert.equal(payload.question, '');
  assert.equal(payload.commandPreview, 'npm install');
  const policy = classifyAiEvent(payload, 'codex');
  assert.equal(policy.category, 'attention');
  assert.equal(policy.event.sensitive, true);
  assert.equal(policy.event.commandPreview, 'npm install');
});

test('resolving needs the request id and closes only that request in the store', t => {
  assert.throws(() => buildResolvedNotification({ source: 'codex' }), /request_required/);
  const store = tempStore(t);
  const required = buildAttentionNotification({ source: 'codex', action: 'select', question: '上线还是预览？', requestId: 'req-4', occurredAt: 1_700_000_000_000 });
  store.apply(classifyAiEvent(required, 'codex').event);
  const other = buildAttentionNotification({ source: 'codex', action: 'input', question: '补一下文件路径', requestId: 'req-5', occurredAt: 1_700_000_001_000 });
  store.apply(classifyAiEvent(other, 'codex').event);
  assert.equal(store.list().filter(row => row.state === 'pending').length, 2);
  const resolved = buildResolvedNotification({ source: 'codex', requestId: 'req-4', reason: 'answered', occurredAt: 1_700_000_002_000 });
  store.apply(classifyAiEvent(resolved, 'codex').event);
  const pending = store.list().filter(row => row.state === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event.requestId, 'req-5');
});

test('retransmitting the same request identity dedupes instead of stacking bubbles', t => {
  const store = tempStore(t);
  const event = () => classifyAiEvent(buildAttentionNotification({ source: 'codex', action: 'select',
    question: '要不要继续？', requestId: 'req-6', occurredAt: 1_700_000_003_000 }), 'codex').event;
  const first = store.apply(event());
  const second = store.apply(event());
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(store.list().filter(row => row.state === 'pending').length, 1);
});

test('unsupported sources are refused, and cli flags parse', () => {
  assert.throws(() => buildAttentionNotification({ source: 'gpt' }), /unsupported_source/);
  assert.deepEqual(parseArgs(['--source', 'cursor', '--action', 'select', '--question', '选哪个？', '--project', 'pome']),
    { source: 'cursor', action: 'select', question: '选哪个？', project: 'pome', sessionId: '', requestId: '',
      resolved: false, reason: 'answered', dryRun: false, help: false });
  assert.equal(parseArgs(['--resolved', '--request', 'req-9']).resolved, true);
  assert.equal(parseArgs(['--reason', 'cancelled']).reason, 'cancelled');
});

test('unknown resolution reasons fall back to answered instead of sending an invalid event', () => {
  const payload = buildResolvedNotification({ source: 'codex', requestId: 'req-7', reason: 'whatever' });
  assert.equal(payload.reason, 'answered');
  assert.equal(classifyAiEvent(payload, 'codex').category, 'stateOnly');
});
