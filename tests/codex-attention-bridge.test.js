'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { WAITING_ACTIONS, waitingAction, createTracker, eventsFromNotification, createCodexAttentionBridge } = require('../codexAttentionBridge');
const { classifyAiEvent } = require('../aiEventPolicy');
const { createAiAttentionStore } = require('../aiAttentionStore');
const probe = require('../scripts/codex-appserver-probe');

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-codex-bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createAiAttentionStore({ filePath: path.join(dir, 'ai-attention.json') });
}
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [];
  child.stdin = { writable: true, write: value => { child.written.push(value); } };
  child.kill = () => child.emit('exit', 0);
  return child;
}

test('the app-server active flags map to Pome actions', () => {
  assert.deepEqual(WAITING_ACTIONS, { waitingOnApproval: 'approve', waitingOnUserInput: 'input' });
  assert.equal(waitingAction(['waitingOnUserInput']), 'input');
  assert.equal(waitingAction(['waitingOnApproval']), 'approve');
  assert.equal(waitingAction([]), null);
  assert.equal(waitingAction(undefined), null);
  assert.equal(waitingAction(['somethingElse']), null);
  // 多 flag 同时出现时授权优先，避免气泡动作随数组顺序抖动。
  assert.equal(waitingAction(['waitingOnUserInput', 'waitingOnApproval']), 'approve');
  assert.equal(waitingAction(['waitingOnApproval', 'waitingOnUserInput']), 'approve');
});

test('a thread entering a waiting flag produces one reminder, repeats do not stack', () => {
  const tracker = createTracker();
  const first = tracker.apply({ threadId: 't1', flags: ['waitingOnUserInput'], occurredAt: 1_700_000_000_000 });
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, 'attention.required');
  assert.equal(first[0].action, 'input');
  assert.equal(first[0].sessionId, 't1');
  assert.equal(first[0].evidence.adapter, 'codex-app-server-bridge');
  assert.deepEqual(tracker.apply({ threadId: 't1', flags: ['waitingOnUserInput'], occurredAt: 1_700_000_001_000 }), []);
});

test('clearing the flag resolves the same request so the bubble disappears', () => {
  const tracker = createTracker();
  const [required] = tracker.apply({ threadId: 't2', flags: ['waitingOnApproval'], occurredAt: 1_700_000_000_000 });
  const [resolved] = tracker.apply({ threadId: 't2', flags: [], occurredAt: 1_700_000_002_000 });
  assert.equal(resolved.kind, 'attention.resolved');
  assert.equal(resolved.requestId, required.requestId, 'the resolve must address the same request');
  assert.equal(resolved.sessionId, required.sessionId);
});

test('approval turning into a question resolves the first and opens the second', () => {
  const tracker = createTracker();
  const [first] = tracker.apply({ threadId: 't3', flags: ['waitingOnApproval'], occurredAt: 1_700_000_000_000 });
  const events = tracker.apply({ threadId: 't3', flags: ['waitingOnUserInput'], occurredAt: 1_700_000_003_000 });
  assert.deepEqual(events.map(event => event.kind), ['attention.resolved', 'attention.required']);
  assert.equal(events[0].requestId, first.requestId);
  assert.match(events[1].requestId, /^thread-status:input:2:/);
  assert.notEqual(events[0].requestId, events[1].requestId);
});

test('the same thread asking twice produces a second reminder instead of being dropped', t => {
  const store = tempStore(t);
  const tracker = createTracker();
  const feed = events => { for (const event of events) { store.apply(classifyAiEvent(event, 'codex').event); } return events; };
  const pending = () => store.list().filter(row => row.state === 'pending');
  feed(tracker.apply({ threadId: 'thread-1', flags: ['waitingOnUserInput'], occurredAt: Date.now() }));
  assert.equal(pending().length, 1);
  feed(tracker.apply({ threadId: 'thread-1', flags: [], occurredAt: Date.now() }));
  assert.equal(pending().length, 0);
  // 同一线程再问一次：必须重新弹，不能被"已解决身份"当成重复投递丢掉。
  feed(tracker.apply({ threadId: 'thread-1', flags: ['waitingOnUserInput'], occurredAt: Date.now() }));
  assert.equal(pending().length, 1, 'the second question must raise a new reminder');
  feed(tracker.apply({ threadId: 'thread-1', flags: [], occurredAt: Date.now() }));
  assert.equal(pending().length, 0);
});

test('each waiting occurrence gets its own identity, and the resolve points at it', () => {
  const tracker = createTracker();
  const first = tracker.apply({ threadId: 'thread-2', flags: ['waitingOnApproval'], occurredAt: 1_700_000_000_000 });
  const firstResolve = tracker.apply({ threadId: 'thread-2', flags: [], occurredAt: 1_700_000_001_000 });
  const second = tracker.apply({ threadId: 'thread-2', flags: ['waitingOnApproval'], occurredAt: 1_700_000_002_000 });
  const secondResolve = tracker.apply({ threadId: 'thread-2', flags: [], occurredAt: 1_700_000_003_000 });
  assert.notEqual(first[0].requestId, second[0].requestId, 'two waits are two requests');
  assert.equal(firstResolve[0].requestId, first[0].requestId);
  assert.equal(secondResolve[0].requestId, second[0].requestId);
  assert.notEqual(first[0].eventId, second[0].eventId);
});

