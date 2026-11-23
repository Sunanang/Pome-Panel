'use strict';
// Read-only observer for the Codex app-server protocol.
//
// Why this exists: Codex's notify hook only fires on turn end, and a pending
// question/approval is a *server request* addressed to the client that drives
// the thread - Pome can never see it from notify and must never answer it.
// The app-server does broadcast a thread status with active flags, and the
// authoritative schema (codex app-server generate-json-schema) defines
// ThreadActiveFlag as ["waitingOnApproval", "waitingOnUserInput"]. Watching
// thread/status/changed therefore yields the waiting state without becoming a
// driver, answering anything, or reading the UI.
const { spawn } = require('node:child_process');

const WAITING_ACTIONS = Object.freeze({ waitingOnApproval: 'approve', waitingOnUserInput: 'input' });
const ADAPTER = 'codex-app-server-bridge';

function waitingAction(flags) {
  if (!Array.isArray(flags)) return null;
  for (const flag of flags) if (WAITING_ACTIONS[flag]) return WAITING_ACTIONS[flag];
  return null;
}

// Per-thread diff of the announced waiting state. Status notifications repeat,
// so only transitions produce events; a cleared/absent flag resolves.
function createTracker() {
  const announced = new Map();
  return {
    announced,
    apply({ threadId, flags, project = '', occurredAt }) {
      if (!threadId) return [];
      const action = waitingAction(flags);
      const previous = announced.get(threadId) || null;
      if (action === previous) return [];
      const at = Number(occurredAt) > 0 ? Number(occurredAt) : Date.now();
      if (previous) {
        announced.delete(threadId);
        // 解析事件的 requestId 必须与对应 required 的完全一致，否则存储层
        // 关不掉那条提醒（请求键包含 requestId）。
        if (!action) return [resolvedEvent({ threadId, project, action: previous, occurredAt: at })];
        announced.set(threadId, action);
        return [resolvedEvent({ threadId, project, action: previous, occurredAt: at }), requiredEvent({ threadId, project, action, occurredAt: at })];
      }
      announced.set(threadId, action);
      return [requiredEvent({ threadId, project, action, occurredAt: at })];
    },
    reset() { announced.clear(); },
  };
}

function requiredEvent({ threadId, action, project = '', occurredAt = Date.now() }) {
  return baseEvent({ threadId, project, occurredAt, kind: 'attention.required',
    action, requestId: 'thread-status:' + action, signal: 'thread/status/changed:' + action });
}

function resolvedEvent({ threadId, action, project = '', occurredAt = Date.now() }) {
  return baseEvent({ threadId, project, occurredAt, kind: 'attention.resolved', reason: 'answered',
    requestId: 'thread-status:' + action, signal: 'thread/status/changed:idle' });
}

function baseEvent({ threadId, project, occurredAt, kind, action, reason, requestId, signal }) {
  return {
    schemaVersion: 2,
    kind,
    source: 'codex',
    eventId: 'codex-status:' + threadId + ':' + (kind === 'attention.resolved' ? 'resolved' : action),
    sessionId: threadId,
    turnId: threadId,
    requestId,
    ...(action ? { action } : {}),
    ...(reason ? { reason } : {}),
    question: '',
    project,
    occurredAt,
    evidence: { adapter: ADAPTER, surface: 'desktop', providerVersion: 'unverified', signal },
  };
}

// Maps one app-server notification to Pome attention events. Requests are never
// answered here: a server request that reaches this observer is reported and
// ignored so the driving client stays in charge.
function eventsFromNotification(message, tracker, { now = Date.now, threadProjects = new Map() } = {}) {
  if (!message || typeof message !== 'object') return [];
  if (message.method === 'thread/status/changed') {
    const threadId = message.params?.threadId;
    const status = message.params?.status;
    const flags = status?.type === 'active' ? status.activeFlags : [];
    return tracker.apply({ threadId, flags, project: threadProjects.get(threadId) || '', occurredAt: now() });
  }
  return [];
}

function createCodexAttentionBridge({ codexBinary, socketPath = '', onEvents = () => {}, onRequest = () => {}, now = Date.now, spawnProcess = spawn } = {}) {
  const tracker = createTracker();
  const threadProjects = new Map();
  let child = null, buffer = '', nextId = 1, running = false, client = {};
  function send(message) { if (child?.stdin?.writable) child.stdin.write(JSON.stringify(message) + '\n'); }
  function request(method, params) { const id = nextId++; send({ jsonrpc: '2.0', id, method, params }); return id; }
  function handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method && message.id !== undefined) {
      // A server request. Pome is an observer: never answer, never authorize.
      onRequest({ method: message.method, id: message.id });
      return;
    }
    if (message.method === 'thread/status/changed') {
      const events = eventsFromNotification(message, tracker, { now, threadProjects });
      if (events.length) onEvents(events);
      return;
    }
    if (message.id !== undefined) {
      client.lastResponse = message;
      if (message.result?.data && Array.isArray(message.result.data)) {
        for (const thread of message.result.data) {
          if (thread?.id) threadProjects.set(thread.id, String(thread.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '');
        }
      }
    }
  }
  return {
    get running() { return running; },
    get client() { return client; },
    eventsFromNotification: message => eventsFromNotification(message, tracker, { now, threadProjects }),
    start() {
      if (running || !codexBinary) return false;
      const args = ['app-server', 'proxy'];
      if (socketPath) args.push('--sock', socketPath);
      child = spawnProcess(codexBinary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      running = true;
      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) handleLine(line);
        }
      });
      child.on('error', () => { running = false; });
      child.on('exit', () => { running = false; tracker.reset(); });
      request('initialize', { clientInfo: { name: 'pome-panel', title: 'Pome Panel', version: client.version || '0.0.0' } });
      send({ jsonrpc: '2.0', method: 'initialized' });
      request('thread/list', { limit: 50 });
      return true;
    },
    stop() { running = false; try { child?.kill('SIGTERM'); } catch {} child = null; },
  };
}

module.exports = { WAITING_ACTIONS, waitingAction, createTracker, eventsFromNotification, createCodexAttentionBridge };
