'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('../fnos/app/server/createApp');
const { createMemoryStore } = require('../fnos/app/server/store');
const { applyGatewayTrimHygiene } = require('../fnos/app/server/auth');
const { dispatch } = require('../fnos/app/server/testHarness');
const { encryptJson } = require('../packages/sync-protocol');
const { buildWorkspaceView, buildWorkspaceMedia, maskAccount } = require('../fnos/app/server/workspace-view');
const panelUi = require('../fnos/app/ui/panel.js');

const uiRoot = path.join(__dirname, '..', 'fnos', 'app', 'ui');
const html = fs.readFileSync(path.join(uiRoot, 'index.html'), 'utf8');
const panelSrc = fs.readFileSync(path.join(uiRoot, 'panel.js'), 'utf8');

function gatewayHeaders(uid = 'uid-alice') {
  return applyGatewayTrimHygiene(
    { 'x-trim-userid': 'spoof' },
    { injectUid: uid, injectUsername: 'alice' },
  );
}

function makeEl() {
  return {
    hidden: false,
    textContent: '',
    className: '',
    type: '',
    alt: '',
    src: '',
    controls: false,
    preload: '',
    children: [],
    attrs: {},
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return this.attrs[key]; },
    removeAttribute(key) { delete this.attrs[key]; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) {
      this.listeners = this.listeners || {};
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
  };
}

function makeDom() {
  const ids = [
    'workspace-status',
    'workspace-list',
    'workspace-empty',
    'workspace-tabs',
    'panel-content',
    'panel-devices',
    'nav-content',
    'nav-devices',
  ];
  const store = {};
  for (const id of ids) store[id] = makeEl();
  store['panel-devices'].hidden = true;
  store['nav-content'].attrs['aria-current'] = 'page';
  const doc = {
    getElementById(id) { return store[id] || null; },
    querySelector(sel) {
      if (sel === 'meta[name="gateway-prefix"]') {
        return { getAttribute: () => '/app/pome-panel' };
      }
      return null;
    },
    createElement() { return makeEl(); },
  };
  return { store, doc };
}

function textOf(node) {
  if (!node) return '';
  const own = node.children && node.children.length ? '' : (node.textContent || '');
  return own + (node.children || []).map(textOf).join('');
}

function hrefsOf(node, acc = []) {
  if (node && node.attrs && node.attrs.href) acc.push(node.attrs.href);
  for (const child of (node && node.children) || []) hrefsOf(child, acc);
  return acc;
}

