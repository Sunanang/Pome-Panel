'use strict';

/**
 * Bind the device sync port the user chose at install (wizard_port).
 * NEVER hardcode 5001, and do not fall back to an ephemeral port.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_PORT = 65535;

function parseRequestedDevicePort(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === '' || text === '0') return null;
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) return null;
  return port;
}

function readSavedDevicePort(filePath) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseRequestedDevicePort(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * User-chosen port only. Env wins, then the install wizard value, then the saved file.
 * Missing config returns null — callers must not listen on 0.
 * @returns {{ port: number, source: 'env'|'wizard'|'file' } | null}
 */
function resolveConfiguredDevicePort({ envValue, wizardValue, portFile } = {}) {
  const explicit = parseRequestedDevicePort(envValue);
  if (explicit != null) return { port: explicit, source: 'env' };
  const wizard = parseRequestedDevicePort(wizardValue);
  if (wizard != null) return { port: wizard, source: 'wizard' };
  const saved = readSavedDevicePort(portFile);
  if (saved != null) return { port: saved, source: 'file' };
  return null;
}

function chooseDevicePort(options = {}) {
  return resolveConfiguredDevicePort(options) || { port: null, source: 'missing' };
}

function writeDevicePortFile(filePath, port) {
  if (!filePath) return;
  const n = parseRequestedDevicePort(port);
  if (n == null) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${n}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* mode is best-effort on platforms that ignore chmod */
  }
}

function normalizeDeviceHost(host) {
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return String(host);
}

/**
 * What the Devices tab should show. Live bind wins. A saved file is used only
 * while the device port is enabled but the socket is not recorded yet.
 * Disabled listeners never advertise a stale file port.
 */
function describeDeviceListenPort(store) {
  if (store && store.devicePortEnabled === false) {
    return { enabled: false, port: null, host: null, target: null, source: 'disabled' };
  }
  const live = parseRequestedDevicePort(store && store.deviceListenPort);
  if (live != null) {
    const host = normalizeDeviceHost(store.deviceListenHost);
    return { enabled: true, port: live, host, target: `${host}:${live}`, source: 'listen' };
  }
  const saved = readSavedDevicePort(store && store.devicePortFile);
  if (saved != null) {
    const host = '127.0.0.1';
    return { enabled: true, port: saved, host, target: `${host}:${saved}`, source: 'file' };
  }
  return { enabled: false, port: null, host: null, target: null, source: 'unavailable' };
}

function isAddressInUse(err) {
  return Boolean(err) && (err.code === 'EADDRINUSE'
    || /EADDRINUSE|address already in use/i.test(String(err.message || '')));
}

/**
 * Bind exactly the configured port. A busy port fails and the saved file is left unchanged.
 */
async function listenConfiguredDevicePort(app, { envValue, wizardValue, portFile, host = '127.0.0.1' } = {}) {
  const chosen = resolveConfiguredDevicePort({ envValue, wizardValue, portFile });
  if (!chosen) {
    const err = new Error('未配置设备同步端口。请在安装向导或应用设置中填写端口。');
    err.code = 'device_port_required';
    throw err;
  }
  try {
    const info = await app.listenDevicePort(chosen.port, host);
    if (info.port !== chosen.port) {
      const err = new Error('device_port_mismatch');
      err.code = 'device_port_mismatch';
      throw err;
    }
    writeDevicePortFile(portFile, info.port);
    return {
      host: info.host,
      port: info.port,
      reused: true,
      source: chosen.source,
      fellBack: false,
      preferredPort: chosen.port,
    };
  } catch (err) {
    if (err && err.code === 'device_port_mismatch') throw err;
    if (!isAddressInUse(err)) throw err;
    const busy = new Error(`设备同步端口 ${chosen.port} 已被占用。请在应用设置中更换端口，或停掉占用它的程序后再启动。`);
    busy.code = 'device_port_in_use';
    busy.port = chosen.port;
    throw busy;
  }
}

async function listenPersistedDevicePort(app, options) {
  return listenConfiguredDevicePort(app, options);
}

module.exports = {
  parseRequestedDevicePort,
  readSavedDevicePort,
  chooseDevicePort,
  resolveConfiguredDevicePort,
  writeDevicePortFile,
  listenConfiguredDevicePort,
  listenPersistedDevicePort,
  describeDeviceListenPort,
  normalizeDeviceHost,
};
