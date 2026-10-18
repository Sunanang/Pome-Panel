const pomeLocaleRendererAiSources = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function initAiSources() {
  const api = window.notchAPI;
  const labels = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor' };
  const icons = { codex: 'assets/inbox/codex.svg', claude: 'assets/inbox/claude.svg', cursor: 'assets/inbox/cursor.svg' };
  const states = { get undetected() { return pomeLocaleRendererAiSources.t("copy.notDetected.156219"); }, get disconnected() { return pomeLocaleRendererAiSources.t("copy.notConnected.af33de"); }, get connected() { return pomeLocaleRendererAiSources.t("copy.connected.fa1876"); }, get error() { return pomeLocaleRendererAiSources.t("copy.configurationError.899d57"); } };
  const list = document.getElementById('settings-ai-sources-list');
  const status = document.getElementById('ai-sources-status');
  const dialog = document.getElementById('ai-source-confirm');
  const dismissKey = 'notch-ai-source-dismissed-v1';
  const restartSources = new Set();
  const restartMessage = source => source === 'claude'
    ? pomeLocaleRendererAiSources.t('sources.claudeRestart')
    : pomeLocaleRendererAiSources.t("copy.configurationSavedQuitCompletelyThenReopenIt.507666", { arg1: labels[source] });
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
    pomeLocaleRendererAiSources.bind(el('settings-ai-sources-count'), "textContent", () => (pomeLocaleRendererAiSources.t("copy.local3Connected.3ecd96", { arg1: (sources.filter(row => row.state === 'connected').length) })));
    for (const row of sources) {
      const item = document.createElement('div'); item.className = 'ai-source-row'; item.dataset.source = row.source; item.dataset.state = row.state;
      const icon = document.createElement('img'); icon.src = icons[row.source]; icon.alt = ''; icon.className = 'ai-source-icon';
      const copy = document.createElement('div'); copy.className = 'ai-source-copy';
      const heading = document.createElement('div'); const name = document.createElement('strong'); name.textContent = row.label;
      const state = document.createElement('span'); state.className = 'ai-source-state'; state.textContent = states[row.state]; heading.append(name, state);
      const file = document.createElement('small'); pomeLocaleRendererAiSources.bind(file, "textContent", () => (row.filePath || row.message || pomeLocaleRendererAiSources.t("copy.waitingForDetection.f97f6a"))); file.title = row.filePath;
      const explanation = document.createElement('small'); explanation.textContent = pomeLocaleRendererAiSources.systemText(row.message); explanation.title = row.message;
      copy.append(heading, file, explanation);
      if (row.state === 'connected') {
        const capability = document.createElement('small'); capability.className = 'ai-source-capability';
        capability.textContent = pomeLocaleRendererAiSources.t(row.attentionHookMissing ? 'attention.hooksMissing' : row.source === 'claude' ? 'attention.partialClaude' : 'attention.unsupported');
        capability.title = capability.textContent;
        copy.append(capability);
      }
      if (row.attentionCapabilities) {
        const details = document.createElement('details'); details.className = 'ai-source-capabilities';
        const summary = document.createElement('summary'); summary.textContent = pomeLocaleRendererAiSources.t('attention.capabilities'); details.append(summary);
        const labels = { completion: 'completionLabel', input: 'input', select: 'choice', approve: 'authorization', autoResolve: 'autoResolveLabel' };
        for (const [key, label] of Object.entries(labels)) {
          const line = document.createElement('small');
          line.textContent = `${pomeLocaleRendererAiSources.t(`attention.${label}`)} · ${pomeLocaleRendererAiSources.t(`attention.capability.${row.attentionCapabilities[key] || 'unsupported'}`)}`;
          details.append(line);
        }
        const surface = document.createElement('small'); surface.textContent = `${row.attentionCapabilities.surface} · ${pomeLocaleRendererAiSources.t('attention.versionUnverified')}`; details.append(surface);
        copy.append(details);
      }
      if (row.state === 'connected' && restartSources.has(row.source)) {
        const hint = document.createElement('small'); hint.className = 'ai-source-restart-hint';
        hint.textContent = restartMessage(row.source); copy.append(hint);
      }
      const actions = document.createElement('div'); actions.className = 'ai-source-actions';
      if (row.state === 'connected') {
        if (row.attentionHookMissing) actions.append(makeButton(pomeLocaleRendererAiSources.t('attention.repairHooks'), event => void request(row.source, 'repair', event.currentTarget)));
        if (row.summaryHookMissing) actions.append(makeButton(pomeLocaleRendererAiSources.t("copy.addSummaries.29366e"), event => void request(row.source, 'repair', event.currentTarget)));
        actions.append(makeButton(pomeLocaleRendererAiSources.t("copy.sendTest.a49d32"), () => void test(row.source)), makeButton(pomeLocaleRendererAiSources.t("copy.disconnect.f33ac0"), event => void request(row.source, 'disconnect', event.currentTarget)));
      } else {
        const connect = makeButton(row.state === 'error' ? pomeLocaleRendererAiSources.t("copy.repair.37a693") : pomeLocaleRendererAiSources.t("copy.connect.bc38d3"), event => void request(row.source, row.state === 'error' ? 'repair' : 'connect', event.currentTarget));
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
        if (!response?.ok) throw new Error(response?.message || pomeLocaleRendererAiSources.t("copy.couldnTReadConnectionStatus.9412ff"));
        sources = response.sources;
        for (const source of restartSources) {
          if (!sources.some(row => row.source === source && row.state === 'connected')) restartSources.delete(source);
        }
      }
      ready = true; checkedAt = Date.now(); render(); announce();
    } catch (error) { pomeLocaleRendererAiSources.bind(status, "textContent", () => (pomeLocaleRendererAiSources.t("copy.connectionStatusIsUnavailable.8cc048", { arg1: (error.message) }))); }
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
      if (!result?.ok) throw new Error(result?.message || pomeLocaleRendererAiSources.t("copy.couldnTPreviewConfiguration.6158dd"));
      plan = result.preview; anchor = from;
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-title'), "textContent", () => (`${action === 'disconnect' ? pomeLocaleRendererAiSources.t("copy.disconnect.f33ac0") : action === 'repair' ? pomeLocaleRendererAiSources.t("copy.repair.37a693") : pomeLocaleRendererAiSources.t("copy.connect.f3b392")} ${labels[source]}？`));
      el('ai-source-confirm-file').textContent = plan.filePath;
      el('ai-source-confirm-content').textContent = plan.added;
      el('ai-source-confirm-backup').textContent = plan.backupPath;
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-note'), "textContent", () => (pomeLocaleRendererAiSources.t("copy.onlyPomeEntriesWillChangeOtherConfiguration.336c05", { arg1: (plan.message) })));
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-apply'), "textContent", () => (action === 'disconnect' ? pomeLocaleRendererAiSources.t("copy.backUpAndDisconnect.6abb4a") : action === 'repair' ? pomeLocaleRendererAiSources.t("copy.backUpAndRepair.9b2ea1") : pomeLocaleRendererAiSources.t("copy.backUpAndConnect.bda493")));
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
      if (!result.ok) throw new Error(result.message || pomeLocaleRendererAiSources.t("copy.couldnTUpdateConfiguration.73ac0d"));
      const needsRestart = plan.action !== 'disconnect' && !plan.unchanged;
      if (needsRestart) restartSources.add(plan.source);
      else if (plan.action === 'disconnect') restartSources.delete(plan.source);
      const message = needsRestart ? restartMessage(plan.source) : plan.unchanged ? pomeLocaleRendererAiSources.t("copy.noConfigurationChangesNeeded.300b3f") : pomeLocaleRendererAiSources.t("copy.sourceConfigurationUpdated.3181cd");
      dismiss(plan.source); pomeLocaleRendererAiSources.bind(status, "textContent", () => (`${message}${result.backupPath ? pomeLocaleRendererAiSources.t("copy.backup.9297fd", { arg1: (result.backupPath) }) : ''}`));
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
    } catch (error) { pomeLocaleRendererAiSources.bind(status, "textContent", () => (pomeLocaleRendererAiSources.t("copy.testNotificationFailed.e8440c", { arg1: (error.message) }))); window.showStatusToast?.(status.textContent); return { ok: false, message: status.textContent };
    } finally { busy = false; render(); }
  }
  document.addEventListener('notch:tabchange', event => {
    if (event.detail.tab === 'settings' || (event.detail.tab === 'home' && !modeBusy && Date.now() - checkedAt > 30000)) void refresh();
  });
  window.addEventListener('resize', () => { if (dialog.open) positionConfirmation(); });
  window.addEventListener('pome:language-changed', render);
  window.NotchAiSources = Object.freeze({ refresh, request, test, openSettings, dismiss, icons,
    getState: () => ({ sources: sources.map(row => ({ ...row })), ready, suggestion: sources.find(row => row.state === 'disconnected' && !dismissed.includes(row.source)) }) });
  void refresh();
})();