test('an unexpected exit reconnects with backoff until stop is asked for', async () => {
  const children = [];
  const makeChild = () => {
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const bridge = createCodexAttentionBridge({ codexBinary: '/fixture/codex', autoRestartMs: 10, spawnProcess: makeChild, now: () => 1_700_000_000_000 });
  assert.equal(bridge.start(), true);
  assert.equal(children.length, 1);
  children[0].emit('exit', 1);         // daemon restarted
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(children.length, 2, 'the observer comes back on its own');
  assert.equal(bridge.running, true);
  bridge.stop();
  children[1].emit('exit', 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(children.length, 2, 'an intentional stop must not reconnect');
});

test('a brand-new tracker after a resolved tombstone still raises the next wait', t => {
  const store = tempStore(t);
  const feed = (tracker, flags) => {
    for (const event of tracker.apply({ threadId: 'thread-rebuilt', flags, occurredAt: Date.now() })) {
      store.apply(classifyAiEvent(event, 'codex').event);
    }
  };
  const first = createTracker();
  feed(first, ['waitingOnUserInput']);
  feed(first, []);
  assert.equal(store.list().filter(row => row.state === 'pending').length, 0);
  // 模拟 main 误把句柄置空后 new 出一个观察者：occurrence 会从 1 重数，
  // 若 requestId 不含唯一后缀就会撞 24h 墓碑。
  const rebuilt = createTracker();
  feed(rebuilt, ['waitingOnUserInput']);
  assert.equal(store.list().filter(row => row.state === 'pending').length, 1, 'rebuilt observer must not be blocked by the old tombstone');
});

test('main must not layer a second restart on top of the bridge autoRestart', () => {
  const mainText = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainText, /autoRestartMs:/);
  assert.doesNotMatch(mainText, /scheduleCodexAttentionBridgeRestart/);
  assert.match(mainText, /internal backoff reconnect owns recovery/);
});

test('a dead child stdin does not throw out of start()', () => {
  const child = fakeChild();
  child.stdin = { writable: true, write: () => { throw new Error('EPIPE'); } };
  const bridge = createCodexAttentionBridge({ codexBinary: '/fixture/codex', spawnProcess: () => child });
  assert.doesNotThrow(() => bridge.start());
  assert.equal(bridge.running, true);
});

test('the events survive the store round-trip: pending then gone', t => {
  const store = tempStore(t);
  const tracker = createTracker();
  const [required] = tracker.apply({ threadId: 't4', flags: ['waitingOnUserInput'], occurredAt: 1_700_000_000_000 });
  const policy = classifyAiEvent(required, 'codex');
  assert.equal(policy.category, 'attention');
  store.apply(policy.event);
  assert.equal(store.list().filter(row => row.state === 'pending').length, 1);
  const [resolved] = tracker.apply({ threadId: 't4', flags: [], occurredAt: 1_700_000_004_000 });
  const resolution = classifyAiEvent(resolved, 'codex');
  assert.equal(resolution.category, 'stateOnly');
  store.apply(resolution.event);
  assert.equal(store.list().filter(row => row.state === 'pending').length, 0, 'a cleared flag must close its own reminder');
});

test('only thread status notifications are translated; requests are never answered', () => {
  const tracker = createTracker();
  assert.deepEqual(eventsFromNotification({ method: 'item/started', params: {} }, tracker), []);
  assert.deepEqual(eventsFromNotification({ method: 'thread/status/changed', params: { threadId: 'x', status: { type: 'idle' } } }, tracker), []);
  const events = eventsFromNotification({ method: 'thread/status/changed',
    params: { threadId: 'x', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } }, tracker, { now: () => 1_700_000_000_000 });
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'approve');
});

test('the bridge handshakes, never answers server requests, and forwards waiting events', () => {
  const child = fakeChild();
  const requests = [], events = [];
  const bridge = createCodexAttentionBridge({ codexBinary: '/fixture/codex', now: () => 1_700_000_000_000,
    spawnProcess: () => child, onRequest: request => requests.push(request), onEvents: list => events.push(...list) });
  assert.equal(bridge.start(), true);
  const sent = child.written.map(line => JSON.parse(line));
  assert.deepEqual(sent.map(message => message.method), ['initialize', 'initialized', 'thread/list']);
  assert.equal(sent[0].params.clientInfo.name, 'pome-panel');
  child.written.length = 0;
  // A server request addressed at this client must be reported, never answered.
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'item/tool/requestUserInput', params: { threadId: 't5' } }) + '\n'));
  assert.deepEqual(requests, [{ method: 'item/tool/requestUserInput', id: 7 }]);
  assert.deepEqual(child.written, [], 'nothing may be written back to a server request');
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'thread/status/changed',
    params: { threadId: 't5', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } }) + '\n'));
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'input');
  bridge.stop();
  assert.equal(bridge.running, false);
});

