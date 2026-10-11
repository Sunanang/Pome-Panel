'use strict';

// Credential fields: https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs
// Imported credentials are read only when the user clicks “获取本机 Token”.
// Quota detection continues to use codex-usage.js and never reads this file.
const fs = require('node:fs/promises');
const path = require('node:path');
const { codexHomes } = require('./codex-usage');
const MAX_AUTH_BYTES = 1024 * 1024;

function tokenFromAuth(auth) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return '';
  // Do not export refresh tokens, ID tokens or account metadata.
  const value = auth.tokens?.access_token;
  return typeof value === 'string' ? value.trim() : '';
}

async function readLocalCodexToken({ homes = codexHomes() } = {}) {
  let failure = 'codex_auth_missing';
  for (const home of homes) {
    let handle;
    try {
      handle = await fs.open(path.join(home, 'auth.json'), 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) {
        failure = 'codex_auth_read_failed';
        continue;
      }
      const buffer = Buffer.alloc(MAX_AUTH_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_AUTH_BYTES) { failure = 'codex_auth_read_failed'; continue; }
      const auth = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''));
      const token = tokenFromAuth(auth);
      if (token) return { ok: true, token };
      if (failure !== 'codex_auth_read_failed') failure = 'codex_token_missing';
    } catch (error) {
      if (error.code !== 'ENOENT') failure = 'codex_auth_read_failed';
    } finally {
      try { await handle?.close(); } catch {}
    }
  }
  // Only a stable error code crosses IPC; paths, raw file text and exception details stay private.
  return { ok: false, error: failure };
}

module.exports = { tokenFromAuth, readLocalCodexToken };
