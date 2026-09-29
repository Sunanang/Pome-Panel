'use strict';

/**
 * Persist multi-endpoint sync settings to userData/sync-settings.json (T6 / §8.1).
 * Fixed under userData — not copied with custom workspace folders.
 */

const {
  canonicalizeEndpointUrl,
  normalizeEndpointInput,
  applyAllowInsecureHttpToggle,
  applyEndpointBaseUrlChange,
  dedupeEndpointsByCanonical,
  createEndpointId,
  shouldShowInsecureHttpWarning,
  DEVICE_PORT_GUIDANCE_TEXT,
} = require('./packages/sync-protocol/endpoints');
const { isHostPortKey } = require('./sync-tls-trust');

const SYNC_SETTINGS_FILE = 'sync-settings.json';

function defaultSettings() {
  return {
    version: 1,
    endpoints: [],
    currentEndpointId: null,
    gatewayBearerBlocked: false,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastUiState: 'unbound',
    httpAudit: [],
    trustedCerts: {},
  };
}

/**
 * Root keys written to sync-settings.json. Anything else is dropped.
 * trustedCerts must stay in this set or a confirmed NAS pin is silently lost.
 */
const PERSISTED_SETTING_KEYS = Object.freeze([
  'version',
  'endpoints',
  'currentEndpointId',
  'gatewayBearerBlocked',
  'lastSyncAt',
  'lastSuccessAt',
  'lastError',
  'lastUiState',
  'httpAudit',
  'trustedCerts',
]);

const MAX_TRUSTED_PEM_LENGTH = 16 * 1024;

function sanitizeTrustedCerts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [hostKey, value] of Object.entries(raw)) {
    const key = String(hostKey || '').trim().toLowerCase();
    if (!isHostPortKey(key) || !value || typeof value !== 'object') continue;
    const pem = typeof value.pem === 'string' ? value.pem.trim() : '';
    const fingerprint256 = typeof value.fingerprint256 === 'string' ? value.fingerprint256.trim() : '';
    if (!pem || pem.length > MAX_TRUSTED_PEM_LENGTH || !fingerprint256) continue;
    if (!pem.startsWith('-----BEGIN CERTIFICATE-----') || !pem.includes('-----END CERTIFICATE-----')) {
      continue;
    }
    out[key] = {
      pem,
      fingerprint256,
      subjectCN: typeof value.subjectCN === 'string' ? value.subjectCN : '',
      issuerCN: typeof value.issuerCN === 'string' ? value.issuerCN : '',
      validFrom: value.validFrom || null,
      validTo: value.validTo || null,
      trustedAt: Number(value.trustedAt) || null,
    };
  }
  return out;
}

function persistedSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    version: Number.isInteger(src.version) ? src.version : 1,
    endpoints: dedupeEndpointsByCanonical(Array.isArray(src.endpoints) ? src.endpoints : []),
    currentEndpointId: src.currentEndpointId || null,
    gatewayBearerBlocked: src.gatewayBearerBlocked === true,
    lastSyncAt: src.lastSyncAt != null ? src.lastSyncAt : null,
    lastSuccessAt: src.lastSuccessAt != null ? src.lastSuccessAt : null,
    lastError: Object.prototype.hasOwnProperty.call(src, 'lastError') ? src.lastError : null,
    lastUiState: src.lastUiState || 'unbound',
    httpAudit: Array.isArray(src.httpAudit) ? src.httpAudit.slice(-50) : [],
    trustedCerts: sanitizeTrustedCerts(src.trustedCerts),
  };
}