test('NAS panel shell is content-first and keeps pairing as a module', () => {
  assert.match(html, /id="nav-content"/);
  assert.match(html, /id="nav-devices"/);
  assert.match(html, />内容</);
  assert.match(html, />设备</);
  assert.match(html, /id="panel-content"/);
  assert.doesNotMatch(html, /id="panel-content"[^>]*\shidden/);
  assert.match(html, /id="panel-devices"[^>]*\shidden/);
  assert.match(html, /id="pair-start-btn"/);
  assert.match(html, /id="pair-refresh-btn"/);
  assert.match(html, />生成配对码</);
  assert.match(html, /data-control-id="fnos.devices.list"/);
  assert.match(html, /已配对设备/);
  assert.match(html, /应用重启后，需要桌面再同步一次才会重新出现/);
  assert.match(html, /\/app\/pome-panel\/panel\.js/);
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  assert.doesNotMatch(visible, /\/api\/v1\//);
  assert.doesNotMatch(panelSrc, /fetch\(\s*'\/api\/v1\//);
  assert.doesNotMatch(panelSrc, /\.innerHTML\s*=/);
});

test('workspace view masks secrets and keeps media bytes off the JSON', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const password = 'super-secret-password';
  const apiKey = 'sk-live-should-not-leak';
  const png = Buffer.from('PNGDATA').toString('base64');
  const entities = [
    {
      entityId: 'note:home',
      collection: 'notes',
      payload: { kind: 'home', markdown: '会议纪要' },
    },
    {
      entityId: 'secret:s1',
      collection: 'secrets',
      payload: encryptJson({
        id: 's1',
        service: 'OpenAI',
        account: 'alice@example.com',
        password,
      }, key),
    },
    {
      entityId: 'ai:settings',
      collection: 'aiSettings',
      payload: encryptJson({ apiKey, llmApiKey: '', region: 'cn', llmModel: 'qwen' }, key),
    },
    {
      entityId: 'clip:c1',
      collection: 'clipboardHistory',
      payload: { id: 'c1', type: 'image', text: '配图', imageBase64: png },
    },
  ];
  const view = buildWorkspaceView(entities, key);
  const dumped = JSON.stringify(view);
  assert.equal(view.notes.home, '会议纪要');
  assert.equal(view.secrets[0].service, 'OpenAI');
  assert.equal(view.secrets[0].account, maskAccount('alice@example.com'));
  assert.equal(view.ai.asr, '已配置');
  assert.equal(view.ai.llm, '未配置');
  assert.equal(view.clipboard[0].hasImage, true);
  assert.equal(view.clipboard[0].imageBase64, undefined);
  assert.equal(dumped.includes(password), false);
  assert.equal(dumped.includes(apiKey), false);
  assert.equal(dumped.includes(png), false);

  const sealedOnly = buildWorkspaceView([{
    entityId: 'secret:s1',
    collection: 'secrets',
    payload: entities[1].payload,
  }], null);
  assert.equal(sealedOnly.secrets[0].service, '已配置');
  assert.equal(JSON.stringify(sealedOnly).includes(password), false);

  const media = buildWorkspaceMedia(entities, 'clip:c1');
  assert.equal(media.mime, 'image/png');
  assert.equal(media.bytes.toString('utf8'), 'PNGDATA');
  assert.equal(buildWorkspaceMedia(entities, 'secret:s1'), null);
  assert.equal(buildWorkspaceMedia(entities, 'ai:settings'), null);
});

test('GET /api/v1/workspace and media require a session and redact secrets', async () => {
  const store = createMemoryStore({ serverId: 'srv-panel' });
  const key = store.getOrCreateAccountSyncKey('uid-alice');
  const password = 'vault-password-raw';
  const apiKey = 'sk-panel-raw-key';
  store.applyPush('uid-alice', [
    {
      entityId: 'note:home',
      collection: 'notes',
      op: 'upsert',
      payload: { kind: 'home', markdown: '会议纪要' },
      clientMutationId: 'n1',
    },
    {
      entityId: 'secret:s1',
      collection: 'secrets',
      op: 'upsert',
      payload: encryptJson({
        id: 's1',
        service: 'OpenAI',
        account: 'alice@example.com',
        password,
      }, key),
      clientMutationId: 's1',
    },
    {
      entityId: 'ai:settings',
      collection: 'aiSettings',
      op: 'upsert',
      payload: encryptJson({ apiKey, llmApiKey: 'llm-raw', region: 'cn' }, key),
      clientMutationId: 'a1',
    },
    {
      entityId: 'clip:c1',
      collection: 'clipboardHistory',
      op: 'upsert',
      payload: {
        id: 'c1',
        type: 'image',
        text: '配图',
        imageBase64: Buffer.from('PNGDATA').toString('base64'),
      },
      clientMutationId: 'c1',
    },
  ]);
  const app = createApp({ listenMode: 'gateway', store, serverId: 'srv-panel' });

  const denied = await dispatch(app, { method: 'GET', url: '/api/v1/workspace' });
  assert.equal(denied.statusCode, 401);

  const ok = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/workspace',
    headers: gatewayHeaders(),
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.getJson();
  const dumped = JSON.stringify(body);
  assert.equal(body.notes.home, '会议纪要');
  assert.equal(body.secrets[0].account, 'a…m');
  assert.equal(body.ai.asr, '已配置');
  assert.equal(dumped.includes(password), false);
  assert.equal(dumped.includes(apiKey), false);
  assert.equal(dumped.includes('llm-raw'), false);
  assert.equal(dumped.includes('imageBase64'), false);
  assert.equal(dumped.includes('PNGDATA'), false);

  const media = await dispatch(app, {
    method: 'GET',
    url: `/api/v1/workspace/media/${encodeURIComponent('clip:c1')}`,
    headers: gatewayHeaders(),
  });
  assert.equal(media.statusCode, 200);
  assert.match(String(media.headers['Content-Type']), /image\/png/);
  assert.equal(media.getBody(), 'PNGDATA');

  const secretMedia = await dispatch(app, {
    method: 'GET',
    url: `/api/v1/workspace/media/${encodeURIComponent('secret:s1')}`,
    headers: gatewayHeaders(),
  });
  assert.equal(secretMedia.statusCode, 404);

  const token = store.issueToken({ uid: 'uid-alice', deviceId: 'dev-panel' });
  const byDevice = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/workspace',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(byDevice.statusCode, 200);
  assert.equal(byDevice.getJson().notes.home, '会议纪要');
});

test('panel controller renders synced notes and switches to devices', async () => {
  const view = {
    notes: { home: '会议纪要', activeId: '', archive: [] },
    clipboard: [{ id: 'c1', type: 'image', text: '配图', hasImage: true, favorite: true }],
    recordings: [{
      id: 'r1',
      title: '站会',
      transcript: '今天先看同步',
      durationMs: 65000,
      hasAudio: true,
      audioOmitted: false,
    }],
    links: [{
      id: 'g1',
      name: '常用',
      links: [
        { id: 'l1', url: 'https://example.com/a', title: '示例' },
        { id: 'l2', url: 'javascript:alert(1)', title: '坏链接' },
      ],
    }],
    todos: [{ id: 't1', text: '写周报', done: false, categoryId: 'P0', deadline: '23:30' }],
    categories: { P0: '课程', P1: '自媒体&写作', P2: 'Vibe coding', P3: '日常' },
    ai: { configured: true, asr: '已配置', llm: '未配置', model: 'qwen', region: '', workspaceId: '' },
    secrets: [{ id: 's1', service: 'OpenAI', account: 'a…m', configured: true }],
    counts: { notes: 1, clipboard: 1, recordings: 1, links: 2, todos: 1, secrets: 1 },
  };
  const mediaUrls = [];
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/workspace/media/')) {
      mediaUrls.push(target);
      return { ok: true, status: 200, blob: async () => ({ size: 7 }), json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => view };
  };
  const { store, doc } = makeDom();
  const controller = panelUi.createPanelController({
    document: doc,
    fetch: fetchImpl,
    gatewayPrefix: '/app/pome-panel',
  });
  await controller.init();
  assert.match(textOf(store['workspace-list']), /会议纪要/);
  assert.match(store['workspace-status'].textContent, /笔记 1/);
  assert.equal(store['workspace-empty'].hidden, true);
  assert.match(textOf(store['workspace-tabs']), /剪贴板/);
  assert.equal(store['panel-devices'].hidden, true);

  await controller.selectTab('clipboard');
  assert.match(textOf(store['workspace-list']), /配图/);
  assert.match(textOf(store['workspace-list']), /已收藏/);
  assert.equal(mediaUrls.length, 1);
  assert.match(mediaUrls[0], /\/app\/pome-panel\/api\/v1\/workspace\/media\/clip%3Ac1/);

  await controller.selectTab('recordings');
  assert.match(textOf(store['workspace-list']), /站会/);
  assert.match(textOf(store['workspace-list']), /今天先看同步/);
  assert.match(textOf(store['workspace-list']), /1:05/);

  await controller.selectTab('links');
  assert.match(textOf(store['workspace-list']), /示例/);
  assert.match(textOf(store['workspace-list']), /坏链接/);
  const hrefs = hrefsOf(store['workspace-list']);
  assert.deepEqual(hrefs, ['https://example.com/a']);

  await controller.selectTab('todos');
  assert.match(textOf(store['workspace-list']), /写周报/);
  assert.match(textOf(store['workspace-list']), /课程/);

  await controller.selectTab('config');
  assert.match(textOf(store['workspace-list']), /语音转写：已配置/);
  assert.match(textOf(store['workspace-list']), /对话模型：未配置/);
  assert.match(textOf(store['workspace-list']), /OpenAI/);
  assert.match(textOf(store['workspace-list']), /a…m/);
  assert.doesNotMatch(textOf(store['workspace-list']), /password|apiKey|sk-/);

  await controller.selectTab('notes');
  controller.showSection('devices');
  assert.equal(store['panel-content'].hidden, true);
  assert.equal(store['panel-devices'].hidden, false);
  assert.equal(store['nav-devices'].attrs['aria-current'], 'page');
  assert.equal(store['nav-content'].attrs['aria-current'], undefined);

  assert.equal(panelUi.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(panelUi.safeHttpUrl('https://example.com/a'), 'https://example.com/a');
});
