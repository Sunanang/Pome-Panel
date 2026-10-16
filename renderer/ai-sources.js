(function initAiSources() {
  const api = window.notchAPI;
  const labels = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor' };
  const icons = { codex: 'assets/inbox/codex.svg', claude: 'assets/inbox/claude.svg', cursor: 'assets/inbox/cursor.svg' };
  const states = { undetected: '未检测到', disconnected: '未接入', connected: '已接入', error: '配置异常' };
  const list = document.getElementById('settings-ai-sources-list');
  const status = document.getElementById('ai-sources-status');
  const dialog = document.getElementById('ai-source-confirm');
  const dismissKey = 'notch-ai-source-dismissed-v1';
  const restartSources = new Set();
  const restartMessage = source => `已写入配置，请完全退出并重新打开 ${labels[source]} 后生效`;
  let sources = Object.keys(labels).map(source => ({ source, label: labels[source], state: 'undetected', filePath: '' }));
  let ready = false, busy = false, plan = null, anchor = null, checkedAt = 0;
  let dismissed = [];
  try { const value = JSON.parse(localStorage.getItem(dismissKey) || '[]'); if (Array.isArray(value)) dismissed = value; } catch {}
  const el = id => document.getElementById(id);
  function makeButton(text, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.className = 'workspace-button compact'; button.addEventListener('click', callback); return button;
  }
  function announce() {
    document.dispatchEvent(new CustomEvent('notch:ai-sources-changed'));
  }
  function dismiss(source) {
    if (!dismissed.includes(source)) dismissed.push(source);
    try { localStorage.setItem(dismissKey, JSON.stringify(dismissed)); } catch {}
    announce();
  }
  function openSettings(source) {
    void setActiveTab('settings').then(() => {
      el('settings-ai-sources').scrollIntoView({ block: 'center' });
      list.querySelector(`[data-source="${source || 'codex'}"] button`)?.focus({ preventScroll: true });
    });
  }
  function render() {
    list.replaceChildren();
    el('settings-ai-sources-count').textContent = `本机 · ${sources.filter(row => row.state === 'connected').length}/3 已接入`;
    for (const row of sources) {
      const item = document.createElement('div'); item.className = 'ai-source-row'; item.dataset.source = row.source; item.dataset.state = row.state;
      const icon = document.createElement('img'); icon.src = icons[row.source]; icon.alt = ''; icon.className = 'ai-source-icon';
      const copy = document.createElement('div'); copy.className = 'ai-source-copy';
      const heading = document.createElement('div'); const name = document.createElement('strong'); name.textContent = row.label;
      const state = document.createElement('span'); state.className = 'ai-source-state'; state.textContent = states[row.state]; heading.append(name, state);
      const file = document.createElement('small'); file.textContent = row.filePath || row.message || '等待检测'; file.title = row.filePath;
      const explanation = document.createElement('small'); explanation.textContent = row.message; explanation.title = row.message;
      copy.append(heading, file, explanation);
      if (row.state === 'connected' && restartSources.has(row.source)) {
        const hint = document.createElement('small'); hint.className = 'ai-source-restart-hint';
        hint.textContent = restartMessage(row.source); copy.append(hint);
      }
      const actions = document.createElement('div'); actions.className = 'ai-source-actions';
      if (row.state === 'connected') {
        if (row.summaryHookMissing) actions.append(makeButton('补全摘要', event => void request(row.source, 'repair', event.currentTarget)));
        actions.append(makeButton('发送测试', () => void test(row.source)), makeButton('断开', event => void request(row.source, 'disconnect', event.currentTarget)));
      } else {
        const connect = makeButton(row.state === 'error' ? '修复' : '一键接入', event => void request(row.source, row.state === 'error' ? 'repair' : 'connect', event.currentTarget));
        connect.disabled = busy || row.state === 'undetected' || (row.state === 'error' && !row.repairable);
        actions.append(connect);
      }
      item.append(icon, copy, actions); list.append(item);
    }
  }
  async function refresh() {
    if (busy) return;
    try {
      if (api?.getAiSources) {
        const response = await api.getAiSources();
        if (!response?.ok) throw new Error(response?.message || '接入状态读取失败');
        sources = response.sources;
        for (const source of restartSources) {
          if (!sources.some(row => row.source === source && row.state === 'connected')) restartSources.delete(source);
        }
      }
      ready = true; checkedAt = Date.now(); render(); announce();
    } catch (error) { status.textContent = `接入状态暂时无法读取：${error.message}`; }
  }
  function positionConfirmation() {
    const rect = anchor?.getBoundingClientRect() || el('settings-ai-sources').getBoundingClientRect();
    const width = Math.min(380, innerWidth - 24);
    dialog.style.width = `${width}px`;
    const height = Math.min(dialog.scrollHeight, innerHeight - 24);
    dialog.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.right - width))}px`;
    dialog.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, rect.top - height - 8))}px`;
  }
  async function request(source, action = 'connect', from = null) {
    if (busy || dialog.open || !api?.previewAiSource) return;
    busy = true;
    try {
      const result = await api.previewAiSource(source, action);
      if (!result?.ok) throw new Error(result?.message || '配置预览失败');
      plan = result.preview; anchor = from;
      el('ai-source-confirm-title').textContent = `${action === 'disconnect' ? '断开' : action === 'repair' ? '修复' : '接入'} ${labels[source]}？`;
      el('ai-source-confirm-file').textContent = plan.filePath;
      el('ai-source-confirm-content').textContent = plan.added;
      el('ai-source-confirm-backup').textContent = plan.backupPath;
      el('ai-source-confirm-note').textContent = `只修改 Pome 的项，其他配置保留。${plan.message}`;
      el('ai-source-confirm-apply').textContent = action === 'disconnect' ? '备份并断开' : action === 'repair' ? '备份并修复' : '备份并接入';
      dialog.showModal(); positionConfirmation();
    } catch (error) { status.textContent = error.message; window.showStatusToast?.(error.message); }
    finally { busy = false; }
  }
  el('ai-source-confirm-cancel').addEventListener('click', () => { dialog.close(); plan = null; anchor?.focus({ preventScroll: true }); });
  dialog.addEventListener('cancel', () => { plan = null; });
  el('ai-source-confirm-apply').addEventListener('click', async () => {
    if (!plan || busy) return;
    busy = true; el('ai-source-confirm-apply').disabled = true;
    try {
      const result = await api.applyAiSource(plan.token);
      if (!result.ok) throw new Error(result.message || '配置更新失败');
      const needsRestart = plan.action !== 'disconnect' && !plan.unchanged;
      if (needsRestart) restartSources.add(plan.source);
      else if (plan.action === 'disconnect') restartSources.delete(plan.source);
      const message = needsRestart ? restartMessage(plan.source) : plan.unchanged ? '配置无需修改' : '来源配置已更新';
      dismiss(plan.source); status.textContent = `${message}${result.backupPath ? `；备份：${result.backupPath}` : ''}`;
      dialog.close(); plan = null; window.showStatusToast?.(message);
    } catch (error) { dialog.close(); plan = null; status.textContent = error.message; window.showStatusToast?.(error.message); }
    finally { busy = false; el('ai-source-confirm-apply').disabled = false; await refresh(); }
  });
  async function test(source) {
    if (busy || !api?.testAiSource) return;
    busy = true; render();
    try {
      const result = await api.testAiSource(source || sources.find(row => row.state === 'connected')?.source);
      status.textContent = result.message; window.showStatusToast?.(result.message);
      return result;
    } catch (error) { status.textContent = `测试通知失败：${error.message}`; window.showStatusToast?.(status.textContent); return { ok: false, message: status.textContent };
    } finally { busy = false; render(); }
  }
  document.addEventListener('notch:tabchange', event => {
    if (event.detail.tab === 'settings' || (event.detail.tab === 'home' && !modeBusy && Date.now() - checkedAt > 30000)) void refresh();
  });
  window.addEventListener('resize', () => { if (dialog.open) positionConfirmation(); });
  window.NotchAiSources = Object.freeze({ refresh, request, test, openSettings, dismiss, icons,
    getState: () => ({ sources: sources.map(row => ({ ...row })), ready, suggestion: sources.find(row => row.state === 'disconnected' && !dismissed.includes(row.source)) }) });
  void refresh();
})();
