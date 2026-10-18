'use strict';
// The main process owns window animations; this module owns fair selection and
// preserves a completion's actual remaining display time across preemption.
function createAiNotificationScheduler({ completions = [], now = Date.now, slotMs = 8000 } = {}) {
  let attention = new Map(), lastAttentionKey = null, lastKind = 'completion', preferAttention = false, selectedKey = null;
  function sync(records, toNotification) {
    const prior = attention;
    attention = new Map(records.filter(row => row.state === 'pending' && !row.hidden).map(row => [row.key, toNotification(row)]));
    if (lastKind === 'completion' && [...attention.keys()].some(key => !prior.has(key))) preferAttention = true;
  }
  function next() {
    if (selectedKey && attention.has(selectedKey)) {
      const selected = attention.get(selectedKey); lastAttentionKey = selectedKey; selectedKey = null;
      preferAttention = false; lastKind = 'attention'; return selected;
    }
    selectedKey = null;
    if (attention.size && (preferAttention || !completions.length || lastKind === 'completion')) {
      preferAttention = false; lastKind = 'attention';
      const keys = [...attention.keys()];
      const key = keys[(keys.indexOf(lastAttentionKey) + 1) % keys.length];
      lastAttentionKey = key; return attention.get(key);
    }
    if (completions.length) { lastKind = 'completion'; return completions.shift(); }
    return null;
  }
  function hasOthers(item) { return completions.length > 0 || [...attention.values()].some(row => row.attentionKey !== item?.attentionKey); }
  function suspend(item, remainingMs) { if (!item?.attentionKey) completions.unshift({ ...item, remainingMs }); }
  function budget(item) { return item?.status === 'awaiting' || item?.attentionKey ? slotMs : item?.remainingMs ?? 6000; }
  function shouldPreempt(item, paused) { return Boolean(preferAttention && attention.size && item && !item.attentionKey && !paused); }
  return { sync, next, hasOthers, suspend, budget, shouldPreempt,
    count: () => completions.length + attention.size,
    hasAttention: key => attention.has(key),
    select: key => { if (attention.has(key)) selectedKey = key; },
    remaining: (budgetMs, startedAt) => Math.max(0, budgetMs - Math.max(0, now() - startedAt)),
  };
}
module.exports = { createAiNotificationScheduler };
