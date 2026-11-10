'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCipheriv, pbkdf2Sync } = require('node:crypto');
const path = require('node:path');
const { PREFIX, createCursorTokenDecoder } = require('../platform-adapters/cursor-secrets');
const { createAsyncCursorTokenDecoder } = require('../platform-adapters/cursor-secrets');

const password = 'fixture-keychain-password';
function macEnvelope(token, secret = password) {
  const cipher = createCipheriv('aes-128-cbc', pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1'), Buffer.alloc(16, 32));
  return PREFIX + Buffer.concat([Buffer.from('v10'), cipher.update(token), cipher.final()]).toString('base64');
}

test('a waiting Keychain prompt leaves the event loop responsive and shares one native read', async () => {
  let finish, reads = 0, responsive = false;
  const decode = createAsyncCursorTokenDecoder({ platform: 'darwin', readPassword: () => {
    reads++; return new Promise(resolve => { finish = resolve; });
  } });
  const first = decode(macEnvelope('fixture-one')), second = decode(macEnvelope('fixture-two'));
  await new Promise(resolve => setImmediate(() => { responsive = true; resolve(); }));
  assert.equal(responsive, true); assert.equal(reads, 1);
  finish(password);
  assert.deepEqual(await Promise.all([first, second]), ['fixture-one', 'fixture-two']);
  assert.equal(await decode(macEnvelope('fixture-three')), 'fixture-three'); assert.equal(reads, 1);
});

test('asynchronous Keychain denial is sanitized, cached, and retried only on explicit local login', async () => {
  let reads = 0;
  const decode = createAsyncCursorTokenDecoder({ platform: 'darwin', readPassword: async () => {
    if (++reads === 1) throw Object.assign(Error('private secret'), { stdout: 'private secret' });
    return password;
  } });
  const value = macEnvelope('fixture-token');
  await assert.rejects(decode(value), e => e.message === 'cursor_token_decrypt_failed' && !('stdout' in e));
  await assert.rejects(decode(value), { code: 'cursor_token_decrypt_failed' }); assert.equal(reads, 1);
  assert.equal(await decode(value, { force: true }), 'fixture-token'); assert.equal(reads, 2);
});

test('legacy plaintext requires no OS secrets and macOS Cursor v10 decodes with the Cursor key', () => {
  let reads = 0;
  const decode = createCursorTokenDecoder({ platform: 'darwin', readPassword: () => { reads++; return password; } });
  assert.equal(decode('fixture-old-cursor'), 'fixture-old-cursor'); assert.equal(reads, 0);
  assert.equal(decode(macEnvelope('fixture-current-cursor')), 'fixture-current-cursor');
  assert.equal(decode(macEnvelope('fixture-new-cursor')), 'fixture-new-cursor'); assert.equal(reads, 1);
});

test('denied Keychain access fails closed without repeated prompts; explicit acquisition retries', () => {
  let reads = 0, allowed = false;
  const decode = createCursorTokenDecoder({ platform: 'darwin', readPassword: () => {
    reads++; if (!allowed) throw new Error('private native stdout must not escape'); return password;
  } });
  const value = macEnvelope('fixture-login');
  for (let i = 0; i < 3; i++) assert.throws(() => decode(value), error => error.message === 'cursor_token_decrypt_failed');
  assert.equal(reads, 1);
  allowed = true; assert.equal(decode(value, { force: true }), 'fixture-login'); assert.equal(reads, 2);
});

test('ciphertext corruption, unknown versions and unsupported hosts never become bearer tokens', () => {
  const decode = createCursorTokenDecoder({ platform: 'darwin', readPassword: () => password });
  for (const value of [PREFIX, PREFIX + '!!!!', PREFIX + 'djEw', PREFIX + 'djEw===', macEnvelope('fixture', 'wrong-key'), macEnvelope('token\nwith-header-injection')]) {
    assert.throws(() => decode(value), { code: 'cursor_token_decrypt_failed' });
  }
  assert.throws(() => decode('cursor-safe-storage:v2:opaque'), { code: 'cursor_token_encrypted_unsupported' });
  assert.throws(() => createCursorTokenDecoder({ platform: 'linux' })(macEnvelope('fixture')), { code: 'cursor_token_encrypted_unsupported' });
});

test('Windows uses Cursor Local State and current-user DPAPI to unlock its AES-GCM key', () => {
  const key = Buffer.alloc(32, 5), nonce = Buffer.alloc(12, 7), protectedKey = Buffer.from('fixture-dpapi-key');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const bytes = Buffer.concat([Buffer.from('v10'), nonce, cipher.update('fixture-windows-token'), cipher.final(), cipher.getAuthTag()]);
  const dbPath = path.resolve('fixture-Cursor/User/globalStorage/state.vscdb');
  let reads = 0, unprotects = 0;
  const decode = createCursorTokenDecoder({ platform: 'win32', readFile: (file, encoding) => {
    reads++; assert.equal(file, path.resolve('fixture-Cursor/Local State')); assert.equal(encoding, 'utf8');
    return JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), protectedKey]).toString('base64') } });
  }, unprotect: value => { unprotects++; assert.deepEqual(value, protectedKey); return key; } });
  assert.equal(decode(PREFIX + bytes.toString('base64'), { dbPath }), 'fixture-windows-token');
  assert.equal(reads, 1); assert.equal(unprotects, 1);
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decode(PREFIX + bytes.toString('base64'), { dbPath }), { code: 'cursor_token_decrypt_failed' });
});

test('Windows legacy DPAPI and failed native subprocesses do not expose secret output', () => {
  const bytes = Buffer.from('fixture-legacy-dpapi');
  const value = PREFIX + bytes.toString('base64');
  const decode = createCursorTokenDecoder({ platform: 'win32', unprotect: data => {
    assert.deepEqual(data, bytes); return Buffer.from('fixture-token');
  } });
  assert.equal(decode(value), 'fixture-token');
  const blocked = createCursorTokenDecoder({ platform: 'win32', unprotect: () => {
    throw Object.assign(new Error('private-token'), { stdout: 'private-token' });
  } });
  assert.throws(() => blocked(value), error => error.message === 'cursor_token_decrypt_failed' && !('stdout' in error));
});
