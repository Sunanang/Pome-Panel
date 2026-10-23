'use strict';
// Pending requests remain in the store, but only a new request or an explicit
// reopen earns a bubble. Todo reminders retain their independent FIFO.
function createAiNotificationScheduler({ completions = [], now = Date.now, slotMs = 8000 } = {}) {
  let attention = new Map(), selectedKey = null;
  function dropAiCompletions() {
    for (let index = completions.length - 1; index >= 0; index -= 1) {
      if (completions[index].source !== 'todo') completions.splice(index, 1);
    }
  }
  function sync(records, toNotification) {
    const prior = attention;
    attention = new Map(records.filter(row => row.state === 'pending' && !row.hidden).map(row => [row.key, toNotification(row)]));
    const newest = [...attention.keys()].filter(key => !prior.has(key)).at(-1);
    if (selectedKey && !attention.has(selectedKey)) selectedKey = null;
    if (newest) select(newest);
    return newest || null;
  }
  function select(key) {
    if (!attention.has(key)) return;
    dropAiCompletions();
    selectedKey = key;
  }
  // Drop on-screen selection and queued shells; store-backed pending stays.
  function clearDisplay() {
    selectedKey = null;
    completions.length = 0;
  }
  function enqueue(item) {
    if (item.source !== 'todo') {
      dropAiCompletions();
      selectedKey = null;
    }
    completions.push(item);
  }
  function next() {
    // AI bursts must not discard or indefinitely postpone deadline reminders.
    const todoIndex = completions.findIndex(item => item.source === 'todo');
    if (todoIndex >= 0) return completions.splice(todoIndex, 1)[0];
    if (selectedKey && attention.has(selectedKey)) {
      const selected = attention.get(selectedKey); selectedKey = null;
      return selected;
    }
    return completions.shift() || null;
  }
  function restore(item) {
    if (!item) return;
    if (item.attentionKey) {
      if (!selectedKey && !completions.some(row => row.source !== 'todo') && attention.has(item.attentionKey)) selectedKey = item.attentionKey;
    } else if (item.source === 'todo' || !selectedKey && !completions.some(row => row.source !== 'todo')) {
      completions.unshift(item);
    }
  }
  const count = () => completions.length + (selectedKey ? 1 : 0);
  function budget(item) { return item?.status === 'awaiting' || item?.attentionKey ? slotMs : item?.remainingMs ?? 6000; }
  return { sync, next, enqueue, restore, budget, count, clearDisplay,
    hasOthers: () => count() > 0,
    hasAttention: key => attention.has(key),
    select,
    remaining: (budgetMs, startedAt) => Math.max(0, budgetMs - Math.max(0, now() - startedAt)),
  };
}
module.exports = { createAiNotificationScheduler };
