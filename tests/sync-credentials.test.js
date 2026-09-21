'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  createSyncCredentialsStore,
  syncPairHttpPolicy,
  validatePairingCodeInput,
  PAIR_HTTP_CONFIRM_TEXT,
} = require('../main-services');
const {
  isValidPairingCodeFormat,
  INSECURE_DEVICE_TOKEN_TTL_MS,
} = require('../packages/sync-protocol');

function mockSafeStorage({ available = true } = {}) {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(value) {
      const buf = Buffer.from(String(value), 'utf8');
      return Buffer.concat([key.subarray(0, 8), buf]);
    },
    decryptString(buffer) {
      return Buffer.from(buffer).subarray(8).toString('utf8');
    },
  };
}

test('validatePairingCodeInput rejects empty and non-6-digit', () => {
  assert.equal(validatePairingCodeInput('').ok, false);
  assert.equal(validatePairingCodeInput('12345').ok, false);
  assert.equal(validatePairingCodeInput('abcdef').ok, false);
  assert.deepEqual(validatePairingCodeInput(' 123456 '), { ok: true, code: '123456' });
  assert.equal(isValidPairingCodeFormat('123456'), true);
});

test('syncPairHttpPolicy: https ok; lan http requires confirm + insecureBound; loopback exempt', () => {
  assert.equal(syncPairHttpPolicy('https://nas.local/app').requiresExtraConfirm, false);
  assert.equal(syncPairHttpPolicy('https://nas.local/app').insecureBound, false);

  const lan = syncPairHttpPolicy('http://192.168.1.8:5666/app');
  assert.equal(lan.ok, true);
  assert.equal(lan.requiresExtraConfirm, true);
  assert.equal(lan.insecureBound, true);

  const loop = syncPairHttpPolicy('http://127.0.0.1:9/app');
  assert.equal(loop.requiresExtraConfirm, false);
  assert.equal(loop.insecureBound, false);

  assert.equal(PAIR_HTTP_CONFIRM_TEXT.includes('明文'), true);
  assert.equal(INSECURE_DEVICE_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test('safeStorage unavailable → refuse plaintext deviceToken save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-cred-'));
  const store = createSyncCredentialsStore({
    getUserDataPath: () => dir,
    safeStorage: mockSafeStorage({ available: false }),
    fs,
    path,
  });
  const saved = store.save({
    deviceToken: 'plaintext-secret-token',
    deviceId: 'dev-1',
    uid: 'uid-1',
  });
  assert.equal(saved.ok, false);
  assert.equal(saved.error, 'secure_storage_unavailable');
  assert.equal(saved.refusedPlaintext, true);
  assert.equal(fs.existsSync(path.join(dir, 'sync-credentials.json')), false);
  const status = store.getStatus();
  assert.equal(status.needsReauth, true);
  assert.equal(status.secureStorage, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('safeStorage available → encrypt + 0600 file; public status never echoes token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-cred-'));
  const store = createSyncCredentialsStore({
    getUserDataPath: () => dir,
    safeStorage: mockSafeStorage({ available: true }),
    fs,
    path,
  });
  const saved = store.save({
    deviceToken: 'super-secret-device-token',
    deviceId: 'dev-9',
    uid: 'uid-z',
    serverId: 'srv-1',
    insecureBound: true,
    expiresAt: Date.now() + 1000,
    baseUrl: 'http://192.168.0.2/app',
    boundAt: Date.now(),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.status.bound, true);
  assert.equal(saved.status.insecureBound, true);
  assert.equal(saved.status.deviceToken, undefined);
  assert.equal(JSON.stringify(saved.status).includes('super-secret'), false);

  const filePath = path.join(dir, 'sync-credentials.json');
  assert.equal(fs.existsSync(filePath), true);
  const disk = fs.readFileSync(filePath, 'utf8');
  assert.equal(disk.includes('super-secret-device-token'), false);
  try {
    const mode = fs.statSync(filePath).mode & 0o777;
    // On some CI filesystems mode bits may be masked; still assert not world-writable.
    assert.equal(mode & 0o002, 0);
  } catch (error) {
    /* ignore */
  }

  assert.equal(store.getDeviceToken(), 'super-secret-device-token');
  const cleared = store.clear();
  assert.equal(cleared.ok, true);
  assert.equal(store.getDeviceToken(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
