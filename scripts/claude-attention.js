#!/usr/bin/env node
'use strict';
// Observation only. Empty stdout and exit 0 on every path: never decide whether
// Claude can run a tool and never answer a question on the user's behalf.
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeQuestion, safeCommandPreview } = require('../aiEventPolicy');
function observation(payload) {
  if (!payload || payload.agent_id || payload.isSidechain || String(process.env.CLAUDE_CODE_REMOTE).toLowerCase() === 'true') return null;
  const allowed = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'UserPromptSubmit', 'Stop', 'SessionEnd'];
  if (!allowed.includes(payload.hook_event_name) || typeof payload.session_id !== 'string') return null;
  let question = '', action, sensitive = false;
  if (payload.hook_event_name === 'PreToolUse') {
    if (payload.tool_name !== 'AskUserQuestion' || !payload.tool_use_id) return null;
    const questions = payload.tool_input?.questions;
    if (!Array.isArray(questions) || !questions.length || !questions.every(item => typeof item.question === 'string')) return null;
    question = questions.map(item => safeQuestion(item.question).question).filter(Boolean).join(' / ');
    sensitive = questions.some(item => safeQuestion(item.question).sensitive);
    // AskUserQuestion is documented as multiple choice. Do not infer free input
    // merely because an unexpected/empty options array was supplied.
    if (!questions.some(item => Array.isArray(item.options) && item.options.length)) return null;
    action = 'select';
  } else if (payload.hook_event_name === 'Notification') {
    if (!['permission_prompt', 'elicitation_dialog'].includes(payload.notification_type)) return null;
    // Permission notification bodies can contain commands. Keep only a generic
    // safe summary; the original permission dialog remains in Claude.
    question = payload.notification_type === 'permission_prompt' ? '' : safeQuestion(payload.message).question;
    sensitive = payload.notification_type === 'permission_prompt' || safeQuestion(payload.message).sensitive;
  }
  return { _pome_claude_observation: true, hook_event_name: payload.hook_event_name,
    session_id: payload.session_id.slice(0,320), prompt_id: typeof payload.prompt_id === 'string' ? payload.prompt_id.slice(0,320) : undefined,
    tool_use_id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id.slice(0,320) : undefined,
    tool_name: payload.tool_name === 'AskUserQuestion' ? 'AskUserQuestion' : undefined,
    notification_type: payload.notification_type, action, question, sensitive,
    // One hook invocation is one observation. Re-delivering this observation
    // keeps its identity; another invocation (even identical text) gets a new one.
    observation_id: randomUUID(),
    notification_id: typeof payload.notification_id === 'string' ? payload.notification_id.slice(0,320) : undefined,
    request_id: typeof payload.request_id === 'string' ? payload.request_id.slice(0,320) : undefined,
    commandPreview: payload.hook_event_name === 'Notification' && payload.notification_type === 'permission_prompt'
      ? safeCommandPreview(payload.message) : undefined,
    project: typeof payload.cwd === 'string' ? safeQuestion(path.basename(payload.cwd)).question : '',
  };
}
async function main() {
  let input = ''; const deadline = setTimeout(() => process.exit(0), 1800);
  process.stdin.on('data', chunk => { if (input.length < 65536) input += chunk; else process.exit(0); });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    let payload; try { payload = observation(JSON.parse(input)); } catch { return process.exit(0); }
    if (!payload) return process.exit(0);
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request({ hostname: '127.0.0.1', port: Number(process.env.POME_NOTIFY_PORT) || 43821, path: '/notify/claude', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, res => { res.resume(); res.on('end', () => { clearTimeout(deadline); process.exit(0); }); });
    req.setTimeout(900, () => req.destroy()); req.on('error', () => process.exit(0)); req.end(body);
  });
}
if (require.main === module) main().catch(() => process.exit(0));
module.exports = { observation };
