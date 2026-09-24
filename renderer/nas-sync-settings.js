'use strict';

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
      uiLabel: '未配对',
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
    };
  }

  function formatTime(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString();
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
        next.error = action.message || '操作失败';
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
      title: '允许明文 HTTP',
      body: '该地址不加密，设备令牌与待办内容可能被窃听或篡改。确认允许明文 HTTP？',
      confirmLabel: '允许 HTTP',
      cancelLabel: '取消',
    };
  }

  function buildDeleteConfirmDialog(endpoint) {
    return {
      id: 'endpoint-delete-confirm',
      controlId: DELETE_CONFIRM_CONTROL_ID,
      role: 'dialog',
      title: '删除 endpoint',
      body: `确认删除 ${endpoint && endpoint.baseUrl ? endpoint.baseUrl : '该地址'}？\n若该地址用过设备令牌，可能已泄漏，建议随后吊销并重新配对。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      endpointId: endpoint && endpoint.endpointId,
    };
  }

  function buildRestoreConfirmDialog() {
    return {
      id: 'restore-backup-confirm',
      controlId: RESTORE_CONFIRM_CONTROL_ID,
      role: 'dialog',
      title: '恢复上次迁移备份',
      body: '将用上次迁移备份覆盖当前本地待办。此操作不可撤销，确认继续？',
      confirmLabel: '恢复备份',
      cancelLabel: '取消',
    };
  }

  function validateBaseUrlDraft(value) {
    const raw = String(value || '').trim();
    if (!raw) return { ok: false, error: 'empty', message: '请输入 Base URL' };
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'unsupported_protocol', message: '仅支持 http/https' };
      }
      if (url.username || url.password) {
        return { ok: false, error: 'credentials_not_allowed', message: 'URL 不得含账号密码' };
      }
      if (url.search || url.hash) {
        return { ok: false, error: 'query_or_fragment_not_allowed', message: 'URL 不得含查询或片段' };
      }
      return { ok: true, baseUrl: raw };
    } catch {
      return { ok: false, error: 'invalid_url', message: 'URL 无效' };
    }
  }

  /**
   * @param {{ api: object, baseUrl: string, kind?: string }} opts
   */
  async function runAddEndpoint(opts) {
    const check = validateBaseUrlDraft(opts.baseUrl);
    if (!check.ok) return { ok: false, error: check.error, message: check.message };
    if (!opts.api || typeof opts.api.syncAddEndpoint !== 'function') {
      return { ok: false, error: 'api_unavailable', message: '同步 API 不可用' };
    }
    return opts.api.syncAddEndpoint({
      baseUrl: check.baseUrl,
      kind: opts.kind || 'gateway',
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
    not_bound: '请先完成配对再同步',
    binding_incomplete: '配对信息不完整，请重新配对',
    missing_endpoint: '请先添加同步地址',
    not_found: '找不到该 endpoint',
    endpoint_id_required: '缺少 endpoint',
    duplicate_endpoint: '该地址已存在',
    disabled_by_policy: '已停用：需改为 HTTPS 或重新开启 HTTP 开关',
    https_on_http: '该地址说的是 HTTP，不是 HTTPS。请把 Base URL 改为 http://…',
    certificate_error: '证书错误',
    timeout: '连接超时',
    remote_closed: '已经连上这台主机，但后面的同步服务没有回应就断开了。请确认飞牛应用正在运行，FRP 或局域网指向当前的设备同步端口；明文映射请用 http://，不要用 https://。',
    connection_refused: '连不上同步端口。请确认飞牛应用正在运行，并且 FRP 或局域网指向当前的设备同步端口。',
    ECONNRESET: '已经连上这台主机，但后面的同步服务没有回应就断开了。请确认飞牛应用正在运行，FRP 或局域网指向当前的设备同步端口；明文映射请用 http://，不要用 https://。',
    UND_ERR_SOCKET: '已经连上这台主机，但后面的同步服务没有回应就断开了。请确认飞牛应用正在运行，FRP 或局域网指向当前的设备同步端口；明文映射请用 http://，不要用 https://。',
    ECONNREFUSED: '连不上同步端口。请确认飞牛应用正在运行，并且 FRP 或局域网指向当前的设备同步端口。',
    invalid_url: 'URL 无效',
    invalid_json: '服务器返回无法解析',
    write_failed: '写入失败',
    api_unavailable: '同步 API 不可用',
    list_failed: '读取设备列表失败',
    revoke_failed: '吊销失败',
    invalid_revoke: '无法吊销该设备',
    network_error: '网络不可用',
  };

  const LOST_DEVICE_TOKEN_HINT = '本机曾配置同步地址，但设备令牌已丢失，请重新配对';

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
  function humanizeSyncError(result, fallback = '操作失败') {
    const fallbackText = fallback || '操作失败';
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
    if (message && !isRawErrorCode(message)) return message;
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
