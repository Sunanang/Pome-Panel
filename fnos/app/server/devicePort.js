'use strict';

/**
 * Persist the device sync TCP port so FRP can keep mapping the same local port
 * across process restarts. NEVER hardcode 5001 — 0 means "ask the OS".
 * Bind host defaults to loopback; optional LAN bind uses 0.0.0.0.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_PORT = 65535;
const LOOPBACK_HOST = '127.0.0.1';
const LAN_BIND_HOST = '0.0.0.0';

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
 * Explicit env (non-zero) wins. Otherwise reuse the saved file. Otherwise ephemeral.
 * @returns {{ port: number, source: 'env'|'file'|'ephemeral' }}
 */
function chooseDevicePort({ envValue, portFile } = {}) {
  const explicit = parseRequestedDevicePort(envValue);
  if (explicit != null) return { port: explicit, source: 'env' };
  const saved = readSavedDevicePort(portFile);
  if (saved != null) return { port: saved, source: 'file' };
  return { port: 0, source: 'ephemeral' };
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

/**
 * Resolve the TCP bind host. Loopback is the safe default; LAN opts into 0.0.0.0.
 * Accepts wizard values (localhost|lan), booleans, and literal addresses.
 */
function resolveDeviceBindHost(value) {
  if (value === undefined || value === null) return LOOPBACK_HOST;
  const text = String(value).trim().toLowerCase();
  if (text === '' || text === 'localhost' || text === 'loopback'
    || text === '127.0.0.1' || text === '::1' || text === '0' || text === 'false' || text === 'no') {
    return LOOPBACK_HOST;
  }
  if (text === 'lan' || text === 'all' || text === '0.0.0.0' || text === '::'
    || text === '1' || text === 'true' || text === 'yes') {
    return LAN_BIND_HOST;
  }
  return LOOPBACK_HOST;
}

function isLanBindHost(host) {
  return resolveDeviceBindHost(host) === LAN_BIND_HOST;
}

function readSavedDeviceBindHost(filePath) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    return resolveDeviceBindHost(raw);
  } catch {
    return null;
  }
}

/**
 * Env wins when set (including empty → loopback). Otherwise reuse the saved file.
 * Missing file keeps loopback so upgrades stay local-only until the user opts in.
 */
function chooseDeviceBindHost({ envValue, bindFile } = {}) {
  if (envValue !== undefined && envValue !== null && String(envValue).trim() !== '') {
    return { host: resolveDeviceBindHost(envValue), source: 'env' };
  }
  const saved = readSavedDeviceBindHost(bindFile);
  if (saved != null) return { host: saved, source: 'file' };
  return { host: LOOPBACK_HOST, source: 'default' };
}

function writeDeviceBindFile(filePath, host) {
  if (!filePath) return;
  const bindHost = resolveDeviceBindHost(host);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${bindHost}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* mode is best-effort on platforms that ignore chmod */
  }
}

/** Display / FRP loopback helper. 0.0.0.0 stays as-is for LAN reporting. */
function normalizeDeviceHost(host) {
  if (!host) return LOOPBACK_HOST;
  if (host === '::') return LAN_BIND_HOST;
  return String(host);
}

function frpLocalTarget(port, bindHost) {
  const n = parseRequestedDevicePort(port);
  if (n == null) return null;
  // FRP always targets the NAS loopback, even when the app also binds LAN.
  void bindHost;
  return `${LOOPBACK_HOST}:${n}`;
}

/**
 * What the Devices tab should show. Live bind wins. A saved file is used only
 * while the device port is enabled but the socket is not recorded yet.
 * Disabled listeners never advertise a stale file port.
 */
function describeDeviceListenPort(store) {
  if (store && store.devicePortEnabled === false) {
    return {
      enabled: false,
      port: null,
      host: null,
      target: null,
      frpTarget: null,
      lanEnabled: false,
      source: 'disabled',
    };
  }
  const live = parseRequestedDevicePort(store && store.deviceListenPort);
  if (live != null) {
    const host = normalizeDeviceHost(store.deviceListenHost);
    const lanEnabled = isLanBindHost(host);
    return {
      enabled: true,
      port: live,
      host,
      target: `${host}:${live}`,
      frpTarget: frpLocalTarget(live, host),
      lanEnabled,
      source: 'listen',
    };
  }
  const saved = readSavedDevicePort(store && store.devicePortFile);
  if (saved != null) {
    const bindChosen = chooseDeviceBindHost({
      envValue: store && store.deviceBindEnv,
      bindFile: store && store.deviceBindFile,
    });
    const host = bindChosen.host;
    const lanEnabled = isLanBindHost(host);
    return {
      enabled: true,
      port: saved,
      host,
      target: `${host}:${saved}`,
      frpTarget: frpLocalTarget(saved, host),
      lanEnabled,
      source: 'file',
    };
  }
  return {
    enabled: false,
    port: null,
    host: null,
    target: null,
    frpTarget: null,
    lanEnabled: false,
    source: 'unavailable',
  };
}

function isAddressInUse(err) {
  return Boolean(err) && (err.code === 'EADDRINUSE'
    || /EADDRINUSE|address already in use/i.test(String(err.message || '')));
}

/**
 * Bind the preferred port. If that port is busy, bind an ephemeral port and
 * rewrite the file so the next start follows the port that is actually open.
 */
async function listenPersistedDevicePort(app, {
  envValue,
  portFile,
  host = LOOPBACK_HOST,
  bindFile,
} = {}) {
  const bindHost = resolveDeviceBindHost(host);
  if (bindFile) writeDeviceBindFile(bindFile, bindHost);
  const chosen = chooseDevicePort({ envValue, portFile });
  const preferred = chosen.port;
  try {
    const info = await app.listenDevicePort(preferred, bindHost);
    writeDevicePortFile(portFile, info.port);
    return {
      host: info.host,
      port: info.port,
      reused: preferred !== 0 && info.port === preferred,
      source: chosen.source,
      fellBack: false,
      preferredPort: preferred === 0 ? null : preferred,
      lanEnabled: isLanBindHost(info.host),
      frpTarget: frpLocalTarget(info.port, info.host),
    };
  } catch (err) {
    if (preferred === 0 || !isAddressInUse(err)) throw err;
    const info = await app.listenDevicePort(0, bindHost);
    writeDevicePortFile(portFile, info.port);
    return {
      host: info.host,
      port: info.port,
      reused: false,
      source: 'ephemeral',
      fellBack: true,
      preferredPort: preferred,
      reason: err.code || 'EADDRINUSE',
      lanEnabled: isLanBindHost(info.host),
      frpTarget: frpLocalTarget(info.port, info.host),
    };
  }
}

module.exports = {
  LOOPBACK_HOST,
  LAN_BIND_HOST,
  parseRequestedDevicePort,
  readSavedDevicePort,
  chooseDevicePort,
  writeDevicePortFile,
  resolveDeviceBindHost,
  isLanBindHost,
  readSavedDeviceBindHost,
  chooseDeviceBindHost,
  writeDeviceBindFile,
  listenPersistedDevicePort,
  describeDeviceListenPort,
  normalizeDeviceHost,
  frpLocalTarget,
};
