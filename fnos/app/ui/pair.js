'use strict';

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
    unauthenticated: '未检测到飞牛登录会话，请在飞牛已登录状态下打开本页',
    gateway_session_required: '未检测到飞牛登录会话，请在飞牛已登录状态下打开本页',
    pair_start_gateway_only: '请从飞牛应用入口打开配对页，勿使用设备同步端口',
    csrf_missing: '安全校验失败（缺少 CSRF），请刷新后重试',
    csrf_invalid: '安全校验失败（CSRF 无效），请刷新后重试',
    csrf_expired: '安全校验已过期，请重新生成',
    csrf_uid_mismatch: '安全校验与当前用户不匹配，请重新登录飞牛后重试',
    origin_missing: '浏览器未提供来源信息，请从飞牛应用内打开本页',
    origin_rejected: '来源校验失败，请从飞牛应用内打开本页',
    code_must_not_be_in_url: '请求不合法，请使用页面按钮生成配对码',
    network_error: '网络请求失败，请检查应用是否已启动后重试',
    timeout: '请求超时，请确认应用已启动并重试',
    invalid_response: '服务器返回无法解析，请升级应用或稍后重试',
    empty_pairing_code: '服务器未返回配对码，请重试或覆盖安装最新版本',
    me_unavailable_on_device_port: '设备同步端口无网关会话，请从飞牛应用入口打开',
  });

  function resolveApiPrefix(pathname, metaPrefix) {
    if (metaPrefix != null && String(metaPrefix).trim() !== '') {
      return String(metaPrefix).trim().replace(/\/$/, '');
    }
    const raw = String(pathname || '/');
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

  function humanError(codeOrMessage, fallback) {
    if (codeOrMessage == null || codeOrMessage === '') {
      return fallback || ERROR_COPY.network_error;
    }
    const key = String(codeOrMessage);
    if (ERROR_COPY[key]) return ERROR_COPY[key];
    // Never surface raw /api paths in status copy.
    if (/\/api\/v1\//i.test(key)) return fallback || '操作失败，请重试';
    return key;
  }

  function formatDevicePortCopy(port, host, state) {
    const n = Number(port);
    const enabled = !state || state.enabled !== false;
    if (enabled && Number.isInteger(n) && n >= 1 && n <= 65535) {
      const bindHost = !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : String(host);
      return {
        value: String(n),
        hint: `这是安装时填写的固定端口。FRP 本地目标填 ${bindHost}:${n}；公网端口可自定（例如 34931）；Mac 同步地址用 http://公网IP:公网端口。不要填成 NAS:34931，除非安装时填的就是 34931。`,
        copyText: `${bindHost}:${n}`,
        available: true,
      };
    }
    if (state && state.enabled === false) {
      return {
        value: '未开启',
        hint: '设备同步端口未开启，本机没有在听。请在飞牛安装向导或应用设置中填写端口后重启。',
        copyText: '',
        available: false,
      };
    }
    return {
      value: '未配置',
      hint: '尚未配置设备同步端口。请在飞牛安装向导或应用设置里填写，然后重启应用。',
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
      els.status.textContent = text || '';
      if (kind) els.status.setAttribute('data-kind', kind);
      else els.status.removeAttribute('data-kind');
    }

    function setSessionPill(state, text) {
      if (!els.sessionPill) return;
      els.sessionPill.dataset.state = state || 'unknown';
      els.sessionPill.textContent = text || '';
    }

    function setPairingEnabled(ok) {
      if (els.startBtn) els.startBtn.disabled = !ok;
      if (!els.sessionNote) return;
      els.sessionNote.textContent = ok
        ? '沿用飞牛当前登录，无需在本应用再次登录。'
        : '未检测到飞牛登录。请先登录飞牛后再打开本应用，配对已停用。';
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
          setSessionPill('error', '未登录');
          setPairingEnabled(false);
          setStatus(humanError(body.error, ERROR_COPY.gateway_session_required), 'error');
          return { ok: false, error: body.error || 'gateway_session_required' };
        }
        sessionUser = {
          uid: body.uid,
          username: body.username || body.uid || '已登录',
        };
        const label = body.username ? `已登录 · ${body.username}` : '已登录';
        setSessionPill('ok', label);
        setPairingEnabled(true);
        return { ok: true, user: sessionUser };
      } catch (err) {
        sessionUser = null;
        setSessionPill('error', '会话失败');
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
          if (!sessionUser) setSessionPill('error', '未登录');
          setStatus(humanError(body.error, '无法获取安全校验（需飞牛登录）'), 'error');
          return false;
        }
        csrfToken = body.csrfToken || '';
        if (!csrfToken) {
          setStatus(humanError('invalid_response', '未拿到安全校验令牌，请刷新重试'), 'error');
          return false;
        }
        if (!sessionUser) setSessionPill('ok', '已登录');
        return true;
      } catch (err) {
        csrfToken = '';
        setSessionPill('error', '会话失败');
        setStatus(humanError(err.code || err.message), 'error');
        return false;
      }
    }

    async function startPair() {
      if (els.startBtn) els.startBtn.disabled = true;
      try {
        setStatus('正在生成配对码…', '');
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
          setStatus(humanError(body.error, `生成失败（${res.status}）`), 'error');
          return null;
        }
        const code = extractPairingCode(body);
        if (!code || !/^\d{6}$/.test(code)) {
          hidePairingCode();
          setStatus(humanError('empty_pairing_code'), 'error');
          return null;
        }
        showPairingCode(code, body.expiresAt);
        setStatus('配对码已生成（仅显示一次）', 'ok');
        return { ...body, pairingCode: code };
      } catch (err) {
        hidePairingCode();
        setStatus(humanError(err.code || err.message, `生成失败：${err.message || '未知错误'}`), 'error');
        return null;
      } finally {
        if (els.startBtn) els.startBtn.disabled = !sessionUser;
      }
    }

    function applyDevicePortCopy(port, host, state) {
      const copy = formatDevicePortCopy(port, host, state);
      if (els.portValue) {
        els.portValue.textContent = copy.value;
        els.portValue.copyText = copy.copyText || '';
      }
      if (els.portHint) els.portHint.textContent = copy.hint;
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
          if (els.portCopy) els.portCopy.textContent = '已复制';
          return { ok: true, text };
        }
      } catch {
        /* fall through */
      }
      if (els.portHint) {
        els.portHint.textContent = `请手动复制 ${text}。${els.portHint.textContent || ''}`;
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
        const copy = applyDevicePortCopy(body.port, body.host, { enabled: body.enabled });
        return {
          ok: copy.available,
          port: copy.available ? Number(body.port) : null,
          host: copy.available ? (body.host || '127.0.0.1') : null,
          enabled: body.enabled !== false,
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
            els.empty.textContent = humanError(body.error, '无法加载设备列表（需飞牛登录）');
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
      } catch (err) {
        if (els.empty) {
          els.empty.hidden = false;
          els.empty.textContent = humanError(err.code || err.message, '无法加载设备列表');
          els.empty.setAttribute('data-kind', 'error');
        }
        return { ok: false, devices: [], error: err.code || 'network_error' };
      }
    }

    async function revokeDevice(deviceId) {
      if (!deviceId) return;
      if (win && typeof win.confirm === 'function') {
        if (!win.confirm('确认吊销该设备令牌？')) return;
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
          setStatus(humanError(body.error, '吊销失败'), 'error');
          return;
        }
        setStatus('设备已吊销', 'ok');
        await loadDevices();
      } catch (err) {
        setStatus(humanError(err.code || err.message, '吊销失败'), 'error');
      }
    }

    async function refreshAll() {
      if (els.refreshBtn) els.refreshBtn.disabled = true;
      try {
        setStatus('刷新中…', '');
        await loadDevicePort();
        const session = await checkSession();
        const devices = await loadDevices();
        if (session.ok && devices.ok) {
          setStatus('已刷新设备列表与会话', 'ok');
        } else if (!session.ok) {
          setStatus(humanError(session.error, '刷新失败：需在飞牛已登录下打开'), 'error');
        } else {
          setStatus(humanError(devices.error, '设备列表刷新失败'), 'error');
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
      setSessionPill('unknown', '检测会话…');
      try {
        await loadDevicePort();
        await checkSession();
        await loadDevices();
      } catch (err) {
        setSessionPill('error', '会话失败');
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
