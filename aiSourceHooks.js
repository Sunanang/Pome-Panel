'use strict';
const pomeLocaleAiSourceHooks = typeof module === 'object' && module.exports ? require("./localization/runtime") : globalThis.PomeI18n;


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
const CLAUDE_ATTENTION_EVENTS = { PreToolUse: 'AskUserQuestion', PostToolUse: 'AskUserQuestion', PostToolUseFailure: 'AskUserQuestion', Notification: 'permission_prompt|elicitation_dialog', UserPromptSubmit: null, Stop: null, SessionEnd: null };
const digest = value => createHash('sha256').update(value).digest('hex');
const marker = source => `--pome-panel-hook=${source}`;
const quote = (value, platform) => platform === 'win32'
  ? `"${String(value).replace(/"/g, '\\"')}"`
  : `'${String(value).replace(/'/g, "'\\''")}'`;

function readConfig(filePath, source) {
  const exists = fs.existsSync(filePath);
  if (exists && fs.lstatSync(filePath).isSymbolicLink()) throw new Error(pomeLocaleAiSourceHooks.t("copy.theConfigurationFileIsASymbolicLink.22a9d4"));
  const text = exists ? fs.readFileSync(filePath, 'utf8') : source === 'codex' ? '' : '{}\n';
  const ast = source === 'codex' ? toml.parseTOML(text) : null;
  const value = ast ? toml.getStaticTOMLValue(ast) : JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(pomeLocaleAiSourceHooks.t("copy.configurationMustBeAnObject.5af957"));
  if (source === 'codex' && value.notify !== undefined && (!Array.isArray(value.notify) || value.notify.some(v => typeof v !== 'string'))) throw new Error(pomeLocaleAiSourceHooks.t("copy.notifyMustBeAnArrayOfCommand.1e7bea"));
  if (source !== 'codex') {
    if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))) throw new Error(pomeLocaleAiSourceHooks.t("copy.hooksMustBeAnObject.7eb631"));
    if (source === 'cursor' && value.hooks?.afterAgentResponse !== undefined && !Array.isArray(value.hooks.afterAgentResponse)) throw new Error(pomeLocaleAiSourceHooks.t("copy.afteragentresponseHooksMustBeAnArray.a92e31"));
    const hooks = value.hooks?.[source === 'claude' ? 'Stop' : 'stop'];
    if (hooks !== undefined && !Array.isArray(hooks)) throw new Error(pomeLocaleAiSourceHooks.t("copy.completionHooksMustBeAnArray.e6d762"));
    if (source === 'claude' && hooks?.some(group => !group || !Array.isArray(group.hooks))) throw new Error(pomeLocaleAiSourceHooks.t("copy.theStopHookFormatIsDamaged.4e806a"));
    if (source === 'cursor' && value.version !== undefined && value.version !== 1) throw new Error(pomeLocaleAiSourceHooks.t("copy.unsupportedCursorHooksVersion.349156"));
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
    if (!node) throw new Error(pomeLocaleAiSourceHooks.t("copy.thePomeConfigurationToRemoveHasChanged.947555"));
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
  if (!encoded) throw new Error(pomeLocaleAiSourceHooks.t("copy.theOriginalNotifyRecoveryInformationIsMissing.365fd2"));
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (value !== null && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw new Error(pomeLocaleAiSourceHooks.t("copy.theOriginalNotifyRecoveryInformationIsDamaged.124a7f"));
  return value;
}

