'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { pbkdf2Sync, createDecipheriv } = require('node:crypto');

const PREFIX = 'cursor-safe-storage:v1:';
const isCursorEncryptedToken = value => String(value || '').startsWith('cursor-safe-storage:');
const failure = (code = 'cursor_token_decrypt_failed') => Object.assign(new Error(code), { code });

function decodeBase64(value) {
  if (!value || value.length > 131072 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw failure();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw failure();
  return bytes;
}

// Read only Cursor's existing key. Never create/replace a key or use Pome's
// safeStorage identity: macOS assigns each app a different Keychain password.
function readMacPassword() {
  // Cursor uses its own account label (currently "Cursor Key"). The service
  // name is stable; Chromium's default "Cursor" account is not portable here.
  return execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Cursor Safe Storage', '-w'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'ignore'],
  }).replace(/\r?\n$/, '');
}

function unprotectWindows(bytes) {
  // Secrets travel through private pipes, never shell arguments or temp files.
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; " +
    '$b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); ' +
    '$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
    '[Console]::Out.Write([Convert]::ToBase64String($p))';
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: bytes.toString('base64'), encoding: 'utf8', timeout: 10000, maxBuffer: 131072,
    windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  }).trim();
  return decodeBase64(result);
}

function createCursorTokenDecoder({ platform = process.platform, readPassword = readMacPassword,
  unprotect = unprotectWindows, readFile = fs.readFileSync } = {}) {
  let macKey = null, accessDenied = false;
  return function decode(value, { dbPath, force = false } = {}) {
    if (!isCursorEncryptedToken(value)) return value;
    if (!value.startsWith(PREFIX)) throw failure('cursor_token_encrypted_unsupported');
    if (force) { macKey = null; accessDenied = false; }
    const bytes = decodeBase64(value.slice(PREFIX.length));
    try {
      let plain;
      if (platform === 'darwin') {
        if (bytes.subarray(0, 3).toString() !== 'v10' || bytes.length < 19 || (bytes.length - 3) % 16) throw failure();
        if (!macKey) {
          // A denied prompt must not repeat on every background refresh. An
          // explicit Get local login retries it. Positive keys stay in memory.
          if (accessDenied && !force) throw failure();
          try {
            const password = readPassword();
            if (!password) throw failure();
            macKey = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
            accessDenied = false;
          } catch { accessDenied = true; throw failure(); }
        }
        // Chromium OSCrypt macOS v10: PBKDF2-SHA1 + AES-128-CBC, space IV.
        const decipher = createDecipheriv('aes-128-cbc', macKey, Buffer.alloc(16, 0x20));
        plain = Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()]);
      } else if (platform === 'win32') {
        if (bytes.subarray(0, 3).toString() === 'v10') {
          // Windows OSCrypt v10 uses Cursor's profile key, protected by DPAPI.
          if (!dbPath || bytes.length < 32) throw failure();
          const state = JSON.parse(readFile(path.resolve(path.dirname(dbPath), '..', '..', 'Local State'), 'utf8'));
          const protectedKey = decodeBase64(state?.os_crypt?.encrypted_key);
          if (protectedKey.subarray(0, 5).toString() !== 'DPAPI') throw failure();
          const key = unprotect(protectedKey.subarray(5));
          if (key.length !== 32) throw failure();
          const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(3, 15));
          decipher.setAuthTag(bytes.subarray(-16));
          plain = Buffer.concat([decipher.update(bytes.subarray(15, -16)), decipher.final()]);
        } else {
          plain = unprotect(bytes);
        }
      } else {
        throw failure('cursor_token_encrypted_unsupported');
      }
      const token = new TextDecoder('utf-8', { fatal: true }).decode(plain);
      if (!token || /\s|[\x00-\x1f\x7f]/.test(token) || isCursorEncryptedToken(token)) throw failure();
      return token;
    } catch (error) {
      // Child-process errors can contain stdout, hence credentials. Expose only
      // a stable code; never forward native errors, passwords or cipher text.
      throw failure(error.code === 'cursor_token_encrypted_unsupported' ? error.code : undefined);
    }
  };
}

module.exports = { PREFIX, isCursorEncryptedToken, createCursorTokenDecoder,
  decodeCursorToken: createCursorTokenDecoder() };

// Keychain may wait for a human response. Never block Electron's main thread
// (including microphone IPC) while that system prompt is open.
function readMacPasswordAsync() {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', 'Cursor Safe Storage', '-w'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 16384,
    }, (error, stdout) => error ? reject(failure()) : resolve(stdout.replace(/\r?\n$/, '')));
  });
}

function createAsyncCursorTokenDecoder({ platform = process.platform, readPassword = readMacPasswordAsync, ...options } = {}) {
  const fallback = createCursorTokenDecoder({ platform, ...options });
  let decoder = null, pending = null, denied = false;
  return async function decode(value, context = {}) {
    if (!isCursorEncryptedToken(value) || platform !== 'darwin' || !value.startsWith(PREFIX)) return fallback(value, context);
    // Explicit Get local login retries a denial; background quota polling does not.
    if (context.force && !pending) { decoder = null; denied = false; }
    if (!decoder) {
      if (denied) throw failure();
      if (!pending) {
        pending = (async () => {
          try {
            let password = await readPassword();
            if (!password) throw failure();
            const candidate = createCursorTokenDecoder({ platform, readPassword: () => password });
            // Validate and derive the key before keeping the decoder in memory.
            candidate(value, { ...context, force: false });
            password = null;
            decoder = candidate;
          } catch { denied = true; throw failure(); }
          finally { pending = null; }
        })();
      }
      await pending;
    }
    return decoder(value, { ...context, force: false });
  };
}
module.exports.createAsyncCursorTokenDecoder = createAsyncCursorTokenDecoder;
module.exports.decodeCursorTokenAsync = createAsyncCursorTokenDecoder();
