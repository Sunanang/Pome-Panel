'use strict';

/**
 * Multi-endpoint canonicalization, HTTP switch policy, and failover rules (T6 / §8 / §9 / §11).
 * Pure CommonJS — shared by desktop main process and tests.
 */

const ENDPOINT_KINDS = Object.freeze(['gateway', 'device-port', 'fn-connect', 'frp', 'custom']);

const SYNC_UI_STATES = Object.freeze([
  'unbound',
  'migrating',
  'syncing',
  'synced',
  'offline_pending',
  'needs_reauth',
  'schema_incompatible',
  'migration_failed',
  'certificate_error',
  'endpoint_disabled',
]);

const HTTP_INSECURE_CONFIRM_TEXT =
  '该地址不加密，设备令牌与待办内容可能被窃听或篡改。确认允许明文 HTTP？';

/** HTTPS client spoke to a peer that is plaintext HTTP (not a certificate problem). */
const HTTPS_ON_HTTP_MESSAGE =
  '该地址说的是 HTTP，不是 HTTPS。请把 Base URL 改为 http://…';

const HTTP_INSECURE_WARNING_TEXT = '不安全连接：当前有启用的明文 HTTP endpoint';

const DEVICE_PORT_GUIDANCE_TEXT =
  '统一网关 Bearer 不可用时，可添加「设备同步端口」endpoint（与网关可并存）。端口不写死，请填写 FPK 展示的完整 URL。';

const APP_PATH_SEGMENT = 'pome-panel-sync';

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * Canonicalize a sync base URL.
 * Rejects credentials / query / fragment; strips trailing slash; normalizes default ports;
 * ensures appPath appears at most once.
 *
 * @param {string} raw
 * @returns {{ ok: true, canonical: string, protocol: string, host: string, isLoopback: boolean }
 *   | { ok: false, error: string }}
 */
function canonicalizeEndpointUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return { ok: false, error: 'empty_url' };

  let url;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, error: 'unsupported_protocol' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'credentials_not_allowed' };
  }
  if (url.search || url.hash) {
    return { ok: false, error: 'query_or_fragment_not_allowed' };
  }

  let pathname = url.pathname || '/';
  // Collapse duplicate appPath segments (only splice once).
  const parts = pathname.split('/').filter(Boolean);
  const appIdx = parts.findIndex((p) => p === APP_PATH_SEGMENT);
  if (appIdx >= 0) {
    const next = parts.slice(0, appIdx + 1);
    // Drop any subsequent duplicate APP_PATH_SEGMENT
    for (let i = appIdx + 1; i < parts.length; i += 1) {
      if (parts[i] !== APP_PATH_SEGMENT) next.push(parts[i]);
    }
    pathname = `/${next.join('/')}`;
  }
  pathname = pathname.replace(/\/+$/, '') || '';

  const isDefaultPort =
    (protocol === 'https:' && (url.port === '' || url.port === '443')) ||
    (protocol === 'http:' && (url.port === '' || url.port === '80'));
  const host = url.hostname.toLowerCase();
  const portPart = isDefaultPort || !url.port ? '' : `:${url.port}`;
  const canonical = `${protocol}//${host}${portPart}${pathname}`;

  return {
    ok: true,
    canonical,
    protocol,
    host,
    isLoopback: isLoopbackHost(host),
  };
}

/**
 * HTTP allow policy for a candidate baseUrl + persisted allowInsecureHttp flag.
 */
function endpointHttpPolicy({ baseUrl, allowInsecureHttp = false } = {}) {
  const canon = canonicalizeEndpointUrl(baseUrl);
  if (!canon.ok) {
    return { ok: false, error: canon.error, allowed: false, isLoopback: false, requiresConfirm: false };
  }
  if (canon.protocol === 'https:') {
    return {
      ok: true,
      allowed: true,
      isLoopback: canon.isLoopback,
      requiresConfirm: false,
      protocol: canon.protocol,
      canonical: canon.canonical,
    };
  }
  // http:
  if (canon.isLoopback) {
    return {
      ok: true,
      allowed: true,
      isLoopback: true,
      requiresConfirm: false,
      protocol: canon.protocol,
      canonical: canon.canonical,
      exemptLoopback: true,
    };
  }
  const allowed = allowInsecureHttp === true;
  return {
    ok: true,
    allowed,
    isLoopback: false,
    requiresConfirm: !allowed,
    protocol: canon.protocol,
    canonical: canon.canonical,
    confirmText: HTTP_INSECURE_CONFIRM_TEXT,
    warningText: HTTP_INSECURE_WARNING_TEXT,
  };
}

/**
 * Apply allowInsecureHttp toggle. Closing HTTP on non-loopback → disabledByPolicy.
 * Never rewrites http→https.
 */