test('unexpected proxy exit resolves announced waits so the bubble can clear', () => {
  const child = fakeChild();
  const events = [];
  let exited = 0;
  const bridge = createCodexAttentionBridge({
    codexBinary: '/fixture/codex', now: () => 1_700_000_000_000,
    spawnProcess: () => child, onEvents: list => events.push(...list), onExit: () => { exited += 1; },
  });
  bridge.start();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'thread/status/changed',
    params: { threadId: 't-exit', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } }) + '\n'));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'attention.required');
  child.emit('exit', 1);
  assert.equal(exited, 1);
  assert.equal(events.length, 2);
  assert.equal(events[1].kind, 'attention.resolved');
  assert.equal(events[1].requestId, events[0].requestId);
  assert.equal(bridge.running, false);
});

test('spawn error without exit also resolves waits and asks for reconnect', () => {
  const child = fakeChild();
  const events = [];
  let exited = 0;
  const bridge = createCodexAttentionBridge({
    codexBinary: '/fixture/codex', now: () => 1_700_000_000_000,
    spawnProcess: () => child, onEvents: list => events.push(...list), onExit: () => { exited += 1; },
  });
  bridge.start();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'thread/status/changed',
    params: { threadId: 't-err', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } }) + '\n'));
  child.emit('error', new Error('spawn failed'));
  assert.equal(exited, 1);
  assert.equal(events.at(-1).kind, 'attention.resolved');
  child.emit('exit', 1);
  assert.equal(exited, 1, 'error+exit must not double-fire onExit');
});

test('intentional stop resolves waits without scheduling a reconnect via onExit', () => {
  const child = fakeChild();
  const events = [];
  let exited = 0;
  const bridge = createCodexAttentionBridge({
    codexBinary: '/fixture/codex', now: () => 1_700_000_000_000,
    spawnProcess: () => child, onEvents: list => events.push(...list), onExit: () => { exited += 1; },
  });
  bridge.start();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'thread/status/changed',
    params: { threadId: 't-stop', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } }) + '\n'));
  bridge.stop();
  assert.equal(exited, 0);
  assert.equal(events.at(-1).kind, 'attention.resolved');
  assert.equal(bridge.running, false);
});

test('stop escalates to SIGKILL and still resolves when the proxy ignores SIGTERM', async () => {
  const child = fakeChild();
  const signals = [];
  child.kill = (signal) => { signals.push(signal || 'SIGTERM'); };
  const events = [];
  let exited = 0;
  const bridge = createCodexAttentionBridge({
    codexBinary: '/fixture/codex', now: () => 1_700_000_000_000, stopKillMs: 20,
    spawnProcess: () => child, onEvents: list => events.push(...list), onExit: () => { exited += 1; },
  });
  bridge.start();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'thread/status/changed',
    params: { threadId: 't-hang', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } }) + '\n'));
  bridge.stop();
  assert.deepEqual(signals, ['SIGTERM']);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(exited, 0);
  assert.equal(events.at(-1).kind, 'attention.resolved');
});

test('thread list responses feed the project name shown next to the reminder', () => {
  const child = fakeChild();
  const events = [];
  const bridge = createCodexAttentionBridge({ codexBinary: '/fixture/codex', now: () => 1_700_000_000_000,
    spawnProcess: () => child, onEvents: list => events.push(...list) });
  bridge.start();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { data: [{ id: 't6', cwd: '/Users/lando/coding/Pome-Panel' }] } }) + '\n'));
  child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'thread/status/changed',
    params: { threadId: 't6', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } }) + '\n'));
  assert.equal(events.length, 1);
  assert.equal(events[0].project, 'Pome-Panel');
  bridge.stop();
});

test('the bridge and its diagnostic ship with the app', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const list of [pkg.build.files, pkg.build.mac.files]) {
    assert.ok(list.includes('codexAttentionBridge.js'), 'the bridge module ships');
    assert.ok(list.includes('scripts/codex-appserver-probe.js'), 'the diagnostic ships');
  }
});

test('the probe parses its flags and finds the bundled codex binary', () => {
  assert.deepEqual(probe.parseArgs(['--seconds', '5', '--sock', '/tmp/x.sock', '--json']),
    { seconds: 5, socketPath: '/tmp/x.sock', json: true, binary: '' });
  assert.equal(probe.parseArgs([]).seconds, 15);
  assert.equal(probe.resolveBinary('', file => file.endsWith('/codex')), probe.DEFAULT_BINARIES[0]);
  assert.equal(probe.resolveBinary('/custom/codex', () => false), '/custom/codex');
  assert.deepEqual(probe.summarize({ jsonrpc: '2.0', id: 2, method: 'thread/list' }),
    { kind: 'request', method: 'thread/list', id: 2, params: undefined });
});
