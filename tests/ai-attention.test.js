'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { classifyAiEvent, knownControlEnvelope, safeQuestion } = require('../aiEventPolicy');
const { createAiAttentionStore, rebuildAiAttention } = require('../aiAttentionStore');
const { createAiNotificationScheduler, countQueuedNotifications } = require('../aiNotificationScheduler');
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
test('queue +N counts other visible waiting requests and completions together, skipping hidden ones', () => {
  const rows = [
    { key: 'active', state: 'pending', hidden: false },
    { key: 'other', state: 'pending', hidden: false },
    { key: 'hidden', state: 'pending', hidden: true },
    { key: 'unverified', state: 'unverified', hidden: false },
  ];
  assert.equal(countQueuedNotifications({
    attentionRows: rows,
    completions: [{ eventId: 'c1' }, { eventId: 'c2', summaryCount: 2 }],
    activeAttentionKey: 'active',
  }), 4);
  assert.equal(countQueuedNotifications({
    attentionRows: rows,
    completions: [{ eventId: 'c1' }],
    activeAttentionKey: null,
  }), 3);
  assert.equal(countQueuedNotifications({
    attentionRows: rows.filter((row) => row.key !== 'active'),
    completions: [],
    activeAttentionKey: null,
  }), 1);
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
  assert.equal(adapter.observe(approval)[0].requestId, one.requestId, 'the same observation keeps its identity after a boundary');
  const nextApproval = observation({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'run secret --token=123' });
  assert.notEqual(adapter.observe(nextApproval)[0].requestId, one.requestId);
});

test('Claude notifications distinguish new authorization invocations from delivery retries without retaining commands', t => {
  const adapter = createClaudeAttentionAdapter(), {filePath} = fixture(t), store = createAiAttentionStore({filePath});
  const base = {session_id:'s',prompt_id:'p',hook_event_name:'Notification',notification_type:'permission_prompt'};
  const inputs = ['Allow npm install --token=FIRST_SECRET','Allow git push --token=SECOND_SECRET','Allow npm install --token=FIRST_SECRET'];
  const forwarded = inputs.map(message => observation({...base,message}));
  const events = forwarded.map(payload => adapter.observe(payload)[0]);
  assert.equal(new Set(events.map(row => row.requestId)).size,3);
  assert.equal(adapter.observe(forwarded[0])[0].requestId,events[0].requestId);
  store.applyBatch(events.map(row => classifyAiEvent(row,'claude').event));
  assert.equal(store.list().length,3);
  assert(!JSON.stringify(forwarded).includes('FIRST_SECRET'));
  assert(!fs.readFileSync(filePath,'utf8').includes('SECOND_SECRET'));
  const native = observation({...base,notification_id:'native-request',message:inputs[0]});
  const nativeRetry = observation({...base,notification_id:'native-request',message:inputs[0]});
  assert.equal(adapter.observe(native)[0].requestId,adapter.observe(nativeRetry)[0].requestId);
  assert.notEqual(adapter.observe({...native,session_id:'another-session'})[0].sessionId,events[0].sessionId);
});

test('authorization previews accept English/Chinese fixed command heads and never preserve arguments or forged previews', t => {
  const {filePath} = fixture(t), store = createAiAttentionStore({filePath}), adapter = createClaudeAttentionAdapter();
  for (const prefix of ['', '允许运行 ', 'Allow ', 'Allow running ', 'Run ', 'Approve running ']) {
    const question = `${prefix}npm install --token=KEEP_PRIVATE`;
    assert.equal(safeQuestion(question,'approve').commandPreview,'npm install');
    const forwarded = observation({session_id:'s',hook_event_name:'Notification',notification_type:'permission_prompt',message:question});
    assert.equal(forwarded.question,''); assert.equal(forwarded.commandPreview,'npm install');
    const checked = classifyAiEvent(adapter.observe(forwarded)[0],'claude');
    assert.equal(checked.event.commandPreview,'npm install'); assert.equal(checked.event.question,'');
    store.apply(checked.event);
  }
  const forged = classifyAiEvent(event({action:'approve',question:'',sensitive:true,commandPreview:'npm install --token=KEEP_PRIVATE'}),'codex');
  assert.equal(forged.event.commandPreview,undefined);
  assert(!fs.readFileSync(filePath,'utf8').includes('KEEP_PRIVATE'));
  assert.equal(safeQuestion('Allow rm --token=KEEP_PRIVATE','approve').commandPreview,undefined);
});