function createAiSourceHooks({ homeDir = os.homedir(), appDir = __dirname, runtimePath = process.execPath,
  platform = process.platform, now = Date.now, runtimeCheck } = {}) {
  const previews = new Map();
  let runtimePromise;
  const files = { codex: path.join(homeDir, '.codex/config.toml'), claude: path.join(homeDir, '.claude/settings.json'), cursor: path.join(homeDir, '.cursor/hooks.json') };
  const script = source => path.join(appDir, 'scripts', source === 'claude-attention' ? 'claude-attention.js' : `${source}-notify.js`);
  const hookMarker = source => platform === 'win32' ? `pome-panel-hook=${source}` : marker(source);
  const supported = source => { if (!SOURCES.includes(source)) throw new Error(pomeLocaleAiSourceHooks.t("copy.unsupportedAiSource.25257a")); };
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
  function attentionComplete(config) {
    return Object.entries(CLAUDE_ATTENTION_EVENTS).every(([event, matcher]) => {
      const groups = config.value.hooks?.[event];
      const marked = Array.isArray(groups) ? groups.flatMap(group => (group.hooks || []).filter(hook => isOwned(hook, 'claude-attention')).map(hook => ({ group, hook }))) : [];
      return marked.length === 1 && (matcher === null || marked[0].group.matcher === matcher)
        && marked[0].hook.type === 'command' && marked[0].hook.command === shellCommand('claude-attention');
    });
  }
  function hasAttentionHooks(config) {
    return Object.values(config.value.hooks || {}).some(groups => Array.isArray(groups) && groups.some(group => group.hooks?.some(hook => isOwned(hook, 'claude-attention'))));
  }
  function capabilities(source, connected, complete) {
    return { surface: source === 'claude' ? 'cli' : source === 'cursor' ? 'ide' : 'desktop', providerVersion: 'unverified',
      completion: connected ? 'partial' : 'unsupported', input: source === 'claude' && complete ? 'partial' : 'unsupported',
      select: source === 'claude' && complete ? 'partial' : 'unsupported', approve: source === 'claude' && complete ? 'partial' : 'unsupported',
      autoResolve: source === 'claude' && complete ? 'partial' : 'unsupported' };
  }
  async function status(source) {
    supported(source);
    const filePath = files[source], detected = fs.existsSync(path.dirname(filePath));
    const base = { source, label: LABELS[source], filePath, detected, attentionCapabilities: capabilities(source, false, false) };
    if (!detected) return { ...base, state: 'undetected', message: pomeLocaleAiSourceHooks.t("copy.localToolDirectoryNotDetected.c78222") };
    try {
      const config = readConfig(filePath, source), items = installedItems(config, source);
      if (!(await runtimeReady()) || !fs.existsSync(runtimePath) || !fs.existsSync(script(source)) || source === 'claude' && !fs.existsSync(script('claude-attention'))) return { ...base, state: 'error', message: pomeLocaleAiSourceHooks.t("copy.theScriptPathIsMissingOrThe.a57f6c"), repairable: false };
      if (!items.length) return { ...base, state: 'disconnected', message: source === 'codex' ? pomeLocaleAiSourceHooks.t("copy.writeNotifyWhilePreservingAndForwardingThe.416e9e") : pomeLocaleAiSourceHooks.t("copy.appendTheHookWhilePreservingExistingConfiguration.429226", { arg1: (source === 'claude' ? 'Stop' : 'stop') }) };
      const expected = source === 'codex' ? codexCommand(originalNotify(items[0])) : shellCommand(source);
      const responseItems = source === 'cursor' ? (config.value.hooks?.afterAgentResponse || []).filter(item => isOwned(item, source)) : [];
      const responseMatches = !responseItems.length || responseItems.length === 1 && responseItems[0].command === expected && (!responseItems[0].type || responseItems[0].type === 'command');
      const matches = responseMatches && items.length === 1 && (source === 'codex' ? JSON.stringify(items[0]) === JSON.stringify(expected) : items[0].command === expected && (source === 'claude' ? items[0].type === 'command' : !items[0].type || items[0].type === 'command'));
      const attentionReady = source === 'claude' && attentionComplete(config);
      return { ...base, state: matches ? 'connected' : 'error', repairable: true,
        attentionHookMissing: source === 'claude' && !attentionReady,
        attentionCapabilities: capabilities(source, matches, attentionReady),
        ...(source === 'cursor' ? { summaryHookMissing: !responseItems.length } : {}),
        message: matches ? source === 'cursor' && !responseItems.length ? pomeLocaleAiSourceHooks.t("copy.connectedCompletionSummaryHookCanBeAdded.99cb5c") : pomeLocaleAiSourceHooks.t("copy.connectedListeningForLocalCompletionEvents.256f7f") : pomeLocaleAiSourceHooks.t("copy.thePomeHookPathOrRuntimeHas.8f7c1e") };
    } catch (error) { return { ...base, state: 'error', repairable: false, message: pomeLocaleAiSourceHooks.t("copy.configurationError.8c36aa", { arg1: (error.message) }) }; }
  }
  async function list() { return Promise.all(SOURCES.map(status)); }
  async function preview(source, action = 'connect') {
    supported(source);
    if (!['connect', 'repair', 'disconnect'].includes(action)) throw new Error(pomeLocaleAiSourceHooks.t("copy.invalidConnectionAction.0cff66"));
    const current = await status(source);
    if (current.state === 'undetected') throw new Error(pomeLocaleAiSourceHooks.t("copy.toolNotDetectedInstallAndRunIt.42fced"));
    if (action !== 'disconnect' && (current.state === 'error' && !current.repairable)) throw new Error(current.message);
    const config = readConfig(files[source], source), owned = installedItems(config, source);
    let text = config.text, added;
    if (action === 'disconnect' && !owned.length && !(source === 'claude' && hasAttentionHooks(config)) && !(source === 'cursor' && config.value.hooks?.afterAgentResponse?.some(item => isOwned(item, source)))) {
      added = pomeLocaleAiSourceHooks.t("copy.noPomeConfigurationFoundNoChangesNeeded.4861fe");
    } else if (source === 'codex') {
      const previous = owned.length ? originalNotify(owned[0]) : config.value.notify ?? null;
      const value = action === 'disconnect' ? previous ?? undefined : codexCommand(previous);
      text = editNotify(config, value);
      added = action === 'disconnect' ? pomeLocaleAiSourceHooks.t("copy.restoreNotify.d9f3a2", { arg1: (JSON.stringify(previous)) }) : pomeLocaleAiSourceHooks.t("copy.notifyRuntimeElectronRunAsNode1.c68888", { arg1: (script(source)), arg2: (runtimePath) });
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
      if (source === 'claude') {
        for (const [event, matcher] of Object.entries(CLAUDE_ATTENTION_EVENTS)) {
          const groups = JSON.parse(text).hooks?.[event] || [];
          const ownedPaths = groups.flatMap((group, i) => (group.hooks || []).flatMap((hook, j) => isOwned(hook, 'claude-attention') ? [[i, j]] : []));
          if (action !== 'disconnect' && ownedPaths.length === 1) {
            const [i, j] = ownedPaths[0];
            text = editJson(text, ['hooks', event, i, 'hooks', j, 'command'], shellCommand('claude-attention'));
            text = editJson(text, ['hooks', event, i, 'hooks', j, 'type'], 'command');
            continue;
          }
          for (let i = groups.length - 1; i >= 0; i--) {
            if (!Array.isArray(groups[i].hooks)) throw new Error('invalid_claude_hook_group');
            const marked = groups[i].hooks.map((hook, index) => isOwned(hook, 'claude-attention') ? index : -1).filter(index => index >= 0);
            if (marked.length === groups[i].hooks.length && marked.length) text = editJson(text, ['hooks', event, i], undefined);
            else for (const j of marked.reverse()) text = editJson(text, ['hooks', event, i, 'hooks', j], undefined);
          }
          if (action !== 'disconnect') {
            const item = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: shellCommand('claude-attention'), timeout: 5 }] };
            const hasArray = Array.isArray(JSON.parse(text).hooks?.[event]);
            text = editJson(text, hasArray ? ['hooks', event, -1] : ['hooks', event], hasArray ? item : [item]);
          } else if (JSON.parse(text).hooks?.[event]?.length === 0 && groups.some(group => group.hooks?.some(hook => isOwned(hook, 'claude-attention')))) text = editJson(text, ['hooks', event], undefined);
        }
      }
      added = `${source === 'cursor' ? 'stop + afterAgentResponse' : event} → ${action === 'disconnect' ? pomeLocaleAiSourceHooks.t("copy.removeThePomeHook.da37ec") : shellCommand(source)}`;
      if (source === 'claude') added += `\n${Object.keys(CLAUDE_ATTENTION_EVENTS).join(' + ')} → ${action === 'disconnect' ? pomeLocaleAiSourceHooks.t('copy.removeThePomeHook.da37ec') : shellCommand('claude-attention')}`;
    }
    if (source === 'codex') toml.parseTOML(text); else JSON.parse(text);
    const token = randomUUID(), backupPath = `${files[source]}.pome-backup-${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${token}`;
    const plan = { source, action, filePath: files[source], backupPath, token, added, hash: config.hash, text, existed: config.exists, expires: now() + 300000 };
    previews.set(token, plan);
    for (const [id, row] of previews) if (row.expires < now()) previews.delete(id);
    return { source, action, filePath: plan.filePath, backupPath, token, added, unchanged: text === config.text, message: source === 'codex' ? pomeLocaleAiSourceHooks.t("copy.quitAndReopenCodexToApplyThe.46b626") : pomeLocaleAiSourceHooks.t("copy.restartTheToolAfterSavingToReload.2a0689") };
  }
  async function apply(token) {
    const plan = previews.get(token); previews.delete(token);
    if (!plan || plan.expires < now()) return { ok: false, error: 'preview_expired', message: pomeLocaleAiSourceHooks.t("copy.theChangePreviewHasExpiredReviewAnd.8caa12") };
    try {
      if (plan.action !== 'disconnect') {
        const current = await status(plan.source);
        if (current.state === 'error' && !current.repairable) return { ok: false, error: 'source_unavailable', message: current.message };
      }
      const config = readConfig(plan.filePath, plan.source);
      if (config.hash !== plan.hash) return { ok: false, error: 'preview_expired', message: pomeLocaleAiSourceHooks.t("copy.theConfigurationFileHasChangedReviewAnd.a3ef34") };
      if (plan.text !== config.text) {
        const original = config.exists ? Buffer.from(config.text) : Buffer.alloc(0);
        writeAtomic(plan.backupPath, original);
        if (!fs.readFileSync(plan.backupPath).equals(original)) throw new Error(pomeLocaleAiSourceHooks.t("copy.backupVerificationFailedConfigurationWasNotChanged.0a6000"));
        writeAtomic(plan.filePath, plan.text);
      }
      return { ok: true, source: plan.source, action: plan.action, backupPath: plan.text !== config.text ? plan.backupPath : null, message: plan.source === 'codex' ? pomeLocaleAiSourceHooks.t("copy.quitAndReopenCodexToApplyThe.46b626") : pomeLocaleAiSourceHooks.t("copy.sourceConfigurationUpdated.3181cd"), statuses: await list() };
    } catch (error) { return { ok: false, error: 'config_write_failed', message: error.message }; }
  }
  async function runTest(source, { token, port = 43821 } = {}) {
    const current = await status(source);
    if (current.state !== 'connected') throw new Error(pomeLocaleAiSourceHooks.t("copy.theSourceIsnTConnectedCorrectlyConnect.e3cf69"));
    const payload = JSON.stringify({ _pome_test: true, _pome_test_token: token, event_id: token,
      title: pomeLocaleAiSourceHooks.t("copy.connectionTest.dd9a12", { arg1: (LABELS[source]) }), session_id: token, conversation_id: token, generation_id: token, hook_event_name: source === 'claude' ? 'Stop' : 'stop' });
    await new Promise((resolve, reject) => {
      const child = spawn(runtimePath, [script(source), marker(source), ...(source === 'codex' ? [payload] : [])], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POME_NOTIFY_PORT: String(port) }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error(pomeLocaleAiSourceHooks.t("copy.testNotificationTimedOut.d2c1f5"))); }, 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(pomeLocaleAiSourceHooks.t("copy.theNotificationScriptFailed.820362"))); });
      child.stdin.on('error', () => {}); child.stdin.end(source === 'codex' ? '' : payload);
    });
  }
  return { list, status, preview, apply, runTest };
}

module.exports = { SOURCES, createAiSourceHooks, editNotify, readConfig, originalNotify };
