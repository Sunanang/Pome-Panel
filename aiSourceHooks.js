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
const catalog = require('./aiProviderCatalog');
const SOURCES = Object.freeze(catalog.hookableIds());
const LABELS = catalog.labels();
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
  if (source === 'copilot') {
    if (value.version !== undefined && value.version !== 1) throw new Error('unsupported_copilot_hooks_version');
    for (const event of ['agentStop', 'errorOccurred']) if (value.hooks?.[event] !== undefined && !Array.isArray(value.hooks[event])) throw new Error('invalid_copilot_hooks');
  }
  if (source === 'antigravity' && value['pome-panel'] !== undefined) {
    const owned = value['pome-panel'];
    if (!owned || typeof owned !== 'object' || Array.isArray(owned)
      || (owned.Stop !== undefined && !Array.isArray(owned.Stop))) throw new Error('invalid_antigravity_hooks');
  }
  if (source === 'codex' && value.notify !== undefined && (!Array.isArray(value.notify) || value.notify.some(v => typeof v !== 'string'))) throw new Error(pomeLocaleAiSourceHooks.t("copy.notifyMustBeAnArrayOfCommand.1e7bea"));
  if (source !== 'codex') {
    if (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks))) throw new Error(pomeLocaleAiSourceHooks.t("copy.hooksMustBeAnObject.7eb631"));
    if (source === 'cursor' && value.hooks?.afterAgentResponse !== undefined && !Array.isArray(value.hooks.afterAgentResponse)) throw new Error(pomeLocaleAiSourceHooks.t("copy.afteragentresponseHooksMustBeAnArray.a92e31"));
    const stopKey = source === 'claude' || source === 'grok' ? 'Stop' : 'stop';
    const hooks = value.hooks?.[stopKey];
    if (hooks !== undefined && !Array.isArray(hooks)) throw new Error(pomeLocaleAiSourceHooks.t("copy.completionHooksMustBeAnArray.e6d762"));
    if ((source === 'claude' || source === 'grok') && hooks?.some(group => !group || !Array.isArray(group.hooks))) throw new Error(pomeLocaleAiSourceHooks.t("copy.theStopHookFormatIsDamaged.4e806a"));
    if (source === 'grok' && value.hooks?.StopFailure !== undefined && (!Array.isArray(value.hooks.StopFailure) || value.hooks.StopFailure.some(group => !group || !Array.isArray(group.hooks)))) {
      throw new Error(pomeLocaleAiSourceHooks.t("copy.theStopHookFormatIsDamaged.4e806a"));
    }
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

