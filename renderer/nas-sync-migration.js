'use strict';
const pomeLocaleRendererNasSyncMigration = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;


/**
 * Pure UI helpers for NAS sync migration (T5b).
 * No electron require — IPC via window.notchAPI.
 */
(function initNasSyncMigration(global) {
  const BANNER_TEXT = pomeLocaleRendererNasSyncMigration.t("copy.migratingPleaseWait.7aed12");

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
        next.toast = action.toast || pomeLocaleRendererNasSyncMigration.t("copy.migrationComplete.920d63");
        next.lastMigrationId = action.migrationId || next.lastMigrationId;
        return next;
      case 'skipped':
        next.phase = 'done';
        next.readonly = false;
        next.bannerVisible = false;
        next.dialog = null;
        next.toast = action.toast || pomeLocaleRendererNasSyncMigration.t("copy.syncEnabled.f1b086");
        return next;
      case 'failed':
        next.phase = 'failed';
        next.readonly = false;
        next.bannerVisible = false;
        next.dialog = null;
        next.error = action.message || action.error || pomeLocaleRendererNasSyncMigration.t("copy.migrationFailed.35cda8");
        next.toast = next.error;
        next.lastMigrationId = action.migrationId || next.lastMigrationId;
        return next;
      case 'open_restore_confirm':
        next.dialog = {
          id: 'migration-restore-confirm',
          role: 'dialog',
          controlId: 'migration.failed.restore',
          title: pomeLocaleRendererNasSyncMigration.t("copy.restoreTheLastMigrationBackup.e76417"),
          body: pomeLocaleRendererNasSyncMigration.t("copy.theBackupWillOverwriteCurrentLocalTasks.aa3737"),
          confirmLabel: pomeLocaleRendererNasSyncMigration.t("copy.restore.51e44d"),
          cancelLabel: pomeLocaleRendererNasSyncMigration.t("copy.cancel.2cd0f3"),
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
        pomeLocaleRendererNasSyncMigration.t("copy.localLiveData.e31bc0", { arg1: (decision.localLive || 0) }),
        `NAS live：${nas.live || 0}`,
        `NAS serverRev：${nas.serverRev || 0}`,
        nas.latestUpdatedAt ? pomeLocaleRendererNasSyncMigration.t("copy.latestNasData.f96efe", { arg1: (formatTime(nas.latestUpdatedAt)) }) : null,
        pomeLocaleRendererNasSyncMigration.t("copy.chooseTheAuthoritativeSideTheOtherSide.e96da7"),
      ].filter(Boolean).join('\n');
      return {
        id: 'migration-both-live',
        role: 'dialog',
        controlId: 'migration.both-live.confirm',
        title: pomeLocaleRendererNasSyncMigration.t("copy.bothSidesContainData.a4a06d"),
        body,
        confirmLabel: pomeLocaleRendererNasSyncMigration.t("copy.useLocalData.818fb3"),
        altLabel: pomeLocaleRendererNasSyncMigration.t("copy.useNasData.3c38f4"),
        cancelLabel: pomeLocaleRendererNasSyncMigration.t("copy.cancel.2cd0f3"),
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
        title: pomeLocaleRendererNasSyncMigration.t("copy.theNasHasAHistoryOfDeleted.de32a4"),
        body: pomeLocaleRendererNasSyncMigration.t("copy.theNasHasNoLiveItemsBut.9cb2fc"),
        confirmLabel: pomeLocaleRendererNasSyncMigration.t("copy.restoreLocalData.239b3d"),
        cancelLabel: pomeLocaleRendererNasSyncMigration.t("copy.keepNasDeletions.4129ce"),
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
        return new Date(value).toLocaleString(pomeLocaleRendererNasSyncMigration.getState().formatLocale);
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
        message: (classified && classified.message) || pomeLocaleRendererNasSyncMigration.t("copy.couldnTDetermineMigrationState.4d2f3f"),
      };
      emit(failure);
      return { ok: false, ...failure };
    }

    const decision = classified.decision;
    if (decision.decision === 'block_corrupt_local') {
      const failure = {
        type: 'failed',
        error: 'local_corrupt',
        message: decision.message || pomeLocaleRendererNasSyncMigration.t("copy.localTaskDataIsDamaged.f42b61"),
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
          message: pomeLocaleRendererNasSyncMigration.t("copy.theRemoteSideChangedCheckAgain.a12f81"),
          migrationId: result.migrationId,
        });
        return result;
      }
      emit({
        type: 'failed',
        error: (result && result.error) || 'migration_failed',
        message: (result && result.message) || pomeLocaleRendererNasSyncMigration.t("copy.migrationFailed.35cda8"),
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
