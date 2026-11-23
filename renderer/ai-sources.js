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
  const TOKEN_PROVIDERS = new Set(['grok', 'copilot', 'antigravity', 'manus']);
  const restartMessage = source => source === 'claude'
    ? pomeLocaleRendererAiSources.t('sources.claudeRestart')
    : pomeLocaleRendererAiSources.t("copy.configurationSavedQuitCompletelyThenReopenIt.507666", { arg1: labels[source] });
  let hookRows = [];
  let listener = null;
  let manusListener = null;
  let ready = false, busy = false, plan = null, anchor = null, checkedAt = 0;
  let dismissed = [];
  try { const value = JSON.parse(localStorage.getItem(dismissKey) || '[]'); if (Array.isArray(value)) dismissed = value; } catch {}
  // 隐藏是本机显示偏好：不碰工具配置，和"断开"（移除 Pome 的 hook）分开。
  const visibility = window.NotchAiSourceVisibility || null;
  let showHidden = false;
  const isHidden = source => Boolean(visibility?.has(source));
  // 有 Pome 配置或已接通的来源不能藏起来，免得把要修的问题藏掉。
  const canHide = row => !isHidden(row.source) && row.state !== 'connected' && !row.apiConnected && !row.installed;
  function setHidden(source, hidden) {
    if (!visibility) return;
    if (hidden) {
      visibility.hide(source);
      // 藏起来的来源若正显示各来源的隐藏入口，保持列表稳定
    } else {
      visibility.show(source);
      if (!visibility.list().length) showHidden = false;
    }
    announce();
    render();
    window.NotchAiUsage?.refresh?.({ force: true })?.catch?.(() => {});
  }
  const el = id => document.getElementById(id);
  const credentialEnable = el('settings-ai-credential-enable');
  async function refreshCredentialAccess() {
    const access = await api?.getAiCredentialAccessStatus?.().catch(() => null);
    pomeLocaleRendererAiSources.bind(el('settings-ai-credential-status'), 'textContent', () => pomeLocaleRendererAiSources.t(access?.enabled ? 'privacy.ai.active' : 'privacy.ai.paused'));
  }
  credentialEnable?.addEventListener('click', async () => {
    credentialEnable.disabled = true;
    try {
      const result = await api?.enableAiCredentialAccess?.();
      if (!result?.ok) throw new Error('credential_access_failed');
      await refreshCredentialAccess();
      await window.NotchAiUsage?.refresh({ force: true });
    } catch { reportFailure('ai', 'credential_access_failed'); }
    finally { credentialEnable.disabled = false; }
  });
  void refreshCredentialAccess();
  for (const name of ['notch:cursor-token-changed', 'notch:codex-token-changed', 'notch:ai-provider-token-changed']) {
    document.addEventListener(name, () => void refreshCredentialAccess());
  }
  function reportFailure(source, code, hint = status, scope = `source:${source}`, messageKey = 'ui.error.generic', detail = '') {
    if (window.NotchUi) window.NotchUi.showError({ diagnostic: `${source}: ${code}${detail ? ` (${detail})` : ''}`, messageKey, scope, inlineHint: hint, onRepair: () => openSettings(source) });
    else if (hint) pomeLocaleRendererAiSources.bind(hint, 'textContent', () => pomeLocaleRendererAiSources.t(messageKey));
  }
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
      const token = source && el(catalog.get(source)?.settingsCard);
      const target = token || (source ? row : el('settings-ai-sources'));
      window.NotchSettings?.reveal(target, { block: source ? 'center' : 'start' });
      const focusRow = source ? row : list.querySelector('[data-source="codex"]') || row;
      window.NotchUi?.openManual(source || "codex");
      const input = token?.querySelector('input[type="password"], input:not([type="checkbox"])');
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
          if (result?.ok !== true) {
            const validationKey = result?.error === 'grok_team_required' ? 'providers.grokTeamRequired' : result?.error === 'token_required' ? 'providers.tokenRequired' : null;
            if (validationKey) pomeLocaleRendererAiSources.bind(hint, 'textContent', () => pomeLocaleRendererAiSources.t(validationKey));
            else reportFailure(id, 'provider_token_save_failed', hint, `token:${id}`, 'providers.tokenSaveFailed', result?.error);
            return;
          }
          pomeLocaleRendererAiSources.bind(hint, 'textContent', () => pomeLocaleRendererAiSources.t('copy.sourceConfigurationUpdated.3181cd'));
          window.NotchUi?.clearError(`token:${id}`);
          document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: result }));
          if (input?.value === token) input.value = '';
          await refreshTokenStatuses();
        } catch { reportFailure(id, 'provider_token_save_failed', hint, `token:${id}`, 'providers.tokenSaveFailed'); }
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
          window.NotchUi?.clearError(`token:${id}`);
          if (id === 'grok') { el('settings-grok-team').value = ''; delete el('settings-grok-team').dataset.dirty; }
          if (el(`settings-${id}-token`)) el(`settings-${id}-token`).value = '';
          document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: result }));
          await refreshTokenStatuses();
        } catch {
          reportFailure(id, 'provider_token_clear_failed', el(`settings-${id}-token-hint`) || el(`settings-${id}-token-status`), `token:${id}`, 'providers.tokenSaveFailed');
        }
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
    window.NotchUi?.renderTokenSources();
  }
  // Keep provider/token DOM stable across status refreshes and language changes:
  // moving or recreating password inputs would lose focus and unsaved edits.
  const providerRows = new Map();
  function renderActions(row, actions) {
    const definitions = [];
    if (row.hookable) {
      if (row.state === 'connected') {
        if (row.attentionHookMissing || row.summaryHookMissing) definitions.push(['repair', 'copy.repair.37a693']);
        definitions.push(['test', 'notifications.test'], ['disconnect', 'copy.disconnect.f33ac0']);
      } else if (row.state === 'error') {
        // 配置里还有 Pome 的项，就必须能断开：Codex 的 notify 被其它工具（如
        // Computer Use）包裹时状态是"配置有误"，只在有配置时报错，不能因此没有断开。
        if (row.repairable) definitions.push(['repair', 'copy.repair.37a693']);
        if (row.installed) definitions.push(['disconnect', 'copy.disconnect.f33ac0']);
        else definitions.push(['connect', 'copy.connect.f3b392']);
      } else {
        definitions.push(['connect', 'copy.connect.f3b392']);
      }
    }
    if (isHidden(row.source)) definitions.push(['unhide', 'copy.show.4b7a2f']);
    else if (canHide(row)) definitions.push(['hide', 'copy.hide.8c1d4e']);
    // Updating busy or language must not detach the button anchoring a preview.
    for (const child of [...actions.children]) {
      if (!definitions.some(([action]) => child.dataset.sourceAction === action)) child.remove();
    }
    definitions.forEach(([action, key], index) => {
      let button = actions.querySelector(`[data-source-action="${action}"]`);
      if (!button) {
        button = makeButton('', async event => {
          if (action === 'hide' || action === 'unhide') return setHidden(row.source, action === 'hide');
          if (action !== 'test') return void request(row.source, action, event.currentTarget);
          button.disabled = true;
          try { const result = await api.testAiSource(row.source); status.textContent = result.message || ''; }
          catch { status.textContent = pomeLocaleRendererAiSources.t('notifications.listenerUnavailable'); }
          finally { button.disabled = false; }
        });
        button.dataset.sourceAction = action;
      }
      button.textContent = pomeLocaleRendererAiSources.t(key);
      button.classList.toggle('primary', action === 'connect');
      // 只有"接入/修复"会被未检测、不可修复挡住；断开与隐藏必须始终可用。
      const blocked = row.state === 'undetected' || (row.state === 'error' && !row.repairable);
      button.disabled = busy || (['connect', 'repair'].includes(action) && blocked);
      if (actions.children[index] !== button) actions.insertBefore(button, actions.children[index] || null);
    });
    if (!row.hookable) {
      const hint = document.createElement('small');
      hint.textContent = pomeLocaleRendererAiSources.t(row.source === 'manus' ? 'settings.ai.manusHint' : 'settings.ai.noConnection');
      actions.append(hint);
    }
  }
  function render() {
    const order = ['cursor', 'codex', 'grokbot', 'claude', 'grok', 'copilot', 'antigravity', 'manus'];
    const rank = source => order.includes(source) ? order.indexOf(source) : order.length;
    const rows = mergedRows().sort((a, b) => rank(a.source) - rank(b.source));
    // 计数只算列出来的来源：隐藏的不占名额，用户配了几个就看到几。
    const shown = rows.filter((row) => showHidden || !isHidden(row.source));
    const connectable = shown.filter((row) => row.hookable || row.source === 'manus');
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
        // Keep every form mounted; its disclosure belongs below this source's
        // actions, including when provider discovery completes later.
        if (['claude', 'grokbot'].includes(row.source)) {
          const note = document.createElement('p'); note.className = 'ai-source-local-quota';
          note.id = catalog.get(row.source).settingsCard;
          item.append(note);
        }
        providerRows.set(row.source, item); list.append(item);
      }
      const token = el(catalog.get(row.source)?.settingsCard);
      if (token?.classList.contains('ai-source-token')) {
        const form = token.closest('.ai-token-details') || token;
        if (form.parentElement !== item) item.append(form);
      }
      item.dataset.state = row.state;
      // 保持表单挂载，只收起来（display:none），避免丢失未保存的 token 编辑；
      // 打开"显示已隐藏来源"时按原顺序回到列表里。
      item.hidden = !showHidden && isHidden(row.source);
      const copy = item.querySelector('.ai-source-copy'); copy.replaceChildren();
      const heading = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = row.label;
      const state = document.createElement('span'); state.className = 'ai-source-state'; state.textContent = states[row.state] || row.state;
      heading.append(name, state);
      const file = document.createElement('small');
      // Compact display only; preview and confirmation keep the full target path.
      file.textContent = row.filePath ? compactPath(row.filePath)
        : row.source === 'grokbot' ? pomeLocaleRendererAiSources.t('ui.grokbot.pool')
          : row.source === 'manus' ? pomeLocaleRendererAiSources.t('settings.ai.tokenQuota') : row.message || row.ownership;
      file.title = row.filePath || row.ownership || '';
      // Manus is API-managed (token + completion), not a hook "quota only" source.
      if (row.source === 'manus' && row.state === 'catalogOnly') {
        state.textContent = pomeLocaleRendererAiSources.t('settings.ai.apiManaged');
      }
      copy.append(heading, file);
      if (row.state === 'error' && row.message) {
        const hint = document.createElement('small'); hint.className = 'ai-source-repair-hint';
        hint.textContent = row.message; copy.append(hint);
      }
      if (row.state === 'connected' && restartSources.has(row.source)) {
        const hint = document.createElement('small'); hint.className = 'ai-source-restart-hint';
        hint.textContent = restartMessage(row.source); copy.append(hint);
      }
      // 如实说明能力边界：Codex / Cursor 目前只能拿到回合结束，拿不到等待输入或选择。
      if (row.state === 'connected' && row.attentionCapability === 'unsupported') {
        const hint = document.createElement('small'); hint.className = 'ai-source-attention-hint';
        hint.textContent = pomeLocaleRendererAiSources.t('sources.attentionUnavailable'); copy.append(hint);
      }
      const note = item.querySelector('.ai-source-local-quota');
      if (note) note.textContent = pomeLocaleRendererAiSources.t(row.source === 'claude' ? 'settings.ai.localQuota' : 'ui.grokbot.quota');
      renderActions(row, item.querySelector('.ai-source-actions'));
    }
    renderHiddenSummary(rows);
  }
  // 收紧列表：隐藏的来源收进一行统计，点一下可以临时显示出来取消隐藏。
  function renderHiddenSummary(rows) {
    const host = el('ai-sources-hidden');
    if (!host) return;
    const hiddenRows = rows.filter((row) => isHidden(row.source));
    if (!hiddenRows.length) showHidden = false;
    host.hidden = !hiddenRows.length;
    if (!hiddenRows.length) return;
    pomeLocaleRendererAiSources.bind(el('ai-sources-hidden-count'), 'textContent', () => (
      pomeLocaleRendererAiSources.t('settings.ai.hiddenCount', { arg1: hiddenRows.length })
    ));
    const toggle = el('ai-sources-hidden-toggle');
    if (toggle) {
      pomeLocaleRendererAiSources.bind(toggle, 'textContent', () => (
        pomeLocaleRendererAiSources.t(showHidden ? 'settings.ai.hideHidden' : 'settings.ai.showHidden')
      ));
      toggle.setAttribute('aria-expanded', String(showHidden));
    }
  }
  function localizeTokenCards() {
    for (const id of TOKEN_PROVIDERS) {
      const provider = catalog.get(id);
      if (!provider) continue;
      const input = el(`settings-${id}-token`);
      if (input) pomeLocaleRendererAiSources.bind(input, 'placeholder', () => pomeLocaleRendererAiSources.t('copy.pasteToken.8a1c2d', { arg1: provider.label }));
      const save = input?.closest('.ai-source-token')?.querySelector(`[data-provider-save="${id}"]`);
      const clear = input?.closest('.ai-source-token')?.querySelector(`[data-provider-clear="${id}"]`);
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
        listener = response.listener || null;
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
      el('ai-source-confirm-details').open = false;
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-summary'), 'textContent', () => pomeLocaleRendererAiSources.t(action === 'disconnect' ? 'ui.hookDisconnect' : 'ui.hookSummary'));
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-title'), "textContent", () => (`${action === 'disconnect' ? pomeLocaleRendererAiSources.t("copy.disconnect.f33ac0") : action === 'repair' ? pomeLocaleRendererAiSources.t("copy.repair.37a693") : pomeLocaleRendererAiSources.t("copy.connect.f3b392")} ${labels[source]}？`));
      el('ai-source-confirm-file').textContent = plan.filePath;
      el('ai-source-confirm-content').textContent = plan.added;
      el('ai-source-confirm-backup').textContent = plan.backupPath;
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-note'), "textContent", () => (pomeLocaleRendererAiSources.t("copy.onlyPomeEntriesWillChangeOtherConfiguration.336c05", { arg1: (plan.message) })));
      pomeLocaleRendererAiSources.bind(el('ai-source-confirm-apply'), "textContent", () => (action === 'disconnect' ? pomeLocaleRendererAiSources.t("copy.backUpAndDisconnect.6abb4a") : action === 'repair' ? pomeLocaleRendererAiSources.t("copy.backUpAndRepair.9b2ea1") : pomeLocaleRendererAiSources.t("copy.backUpAndConnect.bda493")));
      dialog.showModal(); positionConfirmation();
    } catch (error) { reportFailure(source, 'source_preview_failed', status, `source:${source}`, 'ui.error.generic', error.message); }
    finally { busy = false; render(); }
  }
  el('ai-sources-hidden-toggle')?.addEventListener('click', () => { showHidden = !showHidden; render(); });
  el('ai-source-confirm-cancel')?.addEventListener('click', () => { dialog.close(); plan = null; anchor?.focus({ preventScroll: true }); });
  dialog?.addEventListener('cancel', event => {
    event.preventDefault(); dialog.close(); plan = null; anchor?.focus({ preventScroll: true });
  });
  el('ai-source-confirm-apply')?.addEventListener('click', async () => {
    if (!plan || busy) return;
    const applyingPlan = plan;
    busy = true; el('ai-source-confirm-apply').disabled = true;
    try {
      const result = await api.applyAiSource(applyingPlan.token);
      if (!result.ok) throw new Error(result.message || pomeLocaleRendererAiSources.t("copy.couldnTUpdateConfiguration.73ac0d"));
      window.NotchUi?.clearError(`source:${applyingPlan.source}`);
      const needsRestart = applyingPlan.action !== 'disconnect' && !applyingPlan.unchanged;
      if (needsRestart) restartSources.add(applyingPlan.source);
      else if (applyingPlan.action === 'disconnect') restartSources.delete(applyingPlan.source);
      const message = needsRestart ? restartMessage(applyingPlan.source) : applyingPlan.unchanged ? pomeLocaleRendererAiSources.t("copy.noConfigurationChangesNeeded.300b3f") : pomeLocaleRendererAiSources.t("copy.sourceConfigurationUpdated.3181cd");
      dismiss(applyingPlan.source); pomeLocaleRendererAiSources.bind(status, "textContent", () => (`${message}${result.backupPath ? pomeLocaleRendererAiSources.t("copy.backup.9297fd", { arg1: (result.backupPath) }) : ''}`));
      dialog.close(); plan = null; window.showStatusToast?.(message);
    } catch (error) { dialog.close(); plan = null; reportFailure(applyingPlan.source, 'source_apply_failed', status, `source:${applyingPlan.source}`, 'ui.error.generic', error.message); }
    finally { busy = false; el('ai-source-confirm-apply').disabled = false; await refresh(); }
  });
  document.addEventListener('notch:tabchange', event => {
    if (event.detail.tab === 'settings') void refreshCredentialAccess();
    if (event.detail.tab === 'settings' || (event.detail.tab === 'home' && !modeBusy && Date.now() - checkedAt > 30000)) void refresh();
  });
  window.addEventListener('resize', () => { if (dialog?.open) positionConfirmation(); });
  window.addEventListener('pome:language-changed', () => { localizeTokenCards(); render(); void refreshTokenStatuses(); });
  api?.onAiProviderTokenChanged?.((status) => {
    document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed', { detail: status }));
    void refreshTokenStatuses();
  });
  api?.onManusCompletionStatus?.(applyManusCompletionStatus);
  api?.onNotificationListenerChanged?.(state => { listener = state; announce(); });
  window.NotchAiSources = Object.freeze({ refresh, request, openSettings, dismiss, icons, compactPath,
    hide: source => setHidden(source, true),
    show: source => setHidden(source, false),
    getState: () => ({
      sources: mergedRows().filter(row => row.hookable || row.source === 'manus').map(row => ({ ...row })),
      providers: mergedRows().map((row) => ({ ...row })),
      hidden: visibility ? visibility.list() : [],
      ready, listener,
      suggestion: hookRows.find((row) => row.state === 'disconnected' && !dismissed.includes(row.source) && !isHidden(row.source)),
    }) });
  try {
    renderTokenCards();
    void refreshTokenStatuses();
  } catch (error) {
    console.error('ai-provider-token-cards', error);
  }
  void refresh();
})();
