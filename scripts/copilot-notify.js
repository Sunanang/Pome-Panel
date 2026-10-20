#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const F = require('./completion-forwarder');
function lastAssistant(transcriptPath) {
  if (!F.text(transcriptPath) || !path.isAbsolute(transcriptPath)) return null;
  let fd;
  try {
    if (!fs.lstatSync(transcriptPath).isFile()) return null;
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size, length = Math.min(size, 256 * 1024), buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let row; try { row = JSON.parse(lines[i]); } catch { continue; }
      if (F.ignored(row) || F.ignored(row.data || {})) continue;
      if (['user.message', 'assistant.turn_start'].includes(row.type)) return null;
      if (row.type !== 'assistant.message') continue;
      return { id: F.text(row.data?.messageId || row.id),
        text: row.data?.toolRequests?.length ? '' : F.text(row.data?.content) };
    }
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  return null;
}
function copilotCompletion(p, { event = process.env.POME_COMPLETION_EVENT, readTranscript = lastAssistant } = {}) {
  if (F.ignored(p)) return null;
  const name = F.eventName(p.hook_event_name || p.hookEventName || event);
  const session = F.text(p.sessionId || p.session_id);
  if (!session) return null;
  let status = 'completed', summary = '', record = null;
  if (p._pome_test !== true) {
    if (name === 'agentstop' || name === 'stop') {
      if ((p.stopReason || p.stop_reason) !== 'end_turn') return null;
      record = readTranscript(p.transcriptPath || p.transcript_path);
      summary = record?.text || '';
    } else if (name === 'erroroccurred') {
      if (p.recoverable !== false || !['model_call', 'system'].includes(p.errorContext || p.error_context)) return null;
      status = 'failed'; summary = F.safeError(p.error?.message);
    } else return null;
  } else summary = F.text(p.title);
  const time = F.timestamp(p.timestamp);
  const explicit = F.text(p.event_id || p.eventId);
  if (!explicit && !record?.id && !time) return null;
  const id = explicit || F.identity(['copilot', session, status, record?.id || time]);
  return F.envelope('copilot', p, { session, id, status, summary });
}
if (require.main === module) F.run(copilotCompletion).finally(() => process.exit(0));
module.exports = { copilotCompletion, lastAssistant };