function applyAllowInsecureHttpToggle(endpoint, enable, { confirmed = false } = {}) {
  const next = { ...endpoint };
  const canon = canonicalizeEndpointUrl(endpoint.baseUrl);
  if (!canon.ok) return { ok: false, error: canon.error };

  if (enable) {
    if (canon.protocol === 'http:' && !canon.isLoopback && !confirmed) {
      return {
        ok: false,
        error: 'http_confirm_required',
        confirmText: HTTP_INSECURE_CONFIRM_TEXT,
        endpoint: next,
      };
    }
    next.allowInsecureHttp = canon.protocol === 'http:' && !canon.isLoopback;
    next.disabledByPolicy = false;
    next.enabled = true;
    return { ok: true, endpoint: next, rewrittenToHttps: false };
  }

  // Turning off
  next.allowInsecureHttp = false;
  if (canon.protocol === 'http:' && !canon.isLoopback) {
    next.disabledByPolicy = true;
    next.enabled = false;
  }
  // Explicit: do not mutate baseUrl to https
  return {
    ok: true,
    endpoint: next,
    rewrittenToHttps: false,
    policyMessage: next.disabledByPolicy
      ? '已停用：需改为 HTTPS 或重新开启开关'
      : null,
  };
}

/**
 * Changing baseUrl always resets allowInsecureHttp to false (§8.1).
 */
function applyEndpointBaseUrlChange(endpoint, nextBaseUrl) {
  const canon = canonicalizeEndpointUrl(nextBaseUrl);
  if (!canon.ok) return { ok: false, error: canon.error };
  return {
    ok: true,
    endpoint: {
      ...endpoint,
      baseUrl: canon.canonical,
      allowInsecureHttp: false,
      disabledByPolicy: false,
      lastError: null,
    },
  };
}

function transportErrorText(errorOrStatus) {
  if (errorOrStatus && typeof errorOrStatus === 'object') {
    return [errorOrStatus.code, errorOrStatus.errno, errorOrStatus.error, errorOrStatus.message, errorOrStatus.reason]
      .filter((part) => part != null && part !== '')
      .join(' ');
  }
  return String(errorOrStatus ?? '');
}

/**
 * OpenSSL/Chromium: HTTPS client received a plaintext HTTP record.
 * "wrong version number" is not a certificate the user can trust.
 */
function isHttpsOnPlainHttp(raw) {
  const text = String(raw || '').toLowerCase();
  return (
    /(?:^|[^a-z0-9])https_on_http(?:$|[^a-z0-9])/.test(text)
    || /wrong version number/.test(text)
    || /err_ssl_wrong_version_number/.test(text)
    || /ssl_r_wrong_version_number/.test(text)
  );
}

/**
 * Classify a transport error for failover.
 * TLS certificate failures are security errors — never failover, and may ask
 * the user to trust a specific certificate.
 * HTTPS pointed at plaintext HTTP is a protocol mismatch: tell the user to
 * switch the Base URL to http://, and do not offer certificate trust.
 */
function classifyTransportError(errorOrStatus) {
  if (errorOrStatus == null) return { kind: 'unknown', transferable: false };

  if (typeof errorOrStatus === 'number') {
    const status = errorOrStatus;
    if (status === 502 || status === 503 || status === 504) {
      return { kind: 'gateway_unavailable', transferable: true, status };
    }
    if (status === 401 || status === 403) {
      return { kind: 'auth', transferable: false, status };
    }
    if (status === 409 || status === 422) {
      return { kind: 'protocol', transferable: false, status };
    }
    return { kind: 'http', transferable: false, status };
  }

  const raw = transportErrorText(errorOrStatus).toLowerCase();

  if (isHttpsOnPlainHttp(raw)) {
    return {
      kind: 'https_on_http',
      transferable: false,
      needsTrustConfirm: false,
      certificateError: false,
      userMessage: HTTPS_ON_HTTP_MESSAGE,
      uiState: null,
    };
  }

  if (
    /cert|certificate|unable[_ ]to[_ ]verify|self[- _]signed|tls|ssl|err_tls|err_cert|untrust/.test(raw)
  ) {
    return {
      kind: 'certificate_error',
      transferable: false,
      needsTrustConfirm: true,
      certificateError: true,
      uiState: 'certificate_error',
    };
  }
  if (/enotfound|getaddrinfo|dns/.test(raw)) {
    return { kind: 'dns', transferable: true };
  }
  if (/econnrefused|connection refused/.test(raw)) {
    return { kind: 'connection_refused', transferable: true };
  }
  if (/etimedout|timeout|esockettimedout/.test(raw)) {
    return { kind: 'timeout', transferable: true };
  }
  if (/econnreset|network|eai_again/.test(raw)) {
    return { kind: 'network', transferable: true };
  }
  return { kind: 'unknown', transferable: false };
}

