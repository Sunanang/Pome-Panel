'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createAiSourceHooks, readConfig, originalNotify, codexNotifyChain } = require('../aiSourceHooks');

const sky = (previous, executable = '/fixture/SkyComputerUseClient') => [executable, 'turn-ended', '--previous-notify', JSON.stringify(previous)];
const pome = previous => ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', '/fixture/Pome', '/fixture/codex-notify.js', '--pome-panel-hook=codex', `--pome-forward=${Buffer.from(JSON.stringify(previous)).toString('base64url')}`];
function fixture(t, platform = process.platform) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-codex-chain-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.codex/config.toml');
  fs.mkdirSync(path.dirname(file));
  const service = createAiSourceHooks({ env: {}, homeDir: home, platform, runtimeCheck: () => true });
  const write = command => fs.writeFileSync(file, `# preserve comment\nnotify = ${JSON.stringify(command)} # preserve notify comment\n[features]\ncomputer_use = true\n`);
  return { home, file, service, write };
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: wrapped hook is repairable, flattened, idempotent and disconnect preserves other commands`, async t => {
    const { file, service, write } = fixture(t, platform);
    const executable = platform === 'win32' ? 'C:\\Codex\\codex-computer-use.exe' : '/fixture/SkyComputerUseClient';
    const original = ['other-notifier', 'literal $(no-shell)', '--keep'];
    const wrapped = sky(pome(sky(pome(original), executable)), executable);
    const cleaned = sky(original, executable);
    write(wrapped);
    const before = fs.readFileSync(file, 'utf8');
    const status = await service.status('codex');
    assert.equal(status.state, 'error'); assert.equal(status.repairable, true);
    assert.equal(status.notifyWrapped, true); assert.equal(status.attentionCapabilities.completion, 'unsupported');
    assert.match(status.message, /Computer Use/);
    const plan = await service.preview('codex', 'repair');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'preview must not write');
    assert.equal((await service.apply(plan.token)).ok, true);
    assert.equal(fs.readFileSync(plan.backupPath, 'utf8'), before);
    const repaired = readConfig(file, 'codex');
    assert.deepEqual(originalNotify(repaired.value.notify), cleaned);
    assert.equal(codexNotifyChain(repaired.value.notify).pomeCount, 1);
    assert.match(repaired.text, /# preserve notify comment/); assert.equal(repaired.value.features.computer_use, true);
    assert.equal((await service.status('codex')).state, 'connected');
    const repeat = await service.preview('codex', 'repair');
    assert.equal((await service.apply(repeat.token)).backupPath, null);
    assert.equal(fs.readFileSync(file, 'utf8'), repaired.text);
    // A subsequent Desktop rewrite is detected again, and repair never accumulates Pome layers.
    write(sky(repaired.value.notify, executable));
    assert.equal((await service.status('codex')).notifyWrapped, true);
    const again = await service.preview('codex', 'repair'); await service.apply(again.token);
    assert.equal(codexNotifyChain(readConfig(file, 'codex').value.notify).pomeCount, 1);
    const disconnect = await service.preview('codex', 'disconnect'); await service.apply(disconnect.token);
    assert.deepEqual(readConfig(file, 'codex').value.notify, cleaned);
    assert.equal((await service.status('codex')).state, 'disconnected');
  });
}

test('disconnect also removes a nested Pome without first reconnecting', async t => {
  const { file, service, write } = fixture(t);
  write(sky(pome(null)));
  const plan = await service.preview('codex', 'disconnect'); await service.apply(plan.token);
  assert.deepEqual(readConfig(file, 'codex').value.notify, ['/fixture/SkyComputerUseClient', 'turn-ended']);
});

test('normalization preserves opaque commands and untouched JSON byte-for-byte', () => {
  const opaque = ['custom-notifier', '--previous-notify', JSON.stringify(pome(null))];
  assert.deepEqual(codexNotifyChain(opaque), { command: opaque, pomeCount: 0 });
  const literalMarker = ['custom-notifier', '--pome-panel-hook=codex', '--pome-forward=' + Buffer.from('["other"]').toString('base64url')];
  assert.deepEqual(codexNotifyChain(literalMarker), { command: literalMarker, pomeCount: 0 });
  const unchanged = ['/fixture/SkyComputerUseClient', 'turn-ended', '--previous-notify', '[ "original", "\\/escaped" ]', '--keep'];
  assert.deepEqual(codexNotifyChain(unchanged), { command: unchanged, pomeCount: 0 });
  const inline = ['/fixture/SkyComputerUseClient', 'turn-ended', `--previous-notify=${JSON.stringify(pome(['original']))}`, '--keep'];
  assert.deepEqual(codexNotifyChain(inline), { command: ['/fixture/SkyComputerUseClient', 'turn-ended', '--previous-notify=["original"]', '--keep'], pomeCount: 1 });
  assert.deepEqual(codexNotifyChain(sky(pome([]))).command, sky([]));
  assert.deepEqual(codexNotifyChain(sky(pome(sky(['original'])))).command, sky(['original']));
  // A different helper version/path or additional arguments may have distinct behavior.
  const other = sky(['original'], '/other/SkyComputerUseClient');
  assert.deepEqual(codexNotifyChain(sky(pome(other))).command, sky(other));
  const options = [...sky(['original']), '--keep'];
  assert.deepEqual(codexNotifyChain(sky(pome(options))).command, sky(options));
});

test('invalid or excessive recognized chains refuse writes and backups', async t => {
  const { file, service, write } = fixture(t);
  let deep = pome(null); for (let i = 0; i < 17; i++) deep = pome(deep);
  for (const command of [sky({ bad: true }), ['/fixture/SkyComputerUseClient', 'turn-ended', '--previous-notify', '{'], deep,
    [...sky(pome(null)), '--previous-notify', '[]'], [...pome(null), '--pome-forward=W10'],
    pome(null).map(value => value.startsWith('--pome-forward=') ? '--pome-forward=broken' : value)]) {
    write(command); const before = fs.readFileSync(file, 'utf8');
    const status = await service.status('codex'); assert.equal(status.state, 'error'); assert.equal(status.repairable, false);
    await assert.rejects(service.preview('codex', 'repair'));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.includes('.pome-backup')), false);
  }
});

test('connect and disconnect preserve a non-Pome notifier containing literal Pome arguments', async t => {
  const { file, service, write } = fixture(t);
  const original = ['custom-notifier', '--pome-panel-hook=codex', '--pome-forward=' + Buffer.from('["other"]').toString('base64url')];
  write(original);
  assert.equal((await service.status('codex')).state, 'disconnected');
  const connect = await service.preview('codex'); await service.apply(connect.token);
  assert.deepEqual(originalNotify(readConfig(file, 'codex').value.notify), original);
  const disconnect = await service.preview('codex', 'disconnect'); await service.apply(disconnect.token);
  assert.deepEqual(readConfig(file, 'codex').value.notify, original);
});

test('connection test rejects a notify command replaced during its async status check', async t => {
  const { home, file, service, write } = fixture(t);
  write(['original']); const plan = await service.preview('codex'); await service.apply(plan.token);
  const executed = path.join(home, 'must-not-execute');
  const changed = createAiSourceHooks({ env: {}, homeDir: home, runtimeCheck: () => {
    write([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(executed)},'unexpected')`]);
    return true;
  } });
  await assert.rejects(changed.runTest('codex', { token: 'race-test' }));
  assert.equal(fs.existsSync(executed), false);
});

