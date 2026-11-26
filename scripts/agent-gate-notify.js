#!/usr/bin/env node
'use strict';

/**
 * Ask Pome Panel's top bubble to send the user back to an AI client for a
 * blocking gate (MCP OAuth, command Run approval, permission / review cards…).
 *
 *   node scripts/agent-gate-notify.js --source cursor --gate command-run --label "完整权限命令"
 *   node scripts/agent-gate-notify.js --source cursor --gate mcp-auth --label "Google Drive"
 *   node scripts/agent-gate-notify.js --source cursor --gate command-run --label "完整权限命令" --resolved
 *
 * Observation only: Pome never clicks Run and never completes OAuth.
 */
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const SOURCES = Object.freeze(['cursor', 'codex', 'claude', 'grok', 'copilot', 'antigravity']);
const GATES = Object.freeze(['mcp-auth', 'command-run', 'permission', 'review', 'attention']);
// approve → 等待授权；select → 等待选择（AskQuestion）；input → 等待输入。
const ACTIONS = Object.freeze(['approve', 'select', 'input']);
const SURFACES = Object.freeze({
  cursor: 'ide', codex: 'desktop', claude: 'cli', grok: 'cli', copilot: 'cli', antigravity: 'desktop',
});
const APP_NAMES = Object.freeze({
  cursor: 'Cursor', codex: 'Codex', claude: 'Claude Code', grok: 'Grok',
  copilot: 'Copilot', antigravity: 'Antigravity',
});
const ADAPTER = 'agent-gate-notify';
// Keep accepting in-flight MCP bubbles that used the older adapter name.
const LEGACY_MCP_ADAPTER = 'cursor-mcp-auth-notify';
const SIGNAL_REQUIRED = 'gate-required';
const SIGNAL_DONE = 'gate-done';
const LEGACY_MCP_DONE = 'mcp-auth-done';

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    source: String(process.env.POME_GATE_SOURCE || 'cursor').trim().toLowerCase() || 'cursor',
    gate: String(process.env.POME_GATE_TYPE || 'attention').trim().toLowerCase() || 'attention',
    action: String(process.env.POME_GATE_ACTION || '').trim().toLowerCase(),
    label: process.env.POME_GATE_LABEL || '',
    dryRun: false,
    resolved: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => String(argv[++index] || '');
    if (arg === '--source' || arg === '-s') out.source = next().trim().toLowerCase();
    else if (arg === '--gate' || arg === '-g') out.gate = next().trim().toLowerCase();
    else if (arg === '--action' || arg === '-a') out.action = next().trim().toLowerCase();
    else if (arg === '--label' || arg === '--service' || arg === '-l') out.label = next();
    else if (arg === '--dry-run' || arg === '--dry') out.dryRun = true;
    else if (arg === '--resolved' || arg === '--done' || arg === '--dismiss') out.resolved = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!arg.startsWith('-') && !out.label) out.label = arg;
  }
  return out;
}

function assertKnownSource(source) {
  const value = String(source || '').trim().toLowerCase();
  if (!SOURCES.includes(value)) {
    throw new Error(`unknown source "${source || ''}"; expected ${SOURCES.join('|')}`);
  }
  return value;
}

// 默认按门类推断：授权类门类走 approve；attention 默认 approve，选择/输入需显式 --action。
function assertKnownAction(action, gate) {
  const value = String(action || '').trim().toLowerCase();
  if (!value) return 'approve';
  if (!ACTIONS.includes(value)) {
    throw new Error(`unknown action "${action}"; expected ${ACTIONS.join('|')}`);
  }
  return value;
}

function assertKnownGate(gate) {
  const value = String(gate || '').trim().toLowerCase();
  if (!GATES.includes(value)) {
    throw new Error(`unknown gate "${gate || ''}"; expected ${GATES.join('|')}`);
  }
  return value;
}

function slug(value, fallback = 'gate') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || fallback;
}

function normalizeGate(gate) {
  const value = String(gate || '').trim().toLowerCase();
  return GATES.includes(value) ? value : null;
}

function normalizeSource(source) {
  const value = String(source || '').trim().toLowerCase();
  return SOURCES.includes(value) ? value : null;
}

function labelText(label, gate) {
  const trimmed = String(label || '').trim();
  if (trimmed) return trimmed;
  if (gate === 'mcp-auth') return 'MCP';
  if (gate === 'command-run') return '命令批准';
  if (gate === 'permission') return '权限确认';
  if (gate === 'review') return '审批确认';
  return '待处理事项';
}

