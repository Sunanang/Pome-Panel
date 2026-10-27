(() => {
  'use strict';
  const I = window.PomeI18n;
  const dialog = document.createElement('dialog');
  dialog.id = 'content-delete-confirm';
  dialog.className = 'content-delete-confirm';
  dialog.setAttribute('aria-labelledby', 'content-delete-title');
  dialog.setAttribute('aria-describedby', 'content-delete-message');
  dialog.innerHTML = `<div class="content-delete-heading"><span class="content-delete-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M10 10v6M14 10v6"/></svg></span><div><h2 id="content-delete-title"></h2><span id="content-delete-count"></span></div></div>
    <p id="content-delete-message"></p><ul class="content-delete-preview"></ul><p id="content-delete-more" hidden></p>
    <div class="content-delete-actions"><button id="content-delete-cancel" type="button" autofocus></button><button id="content-delete-apply" type="button"></button></div>`;
  document.body.append(dialog);
  const title = dialog.querySelector('h2'), message = dialog.querySelector('#content-delete-message');
  const count = dialog.querySelector('#content-delete-count'), preview = dialog.querySelector('ul');
  const more = dialog.querySelector('#content-delete-more');
  const cancel = dialog.querySelector('#content-delete-cancel'), apply = dialog.querySelector('#content-delete-apply');
  let resolvePending = null, current = null, trigger = null, lastEscape = -Infinity;
  function render() {
    if (!current) return;
    title.textContent = current.titleKey ? I.t(current.titleKey) : I.t('ui.delete.title');
    count.textContent = I.t('ui.delete.count', {count: current.items.length});
    message.textContent = current.message || I.t(current.messageKey || 'ui.delete.description', current.args);
    preview.replaceChildren();
    current.items.slice(0,3).forEach(value => {
      const item = document.createElement('li'); item.textContent = value; preview.append(item);
    });
    more.hidden = current.items.length <= 3;
    more.textContent = I.t('ui.delete.more', {count: Math.max(0,current.items.length-3)});
    cancel.textContent = I.t('copy.cancel.2cd0f3');
    apply.textContent = I.t('copy.delete.2f9daa');
  }
  function finish(approved) {
    if (!resolvePending) return false;
    const resolve = resolvePending, anchor = trigger;
    resolvePending = null; current = null; trigger = null;
    dialog.close();
    if (anchor?.isConnected && !anchor.closest('[inert]')) anchor.focus({preventScroll:true});
    resolve(approved); return true;
  }
  function closeOnEscape() {
    // Electron forwards Escape through IPC; Chromium can also emit cancel.
    // Consume both deliveries of one key so closing never collapses the panel.
    if (dialog.open) { lastEscape = performance.now(); return finish(false); }
    return performance.now()-lastEscape < 150;
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeOnEscape(); });
  dialog.addEventListener('close', () => { if (!dialog.open && resolvePending) finish(false); });
  cancel.addEventListener('click', () => finish(false));
  apply.addEventListener('click', () => finish(true));
  let backdropPress = false;
  const outside = event => {
    const r = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom);
  };
  dialog.addEventListener('pointerdown', event => { backdropPress = outside(event); });
  dialog.addEventListener('click', event => { if (backdropPress && outside(event)) finish(false); backdropPress=false; });
  document.addEventListener('notch:will-collapse', () => finish(false));
  document.addEventListener('notch:modechange', event => { if (!event.detail.expanded) finish(false); });
  document.addEventListener('notch:tabchange', () => finish(false));
  window.addEventListener('pome:language-changed', render);
  window.PomeDeleteConfirm = {
    closeOnEscape,
    open(options) {
      if (resolvePending || document.querySelector('dialog[open]') || !options.items?.length) return Promise.resolve(false);
      current = {...options, items: options.items.map(value => String(value || ''))};
      trigger = document.activeElement; backdropPress=false; render();
      return new Promise(resolve => { resolvePending=resolve; dialog.showModal(); cancel.focus({preventScroll:true}); });
    },
  };
})();
