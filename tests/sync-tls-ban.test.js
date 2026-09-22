'use strict';

/**
 * §8.3 static ban: never ignore TLS / certificate errors for sync.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const SCAN_FILES = [
  'main.js',
  'main-services.js',
  'sync-settings.js',
  'todos-sync.js',
  'sync-migration.js',
  'preload.js',
  'packages/sync-protocol/endpoints.js',
  'renderer/nas-sync-settings.js',
  'renderer/workspace.js',
];

const FORBIDDEN = [
  /ignore-certificate-errors/i,
  /rejectUnauthorized\s*:\s*false/,
  /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
  /certificate-error[\s\S]{0,200}callback\s*\(\s*true\s*\)/,
  /certificate-error[\s\S]{0,200}preventDefault\s*\(/,
];

test('§8.3 static ban: no TLS bypass switches in sync-related sources', () => {
  for (const rel of SCAN_FILES) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `missing ${rel}`);
    const source = fs.readFileSync(full, 'utf8');
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(source, pattern, `${rel} must not match ${pattern}`);
    }
  }
});

test('certificate errors classified as non-transferable in endpoints module', () => {
  const { classifyTransportError, shouldFailover, shouldRequestCertificateTrust } = require('../packages/sync-protocol/endpoints');
  const classified = classifyTransportError('DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.equal(classified.kind, 'certificate_error');
  assert.equal(classified.transferable, false);
  assert.equal(classified.needsTrustConfirm, true);
  assert.equal(shouldFailover('DEPTH_ZERO_SELF_SIGNED_CERT'), false);
  assert.equal(shouldRequestCertificateTrust('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), true);
  assert.equal(shouldRequestCertificateTrust('unable to verify the first certificate'), true);
});

test('HTTPS to plaintext HTTP is not a certificate trust error', () => {
  const {
    HTTPS_ON_HTTP_MESSAGE,
    classifyTransportError,
    describeTransportFailure,
    shouldFailover,
    shouldRequestCertificateTrust,
  } = require('../packages/sync-protocol/endpoints');
  const nodeMessage = 'write EPROTO C0DC4C59DD7F0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../deps/openssl/openssl/ssl/record/ssl3_record.c:354:';
  const cases = [
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'error:0A00010B:SSL routines:ssl3_get_record:wrong version number',
    nodeMessage,
    { code: 'EPROTO', message: nodeMessage },
    { code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'ssl3_get_record:wrong version number' },
  ];
  for (const sample of cases) {
    const classified = classifyTransportError(sample);
    assert.equal(classified.kind, 'https_on_http', `kind for ${JSON.stringify(sample).slice(0, 80)}`);
    assert.equal(classified.needsTrustConfirm, false);
    assert.equal(classified.certificateError, false);
    assert.equal(classified.transferable, false);
    assert.equal(classified.userMessage, HTTPS_ON_HTTP_MESSAGE);
    const described = describeTransportFailure(sample);
    assert.equal(described.error, 'https_on_http');
    assert.equal(described.message, HTTPS_ON_HTTP_MESSAGE);
    assert.equal(described.certificateError, false);
    assert.equal(described.needsTrustConfirm, false);
    assert.equal(described.uiState, null);
    assert.equal(shouldRequestCertificateTrust(sample), false);
    assert.equal(shouldFailover(sample), false);
  }
  const mislabeled = {
    ok: false,
    error: 'certificate_error',
    code: 'ERR_SSL_WRONG_VERSION_NUMBER',
    message: nodeMessage,
    certificateError: true,
    needsTrustConfirm: true,
    uiState: 'certificate_error',
  };
  assert.equal(shouldRequestCertificateTrust(mislabeled), false);
  assert.equal(describeTransportFailure(mislabeled).error, 'https_on_http');
  assert.equal(describeTransportFailure('DEPTH_ZERO_SELF_SIGNED_CERT').needsTrustConfirm, true);
});

test('main.js withEndpointFailover stops on certificate_error without next hop', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(main, /certificate_error/);
  assert.match(main, /withEndpointFailover/);
  assert.match(main, /shouldFailover/);
  // Must record certificate UI state and return early
  assert.match(main, /lastUiState:\s*'certificate_error'/);
  assert.match(main, /describeTransportFailure/);
});
