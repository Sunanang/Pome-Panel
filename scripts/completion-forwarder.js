'use strict';
// Observation-only transport shared by local completion adapters. No decisions,
// credentials, configuration writes or stdout: never interfere with the agent.
const http = require('node:http');
const { createHash } = require('node:crypto');
const text = value => typeof value === 'string' ? value.trim() : '';
const eventName = value => text(value).replace(/[\s_-]/g, '').toLowerCase();
const identity = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function timestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = typeof value === 'number' || /^\d+(\.\d+)?$/.test(text(value)) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const n = Math.trunc(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function ignored(p) {
  return !p || typeof p !== 'object' || Array.isArray(p)
    || Boolean(p.agentId || p.agent_id || p.parentAgentId || p.parent_agent_id || p.subagentType || p.subagent_type
      || p.subagentId || p.parentConversationId || p.parent_conversation_id || p.isSubagent || p.is_subagent || p.isSidechain)
    || /subagent/i.test(text(p.agentType || p.agent_type))
    || p.remote === true || p.is_remote === true || p.cloud === true || p.surface === 'cloud'
    || ['cancelled', 'aborted', 'interrupted'].includes(p.status);
}
function envelope(source, p, { session, id, status, summary = '', cwd = p.cwd, window, turnId, title, completedAt } = {}) {
  return {
    source, hook_event_name: 'Stop', session_id: session, event_id: id, status,
    completed_at: completedAt || timestamp(p.completed_at || p.completedAt || p.timestamp) || Date.now(),
    sender_pid: process.pid,
    cwd: text(cwd), ...(window ? { window } : {}),
    ...(turnId ? { turn_id: turnId } : {}),
    ...(title !== undefined ? { title: text(title) } : {}),
    last_assistant_message: text(summary).slice(0, 4096),
    _pome_test: p._pome_test === true, _pome_test_token: p._pome_test_token,
  };
}
function safeError(value) {
  const s = text(value);
  // Errors can echo request headers. Do not retain stack traces or credentials.
  return /bearer\s|(?:token|secret|api[_-]?key|password)["']?\s*[=:]|https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(s) ? '' : s.slice(0, 4096);
}
async function run(adapter) {
  const deadline = setTimeout(() => process.exit(0), 2800);
  try {
    const raw = await new Promise(resolve => {
      let bytes = 0, done = false; const chunks = [];
      const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => finish(null), 1500);
      process.stdin.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) finish(null); else chunks.push(chunk); });
      process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
      process.stdin.on('error', () => finish(null));
    });
    if (raw === null) return;
    const result = adapter(JSON.parse(raw));
    if (!result) return;
    await new Promise(resolve => {
      const body = Buffer.from(JSON.stringify(result));
      const request = http.request({ hostname: '127.0.0.1', port: Number(process.env.POME_NOTIFY_PORT) || 43821,
        path: `/notify/${result.source}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, res => {
        res.resume(); res.on('end', resolve); res.on('error', resolve); res.on('aborted', resolve);
      });
      const timer = setTimeout(() => { request.destroy(); resolve(); }, 900);
      request.on('error', resolve); request.on('close', () => { clearTimeout(timer); resolve(); }); request.end(body);
    });
  } catch { /* Failed observation must never block or print private payloads. */ }
  finally { clearTimeout(deadline); }
}
module.exports = { text, eventName, identity, timestamp, ignored, envelope, safeError, run };
