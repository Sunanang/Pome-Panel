'use strict';
const pomeLocaleRendererNasSyncPair = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;


/**
 * Pure UI helpers for NAS sync pairing (T3).
 * Loaded in renderer; no electron require — IPC via window.notchAPI.
 */
(function initNasSyncPair(global) {
  const PAIR_CODE_RE = /^\d{6}$/;
  const HTTPS_ON_HTTP_MESSAGE = pomeLocaleRendererNasSyncPair.t("copy.thisAddressUsesHttpNotHttpsChange.d61e18");
  const CONNECTION_TIMEOUT_MESSAGE = pomeLocaleRendererNasSyncPair.t("copy.connectionTimedOutCheckUseHttpFor.6fedf7");
  const CERTIFICATE_TRUST_CONFIRM_TEXT = pomeLocaleRendererNasSyncPair.t("copy.thisAddressUsesASelfSignedOr.6b4e16");

  function formatCertificateTrustBody(details = {}) {
    const lines = [
      pomeLocaleRendererNasSyncPair.systemText(details.confirmText || CERTIFICATE_TRUST_CONFIRM_TEXT),
      '',
      pomeLocaleRendererNasSyncPair.t("copy.host.aaea94", { arg1: (details.hostKey || pomeLocaleRendererNasSyncPair.t("copy.unknown.90a49e")) }),
      pomeLocaleRendererNasSyncPair.t("copy.fingerprint.8897fb", { arg1: (details.fingerprint256 || pomeLocaleRendererNasSyncPair.t("copy.unavailable.56e8dc")) }),
    ];
    if (details.subjectCN) lines.push(pomeLocaleRendererNasSyncPair.t("copy.subject.20d2c4", { arg1: (details.subjectCN) }));
    if (details.issuerCN) lines.push(pomeLocaleRendererNasSyncPair.t("copy.issuer.b2e481", { arg1: (details.issuerCN) }));
    if (details.validFrom || details.validTo) {
      lines.push(pomeLocaleRendererNasSyncPair.t("copy.valid.f363e2", { arg1: (details.validFrom || '—'), arg2: (details.validTo || '—') }));
    }
    return lines.join('\n');
  }

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
    if (!code) return { ok: false, error: 'empty', message: pomeLocaleRendererNasSyncPair.t("copy.enterAPairingCode.03ac12") };
    if (!PAIR_CODE_RE.test(code)) return { ok: false, error: 'invalid_format', message: pomeLocaleRendererNasSyncPair.t("copy.enterA6DigitPairingCode.1468c4") };
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
        next.toast = pomeLocaleRendererNasSyncPair.t("copy.pairingSuccessful.b1e2f7");
        next.dialog = null;
        return next;
      case 'failure':
        next.submitting = false;
        next.disabled = false;
        next.error = action.message || action.error || pomeLocaleRendererNasSyncPair.t("copy.pairingFailed.aea73b");
        next.toast = next.error;
        next.needsTrustConfirm = action.needsTrustConfirm === true;
        if (!next.needsTrustConfirm) next.dialog = null;
        return next;
      case 'open_http_confirm':
        next.dialog = {
          id: 'pair-http-confirm',
          role: 'dialog',
          title: pomeLocaleRendererNasSyncPair.t("copy.pairOverUnencryptedHttp.4af466"),
          body: action.confirmText || pomeLocaleRendererNasSyncPair.t("copy.thePairingCodeAndNewDeviceToken.880a2f"),
          confirmLabel: pomeLocaleRendererNasSyncPair.t("copy.pairAnyway.cce70a"),
          cancelLabel: pomeLocaleRendererNasSyncPair.t("copy.cancel.2cd0f3"),
        };
        return next;
      case 'open_cert_trust_confirm':
        next.dialog = {
          id: 'pair-cert-trust-confirm',
          controlId: 'pair.certificate-trust',
          role: 'dialog',
          title: pomeLocaleRendererNasSyncPair.t("copy.trustThisNasCertificate.23eb10"),
          body: formatCertificateTrustBody(action),
          confirmLabel: pomeLocaleRendererNasSyncPair.t("copy.trustThisCertificateOnly.e59a01"),
          cancelLabel: pomeLocaleRendererNasSyncPair.t("copy.cancel.2cd0f3"),
          fingerprint256: action.fingerprint256 || null,
          hostKey: action.hostKey || null,
        };
        next.needsTrustConfirm = true;
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
          title: pomeLocaleRendererNasSyncPair.t("copy.revokeTheTokenAndPairAgain.1e8757"),
          body: pomeLocaleRendererNasSyncPair.t("copy.thisWillClearTheLocalDeviceToken.2507ff"),
          confirmLabel: pomeLocaleRendererNasSyncPair.t("copy.revokeToken.f16f6a"),
          cancelLabel: pomeLocaleRendererNasSyncPair.t("copy.cancel.2cd0f3"),
        };
        return next;
      case 'cleared':
        next.bound = false;
        next.status = null;
        next.devices = [];
        next.dialog = null;
        next.toast = pomeLocaleRendererNasSyncPair.t("copy.bindingCleared.0c78d9");
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
              ? pomeLocaleRendererNasSyncPair.t("copy.syncProtocolIncompatibleUpdatePomePanelOn.2d166f")
              : action.status.schemaUpgradeTarget === 'fpk'
                ? pomeLocaleRendererNasSyncPair.t("copy.syncProtocolIncompatibleUpdatePomePanelSync.6a4b67")
                : pomeLocaleRendererNasSyncPair.t("copy.syncProtocolIncompatibleUpdateTheDesktopApp.8bf1e9"));
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
    trustCertificateAccepted = false,
    certificateFingerprint = null,
    deviceName,
  }) {
    const validated = validatePairCode(code);
    if (!validated.ok) return { ok: false, error: validated.error, message: validated.message };

    if (!baseUrl || !String(baseUrl).trim()) {
      return { ok: false, error: 'empty_base_url', message: pomeLocaleRendererNasSyncPair.t("copy.enterANasAddress.1eab70") };
    }

    const policy = await api.syncPairHttpPolicy(baseUrl);
    if (!policy.ok) {
      return { ok: false, error: policy.error || 'invalid_base_url', message: pomeLocaleRendererNasSyncPair.t("copy.invalidNasAddress.4d188b") };
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
      trustCertificateAccepted: Boolean(trustCertificateAccepted),
      certificateFingerprint: certificateFingerprint || undefined,
      deviceName,
    });

    if (!result.ok) {
      if (isHttpsOnHttpFailure(result)) {
        return {
          ok: false,
          error: 'https_on_http',
          message: pomeLocaleRendererNasSyncPair.systemText(HTTPS_ON_HTTP_MESSAGE),
          needsTrustConfirm: false,
          certificateError: false,
          dialog: null,
        };
      }
      const messages = {
        secure_storage_unavailable: pomeLocaleRendererNasSyncPair.t("copy.systemSecureStorageIsUnavailableTokensCannot.6333a1"),
        http_confirm_required: pomeLocaleRendererNasSyncPair.t("copy.confirmInsecureHttpPairingFirst.3a443b"),
        insecure_http_not_allowed: pomeLocaleRendererNasSyncPair.t("copy.unencryptedHttpIsNotAllowed.86c663"),
        empty: pomeLocaleRendererNasSyncPair.t("copy.enterAPairingCode.03ac12"),
        invalid_format: pomeLocaleRendererNasSyncPair.t("copy.enterA6DigitPairingCode.1468c4"),
        code_not_found: pomeLocaleRendererNasSyncPair.t("copy.invalidPairingCode.752fe0"),
        code_consumed: pomeLocaleRendererNasSyncPair.t("copy.pairingCodeAlreadyUsed.c6f326"),
        code_expired: pomeLocaleRendererNasSyncPair.t("copy.pairingCodeExpired.23a951"),
        certificate_error: pomeLocaleRendererNasSyncPair.t("copy.theCertificateIsNotTrustedVerifyIts.393764"),
        certificate_fingerprint_mismatch: pomeLocaleRendererNasSyncPair.t("copy.theCertificateFingerprintChangedVerifyItAgain.87032f"),
        certificate_fingerprint_required: pomeLocaleRendererNasSyncPair.t("copy.theCertificateFingerprintIsMissing.65bd77"),
        timeout: pomeLocaleRendererNasSyncPair.systemText(CONNECTION_TIMEOUT_MESSAGE),
        remote_closed: pomeLocaleRendererNasSyncPair.t("copy.theHostWasReachedButTheSync.1bab4e"),
        connection_refused: pomeLocaleRendererNasSyncPair.t("copy.canTReachTheSyncPortCheck.3a3a3e"),
        schema_incompatible: result.message
          || (result.upgradeTarget === 'desktop'
            ? pomeLocaleRendererNasSyncPair.t("copy.syncProtocolIncompatibleUpdatePomePanelOn.2d166f")
            : result.upgradeTarget === 'fpk'
              ? pomeLocaleRendererNasSyncPair.t("copy.syncProtocolIncompatibleUpdatePomePanelSync.6a4b67")
              : pomeLocaleRendererNasSyncPair.t("copy.syncProtocolIncompatibleUpdateTheDesktopApp.8bf1e9")),
      };
      const needsTrustConfirm = shouldOpenCertificateTrustDialog(result);
      const incoming = result.message && /[\u4e00-\u9fff]/.test(result.message) ? result.message : '';
      return {
        ok: false,
        error: result.error,
        message: pomeLocaleRendererNasSyncPair.systemText(incoming || messages[result.error] || result.message || result.error || pomeLocaleRendererNasSyncPair.t("copy.pairingFailed.aea73b")),
        needsTrustConfirm,
        certificateError: result.certificateError === true || result.error === 'certificate_error',
        confirmText: result.confirmText ? pomeLocaleRendererNasSyncPair.systemText(result.confirmText) : (needsTrustConfirm ? pomeLocaleRendererNasSyncPair.systemText(CERTIFICATE_TRUST_CONFIRM_TEXT) : null),
        fingerprint256: result.fingerprint256 || null,
        subjectCN: result.subjectCN || null,
        issuerCN: result.issuerCN || null,
        validFrom: result.validFrom || null,
        validTo: result.validTo || null,
        hostKey: result.hostKey || null,
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
    CONNECTION_TIMEOUT_MESSAGE,
    CERTIFICATE_TRUST_CONFIRM_TEXT,
    formatCertificateTrustBody,
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
