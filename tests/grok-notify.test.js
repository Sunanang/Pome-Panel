'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const fixture = require('./fixtures/grok-stop.json');
const { grokCompletion } = require('../scripts/grok-notify');
const { createTaskInbox } = require('../taskInbox');
const { classifyAiEvent } = require('../aiEventPolicy');
const { normalizeTaskNotificationWindow, taskAppMatches } = require('../main-services');

test('Grok promptId identifies independent turns, retries dedupe and original timestamps survive', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-grok-notify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inbox = createTaskInbox({ filePath: path.join(dir, 'inbox.json') });
  const first = grokCompletion(fixture), second = grokCompletion({ ...fixture, promptId: 'grok-test-turn-2', lastAssistantMessage: 'Second result' });
  assert.notEqual(first.event_id, second.event_id);
  assert.equal(first.turn_id, fixture.promptId);
  assert.equal(first.completed_at, Date.parse(fixture.timestamp));
  assert.equal(inbox.accept(first).duplicate, false);
  assert.equal(inbox.accept(second).duplicate, false);
  assert.equal(inbox.accept(grokCompletion(fixture)).duplicate, true);
  assert.equal(inbox.list().total, 2);
  // Opaque IDs may contain separators. Two different pairs cannot collide.
  assert.notEqual(grokCompletion({ ...fixture, sessionId: 'a:b', promptId: 'c' }).event_id,
    grokCompletion({ ...fixture, sessionId: 'a', promptId: 'b:c' }).event_id);
  // The receiver bounds explicit IDs. Long opaque SDK IDs must not lose the
  // distinguishing suffix when stored.
  const longId = 'opaque-'.repeat(100);
  const longFirst = grokCompletion({ ...fixture, promptId: longId + 'one' });
  const longSecond = grokCompletion({ ...fixture, promptId: longId + 'two' });
  assert.ok(longFirst.event_id.length <= 320);
  assert.equal(inbox.accept(longFirst).duplicate, false);
  assert.equal(inbox.accept(longSecond).duplicate, false);
});

test('Grok session teardown, cancellation, non-terminal and nested failure events never notify', () => {
  for (const reason of ['shutdown', 'channel_closed', 'unknown', undefined]) {
    assert.equal(grokCompletion({ ...fixture, reason }), null, `Stop ${reason}`);
  }
  for (const hookEventName of ['stop_cancelled', 'session_end', 'subagent_stop', 'post_tool_use']) {
    assert.equal(grokCompletion({ ...fixture, hookEventName }), null, hookEventName);
  }
  for (const hookEventName of ['stop', 'stop_failure']) {
    assert.equal(grokCompletion({ ...fixture, hookEventName, subagentType: 'explore' }), null);
    assert.equal(grokCompletion({ ...fixture, hookEventName, subagent_type: 'explore' }), null);
    assert.equal(grokCompletion({ ...fixture, hookEventName, agent_id: 'child' }), null);
  }
  assert.equal(grokCompletion({ ...fixture, remote: true }), null);
  assert.equal(grokCompletion({ ...fixture, surface: 'cloud' }), null);
});

test('Grok main-session StopFailure retains error identity, summary and failed status', () => {
  const event = grokCompletion({ ...fixture, hookEventName: 'stop_failure', hook_event_name: 'StopFailure', error: 'rate_limit', lastAssistantMessage: 'Rate limit exceeded' });
  assert.equal(event.status, 'failed');
  assert.equal(event.turn_id, fixture.promptId);
  assert.equal(event.last_assistant_message, 'Rate limit exceeded');
  assert.equal(classifyAiEvent(event, 'grok').category, 'completion');
});

test('Grok legacy events without a prompt do not dedupe a whole session', () => {
  const first = grokCompletion({ ...fixture, promptId: undefined });
  const second = grokCompletion({ ...fixture, promptId: undefined, timestamp: '2026-10-20T01:05:00Z' });
  assert.notEqual(first.event_id, second.event_id);
  assert.equal(grokCompletion({ ...fixture, promptId: undefined }).event_id, first.event_id);
  assert.equal(grokCompletion({ ...fixture, promptId: undefined, timestamp: undefined, completed_at: undefined, completedAt: undefined }), null);
  assert.equal(grokCompletion({ ...fixture, promptId: undefined, timestamp: '1710000000.5' }).completed_at, 1710000000);
});

test('Grok terminal window matching preserves cwd without matching arbitrary apps', () => {
  const window = normalizeTaskNotificationWindow(grokCompletion(fixture), 'grok');
  assert.equal(window.cwd, fixture.cwd);
  assert.equal(window.bundleId, null);
  for (const appName of ['Terminal', 'Ghostty', 'WindowsTerminal', 'PowerShell']) {
    assert.equal(taskAppMatches({ source: 'grok', window }, { appName }), true);
  }
  assert.equal(taskAppMatches({ source: 'grok', window }, { appName: 'Safari' }), false);
});
