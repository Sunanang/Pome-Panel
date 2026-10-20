#!/usr/bin/env node
'use strict';
const F = require('./completion-forwarder');
function antigravityCompletion(p) {
  if (F.ignored(p)) return null;
  const name = F.eventName(p.hook_event_name || p.hookEventName || 'Stop');
  const session = F.text(p.conversationId);
  if (!session) return null;
  let status = 'completed', summary = '';
  if (p._pome_test !== true) {
    if (name !== 'stop' || p.fullyIdle !== true || !Number.isSafeInteger(p.executionNum) || p.executionNum < 0) return null;
    if (p.terminationReason === 'model_stop') status = 'completed';
    else if (['error', 'max_steps_exceeded'].includes(p.terminationReason)) { status = 'failed'; summary = F.safeError(p.error); }
    else return null;
    // The documented Stop envelope has no answer text. Do not infer a summary
    // from an unverified transcript format; the UI supplies its localized title.
  } else summary = F.text(p.title);
  const id = F.text(p.event_id) || F.identity(['antigravity', session, p.executionNum, status]);
  const transcript = F.text(p.transcriptPath).replace(/\\/g, '/');
  const app = /\/antigravity-cli\/brain\//.test(transcript) ? 'Terminal'
    : /\/antigravity-ide\/brain\//.test(transcript) ? 'Antigravity IDE' : 'Antigravity';
  const cwd = Array.isArray(p.workspacePaths) ? p.workspacePaths.find(value => F.text(value)) : '';
  return F.envelope('antigravity', p, { session, id, status, summary, cwd, window: { app } });
}
if (require.main === module) F.run(antigravityCompletion).finally(() => process.exit(0));
module.exports = { antigravityCompletion };
