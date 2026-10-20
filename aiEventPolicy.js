'use strict';
const { createHash } = require('node:crypto');
const { completionIds } = require('./aiProviderCatalog');
const SOURCES = new Set(completionIds());
const KINDS = new Set(['turn.started', 'turn.completed', 'turn.failed', 'attention.required', 'attention.resolved', 'turn.cancelled']);
const ACTIONS = new Set(['input', 'select', 'approve']);
const REASONS = new Set(['answered', 'cancelled', 'continued', 'terminated']);
const clean = (value, max = 160) => Array.from(typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '').slice(0, max).join('');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function knownControlEnvelope(text) {
  if (typeof text !== 'string') return false;
  const body = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  try {
    const value = JSON.parse(body), keys = value && !Array.isArray(value) && typeof value === 'object' ? Object.keys(value) : [];
    return keys.length === 1 && ['suggestions', 'exclude'].includes(keys[0]) && Array.isArray(value[keys[0]]) && !value[keys[0]].length;
  } catch { return false; }
}
function safeCommandPreview(value) {
  const text = clean(value, 4096);
  return /^(?:(?:允许运行|allow(?:\s+running)?|run|execute|approve(?:\s+running)?)\s+)?`?npm install(?:\s|$)/i.test(text) ? 'npm install' : undefined;
}
function safeQuestion(value, action) {
  const text = clean(value, 4096);
  // Never try to parse a shell command or preserve an opaque secret-bearing tail.
  const sensitive = /(?:bearer\s+\S+|(?:password|passwd|token|secret|api[_-]?key|authorization|credential|私钥|密码|密钥)\s*[=: ]|https?:\/\/[^\s/@]+:[^\s/@]+@|-----BEGIN [^-]*PRIVATE KEY|\b(?:sk|ghp|github_pat)-[\w-]{12,}|\b[A-Z][A-Z0-9_]{2,}=\S+)/i.test(text);
  // A fixed, non-parameter command label may be shown beside the mask. Nothing
  // after the allowlisted head is retained or interpreted as shell syntax.
  const commandPreview = sensitive && action === 'approve' ? safeCommandPreview(text) : undefined;
  return { question: sensitive ? '' : clean(text), sensitive, action, commandPreview };
}
function classifyAiEvent(payload, source) {
  const ignore = reason => ({ category: 'ignore', reason });
  const invalid = reason => ({ category: 'invalid', reason });
  if (!SOURCES.has(source) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('invalid_source');
  if (payload.source && payload.source !== source) return invalid('source_mismatch');
  const eventType = String(payload.hook_event_name || payload.type || payload.event_type || '').toLowerCase();
  if (payload.agent_id || payload.agentId || payload.is_subagent || payload.isSubagent || payload.isSidechain || /subagent/.test(eventType)
    || /subagent/i.test(String(payload.agent_type || payload.agentType || payload['agent-type'] || ''))) return ignore('subagent');
  if (payload.remote === true || payload.is_remote === true || payload.cloud === true || payload.surface === 'cloud' || payload.evidence?.surface === 'cloud') return ignore('remote');
  if (payload.schemaVersion !== undefined) {
    if (payload.schemaVersion !== 2 || !KINDS.has(payload.kind)) return invalid('invalid_schema');
    const evidence = payload.evidence;
    if (!evidence || typeof evidence !== 'object' || !clean(evidence.adapter) || !clean(evidence.surface)
      || !clean(evidence.signal) || !clean(evidence.providerVersion)) return invalid('evidence_required');
    for (const key of ['eventId', 'sessionId', 'turnId']) if (!clean(payload[key], 320)) return invalid(`${key}_required`);
    if (!Number.isSafeInteger(payload.occurredAt) || payload.occurredAt <= 0
      || (payload.sequence !== undefined && (!Number.isSafeInteger(payload.sequence) || payload.sequence < 0))) return invalid('invalid_order');
    const attention = payload.kind.startsWith('attention.');
    if (attention && !clean(payload.requestId, 320)) return invalid('requestId_required');
    if (payload.kind === 'attention.required' && !ACTIONS.has(payload.action)) return invalid('invalid_action');
    if (payload.kind === 'attention.resolved' && !REASONS.has(payload.reason)) return invalid('invalid_resolution');
    const safe = safeQuestion(payload.question, payload.action);
    const event = {
      schemaVersion: 2, source, kind: payload.kind, eventId: clean(payload.eventId, 320),
      sessionId: clean(payload.sessionId, 320), turnId: clean(payload.turnId, 320), requestId: clean(payload.requestId, 320),
      action: ACTIONS.has(payload.action) ? payload.action : undefined, question: payload.sensitive === true ? '' : safe.question, sensitive: payload.sensitive === true || safe.sensitive,
      commandPreview: safe.commandPreview || (payload.sensitive === true && payload.action === 'approve' && payload.commandPreview === 'npm install' ? 'npm install' : undefined),
      project: safeQuestion(payload.project).question, occurredAt: payload.occurredAt, sequence: payload.sequence,
      reason: payload.reason, evidence: Object.fromEntries(['adapter', 'surface', 'providerVersion', 'signal'].map(key => [key, clean(evidence[key], 120)])),
    };
    if (payload.kind === 'attention.required') return { category: 'attention', event };
    if (!['turn.completed', 'turn.failed'].includes(payload.kind)) return { category: 'stateOnly', event };
    const summary = clean(payload.completionSummary || payload.title, 4096);
    if (source === 'codex' && knownControlEnvelope(summary)) return { category: 'stateOnly', event, reason: 'known_control_envelope' };
    return { category: 'completion', event, completion: {
      source, event_id: event.eventId, session_id: event.sessionId, turn_id: event.turnId,
      completed_at: event.occurredAt, title: summary, project: event.project,
      status: payload.kind === 'turn.failed' ? 'failed' : 'completed',
    } };
  }
  // Legacy endpoints are completion channels. A text chunk is not a terminal event.
  if (eventType && !['agent-turn-complete', 'stop'].includes(eventType)) return ignore('non_terminal');
  if (['afteragentresponse', 'pretooluse', 'posttooluse', 'posttoolusefailure'].includes(eventType)
    || ['tool', 'user', 'system'].includes(payload.role || payload.message?.role)
    || ['commentary', 'analysis'].includes(payload.channel) || ['commentary', 'analysis'].includes(payload.phase)) return ignore('non_terminal');
  if (payload.status === 'aborted' || payload.status === 'cancelled') return ignore('cancelled');
  const text = payload.last_assistant_message || payload['last-assistant-message'] || payload.completionSummary || payload.title || '';
  if (source === 'codex' && knownControlEnvelope(text)) return ignore('known_control_envelope');
  const terminal = ['agent-turn-complete', 'stop'].includes(eventType);
  if (!String(text).trim() && !terminal && payload.status !== 'awaiting') return ignore('no_user_result');
  return { category: 'completion', completion: payload };
}
const visibleCompletion = record => !(record.source === 'codex' && knownControlEnvelope(record.completionSummary || record.title));
const requestKey = event => hash([event.source, event.evidence.surface, event.sessionId, event.turnId, event.requestId]);
module.exports = { classifyAiEvent, knownControlEnvelope, visibleCompletion, safeQuestion, safeCommandPreview, requestKey, hash };
