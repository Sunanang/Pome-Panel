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
  const { classifyTransportError, shouldFailover } = require('../packages/sync-protocol/endpoints');
  const classified = classifyTransportError('DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.equal(classified.kind, 'certificate_error');
  assert.equal(classified.transferable, false);
  assert.equal(shouldFailover('DEPTH_ZERO_SELF_SIGNED_CERT'), false);
});

test('main.js withEndpointFailover stops on certificate_error without next hop', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(main, /certificate_error/);
  assert.match(main, /withEndpointFailover/);
  assert.match(main, /shouldFailover/);
  // Must record certificate UI state and return early
  assert.match(main, /lastUiState:\s*'certificate_error'/);
});
