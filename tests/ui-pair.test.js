'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const pairUi = require('../renderer/nas-sync-pair.js');

const CONTROL_CHECKLIST = [
  { id: 'pair.code-input', mark: 'data-control-id="pair.code-input"', el: 'settings-nas-pair-code' },
  { id: 'pair.submit', mark: 'data-control-id="pair.submit"', el: 'settings-nas-pair-submit' },
  { id: 'pair.http-extra-confirm', mark: 'data-control-id="pair.http-extra-confirm"', el: 'settings-nas-dialog' },
  { id: 'pair.reauth', mark: 'data-control-id="pair.reauth"', el: 'settings-nas-pair-reauth' },
];

test('A.4 pair controls exist in settings card with workspace-button / dialog roles (S3/S4)', () => {
  assert.match(html, /id="settings-nas-sync-card"/);
  assert.match(html, /id="tab-settings"/);
  assert.match(html, /class="tile settings-card settings-nas-sync-card"/);
  for (const row of CONTROL_CHECKLIST) {
    assert.match(html, new RegExp(row.mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, new RegExp(`id="${row.el}"`));
  }
  assert.match(html, /class="[^"]*workspace-button[^"]*primary[^"]*"[^>]*id="settings-nas-pair-submit"/);
  assert.match(html, /id="settings-nas-dialog"[^>]*role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /nas-sync-pair\.js/);
});

test('pair UI style uses CSS variables — no new palette / no inline color in markup (S1/S2/S6)', () => {
  const nasCard = html.match(/settings-nas-sync-card[\s\S]*?settings-nas-dialog-root[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(nasCard, /style\s*=\s*"[^"]*(?:color|background)\s*:/i);
  assert.match(css, /\.settings-nas-sync-card/);
  assert.match(css, /var\(--text-1\)/);
  assert.match(css, /var\(--focus-ring\)/);
  assert.match(css, /var\(--accent-orange\)/);
  assert.match(css, /var\(--r-input/);
  assert.doesNotMatch(css, /\.settings-nas-sync-card[^{]*\{[^}]*\b(?:Inter|Roboto|Arial)\b/);
});

test('pair.code-input: empty / illegal / legal validation', () => {
  assert.equal(pairUi.validatePairCode('').ok, false);
  assert.equal(pairUi.validatePairCode('12').error, 'invalid_format');
  assert.equal(pairUi.validatePairCode('abcdef').ok, false);
  assert.deepEqual(pairUi.validatePairCode('654321'), { ok: true, code: '654321' });
});

test('pair.submit success / failure / disabled via reducer', () => {
  let state = pairUi.initialPairUiState();
  state = pairUi.reducePairUi(state, { type: 'submit_start' });
  assert.equal(state.submitting, true);
  assert.equal(state.disabled, true);
  state = pairUi.reducePairUi(state, { type: 'failure', message: '配对码无效' });
  assert.equal(state.submitting, false);
  assert.equal(state.error, '配对码无效');
  state = pairUi.reducePairUi(state, { type: 'success', status: { bound: true, deviceId: 'd1' } });
  assert.equal(state.bound, true);
  assert.equal(state.code, '');
});

test('pair.http-extra-confirm: required on LAN HTTP; cancel path does not claim', async () => {
  const calls = [];
  const api = {
    syncPairHttpPolicy: async () => ({
      ok: true,
      requiresExtraConfirm: true,
      insecureBound: true,
      confirmText: '明文风险',
    }),
    syncPairClaim: async (payload) => {
      calls.push(payload);
      return { ok: true, status: { bound: true } };
    },
  };
  const blocked = await pairUi.runPairSubmit({
    code: '111222',
    baseUrl: 'http://192.168.1.5/app',
    api,
    httpConfirmAccepted: false,
  });
  assert.equal(blocked.error, 'http_confirm_required');
  assert.equal(calls.length, 0);

  const ok = await pairUi.runPairSubmit({
    code: '111222',
    baseUrl: 'http://192.168.1.5/app',
    api,
    httpConfirmAccepted: true,
    allowInsecureHttp: true,
  });
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].httpConfirmAccepted, true);
  assert.equal(calls[0].insecureBound || calls[0].allowInsecureHttp, true);
});

test('pair.reauth reducer clears binding state', () => {
  let state = pairUi.initialPairUiState();
  state = pairUi.reducePairUi(state, { type: 'success', status: { bound: true } });
  state = pairUi.reducePairUi(state, { type: 'open_reauth_confirm' });
  assert.equal(state.dialog.id, 'pair-reauth-confirm');
  assert.equal(state.dialog.role, 'dialog');
  state = pairUi.reducePairUi(state, { type: 'cleared' });
  assert.equal(state.bound, false);
  assert.equal(state.dialog, null);
});

test('HTTPS-on-HTTP pair failure explains the scheme and does not ask to trust a certificate', async () => {
  const { HTTPS_ON_HTTP_MESSAGE } = require('../packages/sync-protocol/endpoints');
  assert.equal(pairUi.HTTPS_ON_HTTP_MESSAGE, HTTPS_ON_HTTP_MESSAGE);
  const nodeMessage = 'write EPROTO C0DC4C59DD7F0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../deps/openssl/openssl/ssl/record/ssl3_record.c:354:';
  const api = {
    syncPairHttpPolicy: async () => ({ ok: true, requiresExtraConfirm: false, insecureBound: false }),
    syncPairClaim: async () => ({
      ok: false,
      error: 'certificate_error',
      code: 'EPROTO',
      message: nodeMessage,
      certificateError: true,
      needsTrustConfirm: true,
      uiState: 'certificate_error',
    }),
  };
  const result = await pairUi.runPairSubmit({
    code: '111222',
    baseUrl: 'https://39.106.162.144:34931',
    api,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'https_on_http');
  assert.equal(result.message, HTTPS_ON_HTTP_MESSAGE);
  assert.match(result.message, /HTTP，不是 HTTPS/);
  assert.match(result.message, /http:\/\//);
  assert.equal(result.needsTrustConfirm, false);
  assert.equal(result.certificateError, false);
  assert.equal(result.dialog, null);
  assert.equal(pairUi.shouldOpenCertificateTrustDialog(result), false);
  assert.equal(pairUi.shouldOpenCertificateTrustDialog({
    ok: false,
    error: 'certificate_error',
    code: 'ERR_SSL_WRONG_VERSION_NUMBER',
    message: nodeMessage,
    certificateError: true,
    needsTrustConfirm: true,
  }), false);

  let state = pairUi.initialPairUiState();
  state = pairUi.reducePairUi(state, { type: 'open_http_confirm', confirmText: '明文' });
  state = pairUi.reducePairUi(state, {
    type: 'failure',
    message: result.message,
    needsTrustConfirm: false,
  });
  assert.equal(state.dialog, null);
  assert.equal(state.needsTrustConfirm, false);
  assert.equal(state.error, HTTPS_ON_HTTP_MESSAGE);

  const trustedCert = await pairUi.runPairSubmit({
    code: '111222',
    baseUrl: 'https://nas.example',
    api: {
      syncPairHttpPolicy: async () => ({ ok: true, requiresExtraConfirm: false }),
      syncPairClaim: async () => ({
        ok: false,
        error: 'certificate_error',
        message: '证书错误',
        certificateError: true,
        needsTrustConfirm: true,
        uiState: 'certificate_error',
      }),
    },
  });
  assert.equal(trustedCert.error, 'certificate_error');
  assert.equal(trustedCert.needsTrustConfirm, true);
  assert.equal(trustedCert.certificateError, true);
  assert.equal(pairUi.shouldOpenCertificateTrustDialog(trustedCert), true);
  assert.equal(trustedCert.dialog, null);
});

test('workspace wires Enter submit and notchAPI pair IPC (no electron require)', () => {
  assert.match(workspaceJs, /submitNasPair/);
  assert.match(workspaceJs, /keydown/);
  assert.match(workspaceJs, /syncPairClaim/);
  assert.match(workspaceJs, /httpConfirmAccepted/);
  assert.match(workspaceJs, /shouldOpenCertificateTrustDialog\(result\)/);
  const failureBranch = workspaceJs.slice(workspaceJs.indexOf('if (!result.ok)'));
  const failureHead = failureBranch.slice(0, failureBranch.indexOf('applyNasPairUi({ type: \'success\''));
  assert.match(failureHead, /shouldOpenCertificateTrustDialog/);
  assert.doesNotMatch(failureHead, /openNasDialog/);
  assert.match(workspaceJs, /result\.error === 'https_on_http'/);
  assert.doesNotMatch(workspaceJs, /require\(['"]electron['"]\)/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /syncPairClaim/);
  assert.match(preload, /syncGetStatus/);
});
