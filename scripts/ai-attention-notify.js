#!/usr/bin/env node
'use strict';

/**
 * Ask Pome Panel's top bubble to remind the user that a local AI client is
 * waiting for them (input, a choice, or an approval).
 *
 * Codex and Cursor have no hook for "the model asked me something": Codex only
 * calls notify on turn end and Cursor's hook list has no question event. Any
 * local wrapper, MCP tool or shell alias can therefore report the wait itself:
 *
 *   node scripts/ai-attention-notify.js --source codex --action input \
 *     --question "这次改动要不要先出预览？" --project Pome-Panel
 *   node scripts/ai-attention-notify.js --source codex --resolved --request <id>
 *
 * Observation only: Pome stores the reminder and sends the user back to the
 * source app. It never answers the question and never decides an approval.
 */
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { safeQuestion } = require('../aiEventPolicy');

const SOURCES = Object.freeze(['codex', 'cursor', 'claude', 'grok', 'copilot', 'antigravity']);
const ACTIONS = Object.freeze(['input', 'select', 'approve']);
const REASONS = Object.freeze(['answered', 'cancelled', 'continued', 'terminated']);
const SURFACES = Object.freeze({ codex: 'desktop', cursor: 'ide', claude: 'cli', grok: 'cli', copilot: 'cli', antigravity: 'desktop' });
const ADAPTER = 'pome-attention-notify';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { source: 'codex', action: null, question: '', project: '', sessionId: '', requestId: '',
    resolved: false, reason: 'answered', dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index], next = () => String(argv[++index] || '');
    if (arg === '--source' || arg === '-s') out.source = next().trim().toLowerCase();
    else if (arg === '--action' || arg === '-a') out.action = next().trim().toLowerCase();
    else if (arg === '--question' || arg === '-q') out.question = next();
    else if (arg === '--project' || arg === '-p') out.project = next();
    else if (arg === '--session') out.sessionId = next();
    else if (arg === '--request') out.requestId = next();
    else if (arg === '--reason') out.reason = next().trim().toLowerCase();
    else if (arg === '--resolved' || arg === '--done') out.resolved = true;
    else if (arg === '--dry-run' || arg === '--dry') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function actionFor(source, action) {
  if (action && ACTIONS.includes(action)) return action;
  return 'input';
}

// One invocation is one request. Retransmitting with the same --request keeps its
// identity so the receiver dedupes instead of stacking bubbles.
function buildAttentionNotification({ source = 'codex', action = 'input', question = '', project = '',
  sessionId = '', requestId = '', occurredAt = Date.now() } = {}) {
  if (!SOURCES.includes(source)) throw new Error('unsupported_source');
  const resolvedAction = actionFor(source, action);
  const id = String(requestId || randomUUID());
  const safe = safeQuestion(question, resolvedAction);
  return {
    source,
    schemaVersion: 2,
    kind: 'attention.required',
    action: resolvedAction,
    question: safe.question,
    sensitive: safe.sensitive,
    commandPreview: safe.commandPreview,
    project: safeQuestion(project).question,
    eventId: 'attention:' + id,
    sessionId: String(sessionId || source + ':' + id),
    turnId: id,
    requestId: id,
    occurredAt: Number(occurredAt) > 0 ? Number(occurredAt) : Date.now(),
    evidence: { adapter: ADAPTER, surface: SURFACES[source] || 'desktop', providerVersion: 'manual', signal: 'attention-notify' },
  };
}

function buildResolvedNotification({ source = 'codex', reason = 'answered', requestId = '', sessionId = '',
  occurredAt = Date.now() } = {}) {
  if (!SOURCES.includes(source)) throw new Error('unsupported_source');
  const id = String(requestId || '');
  if (!id) throw new Error('request_required');
  return {
    source,
    schemaVersion: 2,
    kind: 'attention.resolved',
    reason: REASONS.includes(reason) ? reason : 'answered',
    question: '',
    eventId: 'attention:' + id + ':resolved',
    sessionId: String(sessionId || source + ':' + id),
    turnId: id,
    requestId: id,
    occurredAt: Number(occurredAt) > 0 ? Number(occurredAt) : Date.now(),
    evidence: { adapter: ADAPTER, surface: SURFACES[source] || 'desktop', providerVersion: 'manual', signal: 'attention-notify' },
  };
}

function postNotification(payload, { host = '127.0.0.1', port = Number(process.env.POME_NOTIFY_PORT) || 43821, timeoutMs = 900 } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve) => {
    const request = http.request({ hostname: host, port, path: '/notify/' + payload.source, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (response) => {
      response.resume();
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode }));
      response.on('error', () => resolve({ ok: false, status: 0 }));
    });
    request.setTimeout(timeoutMs, () => { request.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    request.on('error', (error) => resolve({ ok: false, status: 0, error: error.code || error.message }));
    request.end(body);
  });
}

const USAGE = [
  'Usage: node scripts/ai-attention-notify.js --source <codex|cursor|claude|grok|copilot|antigravity> [options]',
  '  --action input|select|approve   what the client is waiting for (default: input)',
  '  --question "<text>"             one-line summary shown in the bubble',
  '  --project "<name>"              project shown next to it',
  '  --request "<id>"                stable request id (same id = same reminder)',
  '  --session "<id>"                optional session id',
  '  --resolved [--reason answered|cancelled|continued|terminated]',
  '  --dry-run                       print the event instead of posting it',
].join('\n');

async function main() {
  const args = parseArgs();
  if (args.help) { process.stdout.write(USAGE + '\n'); return; }
  let payload;
  try {
    payload = args.resolved
      ? buildResolvedNotification({ source: args.source, reason: args.reason, requestId: args.requestId, sessionId: args.sessionId })
      : buildAttentionNotification({ source: args.source, action: args.action || 'input', question: args.question,
        project: args.project, sessionId: args.sessionId, requestId: args.requestId });
  } catch (error) {
    process.stderr.write('pome attention notify: ' + error.message + '\n' + USAGE + '\n');
    process.exitCode = 2;
    return;
  }
  if (args.dryRun) { process.stdout.write(JSON.stringify(payload) + '\n'); return; }
  const result = await postNotification(payload);
  if (!result.ok) {
    process.stderr.write('pome attention notify failed: ' + (result.error || result.status || 'unreachable') + '\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(payload.kind + ':' + payload.requestId + '\n');
}

module.exports = { SOURCES, ACTIONS, USAGE, parseArgs, buildAttentionNotification, buildResolvedNotification, postNotification };
if (require.main === module) main().catch((error) => { process.stderr.write(((error && error.stack) || error) + '\n'); process.exitCode = 1; });