/**
 * Select the next eligible endpoint for a request round.
 * Skips disabled / disabledByPolicy; respects priority ascending; same serverId+uid binding.
 */
function selectEndpointsForAttempt(endpoints, { currentEndpointId = null } = {}) {
  const list = (Array.isArray(endpoints) ? endpoints : [])
    .filter((ep) => ep && ep.enabled !== false && !ep.disabledByPolicy)
    .slice()
    .sort((a, b) => {
      const pa = Number(a.priority) || 0;
      const pb = Number(b.priority) || 0;
      if (pa !== pb) return pa - pb;
      return String(a.endpointId).localeCompare(String(b.endpointId));
    });

  if (currentEndpointId) {
    const idx = list.findIndex((ep) => ep.endpointId === currentEndpointId);
    if (idx > 0) {
      const preferred = list[idx];
      return [preferred, ...list.filter((ep) => ep.endpointId !== currentEndpointId)];
    }
  }
  return list;
}

/**
 * Decide whether failover to the next endpoint is allowed after a failure.
 */
function shouldFailover(errorOrStatus) {
  return classifyTransportError(errorOrStatus).transferable === true;
}

/**
 * User-facing transport failure for certificate trust vs HTTPS-on-HTTP.
 * Returns null for ordinary network/HTTP failures so callers keep their own copy.
 */
function describeTransportFailure(errorOrStatus) {
  const classified = classifyTransportError(errorOrStatus);
  if (classified.kind === 'https_on_http') {
    return {
      ok: false,
      error: 'https_on_http',
      message: classified.userMessage || HTTPS_ON_HTTP_MESSAGE,
      transferable: false,
      certificateError: false,
      needsTrustConfirm: false,
      uiState: null,
    };
  }
  if (classified.kind === 'certificate_error') {
    return {
      ok: false,
      error: 'certificate_error',
      message: '证书错误',
      transferable: false,
      certificateError: true,
      needsTrustConfirm: true,
      uiState: 'certificate_error',
    };
  }
  return null;
}

/**
 * Genuine untrusted / self-signed certificate failures may ask the user to pin trust.
 * Protocol mismatch (HTTPS client, plaintext HTTP peer) must not.
 */
function shouldRequestCertificateTrust(errorOrStatus) {
  if (errorOrStatus && typeof errorOrStatus === 'object') {
    const text = transportErrorText(errorOrStatus).toLowerCase();
    if (
      isHttpsOnPlainHttp(text)
      || errorOrStatus.error === 'https_on_http'
      || errorOrStatus.kind === 'https_on_http'
      || errorOrStatus.code === 'https_on_http'
    ) {
      return false;
    }
    if (errorOrStatus.kind === 'certificate_error' && errorOrStatus.needsTrustConfirm !== false) {
      return true;
    }
  }
  const described = describeTransportFailure(errorOrStatus);
  return Boolean(described && described.certificateError === true && described.needsTrustConfirm === true);
}

/**
 * Deduplicate by canonical URL; keep first (lowest priority / earlier).
 */
function dedupeEndpointsByCanonical(endpoints) {
  const seen = new Set();
  const out = [];
  for (const ep of endpoints || []) {
    const canon = canonicalizeEndpointUrl(ep.baseUrl);
    if (!canon.ok) continue;
    if (seen.has(canon.canonical)) continue;
    seen.add(canon.canonical);
    out.push({ ...ep, baseUrl: canon.canonical });
  }
  return out;
}

