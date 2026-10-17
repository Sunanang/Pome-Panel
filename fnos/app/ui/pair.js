'use strict';
const pomeLocaleFnosAppUiPair = typeof module === 'object' && module.exports ? require("../../../localization/runtime") : globalThis.PomeI18n;


/**
 * FPK Web pair UI — gatewayPrefix-aware paths, /me session, CSRF, countdown, devices.
 * Browser: auto-boots on DOM. Node tests: require() exports helpers only (no auto-boot).
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    root.PomeFnOsPairUi = api;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => api.boot(document, window));
    } else if (document.getElementById('pair-start-btn')) {
      api.boot(document, window);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_GATEWAY_PREFIX = '/app/pome-panel';
  const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

  const ERROR_COPY = Object.freeze({
    get unauthenticated() { return pomeLocaleFnosAppUiPair.t("copy.noNasSignInSessionDetectedOpen.fa00e9"); },
    get gateway_session_required() { return pomeLocaleFnosAppUiPair.t("copy.noNasSignInSessionDetectedOpen.fa00e9"); },
    get pair_start_gateway_only() { return pomeLocaleFnosAppUiPair.t("copy.openPairingFromTheNasAppEntry.8d19ba"); },
    get csrf_missing() { return pomeLocaleFnosAppUiPair.t("copy.securityCheckFailedCsrfMissingRefreshAnd.2fdbdd"); },
    get csrf_invalid() { return pomeLocaleFnosAppUiPair.t("copy.securityCheckFailedInvalidCsrfRefreshAnd.4e816f"); },
    get csrf_expired() { return pomeLocaleFnosAppUiPair.t("copy.securityCheckExpiredGenerateAgain.d1ecc0"); },
    get csrf_uid_mismatch() { return pomeLocaleFnosAppUiPair.t("copy.securityCheckDoesNotMatchTheCurrent.fcbf62"); },
    get origin_missing() { return pomeLocaleFnosAppUiPair.t("copy.theBrowserDidNotProvideOriginInformation.e7fd62"); },
    get origin_rejected() { return pomeLocaleFnosAppUiPair.t("copy.originVerificationFailedOpenThisPageFrom.9a938b"); },
    get code_must_not_be_in_url() { return pomeLocaleFnosAppUiPair.t("copy.invalidRequestUseThePageButtonTo.0c95a8"); },
    get network_error() { return pomeLocaleFnosAppUiPair.t("copy.networkRequestFailedCheckThatTheApp.eedb3a"); },
    get timeout() { return pomeLocaleFnosAppUiPair.t("copy.requestTimedOutCheckThatTheApp.c2946e"); },
    get invalid_response() { return pomeLocaleFnosAppUiPair.t("copy.couldnTParseTheServerResponseUpdate.149dec"); },
    get empty_pairing_code() { return pomeLocaleFnosAppUiPair.t("copy.theServerDidNotReturnAPairing.b5bf20"); },
    get me_unavailable_on_device_port() { return pomeLocaleFnosAppUiPair.t("copy.theDeviceSyncPortHasNoGateway.b92d8a"); },
  });

  function resolveApiPrefix(pathname, metaPrefix) {
    if (metaPrefix != null && String(metaPrefix).trim() !== '') {
      return String(metaPrefix).trim().replace(/\/$/, '');
    }
    const raw = String(pathname || '/');
    // Only strip real static assets. A dotted name is not a file by itself.
    const withoutFile = raw.replace(/\/[^/]+\.(?:html|js|css|png|svg|json)$/i, '');
    const cleaned = withoutFile.replace(/\/$/, '');
    if (cleaned && cleaned !== '') return cleaned;
    return '';
  }

  function apiUrl(prefix, path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    if (!prefix) return p;
    return `${prefix.replace(/\/$/, '')}${p}`;
  }

  function formatRemaining(ms) {
    if (ms == null || Number.isNaN(ms)) return '';
    if (ms <= 0) return pomeLocaleFnosAppUiPair.t("copy.expired.2fe0e3");
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return pomeLocaleFnosAppUiPair.t("copy.remaining.22c42b", { arg1: (m), arg2: (String(s).padStart(2, '0')) });
  }

  function humanError(codeOrMessage, fallback) {
    if (codeOrMessage == null || codeOrMessage === '') {
      return fallback || ERROR_COPY.network_error;
    }
    const key = String(codeOrMessage);
    if (ERROR_COPY[key]) return ERROR_COPY[key];
    // Never surface raw /api paths in status copy.
    if (/\/api\/v1\//i.test(key)) return fallback || pomeLocaleFnosAppUiPair.t("copy.operationFailedRetry.e113c7");
    return key;
  }

  function formatDevicePortCopy(port, host, state) {
    const n = Number(port);
    const enabled = !state || state.enabled !== false;
    if (enabled && Number.isInteger(n) && n >= 1 && n <= 65535) {
      const lanEnabled = state && state.lanEnabled === true
        || host === '0.0.0.0'
        || host === '::';
      const frpTarget = (state && state.frpTarget)
        || `127.0.0.1:${n}`;
      const lanHint = lanEnabled
        ? pomeLocaleFnosAppUiPair.t("copy.lanListeningEnabledOnTheSameWi.7e6131", { arg1: (host || '0.0.0.0'), arg2: (n) })
        : pomeLocaleFnosAppUiPair.t("copy.thisPortListensOnLocalhostOnlyFor.c4d3bd");
      return {
        value: String(n),
        hint: pomeLocaleFnosAppUiPair.t("copy.thisIsTheFixedPortSetDuring.24c02b", { arg1: (lanHint), arg2: (n) }),
        copyText: frpTarget,
        available: true,
      };
    }
    if (state && state.source === 'unconfigured') {
      return {
        value: pomeLocaleFnosAppUiPair.t("copy.notConfigured.80a57e"),
        hint: pomeLocaleFnosAppUiPair.t("copy.noDeviceSyncPortConfiguredOpenNas.b24272"),
        copyText: '',
        available: false,
      };
    }
    if (state && state.enabled === false) {
      return {
        value: pomeLocaleFnosAppUiPair.t("copy.disabled.3cffa9"),
        hint: pomeLocaleFnosAppUiPair.t("copy.theDeviceSyncPortIsnTListening.2d3b0f"),
        copyText: '',
        available: false,
      };
    }
    return {
      value: pomeLocaleFnosAppUiPair.t("copy.notConfigured.80a57e"),
      hint: pomeLocaleFnosAppUiPair.t("copy.noDeviceSyncPortConfiguredSetIt.ccf131"),
      copyText: '',
      available: false,
    };
  }

  function extractPairingCode(body) {
    if (!body || typeof body !== 'object') return '';
    const raw = body.pairingCode || body.code || '';
    const code = String(raw).trim();
    if (/^\d{6}$/.test(code)) return code;
    return code;
  }

  function createPairUiController(opts = {}) {
    const doc = opts.document;
    const win = opts.window || (typeof window !== 'undefined' ? window : null);
    const fetchImpl = opts.fetch || (win && win.fetch && win.fetch.bind(win)) || globalThis.fetch;
    const timeoutMs = opts.fetchTimeoutMs != null ? Number(opts.fetchTimeoutMs) : DEFAULT_FETCH_TIMEOUT_MS;
    const metaEl = doc && doc.querySelector('meta[name="gateway-prefix"]');
    const pathname = (win && win.location && win.location.pathname) || opts.pathname || '/';
    let apiPrefix = resolveApiPrefix(
      pathname,
      opts.gatewayPrefix != null ? opts.gatewayPrefix : (metaEl && metaEl.getAttribute('content')),
    );
    if (!apiPrefix && opts.preferDefaultPrefix !== false) {
      apiPrefix = DEFAULT_GATEWAY_PREFIX;
    }

    let csrfToken = '';
    let expiryTimer = null;
    let expiresAt = null;
    let sessionUser = null;

    const els = {
      status: doc && doc.getElementById('pair-status'),
      code: doc && doc.getElementById('pair-code'),
      codeWrap: doc && doc.getElementById('pair-code-wrap'),
      expiry: doc && doc.getElementById('pair-expiry'),
      list: doc && doc.getElementById('device-list'),
      empty: doc && doc.getElementById('device-empty'),
      startBtn: doc && doc.getElementById('pair-start-btn'),
      refreshBtn: doc && doc.getElementById('pair-refresh-btn'),
      sessionPill: doc && doc.getElementById('session-pill'),
      sessionNote: doc && doc.getElementById('session-note'),
      portValue: doc && doc.getElementById('device-port-value'),
      portHint: doc && doc.getElementById('device-port-hint'),
      portCopy: doc && doc.getElementById('device-port-copy'),
    };

    function setStatus(text, kind) {
      if (!els.status) return;
      pomeLocaleFnosAppUiPair.bind(els.status, 'textContent', () => pomeLocaleFnosAppUiPair.systemText(text || ''));
      if (kind) els.status.setAttribute('data-kind', kind);
      else els.status.removeAttribute('data-kind');
    }

    function setSessionPill(state, text) {
      if (!els.sessionPill) return;
      els.sessionPill.dataset.state = state || 'unknown';
      pomeLocaleFnosAppUiPair.bind(els.sessionPill, 'textContent', () => pomeLocaleFnosAppUiPair.systemText(text || ''));
    }

    function setPairingEnabled(ok) {
      if (els.startBtn) els.startBtn.disabled = !ok;
      if (!els.sessionNote) return;
      pomeLocaleFnosAppUiPair.bind(els.sessionNote, "textContent", () => (ok
        ? pomeLocaleFnosAppUiPair.t("copy.usesYourCurrentNasSignInNo.efe799")
        : pomeLocaleFnosAppUiPair.t("copy.noNasSignInDetectedSignIn.ab79a9")));
    }

    win?.addEventListener?.('pome:language-changed', () => { if (expiresAt != null) tickExpiry(); });

    function clearExpiryTimer() {
      if (expiryTimer) {
        clearInterval(expiryTimer);
        expiryTimer = null;
      }
    }

    function tickExpiry() {
      if (!els.expiry || expiresAt == null) return;
      const left = expiresAt - Date.now();
      els.expiry.textContent = formatRemaining(left);
      if (left <= 0) {
        clearExpiryTimer();
        setStatus(pomeLocaleFnosAppUiPair.t("copy.pairingCodeExpiredGenerateAnother.5ea6f3"), 'warning');
      }
    }

    function showPairingCode(code, expiresAtIso) {
      if (els.codeWrap) els.codeWrap.hidden = false;
      if (els.code) els.code.textContent = code || '';
      expiresAt = expiresAtIso ? Date.parse(expiresAtIso) : null;
      if (Number.isNaN(expiresAt)) expiresAt = null;
      clearExpiryTimer();
      tickExpiry();
      if (expiresAt != null && win) {
        expiryTimer = win.setInterval(tickExpiry, 1000);
      }
    }

    function hidePairingCode() {
      clearExpiryTimer();
      expiresAt = null;
      if (els.codeWrap) els.codeWrap.hidden = true;
      if (els.code) els.code.textContent = '';
      if (els.expiry) els.expiry.textContent = '';
    }

    async function parseJson(res) {
      const text = await res.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { error: 'invalid_response', _raw: text.slice(0, 80) };
      }
    }

    async function fetchJson(path, init = {}) {
      if (!fetchImpl) {
        const err = new Error('network_error');
        err.code = 'network_error';
        throw err;
      }
      const url = apiUrl(apiPrefix, path);
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      let timer = null;
      if (ctrl && timeoutMs > 0) {
        timer = setTimeout(() => ctrl.abort(), timeoutMs);
      }
      try {
        const res = await fetchImpl(url, {
          credentials: 'same-origin',
          ...init,
          signal: ctrl ? ctrl.signal : init.signal,
          headers: {
            ...(init.headers || {}),
          },
        });
        const body = await parseJson(res);
        return { res, body, url };
      } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
        const wrapped = new Error(aborted ? 'timeout' : 'network_error');
        wrapped.code = aborted ? 'timeout' : 'network_error';
        wrapped.cause = err;
        throw wrapped;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function checkSession() {
      try {
        const { res, body } = await fetchJson('/api/v1/me');
        if (!res.ok) {
          sessionUser = null;
          setSessionPill('error', pomeLocaleFnosAppUiPair.t("copy.notSignedIn.c1f658"));
          setPairingEnabled(false);
          setStatus(humanError(body.error, ERROR_COPY.gateway_session_required), 'error');
          return { ok: false, error: body.error || 'gateway_session_required' };
        }
        sessionUser = {
          uid: body.uid,
          username: body.username || body.uid || pomeLocaleFnosAppUiPair.t("copy.signedIn.0a01ee"),
        };
        const label = body.username ? pomeLocaleFnosAppUiPair.t("copy.signedIn.a28816", { arg1: (body.username) }) : pomeLocaleFnosAppUiPair.t("copy.signedIn.0a01ee");
        setSessionPill('ok', label);
        setPairingEnabled(true);
        return { ok: true, user: sessionUser };
      } catch (err) {
        sessionUser = null;
        setSessionPill('error', pomeLocaleFnosAppUiPair.t("copy.sessionError.d23da9"));
        setPairingEnabled(false);
        setStatus(humanError(err.code || err.message, ERROR_COPY.network_error), 'error');
        return { ok: false, error: err.code || 'network_error' };
      }
    }

    async function refreshCsrf() {
      try {
        const { res, body } = await fetchJson('/api/v1/pair/csrf');
        if (!res.ok) {
          csrfToken = '';
          if (!sessionUser) setSessionPill('error', pomeLocaleFnosAppUiPair.t("copy.notSignedIn.c1f658"));
          setStatus(humanError(body.error, pomeLocaleFnosAppUiPair.t("copy.couldnTObtainSecurityVerificationNasSign.9ac321")), 'error');
          return false;
        }
        csrfToken = body.csrfToken || '';
        if (!csrfToken) {
          setStatus(humanError('invalid_response', pomeLocaleFnosAppUiPair.t("copy.noSecurityTokenReceivedRefreshAndRetry.7d6509")), 'error');
          return false;
        }
        if (!sessionUser) setSessionPill('ok', pomeLocaleFnosAppUiPair.t("copy.signedIn.0a01ee"));
        return true;
      } catch (err) {
        csrfToken = '';
        setSessionPill('error', pomeLocaleFnosAppUiPair.t("copy.sessionError.d23da9"));
        setStatus(humanError(err.code || err.message), 'error');
        return false;
      }
    }

    async function startPair() {
      if (els.startBtn) els.startBtn.disabled = true;
      try {
        setStatus(pomeLocaleFnosAppUiPair.t("copy.generatingPairingCode.23cabe"), '');
        const session = await checkSession();
        if (!session.ok) {
          hidePairingCode();
          return null;
        }
        const ok = await refreshCsrf();
        if (!ok) {
          hidePairingCode();
          return null;
        }
        const { res, body } = await fetchJson('/api/v1/pair/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: '{}',
        });
        csrfToken = '';
        if (!res.ok) {
          hidePairingCode();
          setStatus(humanError(body.error, pomeLocaleFnosAppUiPair.t("copy.generationFailed.a5e77d", { arg1: (res.status) })), 'error');
          return null;
        }
        const code = extractPairingCode(body);
        if (!code || !/^\d{6}$/.test(code)) {
          hidePairingCode();
          setStatus(humanError('empty_pairing_code'), 'error');
          return null;
        }
        showPairingCode(code, body.expiresAt);
        setStatus(pomeLocaleFnosAppUiPair.t("copy.pairingCodeGeneratedShownOnceOnly.8cb3f3"), 'ok');
        return { ...body, pairingCode: code };
      } catch (err) {
        hidePairingCode();
        setStatus(humanError(err.code || err.message, pomeLocaleFnosAppUiPair.t("copy.generationFailed.65b4b0", { arg1: (err.message || pomeLocaleFnosAppUiPair.t("copy.unknownError.13a466")) })), 'error');
        return null;
      } finally {
        if (els.startBtn) els.startBtn.disabled = !sessionUser;
      }
    }

    function applyDevicePortCopy(port, host, state) {
      const copy = formatDevicePortCopy(port, host, state);
      if (els.portValue) {
        pomeLocaleFnosAppUiPair.bind(els.portValue, 'textContent', () => formatDevicePortCopy(port, host, state).value);
        els.portValue.copyText = copy.copyText || '';
      }
      if (els.portHint) pomeLocaleFnosAppUiPair.bind(els.portHint, 'textContent', () => formatDevicePortCopy(port, host, state).hint);
      if (els.portCopy) {
        els.portCopy.hidden = !copy.available;
        els.portCopy.copyText = copy.copyText || '';
      }
      return copy;
    }

    async function copyDevicePort() {
      const text = (els.portCopy && els.portCopy.copyText)
        || (els.portValue && els.portValue.copyText)
        || '';
      if (!text) return { ok: false };
      const clipboard = win && win.navigator && win.navigator.clipboard;
      try {
        if (clipboard && typeof clipboard.writeText === 'function') {
          await clipboard.writeText(text);
          if (els.portCopy) pomeLocaleFnosAppUiPair.bind(els.portCopy, "textContent", () => (pomeLocaleFnosAppUiPair.t("copy.copied.8f6f8d")));
          return { ok: true, text };
        }
      } catch {
        /* fall through */
      }
      if (els.portHint) {
        const previousHint = els.portHint.textContent || '';
        pomeLocaleFnosAppUiPair.bind(els.portHint, "textContent", () => pomeLocaleFnosAppUiPair.t("copy.copyManually.2acfcb", { arg1: text, arg2: pomeLocaleFnosAppUiPair.systemText(previousHint) }));
      }
      return { ok: false, text };
    }

    async function loadDevicePort() {
      try {
        const { res, body } = await fetchJson('/api/v1/device-port');
        if (!res.ok || !body || typeof body !== 'object') {
          applyDevicePortCopy(null, null, null);
          return { ok: false, port: null, host: null, enabled: false };
        }
        const copy = applyDevicePortCopy(body.port, body.host, {
          enabled: body.enabled,
          source: body.source,
          lanEnabled: body.lanEnabled === true,
          frpTarget: body.frpTarget || null,
        });
        return {
          ok: copy.available,
          port: copy.available ? Number(body.port) : null,
          host: copy.available ? (body.host || '127.0.0.1') : null,
          enabled: body.enabled !== false,
          lanEnabled: body.lanEnabled === true,
          target: copy.copyText || null,
        };
      } catch {
        applyDevicePortCopy(null, null, null);
        return { ok: false, port: null, host: null, enabled: false };
      }
    }

    async function loadDevices() {
      try {
        const { res, body } = await fetchJson('/api/v1/devices');
        if (!els.list) return { ok: res.ok, devices: [] };
        els.list.innerHTML = '';
        if (!res.ok) {
          if (els.empty) {
            els.empty.hidden = false;
            pomeLocaleFnosAppUiPair.bind(els.empty, "textContent", () => (humanError(body.error, pomeLocaleFnosAppUiPair.t("copy.couldnTLoadDevicesNasSignIn.3e92f4"))));
            els.empty.setAttribute('data-kind', 'error');
          }
          return { ok: false, devices: [], error: body.error };
        }
        const devices = (body && body.devices) || [];
        if (els.empty) {
          els.empty.hidden = devices.length > 0;
          pomeLocaleFnosAppUiPair.bind(els.empty, "textContent", () => (pomeLocaleFnosAppUiPair.t("copy.noDevicesYetPairedDesktopDevicesAppear.b75284")));
          els.empty.removeAttribute('data-kind');
        }
        for (const device of devices) {
          const li = doc.createElement('li');
          const label = doc.createElement('span');
          pomeLocaleFnosAppUiPair.bind(label, "textContent", () => (device.name || device.deviceId || pomeLocaleFnosAppUiPair.t("copy.devices.e15064")));
          if (device.insecureBound) {
            const badge = doc.createElement('span');
            badge.className = 'settings-nas-device-badge';
            pomeLocaleFnosAppUiPair.bind(badge, "textContent", () => (pomeLocaleFnosAppUiPair.t("copy.insecurePairingHttp.83e6cd")));
            label.appendChild(badge);
          }
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'workspace-button compact';
          pomeLocaleFnosAppUiPair.bind(btn, "textContent", () => (pomeLocaleFnosAppUiPair.t("copy.revoke.d8c68b")));
          btn.setAttribute('data-control-id', 'fnos.devices.revoke');
          btn.addEventListener('click', () => {
            void revokeDevice(device.deviceId);
          });
          li.appendChild(label);
          li.appendChild(btn);
          els.list.appendChild(li);
        }
        return { ok: true, devices };
      } catch (err) {
        if (els.empty) {
          els.empty.hidden = false;
          pomeLocaleFnosAppUiPair.bind(els.empty, "textContent", () => (humanError(err.code || err.message, pomeLocaleFnosAppUiPair.t("copy.couldnTLoadDevices.c84dca"))));
          els.empty.setAttribute('data-kind', 'error');
        }
        return { ok: false, devices: [], error: err.code || 'network_error' };
      }
    }

    async function revokeDevice(deviceId) {
      if (!deviceId) return;
      if (win && typeof win.confirm === 'function') {
        if (!win.confirm(pomeLocaleFnosAppUiPair.t("copy.revokeThisDeviceToken.ff516a"))) return;
      }
      try {
        await refreshCsrf();
        const headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
        const { res, body } = await fetchJson(
          `/api/v1/devices/${encodeURIComponent(deviceId)}/revoke`,
          {
            method: 'POST',
            headers,
            body: '{}',
          },
        );
        csrfToken = '';
        if (!res.ok) {
          setStatus(humanError(body.error, pomeLocaleFnosAppUiPair.t("copy.revocationFailed.eb0d97")), 'error');
          return;
        }
        setStatus(pomeLocaleFnosAppUiPair.t("copy.deviceRevoked.8de9da"), 'ok');
        await loadDevices();
      } catch (err) {
        setStatus(humanError(err.code || err.message, pomeLocaleFnosAppUiPair.t("copy.revocationFailed.eb0d97")), 'error');
      }
    }

    async function refreshAll() {
      if (els.refreshBtn) els.refreshBtn.disabled = true;
      try {
        setStatus(pomeLocaleFnosAppUiPair.t("copy.refreshing.7f3c83"), '');
        await loadDevicePort();
        const session = await checkSession();
        const devices = await loadDevices();
        if (session.ok && devices.ok) {
          setStatus(pomeLocaleFnosAppUiPair.t("copy.devicesAndSessionRefreshed.a45377"), 'ok');
        } else if (!session.ok) {
          setStatus(humanError(session.error, pomeLocaleFnosAppUiPair.t("copy.refreshFailedOpenWhileSignedInTo.00ca08")), 'error');
        } else {
          setStatus(humanError(devices.error, pomeLocaleFnosAppUiPair.t("copy.couldnTRefreshDevices.dbd455")), 'error');
        }
        return { sessionOk: session.ok, csrfOk: session.ok, devices };
      } finally {
        if (els.refreshBtn) els.refreshBtn.disabled = false;
      }
    }

    function bind() {
      if (els.startBtn) {
        els.startBtn.addEventListener('click', () => {
          void startPair().catch((err) => {
            setStatus(humanError(err && (err.code || err.message)), 'error');
          });
        });
      }
      if (els.refreshBtn) {
        els.refreshBtn.addEventListener('click', () => {
          void refreshAll().catch((err) => {
            setStatus(humanError(err && (err.code || err.message)), 'error');
          });
        });
      }
      if (els.portCopy) {
        els.portCopy.addEventListener('click', () => {
          void copyDevicePort();
        });
      }
    }

    async function init() {
      bind();
      setSessionPill('unknown', pomeLocaleFnosAppUiPair.t("copy.checkingSession.8667ba"));
      try {
        await loadDevicePort();
        await checkSession();
        await loadDevices();
      } catch (err) {
        setSessionPill('error', pomeLocaleFnosAppUiPair.t("copy.sessionError.d23da9"));
        setStatus(humanError(err && (err.code || err.message)), 'error');
      }
    }

    return {
      apiPrefix,
      resolveApiPrefix,
      apiUrl: (path) => apiUrl(apiPrefix, path),
      checkSession,
      refreshCsrf,
      startPair,
      loadDevicePort,
      copyDevicePort,
      loadDevices,
      refreshAll,
      revokeDevice,
      showPairingCode,
      hidePairingCode,
      setStatus,
      humanError,
      extractPairingCode,
      init,
      bind,
      getCsrfToken: () => csrfToken,
      getSessionUser: () => sessionUser,
    };
  }

  let activeController = null;

  function boot(doc, win) {
    activeController = createPairUiController({ document: doc, window: win });
    void activeController.init();
    return activeController;
  }

  function getActiveController() {
    return activeController;
  }

  return {
    DEFAULT_GATEWAY_PREFIX,
    DEFAULT_FETCH_TIMEOUT_MS,
    ERROR_COPY,
    resolveApiPrefix,
    apiUrl,
    formatRemaining,
    humanError,
    extractPairingCode,
    formatDevicePortCopy,
    createPairUiController,
    boot,
    getActiveController,
  };
});
