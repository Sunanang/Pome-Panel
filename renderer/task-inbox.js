const pomeLocaleRendererTaskInbox = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function initTaskInbox() {
  const api = window.notchAPI;
  const tile = document.getElementById('home-inbox');
  const badge = document.getElementById('home-inbox-badge');
  if (!tile || !badge) return;
  const list = document.getElementById('task-inbox-list');
  const pagination = document.getElementById('home-inbox-pagination');
  const latest = document.getElementById('home-inbox-latest');
  const status = document.getElementById('task-inbox-status');
  const rebuild = document.getElementById('task-inbox-rebuild');
  const readAll = document.getElementById('home-inbox-read-all');
  const mini = document.getElementById('home-inbox-mini');
  const unreadLabel = document.getElementById('home-inbox-unread-label');
  const homeTab = document.getElementById('tab-button-home');
  const sourceSuggestion = document.createElement('div');
  sourceSuggestion.className = 'home-inbox-source-suggestion'; sourceSuggestion.hidden = true;
  tile.querySelector('.home-inbox-head').after(sourceSuggestion);
  const sources = Object.fromEntries(window.NotchAiProviders.completionIds().map(id => {
    const row = window.NotchAiProviders.get(id);
    return [id, { label: id === 'claude' ? 'Claude' : row.label, icon: row.icon }];
  }));
  const statusLabels = { get completed() { return pomeLocaleRendererTaskInbox.t("copy.completed.f28461"); }, get failed() { return pomeLocaleRendererTaskInbox.t("copy.failed.01ad2b"); }, get awaiting() { return pomeLocaleRendererTaskInbox.t("copy.awaitingConfirmation.e5d218"); }, get due() { return pomeLocaleRendererTaskInbox.t("copy.dueSoon.ea0afa"); } };
  const recordStatus = row => statusLabels[row?.status] ? row.status : 'completed';
  function pageSizeForWidget() { return { mini: 1, small: 3, medium: 5, large: 10 }[tile.dataset.widgetSize] || 5; }
  let rows = [], total = 0, unread = 0, page = 0;
  let busy = false, editing = false, opening = false, resetScroll = false, queued = false, failure = null, failureGeneration = 0;
  let highlightTimer, paintSignature = ''; 
  // The inbox is no longer an overlay. Escape continues to follow the normal panel policy.
  window.closeWorkHubOverlay = () => {
    const confirmation = document.getElementById('ai-source-confirm');
    if (!confirmation?.open) return false;
    confirmation.close(); return true;
  };

  function relativeTime(at) {
    const elapsed = Math.max(0, Date.now() - at);
    if (elapsed < 60000) return pomeLocaleRendererTaskInbox.t("copy.justNow.de6785");
    if (elapsed < 3600000) return pomeLocaleRendererTaskInbox.t("copy.minutesAgo.5c5fd5", { arg1: (Math.floor(elapsed / 60000)) });
    if (elapsed < 86400000) return pomeLocaleRendererTaskInbox.t("copy.hoursAgo.9112fb", { arg1: (Math.floor(elapsed / 3600000)) });
    if (elapsed < 7 * 86400000) return pomeLocaleRendererTaskInbox.t("copy.daysAgo.fb7c20", { arg1: (Math.floor(elapsed / 86400000)) });
    return new Date(at).toLocaleDateString(pomeLocaleRendererTaskInbox.getState().formatLocale);
  }
  function updateBadge() {
    const moduleHidden = tile.hidden || window.NotchHome?.isVisible('inbox') === false;
    badge.hidden = homeTab.classList.contains('active') || (!failure && unread === 0);
    badge.dataset.dot = String(moduleHidden);
    badge.textContent = moduleHidden ? '' : failure ? '!' : unread > 9 ? '9+' : String(unread);
    badge.dataset.error = String(Boolean(failure));
    pomeLocaleRendererTaskInbox.bind(badge, "title", () => (moduleHidden ? pomeLocaleRendererTaskInbox.t("copy.aiActivityIsHiddenOpenSettings.83167e") : failure ? pomeLocaleRendererTaskInbox.t("copy.aiActivityInboxErrorClickToReview.828d6f") : pomeLocaleRendererTaskInbox.t("copy.aiEventsToReview.22d6c7", { arg1: (unread) })));
    homeTab.setAttribute('aria-label', failure ? pomeLocaleRendererTaskInbox.t("copy.homeAiActivityInboxError.71a7c7") : unread ? pomeLocaleRendererTaskInbox.t("copy.homeUnreadAiEvents.cf1008", { arg1: (unread) }) : pomeLocaleRendererTaskInbox.t("copy.home.203c08"));
    document.getElementById('home-inbox-unread').textContent = String(unread);
    pomeLocaleRendererTaskInbox.bind(unreadLabel, "textContent", () => (failure ? pomeLocaleRendererTaskInbox.t("copy.receivingPaused.ddea48") : unread ? pomeLocaleRendererTaskInbox.t("copy.unread.1b2d74", { arg1: (unread) }) : total === 0 && tile.dataset.sourceState === 'waiting' ? pomeLocaleRendererTaskInbox.t("copy.listening.fa2d74") : ''));
    readAll.disabled = Boolean(failure) || editing || unread === 0;
    readAll.hidden = Boolean(failure) || total === 0;
  }
  function showFailure(error) {
    // IPC can reject after the structured error event has already arrived.
    // Keep its recovery metadata until a successful read clears the failure.
    failure = error?.error ? { ...failure, ...error } : failure || {};
    paintSignature = '';
    failureGeneration++;
    tile.dataset.error = 'true';
    pomeLocaleRendererTaskInbox.bind(status, "textContent", () => ((failure.recoverable
      ? pomeLocaleRendererTaskInbox.t("copy.theInboxFileIsDamagedReceivingIs.c54707")
      : pomeLocaleRendererTaskInbox.t("copy.theInboxCannotBeReadRightNow.7133dc"))
      + (failure.recoverable ? pomeLocaleRendererTaskInbox.t("copy.originalFileExistingRecordsMayNotBe.854ff3", { arg1: (String(failure.filePath || '').split(/[\\/]/).at(-1)) }) : '')));
    status.title = failure.filePath || '';
    rebuild.hidden = !failure.recoverable;
    list.replaceChildren(); mini.hidden = true; pagination.hidden = true;
    sourceSuggestion.hidden = true;
    updateBadge();
  }
  function button(text, onClick, className) {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = text;
    if (className) el.className = className;
    el.addEventListener('click', onClick); return el;
  }
  function paintEmpty(size, sourceState) {
    const empty = document.createElement('div'); empty.className = 'home-inbox-empty-state';
    const connected = sourceState.sources.filter(row => row.state === 'connected');
    const invalid = sourceState.sources.filter(row => row.state === 'error');
    const suggestion = sourceState.suggestion;
    const state = invalid.length ? 'error' : suggestion ? 'suggestion' : connected.length ? 'waiting' : 'none';
    tile.dataset.sourceState = state; empty.dataset.state = state;
    const heading = document.createElement('strong');
    pomeLocaleRendererTaskInbox.bind(heading, "textContent", () => (!sourceState.ready ? pomeLocaleRendererTaskInbox.t("copy.checkingConnections.9094c8") : invalid.length ? pomeLocaleRendererTaskInbox.t("copy.connectionNeedsRepair.5eb0e6", { arg1: (invalid.map(row => row.label).join('、')) }) : suggestion ? pomeLocaleRendererTaskInbox.t("copy.detectedConnectIt.306d1d", { arg1: (suggestion.label) }) : connected.length ? pomeLocaleRendererTaskInbox.t("copy.connectedWaitingForTheFirstEvent.f686e3", { arg1: (connected.map(row => row.label).join('、')) }) : pomeLocaleRendererTaskInbox.t("copy.noAiToolsConnectedYet.260ab9")));
    if (size !== 'mini') {
      const icons = document.createElement('div'); icons.className = 'home-inbox-empty-icons';
      for (const row of invalid.length ? invalid : suggestion ? [suggestion] : connected.length ? connected : sourceState.sources) {
        const icon = document.createElement('img'); icon.src = sources[row.source]?.icon; icon.alt = row.label; icons.append(icon);
      }
      empty.append(icons);
    }
    empty.append(heading);
    const details = document.createElement('p');
    pomeLocaleRendererTaskInbox.bind(details, "textContent", () => (invalid.length ? invalid[0].message : suggestion ? pomeLocaleRendererTaskInbox.t("copy.previewTheConfigurationChangesThenConfirmTo.e6f59b") : connected.length ? pomeLocaleRendererTaskInbox.t("copy.completeATaskInTheToolOr.982a17") : pomeLocaleRendererTaskInbox.t("copy.completionEventsWillAppearHereAfterConnecting.ff55a6")));
    if (size !== 'mini') empty.append(details);
    const actions = document.createElement('div'); actions.className = 'home-inbox-empty-actions';
    const primary = size === 'mini' ? '' : 'workspace-button compact home-inbox-onboard-primary';
    if (invalid.length) actions.append(button(pomeLocaleRendererTaskInbox.t("copy.repair.37a693"), event => invalid[0].repairable ? window.NotchAiSources?.request(invalid[0].source, 'repair', event.currentTarget) : window.NotchAiSources?.openSettings(invalid[0].source), primary));
    else if (suggestion) actions.append(button(pomeLocaleRendererTaskInbox.t("copy.connect.f3b392"), event => window.NotchAiSources?.request(suggestion.source, 'connect', event.currentTarget), primary), button(pomeLocaleRendererTaskInbox.t("copy.later.9d2055"), () => window.NotchAiSources?.dismiss(suggestion.source)));
    else if (connected.length) actions.append(button(pomeLocaleRendererTaskInbox.t("copy.sendTest.a49d32"), () => void window.NotchAiSources?.test(connected[0].source)), button(pomeLocaleRendererTaskInbox.t("copy.manageSources.a0b36f"), () => window.NotchAiSources?.openSettings()));
    else actions.append(button(pomeLocaleRendererTaskInbox.t("copy.connect.d312c6"), () => window.NotchAiSources?.openSettings(), primary));
    empty.append(actions); list.append(empty);
    if (state === 'waiting') pomeLocaleRendererTaskInbox.bind(unreadLabel, "textContent", () => (pomeLocaleRendererTaskInbox.t("copy.listening.fa2d74")));
  }
  function paint() {
    if (failure) { updateBadge(); return; }
    const size = tile.dataset.widgetSize || 'medium';
    const sourceState = window.NotchAiSources?.getState() || { sources: [], ready: false };
    const signature = JSON.stringify([size,page,total,unread,Math.floor(Date.now()/60000),rows,sourceState]);
    if (signature === paintSignature) { updateBadge(); return; }
    paintSignature = signature;
    const limit = pageSizeForWidget();
    tile.dataset.inboxPage = String(page + 1);
    const visible = rows.slice(0, limit);
    const activeId = document.activeElement?.closest('.home-inbox-row')?.dataset.id;
    list.replaceChildren(); mini.hidden = !['mini', 'small'].includes(size) || total === 0;
    sourceSuggestion.replaceChildren(); sourceSuggestion.hidden = !total || !sourceState.suggestion;
    if (!sourceSuggestion.hidden) {
      const suggestion = sourceState.suggestion, text = document.createElement('span');
      pomeLocaleRendererTaskInbox.bind(text, "textContent", () => (pomeLocaleRendererTaskInbox.t("copy.detectedConnectIt.306d1d", { arg1: (suggestion.label) })));
      sourceSuggestion.append(text, button(pomeLocaleRendererTaskInbox.t("copy.connect.f3b392"), event => window.NotchAiSources?.request(suggestion.source, 'connect', event.currentTarget)), button(pomeLocaleRendererTaskInbox.t("copy.later.9d2055"), () => window.NotchAiSources?.dismiss(suggestion.source)));
      if (size === 'mini') mini.hidden = true;
    }
    pomeLocaleRendererTaskInbox.bind(latest, "textContent", () => (rows[0] ? `${sources[rows[0].source]?.label || pomeLocaleRendererTaskInbox.t("copy.other.d2909f")}${recordStatus(rows[0]) !== 'completed' ? ` · ${statusLabels[recordStatus(rows[0])]}` : ''} · ${relativeTime(rows[0].receivedAt)}` : ''));
    latest.title = [openLabel(rows[0]?.source), statusLabels[recordStatus(rows[0])], rows[0]?.completionSummary || rows[0]?.title].filter(Boolean).join(' · ');
    delete tile.dataset.sourceState;
    if (!total) {
      paintEmpty(size, sourceState);
    } else if (size !== 'mini') {
      for (const row of visible) {
        const source = sources[row.source] || {label:pomeLocaleRendererTaskInbox.t("copy.other.d2909f"),icon:'assets/inbox/openai.svg'};
        const item = document.createElement('div'); item.className = 'home-inbox-item';
        const rowButton = button('', () => void openRecord(row), 'home-inbox-row');
        rowButton.dataset.id = row.id; rowButton.dataset.status = recordStatus(row); rowButton.dataset.unread = String(row.readAt === null);
        rowButton.title = openLabel(row.source);
        rowButton.setAttribute('aria-label', `${source.label} · ${statusLabels[recordStatus(row)]} · ${(row.titleIsFallback ? window.PomeNotification.fallbackTitle(row.source, row.status) : row.title) || pomeLocaleRendererTaskInbox.t("copy.taskCompleted.e9a880")} · ${relativeTime(row.receivedAt)}${row.readAt === null ? pomeLocaleRendererTaskInbox.t("copy.unread.4557d3") : ''}`);
        const iconWrap = document.createElement('span'); iconWrap.className = 'home-inbox-source-wrap'; iconWrap.dataset.source = sources[row.source] ? row.source : 'other';
        const icon = document.createElement('img'); icon.src = source.icon; icon.alt = ''; icon.className = 'home-inbox-source'; icon.dataset.source = iconWrap.dataset.source;
        const copy = document.createElement('span'); copy.className = 'home-inbox-copy';
        const title = document.createElement('strong'); pomeLocaleRendererTaskInbox.bind(title, "textContent", () => ((row.titleIsFallback ? window.PomeNotification.fallbackTitle(row.source, row.status) : row.title) || pomeLocaleRendererTaskInbox.t("copy.taskCompleted.e9a880"))); title.title = [row.sessionTitle, row.titleIsFallback ? window.PomeNotification.fallbackTitle(row.source, row.status) : row.completionSummary || row.title].filter(Boolean).join('\n'); copy.append(title);
        if (recordStatus(row) !== 'completed') {
          const state = document.createElement('small'); state.className = 'home-inbox-event-status';
          state.textContent = statusLabels[recordStatus(row)]; copy.append(state);
        }
        if (size === 'large') {
          const summary = document.createElement('small'); summary.textContent = row.project || source.label; summary.title = rowButton.title; copy.append(summary);
        }
        const time = document.createElement('time'); time.dateTime = new Date(row.receivedAt).toISOString(); time.textContent = relativeTime(row.receivedAt); time.title = rowButton.title;
        const dot = document.createElement('i'); dot.className = 'home-inbox-dot'; dot.setAttribute('aria-hidden', 'true');
        iconWrap.append(icon); rowButton.append(iconWrap, copy, time, dot); item.append(rowButton);
        list.append(item);
      }
    }
    const paging = window.NotchTaskInboxDomain.pagination(total, page, limit);
    pagination.replaceChildren(); pagination.hidden = size === 'mini' || !paging.visible;
    if (!pagination.hidden) {
      if (paging.previous) pagination.append(button(pomeLocaleRendererTaskInbox.t("copy.previous.c9b9ae"), () => changePage(-1)));
      if (paging.label) { const label = document.createElement('span'); label.textContent = paging.label; pagination.append(label); }
      if (paging.next) { const next = button(pomeLocaleRendererTaskInbox.t("copy.next.8a8542"), () => changePage(1), 'home-inbox-next'); pagination.append(next); }
    }
    updateBadge();
    if (activeId) list.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.focus({preventScroll:true});
  }
  function openLabel(source) { return { codex: pomeLocaleRendererTaskInbox.t("copy.openCodex.ce0a1f"), cursor: pomeLocaleRendererTaskInbox.t("copy.openCursor.4a1fe1"), claude: pomeLocaleRendererTaskInbox.t("copy.openTerminal.b89a0e"), grok: pomeLocaleRendererTaskInbox.t("copy.openTerminal.b89a0e"), copilot: pomeLocaleRendererTaskInbox.t('copy.openTerminal.b89a0e'), antigravity: pomeLocaleRendererTaskInbox.t('sources.openProvider', { source: 'Antigravity' }) }[source] || pomeLocaleRendererTaskInbox.t("copy.sourceAppUnavailable.a2e5df"); }
  async function openRecord(row) {
    if (!row || opening) return;
    opening = true;
    const launch = Promise.resolve().then(() => api.openTaskSource(row.id))
      .catch(() => ({ ok: false, message: pomeLocaleRendererTaskInbox.t("copy.couldnTOpenTheSourceAppTry.180b9d") }));
    let readFailed = false;
    try {
      const read = await api.markTaskRead(row.id);
      if (!read?.ok) throw new Error('read_failed');
      await refresh();
    } catch { readFailed = true; }
    try {
      const result = await launch;
      pomeLocaleRendererTaskInbox.bind(status, "textContent", () => (result.message || pomeLocaleRendererTaskInbox.t("copy.couldnTOpenTheSourceAppTry.180b9d")));
      if (readFailed) status.textContent += pomeLocaleRendererTaskInbox.t("copy.couldnTSaveTheReadStatusTry.44df73");
      if (!result.ok || readFailed) window.showStatusToast?.(status.textContent);
    } finally { opening = false; }
  }
  function changePage(delta) {
    if (failure) return;
    const paging = window.NotchTaskInboxDomain.pagination(total, page, pageSizeForWidget());
    if (delta < 0 ? !paging.previous : !paging.next) return;
    page += delta; resetScroll = true; void refresh();
  }
  latest.addEventListener('click', () => void openRecord(rows[0]));
  async function refresh() {
    if (!api?.getTaskInbox) return;
    if (busy || editing) { queued = true; return; }
    busy = true;
    const pageSize = pageSizeForWidget();
    const requestedPage = page;
    const generation = failureGeneration;
    try {
      let state = await api.getTaskInbox({offset:requestedPage * pageSize,limit:pageSize});
      if (state.ok === false) { showFailure(state); return; }
      if (generation !== failureGeneration) { queued = true; return; }
      if (requestedPage !== page || pageSize !== pageSizeForWidget()) { queued = true; return; }
      if (page > 0 && page * pageSize >= state.total) {
        page = Math.max(0,Math.ceil(state.total / pageSize)-1);
        const clampedPage = page;
        state = await api.getTaskInbox({offset:page * pageSize,limit:pageSize});
        if (state.ok === false) { showFailure(state); return; }
        if (generation !== failureGeneration || clampedPage !== page || pageSize !== pageSizeForWidget()) { queued = true; return; }
        resetScroll = true;
      }
      failure = null; delete tile.dataset.error; rebuild.hidden = true;
      rows = state.items; total = state.total; unread = state.unread;
      status.textContent = ''; status.title = ''; paint();
      if (resetScroll) { list.scrollTop = 0; resetScroll = false; }
    } catch (error) { showFailure(error); }
    finally { busy = false; if (queued) { queued = false; void refresh(); } }
  }
  readAll.addEventListener('click', async () => {
    if (editing || failure) return;
    editing = true; updateBadge(); const cutoff = Date.now(); let readError = false;
    try {
      // Capture IDs before marking; newly received events remain unread.
      const ids = new Set(); let offset = 0;
      while (true) {
        const state = await api.getTaskInbox({offset,limit:100});
        if (state.ok === false) { showFailure(state); return; }
        for (const row of state.items) if (row.readAt === null && row.receivedAt <= cutoff) ids.add(row.id);
        if (!state.hasMore) break;
        offset += state.items.length;
        if (!state.items.length) throw new Error('inbox_pagination_stalled');
      }
      for (const id of ids) { const result = await api.markTaskRead(id); if (!result?.ok) throw new Error('read_failed'); }
    } catch { readError = true; }
    finally { editing = false; await refresh(); if (readError && !failure) pomeLocaleRendererTaskInbox.bind(status, "textContent", () => (pomeLocaleRendererTaskInbox.t("copy.someRecordsCouldNotBeMarkedAs.b1a2a8"))); }
  });
  rebuild.addEventListener('click', async () => {
    rebuild.disabled = true;
    try {
      const result = await api.rebuildTaskInbox();
      if (result.ok) { page = 0; resetScroll = true; await refresh(); pomeLocaleRendererTaskInbox.bind(status, "textContent", () => (pomeLocaleRendererTaskInbox.t("copy.inboxRebuiltOriginalFileBackedUpTo.c4a104", { arg1: (result.backupPath) }))); }
      else if (!result.canceled) pomeLocaleRendererTaskInbox.bind(status, "textContent", () => (result.message || pomeLocaleRendererTaskInbox.t("copy.rebuildFailedOrTheFileChangedReload.eb2a0a")));
    } catch { pomeLocaleRendererTaskInbox.bind(status, "textContent", () => (pomeLocaleRendererTaskInbox.t("copy.rebuildFailedRetryTheOriginalFileWas.1278b7"))); }
    finally { rebuild.disabled = false; }
  });
  badge.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (tile.hidden || window.NotchHome?.isVisible('inbox') === false) {
      await setActiveTab('settings');
      const input = document.querySelector('[data-settings-home-module="inbox"]');
      input?.closest('.settings-home-modules-card')?.scrollIntoView({block:'center'}); input?.focus({preventScroll:true});
      window.showStatusToast?.(pomeLocaleRendererTaskInbox.t("copy.aiActivityIsnTVisibleEnableIt.a4876a")); return;
    }
    await setActiveTab('home'); tile.scrollIntoView({block:'nearest'});
    clearTimeout(highlightTimer); tile.classList.add('inbox-highlight');
    highlightTimer = setTimeout(() => tile.classList.remove('inbox-highlight'),1200);
  });
  document.addEventListener('notch:tabchange', () => { updateBadge(); void refresh(); });
  document.addEventListener('notch:home-modules-changed', updateBadge);
  document.addEventListener('notch:home-layout-applied', paint);
  document.addEventListener('notch:ai-sources-changed', paint);
  let lastWidgetSize = tile.dataset.widgetSize;
  new MutationObserver(() => {
    if (tile.dataset.widgetSize === lastWidgetSize) return;
    lastWidgetSize = tile.dataset.widgetSize;
    page = 0; resetScroll = true; paintSignature = ''; void refresh();
  }).observe(tile,{attributes:true,attributeFilter:['data-widget-size']});
  api?.onTaskInboxError?.(error => {
    if (error.error === 'event_rejected') { status.textContent = error.message; window.showStatusToast?.(error.message); return; }
    showFailure(error); window.showStatusToast?.(failure.recoverable ? pomeLocaleRendererTaskInbox.t("copy.theInboxIsDamagedBackItUp.c1d086") : pomeLocaleRendererTaskInbox.t("copy.couldnTReadTheInboxReceivingIs.2db66f"));
  });
  api?.onTaskCompletion?.(() => void refresh());
  api?.onTaskInboxChanged?.(() => void refresh());
  setInterval(() => { if (!tile.hidden && document.querySelector('.tab.active')?.dataset.tab === 'home' && document.getElementById('app').classList.contains('expanded')) paint(); },60000);
  requestAnimationFrame(positionIndicator);
  window.addEventListener('pome:language-changed', () => { paintSignature = ''; paint(); });
  window.NotchTaskInbox = Object.freeze({refresh});
  void refresh();
})();
