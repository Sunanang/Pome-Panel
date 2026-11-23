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
// 同时出现多种等待时，授权优先于输入：授权更阻塞、也更敏感。
const WAITING_FLAG_PRIORITY = Object.freeze(['waitingOnApproval', 'waitingOnUserInput']);
const ADAPTER = 'codex-app-server-bridge';
const STOP_KILL_MS = 2000;

function waitingAction(flags) {
  if (!Array.isArray(flags)) return null;
  const present = new Set(flags);
  for (const flag of WAITING_FLAG_PRIORITY) if (present.has(flag)) return WAITING_ACTIONS[flag];
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
    // 观察者退出时必须把已宣告的等待收成 resolved，否则顶部气泡会挂死。
    flushResolved({ occurredAt, projects = new Map() } = {}) {
      const at = Number(occurredAt) > 0 ? Number(occurredAt) : Date.now();
      const events = [];
      for (const [threadId, action] of announced) {
        events.push(resolvedEvent({
          threadId,
          project: projects.get(threadId) || '',
          action,
          occurredAt: at,
        }));
      }
      announced.clear();
      return events;
    },
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

function createCodexAttentionBridge({ codexBinary, socketPath = '', onEvents = () => {}, onRequest = () => {}, onExit = () => {}, now = Date.now, spawnProcess = spawn, stopKillMs = STOP_KILL_MS } = {}) {
  const tracker = createTracker();
  const threadProjects = new Map();
  let child = null, buffer = '', nextId = 1, running = false, client = {}, intentionalStop = false, settled = false, stopTimer = null;
  function send(message) { if (child?.stdin?.writable) child.stdin.write(JSON.stringify(message) + '\n'); }
  function request(method, params) { const id = nextId++; send({ jsonrpc: '2.0', id, method, params }); return id; }
  function emitResolved() {
    const events = tracker.flushResolved({ occurredAt: now(), projects: threadProjects });
    if (events.length) onEvents(events);
  }
  function clearStopTimer() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  }
  function settle() {
    if (settled) return;
    settled = true;
    running = false;
    child = null;
    buffer = '';
    clearStopTimer();
    emitResolved();
    if (!intentionalStop) onExit();
  }
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
      intentionalStop = false;
      settled = false;
      clearStopTimer();
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
      // error 与 exit 都可能单独到达；settle 去重，避免气泡挂死或重复 onExit。
      child.on('error', () => settle());
      child.on('exit', () => settle());
      request('initialize', { clientInfo: { name: 'pome-panel', title: 'Pome Panel', version: client.version || '0.0.0' } });
      send({ jsonrpc: '2.0', method: 'initialized' });
      request('thread/list', { limit: 50 });
      return true;
    },
    stop() {
      intentionalStop = true;
      running = false;
      const active = child;
      child = null;
      if (!active) {
        settle();
        return;
      }
      try { active.kill('SIGTERM'); } catch { settle(); return; }
      // kill 可能同步触发 exit→settle；只有仍僵住时才升级 SIGKILL。
      if (settled) return;
      clearStopTimer();
      stopTimer = setTimeout(() => {
        stopTimer = null;
        try { active.kill('SIGKILL'); } catch { /* already gone */ }
        settle();
      }, Math.max(0, Number(stopKillMs) || STOP_KILL_MS));
    },
  };
}

module.exports = { WAITING_ACTIONS, WAITING_FLAG_PRIORITY, waitingAction, createTracker, eventsFromNotification, createCodexAttentionBridge, STOP_KILL_MS };