function createSyncSettingsStore(options = {}) {
  const {
    getUserDataPath,
    fs: fsMod,
    path: pathMod,
    fileName = SYNC_SETTINGS_FILE,
    mode = 0o600,
  } = options;

  if (typeof getUserDataPath !== 'function') {
    throw new Error('getUserDataPath_required');
  }

  function settingsPath() {
    return pathMod.join(getUserDataPath(), fileName);
  }

  function read() {
    const filePath = settingsPath();
    if (!fsMod.existsSync(filePath)) {
      return { ok: true, settings: defaultSettings(), path: filePath };
    }
    try {
      const raw = fsMod.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const settings = persistedSettings(parsed);
      return { ok: true, settings, path: filePath };
    } catch {
      return { ok: false, error: 'read_failed', settings: defaultSettings(), path: filePath };
    }
  }

  function write(settings) {
    const filePath = settingsPath();
    fsMod.mkdirSync(pathMod.dirname(filePath), { recursive: true });
    const payload = persistedSettings(settings);
    const tmp = `${filePath}.tmp`;
    fsMod.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode });
    fsMod.renameSync(tmp, filePath);
    try {
      fsMod.chmodSync(filePath, mode);
    } catch {
      // chmod may fail on some FS; ignore
    }
    return { ok: true, settings: payload, path: filePath };
  }

  function listEndpoints() {
    const { settings } = read();
    return settings.endpoints.slice().sort((a, b) => {
      const pa = Number(a.priority) || 0;
      const pb = Number(b.priority) || 0;
      if (pa !== pb) return pa - pb;
      return String(a.endpointId).localeCompare(String(b.endpointId));
    });
  }

  function getPublicView() {
    const { settings } = read();
    const endpoints = listEndpoints();
    const current =
      endpoints.find((ep) => ep.endpointId === settings.currentEndpointId) ||
      endpoints.find((ep) => ep.enabled && !ep.disabledByPolicy) ||
      null;
    return {
      ok: true,
      endpoints,
      currentEndpointId: current ? current.endpointId : null,
      currentEndpoint: current,
      gatewayBearerBlocked: settings.gatewayBearerBlocked === true,
      devicePortGuidance: settings.gatewayBearerBlocked === true ? DEVICE_PORT_GUIDANCE_TEXT : null,
      insecureHttpWarning: shouldShowInsecureHttpWarning(endpoints),
      lastSyncAt: settings.lastSyncAt,
      lastSuccessAt: settings.lastSuccessAt,
      lastError: settings.lastError,
      lastUiState: settings.lastUiState,
      lastHttpAuditAt:
        settings.httpAudit.length > 0
          ? settings.httpAudit[settings.httpAudit.length - 1].changedAt
          : null,
    };
  }

  function appendHttpAudit(settings, endpointId, allowInsecureHttp) {
    const entry = {
      endpointId,
      allowInsecureHttp: Boolean(allowInsecureHttp),
      changedAt: Date.now(),
    };
    return [...(settings.httpAudit || []), entry].slice(-50);
  }

  function addEndpoint(input = {}) {
    const normalized = normalizeEndpointInput({
      ...input,
      endpointId: input.endpointId || createEndpointId(),
      allowInsecureHttp: false,
    });
    if (!normalized.ok) return { ok: false, error: normalized.error };

    const { settings } = read();
    const duplicate = settings.endpoints.find(
      (ep) => canonicalizeEndpointUrl(ep.baseUrl).canonical === normalized.canonical.canonical,
    );
    if (duplicate) {
      return { ok: false, error: 'duplicate_endpoint', endpointId: duplicate.endpointId };
    }

    const next = {
      ...settings,
      endpoints: [...settings.endpoints, normalized.endpoint],
    };
    if (!next.currentEndpointId) {
      next.currentEndpointId = normalized.endpoint.endpointId;
    }
    write(next);
    return { ok: true, endpoint: normalized.endpoint, view: getPublicView() };
  }

  function updateEndpoint(endpointId, patch = {}) {
    const { settings } = read();
    const idx = settings.endpoints.findIndex((ep) => ep.endpointId === endpointId);
    if (idx < 0) return { ok: false, error: 'not_found' };

    let endpoint = { ...settings.endpoints[idx] };
    let httpAudit = settings.httpAudit;

    if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl') && patch.baseUrl !== endpoint.baseUrl) {
      const changed = applyEndpointBaseUrlChange(endpoint, patch.baseUrl);
      if (!changed.ok) return { ok: false, error: changed.error };
      endpoint = changed.endpoint;
      httpAudit = appendHttpAudit(settings, endpoint.endpointId, false);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'kind') && patch.kind) {
      endpoint.kind = patch.kind;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
      endpoint.priority = Number(patch.priority);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      if (endpoint.disabledByPolicy && patch.enabled === true) {
        return { ok: false, error: 'disabled_by_policy' };
      }
      endpoint.enabled = patch.enabled !== false;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'allowInsecureHttp')) {
      const toggled = applyAllowInsecureHttpToggle(
        endpoint,
        patch.allowInsecureHttp === true,
        { confirmed: patch.httpConfirmAccepted === true },
      );
      if (!toggled.ok) return { ok: false, error: toggled.error, confirmText: toggled.confirmText };
      if (toggled.rewrittenToHttps) {
        return { ok: false, error: 'https_rewrite_forbidden' };
      }
      endpoint = toggled.endpoint;
      httpAudit = appendHttpAudit(settings, endpoint.endpointId, endpoint.allowInsecureHttp);
      return {
        ok: true,
        endpoint,
        policyMessage: toggled.policyMessage || null,
        view: (() => {
          const next = { ...settings, endpoints: settings.endpoints.slice(), httpAudit };
          next.endpoints[idx] = endpoint;
          write(next);
          return getPublicView();
        })(),
      };
    }

    const next = { ...settings, endpoints: settings.endpoints.slice(), httpAudit };
    next.endpoints[idx] = endpoint;
    write(next);
    return { ok: true, endpoint, view: getPublicView() };
  }

  function deleteEndpoint(endpointId) {
    const { settings } = read();
    const nextEndpoints = settings.endpoints.filter((ep) => ep.endpointId !== endpointId);
    if (nextEndpoints.length === settings.endpoints.length) {
      return { ok: false, error: 'not_found' };
    }
    const next = {
      ...settings,
      endpoints: nextEndpoints,
      currentEndpointId:
        settings.currentEndpointId === endpointId
          ? (nextEndpoints[0] && nextEndpoints[0].endpointId) || null
          : settings.currentEndpointId,
    };
    write(next);
    return { ok: true, view: getPublicView() };
  }

  function reorderEndpoint(endpointId, direction) {
    const endpoints = listEndpoints();
    const idx = endpoints.findIndex((ep) => ep.endpointId === endpointId);
    if (idx < 0) return { ok: false, error: 'not_found' };
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= endpoints.length) {
      return { ok: false, error: 'boundary' };
    }
    const a = endpoints[idx];
    const b = endpoints[swapWith];
    const priorityA = Number(a.priority) || 0;
    const priorityB = Number(b.priority) || 0;
    const { settings } = read();
    const next = {
      ...settings,
      endpoints: settings.endpoints.map((ep) => {
        if (ep.endpointId === a.endpointId) return { ...ep, priority: priorityB };
        if (ep.endpointId === b.endpointId) return { ...ep, priority: priorityA };
        return ep;
      }),
    };
    write(next);
    return { ok: true, view: getPublicView() };
  }

  function setCurrentEndpoint(endpointId) {
    const { settings } = read();
    const found = settings.endpoints.find((ep) => ep.endpointId === endpointId);
    if (!found) return { ok: false, error: 'not_found' };
    if (found.disabledByPolicy) return { ok: false, error: 'disabled_by_policy' };
    write({ ...settings, currentEndpointId: endpointId });
    return { ok: true, view: getPublicView() };
  }

  function setGatewayBearerBlocked(blocked) {
    const { settings } = read();
    write({ ...settings, gatewayBearerBlocked: blocked === true });
    return { ok: true, view: getPublicView() };
  }

  function recordSyncMeta(patch = {}) {
    const { settings } = read();
    write({
      ...settings,
      lastSyncAt: patch.lastSyncAt != null ? patch.lastSyncAt : settings.lastSyncAt,
      lastSuccessAt: patch.lastSuccessAt != null ? patch.lastSuccessAt : settings.lastSuccessAt,
      lastError: Object.prototype.hasOwnProperty.call(patch, 'lastError')
        ? patch.lastError
        : settings.lastError,
      lastUiState: patch.lastUiState || settings.lastUiState,
      currentEndpointId: patch.currentEndpointId || settings.currentEndpointId,
    });
    return getPublicView();
  }

  function updateEndpointHealth(endpointId, health) {
    const { settings } = read();
    const idx = settings.endpoints.findIndex((ep) => ep.endpointId === endpointId);
    if (idx < 0) return { ok: false, error: 'not_found' };
    const next = { ...settings, endpoints: settings.endpoints.slice() };
    next.endpoints[idx] = {
      ...next.endpoints[idx],
      lastHealth: health && health.ok
        ? { at: Date.now(), ok: true, serverId: health.serverId || null }
        : next.endpoints[idx].lastHealth,
      lastError: health && !health.ok
        ? { at: Date.now(), code: health.error || 'health_failed', message: health.message || null }
        : health && health.ok
          ? null
          : next.endpoints[idx].lastError,
    };
    write(next);
    return { ok: true, endpoint: next.endpoints[idx], view: getPublicView() };
  }

  function getTrustedCert(hostKey) {
    const key = String(hostKey || '').trim().toLowerCase();
    if (!isHostPortKey(key)) return null;
    const { settings } = read();
    const row = settings.trustedCerts && settings.trustedCerts[key];
    if (!row || !row.pem) return null;
    return { ...row, hostKey: key };
  }

  function trustCertificate(hostKey, cert = {}) {
    const key = String(hostKey || '').trim().toLowerCase();
    if (!isHostPortKey(key)) return { ok: false, error: 'invalid_host' };
    const { settings } = read();
    const trustedCerts = sanitizeTrustedCerts({
      ...(settings.trustedCerts || {}),
      [key]: {
        pem: cert.pem,
        fingerprint256: cert.fingerprint256,
        subjectCN: cert.subjectCN || '',
        issuerCN: cert.issuerCN || '',
        validFrom: cert.validFrom || null,
        validTo: cert.validTo || null,
        trustedAt: Date.now(),
      },
    });
    if (!trustedCerts[key]) return { ok: false, error: 'invalid_certificate' };
    write({ ...settings, trustedCerts });
    return { ok: true, hostKey: key, view: getPublicView() };
  }

  /**
   * Ensure pairing baseUrl exists as an endpoint (gateway kind by default).
   */
  function ensureEndpointFromPairing(baseUrl, extras = {}) {
    const canon = canonicalizeEndpointUrl(baseUrl);
    if (!canon.ok) return { ok: false, error: canon.error };
    const { settings } = read();
    const existing = settings.endpoints.find(
      (ep) => canonicalizeEndpointUrl(ep.baseUrl).canonical === canon.canonical,
    );
    if (existing) {
      write({ ...settings, currentEndpointId: existing.endpointId });
      return { ok: true, endpoint: existing, created: false, view: getPublicView() };
    }
    const created = addEndpoint({
      baseUrl: canon.canonical,
      kind: extras.kind || 'gateway',
      allowInsecureHttp: extras.allowInsecureHttp === true,
      serverId: extras.serverId || null,
      uid: extras.uid || null,
      priority: extras.priority != null ? extras.priority : 10,
    });
    return { ...created, created: Boolean(created && created.ok) };
  }

  return {
    SYNC_SETTINGS_FILE,
    settingsPath,
    read,
    write,
    listEndpoints,
    getPublicView,
    addEndpoint,
    updateEndpoint,
    deleteEndpoint,
    reorderEndpoint,
    setCurrentEndpoint,
    setGatewayBearerBlocked,
    recordSyncMeta,
    updateEndpointHealth,
    ensureEndpointFromPairing,
    getTrustedCert,
    trustCertificate,
  };
}

module.exports = {
  SYNC_SETTINGS_FILE,
  PERSISTED_SETTING_KEYS,
  createSyncSettingsStore,
  defaultSettings,
};
