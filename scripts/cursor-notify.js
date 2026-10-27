#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
// Cursor's afterAgentResponse supplies text; stop supplies completed/aborted/error.
// Correlate by both conversation and generation, never by project or file mtime.
const SUMMARY_TTL_MS = 10 * 60 * 1000;
function summaryCache(payload, { cacheDir = path.join(os.homedir(), '.cursor', '.pome-completion-cache'), now = Date.now } = {}) {
  if (!payload.conversation_id || !payload.generation_id) return '';
  const key = createHash('sha256').update(JSON.stringify([payload.conversation_id, payload.generation_id])).digest('hex');
  const file = path.join(cacheDir, key + '.json');
  try {
    if (fs.existsSync(cacheDir) && fs.lstatSync(cacheDir).isSymbolicLink()) return '';
    if (payload.hook_event_name === 'afterAgentResponse') {
      if (typeof payload.text !== 'string' || !payload.text.trim()) return '';
      fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      // Bounded, short-lived final responses only; never store transcripts/tokens.
      const entries = fs.readdirSync(cacheDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
      for (const name of entries) {
        const target = path.join(cacheDir, name), stat = fs.lstatSync(target);
        if (now() - stat.mtimeMs > SUMMARY_TTL_MS) fs.unlinkSync(target);
      }
      if (fs.readdirSync(cacheDir).length >= 256) return '';
      const temporary = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ at: now(), text: payload.text.slice(0, 4096) }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
      return '';
    }
    if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 32768) return '';
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.unlinkSync(file);
    return now() - result.at >= 0 && now() - result.at <= SUMMARY_TTL_MS && typeof result.text === 'string' ? result.text.slice(0, 4096) : '';
  } catch { return ''; }
}
function transcriptSummary(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return '';
    const size = Math.min(stat.size, 256 * 1024), buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    const lines = buffer.toString('utf8').split('\n');
    if (stat.size > size) lines.shift();
    for (const line of lines.reverse()) {
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (entry.isSidechain || entry.isMeta) continue;
      const message = entry.message || entry;
      if (message.role !== 'assistant' && entry.type !== 'assistant') continue;
      const content = message.content;
      return (typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text || '').join('\n') : '').slice(0, 4096);
    }
  } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  return '';
}
function cursorCompletion(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || payload.agent_id) return null;
  if (payload.hook_event_name === 'afterAgentResponse') { if (!payload._pome_test) summaryCache(payload, options); return null; }
  if (payload.hook_event_name && payload.hook_event_name !== 'stop') return null;
  const status = payload.status === 'error' ? 'failed' : payload.status || 'completed';
  if (!['completed', 'due', 'failed', 'awaiting'].includes(status)) return null; // aborted is not a success.
  const conversation = String(payload.conversation_id || ''), generation = String(payload.generation_id || '');
  const summary = payload.last_assistant_message || payload.completionSummary
    || (!payload._pome_test && (summaryCache(payload, options) || transcriptSummary(payload.transcript_path))) || '';
  return { ...payload, status, source: 'cursor', session_id: conversation,
    event_id: conversation && generation ? `${conversation}:${generation}` : payload.event_id,
    completed_at: payload.completed_at || Date.now(), cwd: payload.cwd || payload.workspace_roots?.[0] || '',
    last_assistant_message: summary, title: payload.title || '' };
}
function main() {
  // Grok Build also loads Cursor hooks; leave those sessions to grok-notify.
  if (process.env.GROK_HOOK_EVENT) return;
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
module.exports = { cursorCompletion, summaryCache, transcriptSummary };
