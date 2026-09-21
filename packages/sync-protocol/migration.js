'use strict';

/**
 * First-bind migration decision helpers (decisions §5 / §7 / §12).
 * Pure — no I/O. Desktop and FPK may both require this module.
 */

const MIGRATION_STATES = Object.freeze([
  'pending',
  'prepared',
  'committed',
  'applied',
  'failed',
]);

const MIGRATION_DECISIONS = Object.freeze({
  AUTO_UPLOAD_LOCAL: 'auto_upload_local',
  AUTO_DOWNLOAD_NAS: 'auto_download_nas',
  BOTH_LIVE_CONFIRM: 'both_live_confirm',
  SKIP_EMPTY: 'skip_empty',
  ENTER_SYNC_NAS_HISTORY: 'enter_sync_nas_history',
  HISTORY_EMPTY_CHOICE: 'history_empty_choice',
  BLOCK_CORRUPT_LOCAL: 'block_corrupt_local',
});

const AUTHORITY = Object.freeze({
  LOCAL: 'local',
  NAS: 'nas',
});

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Normalize NAS `GET /sync/state` payload for classification.
 * @param {object} nasState
 * @returns {{ ok: true, state: object } | { ok: false, reason: string }}
 */
function normalizeNasSyncState(nasState) {
  if (!nasState || typeof nasState !== 'object' || Array.isArray(nasState)) {
    return { ok: false, reason: 'nas_state_invalid' };
  }
  const live = Number(nasState.live);
  const tombstones = Number(nasState.tombstones);
  const changeLogCount = Number(nasState.changeLogCount);
  const serverRev = Number(nasState.serverRev);
  if (![live, tombstones, changeLogCount, serverRev].every(isNonNegativeInt)) {
    return { ok: false, reason: 'nas_state_fields_invalid' };
  }
  const pristine =
    nasState.pristine === true ||
    (live === 0 && tombstones === 0 && changeLogCount === 0 && serverRev === 0);
  return {
    ok: true,
    state: {
      live,
      tombstones,
      changeLogCount,
      serverRev,
      pristine: Boolean(pristine),
      latestUpdatedAt: nasState.latestUpdatedAt == null ? null : nasState.latestUpdatedAt,
      historyEmpty: live === 0 && !pristine,
    },
  };
}

/**
 * Classify first-bind migration action from local + NAS presence.
 *
 * @param {{
 *   localOk: boolean,
 *   localLive: number,
 *   localCorrupt?: boolean,
 *   nas: object,
 * }} input
 */
function classifyMigrationDecision(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'input_invalid' };
  }
  if (input.localCorrupt === true || input.localOk === false) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.BLOCK_CORRUPT_LOCAL,
      needsUserChoice: false,
      auto: false,
      message: '本地待办数据损坏，请先导出修复后再迁移',
    };
  }

  const nasNorm = normalizeNasSyncState(input.nas);
  if (!nasNorm.ok) return nasNorm;
  const nas = nasNorm.state;
  const localLive = Math.max(0, Number(input.localLive) || 0);
  const localHasLive = localLive > 0;
  const nasHasLive = nas.live > 0;

  if (localHasLive && nas.pristine) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.AUTO_UPLOAD_LOCAL,
      needsUserChoice: false,
      auto: true,
      authority: AUTHORITY.LOCAL,
      localLive,
      nas,
    };
  }
  if (!localHasLive && nasHasLive) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.AUTO_DOWNLOAD_NAS,
      needsUserChoice: false,
      auto: true,
      authority: AUTHORITY.NAS,
      localLive,
      nas,
    };
  }
  if (localHasLive && nasHasLive) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.BOTH_LIVE_CONFIRM,
      needsUserChoice: true,
      auto: false,
      choiceKind: 'both_live',
      localLive,
      nas,
      message: '两边都有待办，请选择以哪一侧为准',
    };
  }
  if (!localHasLive && nas.pristine) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.SKIP_EMPTY,
      needsUserChoice: false,
      auto: true,
      authority: null,
      localLive,
      nas,
    };
  }
  if (!localHasLive && nas.historyEmpty) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.ENTER_SYNC_NAS_HISTORY,
      needsUserChoice: false,
      auto: true,
      authority: AUTHORITY.NAS,
      localLive,
      nas,
    };
  }
  if (localHasLive && nas.historyEmpty) {
    return {
      ok: true,
      decision: MIGRATION_DECISIONS.HISTORY_EMPTY_CHOICE,
      needsUserChoice: true,
      auto: false,
      choiceKind: 'history_empty',
      localLive,
      nas,
      message: 'NAS 为历史清空库；请选择恢复本地或保持 NAS 删除结果',
    };
  }

  return { ok: false, reason: 'unclassified' };
}

/**
 * Resolve user choice into authority for decisions that need confirmation.
 * @param {string} decision
 * @param {'use_local'|'use_nas'|'restore_local'|'keep_nas_deletes'|string} choice
 */
function resolveMigrationChoice(decision, choice) {
  if (decision === MIGRATION_DECISIONS.BOTH_LIVE_CONFIRM) {
    if (choice === 'use_local') return { ok: true, authority: AUTHORITY.LOCAL };
    if (choice === 'use_nas') return { ok: true, authority: AUTHORITY.NAS };
    return { ok: false, reason: 'choice_required' };
  }
  if (decision === MIGRATION_DECISIONS.HISTORY_EMPTY_CHOICE) {
    if (choice === 'restore_local' || choice === 'use_local') {
      return { ok: true, authority: AUTHORITY.LOCAL };
    }
    if (choice === 'keep_nas_deletes' || choice === 'use_nas') {
      return { ok: true, authority: AUTHORITY.NAS };
    }
    return { ok: false, reason: 'choice_required' };
  }
  return { ok: false, reason: 'choice_not_applicable' };
}

function assertMigrationState(state) {
  if (!MIGRATION_STATES.includes(state)) {
    return { ok: false, reason: 'invalid_migration_state' };
  }
  return { ok: true, state };
}

module.exports = {
  MIGRATION_STATES,
  MIGRATION_DECISIONS,
  AUTHORITY,
  normalizeNasSyncState,
  classifyMigrationDecision,
  resolveMigrationChoice,
  assertMigrationState,
};
