'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const settingsUi = require('../renderer/nas-sync-settings.js');

test('A.1 export/restore backup controls (S3)', () => {
  assert.match(html, /data-control-id="settings\.nas-sync\.export-backup"/);
  assert.match(html, /data-control-id="settings\.nas-sync\.restore-backup"/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-export-backup"|id="settings-nas-export-backup"[^>]*workspace-button/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-restore-backup"|id="settings-nas-restore-backup"[^>]*workspace-button/);
  assert.match(workspaceJs, /syncExportTodosBackup/);
  assert.match(workspaceJs, /buildRestoreConfirmDialog/);
  assert.match(workspaceJs, /syncRestoreMigrationBackup/);
});

test('restore requires secondary confirm dialog', () => {
  const dialog = settingsUi.buildRestoreConfirmDialog();
  assert.equal(dialog.role, 'dialog');
  assert.equal(dialog.controlId, 'settings.nas-sync.restore-backup');
  assert.match(dialog.body, /覆盖/);
});

test('export API mock success / cancel', async () => {
  const ok = await settingsUi.runExportBackup({
    api: { syncExportTodosBackup: async () => ({ ok: true, path: '/tmp/a.json' }) },
  });
  assert.equal(ok.ok, true);
  const cancelled = await settingsUi.runExportBackup({
    api: { syncExportTodosBackup: async () => ({ ok: false, error: 'cancelled' }) },
  });
  assert.equal(cancelled.error, 'cancelled');
});
