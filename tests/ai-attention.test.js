'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { classifyAiEvent, knownControlEnvelope, safeQuestion } = require('../aiEventPolicy');
const { createAiAttentionStore, rebuildAiAttention } = require('../aiAttentionStore');
const { createAiNotificationScheduler } = require('../aiNotificationScheduler');
const { createClaudeAttentionAdapter } = require('../claudeAttentionAdapter');
const { createTaskInbox } = require('../taskInbox');
const { observation } = require('../scripts/claude-attention');
const event = (overrides = {}) => ({ schemaVersion: 2, kind: 'attention.required', source: 'codex', eventId: 'e1', sessionId: 's1', turnId: 't1', requestId: 'r1', action: 'input', question: '请填写地址', occurredAt: 1000, sequence: 1, evidence: { adapter: 'fixture', surface: 'bridge', providerVersion: 'fixture-1', signal: 'request' }, ...overrides });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-attention-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath: path.join(dir, 'ai-attention.json') };
}
test('known JSON noise is exact, fenced or formatted; ordinary JSON and narrative survive', () => {
  for (const body of ['{"suggestions":[]}', '```json\n{\n "exclude": []\n}\n```', '  {"exclude":[]} ']) {
    assert(knownControlEnvelope(body)); assert.equal(classifyAiEvent({ title: body, final: true }, 'codex').reason, 'known_control_envelope');
  }
  for (const body of ['{"success":true,"count":3}', '接口返回 {"exclude":[]}，已经修复', '{"suggestions":["a"]}', '{"exclude":[],"other":1}', '{}', '[]', '{broken']) assert(!knownControlEnvelope(body));
  assert.equal(classifyAiEvent({ title: 'tool text', type: 'item.completed' }, 'codex').reason, 'non_terminal');
  assert.equal(classifyAiEvent({ title: 'tool result', role: 'tool' }, 'codex').reason, 'non_terminal');
  assert.equal(classifyAiEvent({ hook_event_name: 'afterAgentResponse', text: 'intermediate' }, 'cursor').category, 'ignore');
  assert.equal(classifyAiEvent({ agent_id: 'child', title: 'done' }, 'claude').reason, 'subagent');
  assert.equal(classifyAiEvent({ type: 'agent-turn-complete', title: '' }, 'codex').category, 'completion');
  assert.equal(classifyAiEvent({ title: '' }, 'codex').reason, 'no_user_result');
});
test('v2 validates all three actions, identities, ordering and resolution reasons', () => {
  for (const action of ['input', 'select', 'approve']) assert.equal(classifyAiEvent(event({ action }), 'codex').category, 'attention');
  for (const override of [{ action: 'execute' }, { sessionId: '' }, { requestId: '' }, { sequence: -1 }, { occurredAt: 'today' }, { schemaVersion: 3 }, { evidence: null }]) assert.equal(classifyAiEvent(event(override), 'codex').category, 'invalid');
  assert.equal(classifyAiEvent(event({ source: 'claude' }), 'codex').category, 'invalid');
  for (const reason of ['answered', 'cancelled', 'continued', 'terminated']) assert.equal(classifyAiEvent(event({ kind: 'attention.resolved', reason }), 'codex').category, 'stateOnly');
  assert.equal(classifyAiEvent(event({ kind: 'attention.resolved', reason: 'approved-for-you' }), 'codex').category, 'invalid');
});
test('secrets and raw commands/answers are excluded before persistence, Unicode summary is bounded', t => {
  const { filePath } = fixture(t), store = createAiAttentionStore({ filePath });
  for (const question of ['npm install --token=TOPSECRET', 'Authorization: Bearer abcdef', 'https://user:PASS@example.com', 'API_KEY=VALUE', '密码: hidden']) {
    const safe = classifyAiEvent(event({ question, answer: 'never-save', command: 'never-run', token: 'never-save' }), 'codex').event;
    assert.equal(safe.question, ''); assert.equal(safe.sensitive, true);
    store.apply(safe);
    const disk = fs.readFileSync(filePath, 'utf8'); assert(!disk.includes('TOPSECRET')); assert(!disk.includes('never-save')); assert(!disk.includes('never-run'));
  }
  assert.equal(Array.from(safeQuestion('😀'.repeat(200)).question).length, 160);
});
test('hidden/viewed requests remain pending; duplicates, sessions, turns and tombstones stay separate', t => {
  const { filePath } = fixture(t), store = createAiAttentionStore({ filePath });
  const first = store.apply(event()).record;
  store.display(first.key, true); assert.equal(store.list()[0].state, 'pending');
  assert.equal(store.apply(event()).duplicate, true); assert.equal(store.list()[0].hidden, true);
  store.apply(event({ sessionId: 's2' })); store.apply(event({ turnId: 't2' })); assert.equal(store.list().length, 3);
  store.apply(event({ kind: 'attention.resolved', reason: 'answered', sequence: 2 })); assert.equal(store.list().length, 2);
  assert.equal(store.apply(event({ sequence: 99 })).duplicate, true); assert.equal(store.list().length, 2);
  store.apply(event({ requestId: 'early', kind: 'attention.resolved', reason: 'cancelled', sequence: 5 }));
  store.apply(event({ requestId: 'early', sequence: 4 })); assert.equal(store.list().length, 2);
});
test('only ordered matching turn lifecycle closes requests; restart never replays pending automatically', t => {
  const { filePath } = fixture(t), store = createAiAttentionStore({ filePath });
  store.apply(event({ sequence: 5 }));
  store.apply(event({ kind: 'turn.completed', sequence: 4 })); assert.equal(store.list().length, 1);
  store.apply(event({ kind: 'turn.completed', turnId: 'different', sequence: 6 })); assert.equal(store.list().length, 1);
  const restarted = createAiAttentionStore({ filePath }); assert.equal(restarted.list()[0].state, 'unverified');
  restarted.apply(event({ sequence: 7 })); assert.equal(restarted.list()[0].state, 'pending');
  restarted.apply(event({ kind: 'turn.cancelled', sequence: 8 })); assert.equal(restarted.list().length, 0);
});
test('atomic failures, external edits and corrupt storage preserve bytes and support confirmed backup repair', t => {
  const { filePath } = fixture(t); const store = createAiAttentionStore({ filePath }); store.apply(event());
  const before = fs.readFileSync(filePath, 'utf8');
  const disk = Object.create(fs); disk.renameSync = () => { throw new Error('fixture full disk'); };
  assert.throws(() => createAiAttentionStore({ filePath, disk }), /full disk/); assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  fs.writeFileSync(filePath, '{broken'); assert.throws(() => store.apply(event()), /changed/); assert.throws(() => store.list(), /changed/);
  assert.throws(() => createAiAttentionStore({ filePath }), /损坏/);
  assert.equal(rebuildAiAttention({ filePath }).canceled, true);
  assert.equal(rebuildAiAttention({ filePath, confirmed: true, expectedDigest: 'wrong' }).error, 'preview_expired');
  const expectedDigest = require('node:crypto').createHash('sha256').update('{broken').digest('hex');
  const repaired = rebuildAiAttention({ filePath, confirmed: true, expectedDigest }); assert.equal(fs.readFileSync(repaired.backupPath, 'utf8'), '{broken');
  assert.deepEqual(createAiAttentionStore({ filePath }).list(), []);
});
test('scheduler alternates waiting and completions, pauses preemption, keeps remaining completion budget', () => {
  const completions = [{ eventId: 'c1' }, { eventId: 'c2' }]; let clock = 0;
  const scheduler = createAiNotificationScheduler({ completions, now: () => clock });
  const first = scheduler.next(); assert.equal(first.eventId, 'c1');
  const rows = [1, 2].map(i => ({ key: `a${i}`, state: 'pending' })); const map = row => ({ attentionKey: row.key });
  scheduler.sync(rows, map); assert(scheduler.shouldPreempt(first, false)); assert(!scheduler.shouldPreempt(first, true));
  clock += 1234; scheduler.suspend(first, scheduler.remaining(6000, 0));
  assert.equal(scheduler.next().attentionKey, 'a1');
  const resumed = scheduler.next(); assert.equal(resumed.eventId, 'c1'); assert.equal(scheduler.budget(resumed), 4766);
  const next = scheduler.next(); assert.equal(next.attentionKey, 'a2'); assert.equal(scheduler.budget(next), 8000);
  assert.equal(scheduler.next().eventId, 'c2');
  scheduler.sync([{ key: 'a2', state: 'pending' }], map); assert(!scheduler.hasOthers(next));
});
test('new waiting arrivals do not repeat the current item or starve an already queued completion', () => {
  const completions = [], scheduler = createAiNotificationScheduler({ completions });
  const row = key => ({ key, state: 'pending' }), map = row => ({ attentionKey: row.key });
  scheduler.sync([row('a')], map); assert.equal(scheduler.next().attentionKey, 'a');
  scheduler.sync([row('a'), row('b')], map); assert.equal(scheduler.next().attentionKey, 'b');
  completions.push({ eventId: 'done' });
  scheduler.sync([row('a'), row('b'), row('c')], map); assert.equal(scheduler.next().eventId, 'done');
  scheduler.select('c'); assert.equal(scheduler.next().attentionKey, 'c');
});
test('legacy noisy history uses one projection for pagination/unread and retains original identities', t => {
  const { dir } = fixture(t), filePath = path.join(dir, 'inbox.json'), inbox = createTaskInbox({ filePath });
  for (let i = 0; i < 5; i++) inbox.accept({ source: 'codex', eventId: `n${i}`, title: i % 2 ? '正常结果' : '{"suggestions":[]}' });
  const before = fs.readFileSync(filePath, 'utf8');
  const state = inbox.list({ limit: 1, offset: 1 }); assert.equal(state.total, 2); assert.equal(state.unread, 2); assert.equal(state.hasMore, false); assert.equal(state.items.length, 1);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before); assert.equal(inbox.accept({ source: 'codex', eventId: 'n0', title: '{"suggestions":[]}' }).duplicate, true);
});
test('Claude observer emits no decisions or answers and correlates only the exact tool request', () => {
  const adapter = createClaudeAttentionAdapter();
  const base = { session_id: 's', prompt_id: 'p', tool_use_id: 'tool1', tool_name: 'AskUserQuestion' };
  const payload = observation({ ...base, hook_event_name: 'PreToolUse', tool_input: { questions: [{ question: '选哪个？', options: [{ label: 'A' }], answers: { secret: 'no' } }] } });
  assert(!JSON.stringify(payload).includes('answers')); assert(!JSON.stringify(payload).includes('permission'));
  const required = adapter.observe(payload)[0]; assert.equal(required.action, 'select'); assert.equal(required.requestId, 'tool1');
  assert.deepEqual(adapter.observe({ ...base, hook_event_name: 'PostToolUse', tool_use_id: 'unrelated' }), []);
  const resolved = adapter.observe({ ...base, hook_event_name: 'PostToolUse' })[0]; assert.equal(resolved.reason, 'answered'); assert.equal(resolved.turnId, required.turnId);
  assert.equal(observation({ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' }), null);
  const approval = observation({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'run secret --token=123' });
  assert.equal(approval.question, '');
  const one = adapter.observe(approval)[0], retry = adapter.observe(approval)[0]; assert.equal(one.requestId, retry.requestId);
  assert.deepEqual(adapter.observe({ ...base, hook_event_name: 'PostToolUse', tool_use_id: 'another' }), []);
  const end = adapter.observe({ ...base, hook_event_name: 'Stop' }); assert.equal(end[0].requestId, one.requestId);
  assert.notEqual(adapter.observe(approval)[0].requestId, one.requestId);
});
