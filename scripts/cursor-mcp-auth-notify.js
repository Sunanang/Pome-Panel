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
  const out = { service: process.env.POME_MCP_SERVICE || '', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--service' || arg === '-s') out.service = String(argv[++index] || '');
    else if (arg === '--dry-run') out.dryRun = true;
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
  const payload = buildMcpAuthNotification({ service: args.service });
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
  process.stdout.write(`notified:${payload.eventId}\n`);
}

module.exports = { parseArgs, slug, buildMcpAuthNotification, postNotification };
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}
