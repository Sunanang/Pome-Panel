'use strict';

/**
 * FPK process entry: Unix gateway socket + optional device TCP port (ephemeral by default).
 * Ports are never hardcoded (no 5001).
 */
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./createApp');
const { createMemoryStore } = require('./store');

function readOrCreateServerId(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const id = fs.readFileSync(filePath, 'utf8').trim();
      if (id) return id;
    }
  } catch {
    /* ignore */
  }
  const { randomUUID } = require('node:crypto');
  const id = randomUUID();
  if (filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, id, { encoding: 'utf8', mode: 0o600 });
  }
  return id;
}

async function main() {
  const socketPath = process.env.FNOS_SOCKET_PATH || path.join(process.cwd(), 'runtime', 'pomepanel-sync.sock');
  const serverIdFile = process.env.FNOS_SERVER_ID_FILE || '';
  const devicePortEnv = process.env.FNOS_DEVICE_PORT;
  const devicePortFile = process.env.FNOS_DEVICE_PORT_FILE || '';
  const enableDevicePort = process.env.FNOS_ENABLE_DEVICE_PORT !== '0';

  const store = createMemoryStore({ serverId: readOrCreateServerId(serverIdFile) });

  // Gateway listener (Unix) — trusts X-Trim-* after gateway hygiene.
  const gateway = createApp({ listenMode: 'gateway', store });
  await gateway.listenUnix(socketPath);
  console.log(JSON.stringify({ event: 'gateway_listen', socketPath, serverId: store.serverId }));

  if (enableDevicePort) {
    // Separate process would be ideal; for skeleton we start a second app instance
    // sharing the same in-memory store reference (same process).
    const device = createApp({ listenMode: 'device-port', store });
    const port = devicePortEnv === undefined || devicePortEnv === '' ? 0 : Number(devicePortEnv);
    const info = await device.listenDevicePort(Number.isFinite(port) ? port : 0, '127.0.0.1');
    if (devicePortFile) {
      fs.mkdirSync(path.dirname(devicePortFile), { recursive: true });
      fs.writeFileSync(devicePortFile, String(info.port), { encoding: 'utf8', mode: 0o600 });
    }
    console.log(JSON.stringify({
      event: 'device_port_listen',
      host: info.host,
      port: info.port,
      note: 'port not hardcoded; clients must use full URL; never trust X-Trim-*',
    }));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, readOrCreateServerId };
