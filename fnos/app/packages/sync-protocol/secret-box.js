'use strict';

const crypto = require('node:crypto');

const SECRET_BOX_VERSION = 1;
const SECRET_BOX_ALG = 'A256GCM';

function decodeKey(keyBase64) {
  const key = Buffer.from(String(keyBase64 || ''), 'base64');
  if (key.length !== 32) {
    const error = new Error('account_key_invalid');
    error.reason = 'account_key_invalid';
    throw error;
  }
  return key;
}

/**
 * AES-256-GCM JSON box. Ciphertext only — callers must not log `value`.
 * @param {unknown} value
 * @param {string} keyBase64 32-byte key, standard base64
 */
function encryptJson(value, keyBase64, options = {}) {
  const key = decodeKey(keyBase64);
  const plaintextJson = JSON.stringify(value);
  const iv = options.ivContext
    ? crypto.createHash('sha256').update(String(options.ivContext)).update('\0').update(plaintextJson).digest().subarray(0, 12)
    : crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(plaintextJson, 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sealed: true,
    v: SECRET_BOX_VERSION,
    alg: SECRET_BOX_ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

function isSealedPayload(payload) {
  return Boolean(
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && payload.sealed === true
    && payload.v === SECRET_BOX_VERSION
    && payload.alg === SECRET_BOX_ALG
    && typeof payload.iv === 'string'
    && typeof payload.tag === 'string'
    && typeof payload.ct === 'string'
  );
}

function decryptJson(payload, keyBase64) {
  if (!isSealedPayload(payload)) {
    const error = new Error('sealed_payload_required');
    error.reason = 'sealed_payload_required';
    throw error;
  }
  const key = decodeKey(keyBase64);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.ct, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = {
  SECRET_BOX_VERSION,
  SECRET_BOX_ALG,
  encryptJson,
  decryptJson,
  isSealedPayload,
};
