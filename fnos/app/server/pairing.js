'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  DEVICE_TOKEN_BYTES,
  isValidPairingCodeFormat,
  computeTokenExpiresAt,
  maybeSlideTokenExpiry,
  isTokenExpired,
} = require(path.join(__dirname, '..', '..', '..', 'packages', 'sync-protocol'));

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function generatePairingCode() {
  // Cryptographically uniform 6-digit code (000000–999999).
  const n = crypto.randomInt(0, 10 ** PAIRING_CODE_LENGTH);
  return String(n).padStart(PAIRING_CODE_LENGTH, '0');
}

function generateDeviceTokenRaw() {
  return crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

function publicDeviceRow(row) {
  if (!row) return null;
  return {
    deviceId: row.deviceId,
    name: row.name || '',
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    insecureBound: Boolean(row.insecureBound),
    revokedAt: row.revokedAt || null,
  };
}

module.exports = {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  hashSecret,
  generatePairingCode,
  generateDeviceTokenRaw,
  isValidPairingCodeFormat,
  computeTokenExpiresAt,
  maybeSlideTokenExpiry,
  isTokenExpired,
  publicDeviceRow,
};
