#!/usr/bin/env node
'use strict';
/**
 * Read-only diagnostic for the Codex app-server protocol.
 *
 *   node scripts/codex-appserver-probe.js [--seconds 15] [--sock <path>] [--json] [--bin <codex>]
 *
 * It connects through `codex app-server proxy` to the app server that Codex
 * Desktop already runs, performs the JSON-RPC handshake, lists threads and then
 * prints every notification it receives. It never starts a turn, never resumes
 * a thread and never answers a server request - if one arrives it is reported
 * and left alone so the client that owns the thread stays in charge.
 *
 * Use it while Codex is waiting for you (a question or an approval): the
 * `thread/status/changed` notification carries activeFlags
 * ("waitingOnApproval" | "waitingOnUserInput"), which is what
 * codexAttentionBridge.js turns into a Pome reminder.
 */
const { spawn } = require('node:child_process');

const DEFAULT_BINARIES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
];

function parseArgs(argv = process.argv.slice(2)) {
  const out = { seconds: 15, socketPath: '', json: false, binary: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index], next = () => String(argv[++index] || '');
    if (arg === '--seconds' || arg === '-s') out.seconds = Math.max(1, Number(next()) || 15);
    else if (arg === '--sock') out.socketPath = next();
    else if (arg === '--json') out.json = true;
    else if (arg === '--bin') out.binary = next();
  }
  return out;
}

function resolveBinary(explicit, exists = require('node:fs').existsSync) {
  if (explicit) return explicit;
  return DEFAULT_BINARIES.find(candidate => exists(candidate)) || '';
}

const METHOD_HINTS = {
  'thread/status/changed': '线程状态变化（activeFlags 里有 waitingOnApproval / waitingOnUserInput）',
  'item/started': '一个 item 开始（工具调用等）',
  'item/completed': '一个 item 结束',
  'serverRequest/resolved': '某个服务端请求已被解决',
};

function summarize(message) {
  if (message.method && message.id !== undefined) return { kind: 'request', method: message.method, id: message.id, params: message.params };
  if (message.method) return { kind: 'notification', method: message.method, params: message.params };
  return { kind: 'response', id: message.id, ok: !message.error, error: message.error?.message };
}

function main() {
  const args = parseArgs();
  const binary = resolveBinary(args.binary);
  if (!binary) {
    process.stderr.write('找不到 codex 可执行文件，请用 --bin 指定。\n');
    process.exitCode = 2;
    return;
  }
  const childArgs = ['app-server', 'proxy'];
  if (args.socketPath) childArgs.push('--sock', args.socketPath);
  const child = spawn(binary, childArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', nextId = 1;
  const counts = new Map();
  const send = message => { try { child.stdin.write(JSON.stringify(message) + '\n'); } catch {} };
  const report = message => {
    const summary = summarize(message);
    if (summary.kind === 'notification' || summary.kind === 'request') {
      counts.set(summary.method, (counts.get(summary.method) || 0) + 1);
    }
    if (args.json) process.stdout.write(JSON.stringify(summary) + '\n');
    else if (summary.kind === 'request') process.stdout.write('[请求，不代答] ' + summary.method + ' (id ' + summary.id + ')\n');
    else if (summary.kind === 'notification') {
      const hint = METHOD_HINTS[summary.method] ? '  ' + METHOD_HINTS[summary.method] : '';
      const flags = summary.method === 'thread/status/changed' ? ' activeFlags=' + JSON.stringify(summary.params?.status?.activeFlags || []) : '';
      process.stdout.write('[' + summary.method + ']' + flags + hint + '\n');
    } else process.stdout.write('[响应 #' + summary.id + '] ' + (summary.ok ? 'ok' : 'error: ' + summary.error) + '\n');
  };
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try { report(JSON.parse(line)); } catch {}
    }
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString('utf8').trim();
    if (text) process.stderr.write('[codex] ' + text + '\n');
  });
  child.on('error', error => {
    process.stderr.write('无法启动 codex app-server proxy：' + (error.message || error) + '\n');
    process.exitCode = 1;
  });
  child.on('exit', code => {
    if (code && code !== 0) process.stderr.write('codex app-server proxy 退出码 ' + code + '\n');
  });
  send({ jsonrpc: '2.0', id: nextId++, method: 'initialize',
    params: { clientInfo: { name: 'pome-panel-probe', title: 'Pome Panel probe', version: '0.0.0' } } });
  send({ jsonrpc: '2.0', method: 'initialized' });
  send({ jsonrpc: '2.0', id: nextId++, method: 'thread/list', params: { limit: 20 } });
  const timer = setTimeout(() => {
    process.stdout.write('\n统计：' + (counts.size ? [...counts.entries()].map(([method, count]) => method + '×' + count).join('，') : '没有收到任何通知') + '\n');
    try { child.kill('SIGTERM'); } catch {}
    process.exit(0);
  }, args.seconds * 1000);
  process.on('SIGINT', () => { clearTimeout(timer); try { child.kill('SIGTERM'); } catch {} process.exit(0); });
}

module.exports = { parseArgs, resolveBinary, summarize, DEFAULT_BINARIES };
if (require.main === module) main();
