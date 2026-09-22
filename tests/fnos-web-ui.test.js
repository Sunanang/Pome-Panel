'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pairUi = require('../fnos/app/ui/pair.js');
const { createApp } = require('../fnos/app/server/createApp');
const { wrapWithGatewayPrefix, stripGatewayPrefix } = require('../fnos/app/server/gatewayHttp');
const { applyGatewayTrimHygiene } = require('../fnos/app/server/auth');
const { dispatch } = require('../fnos/app/server/testHarness');

const uiRoot = path.join(__dirname, '..', 'fnos', 'app', 'ui');
const html = fs.readFileSync(path.join(uiRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(uiRoot, 'styles.css'), 'utf8');
const pairSrc = fs.readFileSync(path.join(uiRoot, 'pair.js'), 'utf8');

const CONTROL_CHECKLIST = [
  { id: 'fnos.pair.start', mark: 'data-control-id="fnos.pair.start"' },
  { id: 'fnos.pair.refresh', mark: 'data-control-id="fnos.pair.refresh"' },
  { id: 'fnos.pair.status', mark: 'data-control-id="fnos.pair.status"' },
  { id: 'fnos.pair.code', mark: 'data-control-id="fnos.pair.code"' },
  { id: 'fnos.devices.list', mark: 'data-control-id="fnos.devices.list"' },
];

test('FPK Web UI controls exist with workspace-button / settings-card (S3/S7)', () => {
  assert.match(html, /class="[^"]*tile settings-card/);
  assert.match(html, /class="[^"]*workspace-button[^"]*primary/);
  assert.match(html, /id="pair-start-btn"/);
  assert.match(html, /id="pair-refresh-btn"/);
  assert.match(html, />生成配对码</);
  assert.match(html, />刷新</);
  assert.match(html, /meta name="gateway-prefix" content="\/app\/pome-panel"/);
  for (const row of CONTROL_CHECKLIST) {
    assert.match(html, new RegExp(row.mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('FPK Web user-facing copy has no bare /api paths', () => {
  // Strip script tags — API paths may exist only in JS fetch helpers, never in visible HTML copy.
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  assert.doesNotMatch(visible, /\/api\/v1\//);
  assert.doesNotMatch(visible, /POST\s+\/api/i);
  assert.doesNotMatch(visible, /GET\s+\/api/i);
  assert.doesNotMatch(visible, /\bCSRF\s*\+/i);
});

test('FPK Web style uses desktop tokens — no banned palette / no inline color (S1/S2/S6/S7)', () => {
  assert.doesNotMatch(html, /style\s*=\s*"[^"]*(?:color|background)\s*:/i);
  assert.match(css, /--bg-base:\s*#000000/);
  assert.match(css, /--text-1:\s*#F5F5F5/);
  assert.match(css, /--surface-1:/);
  assert.match(css, /--focus-ring:/);
  assert.match(css, /--accent-orange:/);
  assert.match(css, /\.workspace-button/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /\b(?:Inter|Roboto|Arial)\b/);
  assert.doesNotMatch(css, /linear-gradient\([^)]*(?:purple|indigo|#7[cC]|#6[dD])/i);
  assert.doesNotMatch(css, /#F4F1EA/i);
  // Pairing code must beat `.settings-card p { font-size: 11px }` and stay display-sized.
  assert.match(css, /\.settings-card\s+\.nas-web-code|#pair-code\.nas-web-code/);
  assert.match(css, /font:\s*700\s+4[0-9]px/);
  // Empty tabs must not invent page scroll with huge shell min-heights.
  assert.doesNotMatch(css, /\.panel\s*\{[^}]*min-height:\s*(?:[6-9]\d{2}|[1-9]\d{3,})px/s);
  assert.doesNotMatch(css, /\.panels\s*\{[^}]*min-height:\s*(?:[5-9]\d{2}|[1-9]\d{3,})px/s);
  assert.doesNotMatch(css, /min-height:\s*100vh/);
  assert.match(css, /\.tab-panel:not\(\.active\)\s*\{\s*display:\s*none/);
});

test('resolveApiPrefix / apiUrl honor gatewayPrefix (absolute /api was the break)', () => {
  assert.equal(pairUi.resolveApiPrefix('/app/pome-panel/', null), '/app/pome-panel');
  assert.equal(pairUi.resolveApiPrefix('/app/pome-panel/index.html', null), '/app/pome-panel');
  assert.equal(pairUi.resolveApiPrefix('/app/pome-panel', null), '/app/pome-panel');
  assert.equal(pairUi.resolveApiPrefix('/', '/app/pome-panel'), '/app/pome-panel');
  assert.equal(
    pairUi.apiUrl('/app/pome-panel', '/api/v1/pair/start'),
    '/app/pome-panel/api/v1/pair/start',
  );
  assert.equal(pairUi.apiUrl('', '/api/v1/pair/csrf'), '/api/v1/pair/csrf');
  assert.doesNotMatch(pairSrc, /fetch\(\s*'\/api\/v1\//);
  assert.match(pairSrc, /resolveApiPrefix|apiUrl/);
  assert.match(pairSrc, /\/api\/v1\/me/);
  assert.match(pairSrc, /AbortController|fetchTimeoutMs|timeout/);
});

test('formatRemaining countdown copy', () => {
  assert.equal(pairUi.formatRemaining(0), '已过期');
  assert.equal(pairUi.formatRemaining(-1), '已过期');
  assert.match(pairUi.formatRemaining(65_000), /剩余 1:05/);
});

test('humanError maps known codes and never echoes /api paths', () => {
  assert.match(pairUi.humanError('gateway_session_required'), /飞牛已登录/);
  assert.match(pairUi.humanError('csrf_missing'), /CSRF|安全校验/);
  assert.match(pairUi.humanError('timeout'), /超时/);
  assert.equal(pairUi.humanError('/api/v1/pair/start failed'), '操作失败，请重试');
});

test('extractPairingCode accepts pairingCode or code', () => {
  assert.equal(pairUi.extractPairingCode({ pairingCode: '123456' }), '123456');
  assert.equal(pairUi.extractPairingCode({ code: '654321' }), '654321');
  assert.equal(pairUi.extractPairingCode({}), '');
});

test('stripGatewayPrefix maps iframe paths to /api/v1', () => {
  assert.equal(stripGatewayPrefix('/app/pome-panel/api/v1/health', '/app/pome-panel'), '/api/v1/health');
  assert.equal(stripGatewayPrefix('/app/pome-panel', '/app/pome-panel'), '/');
  assert.equal(stripGatewayPrefix('/app/pome-panel/', '/app/pome-panel'), '/');
});

function gatewayHeaders(uid = 'uid-alice', extra = {}) {
  return {
    ...applyGatewayTrimHygiene(
      { 'x-trim-userid': 'spoof', origin: 'http://localhost' },
      { injectUid: uid, injectUsername: 'alice' },
    ),
    origin: 'http://localhost',
    host: 'localhost',
    ...extra,
  };
}

function makeDomStore() {
  const store = {
    'pair-status': {
      textContent: '',
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return this.attrs[k]; },
    },
    'pair-code': { textContent: '' },
    'pair-code-wrap': { hidden: true },
    'pair-expiry': { textContent: '' },
    'device-list': { innerHTML: '', children: [], appendChild(n) { this.children.push(n); } },
    'device-empty': {
      hidden: false,
      textContent: '',
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
    },
    'pair-start-btn': { disabled: false, addEventListener() {} },
    'pair-refresh-btn': { disabled: false, addEventListener() {} },
    'session-pill': { dataset: { state: 'unknown' }, textContent: '检测会话…' },
  };
  const doc = {
    getElementById(id) { return store[id] || null; },
    querySelector(sel) {
      if (sel === 'meta[name="gateway-prefix"]') {
        return { getAttribute: () => '/app/pome-panel' };
      }
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: tag,
        className: '',
        textContent: '',
        type: '',
        children: [],
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(c) { this.children.push(c); },
        addEventListener() {},
      };
      return el;
    },
  };
  return { store, doc };
}

test('pair UI controller: generate code via prefixed pair/start + refresh devices', async () => {
  const app = createApp({ listenMode: 'gateway', serverId: 'srv-ui' });
  const staticRoot = uiRoot;
  const wrapped = wrapWithGatewayPrefix(app, {
    gatewayPrefix: '/app/pome-panel',
    staticRoot,
  });

  await new Promise((resolve, reject) => {
    wrapped.server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const { port } = wrapped.server.address();
  const base = `http://127.0.0.1:${port}/app/pome-panel`;

  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: (init.method || 'GET').toUpperCase() });
    const u = new URL(url, base);
    const host = `127.0.0.1:${port}`;
    const headers = {
      ...gatewayHeaders('uid-alice', {
        origin: `http://${host}`,
        host,
      }),
      ...(init.headers || {}),
    };
    const flat = {};
    for (const [k, v] of Object.entries(headers)) flat[String(k).toLowerCase()] = v;
    return fetch(u.toString(), { ...init, headers: flat });
  };

  const { store, doc } = makeDomStore();

  const controller = pairUi.createPairUiController({
    document: doc,
    window: {
      location: { pathname: '/app/pome-panel/' },
      setInterval: () => 1,
      clearInterval: () => {},
      confirm: () => true,
    },
    fetch: fetchImpl,
    preferDefaultPrefix: true,
  });

  assert.equal(controller.apiPrefix, '/app/pome-panel');

  const session = await controller.checkSession();
  assert.equal(session.ok, true);
  assert.match(store['session-pill'].textContent, /已登录/);
  assert.notEqual(store['session-pill'].textContent, '检测会话…');

  const started = await controller.startPair();
  assert.ok(started && started.pairingCode);
  assert.match(started.pairingCode, /^\d{6}$/);
  assert.equal(store['pair-code'].textContent, started.pairingCode);
  assert.equal(store['pair-code-wrap'].hidden, false);
  assert.match(store['pair-status'].textContent, /已生成/);
  assert.equal(store['pair-status'].attrs['data-kind'], 'ok');

  const devices = await controller.loadDevices();
  assert.equal(devices.ok, true);

  const refreshed = await controller.refreshAll();
  assert.equal(refreshed.sessionOk, true);
  assert.equal(refreshed.devices.ok, true);

  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/me')));
  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/pair/csrf')));
  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/pair/start') && c.method === 'POST'));
  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/devices')));
  assert.ok(!calls.some((c) => /^https?:\/\/[^/]+\/api\/v1\//.test(c.url) && !c.url.includes('/app/pome-panel/')));

  const uiRes = await fetch(`${base}/`);
  assert.equal(uiRes.status, 200);
  const uiText = await uiRes.text();
  assert.match(uiText, /生成配对码/);
  assert.doesNotMatch(uiText.replace(/<script[\s\S]*?<\/script>/gi, ''), /\/api\/v1\//);

  await wrapped.close();
});

test('pair UI shows visible error when unauthenticated (no silent hang on 检测会话)', async () => {
  const { store, doc } = makeDomStore();
  const fetchImpl = async () => {
    return new Response(JSON.stringify({ error: 'gateway_session_required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const controller = pairUi.createPairUiController({
    document: doc,
    window: { location: { pathname: '/app/pome-panel/' }, setInterval() { return 1; }, clearInterval() {} },
    fetch: fetchImpl,
  });
  await controller.init();
  assert.equal(store['session-pill'].dataset.state, 'error');
  assert.notEqual(store['session-pill'].textContent, '检测会话…');
  assert.match(store['pair-status'].textContent, /飞牛已登录|未登录|登录会话/);

  const started = await controller.startPair();
  assert.equal(started, null);
  assert.equal(store['pair-code-wrap'].hidden, true);
  assert.match(store['pair-status'].textContent, /飞牛已登录|未登录|登录会话/);
});

test('pair UI surfaces network/timeout failures instead of silent fail', async () => {
  const { store, doc } = makeDomStore();
  const fetchImpl = async () => {
    const err = new Error('Failed to fetch');
    err.name = 'TypeError';
    throw err;
  };
  const controller = pairUi.createPairUiController({
    document: doc,
    window: { location: { pathname: '/app/pome-panel/' }, setInterval() { return 1; }, clearInterval() {} },
    fetch: fetchImpl,
    fetchTimeoutMs: 50,
  });
  const session = await controller.checkSession();
  assert.equal(session.ok, false);
  assert.notEqual(store['session-pill'].textContent, '检测会话…');
  assert.match(store['pair-status'].textContent, /网络|失败|超时/);

  const started = await controller.startPair();
  assert.equal(started, null);
  assert.match(store['pair-status'].textContent, /网络|失败|超时|登录/);
});

test('pair UI shows CSRF / 4xx body on pair/start failure', async () => {
  const { store, doc } = makeDomStore();
  let n = 0;
  const fetchImpl = async (url, init = {}) => {
    n += 1;
    const path = String(url);
    if (path.includes('/me')) {
      return new Response(JSON.stringify({ uid: 'u1', username: 'bob' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path.includes('/pair/csrf')) {
      return new Response(JSON.stringify({ csrfToken: 'tok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path.includes('/pair/start') && (init.method || 'GET').toUpperCase() === 'POST') {
      return new Response(JSON.stringify({ error: 'origin_rejected' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ devices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const controller = pairUi.createPairUiController({
    document: doc,
    window: { location: { pathname: '/app/pome-panel/' }, setInterval() { return 1; }, clearInterval() {} },
    fetch: fetchImpl,
  });
  const started = await controller.startPair();
  assert.equal(started, null);
  assert.match(store['pair-status'].textContent, /来源校验|飞牛应用/);
  assert.equal(store['pair-code-wrap'].hidden, true);
  assert.ok(n >= 3);
});

test('gateway-prefixed pair/start still requires session + CSRF', async () => {
  const app = createApp({ listenMode: 'gateway' });
  const denied = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/start',
    headers: { origin: 'http://localhost' },
    body: {},
  });
  assert.equal(denied.statusCode, 401);
});