for (const transport of ['stub', 'http']) test(`repaired chain delivers once and preserves exact forwarding (${transport})`, { skip: process.platform === 'win32' }, async t => {
  const { home, file, service, write } = fixture(t), seen = [];
  let server;
  const receipt = path.join(home, 'receipt.jsonl'), preload = path.join(home, 'transport-stub.cjs');
  if (transport === 'http') {
    server = http.createServer((req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { seen.push(JSON.parse(body)); res.end('{}'); }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => server.close());
  } else {
    // Exercise real child scripts without opening a socket. The separate HTTP
    // case verifies transport when loopback listeners are available.
    fs.writeFileSync(preload, `const {EventEmitter}=require('node:events');require('node:http').request=(options,callback)=>{const request=new EventEmitter();request.setTimeout=()=>request;request.end=body=>{require('node:fs').appendFileSync(${JSON.stringify(receipt)},body.toString()+'\\n');const response=new EventEmitter();response.resume=()=>{};callback(response);};return request;};`);
  }
  const helper = path.join(home, 'SkyComputerUseClient'), calls = path.join(home, 'calls.jsonl'), originalScript = path.join(home, 'original.js');
  fs.writeFileSync(helper, `#!${process.execPath}\nconst fs=require('node:fs'),{spawn}=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({helper:true,raw:args.at(-1)})+'\\n');process.on('exit',()=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({helperDone:true})+'\\n'));const index=args.indexOf('--previous-notify');if(index>=0){const command=JSON.parse(args[index+1]);if(command?.length){const child=spawn(command[0],[...command.slice(1),args.at(-1)],{stdio:'ignore'});child.on('error',()=>process.exit(1));}}\n`, { mode: 0o700 });
  fs.writeFileSync(originalScript, `require('node:fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify({original:true,args:process.argv.slice(2)})+'\\n');`);
  const original = [process.execPath, originalScript, 'literal $(not-a-shell)'];
  // Real old Pome commands are deliberately buried: an incomplete repair would POST twice.
  write(sky(original, helper)); let plan = await service.preview('codex'); await service.apply(plan.token);
  write(sky(readConfig(file, 'codex').value.notify, helper));
  plan = await service.preview('codex', 'repair'); await service.apply(plan.token);
  const command = readConfig(file, 'codex').value.notify;
  const raw = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'chain-session', 'turn-id': 'chain-turn', 'last-assistant-message': '通知修复验证' });
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], [...command.slice(1), raw], { env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'),
      POME_NOTIFY_PORT: String(server?.address().port || 43821),
      ...(transport === 'stub' ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}` } : {}) }, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`hook exited ${code}`)));
  });
  let rows = [];
  for (let i = 0; i < 200; i++) {
    if (transport === 'stub' && fs.existsSync(receipt)) seen.splice(0, seen.length, ...fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse));
    if (fs.existsSync(calls)) rows = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
    if (seen.length && rows.some(row => row.original) && rows.some(row => row.helperDone)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(seen.length, 1); assert.equal(seen[0]['turn-id'], 'chain-turn');
  assert.equal(rows.filter(row => row.helper).length, 1); assert.equal(rows[0].raw, raw);
  assert(rows.some(row => row.helperDone), 'wait for forwarded scripts to finish before counting delivery');
  assert.deepEqual(rows.find(row => row.original)?.args, ['literal $(not-a-shell)', raw]);
});
