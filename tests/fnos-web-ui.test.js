'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');

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
  // Regression: must not ship leading-slash absolute API fetches without prefix helper.
  assert.doesNotMatch(pairSrc, /fetch\(\s*'\/api\/v1\//);
  assert.match(pairSrc, /resolveApiPrefix|apiUrl/);
});

test('formatRemaining countdown copy', () => {
  assert.equal(pairUi.formatRemaining(0), '已过期');
  assert.equal(pairUi.formatRemaining(-1), '已过期');
  assert.match(pairUi.formatRemaining(65_000), /剩余 1:05/);
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

  // Minimal DOM stub
  const store = {
    'pair-status': { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k]; } },
    'pair-code': { textContent: '' },
    'pair-code-wrap': { hidden: true },
    'pair-expiry': { textContent: '' },
    'device-list': { innerHTML: '', children: [], appendChild(n) { this.children.push(n); } },
    'device-empty': { hidden: false, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
    'pair-start-btn': { disabled: false, addEventListener() {} },
    'pair-refresh-btn': { disabled: false, addEventListener() {} },
    'session-pill': { dataset: {}, textContent: '' },
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
  const started = await controller.startPair();
  assert.ok(started && started.pairingCode);
  assert.match(started.pairingCode, /^\d{6}$/);
  assert.equal(store['pair-code'].textContent, started.pairingCode);
  assert.equal(store['pair-code-wrap'].hidden, false);

  const devices = await controller.loadDevices();
  assert.equal(devices.ok, true);

  const refreshed = await controller.refreshAll();
  assert.equal(refreshed.csrfOk, true);
  assert.equal(refreshed.devices.ok, true);

  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/pair/csrf')));
  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/pair/start') && c.method === 'POST'));
  assert.ok(calls.some((c) => c.url.includes('/app/pome-panel/api/v1/devices')));
  assert.ok(!calls.some((c) => /^https?:\/\/[^/]+\/api\/v1\//.test(c.url) && !c.url.includes('/app/pome-panel/')));

  // Static UI served under prefix
  const uiRes = await fetch(`${base}/`);
  assert.equal(uiRes.status, 200);
  const uiText = await uiRes.text();
  assert.match(uiText, /生成配对码/);

  await wrapped.close();
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