function questionFor(source, gate, label, action = 'approve') {
  const app = APP_NAMES[source] || '客户端';
  // 选择 / 输入是 Cursor 等客户端的 AskQuestion 类卡点，文案与气泡类型必须对应，
  // 否则会显示成「等待授权」，用户会去找根本不存在的授权按钮。
  if (action === 'select') return `请到 ${app} 做选择：${label}`;
  if (action === 'input') return `请到 ${app} 填写后继续：${label}`;
  if (gate === 'mcp-auth') return `请到 ${app} 完成 ${label} 授权`;
  if (gate === 'command-run') return `请到 ${app} 点 Run 批准：${label}`;
  if (gate === 'permission') return `请到 ${app} 完成权限确认：${label}`;
  if (gate === 'review') return `请到 ${app} 确认审批：${label}`;
  return `请到 ${app} 处理：${label}`;
}

function sessionIdFor(source, gate, label) {
  const key = slug(label, gate === 'mcp-auth' ? 'mcp' : gate);
  // Cursor MCP keeps the historical session id so either notify script can open/close.
  if (gate === 'mcp-auth' && source === 'cursor') return `mcp-auth:${key}`;
  if (gate === 'mcp-auth') return `mcp-auth:${source}:${key}`;
  return `gate:${source}:${gate}:${key}`;
}

function sessionIdAliases(source, gate, label) {
  const primary = sessionIdFor(source, gate, label);
  if (gate !== 'mcp-auth') return [primary];
  const key = slug(label, 'mcp');
  const aliases = new Set([primary]);
  // Cover brief dual-namespace opens while agents migrate off gate:<source>:mcp-auth:*.
  aliases.add(`gate:${source}:mcp-auth:${key}`);
  if (source === 'cursor') aliases.add(`mcp-auth:${key}`);
  else aliases.add(`mcp-auth:${source}:${key}`);
  return [...aliases];
}

function isGateAdapter(adapter) {
  return adapter === ADAPTER || adapter === LEGACY_MCP_ADAPTER;
}

function buildGateNotification({
  source = 'cursor',
  gate = 'attention',
  action = '',
  label = '',
  now = Date.now(),
  requestId = randomUUID(),
} = {}) {
  const resolvedSource = assertKnownSource(source);
  const resolvedGate = assertKnownGate(gate);
  const resolvedAction = assertKnownAction(action, resolvedGate);
  const resolvedLabel = labelText(label, resolvedGate);
  const id = String(requestId || randomUUID());
  const eventPrefix = resolvedGate === 'mcp-auth' && resolvedSource === 'cursor'
    ? `mcp-auth:${slug(resolvedLabel, 'mcp')}`
    : `gate:${resolvedGate}:${slug(resolvedLabel, resolvedGate)}`;
  return {
    source: resolvedSource,
    schemaVersion: 2,
    kind: 'attention.required',
    action: resolvedAction,
    question: questionFor(resolvedSource, resolvedGate, resolvedLabel, resolvedAction),
    project: resolvedLabel,
    eventId: `${eventPrefix}:${id}`,
    sessionId: sessionIdFor(resolvedSource, resolvedGate, resolvedLabel),
    turnId: id,
    requestId: id,
    occurredAt: Number(now) > 0 ? Number(now) : Date.now(),
    evidence: {
      adapter: ADAPTER,
      surface: SURFACES[resolvedSource] || 'desktop',
      providerVersion: 'manual',
      signal: SIGNAL_REQUIRED,
      gate: resolvedGate,
    },
  };
}

function buildGateResolvedNotification({
  source = 'cursor',
  gate = 'attention',
  label = '',
  now = Date.now(),
  requestId = randomUUID(),
} = {}) {
  const resolvedSource = assertKnownSource(source);
  const resolvedGate = assertKnownGate(gate);
  const resolvedLabel = labelText(label, resolvedGate);
  const id = String(requestId || randomUUID());
  const eventPrefix = resolvedGate === 'mcp-auth' && resolvedSource === 'cursor'
    ? `mcp-auth:${slug(resolvedLabel, 'mcp')}`
    : `gate:${resolvedGate}:${slug(resolvedLabel, resolvedGate)}`;
  return {
    source: resolvedSource,
    schemaVersion: 2,
    kind: 'attention.resolved',
    reason: 'answered',
    question: '',
    project: resolvedLabel,
    eventId: `${eventPrefix}:resolved:${id}`,
    sessionId: sessionIdFor(resolvedSource, resolvedGate, resolvedLabel),
    turnId: id,
    requestId: id,
    occurredAt: Number(now) > 0 ? Number(now) : Date.now(),
    evidence: {
      adapter: ADAPTER,
      surface: SURFACES[resolvedSource] || 'desktop',
      providerVersion: 'manual',
      signal: SIGNAL_DONE,
      gate: resolvedGate,
    },
  };
}

