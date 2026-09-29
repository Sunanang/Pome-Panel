'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { describeTransportFailure } = require('../packages/sync-protocol/endpoints');
const { createSyncSettingsStore } = require('../sync-settings');
const {
  hostPortKey,
  hostPortKeyFromUrl,
  derToPem,
  createPinnedCaAgent,
  agentForPinnedTrust,
  probePeerCertificate,
  evaluateTrustAcceptance,
} = require('../sync-tls-trust');

test('hostPortKey / FromUrl normalize https endpoints per port', () => {
  assert.equal(hostPortKey('Example.COM', 443), 'example.com:443');
  assert.equal(hostPortKey('Example.COM', ''), 'example.com:443');
  assert.equal(hostPortKeyFromUrl('https://39.106.162.144:9528/app/pome-panel'), '39.106.162.144:9528');
  assert.equal(hostPortKeyFromUrl('https://NAS.local/app'), 'nas.local:443');
  assert.notEqual(
    hostPortKeyFromUrl('https://nas.local:8443/app'),
    hostPortKeyFromUrl('https://nas.local:9443/app'),
  );
  assert.equal(hostPortKeyFromUrl('http://192.168.1.1:39100/'), null);
  assert.equal(hostPortKeyFromUrl('not a url'), null);
});

test('derToPem and createPinnedCaAgent keep verification on', () => {
  const pem = derToPem(Buffer.from('abc'));
  assert.match(pem, /BEGIN CERTIFICATE/);
  assert.equal(derToPem(Buffer.alloc(0)), null);
  assert.equal(createPinnedCaAgent('', 'AA'), null);
  assert.equal(createPinnedCaAgent(pem, ''), null);
  const agent = createPinnedCaAgent(pem, 'aa:bb');
  assert.ok(agent);
  assert.equal(agent.options.rejectUnauthorized, true);
  assert.equal(typeof agent.options.checkServerIdentity, 'function');
  const mismatch = agent.options.checkServerIdentity('127.0.0.1', { fingerprint256: 'CC:DD' });
  assert.equal(mismatch.code, 'CERT_PIN_MISMATCH');
  assert.match(mismatch.message, /certificate fingerprint mismatch/);
  assert.equal(
    agent.options.checkServerIdentity('127.0.0.1', { fingerprint256: 'AA:BB' }),
    undefined,
  );
  agent.destroy();
});

test('evaluateTrustAcceptance refuses a changed fingerprint and does not invent a pin', () => {
  const probed = {
    ok: true,
    hostKey: 'nas.local:8443',
    pem: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n',
    fingerprint256: 'AA:BB',
    subjectCN: 'fnos',
    issuerCN: 'fnos',
  };
  assert.equal(evaluateTrustAcceptance({ probed: { ok: false } }).needsTrustConfirm, false);
  const missing = evaluateTrustAcceptance({ probed });
  assert.equal(missing.error, 'certificate_fingerprint_required');
  assert.equal(missing.needsTrustConfirm, true);
  const changed = evaluateTrustAcceptance({ probed, confirmedFingerprint: 'CC:DD' });
  assert.equal(changed.ok, false);
  assert.equal(changed.error, 'certificate_fingerprint_mismatch');
  assert.equal(changed.fingerprint256, 'AA:BB');
  assert.equal(changed.needsTrustConfirm, true);
  const ok = evaluateTrustAcceptance({ probed, confirmedFingerprint: 'aa:bb' });
  assert.equal(ok.ok, true);
  assert.equal(ok.hostKey, 'nas.local:8443');
  assert.equal(ok.cert.fingerprint256, 'AA:BB');
});

test('main sync requests use the pinned agent and do not disable TLS', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /agentForPinnedTrust/);
  assert.match(main, /evaluateTrustAcceptance/);
  assert.match(main, /trustCertificateAccepted/);
  assert.match(main, /certificateTrustPrompt/);
  assert.doesNotMatch(main, /rejectUnauthorized\s*:\s*false/);
  assert.doesNotMatch(main, /NODE_TLS_REJECT_UNAUTHORIZED/);
});

