'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const toml = require('toml-eslint-parser');
const json = require('jsonc-parser');
const { writeAtomic } = require('./atomicStorage');
const SOURCES = Object.freeze(['codex', 'claude', 'cursor']);
const LABELS = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor' };
const digest = value => createHash('sha256').update(value).digest('hex');
const marker = source => `--pome-panel-hook=${source}`;
const quote = (value, platform) => platform === 'win32'
  ? `"${String(value).replace(/"/g, '\\"')}"`
  : `'${String(value).replace(/'/g, "'\\''")}'`;

function readConfig(filePath, source) {
  const exists = fs.existsSync(filePath);
  if (exists && fs.lstatSync(filePath).isSymbolicLink()) throw new Error('配置文件为符号链接，无法安全原子修改。');
  const text = exists ? fs.readFileSync(filePath, 'utf8') : source === 'codex' ? '' : '{}\n';
  const ast = source === 'codex' ? toml.parseTOML(text) : null;
  const value = ast ? toml.getStaticTOMLValue(ast) : JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是对象。');
  if (source === 'codex' && value.notify !== undefined && (!Array.isArray(value.notify) || value.notify.some(v => typeof v !== 'string'))) throw new Error('notify 必须为命令数组。');
  if (source !== 'codex') {
    if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))) throw new Error('hooks 必须为对象。');
    if (source === 'cursor' && value.hooks?.afterAgentResponse !== undefined && !Array.isArray(value.hooks.afterAgentResponse)) throw new Error('afterAgentResponse hooks 必须为数组。');
    const hooks = value.hooks?.[source === 'claude' ? 'Stop' : 'stop'];
    if (hooks !== undefined && !Array.isArray(hooks)) throw new Error('完成 hooks 必须为数组。');
    if (source === 'claude' && hooks?.some(group => !group || !Array.isArray(group.hooks))) throw new Error('Stop 钩子格式损坏。');
    if (source === 'cursor' && value.version !== undefined && value.version !== 1) throw new Error('不支持的 Cursor hooks 版本。');
  }
  return { text, ast, value, exists, hash: digest(exists ? text : '<absent>') };
}

function editNotify(config, notify) {
  const entry = config.ast.body[0].body.find(node => node.type === 'TOMLKeyValue'
    && node.key.keys.length === 1 && toml.getStaticTOMLValue(node.key)[0] === 'notify');
  if (entry) {
    const [start, end] = notify === undefined ? entry.range : entry.value.range;
    return config.text.slice(0, start) + (notify === undefined ? '' : JSON.stringify(notify)) + config.text.slice(end);
  }
  return notify === undefined ? config.text : `notify = ${JSON.stringify(notify)}\n${config.text}`;
}

