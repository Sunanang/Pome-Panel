'use strict';

/**
 * Scoped TLS helpers for NAS sync.
 *
 * probePeerCertificate turns verification off only while reading the leaf
 * certificate for the confirm dialog. It never sends pairing codes, device
 * tokens, or any HTTP body. The probe call itself is marked in source.
 *
 * createPinnedCaAgent keeps verification on (rejectUnauthorized:true) and
 * trusts only the confirmed PEM. Hostname checks are skipped for that pin
 * because fnOS self-signed CNs often do not match an IP Base URL. The leaf
 * fingerprint must still match; a replaced certificate fails closed.
 *
 * Global TLS bypass stays forbidden (tests/sync-tls-ban.test.js).
 */

const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');

function hostPortKey(hostname, port) {
  const host = String(hostname || '').trim().toLowerCase();
  const parsed = port == null || port === '' ? 443 : Number(port);
  const numeric = Number.isFinite(parsed) ? parsed : 443;
  return `${host}:${numeric}`;
}

function hostPortKeyFromUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol !== 'https:') return null;
    return hostPortKey(url.hostname, url.port || 443);
  } catch {
    return null;
  }
}

function isHostPortKey(value) {
  const key = String(value || '').trim().toLowerCase();
  const splitAt = key.lastIndexOf(':');
  if (splitAt <= 0) return false;
  const host = key.slice(0, splitAt);
  const port = Number(key.slice(splitAt + 1));
  if (!host || host.includes('/') || host.includes(' ')) return false;
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function fingerprintsEqual(left, right) {
  const a = String(left || '').trim().toUpperCase();
  const b = String(right || '').trim().toUpperCase();
  return a !== '' && a === b;
}

function derToPem(der) {
  if (!der || !Buffer.isBuffer(der) || der.length === 0) return null;
  const lines = der.toString('base64').match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Connect once with verification off to capture the leaf certificate.
 * MUST NOT be used to send pairing codes or device tokens.
 */
function probePeerCertificate({ hostname, port = 443, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const host = String(hostname || '').trim();
    const tcpPort = Number(port) || 443;
    if (!host) {
      resolve({ ok: false, error: 'invalid_host' });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const probeOptions = {
      host,
      port: tcpPort,
      // CERT_PROBE_ONLY — read fingerprint; never send secrets on this socket.
      rejectUnauthorized: false,
    };
    // SNI is a hostname. An IP Base URL must not be sent as servername.
    if (net.isIP(host) === 0) probeOptions.servername = host;

    const socket = tls.connect(
      probeOptions,
      () => {
        const cert = socket.getPeerCertificate(true);
        const pem = derToPem(cert && cert.raw);
        socket.end();
        if (!pem || !cert || !cert.fingerprint256) {
          finish({ ok: false, error: 'no_certificate' });
          return;
        }
        finish({
          ok: true,
          hostKey: hostPortKey(host, tcpPort),
          hostname: host,
          port: tcpPort,
          fingerprint256: String(cert.fingerprint256),
          subjectCN: (cert.subject && (cert.subject.CN || cert.subject.cn)) || '',
          issuerCN: (cert.issuer && (cert.issuer.CN || cert.issuer.cn)) || '',
          validFrom: cert.valid_from || null,
          validTo: cert.valid_to || null,
          pem,
        });
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      finish({ ok: false, error: 'timeout' });
    });
    socket.on('error', (error) => {
      socket.destroy();
      finish({ ok: false, error: (error && error.message) || 'probe_failed' });
    });
  });
}

/**
 * HTTPS agent that trusts only this pinned leaf (verification stays on).
 * fingerprint256 is required so a later certificate for the same host fails.
 */
function createPinnedCaAgent(pem, fingerprint256) {
  const ca = String(pem || '').trim();
  const expected = String(fingerprint256 || '').trim().toUpperCase();
  if (!ca || !expected) return null;
  return new https.Agent({
    rejectUnauthorized: true,
    ca: [ca],
    // User confirmed this exact leaf for this host:port (often IP + CN=fnOS).
    checkServerIdentity: (_hostname, cert) => {
      const actual = cert && cert.fingerprint256
        ? String(cert.fingerprint256).toUpperCase()
        : '';
      if (!actual || actual !== expected) {
        const error = new Error('certificate fingerprint mismatch');
        error.code = 'CERT_PIN_MISMATCH';
        return error;
      }
      return undefined;
    },
  });
}

/**
 * Pick the pinned agent for one host:port. lookup(hostKey) must return only
 * that host's record; other ports stay untrusted.
 */
function agentForPinnedTrust(targetUrl, lookup) {
  const hostKey = hostPortKeyFromUrl(targetUrl);
  if (!hostKey || typeof lookup !== 'function') return null;
  const trusted = lookup(hostKey);
  if (!trusted || !trusted.pem || !trusted.fingerprint256) return null;
  return createPinnedCaAgent(trusted.pem, trusted.fingerprint256);
}

/**
 * User confirmed a fingerprint. Persist only when the live leaf still matches.
 */
function evaluateTrustAcceptance({ probed, confirmedFingerprint } = {}) {
  if (!probed || probed.ok !== true || !probed.pem || !probed.fingerprint256 || !probed.hostKey) {
    return {
      ok: false,
      error: 'certificate_error',
      message: '无法读取对端证书，未保存信任',
      needsTrustConfirm: false,
      certificateError: true,
    };
  }
  if (!confirmedFingerprint) {
    return {
      ok: false,
      error: 'certificate_fingerprint_required',
      message: '缺少要信任的证书指纹',
      needsTrustConfirm: true,
      certificateError: true,
      fingerprint256: probed.fingerprint256,
      subjectCN: probed.subjectCN || '',
      issuerCN: probed.issuerCN || '',
      validFrom: probed.validFrom || null,
      validTo: probed.validTo || null,
      hostKey: probed.hostKey,
    };
  }
  if (!fingerprintsEqual(confirmedFingerprint, probed.fingerprint256)) {
    return {
      ok: false,
      error: 'certificate_fingerprint_mismatch',
      message: '证书指纹已变化，请重新核对后再信任',
      needsTrustConfirm: true,
      certificateError: true,
      fingerprint256: probed.fingerprint256,
      subjectCN: probed.subjectCN || '',
      issuerCN: probed.issuerCN || '',
      validFrom: probed.validFrom || null,
      validTo: probed.validTo || null,
      hostKey: probed.hostKey,
    };
  }
  return {
    ok: true,
    hostKey: probed.hostKey,
    cert: {
      pem: probed.pem,
      fingerprint256: probed.fingerprint256,
      subjectCN: probed.subjectCN || '',
      issuerCN: probed.issuerCN || '',
      validFrom: probed.validFrom || null,
      validTo: probed.validTo || null,
    },
  };
}

module.exports = {
  hostPortKey,
  hostPortKeyFromUrl,
  isHostPortKey,
  fingerprintsEqual,
  derToPem,
  probePeerCertificate,
  createPinnedCaAgent,
  agentForPinnedTrust,
  evaluateTrustAcceptance,
};
