'use strict';
const { writeJsonAtomic, readJsonStrict } = require('./atomicStorage');
function createSyncRecovery(filePath) {
  return {
    read() { const state = readJsonStrict(filePath, { version: 1, paused: false }); if (!state || state.version !== 1 || typeof state.paused !== 'boolean' || (state.paused && (!state.operationId || !state.root || !state.serverId || !state.uid))) throw new Error('sync_recovery_state_invalid'); return state; },
    pause(context) { const state = { version: 1, paused: true, at: Date.now(), ...context }; writeJsonAtomic(filePath, state); return state; },
    complete(operationId) { const state = this.read(); if (!operationId || state.operationId !== operationId) throw new Error('recovery_operation_mismatch'); writeJsonAtomic(filePath, { version: 1, paused: false, completedAt: Date.now(), operationId }); },
    update(patch) { const state = { ...this.read(), ...patch }; writeJsonAtomic(filePath, state); return state; },
  };
}
module.exports = { createSyncRecovery };
