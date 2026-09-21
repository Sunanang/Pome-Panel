'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  deriveSyncUiState,
  syncUiStateLabel,
  SYNC_UI_STATES,
} = require('../packages/sync-protocol/endpoints');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');

test('A.1 status-bar covers all P0 UI states', () => {
  const expected = [
    'unbound',
    'migrating',
    'syncing',
    'synced',
    'offline_pending',
    'needs_reauth',
    'schema_incompatible',
    'migration_failed',
    'certificate_error',
    'endpoint_disabled',
  ];
  assert.deepEqual([...SYNC_UI_STATES].sort(), [...expected].sort());
  for (const state of expected) {
    assert.equal(typeof syncUiStateLabel(state), 'string');
    assert.ok(syncUiStateLabel(state).length > 0);
  }
  assert.equal(deriveSyncUiState({ bound: true, certificateError: true }), 'certificate_error');
  assert.equal(deriveSyncUiState({ bound: true, endpointDisabled: true }), 'endpoint_disabled');
  assert.equal(deriveSyncUiState({ needsReauth: true }), 'needs_reauth');
  assert.equal(deriveSyncUiState({ migrationFailed: true }), 'migration_failed');
  assert.equal(deriveSyncUiState({ schemaIncompatible: true }), 'schema_incompatible');
  assert.equal(deriveSyncUiState({ migrating: true, bound: true }), 'migrating');
});

test('retry button uses workspace-button; status colors via CSS vars (S1/S3)', () => {
  assert.match(html, /data-control-id="settings\.nas-sync\.retry"/);
  assert.match(html, /id="settings-nas-sync-retry"/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-sync-retry"|id="settings-nas-sync-retry"[^>]*class="[^"]*workspace-button/);
  assert.match(css, /#settings-nas-sync-status\[data-state="error"\][^{]*\{[^}]*var\(--p0\)/);
  assert.match(css, /#settings-nas-sync-status\[data-state="warning"\][^{]*\{[^}]*var\(--accent-orange\)/);
  assert.match(workspaceJs, /certificate_error/);
  assert.match(workspaceJs, /endpoint_disabled/);
});
