'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskApps, windowsAppPaths } = require('../platform-adapters/task-apps');
const terminalPlist = '/System/Applications/Utilities/Terminal.app/Contents/Info.plist';
const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows' };
function disk(files = [], directories = []) {
  return { realpathSync: value => { if (!directories.includes(value)) throw new Error('missing'); return value; },
    statSync: value => { if (!files.includes(value) && !directories.includes(value)) throw new Error('missing');
      return { isFile: () => files.includes(value), isDirectory: () => directories.includes(value) }; } };
}
for (const source of ['codex', 'cursor', 'antigravity']) {
  test(`macOS ${source} opens only its discovered bundle without matching titles or trusting record bundle IDs`, async () => {
    const calls = [];
    const apps = createTaskApps('darwin', { disk: disk(), resolveTaskApp: async received => { assert.equal(received, source); return { bundleId: `runtime.${source}` }; },
      runFile: async (...args) => { calls.push(args); return ''; } });
    const result = await apps.open({ source, project: 'unmatched-project', window: { bundleId: 'untrusted.app', cwd: 'irrelevant' } });
    assert.equal(result.ok, true); assert.deepEqual(calls, [['/usr/bin/open', ['-b', `runtime.${source}`]]]);
  });
  test(`macOS ${source} also opens when not running by reading the installed Info.plist`, async () => {
    const name = {codex:'Codex',cursor:'Cursor',antigravity:'Antigravity'}[source];
    const plist = `/Applications/${name}.app/Contents/Info.plist`, calls = [];
    const apps = createTaskApps('darwin', { disk: disk([plist]), resolveTaskApp: async () => null,
      runFile: async (file, args) => { calls.push([file, args]); return file.endsWith('PlistBuddy') ? 'installed.bundle' : ''; } });
    assert.equal((await apps.open({ source })).ok, true);
    assert.deepEqual(calls.at(-1), ['/usr/bin/open', ['-b', 'installed.bundle']]);
  });
  test(`Windows ${source} finds its common executable path and starts without a shell`, async () => {
    const file = windowsAppPaths(source, env)[0], calls = [];
    const apps = createTaskApps('win32', { env, disk: disk([file]), startFile: async (...args) => calls.push(args) });
    assert.equal((await apps.open({ source })).ok, true); assert.deepEqual(calls, [[file, []]]);
  });
}
for (const platform of ['darwin', 'win32']) for (const [source, label] of [['codex', 'Codex'], ['cursor', 'Cursor'], ['claude', '终端'], ['grok', '终端'], ['copilot', '终端'], ['antigravity', 'Antigravity']]) {
  test(`${platform} missing ${source} returns a readable message`, async () => {
    const result = await createTaskApps(platform, { env, disk: disk() }).open({ source });
    assert.equal(result.ok, false); assert.equal(result.message, `未找到 ${label}。`);
  });
}
test('macOS launch failure reports a lightweight error', async () => {
  const result = await createTaskApps('darwin', { resolveTaskApp: async () => ({ bundleId: 'runtime.codex' }),
    runFile: async () => { throw new Error('open failed'); } }).open({ source: 'codex' });
  assert.equal(result.error, 'launch_failed'); assert.match(result.message, /打开 Codex 失败/);
});
for (const source of ['claude', 'grok', 'copilot']) {
test(`${source}: Claude without cwd opens only Terminal`, async () => {
  const calls = [];
  const apps = createTaskApps('darwin', { disk: disk([terminalPlist]), runFile: async (file, args) => {
    calls.push([file, args]); return file.endsWith('PlistBuddy') ? 'runtime.terminal' : ''; } });
  assert.equal((await apps.open({ source, window: null })).ok, true);
  assert.deepEqual(calls.at(-1), ['/usr/bin/open', ['-b', 'runtime.terminal']]);
  assert.equal(calls.length, 2);
});
test(`${source}: Claude cwd is a validated directory argv, including shell metacharacters`, async () => {
  const cwd = "/tmp/project '$(touch pwned)`;&", calls = [];
  const apps = createTaskApps('darwin', { disk: disk([terminalPlist], [cwd]), runFile: async (file, args) => {
    calls.push([file, args]); return file.endsWith('PlistBuddy') ? 'runtime.terminal' : file.endsWith('osascript') ? '[]' : ''; } });
  assert.equal((await apps.open({ source, window: { cwd } })).ok, true);
  assert.deepEqual(calls.at(-1), ['/usr/bin/open', ['-b', 'runtime.terminal', cwd]]);
});
test(`${source}: Claude reuses the existing Terminal tab only when its shell cwd matches exactly`, async () => {
  const cwd = '/tmp/project', calls = [];
  const apps = createTaskApps('darwin', { disk: disk([terminalPlist], [cwd]), runFile: async (file, args) => {
    calls.push([file, args]);
    if (file.endsWith('PlistBuddy')) return 'runtime.terminal';
    if (file.endsWith('ps')) return '42 ttys001 /bin/zsh';
    if (file.endsWith('lsof')) return 'p42\nfcwd\nn/tmp/project';
    if (args.includes('--')) return 'ok';
    return JSON.stringify([{ windowId: 3, tabIndex: 1, tty: '/dev/ttys001' }]);
  } });
  assert.equal((await apps.open({ source, window: { cwd } })).ok, true);
  assert.deepEqual(calls.at(-1)[1].slice(-3), ['--', '3', '1']);
  assert.equal(calls.some(([file]) => file === '/usr/bin/open'), false);
});
test(`${source}: invalid, relative, nonexistent, control-character and file cwd never execute a command`, async () => {
  for (const cwd of ['relative/path', '/missing', '/tmp/line\nattack', '/tmp/file', 12]) {
    const apps = createTaskApps('darwin', { disk: disk(['/tmp/file']), runFile: async () => { throw new Error('must not run'); } });
    assert.equal((await apps.open({ source, window: { cwd } })).error, 'invalid_cwd');
  }
});
test(`${source}: Windows Claude uses Windows Terminal -d and falls back to encoded PowerShell literal cd`, async () => {
  const [wt, powershell] = windowsAppPaths(source, env), cwd = "C:\\work\\x'$(echo attack)`", calls = [];
  let apps = createTaskApps('win32', { env, disk: disk([wt], [cwd]), startFile: async (...args) => calls.push(args) });
  assert.equal((await apps.open({ source, window: { cwd } })).ok, true);
  assert.deepEqual(calls.pop(), [wt, ['-d', cwd]]);
  apps = createTaskApps('win32', { env, disk: disk([powershell], [cwd]), startFile: async (...args) => calls.push(args) });
  assert.equal((await apps.open({ source, window: { cwd } })).ok, true);
  const [file, args] = calls.pop(); assert.equal(file, powershell);
  assert.deepEqual(args.slice(0, 3), ['-NoLogo', '-NoExit', '-EncodedCommand']);
  assert.equal(Buffer.from(args[3], 'base64').toString('utf16le'), "Set-Location -LiteralPath 'C:\\work\\x''$(echo attack)`'");
  assert.equal((await apps.open({ source })).ok, true);
  assert.deepEqual(calls.pop(), [powershell, ['-NoLogo', '-NoExit']]);
});
test(`${source}: WT command separators in cwd remain encoded data rather than extra terminal commands`, async () => {
  const [wt, powershell] = windowsAppPaths(source, env), cwd = "C:\\work\\x;new-tab calc.exe '$(echo attack)", calls = [];
  const apps = createTaskApps('win32', { env, disk: disk([wt, powershell], [cwd]), startFile: async (...args) => calls.push(args) });
  assert.equal((await apps.open({ source, window: { cwd } })).ok, true);
  const [file, args] = calls[0]; assert.equal(file, wt);
  assert.deepEqual(args.slice(0, 5), ['new-tab', powershell, '-NoLogo', '-NoExit', '-EncodedCommand']);
  assert.equal(args.some(arg => arg.includes(';')), false);
  assert.equal(Buffer.from(args[5], 'base64').toString('utf16le'), "Set-Location -LiteralPath 'C:\\work\\x;new-tab calc.exe ''$(echo attack)'");
});
test(`${source}: failed Windows Terminal launch falls back to PowerShell; failed apps report launch failure`, async () => {
  const [wt, powershell] = windowsAppPaths(source, env), calls = [];
  const apps = createTaskApps('win32', { env, disk: disk([wt, powershell]), startFile: async file => { calls.push(file); if (file === wt) throw new Error('broken alias'); } });
  assert.equal((await apps.open({ source })).ok, true); assert.deepEqual(calls, [wt, powershell]);
  const result = await createTaskApps('win32', { env, disk: disk([windowsAppPaths('cursor', env)[0]]),
    startFile: async () => { throw new Error('failed'); } }).open({ source: 'cursor' });
  assert.equal(result.error, 'launch_failed');
});
}
test('legacy GPT history cannot open an arbitrary app', async () => {
  assert.equal((await createTaskApps('darwin').open({ source: 'gpt', window: { bundleId: 'arbitrary.app' } })).error, 'unsupported_source');
});

test('Antigravity IDE routing passes only a known surface hint, never a stored native identity', async () => {
  const calls=[];
  const apps=createTaskApps('darwin',{resolveTaskApp:async(source,context)=>{
    assert.equal(source,'antigravity');assert.deepEqual(context,{window:{app:'Antigravity IDE'}});return {bundleId:'runtime.antigravity-ide'};
  },runFile:async(...args)=>calls.push(args)});
  assert.equal((await apps.open({source:'antigravity',window:{app:'Antigravity IDE',bundleId:'untrusted.other-app'}})).ok,true);
  assert.deepEqual(calls,[['/usr/bin/open',['-b','runtime.antigravity-ide']]]);
  const ide=windowsAppPaths('antigravity',env,'Antigravity IDE')[0],winCalls=[];
  const win=createTaskApps('win32',{env,disk:disk([ide]),startFile:async(...args)=>winCalls.push(args)});
  assert.equal((await win.open({source:'antigravity',window:{app:'Antigravity IDE'}})).ok,true);assert.deepEqual(winCalls,[[ide,[]]]);
});
