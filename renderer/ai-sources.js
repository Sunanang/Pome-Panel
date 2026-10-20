const pomeLocaleRendererAiSources = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function initAiSources() {
  const api = window.notchAPI;
  const catalog = window.NotchAiProviders;
  if (!catalog) return;
  const labels = catalog.labels();
  const icons = Object.fromEntries(catalog.providers.map((row) => [row.id, row.icon]));
  const states = { get undetected() { return pomeLocaleRendererAiSources.t("copy.notDetected.156219"); }, get disconnected() { return pomeLocaleRendererAiSources.t("copy.notConnected.af33de"); }, get connected() { return pomeLocaleRendererAiSources.t("copy.connected.fa1876"); }, get error() { return pomeLocaleRendererAiSources.t("copy.configurationError.899d57"); }, get catalogOnly() { return pomeLocaleRendererAiSources.t("copy.quotaOnly.5d2e1f"); } };
  const list = document.getElementById('settings-ai-sources-list');
  const status = document.getElementById('ai-sources-status');
  const dialog = document.getElementById('ai-source-confirm');
  const tokenHost = document.getElementById('settings-ai-provider-tokens');
  const dismissKey = 'notch-ai-source-dismissed-v1';
  const restartSources = new Set();
  const TOKEN_PROVIDERS = new Set(['copilot', 'grok', 'antigravity', 'manus']);
  const restartMessage = source => source === 'claude'
    ? pomeLocaleRendererAiSources.t('sources.claudeRestart')
    : pomeLocaleRendererAiSources.t("copy.configurationSavedQuitCompletelyThenReopenIt.507666", { arg1: labels[source] });
  let hookRows = [];
  let ready = false, busy = false, plan = null, anchor = null, checkedAt = 0;
  let dismissed = [];
  try { const value = JSON.parse(localStorage.getItem(dismissKey) || '[]'); if (Array.isArray(value)) dismissed = value; } catch {}
  const el = id => document.getElementById(id);
  function makeButton(text, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.className = 'workspace-button compact'; button.addEventListener('click', callback); return button;
  }
  function capabilityLabel(value) {
    return pomeLocaleRendererAiSources.t(`attention.capability.${value || 'unsupported'}`);
  }
  function ownershipText(row) {
    if (row.ownershipKey) {
      try { return pomeLocaleRendererAiSources.t(row.ownershipKey); } catch { /* fall through */ }
    }
    return row.ownership || '';
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
  function mergedRows() {
    const bySource = Object.fromEntries(hookRows.map((row) => [row.source, row]));
    return catalog.providers.map((provider) => {
      const hook = bySource[provider.id];
      if (hook) {
        return {
          ...hook,
          label: provider.label,
          ownership: ownershipText(provider),
          usageCapability: provider.capabilities.usage,
          completionCapability: hook.attentionCapabilities?.completion || provider.capabilities.completion,
          attentionCapability: hook.attentionCapabilities?.attention || provider.capabilities.attention,
          hookable: provider.hookable,
        };
      }
      return {
        source: provider.id,
        label: provider.label,
        state: 'catalogOnly',
        filePath: '',
        message: ownershipText(provider),
        ownership: ownershipText(provider),
        usageCapability: provider.capabilities.usage,
        completionCapability: provider.capabilities.completion,
        attentionCapability: provider.capabilities.attention,
        hookable: false,
        attentionCapabilities: {
          usage: provider.capabilities.usage,
          completion: provider.capabilities.completion,
          attention: provider.capabilities.attention,
          input: 'unsupported', select: 'unsupported', approve: 'unsupported', autoResolve: 'unsupported',
          surface: 'catalog', providerVersion: 'unverified',
        },
      };
    });
  }
  function renderTokenCards() {
    if (!tokenHost) return;
    tokenHost.replaceChildren();
    for (const id of TOKEN_PROVIDERS) {
      const provider = catalog.get(id);
      if (!provider) continue;
      const section = document.createElement('section');
      section.className = 'settings-ai-provider';
      section.id = provider.settingsCard;
      section.innerHTML = `
        <div class="settings-card-heading">
          <div><span class="tile-label">${provider.label}</span><strong>${pomeLocaleRendererAiSources.t("copy.usageToken.ccb5d6")}</strong></div>
          <small id="settings-${id}-token-status" data-state="empty">${pomeLocaleRendererAiSources.t("copy.noManualTokenConfigured.a2ebce")}</small>
        </div>
        <p class="ai-source-ownership">${ownershipText(provider)}</p>
        <div class="settings-cursor-token-row">
          <input id="settings-${id}-token" type="password" autocomplete="off" spellcheck="false" placeholder="${pomeLocaleRendererAiSources.t("copy.pasteToken.8a1c2d", { arg1: provider.label })}" />
          <button class="workspace-button compact" type="button" data-provider-save="${id}">${pomeLocaleRendererAiSources.t("copy.save.a3030b")}</button>
          <button class="workspace-button compact" type="button" data-provider-clear="${id}">${pomeLocaleRendererAiSources.t("copy.clear.bce237")}</button>
        </div>
        ${id === 'grok' ? '<label class="settings-cursor-token-row"><span id="settings-grok-team-label"></span><input id="settings-grok-team" type="text" maxlength="128" autocomplete="off" spellcheck="false" /></label>' : ''}
        <p class="settings-cursor-token-hint" id="settings-${id}-token-hint" role="status" aria-live="polite"></p>`;
      tokenHost.append(section);
      const bindText = (node, key, params) => pomeLocaleRendererAiSources.bind(node, 'textContent', () => pomeLocaleRendererAiSources.t(key, params));
      bindText(section.querySelector('strong'), 'copy.usageToken.ccb5d6');
      pomeLocaleRendererAiSources.bind(section.querySelector('.ai-source-ownership'), 'textContent', () => ownershipText(provider));
      pomeLocaleRendererAiSources.bind(el(`settings-${id}-token`), 'placeholder', () => pomeLocaleRendererAiSources.t('copy.pasteToken.8a1c2d', { arg1: provider.label }));
      bindText(section.querySelector('[data-provider-save]'), 'copy.save.a3030b');
      bindText(section.querySelector('[data-provider-clear]'), 'copy.clear.bce237');
      if (id === 'grok') {
        bindText(el('settings-grok-team-label'), 'providers.teamId');
        el('settings-grok-team').addEventListener('input', event => { event.target.dataset.dirty = '1'; });
      }
    }
    tokenHost.querySelectorAll('[data-provider-save]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.getAttribute('data-provider-save');
        const input = el(`settings-${id}-token`);
        const hint = el(`settings-${id}-token-hint`);
        const token = input?.value || '';
        button.disabled = true;
        try {
          const result = await api?.setAiProviderToken?.(id, token, id === 'grok' ? { teamId: el('settings-grok-team').value } : undefined);
          const message = result?.ok === true ? 'copy.sourceConfigurationUpdated.3181cd' : result?.error === 'grok_team_required' ? 'providers.grokTeamRequired' : result?.error === 'token_required' ? 'providers.tokenRequired' : 'providers.tokenSaveFailed';
          pomeLocaleRendererAiSources.bind(hint, 'textContent', () => pomeLocaleRendererAiSources.t(message));
          if (result?.ok !== true) return;
          document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: result }));
          if (input?.value === token) input.value = '';
          await refreshTokenStatuses();
        } catch { pomeLocaleRendererAiSources.bind(hint, 'textContent', () => pomeLocaleRendererAiSources.t('providers.tokenSaveFailed')); }
        finally { button.disabled = false; }
      });
    });
    tokenHost.querySelectorAll('[data-provider-clear]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.getAttribute('data-provider-clear');
        button.disabled = true;
        try {
          const result = await api?.clearAiProviderToken?.(id);
          if (result?.ok !== true) throw new Error('clear_failed');
          if (id === 'grok') { el('settings-grok-team').value = ''; delete el('settings-grok-team').dataset.dirty; }
          if (el(`settings-${id}-token`)) el(`settings-${id}-token`).value = '';
          document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: result }));
          await refreshTokenStatuses();
        } catch { pomeLocaleRendererAiSources.bind(el(`settings-${id}-token-hint`) || el(`settings-${id}-token-status`), 'textContent', () => pomeLocaleRendererAiSources.t('providers.tokenSaveFailed')); }
        finally { button.disabled = false; }
      });
    });
  }
  async function refreshTokenStatuses() {
    for (const id of TOKEN_PROVIDERS) {
      const statusEl = el(`settings-${id}-token-status`);
      if (!statusEl || !api?.getAiProviderTokenStatus) continue;
      const result = await api.getAiProviderTokenStatus(id);
      pomeLocaleRendererAiSources.bind(statusEl, 'textContent', () => pomeLocaleRendererAiSources.t(result?.configured ? 'copy.manualTokenConfigured.4bb854' : 'copy.noManualTokenConfigured.a2ebce'));
      statusEl.dataset.state = result?.state || 'empty';
      if (id === 'grok' && !el('settings-grok-team').dataset.dirty) el('settings-grok-team').value = result?.teamId || '';
    }
  }
  function render() {
    list.replaceChildren();
    const rows = mergedRows();
    const hookable = rows.filter((row) => row.hookable);
    const connected = hookable.filter((row) => row.state === 'connected').length;
    pomeLocaleRendererAiSources.bind(el('settings-ai-sources-count'), "textContent", () => (
      pomeLocaleRendererAiSources.t("copy.localConnectedOf.9f3a1b", { arg1: connected, arg2: hookable.length })
    ));
    for (const row of rows) {
      const item = document.createElement('div'); item.className = 'ai-source-row'; item.dataset.source = row.source; item.dataset.state = row.state;
      const icon = document.createElement('img'); icon.src = icons[row.source] || 'assets/inbox/circle-alert.svg'; icon.alt = ''; icon.className = 'ai-source-icon';
      const copy = document.createElement('div'); copy.className = 'ai-source-copy';
      const heading = document.createElement('div'); const name = document.createElement('strong'); name.textContent = row.label;
      const state = document.createElement('span'); state.className = 'ai-source-state'; state.textContent = states[row.state] || row.state; heading.append(name, state);
      const file = document.createElement('small');
      pomeLocaleRendererAiSources.bind(file, "textContent", () => (row.filePath || row.message || pomeLocaleRendererAiSources.t("copy.waitingForDetection.f97f6a")));
      file.title = row.filePath || '';
      const ownership = document.createElement('small'); ownership.className = 'ai-source-ownership'; ownership.textContent = row.ownership || '';
      const matrix = document.createElement('div'); matrix.className = 'ai-source-matrix';
      for (const [key, value] of [
        ['completionLabel', row.completionCapability],
        ['usageLabel', row.usageCapability],
        ['attentionLabel', row.attentionCapability],
      ]) {
        const line = document.createElement('small');
        const labelKey = key === 'usageLabel' ? 'attention.usageLabel' : key === 'attentionLabel' ? 'attention.attentionLabel' : 'attention.completionLabel';
        line.textContent = `${pomeLocaleRendererAiSources.t(labelKey)} · ${capabilityLabel(value)}`;
        matrix.append(line);
      }
      copy.append(heading, file, ownership, matrix);
      if (row.state === 'connected' && row.attentionHookMissing) {
        const capability = document.createElement('small'); capability.className = 'ai-source-capability';
        capability.textContent = pomeLocaleRendererAiSources.t('attention.hooksMissing');
        copy.append(capability);
      }
      if (row.hookable && row.attentionCapabilities) {
        const details = document.createElement('details'); details.className = 'ai-source-capabilities';
        const summary = document.createElement('summary'); summary.textContent = pomeLocaleRendererAiSources.t('attention.capabilities'); details.append(summary);
        const detailLabels = { completion: 'completionLabel', input: 'input', select: 'choice', approve: 'authorization', autoResolve: 'autoResolveLabel' };
        for (const [key, label] of Object.entries(detailLabels)) {
          const line = document.createElement('small');
          line.textContent = `${pomeLocaleRendererAiSources.t(`attention.${label}`)} · ${capabilityLabel(row.attentionCapabilities[key])}`;
          details.append(line);
        }
        copy.append(details);
      }
      if (row.state === 'connected' && restartSources.has(row.source)) {
        const hint = document.createElement('small'); hint.className = 'ai-source-restart-hint';
        hint.textContent = restartMessage(row.source); copy.append(hint);
      }
      const actions = document.createElement('div'); actions.className = 'ai-source-actions';
      if (row.hookable) {
        if (row.state === 'connected') {
          if (row.attentionHookMissing) actions.append(makeButton(pomeLocaleRendererAiSources.t('attention.repairHooks'), event => void request(row.source, 'repair', event.currentTarget)));
          if (row.summaryHookMissing) actions.append(makeButton(pomeLocaleRendererAiSources.t("copy.addSummaries.29366e"), event => void request(row.source, 'repair', event.currentTarget)));
          actions.append(makeButton(pomeLocaleRendererAiSources.t("copy.sendTest.a49d32"), () => void test(row.source)), makeButton(pomeLocaleRendererAiSources.t("copy.disconnect.f33ac0"), event => void request(row.source, 'disconnect', event.currentTarget)));
        } else {
          const connect = makeButton(row.state === 'error' ? pomeLocaleRendererAiSources.t("copy.repair.37a693") : pomeLocaleRendererAiSources.t("copy.connect.bc38d3"), event => void request(row.source, row.state === 'error' ? 'repair' : 'connect', event.currentTarget));
          connect.disabled = busy || row.state === 'undetected' || (row.state === 'error' && !row.repairable);
          actions.append(connect);
        }
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
        hookRows = response.sources;
        for (const source of restartSources) {
          if (!hookRows.some(row => row.source === source && row.state === 'connected')) restartSources.delete(source);
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
  el('ai-source-confirm-cancel')?.addEventListener('click', () => { dialog.close(); plan = null; anchor?.focus({ preventScroll: true }); });
  dialog?.addEventListener('cancel', () => { plan = null; });
  el('ai-source-confirm-apply')?.addEventListener('click', async () => {
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
      const result = await api.testAiSource(source || hookRows.find(row => row.state === 'connected')?.source);
      status.textContent = result.message; window.showStatusToast?.(result.message);
      return result;
    } catch (error) { pomeLocaleRendererAiSources.bind(status, "textContent", () => (pomeLocaleRendererAiSources.t("copy.testNotificationFailed.e8440c", { arg1: (error.message) }))); window.showStatusToast?.(status.textContent); return { ok: false, message: status.textContent };
    } finally { busy = false; render(); }
  }
  document.addEventListener('notch:tabchange', event => {
    if (event.detail.tab === 'settings' || (event.detail.tab === 'home' && !modeBusy && Date.now() - checkedAt > 30000)) void refresh();
  });
  window.addEventListener('resize', () => { if (dialog?.open) positionConfirmation(); });
  window.addEventListener('pome:language-changed', render);
  api?.onAiProviderTokenChanged?.((status) => {
    document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: status }));
    void refreshTokenStatuses();
  });
  window.NotchAiSources = Object.freeze({ refresh, request, test, openSettings, dismiss, icons,
    getState: () => ({
      // Inbox empty-states only care about hookable completion sources.
      sources: hookRows.map((row) => ({ ...row })),
      providers: mergedRows().map((row) => ({ ...row })),
      ready,
      suggestion: hookRows.find((row) => row.state === 'disconnected' && !dismissed.includes(row.source)),
    }) });
  try {
    renderTokenCards();
    void refreshTokenStatuses();
  } catch (error) {
    console.error('ai-provider-token-cards', error);
  }
  void refresh();
})();
