'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { createApp } = require('../fnos/app/server/createApp');
const { createMemoryStore } = require('../fnos/app/server/store');
const { dispatch } = require('../fnos/app/server/testHarness');
const {
  chooseDevicePort,
  listenPersistedDevicePort,
  parseRequestedDevicePort,
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
  assert.notEqual(chooseDevicePort({}).port, 5001);
  assert.equal(chooseDevicePort({}).port, 0);
});

test('saved device port is reused when it is free', async () => {
  const dir = tmpDir('fnos-port-reuse-');
  const portFile = path.join(dir, 'device-port');
  const firstApp = createApp({ listenMode: 'device-port' });
  const first = await listenPersistedDevicePort(firstApp, { portFile });
  assert.equal(first.source, 'ephemeral');
  assert.equal(first.reused, false);
  assert.equal(first.fellBack, false);
  assert.ok(first.port > 0);
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

test('busy saved port falls back to ephemeral and rewrites the file', async () => {
  const dir = tmpDir('fnos-port-busy-');
  const portFile = path.join(dir, 'device-port');
  const blocker = http.createServer();
  const addr = await listen(blocker);
  fs.writeFileSync(portFile, `${addr.port}\n`);

  const app = createApp({ listenMode: 'device-port' });
  const info = await listenPersistedDevicePort(app, { portFile });
  assert.equal(info.fellBack, true);
  assert.equal(info.reused, false);
  assert.equal(info.source, 'ephemeral');
  assert.equal(info.preferredPort, addr.port);
  assert.notEqual(info.port, addr.port);
  assert.equal(Number(fs.readFileSync(portFile, 'utf8')), info.port);
  await app.close();
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

test('invalid port file falls back to ephemeral and is rewritten', async () => {
  const dir = tmpDir('fnos-port-bad-');
  const portFile = path.join(dir, 'device-port');
  fs.writeFileSync(portFile, 'not-a-port\n');
  const app = createApp({ listenMode: 'device-port' });
  const info = await listenPersistedDevicePort(app, { envValue: '0', portFile });
  assert.equal(info.source, 'ephemeral');
  assert.equal(info.fellBack, false);
  assert.ok(info.port > 0);
  assert.notEqual(info.port, 5001);
  assert.equal(Number(fs.readFileSync(portFile, 'utf8')), info.port);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gateway health exposes the current device port', async () => {
  const missing = createApp({ listenMode: 'gateway', serverId: 'srv-no-port' });
  const empty = await dispatch(missing, { method: 'GET', url: '/api/v1/health' });
  assert.equal(empty.getJson().devicePort, null);
  assert.equal(empty.getJson().deviceHost, null);

  const store = createMemoryStore({ serverId: 'srv-port' });
  store.deviceListenPort = 34931;
  store.deviceListenHost = '127.0.0.1';
  const app = createApp({ listenMode: 'gateway', store });
  const res = await dispatch(app, { method: 'GET', url: '/api/v1/health' });
  const body = res.getJson();
  assert.equal(body.devicePort, 34931);
  assert.equal(body.deviceHost, '127.0.0.1');
  assert.equal(body.deviceToken, undefined);
});

test('devices tab shows the current local port for FRP', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'fnos/app/ui/index.html'), 'utf8');
  assert.match(html, /id="device-port-value"/);
  assert.match(html, /data-control-id="fnos\.devices\.port"/);
  assert.match(html, /本机设备同步端口/);
  assert.match(html, /公网 FRP/);

  const shown = pairUi.formatDevicePortCopy(34931, '127.0.0.1');
  assert.equal(shown.value, '127.0.0.1:34931');
  assert.match(shown.hint, /FRP/);
  assert.match(shown.hint, /公网 FRP/);
  assert.equal(pairUi.formatDevicePortCopy(null).value, '尚未读到');
  assert.equal(pairUi.formatDevicePortCopy(80, '0.0.0.0').value, '127.0.0.1:80');

  const valueEl = { textContent: '' };
  const hintEl = { textContent: '' };
  const doc = {
    getElementById(id) {
      if (id === 'device-port-value') return valueEl;
      if (id === 'device-port-hint') return hintEl;
      return null;
    },
    querySelector() {
      return { getAttribute: () => '/app/pome-panel' };
    },
  };
  const controller = pairUi.createPairUiController({
    document: doc,
    window: { location: { pathname: '/app/pome-panel/' } },
    fetch: async (url) => {
      assert.match(String(url), /\/app\/pome-panel\/api\/v1\/health$/);
      return new Response(JSON.stringify({
        ok: true,
        devicePort: 34931,
        deviceHost: '127.0.0.1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const loaded = await controller.loadDevicePort();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.port, 34931);
  assert.equal(valueEl.textContent, '127.0.0.1:34931');
  assert.match(hintEl.textContent, /改映射/);
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
  assert.match(index, /listenPersistedDevicePort/);
  assert.equal(/\bFNOS_DEVICE_PORT\s*=\s*5001\b|\blisten\(\s*5001\b/.test(start), false);
  assert.equal(/\blisten\(\s*5001\b/.test(fs.readFileSync(path.join(root, 'fnos/app/server/createApp.js'), 'utf8')), false);

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
  assert.match(probe, /^PORT=unset$/m);
  assert.match(probe, new RegExp(`FILE=${data}/device-port`));
  assert.equal(fs.readFileSync(path.join(data, 'device-port'), 'utf8').trim(), '41234');
  fs.rmSync(dir, { recursive: true, force: true });
});
