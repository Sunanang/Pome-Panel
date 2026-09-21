'use strict';

/**
 * T8-G0 prep — probe script + checklist must exist; do NOT claim G0 passed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const probeScript = path.join(root, 'scripts', 'nas-sync-g0-probe.js');
const checklist = path.join(root, 'docs', 'nas-sync-g0-probe-checklist.md');

test('T8-G0 prep: probe script and checklist exist', () => {
  assert.equal(fs.existsSync(probeScript), true);
  assert.equal(fs.existsSync(checklist), true);
  const doc = fs.readFileSync(checklist, 'utf8');
  assert.match(doc, /auth-probe/);
  assert.match(doc, /成功口径/);
  assert.match(doc, /health=200/);
  assert.match(doc, /🔴/);
  assert.match(doc, /不可代替/);
  assert.match(doc, /G0 状态：🔴 未做/);
  // Must document the forbidden claim literally under 不可说 — not assert it as a pass banner.
  assert.match(doc, /不可说[\s\S]*G0 已通过/);
  assert.doesNotMatch(doc, /G0 状态：\s*✅|状态：✅\s*G0|G0_PASSED/);
});

test('T8-G0 prep: probe --help exits 0 and documents success ≠ health', () => {
  const result = spawnSync(process.execPath, [probeScript, '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /auth-probe|Success ≠ health/i);
  assert.match(result.stdout, /nas-sync-g0-probe-checklist/);
});

test('T8-G0 prep: probe redacts bearer tokens in archive path helper', () => {
  const source = fs.readFileSync(probeScript, 'utf8');
  assert.match(source, /REDACTED/);
  assert.match(source, /identity_isolation_and_authorization_arrival_not_health_alone/);
  assert.match(source, /NOT_CLAIMED/);
  assert.doesNotMatch(source, /G0_PASSED|claimG0Pass/);
});
