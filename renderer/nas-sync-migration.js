'use strict';

/**
 * Pure UI helpers for NAS sync migration (T5b).
 * No electron require — IPC via window.notchAPI.
 */
(function initNasSyncMigration(global) {
  const BANNER_TEXT = '迁移中，稍候';

  function initialMigrationUiState() {
    return {
      readonly: false,
      bannerVisible: false,
      bannerText: BANNER_TEXT,
      phase: 'idle', // idle | classifying | awaiting_choice | migrating | failed | done
      decision: null,
      error: '',
      toast: '',
      dialog: null,
      lastMigrationId: null,
      localLive: 0,
      nasLive: 0,
      nasServerRev: 0,
      nasLatestUpdatedAt: null,
    };
  }

  function reduceMigrationUi(state, action) {
    const next = { ...state };
    switch (action.type) {
      case 'reset':
        return initialMigrationUiState();
      case 'classifying':
        next.phase = 'classifying';
        next.error = '';
        next.readonly = true;
        next.bannerVisible = true;
        next.bannerText = BANNER_TEXT;
        return next;
      case 'await_choice':
        next.phase = 'awaiting_choice';
        next.decision = action.decision || null;
        next.localLive = action.localLive != null ? action.localLive : (action.decision && action.decision.localLive) || 0;
        next.nasLive = action.nasLive != null ? action.nasLive : (action.decision && action.decision.nas && action.decision.nas.live) || 0;
        next.nasServerRev = action.nasServerRev != null
          ? action.nasServerRev
          : (action.decision && action.decision.nas && action.decision.nas.serverRev) || 0;
        next.nasLatestUpdatedAt = action.nasLatestUpdatedAt != null
          ? action.nasLatestUpdatedAt
          : (action.decision && action.decision.nas && action.decision.nas.latestUpdatedAt);
        next.readonly = true;
        next.bannerVisible = true;
        next.dialog = buildChoiceDialog(action.decision);
        return next;
      case 'migrating':
        next.phase = 'migrating';
        next.dialog = null;
        next.readonly = true;
        next.bannerVisible = true;
        next.bannerText = BANNER_TEXT;
        next.error = '';
        return next;
      case 'done':
        next.phase = 'done';
        next.readonly = false;
        next.bannerVisible = false;
        next.dialog = null;
        next.toast = action.toast || '迁移完成';
        next.lastMigrationId = action.migrationId || next.lastMigrationId;
        return next;
      case 'skipped':
        next.phase = 'done';
        next.readonly = false;
        next.bannerVisible = false;
        next.dialog = null;
        next.toast = action.toast || '已进入同步';
        return next;
      case 'failed':
        next.phase = 'failed';
        next.readonly = false;
        next.bannerVisible = false;
        next.dialog = null;
        next.error = action.message || action.error || '迁移失败';
        next.toast = next.error;
        next.lastMigrationId = action.migrationId || next.lastMigrationId;
        return next;
      case 'open_restore_confirm':
        next.dialog = {
          id: 'migration-restore-confirm',
          role: 'dialog',
          controlId: 'migration.failed.restore',
          title: '恢复上次迁移备份？',
          body: '将用备份覆盖当前本地待办，此操作不可撤销。',
          confirmLabel: '确认恢复',
          cancelLabel: '取消',
          choice: null,
        };
        return next;
      case 'close_dialog':
        next.dialog = null;
        return next;
      case 'set_readonly':
        next.readonly = Boolean(action.readonly);
        next.bannerVisible = Boolean(action.readonly);
        if (action.readonly) next.bannerText = BANNER_TEXT;
        return next;
      default:
        return next;
    }
  }

  function buildChoiceDialog(decision) {
    if (!decision) return null;
    if (decision.decision === 'both_live_confirm' || decision.choiceKind === 'both_live') {
      const nas = decision.nas || {};
      const body = [
        `本地 live：${decision.localLive || 0}`,
        `NAS live：${nas.live || 0}`,
        `NAS serverRev：${nas.serverRev || 0}`,
        nas.latestUpdatedAt ? `NAS 最新：${formatTime(nas.latestUpdatedAt)}` : null,
        '请选择权威侧；另一侧将被覆盖。',
      ].filter(Boolean).join('\n');
      return {
        id: 'migration-both-live',
        role: 'dialog',
        controlId: 'migration.both-live.confirm',
        title: '两边都有待办',
        body,
        confirmLabel: '用本地',
        altLabel: '用 NAS',
        cancelLabel: '取消',
        choiceConfirm: 'use_local',
        choiceAlt: 'use_nas',
        allowDismiss: true,
      };
    }
    if (decision.decision === 'history_empty_choice' || decision.choiceKind === 'history_empty') {
      return {
        id: 'migration-history-empty',
        role: 'dialog',
        controlId: 'migration.history-empty.choice',
        title: 'NAS 为历史清空库',
        body: 'NAS 无 live 待办但有删除历史。请选择恢复本地，或保持 NAS 删除结果。',
        confirmLabel: '恢复本地',
        cancelLabel: '保持 NAS 删除结果',
        choiceConfirm: 'restore_local',
        choiceCancel: 'keep_nas_deletes',
        allowDismiss: false,
      };
    }
    return null;
  }

  function formatTime(value) {
    if (typeof value === 'number') {
      try {
        return new Date(value).toLocaleString();
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function isReadonly(state) {
    return Boolean(state && state.readonly);
  }

  /**
   * Orchestrate classify → optional choice → run. Injectable API for tests.
   */
  async function runMigrationFlow({
    api,
    localTodosJson,
    choice = null,
    onState,
  }) {
    const emit = (action) => {
      if (typeof onState === 'function') onState(action);
    };

    emit({ type: 'classifying' });
    const classified = await api.syncClassifyMigration({ localTodosJson });
    if (!classified || !classified.ok) {
      const failure = {
        type: 'failed',
        error: (classified && classified.error) || 'classify_failed',
        message: (classified && classified.message) || '无法判定迁移状态',
      };
      emit(failure);
      return { ok: false, ...failure };
    }

    const decision = classified.decision;
    if (decision.decision === 'block_corrupt_local') {
      const failure = {
        type: 'failed',
        error: 'local_corrupt',
        message: decision.message || '本地待办损坏',
      };
      emit(failure);
      return { ok: false, ...failure };
    }

    if (decision.needsUserChoice) {
      if (!choice) {
        emit({
          type: 'await_choice',
          decision,
          localLive: decision.localLive,
          nasLive: decision.nas && decision.nas.live,
          nasServerRev: decision.nas && decision.nas.serverRev,
          nasLatestUpdatedAt: decision.nas && decision.nas.latestUpdatedAt,
        });
        return { ok: false, error: 'choice_required', decision };
      }
    }

    emit({ type: 'migrating' });
    const result = await api.syncRunMigration({
      localTodosJson,
      choice,
    });

    if (!result || !result.ok) {
      if (result && result.error === 'cas_conflict') {
        emit({
          type: 'failed',
          error: 'cas_conflict',
          message: '对端已变更，请重新判定',
          migrationId: result.migrationId,
        });
        return result;
      }
      emit({
        type: 'failed',
        error: (result && result.error) || 'migration_failed',
        message: (result && result.message) || '迁移失败',
        migrationId: result && result.migrationId,
      });
      return result || { ok: false, error: 'migration_failed' };
    }

    if (result.skipped) {
      emit({ type: 'skipped' });
      return result;
    }

    emit({ type: 'done', migrationId: result.migrationId });
    return result;
  }

  const api = {
    BANNER_TEXT,
    initialMigrationUiState,
    reduceMigrationUi,
    buildChoiceDialog,
    isReadonly,
    runMigrationFlow,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.NasSyncMigration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
