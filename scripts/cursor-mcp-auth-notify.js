#!/usr/bin/env node
'use strict';

/**
 * Cursor MCP OAuth → Pome top bubble.
 *
 * Prefer the general scripts/agent-gate-notify.js for new gates
 * (command-run / permission / review) and non-Cursor sources. This wrapper
 * keeps the historical MCP payload shape so in-flight bubbles still resolve.
 *
 *   node scripts/cursor-mcp-auth-notify.js --service "Google Drive"
 *   node scripts/cursor-mcp-auth-notify.js --service "Google Drive" --resolved
 */
const { randomUUID } = require('node:crypto');
const gate = require('./agent-gate-notify');

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = gate.parseArgs(argv);
  return {
    service: parsed.label || process.env.POME_MCP_SERVICE || '',
    dryRun: parsed.dryRun,
    resolved: parsed.resolved,
  };
}

function slug(value) {
  return gate.slug(value, 'mcp');
}

function buildMcpAuthNotification({ service = '', now = Date.now(), requestId = randomUUID() } = {}) {
  const label = String(service || '').trim() || 'MCP';
  const id = String(requestId || randomUUID());
  return {
    source: 'cursor',
    schemaVersion: 2,
    kind: 'attention.required',
    action: 'approve',
    question: `请到 Cursor 完成 ${label} 授权`,
    project: label,
    eventId: `mcp-auth:${slug(label)}:${id}`,
    sessionId: `mcp-auth:${slug(label)}`,
    turnId: id,
    requestId: id,
    occurredAt: Number(now) > 0 ? Number(now) : Date.now(),
    evidence: {
      adapter: gate.LEGACY_MCP_ADAPTER,
      surface: 'ide',
      providerVersion: 'manual',
      signal: 'mcp-needs-auth',
      gate: 'mcp-auth',
    },
  };
}

function buildMcpAuthResolvedNotification({ service = '', now = Date.now(), requestId = randomUUID() } = {}) {
  const label = String(service || '').trim() || 'MCP';
  const id = String(requestId || randomUUID());
  return {
    source: 'cursor',
    schemaVersion: 2,
    kind: 'attention.resolved',
    reason: 'answered',
    question: '',
    project: label,
    eventId: `mcp-auth:${slug(label)}:resolved:${id}`,
    sessionId: `mcp-auth:${slug(label)}`,
    turnId: id,
    requestId: id,
    occurredAt: Number(now) > 0 ? Number(now) : Date.now(),
    evidence: {
      adapter: gate.LEGACY_MCP_ADAPTER,
      surface: 'ide',
      providerVersion: 'manual',
      signal: 'mcp-auth-done',
      gate: 'mcp-auth',
    },
  };
}

function isMcpAuthSessionResolution(event) {
  return gate.isAgentGateSessionResolution(event);
}

function expandMcpAuthSessionResolution(resolvedEvent, pendingRows = []) {
  return gate.expandAgentGateSessionResolution(resolvedEvent, pendingRows);
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
  const result = await gate.postNotification(payload);
  if (!result.ok) {
    process.stderr.write(`pome mcp-auth notify failed: ${result.error || result.status || 'unreachable'}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.resolved && result.body?.result === 'ignored') {
    process.stderr.write('pome mcp-auth: no matching pending bubble to resolve\n');
    process.exitCode = 2;
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
  postNotification: gate.postNotification,
  isAgentGateSessionResolution: gate.isAgentGateSessionResolution,
  expandAgentGateSessionResolution: gate.expandAgentGateSessionResolution,
  isGateAdapter: gate.isGateAdapter,
  ADAPTER: gate.ADAPTER,
  LEGACY_MCP_ADAPTER: gate.LEGACY_MCP_ADAPTER,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}
