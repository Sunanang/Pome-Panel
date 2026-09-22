'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const migrationUi = require('../renderer/nas-sync-migration.js');

test('A.5 migration controls exist with workspace-button / dialog roles (S3/S4)', () => {
  assert.match(html, /id="settings-nas-sync-card"/);
  assert.match(html, /id="tab-todo"/);
  assert.match(html, /id="todo-migration-banner"/);
  assert.match(html, /data-control-id="migration.state-banner"/);
  assert.match(html, /data-control-id="migration.failed.retry"/);
  assert.match(html, /data-control-id="migration.failed.restore"/);
  assert.match(html, /id="settings-nas-dialog"[^>]*role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /nas-sync-migration\.js/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-migration-retry"/);
  assert.match(html, /class="[^"]*workspace-button[^"]*"[^>]*id="settings-nas-migration-restore"/);
  assert.match(html, /id="settings-nas-dialog-alt"/);
  const migrationJs = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'nas-sync-migration.js'),
    'utf8',
  );
  assert.match(migrationJs, /migration\.both-live\.confirm/);
  assert.match(migrationJs, /migration\.history-empty\.choice/);
  assert.match(workspaceJs, /migration\.both-live\.confirm/);
  assert.match(workspaceJs, /migration\.history-empty\.choice/);
  assert.match(workspaceJs, /migration\.failed\.restore/);
});

test('migration UI style uses CSS variables — no new palette / no inline color (S1/S2/S6)', () => {
  assert.match(css, /\.settings-nas-migration-banner/);
  assert.match(css, /\.settings-nas-migration-banner[^{]*\{[^}]*var\(--surface-/);
  assert.match(css, /\.settings-nas-migration-banner[^{]*\{[^}]*var\(--text-/);
  assert.match(css, /#tab-todo\.is-migration-readonly/);
  assert.doesNotMatch(css, /\.settings-nas-migration-banner[^{]*\{[^}]*\b(?:Inter|Roboto|Arial)\b/);
  const bannerMarkup = html.match(/todo-migration-banner[^>]*>/)?.[0] || '';
  assert.doesNotMatch(bannerMarkup, /style\s*=\s*"[^"]*(?:color|background)\s*:/i);
});

test('migration.state-banner: readonly during migrate; writable after done (§12)', () => {
  let state = migrationUi.initialMigrationUiState();
  state = migrationUi.reduceMigrationUi(state, { type: 'migrating' });
  assert.equal(migrationUi.isReadonly(state), true);
  assert.equal(state.bannerVisible, true);
  assert.equal(state.bannerText, '迁移中，稍候');
  state = migrationUi.reduceMigrationUi(state, { type: 'done', migrationId: 'm1' });
  assert.equal(migrationUi.isReadonly(state), false);
  assert.equal(state.bannerVisible, false);
});

test('migration.both-live.confirm: shows live/serverRev; cancel aborts; confirm/alt choose', () => {
  const decision = {
    decision: 'both_live_confirm',
    choiceKind: 'both_live',
    localLive: 2,
    nas: { live: 3, serverRev: 7, latestUpdatedAt: 1700000000000 },
  };
  const dialog = migrationUi.buildChoiceDialog(decision);
  assert.equal(dialog.controlId, 'migration.both-live.confirm');
  assert.equal(dialog.role, 'dialog');
  assert.match(dialog.body, /本地 live：2/);
  assert.match(dialog.body, /NAS live：3/);
  assert.match(dialog.body, /serverRev：7/);
  assert.equal(dialog.choiceConfirm, 'use_local');
  assert.equal(dialog.choiceAlt, 'use_nas');
  assert.equal(dialog.allowDismiss, true);

  let state = migrationUi.initialMigrationUiState();
  state = migrationUi.reduceMigrationUi(state, { type: 'await_choice', decision });
  assert.equal(state.dialog.id, 'migration-both-live');
  state = migrationUi.reduceMigrationUi(state, { type: 'close_dialog' });
  assert.equal(state.dialog, null);
});

test('migration.history-empty.choice: forced two-way restore_local / keep_nas_deletes', () => {
  const decision = {
    decision: 'history_empty_choice',
    choiceKind: 'history_empty',
    localLive: 1,
    nas: { live: 0, serverRev: 4, pristine: false, historyEmpty: true },
  };
  const dialog = migrationUi.buildChoiceDialog(decision);
  assert.equal(dialog.controlId, 'migration.history-empty.choice');
  assert.equal(dialog.choiceConfirm, 'restore_local');
  assert.equal(dialog.choiceCancel, 'keep_nas_deletes');
  assert.equal(dialog.allowDismiss, false);
});

test('migration.failed.retry / restore dialog paths', () => {
  let state = migrationUi.initialMigrationUiState();
  state = migrationUi.reduceMigrationUi(state, {
    type: 'failed',
    message: '迁移失败',
    migrationId: 'm9',
  });
  assert.equal(state.phase, 'failed');
  state = migrationUi.reduceMigrationUi(state, { type: 'open_restore_confirm' });
  assert.equal(state.dialog.controlId, 'migration.failed.restore');
  assert.equal(state.dialog.role, 'dialog');
  state = migrationUi.reduceMigrationUi(state, { type: 'close_dialog' });
  assert.equal(state.dialog, null);
});

test('runMigrationFlow: choice_required then success; no silent history-empty', async () => {
  const calls = [];
  const api = {
    syncClassifyMigration: async () => ({
      ok: true,
      decision: {
        decision: 'history_empty_choice',
        needsUserChoice: true,
        choiceKind: 'history_empty',
        localLive: 1,
        nas: { live: 0, serverRev: 2 },
      },
    }),
    syncRunMigration: async (payload) => {
      calls.push(payload);
      return { ok: true, migrationId: 'mx' };
    },
  };
  const blocked = await migrationUi.runMigrationFlow({ api, localTodosJson: '{}' });
  assert.equal(blocked.error, 'choice_required');
  assert.equal(calls.length, 0);

  const ok = await migrationUi.runMigrationFlow({
    api,
    localTodosJson: '{}',
    choice: 'restore_local',
  });
  assert.equal(ok.ok, true);
  assert.equal(calls[0].choice, 'restore_local');
});

test('workspace/app wire migration readonly gate and IPC (no electron require)', () => {
  assert.match(workspaceJs, /startNasMigration/);
  assert.match(workspaceJs, /笔记、剪贴板、录音、链接、密钥和待办两边都是空的，已进入同步。/);
  assert.doesNotMatch(workspaceJs, /仍只在本机/);
  assert.match(appJs, /getWorkspaceSnapshotForSync/);
  assert.match(workspaceJs, /syncRunMigration/);
  assert.match(workspaceJs, /__nasTodoReadonly/);
  assert.match(workspaceJs, /settingsNasMigrationRetry/);
  assert.match(workspaceJs, /migration\.failed\.restore/);
  assert.match(appJs, /__nasTodoReadonly/);
  assert.match(appJs, /迁移中，稍候/);
  assert.doesNotMatch(workspaceJs, /require\(['"]electron['"]\)/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /syncRunMigration/);
  assert.match(preload, /syncClassifyMigration/);
  assert.match(preload, /syncRestoreMigrationBackup/);
});
