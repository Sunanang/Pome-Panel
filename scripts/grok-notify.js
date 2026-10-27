#!/usr/bin/env node
'use strict';

// Grok Build Stop / StopFailure hooks → Pome local notify receiver.
// Personal hooks live in ~/.grok/hooks/*.json; Pome owns pome-panel.json.
// Fail quietly: never block the agent turn.

const F = require('./completion-forwarder');

function summaryFrom(p) {
  for (const key of ['last_assistant_message', 'lastAssistantMessage', 'message', 'text', 'title', 'completionSummary']) {
    const value = F.text(p?.[key]);
    if (value) return value.slice(0, 4096);
  }
  return '';
}

function grokEventName(p) {
  return F.eventName(p?.hookEventName || p?.hook_event_name || process.env.GROK_HOOK_EVENT);
}

function grokCompletion(p) {
  if (F.ignored(p)) return null;
  const name = grokEventName(p);
  if (p._pome_test !== true) {
    if (name.includes('subagent')) return null;
    if (name !== 'stop' && name !== 'stopfailure') return null;
    // Stop also fires on session teardown. Only a genuine turn-end is a result.
    if (name === 'stop' && p.reason !== 'end_turn') return null;
  }
  const failed = name === 'stopfailure' || p.status === 'error' || p.status === 'failed';
  const session = F.text(p.sessionId || p.session_id || process.env.GROK_SESSION_ID);
  const turn = F.text(p.promptId || p.prompt_id || p.turnId || p.turn_id || p.generation_id);
  const time = F.timestamp(p.completed_at || p.completedAt || p.timestamp);
  const explicit = F.text(p.event_id || p.eventId);
  // Never use sessionId alone: a session can complete many independent turns.
  if (!explicit && !(session && turn) && !(session && time)) return null;
  const id = explicit || F.identity(session && turn ? [session, turn] : [session, time, name || 'stop']);
  const status = failed ? 'failed' : (p.status === 'awaiting' ? 'awaiting' : 'completed');
  const cwd = typeof p.cwd === 'string' ? p.cwd
    : (typeof p.workspaceRoot === 'string' ? p.workspaceRoot : (process.env.GROK_WORKSPACE_ROOT || ''));
  return F.envelope('grok', p, {
    session,
    id,
    status,
    summary: summaryFrom(p),
    cwd,
    turnId: turn,
    title: typeof p.title === 'string' ? p.title : '',
    completedAt: time || undefined,
  });
}

if (require.main === module) F.run(grokCompletion).finally(() => process.exit(0));
module.exports = { grokCompletion, eventName: grokEventName };