function createAiSourceHooks({ homeDir = os.homedir(), appDir = __dirname, runtimePath = process.execPath, env = process.env,
  platform = process.platform, now = Date.now, runtimeCheck } = {}) {
  const previews = new Map();
  let runtimePromise;
  const grokHome = typeof env.GROK_HOME === 'string' && env.GROK_HOME.trim()
    ? path.resolve(env.GROK_HOME) : path.join(homeDir, '.grok');
  const copilotHome = typeof env.COPILOT_HOME === 'string' && env.COPILOT_HOME.trim() ? path.resolve(env.COPILOT_HOME) : path.join(homeDir, '.copilot');
  const geminiHome = path.join(homeDir, '.gemini');
  const files = {
    codex: path.join(homeDir, '.codex/config.toml'),
    claude: path.join(homeDir, '.claude/settings.json'),
    cursor: path.join(homeDir, '.cursor/hooks.json'),
    grok: path.join(grokHome, 'hooks', 'pome-panel.json'),
    copilot: path.join(copilotHome, 'hooks', 'pome-panel.json'),
    antigravity: path.join(geminiHome, 'config', 'hooks.json'),
  };
  const script = source => path.join(appDir, 'scripts', source === 'claude-attention' ? 'claude-attention.js' : `${source}-notify.js`);
  const hookMarker = source => platform === 'win32' ? `pome-panel-hook=${source}` : marker(source);
  const supported = source => { if (!SOURCES.includes(source)) throw new Error(pomeLocaleAiSourceHooks.t("copy.unsupportedAiSource.25257a")); };
  const newEvents = { copilot: ['agentStop', 'errorOccurred'], antigravity: ['Stop'] };
  const eventPath = (source, event) => source === 'antigravity' ? ['pome-panel', event] : ['hooks', event];
  const eventItems = (config, source, event) => source === 'antigravity' ? config.value['pome-panel']?.[event] || [] : config.value.hooks?.[event] || [];
  function newEntry(source, event) {
    return source === 'copilot' ? { type: 'command', exec: runtimePath, args: [script(source), marker(source)],
      env: { ELECTRON_RUN_AS_NODE: '1', POME_COMPLETION_EVENT: event }, timeoutSec: 5 }
      : { type: 'command', command: shellCommand(source), timeout: 5 };
  }
  function newMatches(config, source) {
    if ((source === 'copilot' && config.value.version !== 1)
      || (source === 'antigravity' && config.value['pome-panel']?.enabled === false)) return false;
    return newEvents[source].every(event => {
      const items = eventItems(config, source, event).filter(item => isOwned(item, source)), expected = newEntry(source, event);
      return items.length === 1 && Object.keys(expected).every(key => JSON.stringify(items[0][key]) === JSON.stringify(expected[key]))
        && !items[0].matcher && !items[0].bash && !items[0].powershell && !items[0].windows && !items[0].linux && !items[0].osx
        && (source !== 'copilot' || !items[0].command);
    });
  }
  function editNew(config, source, disconnect) {
    if (!disconnect && newMatches(config, source)) return config.text;
    let text = config.text;
    for (const event of newEvents[source]) {
      const keyPath = eventPath(source, event), items = eventItems(config, source, event);
      const marked = items.map((item, i) => isOwned(item, source) ? i : -1).filter(i => i >= 0);
      for (const i of marked.reverse()) text = editJson(text, [...keyPath, i], undefined);
      const remaining = source === 'antigravity' ? JSON.parse(text)['pome-panel']?.[event] : JSON.parse(text).hooks?.[event];
      if (!disconnect) text = editJson(text, Array.isArray(remaining) ? [...keyPath, -1] : keyPath, Array.isArray(remaining) ? newEntry(source, event) : [newEntry(source, event)]);
      else if (marked.length && remaining?.length === 0) text = editJson(text, keyPath, undefined);
    }
    if (!disconnect && source === 'copilot') text = editJson(text, ['version'], 1);
    if (!disconnect && source === 'antigravity' && config.value['pome-panel']?.enabled === false) text = editJson(text, ['pome-panel', 'enabled'], true);
    const container = source === 'antigravity' ? 'pome-panel' : 'hooks';
    if (disconnect && installedItems(config, source).length && Object.keys(JSON.parse(text)[container] || {}).length === 0) text = editJson(text, [container], undefined);
    return text;
  }
  function grokOwnedGroups(config, event) {
    const groups = config.value.hooks?.[event] || [];
    return groups.flatMap((group, i) => (group.hooks || []).flatMap((hook, j) => (isOwned(hook, 'grok') ? [{ group, hook, path: ['hooks', event, i, 'hooks', j] }] : [])));
  }
  function grokMatches(config, expected) {
    return ['Stop', 'StopFailure'].every((event) => {
      const owned = grokOwnedGroups(config, event);
      return owned.length === 1 && owned[0].hook.type === 'command' && owned[0].hook.command === expected
        && !owned[0].group.matcher && owned[0].hook.timeout === 5;
    });
  }
  function editGrok(config, command, disconnect) {
    if (!disconnect && grokMatches(config, command)) return config.text;
    let text = config.text;
    for (const event of ['Stop', 'StopFailure']) {
      const groups = config.value.hooks?.[event] || [];
      for (let i = groups.length - 1; i >= 0; i--) {
        const marked = groups[i].hooks.map((hook, j) => isOwned(hook, 'grok') ? j : -1).filter(j => j >= 0);
        if (marked.length && marked.length === groups[i].hooks.length) text = editJson(text, ['hooks', event, i], undefined);
        else for (const j of marked.reverse()) text = editJson(text, ['hooks', event, i, 'hooks', j], undefined);
      }
      const remaining = JSON.parse(text).hooks?.[event];
      if (!disconnect) {
        const entry = { hooks: [{ type: 'command', command, timeout: 5 }] };
        text = editJson(text, Array.isArray(remaining) ? ['hooks', event, -1] : ['hooks', event], Array.isArray(remaining) ? entry : [entry]);
      } else if (remaining?.length === 0 && grokOwnedGroups(config, event).length) {
        text = editJson(text, ['hooks', event], undefined);
      }
    }
    if (disconnect && installedItems(config, 'grok').length && Object.keys(JSON.parse(text).hooks || {}).length === 0) {
      text = editJson(text, ['hooks'], undefined);
    }
    return text;
  }
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
    if (source === 'copilot' && Array.isArray(item?.args) && item.args.includes(marker(source))) return true;
    return typeof item?.command === 'string' && new RegExp(`(?:^|[\\s"'])(?:--)?pome-panel-hook=${source}(?:$|[\\s"'])`).test(item.command);
  }
  function installedItems(config, source) {
    if (newEvents[source]) return newEvents[source].flatMap(event => eventItems(config, source, event).filter(item => isOwned(item, source)));
    if (source === 'codex') return config.value.notify?.some(value => [marker(source), `pome-panel-hook=${source}`].includes(value)) ? [config.value.notify] : [];
    if (source === 'grok') return ['Stop', 'StopFailure'].flatMap((event) => grokOwnedGroups(config, event).map((row) => row.hook));
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
    const staticCaps = catalog.get(source)?.capabilities || {};
    const completion = connected
      ? (staticCaps.completion === 'unsupported' ? 'unsupported' : staticCaps.completion || 'partial')
      : 'unsupported';
    const attention = connected && complete ? (staticCaps.attention || 'unsupported') : 'unsupported';
    return {
      surface: catalog.get(source)?.surface || 'desktop',
      providerVersion: 'unverified',
      usage: staticCaps.usage || 'unsupported',
      completion,
      attention,
      input: attention === 'partial' ? 'partial' : 'unsupported',
      select: attention === 'partial' ? 'partial' : 'unsupported',
      approve: attention === 'partial' ? 'partial' : 'unsupported',
      autoResolve: attention === 'partial' ? 'partial' : 'unsupported',
    };
  }
  async function status(source) {
    supported(source);
    const filePath = files[source];
    const detected = source === 'grok' ? fs.existsSync(grokHome) : source === 'copilot' ? fs.existsSync(copilotHome)
      : source === 'antigravity' ? ['antigravity', 'antigravity-cli', 'antigravity-ide'].some(dir => fs.existsSync(path.join(geminiHome, dir))) : fs.existsSync(path.dirname(filePath));
    const base = { source, label: LABELS[source], filePath, detected, attentionCapabilities: capabilities(source, false, false) };
    if (!detected) return { ...base, state: 'undetected', message: pomeLocaleAiSourceHooks.t("copy.localToolDirectoryNotDetected.c78222") };
    try {
      const config = readConfig(filePath, source), items = installedItems(config, source);
      if (!(await runtimeReady()) || !fs.existsSync(runtimePath) || !fs.existsSync(script(source))
        || (newEvents[source] || source === 'grok') && !fs.existsSync(path.join(appDir, 'scripts/completion-forwarder.js'))
        || source === 'claude' && !fs.existsSync(script('claude-attention'))) {
        return { ...base, state: 'error', message: pomeLocaleAiSourceHooks.t("copy.theScriptPathIsMissingOrThe.a57f6c"), repairable: false };
      }
      if (newEvents[source]) {
        const matches = newMatches(config, source);
        return { ...base, state: matches ? 'connected' : items.length ? 'error' : 'disconnected', repairable: true,
          attentionCapabilities: capabilities(source, matches, false),
          message: matches ? pomeLocaleAiSourceHooks.t('copy.connectedListeningForLocalCompletionEvents.256f7f') : pomeLocaleAiSourceHooks.t('copy.appendTheHookWhilePreservingExistingConfiguration.429226', { arg1: newEvents[source].join(' + ') }) };
      }
      const eventLabel = source === 'claude' || source === 'grok' ? 'Stop' : 'stop';
      if (!items.length) return { ...base, state: 'disconnected', message: source === 'codex' ? pomeLocaleAiSourceHooks.t("copy.writeNotifyWhilePreservingAndForwardingThe.416e9e") : pomeLocaleAiSourceHooks.t("copy.appendTheHookWhilePreservingExistingConfiguration.429226", { arg1: (source === 'grok' ? 'Stop + StopFailure' : eventLabel) }) };
      const expected = source === 'codex' ? codexCommand(originalNotify(items[0])) : shellCommand(source);
      if (source === 'grok') {
        const matches = grokMatches(config, expected);
        return { ...base, state: matches ? 'connected' : 'error', repairable: true,
          attentionCapabilities: capabilities(source, matches, false),
          message: matches ? pomeLocaleAiSourceHooks.t("copy.connectedListeningForLocalCompletionEvents.256f7f") : pomeLocaleAiSourceHooks.t("copy.thePomeHookPathOrRuntimeHas.8f7c1e") };
      }
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
    if (newEvents[source]) {
      text = editNew(config, source, action === 'disconnect');
      added = `${newEvents[source].join(' + ')} → ${action === 'disconnect' ? pomeLocaleAiSourceHooks.t('copy.removeThePomeHook.da37ec') : source === 'copilot' ? runtimePath + ' ' + script(source) : shellCommand(source)}`;
    } else if (source === 'grok') {
      const expected = shellCommand('grok');
      text = editGrok(config, expected, action === 'disconnect');
      if (action === 'disconnect') {
        if (!config.exists || !owned.length) {
          text = config.text;
          added = pomeLocaleAiSourceHooks.t("copy.noPomeConfigurationFoundNoChangesNeeded.4861fe");
        } else {
          added = pomeLocaleAiSourceHooks.t("copy.removeThePomeHook.da37ec");
        }
      } else {
        added = `Stop + StopFailure → ${expected}`;
      }
    } else if (action === 'disconnect' && !owned.length && !(source === 'claude' && hasAttentionHooks(config)) && !(source === 'cursor' && config.value.hooks?.afterAgentResponse?.some(item => isOwned(item, source)))) {
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
    const removeFile = action === 'disconnect' && config.exists && owned.length > 0 && (source === 'grok' && Object.keys(JSON.parse(text)).length === 0
      || source === 'copilot' && Object.keys(JSON.parse(text)).every(key => key === 'version'));
    const plan = { source, action, filePath: files[source], backupPath, token, added, hash: config.hash, text, existed: config.exists, expires: now() + 300000, removeFile };
    previews.set(token, plan);
    for (const [id, row] of previews) if (row.expires < now()) previews.delete(id);
    return { source, action, filePath: plan.filePath, backupPath, token, added, unchanged: text === config.text && !plan.removeFile, message: source === 'codex' ? pomeLocaleAiSourceHooks.t("copy.quitAndReopenCodexToApplyThe.46b626") : pomeLocaleAiSourceHooks.t("copy.restartTheToolAfterSavingToReload.2a0689") };
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
      const changing = plan.removeFile || plan.text !== config.text;
      if (changing) {
        const original = config.exists ? Buffer.from(config.text) : Buffer.alloc(0);
        writeAtomic(plan.backupPath, original);
        if (!fs.readFileSync(plan.backupPath).equals(original)) throw new Error(pomeLocaleAiSourceHooks.t("copy.backupVerificationFailedConfigurationWasNotChanged.0a6000"));
        if (plan.removeFile) {
          fs.unlinkSync(plan.filePath);
        } else {
          fs.mkdirSync(path.dirname(plan.filePath), { recursive: true, mode: 0o700 });
          writeAtomic(plan.filePath, plan.text);
        }
      }
      return { ok: true, source: plan.source, action: plan.action, backupPath: changing ? plan.backupPath : null, message: plan.source === 'codex' ? pomeLocaleAiSourceHooks.t("copy.quitAndReopenCodexToApplyThe.46b626") : pomeLocaleAiSourceHooks.t("copy.sourceConfigurationUpdated.3181cd"), statuses: await list() };
    } catch (error) { return { ok: false, error: 'config_write_failed', message: error.message }; }
  }
  async function runTest(source, { token, port = 43821 } = {}) {
    const current = await status(source);
    if (current.state !== 'connected') throw new Error(pomeLocaleAiSourceHooks.t("copy.theSourceIsnTConnectedCorrectlyConnect.e3cf69"));
    const stopName = source === 'claude' || source === 'grok' ? 'Stop' : 'stop';
    const payload = JSON.stringify({ _pome_test: true, _pome_test_token: token, event_id: token,
      title: pomeLocaleAiSourceHooks.t("copy.connectionTest.dd9a12", { arg1: (LABELS[source]) }), session_id: token, sessionId: token, conversationId: token, conversation_id: token, generation_id: token, hook_event_name: stopName, hookEventName: stopName });
    await new Promise((resolve, reject) => {
      const child = spawn(runtimePath, [script(source), marker(source), ...(source === 'codex' ? [payload] : [])], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POME_NOTIFY_PORT: String(port), ...(source === 'grok' ? { GROK_HOOK_EVENT: 'Stop' } : {}) }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
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
