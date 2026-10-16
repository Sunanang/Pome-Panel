#!/usr/bin/env node
'use strict';
const http = require('node:http');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const encodedPayload = args.find(value => value.startsWith('--pome-payload='));
const raw = encodedPayload ? Buffer.from(encodedPayload.slice('--pome-payload='.length), 'base64').toString('utf8') : args.at(-1)?.startsWith('--pome-') ? '{}' : args.at(-1) || '{}';
let payload;
try { payload = JSON.parse(raw); } catch { payload = { title: 'Codex 已完成任务', detail: raw }; }
if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
if (!payload._pome_test) {
  // Codex appends completion JSON to argv; forward to the exact prior command.
  const encoded = args.find(value => value.startsWith('--pome-forward='));
  try {
    const command = encoded && JSON.parse(Buffer.from(encoded.slice('--pome-forward='.length), 'base64url').toString('utf8'));
    if (Array.isArray(command) && command.length && !command.some(value => ['--pome-panel-hook=codex', 'pome-panel-hook=codex'].includes(value))) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(command[0], [...command.slice(1), raw], { env, detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {}); child.unref();
    }
  } catch {}
}
if (!payload._pome_test && !payload.session_title && !payload.sessionTitle) {
  try { payload.session_title = require('../codex-thread-metadata').readCodexThreadTitle(payload.thread_id || payload['thread-id'] || payload.session_id); } catch {}
}
const body = Buffer.from(JSON.stringify(payload));
const request = http.request({ hostname: '127.0.0.1', port: Number(process.env.POME_NOTIFY_PORT) || 43821,
  path: '/notify/codex', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, res => res.resume());
request.setTimeout(900, () => request.destroy()); request.on('error', () => {}); request.end(body);