function makeCert(dir, name, cn) {
  const keyPath = path.join(dir, `${name}.key`);
  const certPath = path.join(dir, `${name}.crt`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '2',
    '-nodes',
    '-subj', `/CN=${cn}`,
  ], { stdio: 'pipe' });
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath, 'utf8'),
  };
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function requestOnce(port, agent) {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/health',
      agent: agent || undefined,
      timeout: 4000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(describeTransportFailure('timeout'));
    });
    req.on('error', (error) => {
      const described = describeTransportFailure({ code: error.code, message: error.message });
      resolve(described || {
        ok: false,
        error: error.message,
        code: error.code,
        message: error.message,
      });
    });
  });
}

test('pinned trust is per host:port; a replaced certificate must be confirmed again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-tls-'));
  const certA = makeCert(dir, 'a', 'fnos-test-a');
  const certB = makeCert(dir, 'b', 'fnos-test-b');
  const store = createSyncSettingsStore({
    getUserDataPath: () => dir,
    fs,
    path,
  });
  let server = https.createServer({ key: certA.key, cert: certA.cert }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const port = await listen(server);
  const hostKey = hostPortKey('127.0.0.1', port);
  const otherKey = hostPortKey('127.0.0.1', port === 65535 ? 1 : port + 1);
  try {
    const untrusted = await requestOnce(port);
    assert.equal(untrusted.ok, false);
    assert.equal(untrusted.error, 'certificate_error');
    assert.equal(untrusted.needsTrustConfirm, true);
    assert.equal(untrusted.certificateError, true);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);

    const probed = await probePeerCertificate({ hostname: '127.0.0.1', port });
    assert.equal(probed.ok, true);
    assert.equal(probed.hostKey, hostKey);
    assert.equal(probed.subjectCN, 'fnos-test-a');
    assert.match(probed.pem, /BEGIN CERTIFICATE/);

    const rejected = evaluateTrustAcceptance({ probed, confirmedFingerprint: '00:11' });
    assert.equal(rejected.ok, false);
    assert.equal(store.getTrustedCert(hostKey), null);

    const accepted = evaluateTrustAcceptance({
      probed,
      confirmedFingerprint: probed.fingerprint256,
    });
    assert.equal(accepted.ok, true);
    assert.equal(store.trustCertificate(accepted.hostKey, accepted.cert).ok, true);
    assert.equal(store.getTrustedCert(otherKey), null);
    assert.equal(
      agentForPinnedTrust(`https://127.0.0.1:${otherKey.split(':').pop()}/`, (key) => store.getTrustedCert(key)),
      null,
    );

    const agent = agentForPinnedTrust(
      `https://127.0.0.1:${port}/api/v1/health`,
      (key) => store.getTrustedCert(key),
    );
    assert.ok(agent);
    assert.notEqual(agent.options.rejectUnauthorized, false);
    const trusted = await requestOnce(port, agent);
    agent.destroy();
    assert.equal(trusted.ok, true, trusted.message || trusted.error);
    assert.equal(trusted.status, 200);

    await closeServer(server);
    server = https.createServer({ key: certB.key, cert: certB.cert }, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    assert.equal(await listen(server, port), port);

    const stale = createPinnedCaAgent(probed.pem, probed.fingerprint256);
    const changed = await requestOnce(port, stale);
    stale.destroy();
    assert.equal(changed.ok, false);
    assert.equal(changed.error, 'certificate_error');
    assert.equal(changed.needsTrustConfirm, true);

    const probedB = await probePeerCertificate({ hostname: '127.0.0.1', port });
    assert.equal(probedB.ok, true);
    assert.notEqual(probedB.fingerprint256.toUpperCase(), probed.fingerprint256.toUpperCase());
    const acceptedB = evaluateTrustAcceptance({
      probed: probedB,
      confirmedFingerprint: probedB.fingerprint256,
    });
    assert.equal(store.trustCertificate(acceptedB.hostKey, acceptedB.cert).ok, true);
    assert.equal(store.getTrustedCert(hostKey).fingerprint256, probedB.fingerprint256);

    const agentB = createPinnedCaAgent(probedB.pem, probedB.fingerprint256);
    const again = await requestOnce(port, agentB);
    agentB.destroy();
    assert.equal(again.ok, true, again.message || again.error);

    const reloaded = createSyncSettingsStore({
      getUserDataPath: () => dir,
      fs,
      path,
    });
    assert.equal(reloaded.getTrustedCert(hostKey).fingerprint256, probedB.fingerprint256);
    assert.equal(reloaded.getTrustedCert(otherKey), null);
  } finally {
    await closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
