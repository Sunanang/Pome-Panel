'use strict';
(function () {
  const api = window.notchAPI, locale = window.PomeI18n;
  const settings = document.getElementById('settings-ai-sources');
  const home = document.getElementById('home-inbox');
  if (!settings || !api?.getAiAttention) return;
  const section = document.createElement('section'); section.className = 'ai-attention-section'; settings.append(section);
  const heading = document.createElement('strong'); section.append(heading);
  const list = document.createElement('div'); list.id = 'ai-attention-list'; section.append(list);
  const status = document.createElement('small'); status.className = 'ai-attention-status'; section.append(status);
  const entry = document.createElement('button'); entry.type = 'button'; entry.className = 'ai-attention-entry'; entry.hidden = true;
  home?.querySelector('.home-inbox-head')?.after(entry);
  entry.addEventListener('click', () => {
    void setActiveTab('settings').then(() => { section.scrollIntoView({ block: 'center' }); list.querySelector('button')?.focus({ preventScroll: true }); });
  });
  let busy = false, queued = false;
  const t = (key, params) => locale.t(`attention.${key}`, params);
  function button(key, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-button compact'; button.textContent = t(key);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { const result = await action(); status.textContent = result?.ok ? '' : result?.message || (result?.canceled ? '' : t('storageError')); }
      catch { status.textContent = t('storageError'); }
      finally { button.disabled = false; void refresh(); }
    }); return button;
  }
  async function refresh() {
    if (busy) { queued = true; return; }
    busy = true;
    try {
      const state = await api.getAiAttention();
      heading.textContent = t('pending'); list.replaceChildren();
      if (!state.ok) {
        status.textContent = state.message || t('storageError');
        list.append(button('repairStorage', () => api.rebuildAiAttention()));
        entry.textContent = t('storageError'); entry.hidden = false; return;
      }
      const rows = state.items || []; entry.hidden = rows.length === 0;
      entry.textContent = `${t('pending')} · ${rows.length}`;
      if (!rows.length) { const empty = document.createElement('small'); empty.textContent = t('empty'); list.append(empty); }
      for (const row of rows) {
        const item = document.createElement('div'); item.className = 'ai-attention-row'; item.dataset.key = row.key;
        const event = row.event, normalized = window.PomeNotification.normalize({ source: event.source });
        const kind = { input: 'input', select: 'choice', approve: 'authorization' }[event.action];
        const copy = document.createElement('div'), title = document.createElement('strong'), question = document.createElement('small');
        title.textContent = `${normalized.source} · ${t(kind)}`;
        question.textContent = event.commandPreview ? t('commandMasked', { command: event.commandPreview }) : event.question || t(event.sensitive ? 'sensitive' : 'generic'); question.title = question.textContent;
        copy.append(title, question);
        if (row.state === 'unverified') { const hint = document.createElement('small'); hint.textContent = t('unverified'); copy.append(hint); }
        const actions = document.createElement('div'); actions.className = 'ai-attention-actions';
        actions.append(button('open', () => api.openAiAttention(row.key)));
        if (row.state === 'pending') actions.append(button('reopen', () => api.showAiAttention(row.key)));
        item.append(copy, actions); list.append(item);
      }
    } catch { status.textContent = t('storageError'); }
    finally { busy = false; if (queued) { queued = false; void refresh(); } }
  }
  api.onAiAttentionChanged?.(refresh);
  document.addEventListener('notch:tabchange', refresh);
  window.addEventListener('pome:language-changed', refresh);
  void refresh();
})();