function editJson(text, keyPath, value) {
  if (value === undefined && Number.isInteger(keyPath.at(-1))) {
    // jsonc-parser 3.3.1's last-array deletion assumes a trailing newline.
    // Use its parsed node ranges to preserve compact JSON as well.
    const array = json.findNodeAtLocation(json.parseTree(text), keyPath.slice(0, -1));
    const index = keyPath.at(-1), node = array?.children?.[index];
    if (!node) throw new Error('待移除的 Pome 配置已变化。');
    const previous = array.children[index - 1], next = array.children[index + 1];
    const start = next ? node.offset : previous ? previous.offset + previous.length : node.offset;
    const end = next ? next.offset : node.offset + node.length;
    return text.slice(0, start) + text.slice(end);
  }
  const indent = text.match(/\n([ \t]+)"/)?.[1];
  return json.applyEdits(text, json.modify(text, keyPath, value, { formattingOptions: indent ? {
    insertSpaces: !indent.includes('\t'), tabSize: indent.includes('\t') ? 1 : indent.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  } : undefined }));
}

function originalNotify(command) {
  const arg = command.find(value => value.startsWith('--pome-forward='));
  const windowsIndex = command.indexOf('pome-panel-hook=codex');
  const encoded = arg ? arg.slice('--pome-forward='.length) : windowsIndex >= 0 ? command[windowsIndex + 1] : null;
  if (!encoded) throw new Error('Pome 原 notify 恢复信息缺失，请保留配置并检查备份。');
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (value !== null && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw new Error('原 notify 恢复信息损坏。');
  return value;
}

function createAiSourceHooks({ homeDir = os.homedir(), appDir = __dirname, runtimePath = process.execPath,
  platform = process.platform, now = Date.now, runtimeCheck } = {}) {
  const previews = new Map();
  let runtimePromise;
  const files = { codex: path.join(homeDir, '.codex/config.toml'), claude: path.join(homeDir, '.claude/settings.json'), cursor: path.join(homeDir, '.cursor/hooks.json') };
  const script = source => path.join(appDir, 'scripts', `${source}-notify.js`);
  const hookMarker = source => platform === 'win32' ? `pome-panel-hook=${source}` : marker(source);
  const supported = source => { if (!SOURCES.includes(source)) throw new Error('不支持的 AI 来源。'); };
  async function runtimeReady() {
    if (!runtimePromise) runtimePromise = (async () => {
      try {
        if (runtimeCheck) return Boolean(await runtimeCheck());
        fs.accessSync(runtimePath, fs.constants.X_OK);
        const result = await promisify(execFile)(runtimePath, ['-e', 'process.stdout.write("pome-node-ok")'], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 2000, windowsHide: true,
        });
        return result.stdout === 'pome-node-ok';
      } catch { return false; }
    })();
    return runtimePromise;
  }
  function codexCommand(previous) {
    const encoded = Buffer.from(JSON.stringify(previous)).toString('base64url');
    const args = [runtimePath, script('codex'), hookMarker('codex'), `--pome-forward=${encoded}`];
    if (platform !== 'win32') return ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', ...args];
    // -File binds payload as data, never as a PowerShell command expression.
    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(appDir, 'scripts/pome-hook-runtime.ps1'), runtimePath, script('codex'), hookMarker('codex'), encoded];
  }
  function shellCommand(source) {
    const args = [runtimePath, script(source), hookMarker(source)].map(v => quote(v, platform)).join(' ');
    return platform === 'win32' ? `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${quote(path.join(appDir, 'scripts/pome-hook-runtime.ps1'), platform)} ${args}` : `ELECTRON_RUN_AS_NODE=1 ${args}`;
  }
  function isOwned(item, source) {
    return typeof item?.command === 'string' && new RegExp(`(?:^|[\\s"'])(?:--)?pome-panel-hook=${source}(?:$|[\\s"'])`).test(item.command);
  }
  function installedItems(config, source) {
    if (source === 'codex') return config.value.notify?.some(value => [marker(source), `pome-panel-hook=${source}`].includes(value)) ? [config.value.notify] : [];
    const groups = config.value.hooks?.[source === 'claude' ? 'Stop' : 'stop'] || [];
    return (source === 'claude' ? groups.flatMap(g => g.hooks) : groups).filter(item => isOwned(item, source));
  }
  async function status(source) {
    supported(source);
    const filePath = files[source], detected = fs.existsSync(path.dirname(filePath));
    const base = { source, label: LABELS[source], filePath, detected };
    if (!detected) return { ...base, state: 'undetected', message: '未检测到本机工具目录' };
    try {
      const config = readConfig(filePath, source), items = installedItems(config, source);
      if (!(await runtimeReady()) || !fs.existsSync(runtimePath) || !fs.existsSync(script(source))) return { ...base, state: 'error', message: '脚本路径不存在或运行时不可用', repairable: false };
      if (!items.length) return { ...base, state: 'disconnected', message: source === 'codex' ? '将写入 notify，保留并转发原命令' : `将追加 ${source === 'claude' ? 'Stop' : 'stop'} 钩子，保留已有配置` };
      const expected = source === 'codex' ? codexCommand(originalNotify(items[0])) : shellCommand(source);
      const responseItems = source === 'cursor' ? (config.value.hooks?.afterAgentResponse || []).filter(item => isOwned(item, source)) : [];
      const responseMatches = !responseItems.length || responseItems.length === 1 && responseItems[0].command === expected && (!responseItems[0].type || responseItems[0].type === 'command');
      const matches = responseMatches && items.length === 1 && (source === 'codex' ? JSON.stringify(items[0]) === JSON.stringify(expected) : items[0].command === expected && (source === 'claude' ? items[0].type === 'command' : !items[0].type || items[0].type === 'command'));
      return { ...base, state: matches ? 'connected' : 'error', repairable: true,
        ...(source === 'cursor' ? { summaryHookMissing: !responseItems.length } : {}),
        message: matches ? source === 'cursor' && !responseItems.length ? '已接入，可补全完成摘要钩子' : '已接入，本机监听完成事件' : 'Pome 钩子路径或运行时已变化，请修复' };
    } catch (error) { return { ...base, state: 'error', repairable: false, message: `配置异常：${error.message}` }; }
  }
  async function list() { return Promise.all(SOURCES.map(status)); }
  async function preview(source, action = 'connect') {
    supported(source);
    if (!['connect', 'repair', 'disconnect'].includes(action)) throw new Error('无效接入操作。');
    const current = await status(source);
    if (current.state === 'undetected') throw new Error('未检测到工具，请先安装并运行一次。');
    if (action !== 'disconnect' && (current.state === 'error' && !current.repairable)) throw new Error(current.message);
    const config = readConfig(files[source], source), owned = installedItems(config, source);
    let text = config.text, added;
    if (action === 'disconnect' && !owned.length && !(source === 'cursor' && config.value.hooks?.afterAgentResponse?.some(item => isOwned(item, source)))) {
      added = '未发现 Pome 配置，无需修改';
    } else if (source === 'codex') {
      const previous = owned.length ? originalNotify(owned[0]) : config.value.notify ?? null;
      const value = action === 'disconnect' ? previous ?? undefined : codexCommand(previous);
      text = editNotify(config, value);
      added = action === 'disconnect' ? `还原 notify：${JSON.stringify(previous)}` : `notify → ${script(source)}\n运行时：${runtimePath}（ELECTRON_RUN_AS_NODE=1）\n原 notify 保留并继续转发`;
    } else {
      const event = source === 'claude' ? 'Stop' : 'stop';
      const old = config.value.hooks?.[event] || [];
      const ownedPaths = [];
      old.forEach((group, i) => {
        if (source === 'claude') group.hooks.forEach((hook, j) => { if (isOwned(hook, source)) ownedPaths.push(['hooks', event, i, 'hooks', j]); });
        else if (isOwned(group, source)) ownedPaths.push(['hooks', event, i]);
      });
      if (action !== 'disconnect' && ownedPaths.length === 1) {
        // Repair in place, keeping a user's matcher and all unrelated fields.
        text = editJson(text, [...ownedPaths[0], 'command'], shellCommand(source));
        if (source === 'claude') text = editJson(text, [...ownedPaths[0], 'type'], 'command');
        else if (owned[0].type && owned[0].type !== 'command') text = editJson(text, [...ownedPaths[0], 'type'], 'command');
      } else {
        // Edit only the marked nodes, from back to front so indices stay valid.
        for (let i = old.length - 1; i >= 0; i--) {
          if (source === 'claude') {
            const marked = old[i].hooks.map((hook, j) => isOwned(hook, source) ? j : -1).filter(j => j >= 0);
            if (marked.length && marked.length === old[i].hooks.length) text = editJson(text, ['hooks', event, i], undefined);
            else for (const j of marked.reverse()) text = editJson(text, ['hooks', event, i, 'hooks', j], undefined);
          } else if (isOwned(old[i], source)) text = editJson(text, ['hooks', event, i], undefined);
        }
        if (action !== 'disconnect') {
          const entry = { type: 'command', command: shellCommand(source), timeout: 5 };
          const hasArray = Array.isArray(JSON.parse(text).hooks?.[event]);
          const value = source === 'claude' ? { hooks: [entry] } : { command: entry.command, timeout: 5 };
          text = editJson(text, hasArray ? ['hooks', event, -1] : ['hooks', event], hasArray ? value : [value]);
        }
      }
      if (source === 'cursor') {
        const event = 'afterAgentResponse';
        const old = JSON.parse(text).hooks?.[event] || [];
        const marked = old.map((hook, index) => isOwned(hook, source) ? index : -1).filter(index => index >= 0);
        if (action !== 'disconnect' && marked.length === 1) {
          text = editJson(text, ['hooks', event, marked[0], 'command'], shellCommand(source));
          if (old[marked[0]].type && old[marked[0]].type !== 'command') text = editJson(text, ['hooks', event, marked[0], 'type'], 'command');
        } else {
          if (action === 'disconnect' && marked.length && marked.length === old.length) text = editJson(text, ['hooks', event], undefined);
          else for (const index of marked.reverse()) text = editJson(text, ['hooks', event, index], undefined);
          if (action !== 'disconnect') {
            const hasArray = Array.isArray(JSON.parse(text).hooks?.[event]);
            const value = { command: shellCommand(source), timeout: 5 };
            text = editJson(text, hasArray ? ['hooks', event, -1] : ['hooks', event], hasArray ? value : [value]);
          }
        }
      }
      if (source === 'cursor' && config.value.version === undefined && action !== 'disconnect') text = editJson(text, ['version'], 1);
      added = `${source === 'cursor' ? 'stop + afterAgentResponse' : event} → ${action === 'disconnect' ? '移除 Pome 钩子' : shellCommand(source)}`;
    }
    if (source === 'codex') toml.parseTOML(text); else JSON.parse(text);
    const token = randomUUID(), backupPath = `${files[source]}.pome-backup-${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${token}`;
    const plan = { source, action, filePath: files[source], backupPath, token, added, hash: config.hash, text, existed: config.exists, expires: now() + 300000 };
    previews.set(token, plan);
    for (const [id, row] of previews) if (row.expires < now()) previews.delete(id);
    return { source, action, filePath: plan.filePath, backupPath, token, added, unchanged: text === config.text, message: source === 'codex' ? '重启 Codex 后生效' : '配置保存后工具将重新加载钩子' };
  }
  async function apply(token) {
    const plan = previews.get(token); previews.delete(token);
    if (!plan || plan.expires < now()) return { ok: false, error: 'preview_expired', message: '修改预览已过期，请重新确认。' };
    try {
      if (plan.action !== 'disconnect') {
        const current = await status(plan.source);
        if (current.state === 'error' && !current.repairable) return { ok: false, error: 'source_unavailable', message: current.message };
      }
      const config = readConfig(plan.filePath, plan.source);
      if (config.hash !== plan.hash) return { ok: false, error: 'preview_expired', message: '配置文件已变化，请重新确认。' };
      if (plan.text !== config.text) {
        const original = config.exists ? Buffer.from(config.text) : Buffer.alloc(0);
        writeAtomic(plan.backupPath, original);
        if (!fs.readFileSync(plan.backupPath).equals(original)) throw new Error('备份校验失败，配置未修改。');
        writeAtomic(plan.filePath, plan.text);
      }
      return { ok: true, source: plan.source, backupPath: plan.text !== config.text ? plan.backupPath : null, message: plan.source === 'codex' ? '重启 Codex 后生效' : '来源配置已更新', statuses: await list() };
    } catch (error) { return { ok: false, error: 'config_write_failed', message: error.message }; }
  }
  async function runTest(source, { token, port = 43821 } = {}) {
    const current = await status(source);
    if (current.state !== 'connected') throw new Error('来源尚未有效接入，请先接入或修复。');
    const payload = JSON.stringify({ _pome_test: true, _pome_test_token: token, event_id: token,
      title: `${LABELS[source]} 接入测试`, session_id: token, conversation_id: token, generation_id: token, hook_event_name: source === 'claude' ? 'Stop' : 'stop' });
    await new Promise((resolve, reject) => {
      const child = spawn(runtimePath, [script(source), marker(source), ...(source === 'codex' ? [payload] : [])], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POME_NOTIFY_PORT: String(port) }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('测试通知超时')); }, 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('通知脚本运行失败')); });
      child.stdin.on('error', () => {}); child.stdin.end(source === 'codex' ? '' : payload);
    });
  }
  return { list, status, preview, apply, runTest };
}

module.exports = { SOURCES, createAiSourceHooks, editNotify, readConfig, originalNotify };
