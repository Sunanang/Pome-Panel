'use strict';

function reminderKey(todo) {
  const id = String(todo?.id || '').trim();
  const deadline = Date.parse(String(todo?.deadline || ''));
  return id && Number.isFinite(deadline) ? JSON.stringify([id, deadline]) : '';
}

function reminderStamp(value) {
  const stamp = Number(value);
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
}

function mergeReminderMark(previous, incoming) {
  if (!reminderKey(incoming) || reminderKey(previous) !== reminderKey(incoming)) return incoming;
  return { ...incoming, remindedAt: Math.max(reminderStamp(previous.remindedAt), reminderStamp(incoming.remindedAt)) };
}

module.exports = { reminderKey, reminderStamp, mergeReminderMark };
