'use strict';

/**
 * FPK / local process entry: Unix gateway socket + optional device TCP.
 * Strips FNOS_GATEWAY_PREFIX so routes keep matching /api/v1/*.
 * Serves static UI under GATEWAY_PREFIX for iframe entry.
 * NEVER embed frp endpoints, tokens, or credentials.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./createApp');
const { createMemoryStore } = require('./store');
const { listenConfiguredDevicePort } = require('./devicePort');
const { wrapWithGatewayPrefix, stripGatewayPrefix } = require('./gatewayHttp');

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
  const gatewayPrefix = process.env.FNOS_GATEWAY_PREFIX || '/app/pome-panel';
  const socketPath = process.env.FNOS_SOCKET_PATH || path.join(process.cwd(), 'runtime', 'pomepanel-sync.sock');
  const serverIdFile = process.env.FNOS_SERVER_ID_FILE || '';
  const devicePortEnv = process.env.FNOS_DEVICE_PORT;
  const dataDir = process.env.FNOS_DATA_DIR || process.env.TRIM_PKGVAR || path.join(process.cwd(), 'data');
  const configuredPortFile = process.env.FNOS_DEVICE_PORT_FILE;
  const etcPortFile = process.env.TRIM_PKGETC ? path.join(process.env.TRIM_PKGETC, 'device-port') : '';
  const devicePortFile = (configuredPortFile && String(configuredPortFile).trim())
    || (etcPortFile && fs.existsSync(etcPortFile) ? etcPortFile : '')
    || path.join(dataDir, 'device-port');
  const enableDevicePort = process.env.FNOS_ENABLE_DEVICE_PORT !== '0';
  const wwwRoot = path.join(__dirname, '..', 'www');
  const uiRoot = path.join(__dirname, '..', 'ui');
  const staticRoot = process.env.FNOS_STATIC_ROOT
    || (fs.existsSync(wwwRoot) ? wwwRoot : uiRoot);
  const resolvedStatic = fs.existsSync(staticRoot) ? staticRoot : uiRoot;

  const store = createMemoryStore({ serverId: readOrCreateServerId(serverIdFile) });
  store.devicePortFile = devicePortFile;
  store.devicePortEnabled = enableDevicePort;

  const gatewayBase = createApp({ listenMode: 'gateway', store });
  const gateway = wrapWithGatewayPrefix(gatewayBase, {
    gatewayPrefix,
    staticRoot: resolvedStatic,
  });
  await gateway.listenUnix(socketPath);
  console.log(JSON.stringify({
    event: 'gateway_listen',
    socketPath,
    gatewayPrefix,
    serverId: store.serverId,
  }));

  if (enableDevicePort) {
    const device = createApp({ listenMode: 'device-port', store });
    const info = await listenConfiguredDevicePort(device, {
      envValue: devicePortEnv,
      wizardValue: process.env.wizard_port,
      portFile: devicePortFile,
      host: '127.0.0.1',
    });
    store.deviceListenPort = info.port;
    store.deviceListenHost = info.host;
    console.log(JSON.stringify({
      event: 'device_port_listen',
      host: info.host,
      port: info.port,
      reused: info.reused,
      fellBack: info.fellBack,
      source: info.source,
      portFile: devicePortFile,
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

module.exports = { main, readOrCreateServerId, stripGatewayPrefix };
