'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');
const { createAiSourceHooks, readConfig, originalNotify, codexNotifyChain } = require('../aiSourceHooks');
const profile = process.env.TODO_TEST_USER_DATA;
assert(profile, 'This acceptance fixture requires an isolated TODO_TEST_USER_DATA');
const home = path.join(profile, 'hook-home'), config = path.join(home, '.codex/config.toml');
fs.mkdirSync(path.dirname(config), { recursive: true });
process.env.POME_HOOK_TEST_HOME = home;
process.env.CODEX_HOME = path.dirname(config);
process.env.POME_TEST_NOTIFICATIONS = '1';
require('./provider-usage-fixtures.cjs');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const adapters = require('../platform-adapters'), load = adapters.loadAdapter;
adapters.loadAdapter = (...args) => {
  const adapter = load(...args); adapter.windows.resolveTaskApp = async () => null; return adapter;
};
const output = process.env.POME_REVIEW_SHOTS || path.join(__dirname, '../dist.noindex/codex-notify-chain');
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let port, started = false;
const watchdog = setTimeout(() => { console.error('Codex notify chain acceptance timed out'); app.exit(1); }, 60000);
app.on('pome-test-notification-port', value => { port = value; });
async function until(check, label) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await sleep(25); }
  throw Error('Timed out: ' + label);
}
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => { clearTimeout(watchdog); console.log('Codex wrapper repair, test without history, actual hook delivery, screenshots and disconnect passed:', output); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(contents) {
  const js = source => contents.executeJavaScript(source);
  async function capture(name, target = contents) {
    await sleep(400); fs.writeFileSync(path.join(output, name + '.png'), (await target.capturePage()).toPNG());
  }
  await until(() => js('!!window.NotchWorkspace && window.NotchAiSources?.getState().ready'), 'startup');
  await js('setMode(true); setActiveTab("settings")');
  await until(() => js(`document.querySelector('.ai-source-row[data-source="codex"] .ai-source-repair-hint')?.textContent.includes('Computer Use')`), 'wrapped hint');
  assert.equal(await js(`document.querySelector('.ai-source-row[data-source="codex"]').dataset.state`), 'error');
  const before = fs.readFileSync(config, 'utf8');
  await js(`document.querySelector('.ai-source-row[data-source="codex"]').scrollIntoView({block:'center'})`);
  await capture('01-wrapped-needs-repair');
  await js(`document.querySelector('.ai-source-row[data-source="codex"] [data-source-action="repair"]').click()`);
  await until(() => js('document.getElementById("ai-source-confirm").open'), 'repair preview');
  assert.equal(fs.readFileSync(config, 'utf8'), before, 'opening preview cannot write');
  await js('document.getElementById("ai-source-confirm-apply").click()');
  await until(() => js(`document.querySelector('.ai-source-row[data-source="codex"]').dataset.state==='connected'`), 'repair applied');
  const command = readConfig(config, 'codex').value.notify;
  assert.equal(codexNotifyChain(command).pomeCount, 1);
  assert.deepEqual(originalNotify(command), computerUse);
  assert.equal(await js(`!!document.querySelector('.ai-source-row[data-source="codex"] .ai-source-repair-hint')`), false);
  await capture('02-repaired-connected');
  await until(() => Boolean(port), 'listener');
  assert.equal((await js('notchAPI.testAiSource("codex")')).ok, true);
  assert.equal((await js('notchAPI.getTaskInbox()')).total, 0, 'connection test must not enter history');
  await js('notchAPI.setAutoMeetingMode(false)'); await js('notchAPI.setMeetingMode(false)');
  await js('notchAPI.setTaskNotifications(true)');
  const payload = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'wrapper-acceptance', 'turn-id': 'repaired-turn', 'last-assistant-message': 'Codex 通知链修复验收完成' });
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], [...command.slice(1), payload], { env: { ...process.env, POME_NOTIFY_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`hook exited ${code}`)));
  });
  await until(async () => (await js('notchAPI.getTaskInbox()')).total === 1, 'actual script saved event');
  let bubble;
  await until(() => {
    bubble = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/notification.html') && window.isVisible());
    return Boolean(bubble);
  }, 'actual completion bubble');
  await until(() => bubble.webContents.executeJavaScript(`document.getElementById('notification-title').textContent.includes('通知链修复')`), 'bubble rendered');
  await capture('03-completion-bubble', bubble.webContents);
  await js(`setActiveTab('home'); hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='inbox');homeSizes={...homeSizes,inbox:'large'};applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});NotchTaskInbox.refresh()`);
  await until(() => js(`document.querySelector('.home-inbox-row')?.textContent.includes('通知链修复')`), 'home completion');
  await capture('04-completion-history');
  const hooks = createAiSourceHooks({ env: {}, homeDir: home, runtimeCheck: () => true });
  const plan = await hooks.preview('codex', 'disconnect'); assert.equal((await hooks.apply(plan.token)).ok, true);
  assert.deepEqual(readConfig(config, 'codex').value.notify, computerUse);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ wrappedHint: true, repairedPomeCount: 1, testNoHistory: true, actualScriptReceipt: true, bubble: true, homeHistory: true, originalComputerUsePreserved: true, isolatedHome: home }, null, 2));
}
// The helper is a configuration fixture. Its argv is preserved; the Node test
// separately exercises forwarding with an executable Computer Use stand-in.
const computerUse = [path.join(home, process.platform === 'win32' ? 'codex-computer-use.exe' : 'SkyComputerUseClient'), 'turn-ended'];
(async () => {
  fs.writeFileSync(config, `# Acceptance fixture only\nnotify = ${JSON.stringify(computerUse)}\n`);
  const hooks = createAiSourceHooks({ env: {}, homeDir: home, runtimeCheck: () => true });
  const plan = await hooks.preview('codex'); assert.equal((await hooks.apply(plan.token)).ok, true);
  const pome = readConfig(config, 'codex').value.notify;
  fs.writeFileSync(config, `# Acceptance fixture only\nnotify = ${JSON.stringify([...computerUse, '--previous-notify', JSON.stringify(pome)])}\n`);
  require('../main.js');
})().catch(error => { console.error(error); app.exit(1); });
