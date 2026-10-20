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
  let manusListener = null;
  let ready = false, busy = false, plan = null, anchor = null, checkedAt = 0;
  let dismissed = [];
  try { const value = JSON.parse(localStorage.getItem(dismissKey) || '[]'); if (Array.isArray(value)) dismissed = value; } catch {}
  const el = id => document.getElementById(id);
  function makeButton(text, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.className = 'workspace-button compact'; button.addEventListener('click', callback); return button;
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
  function compactPath(filePath) {
    if (!filePath) return '';
    return String(filePath)
      .replace(/^\/Users\/[^/]+/i, '~')
      .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~')
      // Fold remaining prefixes before known tool config directories (incl. test HOME under /tmp).
      .replace(/^.*?(?=[\\/]\.(?:cursor|codex|claude|config)(?:[\\/]|$))/i, '~');
  }
  function openSettings(source) {
    void setActiveTab('settings').then(() => {
      const row = list.querySelector(`[data-source="${source || 'codex'}"]`);
      const target = source ? row : el('settings-ai-sources');
      target?.scrollIntoView({ block: source ? 'center' : 'start' });
      const focusRow = source ? row : list.querySelector('[data-source="codex"]') || row;
      const input = focusRow?.querySelector('input[type="password"], input:not([type="checkbox"])');
      (input || focusRow?.querySelector('.ai-source-actions button') || focusRow?.querySelector('button'))
        ?.focus({ preventScroll: true });
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
      const manusConnected = provider.id === 'manus' && manusListener?.enabled
        && ['listening', 'preparing'].includes(manusListener.connectionState);
      return {
        source: provider.id,
        label: provider.label,
        state: manusConnected ? 'connected' : provider.id === 'manus' && manusListener?.enabled ? 'error' : 'catalogOnly',
        filePath: '',
        message: ownershipText(provider),
        ownership: ownershipText(provider),
        usageCapability: provider.capabilities.usage,
        completionCapability: manusConnected ? 'partial' : provider.capabilities.completion,
        attentionCapability: provider.capabilities.attention,
        hookable: false,
        apiConnected: manusConnected,
        attentionCapabilities: {
          usage: provider.capabilities.usage,
          completion: manusConnected ? 'partial' : provider.capabilities.completion,
          attention: provider.capabilities.attention,
          input: 'unsupported', select: 'unsupported', approve: 'unsupported', autoResolve: 'unsupported',
          surface: provider.surface || 'catalog', providerVersion: 'unverified',
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
      section.className = 'ai-source-token';
      section.id = provider.settingsCard;
      section.innerHTML = `
        <div class="settings-cursor-token-row">
          <input id="settings-${id}-token" type="password" autocomplete="off" spellcheck="false" placeholder="${pomeLocaleRendererAiSources.t("copy.pasteToken.8a1c2d", { arg1: provider.label })}" aria-label="${provider.label} Token" />
          <button class="workspace-button compact" type="button" data-provider-save="${id}">${pomeLocaleRendererAiSources.t("copy.save.a3030b")}</button>
          <button class="workspace-button compact" type="button" data-provider-clear="${id}">${pomeLocaleRendererAiSources.t("copy.clear.bce237")}</button>
          <small id="settings-${id}-token-status" data-state="empty">${pomeLocaleRendererAiSources.t("copy.noManualTokenConfigured.a2ebce")}</small>
        </div>
        ${id === 'grok' ? '<label class="settings-cursor-token-row"><span id="settings-grok-team-label"></span><input id="settings-grok-team" type="text" maxlength="128" autocomplete="off" spellcheck="false" /></label>' : ''}
        ${id === 'manus' ? `
          <p class="settings-cursor-token-hint" id="settings-manus-completion-hint"></p>
          <label class="settings-nas-http-toggle">
            <span><b id="settings-manus-completion-label"></b></span>
            <input id="settings-manus-completion-enabled" type="checkbox" />
            <i aria-hidden="true"></i>
          </label>
          <p class="settings-cursor-token-hint" id="settings-manus-completion-status" role="status" aria-live="polite"></p>
          <div class="settings-cursor-token-row">
            <button class="workspace-button compact" type="button" id="settings-manus-completion-check"></button>
            <button class="workspace-button compact" type="button" id="settings-manus-completion-preview"></button>
          </div>
        ` : ''}
        <p class="settings-cursor-token-hint" id="settings-${id}-token-hint" role="status" aria-live="polite"></p>`;
      tokenHost.append(section);
      const bindText = (node, key, params) => pomeLocaleRendererAiSources.bind(node, 'textContent', () => pomeLocaleRendererAiSources.t(key, params));
      pomeLocaleRendererAiSources.bind(el(`settings-${id}-token`), 'placeholder', () => pomeLocaleRendererAiSources.t('copy.pasteToken.8a1c2d', { arg1: provider.label }));
      bindText(section.querySelector('[data-provider-save]'), 'copy.save.a3030b');
      bindText(section.querySelector('[data-provider-clear]'), 'copy.clear.bce237');
      if (id === 'grok') {
        bindText(el('settings-grok-team-label'), 'providers.teamId');
        el('settings-grok-team').addEventListener('input', event => { event.target.dataset.dirty = '1'; });
      }
      if (id === 'manus') {
        bindText(el('settings-manus-completion-hint'), 'providers.manus.completionHint');
        bindText(el('settings-manus-completion-label'), 'providers.manus.completionToggle');
        bindText(el('settings-manus-completion-check'), 'providers.manus.check');
        bindText(el('settings-manus-completion-preview'), 'providers.manus.preview');
        el('settings-manus-completion-enabled')?.addEventListener('change', async (event) => {
          const checked = event.target.checked === true;
          event.target.disabled = true;
          try {
            const result = await api?.setManusCompletionEnabled?.(checked);
            if (result?.ok !== true) event.target.checked = !checked;
            await refreshManusCompletionStatus();
            if (result?.ok !== true && !result?.superseded) {
              const key = result?.error === 'manus_token_missing' ? 'providers.tokenRequired'
                : result?.error === 'manus_unauthenticated' ? 'providers.manus.authInvalid'
                  : result?.error === 'manus_permission_denied' ? 'providers.manus.permissionDenied' : 'providers.manus.networkError';
              pomeLocaleRendererAiSources.bind(el('settings-manus-completion-status'), 'textContent', () => pomeLocaleRendererAiSources.t(key));
            }
          } catch {
            event.target.checked = !checked;
          } finally { event.target.disabled = false; }
        });
        el('settings-manus-completion-check')?.addEventListener('click', async () => {
          const statusEl = el('settings-manus-completion-status');
          try {
            const result = await api?.checkManusCompletion?.();
            pomeLocaleRendererAiSources.bind(statusEl, 'textContent', () => pomeLocaleRendererAiSources.t(
              result?.ok ? 'providers.manus.connectionOk' : result?.error === 'manus_unauthenticated' ? 'providers.manus.authInvalid'
                : result?.error === 'manus_permission_denied' ? 'providers.manus.permissionDenied' : 'providers.manus.networkError',
              { arg1: pomeLocaleRendererAiSources.t('providers.manus.justNow') }
            ));
          } catch {
            pomeLocaleRendererAiSources.bind(statusEl, 'textContent', () => pomeLocaleRendererAiSources.t('providers.manus.networkError'));
          }
        });
        el('settings-manus-completion-preview')?.addEventListener('click', async () => {
          try { await api?.previewManusCompletion?.(); } catch { /* preview is best-effort */ }
        });
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
  function manusCheckedLabel(status) {
    const at = Number(status?.lastCheckedAt || status?.lastSuccessfulAt || 0);
    if (!at) return pomeLocaleRendererAiSources.t('providers.manus.justNow');
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    return seconds < 3
      ? pomeLocaleRendererAiSources.t('providers.manus.justNow')
      : pomeLocaleRendererAiSources.t('providers.manus.secondsAgo', { arg1: seconds });
  }
  async function refreshManusCompletionStatus() {
    if (!api?.getManusCompletionStatus) return;
    applyManusCompletionStatus(await api.getManusCompletionStatus());
  }
  function applyManusCompletionStatus(status) {
    const toggle = el('settings-manus-completion-enabled');
    const statusEl = el('settings-manus-completion-status');
    if (!toggle || !statusEl) return;
    manusListener = status || null;
    toggle.checked = status?.enabled === true;
    const key = status?.connectionState === 'listening' ? 'providers.manus.listening'
      : status?.connectionState === 'preparing' ? 'providers.manus.preparing'
        : status?.connectionState === 'auth_invalid' ? 'providers.manus.authInvalid'
          : status?.connectionState === 'permission_denied' ? 'providers.manus.permissionDenied'
            : status?.enabled ? 'providers.manus.networkError'
              : 'providers.manus.disabled';
    pomeLocaleRendererAiSources.bind(statusEl, 'textContent', () => pomeLocaleRendererAiSources.t(key, {
      arg1: manusCheckedLabel(status),
    }));
    render(); announce();
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
    await refreshManusCompletionStatus();
  }
  // Keep provider/token DOM stable across status refreshes and language changes:
  // moving or recreating password inputs would lose focus and unsaved edits.
  const providerRows = new Map();
  function renderActions(row, actions) {
    const definitions = [];
    if (row.hookable) {
      if (row.state === 'connected') {
        if (row.attentionHookMissing || row.summaryHookMissing) definitions.push(['repair', 'copy.repair.37a693']);
        definitions.push(['disconnect', 'copy.disconnect.f33ac0']);
      } else {
        definitions.push(row.state === 'error' ? ['repair', 'copy.repair.37a693'] : ['connect', 'copy.connect.f3b392']);
      }
    }
    // Updating busy or language must not detach the button anchoring a preview.
    for (const child of [...actions.children]) {
      if (!definitions.some(([action]) => child.dataset.sourceAction === action)) child.remove();
    }
    definitions.forEach(([action, key], index) => {
      let button = actions.querySelector(`[data-source-action="${action}"]`);
      if (!button) {
        button = makeButton('', event => void request(row.source, action, event.currentTarget));
        button.dataset.sourceAction = action;
      }
      button.textContent = pomeLocaleRendererAiSources.t(key);
      button.classList.toggle('primary', action === 'connect');
      button.disabled = busy || row.state === 'undetected' || (row.state === 'error' && !row.repairable);
      if (actions.children[index] !== button) actions.insertBefore(button, actions.children[index] || null);
    });
    if (!row.hookable) {
      const hint = document.createElement('small');
      hint.textContent = pomeLocaleRendererAiSources.t(row.source === 'manus' ? 'settings.ai.manusHint' : 'settings.ai.noConnection');
      actions.append(hint);
    }
  }
  function render() {
    const order = ['cursor', 'codex', 'grokbot', 'claude'];
    const rank = source => order.includes(source) ? order.indexOf(source) : order.length;
    const rows = mergedRows().sort((a, b) => rank(a.source) - rank(b.source));
    const connectable = rows.filter((row) => row.hookable || row.source === 'manus');
    const connected = connectable.filter((row) => row.state === 'connected' || row.apiConnected).length;
    pomeLocaleRendererAiSources.bind(el('settings-ai-sources-count'), 'textContent', () => (
      pomeLocaleRendererAiSources.t('settings.ai.connectedCount', { arg1: connected, arg2: connectable.length })
    ));
    for (const row of rows) {
      let item = providerRows.get(row.source);
      if (!item) {
        item = document.createElement('div'); item.className = 'ai-source-row'; item.dataset.source = row.source;
        const main = document.createElement('div'); main.className = 'ai-source-main';
        const icon = document.createElement('img'); icon.src = icons[row.source] || 'assets/inbox/circle-alert.svg'; icon.alt = ''; icon.className = 'ai-source-icon';
        const copy = document.createElement('div'); copy.className = 'ai-source-copy';
        const actions = document.createElement('div'); actions.className = 'ai-source-actions';
        main.append(icon, copy, actions); item.append(main);
        // Existing Cursor/Codex listeners retain their input nodes and IDs.
        const token = el(catalog.get(row.source)?.settingsCard);
        if (token) item.append(token);
        else if (['claude', 'grokbot'].includes(row.source)) {
          const note = document.createElement('p'); note.className = 'ai-source-local-quota';
          note.id = catalog.get(row.source).settingsCard;
          item.append(note);
        }
        providerRows.set(row.source, item); list.append(item);
      }
      item.dataset.state = row.state;
      const copy = item.querySelector('.ai-source-copy'); copy.replaceChildren();
      const heading = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = row.label;
      const state = document.createElement('span'); state.className = 'ai-source-state'; state.textContent = states[row.state] || row.state;
      heading.append(name, state);
      const file = document.createElement('small');
      // Compact display only; preview and confirmation keep the full target path.
      file.textContent = row.filePath ? compactPath(row.filePath)
        : row.source === 'manus' ? pomeLocaleRendererAiSources.t('settings.ai.tokenQuota') : row.message || row.ownership;
      file.title = row.filePath || row.ownership || '';
      // Manus is API-managed (token + completion), not a hook "quota only" source.
      if (row.source === 'manus' && row.state === 'catalogOnly') {
        state.textContent = pomeLocaleRendererAiSources.t('settings.ai.apiManaged');
      }
      copy.append(heading, file);
      if (row.state === 'connected' && restartSources.has(row.source)) {
        const hint = document.createElement('small'); hint.className = 'ai-source-restart-hint';
        hint.textContent = restartMessage(row.source); copy.append(hint);
      }
      const note = item.querySelector('.ai-source-local-quota');
      if (note) note.textContent = pomeLocaleRendererAiSources.t(row.source === 'claude' ? 'settings.ai.localQuota' : 'settings.ai.cursorQuota');
      renderActions(row, item.querySelector('.ai-source-actions'));
    }
  }
  function localizeTokenCards() {
    for (const id of TOKEN_PROVIDERS) {
      const provider = catalog.get(id);
      if (!provider) continue;
      const input = el(`settings-${id}-token`);
      if (input) pomeLocaleRendererAiSources.bind(input, 'placeholder', () => pomeLocaleRendererAiSources.t('copy.pasteToken.8a1c2d', { arg1: provider.label }));
      const save = tokenHost?.querySelector(`[data-provider-save="${id}"]`);
      const clear = tokenHost?.querySelector(`[data-provider-clear="${id}"]`);
      if (save) pomeLocaleRendererAiSources.bind(save, 'textContent', () => pomeLocaleRendererAiSources.t('copy.save.a3030b'));
      if (clear) pomeLocaleRendererAiSources.bind(clear, 'textContent', () => pomeLocaleRendererAiSources.t('copy.clear.bce237'));
      if (id === 'grok' && el('settings-grok-team-label')) {
        pomeLocaleRendererAiSources.bind(el('settings-grok-team-label'), 'textContent', () => pomeLocaleRendererAiSources.t('providers.teamId'));
      }
      if (id === 'manus') {
        for (const [nodeId, key] of [
          ['settings-manus-completion-hint', 'providers.manus.completionHint'],
          ['settings-manus-completion-label', 'providers.manus.completionToggle'],
          ['settings-manus-completion-check', 'providers.manus.check'],
          ['settings-manus-completion-preview', 'providers.manus.preview'],
        ]) {
          const node = el(nodeId);
          if (node) pomeLocaleRendererAiSources.bind(node, 'textContent', () => pomeLocaleRendererAiSources.t(key));
        }
      }
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
    busy = true; render();
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
    finally { busy = false; render(); }
  }
  el('ai-source-confirm-cancel')?.addEventListener('click', () => { dialog.close(); plan = null; anchor?.focus({ preventScroll: true }); });
  dialog?.addEventListener('cancel', event => {
    event.preventDefault(); dialog.close(); plan = null; anchor?.focus({ preventScroll: true });
  });
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
  document.addEventListener('notch:tabchange', event => {
    if (event.detail.tab === 'settings' || (event.detail.tab === 'home' && !modeBusy && Date.now() - checkedAt > 30000)) void refresh();
  });
  window.addEventListener('resize', () => { if (dialog?.open) positionConfirmation(); });
  window.addEventListener('pome:language-changed', () => { localizeTokenCards(); render(); void refreshTokenStatuses(); });
  api?.onAiProviderTokenChanged?.((status) => {
    document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: status }));
    void refreshTokenStatuses();
  });
  api?.onManusCompletionStatus?.(applyManusCompletionStatus);
  window.NotchAiSources = Object.freeze({ refresh, request, openSettings, dismiss, icons, compactPath,
    getState: () => ({
      sources: mergedRows().filter(row => row.hookable || row.source === 'manus').map(row => ({ ...row })),
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
