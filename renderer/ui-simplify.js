(() => {
  'use strict';
  const I = window.PomeI18n, D = window.NotchUiDomain, api = window.notchAPI;
  const el = id => document.getElementById(id);
  function localRead(key, fallback = '') { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
  function localWrite(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
  const text = (node, key, args) => I.bind(node, 'textContent', () => I.t(key, args));
  function button(key, action, primary = false) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'workspace-button compact' + (primary ? ' primary' : '');
    text(b, key); b.addEventListener('click', action); return b;
  }
  function details(key, id) {
    const d = document.createElement('details'); d.id = id;
    const s = document.createElement('summary'); text(s, key); d.append(s); return d;
  }
  function openManual(id) {
    const d = el(`ui-token-manual-${id}`); if (d) d.open = true;
  }
  const tokens = ['cursor', 'codex', 'copilot', 'grok', 'antigravity', 'manus'];
  const usage = {};
  function renderTokenSources(snapshots) {
    if (snapshots) for (const id of tokens) {
      if (Object.hasOwn(snapshots, id)) usage[id] = snapshots[id];
    }
    for (const id of tokens) {
      const node = el(`settings-${id}-token-status`), data = usage[id];
      if (!node || !data) continue;
      const invalid = data.manualTokenInvalid || data.status === 401 || data.status === 403;
      const key = invalid ? data.ok && data.authSource === 'local' ? 'ui.token.localFallback' : 'ui.token.expired'
        : data.ok === false ? 'ui.token.fetchFailed'
          : data.ok && data.authSource === 'manual' ? 'ui.token.manualActive'
          : data.ok && ['local', 'file', 'gh', 'hosts.yml', 'keychain'].includes(data.authSource) ? 'ui.token.localActive'
            : data.configured || data.manualTokenConfigured ? 'ui.token.savedPending' : 'ui.token.notAvailable';
      text(node, key); node.dataset.state = invalid || data.ok === false ? 'error' : data.ok ? 'saved' : 'empty';
      const hint = el(`settings-${id}-token-hint`);
      if (data.ok && hint && !hint.classList.contains('error')) I.bind(hint, 'textContent', () => '');
    }
  }
  for (const id of tokens) {
    const input = el(`settings-${id}-token`), section = input?.closest('.ai-source-token');
    if (!section) continue;
    const manual = details('ui.token.manual', `ui-token-manual-${id}`);
    const row = input.closest('.settings-cursor-token-row'), status = el(`settings-${id}-token-status`);
    const brief = document.createElement('div'); brief.className = 'ui-token-brief';
    if (status) brief.append(status);
    const fetch = el(`settings-${id}-token-fetch`);
    if (fetch) { text(fetch, 'ui.token.acquire'); fetch.classList.add('primary'); brief.append(fetch); }
    manual.append(row); section.prepend(brief, manual);
    if (id === 'grok') manual.append(el('settings-grok-team').closest('label'));
    manual.addEventListener('toggle', () => { if (manual.open) input.focus({ preventScroll: true }); });
  }
  document.addEventListener('notch:ai-usage-updated', e => renderTokenSources(e.detail));
  api?.onCursorTokenChanged?.(() => { delete usage.cursor; });
  api?.onCodexTokenChanged?.(() => { delete usage.codex; });
  api?.onAiProviderTokenChanged?.(s => { if (s?.providerId) delete usage[s.providerId]; });

  // Keep all existing NAS controls and handlers; only move the secondary view.
  const card = el('settings-nas-sync-card');
  const nasDetails = details('ui.nas.troubleshoot', 'ui-nas-troubleshoot');
  const summary = document.createElement('div'); summary.className = 'ui-nas-summary';
  const status = el('settings-nas-sync-status');
  const message = document.createElement('p'); message.id = 'ui-nas-message';
  const main = button('ui.nas.connect', () => {
    const state = window.__pomeNasUi || {};
    if (!state.bound && state.offline) el('settings-nas-pair-submit')?.click();
    else if (!state.bound) { nasDetails.open = true; el('settings-nas-sync-base-url')?.focus(); }
    else if (state.paused) el('settings-nas-recovery')?.click();
    else if (state.needsAttention) { nasDetails.open = true; el('settings-nas-status-hint')?.scrollIntoView({ block: 'nearest' }); }
    else if (state.offline) el('settings-nas-sync-retry')?.click();
    else el('settings-nas-sync-open')?.click();
  }, true); main.id = 'ui-nas-main';
  summary.append(status, message, main);
  const heading = card.querySelector('.settings-card-heading');
  for (const child of [...card.children]) if (child !== heading) nasDetails.append(child);
  card.append(summary, nasDetails);
  const copyNas = button('ui.copyDiagnostic', () => copyDiagnostic(nasDiagnostic()));
  nasDetails.append(copyNas);
  function nasDiagnostic() {
    return ['NAS', window.__pomeNasUi?.code, ...['settings-nas-sync-hint','settings-nas-status-hint','settings-nas-endpoint-hint'].map(id => el(id)?.textContent)].filter(Boolean).join('\n');
  }
  function renderNas(state) {
    window.__pomeNasUi = state;
    const key = state.paused ? 'ui.nas.paused' : state.needsAttention ? 'ui.nas.attention'
      : state.offline ? 'ui.nas.offline' : state.bound ? 'ui.nas.synced' : 'ui.nas.unbound';
    text(message, key);
    text(main, state.paused || state.needsAttention ? 'ui.nas.handle' : state.offline ? 'ui.retry' : !state.bound ? 'ui.nas.connect' : 'ui.nas.sync');
    main.disabled = state.busy === true;
  }
  renderNas(window.__pomeNasUi || { bound: false });
  el('settings-nas-sync-base-url')?.addEventListener('blur', e => { if (!e.target.readOnly) e.target.value = D.normalizeAddress(e.target.value); });

  const dialogBody = el('settings-nas-dialog-body');
  const confirmDetails = details('ui.details', 'ui-nas-confirm-details');
  const short = document.createElement('p'); short.id = 'ui-nas-confirm-summary';
  dialogBody.before(short, confirmDetails); confirmDetails.append(dialogBody);
  function prepareConfirmation(dialog) {
    confirmDetails.open = false;
    const key = /http/.test(dialog.id || '') ? 'ui.confirm.http'
      : /reauth/.test(dialog.id || '') ? 'ui.confirm.reauth' : /delete/.test(dialog.id || '') ? 'ui.confirm.delete'
        : /certificate/.test(dialog.id || '') ? 'ui.confirm.certificate' : 'ui.confirm.data';
    text(short, key);
  }
  async function copyDiagnostic(value) {
    if (!api?.writeClipboard) return false;
    try {
      const result = await api.writeClipboard({ type: 'text', text: D.diagnostic(value) });
      return result !== false && result?.ok !== false;
    } catch { return false; }
  }
  const errorBar = document.createElement('section'); errorBar.id = 'ui-error-bar'; errorBar.hidden = true;
  errorBar.setAttribute('role', 'alert'); errorBar.className = 'ui-error-bar';
  const errorMessage = document.createElement('p'); const repairCopy = document.createElement('small');
  const errorDetails = details('ui.details', 'ui-error-details'); const raw = document.createElement('pre'); errorDetails.append(raw);
  let repair = () => window.NotchAiSources?.openSettings();
  let activeError = null;
  function clearError(scope) {
    if (scope && activeError?.scope !== scope) return;
    activeError = null; errorBar.hidden = true;
  }
  const fix = button('ui.repair', () => repair(), true);
  const copy = button('ui.copyDiagnostic', async () => { text(copy, await copyDiagnostic(raw.textContent) ? 'ui.copied' : 'ui.copyFailed'); });
  const dismiss = button('ui.close', () => clearError());
  errorBar.append(errorMessage, repairCopy, fix, copy, dismiss, errorDetails); el('panel').append(errorBar);
  function showError(options) {
    // A failure has one presentation. Keep the inline hint as a fallback only
    // when this shared error surface is unavailable.
    if (options.inlineHint) {
      I.bind(options.inlineHint, 'textContent', () => '');
      options.inlineHint.classList.remove('error', 'success', 'warning');
    }
    activeError = { scope: options.scope };
    const value = options.diagnostic || options.message || '';
    const problem = D.errorKey(value);
    text(errorMessage, problem); text(repairCopy, options.repairKey || (problem === 'ui.error.layout' ? 'ui.error.layoutRepair' : 'ui.error.repair'));
    raw.textContent = D.diagnostic(value);
    const source = ['claude','codex','cursor','manus','grok','copilot'].find(id => value.toLowerCase().includes(id));
    repair = options.onRepair || (problem === 'ui.error.layout' ? () => { void setActiveTab('settings').then(() => presets.scrollIntoView({ block: 'center' })); } : () => window.NotchAiSources?.openSettings(source));
    text(copy, 'ui.copyDiagnostic'); errorDetails.open = false;
    errorBar.hidden = !el('app').classList.contains('expanded');
  }
  const isError = value => /失败|无法|错误|失效|连不上|failed|failure|error|invalid|couldn['’]t|unavailable|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(value || ''));

  const noteOpen = button('ui.openNotes', async () => {
    el('note-save-btn')?.click(); await setActiveTab('notes');
  }); noteOpen.id = 'ui-open-notes'; noteOpen.classList.add('ui-quick-entry');
  document.querySelector('.note-persist-actions')?.prepend(noteOpen);
  const recordingOpen = button('ui.openRecordings', () => setActiveTab('recordings'));
  recordingOpen.id = 'ui-open-recordings'; recordingOpen.classList.add('ui-quick-entry');
  document.querySelector('#home-recorder .recording-toolbar')?.append(recordingOpen);
  if (!recordingOpen.isConnected) document.querySelector('#home-recorder .tile-header')?.append(recordingOpen);
  if (!recordingOpen.isConnected) el('home-recorder')?.append(recordingOpen);
  function quickEntries(settings) {
    noteOpen.hidden = settings?.features?.notes === false;
    recordingOpen.hidden = settings?.features?.recordings === false;
  }
  api?.onAppSettingsChanged?.(quickEntries);

  const presets = document.createElement('div'); presets.id = 'ui-home-presets'; presets.className = 'ui-home-presets';
  let presetSelection = null;
  function layoutSignature() {
    return JSON.stringify([...document.querySelectorAll('[data-home-module]')].map(tile =>
      [tile.dataset.homeModule, tile.hidden, tile.dataset.layoutColumn, tile.dataset.layoutRow,
        tile.dataset.layoutWidth, tile.dataset.layoutHeight, tile.dataset.widgetSize]));
  }
  function syncPresets() {
    const selected = presetSelection?.signature === layoutSignature() ? presetSelection.name : null;
    presets.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === selected)));
  }
  document.addEventListener('notch:home-layout-applied', syncPresets);
  document.addEventListener('notch:home-modules-changed', syncPresets);
  document.addEventListener('notch:home-preset-applied', e => {
    presetSelection = e.detail.custom ? null : { name: e.detail.name, signature: layoutSignature() };
    syncPresets();
  });
  for (const name of Object.keys(D.PRESETS)) {
    const b = button('ui.preset.' + name, () => {
      const result = window.NotchHome.applyPreset(name);
      if (!result.ok) showError({ diagnostic: result.error, repairKey: 'ui.preset.busy' });
    }); b.dataset.preset = name; b.setAttribute('aria-pressed', 'false'); presets.append(b);
  }
  el('settings-home-module-list')?.before(presets);
  const layoutEntry = button('ui.preset.choose', () => { void setActiveTab('settings').then(() => { presets.scrollIntoView({ block: 'center' }); presets.querySelector('button')?.focus(); }); });
  el('home-context-menu')?.append(layoutEntry);

  const welcome = document.createElement('dialog'); welcome.id = 'ui-welcome'; welcome.className = 'ui-welcome';
  welcome.setAttribute('aria-labelledby', 'ui-welcome-title');
  const progress = document.createElement('small'); const title = document.createElement('h2'); title.id = 'ui-welcome-title';
  const body = document.createElement('div'); body.className = 'ui-welcome-body';
  const welcomeError = document.createElement('section'); welcomeError.id = 'ui-welcome-error'; welcomeError.hidden = true;
  const welcomeErrorText = document.createElement('p'); welcomeErrorText.setAttribute('role', 'alert');
  const welcomeErrorDetails = details('ui.details', 'ui-welcome-error-details');
  const welcomeDiagnostic = document.createElement('pre'); welcomeErrorDetails.append(welcomeDiagnostic);
  const welcomeCopy = button('ui.copyDiagnostic', async () => text(welcomeCopy, await copyDiagnostic(welcomeDiagnostic.textContent) ? 'ui.copied' : 'ui.copyFailed'));
  const welcomeRetry = button('ui.retry', () => finishWelcome());
  welcomeError.append(welcomeErrorText, welcomeRetry, welcomeCopy, welcomeErrorDetails);
  function showWelcomeError(key, diagnostic, retry = true) {
    text(welcomeErrorText, key); text(welcomeCopy, 'ui.copyDiagnostic');
    welcomeDiagnostic.textContent = D.diagnostic(diagnostic);
    welcomeErrorDetails.open = false; welcomeRetry.hidden = !retry; welcomeError.hidden = false;
  }
  const skip = button('ui.welcome.skip', () => finishWelcome());
  const back = button('ui.back', () => { welcomeError.hidden = true; step--; renderWelcome(); });
  const next = button('ui.next', () => {
    if (step === 2) {
      const result = window.NotchHome.applyPreset('simple', [...body.querySelectorAll('input:checked')].map(n => n.value));
      if (!result.ok) return showWelcomeError('ui.welcome.layoutFailed', result.error, false);
    }
    if (step === 3) void finishWelcome(); else { welcomeError.hidden = true; step++; renderWelcome(); }
  }, true);
  const actions = document.createElement('div'); actions.className = 'ui-welcome-actions'; actions.append(skip, back, next);
  welcome.append(progress, title, body, welcomeError, actions); document.body.append(welcome);
  let step = 1, settings = {}, firstWelcome = false;
  function renderWelcome() {
    progress.textContent = `${step} / 3`; text(title, 'ui.welcome.title' + step); body.replaceChildren();
    back.hidden = step === 1; text(next, step === 3 ? 'ui.welcome.finish' : 'ui.next');
    if (step === 1) {
      const p = document.createElement('p'); text(p, 'ui.welcome.summon', { shortcut: window.NotchPlatform?.formatAccelerator(settings.shortcut || 'Space', api?.capabilities) || 'Space' }); body.append(p);
      const cards = document.createElement('div'); cards.className = 'ui-welcome-tips';
      for (const key of ['capsule', 'shortcut', 'edge']) {
        const card = document.createElement('div'), title = document.createElement('strong'), hint = document.createElement('p');
        text(title, 'ui.welcome.' + key); text(hint, 'ui.welcome.' + key + 'Hint'); card.append(title, hint); cards.append(card);
      }
      body.append(cards);
    } else if (step === 2) {
      const note = document.createElement('p'); text(note, 'ui.welcome.modules'); body.append(note);
      const grid = el('settings-home-module-list').cloneNode(true); grid.id = 'ui-welcome-modules';
      const state = window.NotchHome.getVisibility();
      grid.querySelectorAll('input').forEach(input => {
        const id = input.dataset.settingsHomeModule; delete input.dataset.settingsHomeModule;
        input.value = id; input.checked = state.visibleIds.includes(id); input.disabled = false;
        input.closest('label').hidden = state.unavailableIds.includes(id);
        input.addEventListener('change', () => { if (!grid.querySelector('input:checked')) input.checked = true; });
      });
      const order = [...D.PRESETS.simple, ...D.PRESETS.all.filter(id => !D.PRESETS.simple.includes(id))];
      [...grid.children].sort((a, b) => order.indexOf(a.querySelector('input').value) - order.indexOf(b.querySelector('input').value)).forEach(row => grid.append(row));
      body.append(grid);
    } else {
      const p = document.createElement('p'); text(p, 'ui.welcome.optional'); body.append(p);
      for (const [key, target] of [['ui.nas.connect', 'settings-nas-sync-card'], ['ui.welcome.ai', 'settings-ai-sources']]) {
        body.append(button(key, async () => { if (!await finishWelcome()) return; await setActiveTab('settings'); el(target)?.scrollIntoView({ block: 'start' }); if (target.includes('nas')) nasDetails.open = true; }));
      }
    }
  }
  let finishing = false;
  async function finishWelcome() {
    if (finishing) return false;
    finishing = true;
    [skip, back, next, welcomeRetry].forEach(b => { b.disabled = true; });
    try {
      const result = await api?.completeWelcome?.();
      if (!result?.ok) throw new Error(result?.error || 'welcome_save_failed');
      welcomeError.hidden = true; welcome.close(); firstWelcome = false; return true;
    } catch (error) {
      showWelcomeError('ui.welcome.saveFailed', error?.message || 'welcome_save_failed'); return false;
    } finally {
      finishing = false; [skip, back, next, welcomeRetry].forEach(b => { b.disabled = false; });
    }
  }
  welcome.addEventListener('cancel', e => { e.preventDefault(); if (!finishing) welcome.close(); });
  api?.getAppSettings?.().then(value => {
    settings = value || {}; quickEntries(settings);
    firstWelcome = settings.onboardingPending === true;
    if (firstWelcome) {
      // Apply once per profile; reopening an unfinished wizard preserves edits.
      if (!localRead('pome-welcome-layout-v1')) {
        const result = window.NotchHome.applyPreset('simple');
        if (result.ok) localWrite('pome-welcome-layout-v1', '1');
        else showWelcomeError('ui.welcome.layoutFailed', 'welcome_layout_storage_unavailable', false);
      }
      renderWelcome();
      if (document.getElementById('app').classList.contains('expanded')) welcome.showModal();
    }
  }).catch(() => {});
  const hint = document.createElement('aside'); hint.id = 'ui-capsule-hint'; hint.hidden = true; hint.className = 'ui-capsule-hint';
  const hintText = document.createElement('span'); hint.append(hintText, button('ui.gotIt', () => { hint.hidden = true; })); el('panel').append(hint);
  let hintTimer, hintsSeen = Number(localRead('pome-capsule-hints-v1')) || 0;
  document.addEventListener('notch:tabchange', e => { if (e.detail.tab !== 'home') { hint.hidden = true; clearTimeout(hintTimer); } });
  document.addEventListener('notch:modechange', e => {
    clearTimeout(hintTimer);
    if (!e.detail.expanded) { hint.hidden = true; if (welcome.open) welcome.close(); errorBar.hidden = true; return; }
    errorBar.hidden = !activeError;
    if (firstWelcome) { if (!welcome.open) welcome.showModal(); return; }
    const count = hintsSeen;
    if (count >= 3 || document.getElementById('tab-home').getAttribute('aria-hidden') === 'true') return;
    hintsSeen = count + 1; localWrite('pome-capsule-hints-v1', String(hintsSeen));
    text(hintText, 'ui.capsule.hint', { shortcut: window.NotchPlatform?.formatAccelerator(settings.shortcut || 'Space', api?.capabilities) || 'Space' });
    hint.hidden = false; hintTimer = setTimeout(() => { hint.hidden = true; }, 6500);
  });
  window.addEventListener('pome:language-changed', () => { renderTokenSources(); if (welcome.open) renderWelcome(); });
  const confirm = document.createElement('dialog'); confirm.id = 'ui-data-confirm'; confirm.className = 'ui-welcome';
  const confirmTitle = document.createElement('h2'); confirmTitle.id = 'ui-data-confirm-title'; confirm.setAttribute('aria-labelledby', confirmTitle.id);
  const confirmMessage = document.createElement('p');
  const dataDetails = details('ui.details', 'ui-data-confirm-details'); const dataImpact = document.createElement('pre'); dataDetails.append(dataImpact);
  let confirmResolve = null;
  function resolveConfirm(value) { confirm.close(); const resolve = confirmResolve; confirmResolve = null; resolve?.(value); }
  const confirmActions = document.createElement('div'); confirmActions.className = 'ui-welcome-actions';
  confirmActions.append(button('copy.cancel.2cd0f3', () => resolveConfirm(false)), button('copy.confirm.36f33a', () => resolveConfirm(true), true));
  confirm.append(confirmTitle, confirmMessage, dataDetails, confirmActions); document.body.append(confirm);
  confirm.addEventListener('cancel', e => { e.preventDefault(); resolveConfirm(false); });
  function confirmData(options) {
    if (confirm.open || confirmResolve) return Promise.resolve(false);
    confirmTitle.textContent = options.title; confirmMessage.textContent = options.message;
    dataImpact.textContent = options.detail || ''; dataDetails.open = false; confirm.showModal();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  document.addEventListener('notch:modechange', e => { if (!e.detail.expanded && confirm.open) resolveConfirm(false); });
  window.NotchUi = { openManual, renderTokenSources, renderNas, prepareConfirmation, showError, clearError, isError, copyDiagnostic, confirm: confirmData };
})();
