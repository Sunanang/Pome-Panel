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
  const sources = {
    codex: { label: 'Codex', icon: 'assets/inbox/codex.svg' },
    claude: { label: 'Claude', icon: 'assets/inbox/claude.svg' },
    cursor: { label: 'Cursor', icon: 'assets/inbox/cursor.svg' },
  };
  const statusLabels = { completed: '已完成', failed: '出错', awaiting: '等待确认', due: '即将截止' };
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
    if (elapsed < 60000) return '刚刚';
    if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`;
    if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`;
    if (elapsed < 7 * 86400000) return `${Math.floor(elapsed / 86400000)} 天前`;
    return new Date(at).toLocaleDateString('zh-CN');
  }
  function updateBadge() {
    const moduleHidden = tile.hidden || window.NotchHome?.isVisible('inbox') === false;
    badge.hidden = homeTab.classList.contains('active') || (!failure && unread === 0);
    badge.dataset.dot = String(moduleHidden);
    badge.textContent = moduleHidden ? '' : failure ? '!' : unread > 9 ? '9+' : String(unread);
    badge.dataset.error = String(Boolean(failure));
    badge.title = moduleHidden ? 'AI 完成模块已关闭，点击前往设置' : failure ? 'AI 完成收件箱异常，点击查看' : `${unread} 条 AI 完成记录待查看`;
    homeTab.setAttribute('aria-label', failure ? '首页，AI 完成收件箱异常' : unread ? `首页，${unread} 条 AI 完成记录未读` : '首页');
    document.getElementById('home-inbox-unread').textContent = String(unread);
    unreadLabel.textContent = failure ? '接收已暂停' : unread ? `${unread} 条未读` : total === 0 && tile.dataset.sourceState === 'waiting' ? '监听中' : '';
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
    status.textContent = (failure.recoverable
      ? '收件箱文件损坏，接收已暂停。可备份损坏文件并重建。'
      : '收件箱暂时无法读取，接收已暂停。请稍后重试。')
      + (failure.recoverable ? ` 原文件：${String(failure.filePath || '').split(/[\\/]/).at(-1)}。原有记录可能无法恢复。` : '');
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
    heading.textContent = !sourceState.ready ? '正在检查接入状态…' : invalid.length ? `${invalid.map(row => row.label).join('、')} 接入失效，点此修复` : suggestion ? `检测到 ${suggestion.label}，是否接入？` : connected.length ? `已接入 ${connected.map(row => row.label).join('、')}，等待第一条完成记录` : '尚未接入任何 AI 工具';
    if (size !== 'mini') {
      const icons = document.createElement('div'); icons.className = 'home-inbox-empty-icons';
      for (const row of invalid.length ? invalid : suggestion ? [suggestion] : connected.length ? connected : sourceState.sources) {
        const icon = document.createElement('img'); icon.src = sources[row.source]?.icon; icon.alt = row.label; icons.append(icon);
      }
      empty.append(icons);
    }
    empty.append(heading);
    const details = document.createElement('p');
    details.textContent = invalid.length ? invalid[0].message : suggestion ? '先预览将修改的配置，确认后备份并接入。' : connected.length ? '在工具里完成一次任务，或发送测试验证接入。' : '接入后完成记录会出现在这里。';
    if (size !== 'mini') empty.append(details);
    const actions = document.createElement('div'); actions.className = 'home-inbox-empty-actions';
    const primary = size === 'mini' ? '' : 'workspace-button compact home-inbox-onboard-primary';
    if (invalid.length) actions.append(button('修复', event => invalid[0].repairable ? window.NotchAiSources?.request(invalid[0].source, 'repair', event.currentTarget) : window.NotchAiSources?.openSettings(invalid[0].source), primary));
    else if (suggestion) actions.append(button('接入', event => window.NotchAiSources?.request(suggestion.source, 'connect', event.currentTarget), primary), button('以后再说', () => window.NotchAiSources?.dismiss(suggestion.source)));
    else if (connected.length) actions.append(button('发送测试', () => void window.NotchAiSources?.test(connected[0].source)), button('管理来源', () => window.NotchAiSources?.openSettings()));
    else actions.append(button('去接入 ›', () => window.NotchAiSources?.openSettings(), primary));
    empty.append(actions); list.append(empty);
    if (state === 'waiting') unreadLabel.textContent = '监听中';
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
      text.textContent = `检测到 ${suggestion.label}，是否接入？`;
      sourceSuggestion.append(text, button('接入', event => window.NotchAiSources?.request(suggestion.source, 'connect', event.currentTarget)), button('以后再说', () => window.NotchAiSources?.dismiss(suggestion.source)));
      if (size === 'mini') mini.hidden = true;
    }
    latest.textContent = rows[0] ? `${sources[rows[0].source]?.label || '其他'}${recordStatus(rows[0]) !== 'completed' ? ` · ${statusLabels[recordStatus(rows[0])]}` : ''} · ${relativeTime(rows[0].receivedAt)}` : '';
    latest.title = [openLabel(rows[0]?.source), statusLabels[recordStatus(rows[0])], rows[0]?.completionSummary || rows[0]?.title].filter(Boolean).join(' · ');
    delete tile.dataset.sourceState;
    if (!total) {
      paintEmpty(size, sourceState);
    } else if (size !== 'mini') {
      for (const row of visible) {
        const source = sources[row.source] || {label:'其他',icon:'assets/inbox/openai.svg'};
        const item = document.createElement('div'); item.className = 'home-inbox-item';
        const rowButton = button('', () => void openRecord(row), 'home-inbox-row');
        rowButton.dataset.id = row.id; rowButton.dataset.status = recordStatus(row); rowButton.dataset.unread = String(row.readAt === null);
        rowButton.title = openLabel(row.source);
        rowButton.setAttribute('aria-label', `${source.label}，${statusLabels[recordStatus(row)]}：${row.title || '任务已完成'}，${relativeTime(row.receivedAt)}${row.readAt === null ? '，未读' : ''}`);
        const iconWrap = document.createElement('span'); iconWrap.className = 'home-inbox-source-wrap'; iconWrap.dataset.source = sources[row.source] ? row.source : 'other';
        const icon = document.createElement('img'); icon.src = source.icon; icon.alt = ''; icon.className = 'home-inbox-source'; icon.dataset.source = iconWrap.dataset.source;
        const copy = document.createElement('span'); copy.className = 'home-inbox-copy';
        const title = document.createElement('strong'); title.textContent = row.title || '任务已完成'; title.title = [row.sessionTitle, row.completionSummary || row.title].filter(Boolean).join('\n'); copy.append(title);
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
      if (paging.previous) pagination.append(button('上一页', () => changePage(-1)));
      if (paging.label) { const label = document.createElement('span'); label.textContent = paging.label; pagination.append(label); }
      if (paging.next) { const next = button('下一页', () => changePage(1), 'home-inbox-next'); pagination.append(next); }
    }
    updateBadge();
    if (activeId) list.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.focus({preventScroll:true});
  }
  function openLabel(source) { return { codex: '打开 Codex', cursor: '打开 Cursor', claude: '打开终端' }[source] || '来源软件不可用'; }
  async function openRecord(row) {
    if (!row || opening) return;
    opening = true;
    const launch = Promise.resolve().then(() => api.openTaskSource(row.id))
      .catch(() => ({ ok: false, message: '打开来源软件失败，请稍后重试。' }));
    let readFailed = false;
    try {
      const read = await api.markTaskRead(row.id);
      if (!read?.ok) throw new Error('read_failed');
      await refresh();
    } catch { readFailed = true; }
    try {
      const result = await launch;
      status.textContent = result.message || '打开来源软件失败，请稍后重试。';
      if (readFailed) status.textContent += ' 已读状态保存失败，请稍后重试。';
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
    finally { editing = false; await refresh(); if (readError && !failure) status.textContent = '部分记录未能标为已读，请重试。'; }
  });
  rebuild.addEventListener('click', async () => {
    rebuild.disabled = true;
    try {
      const result = await api.rebuildTaskInbox();
      if (result.ok) { page = 0; resetScroll = true; await refresh(); status.textContent = `已重建，原文件备份：${result.backupPath}`; }
      else if (!result.canceled) status.textContent = result.message || '重建失败或文件已变化，请重新读取。';
    } catch { status.textContent = '重建失败，请重试；原文件未静默清空。'; }
    finally { rebuild.disabled = false; }
  });
  badge.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (tile.hidden || window.NotchHome?.isVisible('inbox') === false) {
      await setActiveTab('settings');
      const input = document.querySelector('[data-settings-home-module="inbox"]');
      input?.closest('.settings-home-modules-card')?.scrollIntoView({block:'center'}); input?.focus({preventScroll:true});
      window.showStatusToast?.('AI 完成模块未显示，请在设置中开启或先调整首页布局。'); return;
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
    showFailure(error); window.showStatusToast?.(failure.recoverable ? '收件箱文件损坏，可在首页备份并重建。' : '收件箱读取失败，接收已暂停。');
  });
  api?.onTaskCompletion?.(() => void refresh());
  setInterval(() => { if (!tile.hidden && document.querySelector('.tab.active')?.dataset.tab === 'home' && document.getElementById('app').classList.contains('expanded')) paint(); },60000);
  requestAnimationFrame(positionIndicator);
  window.NotchTaskInbox = Object.freeze({refresh});
  void refresh();
})();
