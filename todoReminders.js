'use strict';

const fs = require('node:fs');
const { readJsonStrict, writeJsonAtomic } = require('./atomicStorage');

const { reminderKey, reminderStamp, mergeReminderMark } = require('./packages/sync-protocol');

// Receipts belong to a workspace, not the lifetime of an Electron process.
// Keep one receipt per task; changing its deadline explicitly invalidates it.
function createTodoReminderReceipts({ filePath, disk = fs }) {
  function read() {
    const state = readJsonStrict(filePath, { version: 1, receipts: [] }, disk);
    if (state?.version !== 1 || !Array.isArray(state.receipts)
      || state.receipts.some(row => !reminderKey(row) || !reminderStamp(row.remindedAt))) {
      throw Object.assign(new Error('todo_reminder_storage_corrupt'), { code: 'storage_corrupt' });
    }
    return new Map(state.receipts.map(row => [String(row.id), row]));
  }
  function write(rows) {
    const state = { version: 1, receipts: [...rows.values()] };
    try { writeJsonAtomic(filePath, state, disk); }
    catch (error) {
      // A directory fsync can fail after rename already committed these bytes.
      try { if (disk.readFileSync(filePath, 'utf8') === `${JSON.stringify(state)}\n`) return; } catch {}
      throw error;
    }
  }
  function merge(items) {
    const receipts = read();
    let changed = false;
    const merged = items.map(item => {
      const id = String(item.id), prior = receipts.get(id);
      if (prior && reminderKey(prior) !== reminderKey(item)) {
        receipts.delete(id);
        changed = true;
      }
      const next = mergeReminderMark(prior, item);
      if (reminderKey(next) && reminderStamp(next.remindedAt)
        && (!receipts.has(id) || receipts.get(id).remindedAt !== next.remindedAt)) {
        receipts.set(id, { id, deadline: next.deadline, remindedAt: next.remindedAt });
        changed = true;
      }
      return next;
    });
    if (changed) write(receipts);
    return merged;
  }
  function markShown(items, now = Date.now()) {
    const stamp = reminderStamp(now);
    if (!stamp) throw new Error('todo_reminder_timestamp_invalid');
    const receipts = read();
    const shown = items.filter(reminderKey).map(item => {
      const row = mergeReminderMark(receipts.get(String(item.id)), { id: String(item.id), deadline: item.deadline, remindedAt: stamp });
      receipts.set(row.id, row);
      return row;
    });
    if (shown.length) write(receipts);
    return shown;
  }
  return { merge, markShown };
}

module.exports = { reminderKey, reminderStamp, mergeReminderMark, createTodoReminderReceipts };
