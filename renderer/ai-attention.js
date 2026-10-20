'use strict';
(function () {
  const api = window.notchAPI, locale = window.PomeI18n;
  const home = document.getElementById('home-inbox');
  if (!home || !api?.getAiAttention) return;
  const section = document.createElement('dialog'); section.className = 'ai-attention-section';
  section.setAttribute('aria-labelledby', 'ai-attention-heading'); document.body.append(section);
  const header = document.createElement('div'); header.className = 'ai-attention-heading'; section.append(header);
  const heading = document.createElement('strong'); heading.id = 'ai-attention-heading'; header.append(heading);
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; header.append(close);
  close.addEventListener('click', () => section.close());
  const list = document.createElement('div'); list.id = 'ai-attention-list'; section.append(list);
  const status = document.createElement('small'); status.className = 'ai-attention-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); section.append(status);
  const entry = document.createElement('button'); entry.type = 'button'; entry.className = 'ai-attention-entry'; entry.hidden = true;
  entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-expanded', 'false');
  home.querySelector('.home-inbox-head')?.after(entry);
  function position() {
    if (!section.open) return;
    const rect = entry.getBoundingClientRect();
    section.style.left = `${Math.max(12, Math.min(innerWidth - section.offsetWidth - 12, rect.left))}px`;
    section.style.top = `${Math.max(12, Math.min(innerHeight - section.offsetHeight - 12, rect.bottom + 6))}px`;
  }
  entry.addEventListener('click', () => {
    if (section.open) { section.close(); return; }
    actionError = ''; section.showModal(); entry.setAttribute('aria-expanded', 'true'); position(); void refresh();
  });
  section.addEventListener('close', () => { entry.setAttribute('aria-expanded', 'false'); entry.focus({ preventScroll: true }); });
  section.addEventListener('click', event => {
    if (event.target !== section) return;
    const rect = section.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) section.close();
  });
  window.addEventListener('resize', position);
  let busy = false, queued = false, actionError = '';
  const t = (key, params) => locale.t(`attention.${key}`, params);
  function button(key, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-button compact'; button.textContent = t(key);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { const result = await action(); actionError = result?.ok ? '' : result?.message || (result?.canceled ? '' : t('storageError')); status.textContent = actionError; }
      catch { actionError = t('storageError'); status.textContent = actionError; }
      finally { button.disabled = false; void refresh(); }
    }); return button;
  }
  async function refresh() {
    if (busy) { queued = true; return; }
    busy = true;
    heading.textContent = t('pending'); close.setAttribute('aria-label', t('closeList'));
    try {
      const state = await api.getAiAttention();
      list.replaceChildren(); status.textContent = actionError;
      if (!state.ok) {
        status.textContent = state.message || t('storageError');
        list.append(button('repairStorage', () => api.rebuildAiAttention()));
        entry.textContent = t('repairStorage'); entry.hidden = false; return;
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
    } catch {
      status.textContent = t('storageError'); entry.textContent = t('repairStorage'); entry.hidden = false;
      list.replaceChildren(button('repairStorage', () => api.rebuildAiAttention()));
    }
    finally { position(); busy = false; if (queued) { queued = false; void refresh(); } }
  }
  api.onAiAttentionChanged?.(refresh);
  document.addEventListener('notch:tabchange', event => {
    if (event.detail?.tab !== 'home' && section.open) section.close();
    void refresh();
  });
  window.addEventListener('pome:language-changed', refresh);
  void refresh();
})();
