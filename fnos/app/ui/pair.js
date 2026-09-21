'use strict';

/**
 * FPK Web pair UI — resolve gatewayPrefix-aware API paths, CSRF, countdown, devices.
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

  function resolveApiPrefix(pathname, metaPrefix) {
    if (metaPrefix != null && String(metaPrefix).trim() !== '') {
      return String(metaPrefix).trim().replace(/\/$/, '');
    }
    const raw = String(pathname || '/');
    // /app/pome-panel  /app/pome-panel/  /app/pome-panel/index.html
    const withoutFile = raw.replace(/\/[^/]*\.[a-zA-Z0-9]+$/, '');
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
    if (ms <= 0) return '已过期';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `剩余 ${m}:${String(s).padStart(2, '0')}`;
  }

  function createPairUiController(opts = {}) {
    const doc = opts.document;
    const win = opts.window || (typeof window !== 'undefined' ? window : null);
    const fetchImpl = opts.fetch || (win && win.fetch && win.fetch.bind(win)) || globalThis.fetch;
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
    };

    function setStatus(text, kind) {
      if (!els.status) return;
      els.status.textContent = text || '';
      if (kind) els.status.setAttribute('data-kind', kind);
      else els.status.removeAttribute('data-kind');
    }

    function setSessionPill(state, text) {
      if (!els.sessionPill) return;
      els.sessionPill.dataset.state = state || 'unknown';
      els.sessionPill.textContent = text || '';
    }

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
        setStatus('配对码已过期，请重新生成', 'warning');
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
      try {
        return await res.json();
      } catch {
        return {};
      }
    }

    async function refreshCsrf() {
      const res = await fetchImpl(apiUrl(apiPrefix, '/api/v1/pair/csrf'), {
        credentials: 'same-origin',
      });
      const body = await parseJson(res);
      if (!res.ok) {
        csrfToken = '';
        setSessionPill('error', '未登录');
        setStatus(body.error || '无法获取 CSRF（需网关登录）', 'error');
        return false;
      }
      csrfToken = body.csrfToken || '';
      setSessionPill('ok', '已登录');
      return Boolean(csrfToken);
    }

    async function startPair() {
      if (els.startBtn) els.startBtn.disabled = true;
      try {
        const ok = await refreshCsrf();
        if (!ok) return null;
        const res = await fetchImpl(apiUrl(apiPrefix, '/api/v1/pair/start'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: '{}',
        });
        const body = await parseJson(res);
        csrfToken = '';
        if (!res.ok) {
          hidePairingCode();
          setStatus(body.error || '生成失败', 'error');
          return null;
        }
        showPairingCode(body.pairingCode || '', body.expiresAt);
        setStatus('配对码已生成（仅显示一次）', 'ok');
        return body;
      } finally {
        if (els.startBtn) els.startBtn.disabled = false;
      }
    }

    async function loadDevices() {
      const res = await fetchImpl(apiUrl(apiPrefix, '/api/v1/devices'), {
        credentials: 'same-origin',
      });
      const body = await parseJson(res);
      if (!els.list) return { ok: res.ok, devices: [] };
      els.list.innerHTML = '';
      if (!res.ok) {
        if (els.empty) {
          els.empty.hidden = false;
          els.empty.textContent = body.error || '无法加载设备列表（需网关登录）';
          els.empty.setAttribute('data-kind', 'error');
        }
        return { ok: false, devices: [], error: body.error };
      }
      const devices = (body && body.devices) || [];
      if (els.empty) {
        els.empty.hidden = devices.length > 0;
        els.empty.textContent = '尚无设备。桌面配对成功后显示；不安全绑定会标注。';
        els.empty.removeAttribute('data-kind');
      }
      for (const device of devices) {
        const li = doc.createElement('li');
        const label = doc.createElement('span');
        label.textContent = device.name || device.deviceId || '设备';
        if (device.insecureBound) {
          const badge = doc.createElement('span');
          badge.className = 'settings-nas-device-badge';
          badge.textContent = '不安全绑定 / HTTP';
          label.appendChild(badge);
        }
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'workspace-button compact';
        btn.textContent = '吊销';
        btn.setAttribute('data-control-id', 'fnos.devices.revoke');
        btn.addEventListener('click', () => {
          void revokeDevice(device.deviceId);
        });
        li.appendChild(label);
        li.appendChild(btn);
        els.list.appendChild(li);
      }
      return { ok: true, devices };
    }

    async function revokeDevice(deviceId) {
      if (!deviceId) return;
      if (win && typeof win.confirm === 'function') {
        if (!win.confirm('确认吊销该设备令牌？')) return;
      }
      await refreshCsrf();
      const headers = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      const res = await fetchImpl(
        apiUrl(apiPrefix, `/api/v1/devices/${encodeURIComponent(deviceId)}/revoke`),
        {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: '{}',
        },
      );
      csrfToken = '';
      if (!res.ok) {
        const body = await parseJson(res);
        setStatus(body.error || '吊销失败', 'error');
        return;
      }
      setStatus('设备已吊销', 'ok');
      await loadDevices();
    }

    async function refreshAll() {
      if (els.refreshBtn) els.refreshBtn.disabled = true;
      try {
        setStatus('刷新中…', '');
        const csrfOk = await refreshCsrf();
        const devices = await loadDevices();
        if (csrfOk && devices.ok) {
          setStatus('已刷新设备列表与会话', 'ok');
        } else if (!csrfOk) {
          setStatus('刷新失败：需网关登录会话', 'error');
        } else {
          setStatus(devices.error || '设备列表刷新失败', 'error');
        }
        return { csrfOk, devices };
      } finally {
        if (els.refreshBtn) els.refreshBtn.disabled = false;
      }
    }

    function bind() {
      if (els.startBtn) {
        els.startBtn.addEventListener('click', () => {
          void startPair();
        });
      }
      if (els.refreshBtn) {
        els.refreshBtn.addEventListener('click', () => {
          void refreshAll();
        });
      }
    }

    async function init() {
      bind();
      await refreshCsrf();
      await loadDevices();
    }

    return {
      apiPrefix,
      resolveApiPrefix,
      apiUrl: (path) => apiUrl(apiPrefix, path),
      refreshCsrf,
      startPair,
      loadDevices,
      refreshAll,
      revokeDevice,
      showPairingCode,
      hidePairingCode,
      setStatus,
      init,
      bind,
      getCsrfToken: () => csrfToken,
    };
  }

  function boot(doc, win) {
    const controller = createPairUiController({ document: doc, window: win });
    void controller.init();
    return controller;
  }

  return {
    DEFAULT_GATEWAY_PREFIX,
    resolveApiPrefix,
    apiUrl,
    formatRemaining,
    createPairUiController,
    boot,
  };
});