function createEndpointId() {
  return `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeEndpointInput(input = {}) {
  const canon = canonicalizeEndpointUrl(input.baseUrl);
  if (!canon.ok) return { ok: false, error: canon.error };

  const kind = ENDPOINT_KINDS.includes(input.kind) ? input.kind : 'gateway';
  let allowInsecureHttp = input.allowInsecureHttp === true;
  // New / URL-changed endpoints default allowInsecureHttp=false unless loopback http (exempt).
  if (canon.protocol === 'http:' && canon.isLoopback) {
    allowInsecureHttp = false; // loopback does not need the switch
  } else if (input.resetHttpOnUrlChange !== false && input.isUrlChange) {
    allowInsecureHttp = false;
  }

  const disabledByPolicy =
    input.disabledByPolicy === true ||
    (canon.protocol === 'http:' && !canon.isLoopback && !allowInsecureHttp && input.enforcePolicy !== false
      ? Boolean(input.wasHttpEndpoint)
      : false);

  // Fresh create: http without switch → not yet disabledByPolicy until user had it on then off.
  // Default create keeps enabled=true but requests must check endpointHttpPolicy.allowed.
  const endpoint = {
    endpointId: String(input.endpointId || createEndpointId()),
    baseUrl: canon.canonical,
    kind,
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
    enabled: input.enabled === false ? false : true,
    allowInsecureHttp: allowInsecureHttp && canon.protocol === 'http:' && !canon.isLoopback,
    disabledByPolicy: Boolean(input.disabledByPolicy),
    lastHealth: input.lastHealth || null,
    lastError: input.lastError || null,
    serverId: input.serverId || null,
    uid: input.uid || null,
  };

  return { ok: true, endpoint, canonical: canon };
}

/**
 * Whether a request may be issued against this endpoint right now.
 * Closing the HTTP switch → disabledByPolicy stops all requests.
 * Open http without allow → also blocked (but not disabledByPolicy until toggled off).
 */
function canRequestEndpoint(endpoint) {
  if (!endpoint) return { ok: false, error: 'missing_endpoint' };
  if (endpoint.disabledByPolicy) {
    return { ok: false, error: 'disabled_by_policy', uiState: 'endpoint_disabled' };
  }
  if (endpoint.enabled === false) {
    return { ok: false, error: 'disabled' };
  }
  const policy = endpointHttpPolicy({
    baseUrl: endpoint.baseUrl,
    allowInsecureHttp: endpoint.allowInsecureHttp,
  });
  if (!policy.ok) return { ok: false, error: policy.error };
  if (!policy.allowed) {
    return { ok: false, error: 'insecure_http_not_allowed', uiState: 'endpoint_disabled' };
  }
  return { ok: true, policy };
}

/**
 * Derive status-bar UI state from sync runtime snapshot.
 */
function deriveSyncUiState(snapshot = {}) {
  if (snapshot.certificateError) return 'certificate_error';
  if (snapshot.needsReauth) return 'needs_reauth';
  if (snapshot.schemaIncompatible) return 'schema_incompatible';
  if (snapshot.migrationFailed) return 'migration_failed';
  if (snapshot.migrating) return 'migrating';
  if (!snapshot.bound) return 'unbound';
  if (snapshot.endpointDisabled) return 'endpoint_disabled';
  if (snapshot.syncing) return 'syncing';
  if ((snapshot.outboxCount || 0) > 0 && snapshot.offline) return 'offline_pending';
  if ((snapshot.outboxCount || 0) > 0 && !snapshot.lastSuccessAt) return 'offline_pending';
  if ((snapshot.outboxCount || 0) > 0 && snapshot.offline !== false && snapshot.lastError) {
    return 'offline_pending';
  }
  return 'synced';
}

function syncUiStateLabel(state) {
  switch (state) {
    case 'unbound':
      return '未绑定';
    case 'migrating':
      return '迁移中';
    case 'syncing':
      return '同步中';
    case 'synced':
      return '已同步';
    case 'offline_pending':
      return '离线待传';
    case 'needs_reauth':
      return '需重新认证';
    case 'schema_incompatible':
      return 'schema 不兼容';
    case 'migration_failed':
      return '迁移失败';
    case 'certificate_error':
      return '证书错误';
    case 'endpoint_disabled':
      return 'endpoint 已停用';
    default:
      return '未知';
  }
}

/**
 * Persistent HTTP warning when any enabled non-loopback endpoint has allowInsecureHttp.
 */
function shouldShowInsecureHttpWarning(endpoints) {
  return (endpoints || []).some((ep) => {
    if (!ep || ep.enabled === false || ep.disabledByPolicy) return false;
    const canon = canonicalizeEndpointUrl(ep.baseUrl);
    if (!canon.ok || canon.isLoopback || canon.protocol !== 'http:') return false;
    return ep.allowInsecureHttp === true;
  });
}

/**
 * G0 blocked → guide creating a device-port endpoint (may coexist with gateway).
 */
function shouldGuideDevicePort({ gatewayBearerBlocked = false } = {}) {
  return gatewayBearerBlocked === true;
}

module.exports = {
  ENDPOINT_KINDS,
  SYNC_UI_STATES,
  HTTP_INSECURE_CONFIRM_TEXT,
  HTTPS_ON_HTTP_MESSAGE,
  HTTP_INSECURE_WARNING_TEXT,
  DEVICE_PORT_GUIDANCE_TEXT,
  APP_PATH_SEGMENT,
  isLoopbackHost,
  canonicalizeEndpointUrl,
  endpointHttpPolicy,
  applyAllowInsecureHttpToggle,
  applyEndpointBaseUrlChange,
  isHttpsOnPlainHttp,
  classifyTransportError,
  describeTransportFailure,
  shouldRequestCertificateTrust,
  selectEndpointsForAttempt,
  shouldFailover,
  dedupeEndpointsByCanonical,
  createEndpointId,
  normalizeEndpointInput,
  canRequestEndpoint,
  deriveSyncUiState,
  syncUiStateLabel,
  shouldShowInsecureHttpWarning,
  shouldGuideDevicePort,
};
