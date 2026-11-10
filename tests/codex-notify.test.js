'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { classifyAiEvent, visibleCompletion } = require('../aiEventPolicy');
const script = path.join(__dirname, '../scripts/codex-notify.js');
const source = fs.readFileSync(script, 'utf8'), scriptRequire = createRequire(script);
function run(payload, { previous = null, encodedPayload = false } = {}) {
  const raw = JSON.stringify(payload), posts = [], forwards = [], exit = {};
  const args = ['node', script, '--pome-panel-hook=codex', '--pome-forward=' + Buffer.from(JSON.stringify(previous)).toString('base64url'),
    encodedPayload ? '--pome-payload=' + Buffer.from(raw).toString('base64') : raw];
  const requireStub = name => {
    if (name === 'node:http') return { request: options => ({ setTimeout() {}, on() {}, end(body) { posts.push({ options, body, payload: JSON.parse(body) }); } }) };
    if (name === 'node:child_process') return { spawn(command, args, options) { forwards.push({ command, args: Array.from(args), options }); return { on() {}, unref() {} }; } };
    if (name === '../codex-thread-metadata') return { readCodexThreadTitle: () => '' };
    return scriptRequire(name);
  };
  try { vm.runInNewContext(source, { require: requireStub, Buffer, process: { argv: args, env: { ELECTRON_RUN_AS_NODE: '1' }, exit() { throw exit; } } }, { filename: script }); }
  catch (error) { if (error !== exit) throw error; }
  return { raw, posts, forwards };
}
test('large Codex input and answer stay within the receiver body limit; original notifier receives untouched JSON', () => {
  const payload = { type: 'agent-turn-complete', 'thread-id': 'session', 'turn-id': 'turn', cwd: '/fixture/project',
    'input-messages': ['用户输入'.repeat(20000)], 'last-assistant-message': '完成说明😀'.repeat(10000) };
  const { raw, posts, forwards } = run(payload, { previous: ['original-notifier', 'turn-ended'] });
  assert(Buffer.byteLength(raw) > 64 * 1024, 'the original event reproduces the rejected size');
  assert.equal(posts.length, 1); assert(posts[0].body.length < 64 * 1024);
  assert.equal(posts[0].payload['input-messages'], undefined);
  assert.equal(Array.from(posts[0].payload['last-assistant-message']).length, 4096);
  assert.equal(posts[0].payload['turn-id'], 'turn');
  assert.deepEqual(forwards[0].args, ['turn-ended', raw]);
  assert.equal(forwards[0].options.env.ELECTRON_RUN_AS_NODE, undefined);
});
test('long result truncation cannot turn legitimate output into a filtered empty control envelope', () => {
  const result = '{"exclude":[]}' + ' '.repeat(5000) + 'This is a real explanation.';
  const { posts } = run({ type: 'agent-turn-complete', 'last-assistant-message': result });
  assert.equal(posts.length, 1);
  assert.equal(classifyAiEvent(posts[0].payload, 'codex').category, 'completion');
  assert.equal(visibleCompletion({ source: 'codex', completionSummary: posts[0].payload['last-assistant-message'] }), true);
});
test('ordinary output and Windows base64 payloads retain Unicode and metadata', () => {
  const payload = { type: 'agent-turn-complete', 'thread-id': 'session', 'turn-id': 'turn', 'last-assistant-message': '正常完成 😀', session_title: '会话名称' };
  assert.deepEqual(run(payload).posts[0].payload, payload);
  assert.deepEqual(run(payload, { encodedPayload: true }).posts[0].payload, payload);
});
test('a literal Pome argument in another notifier does not suppress forwarding', () => {
  const { forwards, raw } = run({ type: 'agent-turn-complete', title: 'complete' }, { previous: ['other-notifier', '--pome-panel-hook=codex', '--keep'] });
  assert.equal(forwards.length, 1); assert.deepEqual(forwards[0].args, ['--pome-panel-hook=codex', '--keep', raw]);
  const self = run({ type: 'agent-turn-complete', title: 'complete' }, { previous: ['node', '/fixture/codex-notify.js', '--pome-panel-hook=codex'] });
  assert.equal(self.forwards.length, 0, 'a real Pome hook must not recursively forward to itself');
  assert.equal(self.posts.length, 1);
});
test('subagents and exact control envelopes remain filtered; tests never forward original commands', () => {
  for (const payload of [{ type: 'agent-turn-complete', 'last-assistant-message': '{"exclude":[]}' }, { type: 'agent-turn-complete', agent_id: 'child', title: 'child result' }]) {
    assert.equal(run(payload).posts.length, 0);
  }
  const { posts, forwards } = run({ _pome_test: true, _pome_test_token: 'fixture' }, { previous: ['original'] });
  assert.equal(posts.length, 1); assert.equal(forwards.length, 0);
});
