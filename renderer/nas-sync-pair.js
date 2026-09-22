'use strict';

/**
 * Pure UI helpers for NAS sync pairing (T3).
 * Loaded in renderer; no electron require — IPC via window.notchAPI.
 */
(function initNasSyncPair(global) {
  const PAIR_CODE_RE = /^\d{6}$/;
  const HTTPS_ON_HTTP_MESSAGE = '该地址说的是 HTTP，不是 HTTPS。请把 Base URL 改为 http://…';

  function isHttpsOnHttpText(value) {
    const raw = String(value || '').toLowerCase();
    return (
      /(?:^|[^a-z0-9])https_on_http(?:$|[^a-z0-9])/.test(raw)
      || /wrong version number/.test(raw)
      || /err_ssl_wrong_version_number/.test(raw)
      || /ssl_r_wrong_version_number/.test(raw)
    );
  }

  function isHttpsOnHttpFailure(result) {
    if (result == null) return false;
    if (typeof result !== 'object') return isHttpsOnHttpText(result);
    if (result.error === 'https_on_http' || result.kind === 'https_on_http' || result.code === 'https_on_http') {
      return true;
    }
    return isHttpsOnHttpText([result.error, result.code, result.message, result.kind].filter(Boolean).join(' '));
  }

  /**
   * Certificate trust confirm is only for a real untrusted certificate.
   * HTTPS-to-plaintext-HTTP must never open that dialog, even if a caller
   * mis-labeled the failure as certificate_error.
   */
  function shouldOpenCertificateTrustDialog(result) {
    if (!result || result.ok) return false;
    if (isHttpsOnHttpFailure(result)) return false;
    if (result.needsTrustConfirm !== true) return false;
    return result.certificateError === true || result.error === 'certificate_error';
  }

  function normalizePairCode(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function validatePairCode(value) {
    const code = normalizePairCode(value);
    if (!code) return { ok: false, error: 'empty', message: '请输入配对码' };
    if (!PAIR_CODE_RE.test(code)) return { ok: false, error: 'invalid_format', message: '配对码须为 6 位数字' };
    return { ok: true, code };
  }

  function shouldPromptHttpConfirm(policy) {
    return Boolean(policy && policy.ok && policy.requiresExtraConfirm);
  }

  /**
   * @param {object} state
   * @param {{ type: string, [key: string]: unknown }} action
   */
  function reducePairUi(state, action) {
    const next = { ...state };
    switch (action.type) {
      case 'input':
        next.code = normalizePairCode(action.value);
        next.error = '';
        return next;
      case 'submit_start':
        next.submitting = true;
        next.error = '';
        next.disabled = true;
        return next;
      case 'submit_end':
        next.submitting = false;
        next.disabled = false;
        return next;
      case 'success':
        next.submitting = false;
        next.disabled = false;
        next.code = '';
        next.error = '';
        next.bound = true;
        next.status = action.status || null;
        next.toast = '配对成功';
        next.dialog = null;
        return next;
      case 'failure':
        next.submitting = false;
        next.disabled = false;
        next.error = action.message || action.error || '配对失败';
        next.toast = next.error;
        next.needsTrustConfirm = action.needsTrustConfirm === true;
        if (!next.needsTrustConfirm) next.dialog = null;
        return next;
      case 'open_http_confirm':
        next.dialog = {
          id: 'pair-http-confirm',
          role: 'dialog',
          title: '允许明文 HTTP 配对？',
          body: action.confirmText || '配对码与新设备令牌将以明文传输，可能被窃听或篡改。',
          confirmLabel: '仍然配对',
          cancelLabel: '取消',
        };
        return next;
      case 'close_dialog':
        next.dialog = null;
        next.submitting = false;
        next.disabled = false;
        return next;
      case 'open_reauth_confirm':
        next.dialog = {
          id: 'pair-reauth-confirm',
          role: 'dialog',
          title: '吊销令牌并重新配对？',
          body: '将清除本机设备令牌。确认后需重新输入配对码。',
          confirmLabel: '确认吊销',
          cancelLabel: '取消',
        };
        return next;
      case 'cleared':
        next.bound = false;
        next.status = null;
        next.devices = [];
        next.dialog = null;
        next.toast = '已清除绑定';
        return next;
      case 'devices':
        next.devices = Array.isArray(action.devices) ? action.devices : [];
        return next;
      case 'set_status':
        next.bound = Boolean(action.status && action.status.bound);
        next.status = action.status || null;
        if (action.status && action.status.schemaIncompatible) {
          next.error = action.status.schemaMessage
            || (action.status.schemaUpgradeTarget === 'desktop'
              ? '协议不兼容：请升级桌面端 Pome Panel 后再同步'
              : action.status.schemaUpgradeTarget === 'fpk'
                ? '协议不兼容：请升级 NAS 上的 Pome Panel Sync 应用后再同步'
                : '协议不兼容：请升级桌面端或 NAS 应用后再同步');
        }
        return next;
      default:
        return next;
    }
  }

  function initialPairUiState() {
    return {
      code: '',
      baseUrl: '',
      submitting: false,
      disabled: false,
      error: '',
      toast: '',
      bound: false,
      status: null,
      dialog: null,
      devices: [],
    };
  }

  /**
   * Orchestrate pair submit; injectable API for tests.
   */
  async function runPairSubmit({
    code,
    baseUrl,
    api,
    httpConfirmAccepted = false,
    allowInsecureHttp = false,
    deviceName,
  }) {
    const validated = validatePairCode(code);
    if (!validated.ok) return { ok: false, error: validated.error, message: validated.message };

    if (!baseUrl || !String(baseUrl).trim()) {
      return { ok: false, error: 'empty_base_url', message: '请填写 NAS 地址' };
    }

    const policy = await api.syncPairHttpPolicy(baseUrl);
    if (!policy.ok) {
      return { ok: false, error: policy.error || 'invalid_base_url', message: 'NAS 地址无效' };
    }

    if (shouldPromptHttpConfirm(policy) && !httpConfirmAccepted) {
      return {
        ok: false,
        error: 'http_confirm_required',
        confirmText: policy.confirmText,
        requiresExtraConfirm: true,
      };
    }

    const result = await api.syncPairClaim({
      pairingCode: validated.code,
      baseUrl,
      httpConfirmAccepted: Boolean(httpConfirmAccepted),
      allowInsecureHttp: allowInsecureHttp || policy.insecureBound,
      deviceName,
    });

    if (!result.ok) {
      if (isHttpsOnHttpFailure(result)) {
        return {
          ok: false,
          error: 'https_on_http',
          message: HTTPS_ON_HTTP_MESSAGE,
          needsTrustConfirm: false,
          certificateError: false,
          dialog: null,
        };
      }
      const messages = {
        secure_storage_unavailable: '系统安全存储不可用，拒绝保存明文令牌',
        http_confirm_required: '需要确认不安全的 HTTP 配对',
        insecure_http_not_allowed: '未允许明文 HTTP',
        empty: '请输入配对码',
        invalid_format: '配对码须为 6 位数字',
        code_not_found: '配对码无效',
        code_consumed: '配对码已使用',
        code_expired: '配对码已过期',
        certificate_error: '证书错误',
        schema_incompatible: result.message
          || (result.upgradeTarget === 'desktop'
            ? '协议不兼容：请升级桌面端 Pome Panel 后再同步'
            : result.upgradeTarget === 'fpk'
              ? '协议不兼容：请升级 NAS 上的 Pome Panel Sync 应用后再同步'
              : '协议不兼容：请升级桌面端或 NAS 应用后再同步'),
      };
      const needsTrustConfirm = shouldOpenCertificateTrustDialog(result);
      return {
        ok: false,
        error: result.error,
        message: messages[result.error] || result.message || result.error || '配对失败',
        needsTrustConfirm,
        certificateError: result.certificateError === true || result.error === 'certificate_error',
        dialog: null,
        refusedPlaintext: result.refusedPlaintext,
        upgradeTarget: result.upgradeTarget,
        uiState: result.uiState,
      };
    }
    return { ok: true, status: result.status };
  }

  const api = {
    HTTPS_ON_HTTP_MESSAGE,
    normalizePairCode,
    validatePairCode,
    isHttpsOnHttpFailure,
    shouldOpenCertificateTrustDialog,
    shouldPromptHttpConfirm,
    reducePairUi,
    initialPairUiState,
    runPairSubmit,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.NasSyncPair = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
