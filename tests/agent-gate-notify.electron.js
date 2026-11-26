'use strict';
/**
 * Agent gate top-bubble acceptance:
 * - command-run notify → bubble → --resolved dismiss
 * - MCP open via agent-gate, close via legacy cursor-mcp-auth-notify
 * Screenshots under dist.noindex/agent-gate-notify/
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const profile = process.env.TODO_TEST_USER_DATA;
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, '.ui-welcome-done'), '1');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });

const adapters = require('../platform-adapters');
const originalAdapter = adapters.loadAdapter;
adapters.loadAdapter = (...args) => {
  const adapter = originalAdapter(...args);
  adapter.windows.resolveTaskApp = async () => null;
  adapter.taskApps.open = async () => ({ ok: true });
  return adapter;
};

process.env.POME_TEST_NOTIFICATIONS = '1';
const output = process.env.POME_AGENT_GATE_SHOTS || path.join(__dirname, '..', 'dist.noindex', 'agent-gate-notify');
fs.mkdirSync(output, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let port;
let started = false;
const errors = [];
app.on('pome-test-notification-port', (value) => { port = value; });
const watchdog = setTimeout(() => {
  console.error('agent-gate-notify acceptance timed out', errors);
  app.exit(1);
}, 60000);

function notificationWindow() {
  return BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/notification.html') && !win.isDestroyed());
}
const evaluate = (win, source) => win.webContents.executeJavaScript(source);

async function until(check, label) {
  for (let index = 0; index < 300; index += 1) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}

async function shown(title) {
  await until(async () => {
    const win = notificationWindow();
    return win && await evaluate(win, `!document.getElementById('notification-root').hidden && document.getElementById('notification-title').textContent===${JSON.stringify(title)}`);
  }, title);
  const win = notificationWindow();
  await delay(470);
  return win;
}

async function capture(win, name) {
  fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

function runScript(scriptRel, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', scriptRel), ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POME_NOTIFY_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => {
      clearTimeout(watchdog);
      console.log('agent-gate-notify acceptance passed:', output);
      app.exit(0);
    }).catch((error) => {
      console.error(error, errors);
      app.exit(1);
    });
  });
});

async function run(mainContents) {
  await until(() => Number.isInteger(port), 'notify port');
  const pending = () => mainContents.executeJavaScript('notchAPI.getAiAttention()');

  const command = await runScript('scripts/agent-gate-notify.js', [
    '--source', 'cursor', '--gate', 'command-run', '--label', '完整权限命令',
  ]);
  assert.equal(command.code, 0, command.stderr);
  assert.match(command.stdout, /^notified:gate:command-run:/);
  let win = await shown('请到 Cursor 点 Run 批准：完整权限命令');
  assert.equal(await evaluate(win, 'currentNotification.attentionKind'), 'authorization');
  assert.equal(await evaluate(win, 'currentNotification.manualResolution'), true);
  assert.match(await evaluate(win, 'document.getElementById("attention-hint").textContent'), /授权后可关闭|Dismiss after/);
  await capture(win, 'command-run-gate');

  const resolved = await runScript('scripts/agent-gate-notify.js', [
    '--source', 'cursor', '--gate', 'command-run', '--label', '完整权限命令', '--resolved',
  ]);
  assert.equal(resolved.code, 0, resolved.stderr);
  await until(async () => !notificationWindow() || !notificationWindow().isVisible(), 'command-run --resolved dismisses bubble');
  assert.equal((await pending()).items.filter((row) => String(row.event?.sessionId || '').includes('command-run')).length, 0);

  const ignored = await runScript('scripts/agent-gate-notify.js', [
    '--source', 'cursor', '--gate', 'command-run', '--label', '完整权限命令', '--resolved',
  ]);
  assert.equal(ignored.code, 2, 'resolve with no pending bubble must exit 2');
  assert.match(ignored.stderr, /no matching pending bubble/);

  // Cursor AskQuestion：必须是「等待选择」气泡，不能显示成「等待授权」。
  const choiceOpen = await runScript('scripts/agent-gate-notify.js', [
    '--source', 'cursor', '--gate', 'attention', '--action', 'select', '--label', '方案 A 还是 B',
  ]);
  assert.equal(choiceOpen.code, 0, choiceOpen.stderr);
  win = await shown('请到 Cursor 做选择：方案 A 还是 B');
  assert.equal(await evaluate(win, 'currentNotification.attentionKind'), 'choice');
  assert.equal(await evaluate(win, 'document.getElementById("attention-label").textContent'), '等待选择');
  assert.match(await evaluate(win, 'document.getElementById("attention-action-label").textContent'), /返回 Cursor 选择/);
  assert.match(await evaluate(win, 'document.getElementById("attention-hint").textContent'), /作答后可关闭此提醒|Dismiss after answering/, 'choice hint must not claim authorization');
  await capture(win, 'cursor-choice-gate');
  const choiceClose = await runScript('scripts/agent-gate-notify.js', [
    '--source', 'cursor', '--gate', 'attention', '--label', '方案 A 还是 B', '--resolved',
  ]);
  assert.equal(choiceClose.code, 0, choiceClose.stderr);
  await until(async () => !notificationWindow() || !notificationWindow().isVisible(), 'choice --resolved dismisses bubble');

  const mcpOpen = await runScript('scripts/agent-gate-notify.js', [
    '--source', 'cursor', '--gate', 'mcp-auth', '--label', 'Google Drive',
  ]);
  assert.equal(mcpOpen.code, 0, mcpOpen.stderr);
  win = await shown('请到 Cursor 完成 Google Drive 授权');
  await capture(win, 'mcp-auth-via-agent-gate');
  const mcpClose = await runScript('scripts/cursor-mcp-auth-notify.js', [
    '--service', 'Google Drive', '--resolved',
  ]);
  assert.equal(mcpClose.code, 0, mcpClose.stderr);
  await until(async () => !notificationWindow() || !notificationWindow().isVisible(), 'legacy MCP resolve closes agent-gate MCP open');
  assert.equal((await pending()).items.filter((row) => String(row.event?.sessionId || '').includes('google-drive')).length, 0);

  assert.deepEqual(errors, []);
}

require('../main');
