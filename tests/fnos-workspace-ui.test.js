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
    'workspace-empty',
    'notes-list',
    'notes-detail',
    'notes-count',
    'notes-search',
    'clip-list',
    'recording-list',
    'recording-detail',
    'recording-count',
    'link-groups',
    'command-list',
    'credential-list',
    'credential-count',
    'nas-asr-status',
    'nas-llm-status',
    'nas-ai-meta',
  ];
  for (const priority of ['P0', 'P1', 'P2', 'P3']) {
    ids.push(`todo-name-${priority}`, `todo-count-${priority}`, `todo-list-${priority}`);
  }
  for (const tab of ['devices', 'todo', 'clip', 'notes', 'commands', 'links', 'recordings', 'credentials']) {
    ids.push(`tab-button-${tab}`, `tab-${tab}`);
  }
  for (const filter of ['all', 'text', 'image', 'faved']) ids.push(`clip-filter-${filter}`);
  const store = {};
  for (const id of ids) store[id] = makeEl();
  store['tab-devices'].hidden = false;
  store['tab-button-devices'].className = 'tab active';
  store['notes-search'].value = '';
  const doc = {
    getElementById(id) { return store[id] || null; },
    querySelector(sel) {
      if (sel === 'meta[name="gateway-prefix"]') {
        return { getAttribute: () => '/app/pomepanel' };
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

test('NAS panel uses desktop tab chrome and puts 设备 in the home slot', () => {
  assert.match(html, /class="tabs"/);
  assert.match(html, /class="tab active"/);
  assert.match(html, /id="tab-button-devices"/);
  assert.match(html, />设备</);
  assert.doesNotMatch(html, />首页</);
  assert.doesNotMatch(html, /id="nav-content"/);
  const order = [...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['devices', 'todo', 'clip', 'notes', 'commands', 'links', 'recordings', 'credentials']);
  assert.match(html, />常用命令</);
  assert.doesNotMatch(html, /id="tab-commands"[\s\S]*还没有/);
  assert.match(html, /id="tab-devices"[^>]*class="tab-panel active"/);
  assert.match(html, /id="tab-todo"[^>]*hidden/);
  assert.match(html, /class="sections"/);
  assert.match(html, /class="quadrant tile"/);
  assert.match(html, /id="pair-start-btn"/);
  assert.match(html, /id="pair-refresh-btn"/);
  assert.match(html, />生成配对码</);
  assert.match(html, /data-control-id="fnos.devices.list"/);
  assert.match(html, /已配对设备/);
  assert.doesNotMatch(html, /应用重启后，需要桌面再同步一次才会重新出现/);
  assert.doesNotMatch(html, /还没有同步内容/);
  assert.doesNotMatch(html, /还没有待办|还没有笔记|还没有链接|还没有密钥|还没有同步的笔记/);
  assert.doesNotMatch(html, /id="workspace-status"|id="workspace-empty"|nas-memory-note/);
  assert.match(html, /\/app\/pomepanel\/panel\.js/);
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
    {
      entityId: 'command:cmd-1',
      collection: 'commands',
      payload: { id: 'cmd-1', text: 'npm test', createdAt: 3 },
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
  assert.equal(view.commands[0].text, 'npm test');
  assert.equal(view.counts.commands, 1);
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
    commands: [
      { id: 'cmd-1', text: 'npm test', createdAt: 9 },
      { id: 'cmd-2', text: 'git status', createdAt: 2 },
    ],
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
    gatewayPrefix: '/app/pomepanel',
  });
  await controller.init();
  assert.match(textOf(store['notes-list']), /会议纪要/);
  assert.equal(store['workspace-status'].textContent, '');
  assert.doesNotMatch(textOf(store['todo-list-P1']), /还没有待办/);
  assert.equal(store['tab-devices'].hidden, false);
  assert.equal(store['tab-notes'].hidden, true);
  assert.equal(store['tab-button-devices'].className, 'tab active');

  await controller.selectTab('clip');
  assert.equal(store['tab-clip'].hidden, false);
  assert.equal(store['tab-devices'].hidden, true);
  assert.match(textOf(store['clip-list']), /配图/);
  assert.match(textOf(store['clip-list']), /已收藏/);
  assert.ok(mediaUrls.some((url) => url.includes('/app/pomepanel/api/v1/workspace/media/clip%3Ac1')));

  await controller.selectTab('recordings');
  assert.match(textOf(store['recording-list']), /站会/);
  assert.match(textOf(store['recording-detail']), /今天先看同步/);
  assert.match(textOf(store['recording-detail']), /1:05/);

  await controller.selectTab('commands');
  assert.equal(store['tab-commands'].hidden, false);
  assert.match(textOf(store['command-list']), /npm test/);
  assert.match(textOf(store['command-list']), /git status/);
  assert.doesNotMatch(textOf(store['command-list']), /还没有/);

  await controller.selectTab('links');
  assert.match(textOf(store['link-groups']), /示例/);
  assert.match(textOf(store['link-groups']), /坏链接/);
  assert.deepEqual(hrefsOf(store['link-groups']), ['https://example.com/a']);

  await controller.selectTab('todo');
  assert.match(textOf(store['todo-list-P0']), /写周报/);
  assert.equal(store['todo-name-P0'].textContent, '课程');

  await controller.selectTab('credentials');
  assert.equal(store['nas-asr-status'].textContent, '已配置');
  assert.equal(store['nas-llm-status'].textContent, '未配置');
  assert.match(textOf(store['credential-list']), /OpenAI/);
  assert.match(textOf(store['credential-list']), /a…m/);
  assert.doesNotMatch(textOf(store['credential-list']), /password|apiKey|sk-/);

  await controller.showSection('devices');
  assert.equal(store['tab-devices'].hidden, false);
  assert.equal(store['tab-credentials'].hidden, true);
  assert.equal(store['tab-button-devices'].attrs['aria-selected'], 'true');

  assert.equal(panelUi.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(panelUi.safeHttpUrl('https://example.com/a'), 'https://example.com/a');
});
