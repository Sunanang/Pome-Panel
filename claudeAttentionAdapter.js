'use strict';
const { randomUUID } = require('node:crypto');
const { safeQuestion, hash } = require('./aiEventPolicy');
// Receives only the minimal observation copy from claude-attention.js. No tool
// response, command, answer, environment or permission decision crosses here.
function createClaudeAttentionAdapter() {
  const sessions = new Map();
  function observe(payload) {
    if (!payload.session_id || payload.agent_id || payload.remote === true) return [];
    const sessionId = String(payload.session_id), signal = payload.hook_event_name;
    let session = sessions.get(sessionId);
    if (!session) { session = { turnId: payload.prompt_id || randomUUID(), sequence: 0, requests: new Map() }; sessions.set(sessionId, session); }
    const make = (kind, extra = {}, turnId = session.turnId) => ({ schemaVersion: 2, kind, source: 'claude',
      eventId: randomUUID(), sessionId, turnId, occurredAt: Date.now(), sequence: ++session.sequence,
      evidence: { adapter: 'claude-command-hook', surface: 'cli', providerVersion: payload.provider_version || 'unverified', signal }, ...extra });
    if (signal === 'UserPromptSubmit') {
      const events = [make('turn.started')];
      session.turnId = payload.prompt_id || randomUUID(); session.requests.clear(); return events;
    }
    if (payload.prompt_id && payload.prompt_id !== session.turnId) {
      session.turnId = payload.prompt_id; session.requests.clear();
    }
    if (signal === 'Stop' || signal === 'SessionEnd') {
      const events = [...session.requests.keys()].map(requestId => make('attention.resolved', { requestId, reason: signal === 'Stop' ? 'continued' : 'terminated' }));
      session.requests.clear(); return events;
    }
    if (signal === 'PreToolUse' && payload.tool_name === 'AskUserQuestion' && payload.tool_use_id) {
      const requestId = String(payload.tool_use_id);
      if (!['input', 'select'].includes(payload.action) || !payload.question && !payload.sensitive) return [];
      session.requests.set(requestId, { type: 'question' });
      return [make('attention.required', { requestId, action: payload.action, question: payload.question, sensitive: payload.sensitive, project: payload.project })];
    }
    if (['PostToolUse', 'PostToolUseFailure'].includes(signal) && payload.tool_use_id) {
      const requestId = String(payload.tool_use_id), events = [];
      if (session.requests.has(requestId)) {
        events.push(make('attention.resolved', { requestId, reason: signal === 'PostToolUse' ? 'answered' : 'cancelled' }));
        session.requests.delete(requestId);
      }
      // A generic permission Notification has no tool-use identity. An unrelated
      // tool result cannot resolve it; wait for an unambiguous session boundary.
      return events;
    }
    if (signal === 'Notification' && ['permission_prompt', 'elicitation_dialog'].includes(payload.notification_type)) {
      const action = payload.notification_type === 'permission_prompt' ? 'approve' : 'input';
      const fingerprint = hash([payload.notification_type, safeQuestion(payload.question).question]);
      const existing = [...session.requests.entries()].find(([, request]) => request.fingerprint === fingerprint);
      const requestId = existing?.[0] || `notification:${randomUUID()}`;
      session.requests.set(requestId, { type: 'notification', fingerprint });
      return [make('attention.required', { requestId, action, question: payload.question, sensitive: payload.sensitive, project: payload.project })];
    }
    return [];
  }
  return { observe, snapshot: () => structuredClone(sessions), restore(snapshot) {
    sessions.clear(); for (const [key, value] of snapshot) sessions.set(key, value);
  } };
}
module.exports = { createClaudeAttentionAdapter };
