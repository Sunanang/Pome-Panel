#!/usr/bin/env node
'use strict';
const http = require('node:http');
// https://cursor.com/docs/hooks: hooks.stop, conversation_id + generation_id.
function cursorCompletion(payload) {
  if (!payload || typeof payload !== 'object' || payload.agent_id || (payload.hook_event_name && payload.hook_event_name !== 'stop')) return null;
  if (payload.status && !['completed', 'due', 'failed', 'awaiting'].includes(payload.status)) return null;
  const conversation = String(payload.conversation_id || ''), generation = String(payload.generation_id || '');
  return { ...payload, source: 'cursor', session_id: conversation,
    event_id: conversation && generation ? `${conversation}:${generation}` : payload.event_id,
    completed_at: payload.completed_at || Date.now(), cwd: payload.cwd || payload.workspace_roots?.[0] || '',
    title: payload.title || 'Cursor 已完成任务' };
}
function main() {
  let input = ''; const timer = setTimeout(() => process.exit(0), 2000);
  process.stdin.on('data', chunk => { if (input.length < 1024 * 1024) input += chunk; });
  process.stdin.on('end', () => {
    let payload; try { payload = cursorCompletion(JSON.parse(input)); } catch { clearTimeout(timer); return; }
    if (!payload) { clearTimeout(timer); return; }
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request({ hostname: '127.0.0.1', port: Number(process.env.POME_NOTIFY_PORT) || 43821, path: '/notify/cursor', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, res => { res.resume(); res.on('end', () => clearTimeout(timer)); });
    req.setTimeout(900, () => req.destroy()); req.on('error', () => clearTimeout(timer)); req.on('close', () => clearTimeout(timer)); req.end(body);
  });
  process.stdin.on('error', () => clearTimeout(timer));
}
if (require.main === module) main();
module.exports = { cursorCompletion };
