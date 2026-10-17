'use strict';
const pomeLocaleRendererNasSyncSettings = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;


/**
 * Pure UI helpers for NAS sync settings (T6): status bar, endpoint editor, HTTP toggle.
 * Loaded in renderer; no electron require — IPC via window.notchAPI.
 */
(function initNasSyncSettings(global) {
  const HTTP_CONFIRM_CONTROL_ID = 'endpoint.allowInsecureHttp.confirm';
  const DELETE_CONFIRM_CONTROL_ID = 'endpoint.delete';
  const RESTORE_CONFIRM_CONTROL_ID = 'settings.nas-sync.restore-backup';

  function initialSettingsUiState() {
    return {
      view: null,
      syncStatus: null,
      outboxCount: 0,
      uiState: 'unbound',
      uiLabel: pomeLocaleRendererNasSyncSettings.t("copy.notPaired.af18b2"),
      channelLabel: '',
      lastSuccessLabel: '',
      insecureWarningVisible: false,
      devicePortGuidanceVisible: false,
      editingId: null,
      draftUrl: '',
      draftKind: 'gateway',
      testingId: null,
      busy: false,
      error: '',
      toast: '',
      dialog: null,
      retryEnabled: true,
      schemaIncompatible: false,
      schemaUpgradeTarget: null,
      schemaMessage: null,
      contentResults: {},
      recovery: null,
    };
  }

  function formatTime(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString(pomeLocaleRendererNasSyncSettings.getState().formatLocale);
    } catch {
      return '—';
    }
  }

  function reduceSettingsUi(state, action) {
    const next = { ...state };
    switch (action.type) {
      case 'hydrate': {
        const view = action.view || null;
        const sync = action.syncStatus || null;
        next.view = view;
        next.syncStatus = sync;
        next.outboxCount = Number(action.outboxCount) || 0;
        next.uiState = action.uiState || (view && view.lastUiState) || 'unbound';
        next.uiLabel = action.uiLabel || next.uiLabel;
        next.channelLabel = action.channelLabel ||
          (view && view.currentEndpoint && view.currentEndpoint.baseUrl) ||
          '';
        next.lastSuccessLabel = formatTime(
          (view && view.lastSuccessAt) || (sync && sync.lastSuccessAt),
        );
        next.insecureWarningVisible = Boolean(view && view.insecureHttpWarning);
        next.devicePortGuidanceVisible = Boolean(view && view.devicePortGuidance);
        next.error = action.error || '';
        next.contentResults = action.contentResults || next.contentResults;
        next.recovery = action.recovery || (sync && sync.recovery) || null;
        next.schemaIncompatible = Boolean(
          action.schemaIncompatible
          || (sync && sync.schemaIncompatible)
          || next.uiState === 'schema_incompatible',
        );
        next.schemaUpgradeTarget = action.schemaUpgradeTarget
          || (sync && sync.schemaUpgradeTarget)
          || null;
        next.schemaMessage = action.schemaMessage
          || (sync && sync.schemaMessage)
          || null;
        return next;
      }
      case 'set_draft':
        next.draftUrl = String(action.baseUrl || '');
        next.draftKind = action.kind || next.draftKind || 'gateway';
        next.error = '';
        return next;
      case 'edit_start':
        next.editingId = action.endpointId || null;
        next.draftUrl = action.baseUrl || '';
        next.draftKind = action.kind || 'gateway';
        next.error = '';
        return next;
      case 'edit_cancel':
        next.editingId = null;
        next.draftUrl = '';
        next.error = '';
        return next;
      case 'busy':
        next.busy = true;
        next.error = '';
        return next;
      case 'idle':
        next.busy = false;
        next.testingId = null;
        return next;
      case 'testing':
        next.testingId = action.endpointId || null;
        next.busy = true;
        return next;
      case 'toast':
        next.toast = action.message || '';
        next.busy = false;
        return next;
      case 'failure':
        next.busy = false;
        next.testingId = null;
        next.error = action.message || pomeLocaleRendererNasSyncSettings.t("copy.operationFailed.0c3b4c");
        return next;
      case 'open_dialog':
        next.dialog = action.dialog || null;
        return next;
      case 'close_dialog':
        next.dialog = null;
        return next;
      case 'set_retry_enabled':
        next.retryEnabled = action.enabled !== false;
        return next;
      default:
        return next;
    }
  }

  function buildHttpConfirmDialog() {
    return {
      id: 'endpoint-http-confirm',
      controlId: HTTP_CONFIRM_CONTROL_ID,
      role: 'dialog',
      title: pomeLocaleRendererNasSyncSettings.t("copy.allowUnencryptedHttp.2a5751"),
      body: pomeLocaleRendererNasSyncSettings.t("copy.thisAddressIsNotEncryptedDeviceTokens.b46cf6"),
      confirmLabel: pomeLocaleRendererNasSyncSettings.t("copy.allowHttp.67a9d8"),
      cancelLabel: pomeLocaleRendererNasSyncSettings.t("copy.cancel.2cd0f3"),
    };
  }

  function buildDeleteConfirmDialog(endpoint) {
    return {
      id: 'endpoint-delete-confirm',
      controlId: DELETE_CONFIRM_CONTROL_ID,
      role: 'dialog',
      title: pomeLocaleRendererNasSyncSettings.t("copy.deleteEndpoint.ef1469"),
      body: pomeLocaleRendererNasSyncSettings.t("copy.deleteADeviceTokenUsedWithThis.d96849", { arg1: (endpoint && endpoint.baseUrl ? endpoint.baseUrl : pomeLocaleRendererNasSyncSettings.t("copy.thisAddress.230f20")) }),
      confirmLabel: pomeLocaleRendererNasSyncSettings.t("copy.delete.2f9daa"),
      cancelLabel: pomeLocaleRendererNasSyncSettings.t("copy.cancel.2cd0f3"),
      endpointId: endpoint && endpoint.endpointId,
    };
  }

  function buildRestoreConfirmDialog() {
    return {
      id: 'restore-backup-confirm',
      controlId: RESTORE_CONFIRM_CONTROL_ID,
      role: 'dialog',
      title: pomeLocaleRendererNasSyncSettings.t("copy.restoreTheLastMigrationBackup.93b935"),
      body: pomeLocaleRendererNasSyncSettings.t("copy.theLastMigrationBackupWillOverwriteCurrent.24876d"),
      confirmLabel: pomeLocaleRendererNasSyncSettings.t("copy.restoreBackup.1ae486"),
      cancelLabel: pomeLocaleRendererNasSyncSettings.t("copy.cancel.2cd0f3"),
    };
  }

  function validateBaseUrlDraft(value) {
    const raw = String(value || '').trim();
    if (!raw) return { ok: false, error: 'empty', message: pomeLocaleRendererNasSyncSettings.t("copy.enterABaseUrl.3c263f") };
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'unsupported_protocol', message: pomeLocaleRendererNasSyncSettings.t("copy.onlyHttpAndHttpsAreSupported.dc41cb") };
      }
      if (url.username || url.password) {
        return { ok: false, error: 'credentials_not_allowed', message: pomeLocaleRendererNasSyncSettings.t("copy.theUrlMustNotContainAUsername.804dbd") };
      }
      if (url.search || url.hash) {
        return { ok: false, error: 'query_or_fragment_not_allowed', message: pomeLocaleRendererNasSyncSettings.t("copy.theUrlMustNotContainAQuery.b26b29") };
      }
      return { ok: true, baseUrl: raw };
    } catch {
      return { ok: false, error: 'invalid_url', message: pomeLocaleRendererNasSyncSettings.t("copy.invalidUrl.d92df2") };
    }
  }

  /**
   * @param {{ api: object, baseUrl: string, kind?: string }} opts
   */
  async function runAddEndpoint(opts) {
    const check = validateBaseUrlDraft(opts.baseUrl);
    if (!check.ok) return { ok: false, error: check.error, message: check.message };
    if (!opts.api || typeof opts.api.syncAddEndpoint !== 'function') {
      return { ok: false, error: 'api_unavailable', message: pomeLocaleRendererNasSyncSettings.t("copy.syncApiUnavailable.af98a6") };
    }
    return opts.api.syncAddEndpoint({
      baseUrl: check.baseUrl,
      kind: opts.kind || 'gateway',
      ...(Number.isFinite(opts.priority) ? { priority: opts.priority } : {}),
    });
  }

  async function runToggleHttp(opts) {
    if (!opts.api || typeof opts.api.syncUpdateEndpoint !== 'function') {
      return { ok: false, error: 'api_unavailable' };
    }
    return opts.api.syncUpdateEndpoint({
      endpointId: opts.endpointId,
      allowInsecureHttp: opts.enable === true,
      httpConfirmAccepted: opts.httpConfirmAccepted === true,
    });
  }

  async function runTestConnection(opts) {
    if (!opts.api || typeof opts.api.syncTestEndpoint !== 'function') {
      return { ok: false, error: 'api_unavailable' };
    }
    return opts.api.syncTestEndpoint({ endpointId: opts.endpointId });
  }

  async function runExportBackup(opts) {
    if (!opts.api || typeof opts.api.syncExportTodosBackup !== 'function') {
      return { ok: false, error: 'api_unavailable' };
    }
    return opts.api.syncExportTodosBackup();
  }

  async function runRetrySync(opts) {
    if (!opts.api || typeof opts.api.syncRetry !== 'function') {
      return { ok: false, error: 'api_unavailable' };
    }
    return opts.api.syncRetry();
  }

  const SYNC_ERROR_COPY = {
    get not_bound() { return pomeLocaleRendererNasSyncSettings.t("copy.pairThisDeviceBeforeSyncing.5b7d9c"); },
    get binding_incomplete() { return pomeLocaleRendererNasSyncSettings.t("copy.pairingInformationIsIncompletePairAgain.19121d"); },
    get missing_endpoint() { return pomeLocaleRendererNasSyncSettings.t("copy.addASyncAddressFirst.d9a086"); },
    get not_found() { return pomeLocaleRendererNasSyncSettings.t("copy.endpointNotFound.6b9856"); },
    get endpoint_id_required() { return pomeLocaleRendererNasSyncSettings.t("copy.endpointMissing.7fbeac"); },
    get duplicate_endpoint() { return pomeLocaleRendererNasSyncSettings.t("copy.thisAddressAlreadyExists.1f7891"); },
    get disabled_by_policy() { return pomeLocaleRendererNasSyncSettings.t("copy.disabledUseHttpsOrAllowHttpAgain.bded2b"); },
    get https_on_http() { return pomeLocaleRendererNasSyncSettings.t("copy.thisAddressUsesHttpNotHttpsChange.d61e18"); },
    get certificate_error() { return pomeLocaleRendererNasSyncSettings.t("copy.certificateNotTrustedVerifyItsFingerprintDuring.4bae6f"); },
    get certificate_fingerprint_mismatch() { return pomeLocaleRendererNasSyncSettings.t("copy.theCertificateChangedVerifyItsFingerprintBefore.6af6df"); },
    get timeout() { return pomeLocaleRendererNasSyncSettings.t("copy.connectionTimedOutCheckUseHttpFor.6fedf7"); },
    get remote_closed() { return pomeLocaleRendererNasSyncSettings.t("copy.theHostWasReachedButTheSync.1bab4e"); },
    get connection_refused() { return pomeLocaleRendererNasSyncSettings.t("copy.canTReachTheSyncPortCheck.3a3a3e"); },
    get ECONNRESET() { return pomeLocaleRendererNasSyncSettings.t("copy.theHostWasReachedButTheSync.1bab4e"); },
    get UND_ERR_SOCKET() { return pomeLocaleRendererNasSyncSettings.t("copy.theHostWasReachedButTheSync.1bab4e"); },
    get ECONNREFUSED() { return pomeLocaleRendererNasSyncSettings.t("copy.canTReachTheSyncPortCheck.3a3a3e"); },
    get invalid_url() { return pomeLocaleRendererNasSyncSettings.t("copy.invalidUrl.d92df2"); },
    get invalid_json() { return pomeLocaleRendererNasSyncSettings.t("copy.couldnTParseTheServerResponse.e2fabb"); },
    get write_failed() { return pomeLocaleRendererNasSyncSettings.t("copy.writeFailed.f11e4f"); },
    get api_unavailable() { return pomeLocaleRendererNasSyncSettings.t("copy.syncApiUnavailable.af98a6"); },
    get list_failed() { return pomeLocaleRendererNasSyncSettings.t("copy.couldnTReadTheDeviceList.ff9bc1"); },
    get revoke_failed() { return pomeLocaleRendererNasSyncSettings.t("copy.revocationFailed.eb0d97"); },
    get invalid_revoke() { return pomeLocaleRendererNasSyncSettings.t("copy.canTRevokeThisDevice.0b0e36"); },
    get network_error() { return pomeLocaleRendererNasSyncSettings.t("copy.networkUnavailable.35b379"); },
  };

  const LOST_DEVICE_TOKEN_HINT = pomeLocaleRendererNasSyncSettings.t("copy.thisDeviceHasASavedSyncAddress.fc3a23");

  function connectionEndpoints(view, status) {
    const endpoints = view?.endpoints || [];
    const canonical = value => {
      try { const url = new URL(value); return url.origin + url.pathname.replace(/\/+$/, ''); }
      catch { return String(value || '').trim(); }
    };
    const pairedUrl = status?.baseUrl;
    const primary = pairedUrl ? endpoints.find(row => canonical(row.baseUrl) === canonical(pairedUrl))
      : endpoints[0] || view?.currentEndpoint || null;
    return { primary, baseUrl: pairedUrl || primary?.baseUrl || '',
      backup: endpoints.find(row => canonical(row.baseUrl) !== canonical(pairedUrl || primary?.baseUrl)) || null };
  }

  function contentResultRows(results, bound) {
    const names = ['待办', '笔记', '链接', '常用指令', '剪贴板', '录音元数据', '录音音频', 'AI 配置', '密钥'];
    for (const name of Object.keys(results || {})) if (!names.includes(name)) names.push(name);
    return names.map(name => {
      const row = bound ? results?.[name] : null;
      const date = row?.at ? new Date(row.at) : null;
      const valid = date && Number.isFinite(date.getTime());
      return { name: pomeLocaleRendererNasSyncSettings.systemText(name), message: (row?.messageDescriptor ? pomeLocaleRendererNasSyncSettings.systemText(row.messageDescriptor) : row?.message ? pomeLocaleRendererNasSyncSettings.systemText(row.message) : null) || (bound ? pomeLocaleRendererNasSyncSettings.t("copy.initialDataSyncIsNotComplete.62dc6e") : pomeLocaleRendererNasSyncSettings.t("copy.localOnlyNasNotPaired.d36c6c")),
        ok: row?.ok, at: valid ? row.at : null,
        time: valid ? date.toLocaleTimeString(pomeLocaleRendererNasSyncSettings.getState().formatLocale, { hour: '2-digit', minute: '2-digit' }) : '—' };
    });
  }

  /**
   * Plaintext endpoints survive ad-hoc reinstalls; the safeStorage device token
   * often does not. Any saved address without a binding needs one re-pair line.
   */
  function shouldPromptLostDeviceToken(input = {}) {
    if (input.bound || input.schemaIncompatible) return false;
    const endpoints = Array.isArray(input.endpoints) ? input.endpoints : [];
    return endpoints.length > 0;
  }

  function isRawErrorCode(value) {
    const text = String(value || '').trim();
    if (!text || /[\u4e00-\u9fff]/.test(text) || /\s/.test(text)) return false;
    return /^[A-Za-z0-9_.:-]+$/.test(text);
  }

  function transportFailureCopy(value) {
    const text = String(value || '').toLowerCase();
    if (!text) return '';
    if (/econnrefused|connection refused|connection_refused/.test(text)) {
      return SYNC_ERROR_COPY.connection_refused;
    }
    if (/socket hang up|econnreset|empty reply from server|und_err_socket|remote_closed/.test(text)) {
      return SYNC_ERROR_COPY.remote_closed;
    }
    return '';
  }

  /**
   * User-facing sync failure. Known codes become Chinese; unknown raw codes
   * fall back instead of being shown (for example `not_bound`).
   */
  function humanizeSyncError(result, fallback = pomeLocaleRendererNasSyncSettings.t("copy.operationFailed.0c3b4c")) {
    const fallbackText = fallback || pomeLocaleRendererNasSyncSettings.t("copy.operationFailed.0c3b4c");
    if (result == null || result === '') return fallbackText;
    if (typeof result === 'string') {
      return SYNC_ERROR_COPY[result]
        || transportFailureCopy(result)
        || (isRawErrorCode(result) ? fallbackText : result);
    }
    const code = result.error || result.code || '';
    const fromCode = transportFailureCopy(code) || (code && SYNC_ERROR_COPY[code]);
    if (fromCode) return fromCode;
    const message = result.message;
    const fromMessage = transportFailureCopy(message);
    if (fromMessage) return fromMessage;
    if (message && !isRawErrorCode(message)) return pomeLocaleRendererNasSyncSettings.systemText(message);
    return fallbackText;
  }

  const api = {
    initialSettingsUiState,
    reduceSettingsUi,
    buildHttpConfirmDialog,
    buildDeleteConfirmDialog,
    buildRestoreConfirmDialog,
    validateBaseUrlDraft,
    runAddEndpoint,
    runToggleHttp,
    runTestConnection,
    runExportBackup,
    runRetrySync,
    humanizeSyncError,
    shouldPromptLostDeviceToken,
    connectionEndpoints,
    contentResultRows,
    LOST_DEVICE_TOKEN_HINT,
    isRawErrorCode,
    HTTP_CONFIRM_CONTROL_ID,
    DELETE_CONFIRM_CONTROL_ID,
    RESTORE_CONFIRM_CONTROL_ID,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.NasSyncSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