function isAgentGateSessionResolution(event) {
  if (event?.kind !== 'attention.resolved') return false;
  const adapter = event.evidence?.adapter;
  const signal = event.evidence?.signal;
  if (adapter === ADAPTER && signal === SIGNAL_DONE) return true;
  // Older MCP success payloads.
  return adapter === LEGACY_MCP_ADAPTER && signal === LEGACY_MCP_DONE;
}

function pendingSeenAt(row) {
  const value = Number(row?.firstSeenAt ?? row?.event?.occurredAt);
  return Number.isFinite(value) ? value : NaN;
}

function expandAgentGateSessionResolution(resolvedEvent, pendingRows = []) {
  if (!isAgentGateSessionResolution(resolvedEvent)) return [resolvedEvent];
  const resolvedAt = Number(resolvedEvent.occurredAt);
  if (!Number.isFinite(resolvedAt)) return [];
  const sessionIds = new Set([resolvedEvent.sessionId].filter(Boolean));
  const gate = resolvedEvent.evidence?.gate;
  const source = resolvedEvent.source;
  if (gate && source && GATES.includes(gate) && SOURCES.includes(source)) {
    for (const id of sessionIdAliases(source, gate, resolvedEvent.project || '')) sessionIds.add(id);
  }
  const matches = pendingRows.filter((row) => sessionIds.has(row?.event?.sessionId)
    && isGateAdapter(row.event?.evidence?.adapter)
    && pendingSeenAt(row) <= resolvedAt);
  return matches.map((row) => ({
    ...resolvedEvent,
    eventId: `${row.event.eventId}-resolved`,
    requestId: row.event.requestId,
    turnId: row.event.turnId,
    sessionId: row.event.sessionId,
  }));
}

function postNotification(payload, {
  host = '127.0.0.1',
  port = Number(process.env.POME_NOTIFY_PORT) || 43821,
  timeoutMs = 900,
} = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const source = assertKnownSource(payload.source);
  return new Promise((resolve) => {
    const request = http.request({
      hostname: host,
      port,
      path: `/notify/${source}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let parsed = null;
        const text = Buffer.concat(chunks).toString('utf8');
        if (text) {
          try { parsed = JSON.parse(text); } catch { /* non-JSON bodies still count as transport ok */ }
        }
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body: parsed,
        });
      });
      response.on('error', () => resolve({ ok: false, status: 0 }));
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
    request.on('error', (error) => resolve({ ok: false, status: 0, error: error.code || error.message }));
    request.end(body);
  });
}

const USAGE = [
  'Usage: node scripts/agent-gate-notify.js --source <cursor|codex|claude|...> --gate <type> --label "<text>"',
  '  --gate mcp-auth|command-run|permission|review|attention',
  '  --action approve|select|input   approve=等待授权(默认); select=等待选择(AskQuestion); input=等待输入',
  '  --label / --service   human label shown in the bubble',
  '  --resolved            close matching pending bubbles for this gate+label',
  '  --dry-run             print the event instead of posting it',
].join('\n');

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const source = assertKnownSource(args.source);
  const gate = assertKnownGate(args.gate);
  const payload = args.resolved
    ? buildGateResolvedNotification({ source, gate, label: args.label })
    : buildGateNotification({ source, gate, action: args.action, label: args.label });
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const result = await postNotification(payload);
  if (!result.ok) {
    process.stderr.write(`pome agent-gate notify failed: ${result.error || result.status || 'unreachable'}\n`);
    process.exitCode = 1;
    return;
  }
  // HTTP 202 + ignored means the receipt was stored but no open bubble matched —
  // agents must not treat that as a successful dismiss.
  if (args.resolved && result.body?.result === 'ignored') {
    process.stderr.write('pome agent-gate: no matching pending bubble to resolve\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${args.resolved ? 'resolved' : 'notified'}:${payload.eventId}\n`);
}

module.exports = {
  SOURCES,
  GATES,
  ADAPTER,
  LEGACY_MCP_ADAPTER,
  parseArgs,
  slug,
  normalizeGate,
  normalizeSource,
  ACTIONS,
  assertKnownSource,
  assertKnownGate,
  assertKnownAction,
  questionFor,
  sessionIdFor,
  sessionIdAliases,
  isGateAdapter,
  buildGateNotification,
  buildGateResolvedNotification,
  isAgentGateSessionResolution,
  expandAgentGateSessionResolution,
  postNotification,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}
