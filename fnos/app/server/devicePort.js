'use strict';

/**
 * Persist the device sync TCP port so FRP can keep mapping the same local port
 * across process restarts. NEVER hardcode 5001 — 0 means "ask the OS".
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

function isAddressInUse(err) {
  return Boolean(err) && (err.code === 'EADDRINUSE'
    || /EADDRINUSE|address already in use/i.test(String(err.message || '')));
}

/**
 * Bind the preferred port. If that port is busy, bind an ephemeral port and
 * rewrite the file so the next start follows the port that is actually open.
 */
async function listenPersistedDevicePort(app, { envValue, portFile, host = '127.0.0.1' } = {}) {
  const chosen = chooseDevicePort({ envValue, portFile });
  const preferred = chosen.port;
  try {
    const info = await app.listenDevicePort(preferred, host);
    writeDevicePortFile(portFile, info.port);
    return {
      host: info.host,
      port: info.port,
      reused: preferred !== 0 && info.port === preferred,
      source: chosen.source,
      fellBack: false,
      preferredPort: preferred === 0 ? null : preferred,
    };
  } catch (err) {
    if (preferred === 0 || !isAddressInUse(err)) throw err;
    const info = await app.listenDevicePort(0, host);
    writeDevicePortFile(portFile, info.port);
    return {
      host: info.host,
      port: info.port,
      reused: false,
      source: 'ephemeral',
      fellBack: true,
      preferredPort: preferred,
      reason: err.code || 'EADDRINUSE',
    };
  }
}

module.exports = {
  parseRequestedDevicePort,
  readSavedDevicePort,
  chooseDevicePort,
  writeDevicePortFile,
  listenPersistedDevicePort,
};
