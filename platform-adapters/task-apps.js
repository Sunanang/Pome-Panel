'use strict';
const pomeLocalePlatformAdaptersTaskApps = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;


const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const LABELS = { codex: 'Codex', cursor: 'Cursor', get claude() { return pomeLocalePlatformAdaptersTaskApps.t("copy.terminal.e2a76e"); } };
const APP_NAMES = { codex: ['Codex', 'ChatGPT'], cursor: ['Cursor'], claude: ['Terminal'] };
const TERMINAL_TABS_JXA = `
function run() {
  const terminal = Application('Terminal');
  if (!terminal.running()) return '[]';
  const rows = [];
  terminal.windows().forEach(window => window.tabs().forEach((tab, tabIndex) => {
    rows.push({ windowId: window.id(), tabIndex, tty: tab.tty() });
  }));
  return JSON.stringify(rows);
}`;
const TERMINAL_FOCUS_JXA = `
function run(argv) {
  const terminal = Application('Terminal');
  const window = terminal.windows.byId(Number(argv[0]));
  window.selectedTab = window.tabs()[Number(argv[1])];
  window.index = 1;
  terminal.activate();
  return 'ok';
}`;

function runFile(file, args) {
  return new Promise((resolve, reject) => execFile(file, args,
    { timeout: 2500, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(String(stdout || '').trim())));
}

function startFile(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function validateCwd(value, platform, disk = fs) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid_cwd');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(value) || (platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value))) throw new Error('invalid_cwd');
  try {
    const resolved = disk.realpathSync(value);
    if (!paths.isAbsolute(resolved) || !disk.statSync(resolved).isDirectory()) throw new Error('invalid_cwd');
    return resolved;
  } catch { throw new Error('invalid_cwd'); }
}

function windowsAppPaths(source, env) {
  const roots = [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles || env.PROGRAMFILES, env['ProgramFiles(x86)']].filter(Boolean);
  if (source === 'codex' || source === 'cursor') {
    const name = source === 'codex' ? 'Codex' : 'Cursor';
    const paths = roots.map(root => path.win32.join(root, name, `${name}.exe`));
    if (source === 'codex' && env.LOCALAPPDATA) paths.push(path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'Codex.exe'));
    return paths;
  }
  return [
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe'),
    env.SystemRoot && path.win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ].filter(Boolean);
}

function createTaskApps(platform, options = {}) {
  const disk = options.disk || fs, env = options.env || process.env;
  const run = options.runFile || runFile, start = options.startFile || startFile;
  const exists = file => { try { return disk.statSync(file).isFile(); } catch { return false; } };

  async function macBundle(source) {
    if (source !== 'claude' && options.resolveTaskApp) {
      try {
        const app = await options.resolveTaskApp(source);
        if (app?.bundleId && /^[\w.-]+$/.test(app.bundleId)) return app.bundleId;
      } catch {}
    }
    const roots = source === 'claude' ? ['/System/Applications/Utilities', '/Applications/Utilities'] : ['/Applications', path.posix.join(options.homeDir || os.homedir(), 'Applications')];
    for (const root of roots) for (const name of APP_NAMES[source]) {
      const plist = path.posix.join(root, `${name}.app`, 'Contents', 'Info.plist');
      if (!exists(plist)) continue;
      try {
        const bundleId = await run('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleIdentifier', plist]);
        if (/^[\w.-]+$/.test(bundleId)) return bundleId;
      } catch {}
    }
    return null;
  }

  async function reuseTerminal(cwd) {
    try {
      const tabs = JSON.parse(await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', TERMINAL_TABS_JXA]));
      if (!tabs.length) return false;
      const processes = await run('/bin/ps', ['-axo', 'pid=,tty=,comm=']);
      for (const tab of tabs) {
        const tty = String(tab.tty).replace(/^\/dev\//, '');
        const pids = processes.split('\n').map(line => line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/))
          .filter(row => row && row[2] === tty && /(?:^|\/)(?:-?bash|-?zsh|fish|sh|tcsh|csh|nu)$/.test(row[3])).map(row => row[1]);
        if (!pids.length) continue;
        const directories = await run('/usr/sbin/lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn']);
        if (!directories.split('\n').some(line => line === `n${cwd}`)) continue;
        return await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', TERMINAL_FOCUS_JXA, '--', String(tab.windowId), String(tab.tabIndex)]) === 'ok';
      }
    } catch { /* If automation is unavailable, open a new native Terminal window. */ }
    return false;
  }

  async function open(record) {
    const source = record?.source, label = LABELS[source];
    if (!label) return { ok: false, error: 'unsupported_source', message: pomeLocalePlatformAdaptersTaskApps.t("copy.thisRecordHasNoAppToOpen.0ddec0") };
    let cwd;
    try { cwd = source === 'claude' ? validateCwd(record.window?.cwd ?? record.cwd, platform, disk) : null; }
    catch { return { ok: false, error: 'invalid_cwd', message: pomeLocalePlatformAdaptersTaskApps.t("copy.theWorkingDirectoryIsInvalidOrNo.9c7fb1") }; }
    try {
      if (platform === 'darwin') {
        const bundleId = await macBundle(source);
        if (!bundleId) return { ok: false, error: 'app_not_installed', message: pomeLocalePlatformAdaptersTaskApps.t("copy.couldnTFind.9d877a", { arg1: (label) }) };
        // Use argv for the directory; never compose a shell cd command.
        if (source !== 'claude' || !cwd || !await reuseTerminal(cwd)) {
          await run('/usr/bin/open', ['-b', bundleId, ...(cwd ? [cwd] : [])]);
        }
      } else if (platform === 'win32') {
        const files = windowsAppPaths(source, env).filter(exists);
        if (!files.length) return { ok: false, error: 'app_not_installed', message: pomeLocalePlatformAdaptersTaskApps.t("copy.couldnTFind.9d877a", { arg1: (label) }) };
        let launched = false;
        for (const file of files) {
          const terminal = /[\\/]wt\.exe$/i.test(file);
          const command = cwd ? `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'` : '';
          const powershellArgs = ['-NoLogo', '-NoExit', ...(command ? ['-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')] : [])];
          // WT also interprets semicolons as command separators. Keep such paths
          // inside encoded PowerShell data even though we never invoke a shell.
          const powershell = files.find(candidate => /[\\/]powershell\.exe$/i.test(candidate));
          if (terminal && cwd?.includes(';') && !powershell) continue;
          const args = source !== 'claude' ? [] : terminal ? cwd?.includes(';')
            ? ['new-tab', powershell, ...powershellArgs] : cwd ? ['-d', cwd] : [] : powershellArgs;
          try { await start(file, args); launched = true; break; } catch { /* Try another install or PowerShell. */ }
        }
        if (!launched) throw new Error('launch_failed');
      } else return { ok: false, error: 'unsupported_platform', message: pomeLocalePlatformAdaptersTaskApps.t("copy.openingSourceAppsIsnTSupportedOn.8e7504") };
      return { ok: true, message: pomeLocalePlatformAdaptersTaskApps.t("copy.opened.f7baf1", { arg1: (label) }) };
    } catch { return { ok: false, error: 'launch_failed', message: pomeLocalePlatformAdaptersTaskApps.t("copy.couldnTOpenTryAgain.c927f8", { arg1: (label) }) }; }
  }
  return { open };
}

module.exports = { createTaskApps, validateCwd, windowsAppPaths };
