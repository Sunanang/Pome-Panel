#!/usr/bin/env node
'use strict';

/**
 * Ask Pome Panel's top bubble to send the user back to Cursor for MCP OAuth.
 * Agents should run this when an MCP namespace reports needsAuth / mcp_auth.
 *
 *   node scripts/cursor-mcp-auth-notify.js --service "Google Drive"
 */
const http = require('node:http');
const { randomUUID } = require('node:crypto');

function parseArgs(argv = process.argv.slice(2)) {
  const out = { service: process.env.POME_MCP_SERVICE || '', dryRun: false, resolved: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--service' || arg === '-s') out.service = String(argv[++index] || '');
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--resolved' || arg === '--done' || arg === '--dismiss') out.resolved = true;
    else if (!arg.startsWith('-') && !out.service) out.service = arg;
  }
  return out;
}

function slug(value) {
  return String(value || 'mcp')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'mcp';
}

function buildMcpAuthNotification({ service = '', now = Date.now(), requestId = randomUUID() } = {}) {
  const label = String(service || '').trim() || 'MCP';
  return {
    source: 'cursor',
    schemaVersion: 2,
    kind: 'attention.required',
    action: 'approve',
    question: `请到 Cursor 完成 ${label} 授权`,
    project: label,
    eventId: `mcp-auth:${slug(label)}:${requestId}`,
    sessionId: `mcp-auth:${slug(label)}`,
    turnId: requestId,
    requestId,
    occurredAt: now,
    evidence: { adapter: 'cursor-mcp-auth-notify', surface: 'ide', providerVersion: 'manual', signal: 'mcp-needs-auth' },
  };
}

// Session-level "auth done". requestId/eventId identify THIS success delivery
// (main records it for dedupe). Expansion only closes pending rows for the same
// service that were already waiting at or before occurredAt — never later ones.
function buildMcpAuthResolvedNotification({ service = '', now = Date.now(), requestId = randomUUID() } = {}) {
  const label = String(service || '').trim() || 'MCP';
  return {
    source: 'cursor',
    schemaVersion: 2,
    kind: 'attention.resolved',
    reason: 'answered',
    question: '',
    project: label,
    eventId: `mcp-auth:${slug(label)}:resolved:${requestId}`,
    sessionId: `mcp-auth:${slug(label)}`,
    turnId: requestId,
    requestId,
    occurredAt: now,
    evidence: { adapter: 'cursor-mcp-auth-notify', surface: 'ide', providerVersion: 'manual', signal: 'mcp-auth-done' },
  };
}

function isMcpAuthSessionResolution(event) {
  return event?.kind === 'attention.resolved'
    && event.evidence?.adapter === 'cursor-mcp-auth-notify'
    && event.evidence?.signal === 'mcp-auth-done';
}

function pendingSeenAt(row) {
  const value = Number(row?.firstSeenAt ?? row?.event?.occurredAt);
  return Number.isFinite(value) ? value : NaN;
}

// Map a session-level "auth done" onto pending rows for that service that were
// already open at resolve time. Later requests for the same service stay open.
function expandMcpAuthSessionResolution(resolvedEvent, pendingRows = []) {
  if (!isMcpAuthSessionResolution(resolvedEvent)) return [resolvedEvent];
  const resolvedAt = Number(resolvedEvent.occurredAt);
  if (!Number.isFinite(resolvedAt)) return [];
  const matches = pendingRows.filter((row) => row?.event?.sessionId === resolvedEvent.sessionId
    && row.event?.evidence?.adapter === 'cursor-mcp-auth-notify'
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
  return new Promise((resolve) => {
    const request = http.request({
      hostname: host,
      port,
      path: '/notify/cursor',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode }));
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

async function main() {
  const args = parseArgs();
  const payload = args.resolved
    ? buildMcpAuthResolvedNotification({ service: args.service })
    : buildMcpAuthNotification({ service: args.service });
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const result = await postNotification(payload);
  if (!result.ok) {
    process.stderr.write(`pome mcp-auth notify failed: ${result.error || result.status || 'unreachable'}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${args.resolved ? 'resolved' : 'notified'}:${payload.eventId}\n`);
}

module.exports = {
  parseArgs,
  slug,
  buildMcpAuthNotification,
  buildMcpAuthResolvedNotification,
  isMcpAuthSessionResolution,
  expandMcpAuthSessionResolution,
  postNotification,
};
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}
