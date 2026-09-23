'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const { createApp } = require('../fnos/app/server/createApp');
const { createMemoryStore } = require('../fnos/app/server/store');
const { dispatch } = require('../fnos/app/server/testHarness');
const {
  chooseDevicePort,
  describeDeviceListenPort,
  listenPersistedDevicePort,
  parseRequestedDevicePort,
  planDeviceListen,
} = require('../fnos/app/server/devicePort');
const pairUi = require('../fnos/app/ui/pair.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test('parseRequestedDevicePort treats empty and 0 as ephemeral', () => {
  assert.equal(parseRequestedDevicePort(undefined), null);
  assert.equal(parseRequestedDevicePort(''), null);
  assert.equal(parseRequestedDevicePort('0'), null);
  assert.equal(parseRequestedDevicePort(' 0 '), null);
  assert.equal(parseRequestedDevicePort('nope'), null);
  assert.equal(parseRequestedDevicePort('65536'), null);
  assert.equal(parseRequestedDevicePort('-1'), null);
  assert.equal(parseRequestedDevicePort('41234'), 41234);
  assert.equal(chooseDevicePort({}).port, null);
  assert.equal(chooseDevicePort({}).source, 'missing');
  assert.notEqual(chooseDevicePort({}).port, 5001);
});

test('saved device port is reused when it is free', async () => {
  const dir = tmpDir('fnos-port-reuse-');
  const portFile = path.join(dir, 'device-port');
  const holder = http.createServer();
  const reserved = await listen(holder);
  await close(holder);
  const firstApp = createApp({ listenMode: 'device-port' });
  const first = await listenPersistedDevicePort(firstApp, {
    envValue: String(reserved.port),
    portFile,
  });
  assert.equal(first.source, 'env');
  assert.equal(first.port, reserved.port);
  assert.equal(first.fellBack, false);
  assert.notEqual(first.port, 5001);
  assert.equal(Number(fs.readFileSync(portFile, 'utf8')), first.port);
  await firstApp.close();

  const secondApp = createApp({ listenMode: 'device-port' });
  const second = await listenPersistedDevicePort(secondApp, { portFile });
  assert.equal(second.port, first.port);
  assert.equal(second.reused, true);
  assert.equal(second.fellBack, false);
  assert.equal(second.source, 'file');
  assert.equal(Number(fs.readFileSync(portFile, 'utf8')), first.port);
  await secondApp.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('busy saved port is rejected and the file stays unchanged', async () => {
  const dir = tmpDir('fnos-port-busy-');
  const portFile = path.join(dir, 'device-port');
  const blocker = http.createServer();
  const addr = await listen(blocker);
  fs.writeFileSync(portFile, `${addr.port}\n`);

  const app = createApp({ listenMode: 'device-port' });
  await assert.rejects(
    () => listenPersistedDevicePort(app, { portFile }),
    (err) => err.code === 'device_port_in_use' && err.port === addr.port,
  );
  assert.equal(Number(fs.readFileSync(portFile, 'utf8')), addr.port);
  await close(blocker);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('explicit env port wins over the saved file; 0 and empty reuse the file', async () => {
  const dir = tmpDir('fnos-port-env-');
  const portFile = path.join(dir, 'device-port');
  const savedHolder = http.createServer();
  const envHolder = http.createServer();
  const savedAddr = await listen(savedHolder);
  const envAddr = await listen(envHolder);
  assert.notEqual(savedAddr.port, envAddr.port);
  await close(savedHolder);
  await close(envHolder);
  fs.writeFileSync(portFile, `${savedAddr.port}\n`);

  assert.equal(chooseDevicePort({ envValue: '0', portFile }).port, savedAddr.port);
  assert.equal(chooseDevicePort({ envValue: '', portFile }).source, 'file');
  assert.equal(chooseDevicePort({ envValue: undefined, portFile }).source, 'file');
  const app = createApp({ listenMode: 'device-port' });
  const info = await listenPersistedDevicePort(app, {
    envValue: String(envAddr.port),
    portFile,
  });
  assert.equal(info.port, envAddr.port);
  assert.equal(info.source, 'env');
  assert.equal(info.reused, true);
  assert.equal(info.fellBack, false);
  assert.notEqual(info.port, savedAddr.port);
  assert.equal(Number(fs.readFileSync(portFile, 'utf8')), envAddr.port);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('missing or invalid port does not bind an ephemeral port', async () => {
  const dir = tmpDir('fnos-port-bad-');
  const portFile = path.join(dir, 'device-port');
  fs.writeFileSync(portFile, 'not-a-port\n');
  const app = createApp({ listenMode: 'device-port' });
  await assert.rejects(
    () => listenPersistedDevicePort(app, { envValue: '0', wizardValue: '', portFile }),
    (err) => err.code === 'device_port_required',
  );
  assert.equal(fs.readFileSync(portFile, 'utf8'), 'not-a-port\n');
  const empty = createApp({ listenMode: 'device-port' });
  await assert.rejects(
    () => listenPersistedDevicePort(empty, { portFile: path.join(dir, 'missing-port') }),
    (err) => err.code === 'device_port_required',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GET /api/v1/device-port reports the live bind, then the saved file', async () => {
  const dir = tmpDir('fnos-port-api-');
  const portFile = path.join(dir, 'device-port');
  fs.writeFileSync(portFile, '41234\n');

  const disabled = createMemoryStore({ serverId: 'srv-off' });
  disabled.devicePortEnabled = false;
  disabled.devicePortFile = portFile;
  assert.equal(describeDeviceListenPort(disabled).source, 'disabled');
  assert.equal(describeDeviceListenPort(disabled).port, null);

  const unset = createMemoryStore({ serverId: 'srv-unset' });
  unset.devicePortEnabled = false;
  unset.devicePortUnconfigured = true;
  unset.devicePortFile = portFile;
  assert.equal(describeDeviceListenPort(unset).source, 'unconfigured');
  assert.equal(describeDeviceListenPort(unset).port, null);

  const fromFile = createMemoryStore({ serverId: 'srv-file' });
  fromFile.devicePortEnabled = true;
  fromFile.devicePortFile = portFile;
  assert.equal(describeDeviceListenPort(fromFile).source, 'file');
  assert.equal(describeDeviceListenPort(fromFile).target, '127.0.0.1:41234');

  const store = createMemoryStore({ serverId: 'srv-port' });
  store.devicePortEnabled = true;
  store.devicePortFile = portFile;
  store.deviceListenPort = 34931;
  store.deviceListenHost = '127.0.0.1';
  const app = createApp({ listenMode: 'gateway', store });
  const res = await dispatch(app, { method: 'GET', url: '/api/v1/device-port' });
  const body = res.getJson();
  assert.equal(res.statusCode, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.port, 34931);
  assert.equal(body.host, '127.0.0.1');
  assert.equal(body.target, '127.0.0.1:34931');
  assert.equal(body.source, 'listen');
  assert.equal(body.deviceToken, undefined);
  assert.notEqual(body.port, 5001);

  const health = await dispatch(app, { method: 'GET', url: '/api/v1/health' });
  assert.equal(health.getJson().devicePort, 34931);

  const offApp = createApp({ listenMode: 'gateway', store: disabled });
  const off = await dispatch(offApp, { method: 'GET', url: '/api/v1/device-port' });
  assert.equal(off.getJson().enabled, false);
  assert.equal(off.getJson().port, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('install wizard and package identity use a user-chosen port', () => {
  const root = path.join(__dirname, '..', 'fnos');
  const manifestJson = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifestJson.name, 'Pome Panel');
  assert.equal(manifestJson.author, 'Lando');
  assert.equal(manifestJson.maintainer, 'Lando');
  assert.equal(manifestJson.version, '0.9.4');
  assert.equal(manifestJson.distributor, 'Lando');
  assert.equal(manifestJson.id, 'com.pomepanel.sync');
  assert.equal(manifestJson.appPath, '/app/pome-panel');
  assert.equal(manifestJson.devicePort.field, 'wizard_port');
  assert.doesNotMatch(JSON.stringify(manifestJson), /Sunanang|Pome Panel Sync/);

  const official = fs.readFileSync(path.join(root, 'manifest'), 'utf8');
  assert.match(official, /^display_name=Pome Panel$/m);
  assert.match(official, /^maintainer=Lando$/m);
  assert.match(official, /^distributor=Lando$/m);
  assert.match(official, /^version=0\.9\.4$/m);
  assert.match(official, /^install_dep_apps=nodejs_v22$/m);
  assert.match(official, /^desktop_uidir=ui$/m);
  assert.match(official, /^desktop_applaunchname=com\.pomepanel\.sync\.main$/m);
  assert.ok(fs.existsSync(path.join(root, 'app/ui/config')));
  assert.match(official, /^appname=com\.pomepanel\.sync$/m);
  assert.match(official, /^checkport=false$/m);
  assert.doesNotMatch(official, /service_port\s*=\s*5001|Sunanang|Pome Panel Sync/);
  const changelog = official.split('\n').find((line) => line.startsWith('changelog='));
  assert.ok(changelog && changelog.includes('data-share'));
  assert.equal(changelog.includes('#'), false);

  const portPattern = /^(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;
  for (const sample of ['1', '5', '80', '45875', '65535']) assert.match(sample, portPattern);
  for (const sample of ['0', '65536', '01234', '99999']) assert.doesNotMatch(sample, portPattern);
  for (const rel of ['wizard/install', 'wizard/config', 'wizard/upgrade']) {
    const steps = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    const field = steps.flatMap((step) => step.items).find((item) => item.field === 'wizard_port');
    assert.ok(field, rel);
    assert.equal(field.type, 'text');
    assert.equal(field.initValue, undefined);
    const serialized = JSON.stringify(field);
    assert.equal(serialized.includes('5001'), false);
    assert.equal(serialized.includes('"max":5'), false);
    const range = field.rules.find((rule) => Object.prototype.hasOwnProperty.call(rule, 'max'));
    assert.equal(range.min, 1);
    assert.equal(range.max, 65535);
    assert.equal(field.rules.some((rule) => rule.pattern === portPattern.source), true);
  }
  const configSteps = JSON.parse(fs.readFileSync(path.join(root, 'wizard/config'), 'utf8'));
  const configTips = configSteps.flatMap((step) => step.items).find((item) => item.type === 'tips');
  assert.match(configTips.helpText, /没填端口时应用也能启用/);
  assert.match(configTips.helpText, /重启/);
  const uiConfig = JSON.parse(fs.readFileSync(path.join(root, 'app/ui/config'), 'utf8'));
  assert.equal(uiConfig['.url']['com.pomepanel.sync.main'].title, 'Pome Panel');
  assert.equal(uiConfig['.url']['com.pomepanel.sync.main'].gatewayPrefix, '/app/pome-panel');
  const wizardHtml = fs.readFileSync(path.join(root, 'wizard/index.html'), 'utf8');
  assert.match(wizardHtml, /Pome Panel/);
  assert.doesNotMatch(wizardHtml, /Pome Panel Sync|Sunanang/);
});

test('devices tab shows the current local port for FRP', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'fnos/app/ui/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'fnos/app/ui/styles.css'), 'utf8');
  assert.match(html, /id="device-port-value"/);
  assert.match(html, /class="tile settings-card device-port-card"/);
  assert.match(html, /本机同步端口/);
  assert.match(html, /127\.0\.0\.1:此端口/);
  assert.match(html, /http:\/\/公网IP:公网端口/);
  assert.match(html, /不要填成 NAS:34931/);
  assert.match(css, /\.devices-page > \.device-port-card/);
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/gi, ''), /\/api\/v1\//);

  const shown = pairUi.formatDevicePortCopy(41234, '127.0.0.1', { enabled: true });
  assert.equal(shown.value, '41234');
  assert.equal(shown.copyText, '127.0.0.1:41234');
  assert.match(shown.hint, /安装时填写的固定端口/);
  assert.match(shown.hint, /FRP 本地目标填 127\.0\.0\.1:41234/);
  assert.match(shown.hint, /http:\/\/公网IP:公网端口/);
  assert.equal(pairUi.formatDevicePortCopy(null, null, { enabled: false }).value, '未开启');
  assert.match(pairUi.formatDevicePortCopy(null, null, { enabled: false }).hint, /安装向导/);
  assert.equal(pairUi.formatDevicePortCopy(null).value, '未配置');
  const unsetCopy = pairUi.formatDevicePortCopy(null, null, { enabled: false, source: 'unconfigured' });
  assert.equal(unsetCopy.value, '未配置');
  assert.match(unsetCopy.hint, /应用设置/);
  assert.match(unsetCopy.hint, /1 到 65535/);

  const valueEl = { textContent: '' };
  const hintEl = { textContent: '' };
  const copyEl = { hidden: true, textContent: '复制', copyText: '' };
  const doc = {
    getElementById(id) {
      if (id === 'device-port-value') return valueEl;
      if (id === 'device-port-hint') return hintEl;
      if (id === 'device-port-copy') return copyEl;
      return null;
    },
    querySelector() {
      return { getAttribute: () => '/app/pome-panel' };
    },
  };
  let copied = '';
  const controller = pairUi.createPairUiController({
    document: doc,
    window: {
      location: { pathname: '/app/pome-panel/' },
      navigator: { clipboard: { writeText: async (text) => { copied = text; } } },
    },
    fetch: async (url) => {
      assert.match(String(url), /\/app\/pome-panel\/api\/v1\/device-port$/);
      return new Response(JSON.stringify({
        ok: true,
        enabled: true,
        port: 41234,
        host: '127.0.0.1',
        target: '127.0.0.1:41234',
        source: 'listen',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const loaded = await controller.loadDevicePort();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.port, 41234);
  assert.equal(valueEl.textContent, '41234');
  assert.equal(copyEl.hidden, false);
  assert.match(hintEl.textContent, /127\.0\.0\.1:41234/);
  assert.match(hintEl.textContent, /不要填成 NAS:34931/);
  const copiedResult = await controller.copyDevicePort();
  assert.equal(copiedResult.ok, true);
  assert.equal(copied, '127.0.0.1:41234');

  const unsetValue = { textContent: '' };
  const unsetHint = { textContent: '' };
  const unsetCopyBtn = { hidden: true, textContent: '复制', copyText: '' };
  const unsetDoc = {
    getElementById(id) {
      if (id === 'device-port-value') return unsetValue;
      if (id === 'device-port-hint') return unsetHint;
      if (id === 'device-port-copy') return unsetCopyBtn;
      return null;
    },
    querySelector() {
      return { getAttribute: () => '/app/pome-panel' };
    },
  };
  const unsetController = pairUi.createPairUiController({
    document: unsetDoc,
    window: { location: { pathname: '/app/pome-panel/' } },
    fetch: async () => new Response(JSON.stringify({
      ok: true,
      enabled: false,
      port: null,
      host: null,
      target: null,
      source: 'unconfigured',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  const unsetLoaded = await unsetController.loadDevicePort();
  assert.equal(unsetLoaded.ok, false);
  assert.equal(unsetValue.textContent, '未配置');
  assert.match(unsetHint.textContent, /应用设置/);
  assert.equal(unsetCopyBtn.hidden, true);
});

test('start.sh does not force an ephemeral port over the saved file', async (t) => {
  if (process.platform === 'win32') {
    t.skip('FPK start.sh is a bash script');
    return;
  }
  const root = path.join(__dirname, '..');
  const start = fs.readFileSync(path.join(root, 'fnos/cmd/start.sh'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'fnos/app/server/index.js'), 'utf8');
  assert.match(start, /\$DATA_DIR\/device-port/);
  assert.doesNotMatch(start, /FNOS_DEVICE_PORT:-0/);
  assert.match(index, /listenConfiguredDevicePort/);
  assert.equal(/\bFNOS_DEVICE_PORT\s*=\s*5001\b|\blisten\(\s*5001\b/.test(start), false);
  assert.equal(/\blisten\(\s*5001\b/.test(fs.readFileSync(path.join(root, 'fnos/app/server/createApp.js'), 'utf8')), false);
  assert.match(start, /export PATH="\/var\/apps\/nodejs_v24\/target\/bin:\/var\/apps\/nodejs_v22\/target\/bin:/);
  assert.match(start, /请在飞牛应用中心安装并启用 Node\.js v22 或 v24/);
  const v24At = start.indexOf('/var/apps/nodejs_v24/target/bin/node');
  const v22At = start.indexOf('/var/apps/nodejs_v22/target/bin/node');
  assert.ok(v24At > 0 && v22At > v24At);

  const dir = tmpDir('fnos-start-');
  const runtime = path.join(dir, 'runtime');
  const data = path.join(dir, 'data');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'device-port.txt'), '41234\n');
  const fake = path.join(dir, 'fake-node.sh');
  fs.writeFileSync(fake, `#!/bin/sh
printf 'PORT=%s\\nFILE=%s\\n' "\${FNOS_DEVICE_PORT-unset}" "\${FNOS_DEVICE_PORT_FILE-unset}" > "\${FNOS_DATA_DIR}/probe.txt"
exit 0
`, { mode: 0o755 });

  await new Promise((resolve, reject) => {
    execFile('bash', [path.join(root, 'fnos/cmd/start.sh')], {
      env: {
        ...process.env,
        FNOS_RUNTIME_DIR: runtime,
        FNOS_DATA_DIR: data,
        FNOS_DEVICE_PORT: '0',
        wizard_port: '',
        NODE_BIN: fake,
      },
    }, (err, stdout, stderr) => (err ? reject(new Error(`${stderr || stdout || err.message}`)) : resolve(stdout)));
  });

  const probePath = path.join(data, 'probe.txt');
  const started = Date.now();
  while (!fs.existsSync(probePath)) {
    if (Date.now() - started > 3000) {
      const logPath = path.join(runtime, 'server.log');
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      throw new Error(`probe missing\n${log}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const probe = fs.readFileSync(probePath, 'utf8');
  assert.match(probe, /^PORT=41234$/m);
  assert.match(probe, new RegExp(`FILE=${data}/device-port`));
  assert.equal(fs.readFileSync(path.join(data, 'device-port'), 'utf8').trim(), '41234');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('planDeviceListen skips TCP until a real port is configured', () => {
  assert.deepEqual(
    planDeviceListen({ enableFlag: undefined, envValue: '', wizardValue: '', portFile: '/no/such-port' }),
    { listen: false, reason: 'unconfigured', chosen: null },
  );
  assert.equal(
    planDeviceListen({ enableFlag: '0', envValue: '0', portFile: '/no/such-port' }).reason,
    'unconfigured',
  );
  const ready = planDeviceListen({ enableFlag: '1', envValue: '45875', portFile: '/no/such-port' });
  assert.equal(ready.listen, true);
  assert.equal(ready.reason, 'configured');
  assert.equal(ready.chosen.port, 45875);
  assert.equal(ready.chosen.source, 'env');
  const held = planDeviceListen({ enableFlag: '0', envValue: '45875' });
  assert.equal(held.listen, false);
  assert.equal(held.reason, 'disabled');
  assert.equal(held.chosen.port, 45875);
});

test('start.sh launches the gateway when no port was configured', async (t) => {
  if (process.platform === 'win32') {
    t.skip('FPK start.sh is a bash script');
    return;
  }
  const dir = tmpDir('fnos-start-missing-');
  const runtime = path.join(dir, 'runtime');
  const data = path.join(dir, 'data');
  const logFile = path.join(dir, 'start.log');
  fs.mkdirSync(runtime, { recursive: true });
  const fake = path.join(dir, 'fake-node.sh');
  fs.writeFileSync(fake, `#!/bin/sh
printf 'ENABLE=%s\\nPORT=%s\\nPATH=%s\\n' "\${FNOS_ENABLE_DEVICE_PORT-unset}" "\${FNOS_DEVICE_PORT-unset}" "$PATH" > "\${FNOS_DATA_DIR}/probe.txt"
exit 0
`, { mode: 0o755 });
  const stdout = await new Promise((resolve, reject) => {
    execFile('bash', [path.join(__dirname, '..', 'fnos/cmd/start.sh')], {
      env: {
        ...process.env,
        FNOS_RUNTIME_DIR: runtime,
        FNOS_DATA_DIR: data,
        FNOS_DEVICE_PORT: '',
        wizard_port: '',
        WIZARD_PORT: '',
        Wizard_port: '',
        TRIM_WIZARD_PORT: '',
        NODE_BIN: fake,
        TRIM_TEMP_LOGFILE: logFile,
      },
    }, (err, out, stderr) => (err ? reject(new Error(`${stderr || out || err.message}`)) : resolve(`${out}\n${stderr}`)));
  });
  assert.match(stdout, /未配置设备同步端口/);
  assert.match(stdout, /devicePort=unset/);
  const probePath = path.join(data, 'probe.txt');
  const started = Date.now();
  while (!fs.existsSync(probePath)) {
    if (Date.now() - started > 3000) throw new Error(`probe missing\n${stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const probe = fs.readFileSync(probePath, 'utf8');
  assert.match(probe, /^ENABLE=0$/m);
  assert.match(probe, /^PORT=unset$/m);
  assert.match(probe, /^PATH=\/var\/apps\/nodejs_v24\/target\/bin:\/var\/apps\/nodejs_v22\/target\/bin:/m);
  assert.equal(fs.existsSync(path.join(runtime, 'server.pid')), true);
  assert.equal(fs.existsSync(path.join(data, 'device-port')), false);
  const logged = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  assert.equal(logged, '');
  assert.doesNotMatch(`${probe}\n${stdout}`, /5001/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('start.sh does not turn a configured port back on when TCP was explicitly disabled', async (t) => {
  if (process.platform === 'win32') {
    t.skip('FPK start.sh is a bash script');
    return;
  }
  const dir = tmpDir('fnos-start-disabled-');
  const runtime = path.join(dir, 'runtime');
  const data = path.join(dir, 'data');
  fs.mkdirSync(runtime, { recursive: true });
  const fake = path.join(dir, 'fake-node.sh');
  fs.writeFileSync(fake, `#!/bin/sh
printf 'ENABLE=%s\\nPORT=%s\\n' "\${FNOS_ENABLE_DEVICE_PORT-unset}" "\${FNOS_DEVICE_PORT-unset}" > "\${FNOS_DATA_DIR}/probe.txt"
exit 0
`, { mode: 0o755 });
  await new Promise((resolve, reject) => {
    execFile('bash', [path.join(__dirname, '..', 'fnos/cmd/start.sh')], {
      env: {
        ...process.env,
        FNOS_RUNTIME_DIR: runtime,
        FNOS_DATA_DIR: data,
        FNOS_DEVICE_PORT: '45875',
        FNOS_ENABLE_DEVICE_PORT: '0',
        NODE_BIN: fake,
      },
    }, (err, stdout, stderr) => (err ? reject(new Error(`${stderr || stdout || err.message}`)) : resolve(stdout)));
  });
  const probePath = path.join(data, 'probe.txt');
  const started = Date.now();
  while (!fs.existsSync(probePath)) {
    if (Date.now() - started > 3000) throw new Error('disable probe missing');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const probe = fs.readFileSync(probePath, 'utf8');
  assert.match(probe, /^ENABLE=0$/m);
  assert.match(probe, /^PORT=45875$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('server keeps the gateway up when no device port is configured', async () => {
  const dir = tmpDir('fnos-gateway-noport-');
  const socketPath = path.join(dir, 'app.sock');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'fnos/app/server/index.js')], {
    env: {
      ...process.env,
      FNOS_SOCKET_PATH: socketPath,
      FNOS_DATA_DIR: dir,
      FNOS_DEVICE_PORT: '',
      FNOS_DEVICE_PORT_FILE: path.join(dir, 'missing-port'),
      FNOS_ENABLE_DEVICE_PORT: '',
      wizard_port: '',
      WIZARD_PORT: '',
      Wizard_port: '',
      TRIM_WIZARD_PORT: '',
      TRIM_PKGETC: '',
      FNOS_SERVER_ID_FILE: path.join(dir, 'server-id'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  const started = Date.now();
  try {
    while (!out.includes('device_port_skipped') || !fs.existsSync(socketPath)) {
      if (child.exitCode != null) throw new Error(`exited ${child.exitCode}\n${out}`);
      if (Date.now() - started > 4000) throw new Error(`timeout\n${out}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(child.exitCode, null);
    assert.match(out, /gateway_listen/);
    assert.match(out, /unconfigured/);
    assert.doesNotMatch(out, /5001/);
    assert.equal(fs.existsSync(path.join(dir, 'device-port')), false);
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('server binds the saved device port once it is configured', async () => {
  const dir = tmpDir('fnos-gateway-port-');
  const holder = http.createServer();
  const addr = await listen(holder);
  await close(holder);
  const portFile = path.join(dir, 'device-port');
  fs.writeFileSync(portFile, `${addr.port}\n`);
  const socketPath = path.join(dir, 'app.sock');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'fnos/app/server/index.js')], {
    env: {
      ...process.env,
      FNOS_SOCKET_PATH: socketPath,
      FNOS_DATA_DIR: dir,
      FNOS_DEVICE_PORT: '',
      FNOS_DEVICE_PORT_FILE: portFile,
      FNOS_ENABLE_DEVICE_PORT: '1',
      wizard_port: '',
      WIZARD_PORT: '',
      Wizard_port: '',
      TRIM_WIZARD_PORT: '',
      TRIM_PKGETC: '',
      FNOS_SERVER_ID_FILE: path.join(dir, 'server-id'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  const started = Date.now();
  try {
    while (!out.includes('device_port_listen') || !fs.existsSync(socketPath)) {
      if (child.exitCode != null) throw new Error(`exited ${child.exitCode}\n${out}`);
      if (Date.now() - started > 4000) throw new Error(`timeout\n${out}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.match(out, new RegExp(`"port":${addr.port}`));
    assert.equal(child.exitCode, null);
    await new Promise((resolve, reject) => {
      const socket = net.connect(addr.port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', reject);
    });
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('start.sh accepts the uppercase wizard port alias', async (t) => {
  if (process.platform === 'win32') {
    t.skip('FPK start.sh is a bash script');
    return;
  }
  const root = path.join(__dirname, '..');
  const dir = tmpDir('fnos-start-alias-');
  const runtime = path.join(dir, 'runtime');
  const data = path.join(dir, 'data');
  const etc = path.join(dir, 'etc');
  fs.mkdirSync(runtime, { recursive: true });
  const fake = path.join(dir, 'fake-node.sh');
  fs.writeFileSync(fake, `#!/bin/sh
printf 'PORT=%s\\n' "\${FNOS_DEVICE_PORT-unset}" > "\${FNOS_DATA_DIR}/probe.txt"
exit 0
`, { mode: 0o755 });
  await new Promise((resolve, reject) => {
    execFile('bash', [path.join(root, 'fnos/cmd/start.sh')], {
      env: {
        ...process.env,
        FNOS_RUNTIME_DIR: runtime,
        FNOS_DATA_DIR: data,
        TRIM_PKGETC: etc,
        FNOS_DEVICE_PORT: '',
        wizard_port: '',
        WIZARD_PORT: '45875',
        NODE_BIN: fake,
      },
    }, (err, stdout, stderr) => (err ? reject(new Error(`${stderr || stdout || err.message}`)) : resolve(stdout)));
  });
  const probePath = path.join(data, 'probe.txt');
  const started = Date.now();
  while (!fs.existsSync(probePath)) {
    if (Date.now() - started > 3000) throw new Error('alias probe missing');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal(fs.readFileSync(probePath, 'utf8').trim(), 'PORT=45875');
  assert.equal(fs.readFileSync(path.join(etc, 'device-port'), 'utf8').trim(), '45875');
  assert.equal(fs.readFileSync(path.join(data, 'device-port'), 'utf8').trim(), '45875');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('install callback saves wizard_port and rejects an empty value', async (t) => {
  if (process.platform === 'win32') {
    t.skip('FPK callbacks are bash scripts');
    return;
  }
  const dir = tmpDir('fnos-callback-');
  const etc = path.join(dir, 'etc');
  const data = path.join(dir, 'data');
  const script = path.join(__dirname, '..', 'fnos/cmd/install_callback');
  await new Promise((resolve, reject) => {
    execFile('bash', [script], {
      env: {
        ...process.env,
        wizard_port: '41234',
        TRIM_PKGETC: etc,
        FNOS_DATA_DIR: data,
      },
    }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
  assert.equal(fs.readFileSync(path.join(etc, 'device-port'), 'utf8').trim(), '41234');
  assert.equal(fs.readFileSync(path.join(data, 'device-port'), 'utf8').trim(), '41234');
  const rejected = await new Promise((resolve) => {
    execFile('bash', [script], {
      env: { ...process.env, wizard_port: '', TRIM_PKGETC: etc, FNOS_DATA_DIR: data },
    }, (err) => resolve(err));
  });
  assert.ok(rejected);
  assert.match(`${rejected.stdout || ''}\n${rejected.stderr || ''}\n${rejected.message || ''}`, /请填写设备同步端口/);

  const varDir = path.join(dir, 'var');
  await new Promise((resolve, reject) => {
    execFile('bash', [path.join(__dirname, '..', 'fnos/cmd/upgrade_callback')], {
      env: {
        ...process.env,
        wizard_port: '',
        WIZARD_PORT: '45875',
        TRIM_PKGETC: etc,
        TRIM_PKGVAR: varDir,
        FNOS_DATA_DIR: '',
      },
    }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
  assert.equal(fs.readFileSync(path.join(etc, 'device-port'), 'utf8').trim(), '45875');
  assert.equal(fs.readFileSync(path.join(varDir, 'device-port'), 'utf8').trim(), '45875');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pairing stays off until the fnOS session is present', async () => {
  const startBtn = { disabled: false };
  const note = { textContent: '' };
  const pill = { dataset: {}, textContent: '' };
  const status = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  function docFor() {
    return {
      getElementById(id) {
        if (id === 'pair-start-btn') return startBtn;
        if (id === 'session-note') return note;
        if (id === 'session-pill') return pill;
        if (id === 'pair-status') return status;
        return null;
      },
      querySelector() { return { getAttribute: () => '/app/pome-panel' }; },
    };
  }
  const denied = pairUi.createPairUiController({
    document: docFor(),
    window: { location: { pathname: '/app/pome-panel/' } },
    fetch: async () => new Response(JSON.stringify({ error: 'gateway_session_required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const session = await denied.checkSession();
  assert.equal(session.ok, false);
  assert.equal(startBtn.disabled, true);
  assert.equal(pill.textContent, '未登录');
  assert.match(note.textContent, /飞牛/);
  assert.match(note.textContent, /配对已停用/);

  const allowed = pairUi.createPairUiController({
    document: docFor(),
    window: { location: { pathname: '/app/pome-panel/' } },
    fetch: async () => new Response(JSON.stringify({ uid: 'uid-lando', username: 'Lando' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const ok = await allowed.checkSession();
  assert.equal(ok.ok, true);
  assert.equal(startBtn.disabled, false);
  assert.equal(pill.textContent, '已登录 · Lando');
  assert.match(note.textContent, /无需在本应用再次登录/);
});