test('a Claude multi-event boundary is a single atomic write and pre-rename failures preserve adapter and disk state', t => {
  const {filePath} = fixture(t), adapter = createClaudeAttentionAdapter();
  let fail = false, renames = 0;
  const disk = Object.create(fs); disk.renameSync = (a,b) => {renames++;if(fail) throw new Error('ENOSPC');fs.renameSync(a,b);};
  const store = createAiAttentionStore({filePath,disk});
  const ask = id => adapter.observe({session_id:'s',hook_event_name:'PreToolUse',tool_name:'AskUserQuestion',tool_use_id:id,action:'select',question:'A or B?'})[0];
  store.applyBatch(['a','b'].map(id => classifyAiEvent(ask(id),'claude').event));
  assert.equal(renames,1);
  const before = fs.readFileSync(filePath), snapshot = adapter.snapshot();
  fail = true;
  const ends = adapter.observe({session_id:'s',hook_event_name:'Stop'});
  try {store.applyBatch(ends.map(row => classifyAiEvent(row,'claude').event));assert.fail('expected failure');}
  catch(error) {assert.match(error.message,/ENOSPC/);assert(!error.attentionBatchCommitted);adapter.restore(snapshot);}
  assert.deepEqual(fs.readFileSync(filePath),before);
  assert.equal(store.list().length,2); assert.equal(adapter.snapshot().get('s').requests.size,2);
  fail = false;
  const writes = renames;
  store.applyBatch(adapter.observe({session_id:'s',hook_event_name:'Stop'}).map(row => classifyAiEvent(row,'claude').event));
  assert.equal(renames,writes+1);assert.equal(store.list().length,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath)).records.map(row => row.state),['resolved','resolved']);
});

test('an error after atomic rename reports the committed batch so adapter rollback cannot split state', t => {
  const {filePath} = fixture(t), adapter = createClaudeAttentionAdapter();
  let failAfterRename = false;
  const disk = Object.create(fs);disk.renameSync = (a,b) => {fs.renameSync(a,b);if(failAfterRename) throw new Error('after_rename_failure');};
  const store = createAiAttentionStore({filePath,disk});
  for(const id of ['a','b']) store.apply(classifyAiEvent(adapter.observe({session_id:'s',hook_event_name:'PreToolUse',tool_name:'AskUserQuestion',tool_use_id:id,action:'select',question:'Choose'})[0],'claude').event);
  failAfterRename = true;
  const snapshot = adapter.snapshot();
  try {store.applyBatch(adapter.observe({session_id:'s',hook_event_name:'Stop'}).map(row => classifyAiEvent(row,'claude').event));assert.fail('expected failure');}
  catch(error) {assert.equal(error.attentionBatchCommitted,true);if(!error.attentionBatchCommitted) adapter.restore(snapshot);}
  assert.equal(store.list().length,0);assert.equal(adapter.snapshot().get('s').requests.size,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath)).records.map(row => row.state),['resolved','resolved']);
});

test('batch validation failure after a valid first event leaves all state unchanged', t => {
  const {filePath} = fixture(t), store = createAiAttentionStore({filePath});
  store.apply(event());const before = fs.readFileSync(filePath);
  assert.throws(() => store.applyBatch([event({kind:'attention.resolved',reason:'answered',sequence:2}),event({action:'execute'})]),/invalid_attention_event/);
  assert.deepEqual(fs.readFileSync(filePath),before);assert.equal(store.list().length,1);
});
