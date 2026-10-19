'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../localization/runtime');
const resources = require('../scripts/localization-resources');
const notifications = require('../renderer/notification-domain');
const services = require('../main-services');
const { createTaskInbox, completionEventId } = require('../taskInbox');
const nas = require('../renderer/nas-sync-settings');

test.afterEach(() => L.setState({ ...L.snapshot('zh-CN'), revision: L.getState().revision + 1 }));

test('first launch resolves supported system languages and falls back without using region as language', () => {
  for (const tag of ['zh-CN', 'zh_Hans_CN', 'zh-Hans-SG']) assert.equal(L.resolve('system', [tag]), 'zh-CN');
  for (const tag of ['en', 'en-GB', 'en-US']) assert.equal(L.resolve('system', [tag]), 'en-US');
  assert.equal(L.resolve('system', ['ja-JP']), 'en-US');
  assert.equal(L.resolve('en-US', ['zh-CN']), 'en-US');
  assert.equal(L.resolve('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(L.preference('../../secret'), 'system');
  assert.equal(L.snapshot('en-US', [], 'de-DE').formatLocale, 'en-DE');
});

test('locale revisions reject stale bootstrap responses and subscription cleanup works', () => {
  let changes = 0;
  const unsubscribe = L.onChange(() => changes++), base = L.getState().revision;
  L.setState({ ...L.snapshot('en-US'), revision: base + 2 });
  assert.equal(L.setState({ ...L.snapshot('zh-CN'), revision: base + 1 }), false);
  assert.equal(L.getState().effectiveLocale, 'en-US');
  assert.equal(changes, 1);
  unsubscribe(); L.setState({ ...L.snapshot('zh-CN'), revision: base + 3 });
  assert.equal(changes, 1);
});

test('relative time uses the actual event timestamp with English singular and plural', () => {
  L.setState(L.snapshot('en-US'));
  assert.equal(L.relativeTime(1_000_000, 1_000_000), 'Just now');
  assert.equal(L.relativeTime(940_000, 1_000_000), '1 minute ago');
  assert.equal(L.relativeTime(880_000, 1_000_000), '2 minutes ago');
  assert.equal(L.relativeTime(2_000_000, 1_000_000), 'Just now');
});

test('both dictionaries, native resources and generated browser files stay complete', () => {
  assert(resources.validate({ 'zh-CN': require('../localization/locales/zh-CN.json'), 'en-US': require('../localization/locales/en-US.json') }) > 1000);
  resources.generate(true);
  const output = resources.generatedResources();
  assert(output.get('fnos/i18n/en-US').includes('[wizard]'));
  assert(output.get('build/i18n/messages.nsh').includes('1033 "Install Pome Panel"'));
  assert(output.get('build/i18n/messages.nsh').includes('2052 "安装 Pome Panel"'));
  assert(output.get('build/i18n/en.lproj/InfoPlist.strings').includes('NSMicrophoneUsageDescription'));
  assert(output.get('build/i18n/zh-Hans.lproj/InfoPlist.strings').includes('摄像头'));
  assert.throws(() => resources.validate({ 'zh-CN': { key: '{count}' }, 'en-US': { key: '{name}' } }), /Parameters differ/);
});

test('duplicate JSON keys are rejected rather than silently replacing translations', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-locale-json-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'locale.json'); fs.writeFileSync(file, '{"a":"one","a":"two"}');
  assert.throws(() => resources.readDictionary(file), /Duplicate translation key/);
});

test('English notifications preserve actual Chinese summaries and use translated generated fallbacks', () => {
  L.setState(L.snapshot('en-US'));
  const actual = '修复设置页，所有测试已通过';
  assert.equal(notifications.normalize({ source: 'codex', title: actual }).title, actual);
  assert.equal(notifications.normalize({ source: 'codex' }).title, 'Codex task completed');
  assert.equal(notifications.normalize({ source: 'codex', title: 'Codex 已完成任务', titleIsFallback: true }).title, 'Codex task completed');
  assert.equal(notifications.normalize({ source: 'codex', status: 'awaiting' }).status, 'awaiting');
  assert.equal(notifications.normalize({ source: 'todo' }).detail, 'Due within 1 hour');
  assert.equal(notifications.normalize({ source: 'cursor', title: 'Cursor 已完成任务' }).title, 'Cursor 已完成任务', 'explicit titles are not guessed from their wording');
});

test('notification capture and event identity stay stable across interface languages', t => {
  const payload = { event_id: 'locale-round', completed_at: 1700000000000 };
  const first = services.taskNotificationContent(payload, 'codex');
  L.setState(L.snapshot('en-US'));
  const second = services.taskNotificationContent(payload, 'codex');
  assert.deepEqual(second, first);
  assert.equal(second.titleIsFallback, true);
  assert.equal(completionEventId({ ...first, source: 'codex', eventId: 'locale-round' }), completionEventId({ ...second, source: 'codex', eventId: 'locale-round' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-locale-inbox-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const inbox = createTaskInbox({ filePath: path.join(dir, 'inbox.json') });
  assert.equal(inbox.accept({ ...first, source: 'codex', eventId: 'locale-round' }).record.titleIsFallback, true);
  assert.equal(inbox.accept({ ...second, source: 'codex', eventId: 'locale-round' }).duplicate, true);
});

test('old sync results translate without duplicate rows or invented per-type times', () => {
  const old = { '待办': { message: '上次同步已确认', at: 1700000000000, ok: true }, '录音音频': { message: '尚未确认全部音频传输', ok: false } };
  const before = JSON.stringify(old); L.setState(L.snapshot('en-US'));
  const rows = nas.contentResultRows(old, true);
  assert.equal(rows.length, 10);
  assert.equal(rows.find(row => row.name === 'AI completions').at, null);
  assert.equal(rows[0].name, 'Tasks'); assert.equal(rows[0].message, 'Last sync confirmed');
  assert.equal(rows[0].at, old['待办'].at);
  const audio = rows.find(row => row.name === 'Recording audio');
  assert.equal(audio.at, null); assert.equal(audio.time, '—');
  assert.equal(JSON.stringify(old), before);
  assert.match(nas.humanizeSyncError({ error: 'timeout' }), /Connection timed out/);
  assert.match(nas.humanizeSyncError({ error: 'not_bound' }), /Pair this device/);
});

test('recognition language is independent from the interface preference', () => {
  L.setState(L.snapshot('en-US')); assert.equal(L.transcriptionLanguage('zh'), 'zh');
  L.setState(L.snapshot('zh-CN')); assert.equal(L.transcriptionLanguage('en'), 'en');
  assert.equal(L.transcriptionLanguage('auto'), 'zh');
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const snapshot = main.slice(main.indexOf('function assembleWorkspaceSnapshot'), main.indexOf('function writeSyncedBytes'));
  assert.doesNotMatch(snapshot, /transcriptionLanguage|effectiveLocale/);
});

test('installation is bilingual, follows system and retains existing directory and shortcut settings', () => {
  const config = require('../package.json');
  assert.deepEqual(config.build.nsis.installerLanguages, ['en_US', 'zh_CN']);
  assert.equal(config.build.nsis.displayLanguageSelector, false);
  assert.equal(config.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(config.build.nsis.createDesktopShortcut, 'always');
  const nsis = fs.readFileSync(path.join(__dirname, '../build/installer.nsh'), 'utf8');
  for (const hook of ['preInit', 'customUnInit']) assert.match(nsis, new RegExp(`!macro ${hook}[\\s\\S]*?!insertmacro PomeSystemLanguage`));
  const afterPack = fs.readFileSync(path.join(__dirname, '../build/afterPack.js'), 'utf8');
  assert(afterPack.indexOf('InfoPlist.strings') < afterPack.indexOf("cs(appPath, true)"));
});

test('NAS browser language comes from the current host, with independent browser fallback and no server token exposure', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../renderer/localization.js'), 'utf8');
  function page(browserLanguage) {
    // Each browser gets its own runtime and preferences, not the Node singleton.
    const context = { console, Intl, WeakMap, WeakRef, Set, Map, Object, String, Number, Date,
      PomeTranslations: { 'zh-CN': require('../localization/locales/zh-CN.json'), 'en-US': require('../localization/locales/en-US.json') } };
    context.globalThis = context;
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../localization/runtime.js'), 'utf8'), context);
    const events = new Map();
    context.window = context; context.navigator = { languages: [browserLanguage] };
    context.document = { documentElement: {}, querySelectorAll: () => [], addEventListener() {} };
    context.addEventListener = (name, fn) => events.set(name, fn); context.dispatchEvent = () => {};
    context.localStorage = { getItem: () => null }; context.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
    vm.runInContext(source, context);
    return { L: context.PomeI18n, host: language => events.get('pome:host-language')({ detail: language }) };
  }
  const chinese = page('zh-CN'), english = page('en-US');
  assert.equal(chinese.L.getState().effectiveLocale, 'zh-CN'); assert.equal(english.L.getState().effectiveLocale, 'en-US');
  chinese.host('en-US'); assert.equal(chinese.L.getState().effectiveLocale, 'en-US');
  chinese.L.setState(chinese.L.snapshot('zh-CN')); chinese.host('en-US');
  assert.equal(chinese.L.getState().effectiveLocale, 'zh-CN', 'host changes cannot override manual choice');
  english.host('de-DE'); assert.equal(english.L.getState().effectiveLocale, 'en-US');
  assert.doesNotMatch(source, /TRIM_API_TOKEN|PomeNasSystemLanguage/);
  const host = fs.readFileSync(path.join(__dirname, '../fnos/app/ui/i18n/host.js'), 'utf8');
  assert.match(host, /getPlatformConfig/); assert.match(host, /1500/); assert.match(host, /os\/language/);
  assert.doesNotMatch(host, /getSessionCredentials|getUserMessage|\.query\(/);
  const crypto = require('node:crypto');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../fnos/app/ui/vendor/trimjs/web-app-0.5.0.js'))).digest('hex'), '198cb570fd43ae45be0a125eef82de8edbe5cff6df73d0139a48a9c35a8f3dec');
});

test('new link categories and generated conflict suffixes translate without rewriting historical content', () => {
  L.setState(L.snapshot('en-US'));
  const domain = require('../renderer/domain');
  assert.equal(domain.classifyLink('https://github.com/example', 'Example'), 'Development');
  const note = { id: 'stable-id', title: '原文标题（冲突副本 · Mac · 2026/10/17 10:00:00）', content: '原文正文',
    conflict: { originalTitle: '原文标题', deviceName: 'Mac', createdAt: 1700000000000, versionHash: 'unchanged' } };
  const before = JSON.stringify(note);
  assert.match(L.noteTitle(note), /^原文标题 \(conflict copy · Mac · /);
  assert.equal(JSON.stringify(note), before);
  assert.equal(L.noteTitle({ ...note, title: '用户修改后的标题' }), '用户修改后的标题');
  assert.equal(L.t('copy.deleteItems.0bfa6f', { arg1: 1 }), 'Delete 1 item');
  assert.equal(L.t('copy.deleteItems.0bfa6f', { arg1: 2 }), 'Delete 2 items');
});

test('product translation references exist and translated resources contain no HTML', () => {
  const dictionary = require('../localization/locales/en-US.json');
  const files = ['main.js', 'main-services.js', 'platform.js', 'aiSourceHooks.js', 'workspaceBackup.js'];
  function collect(directory) {
    for (const item of fs.readdirSync(path.join(__dirname, '..', directory), { withFileTypes: true })) {
      if (['vendor', 'i18n', 'node_modules'].includes(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) collect(file);
      else if (/\.(?:js|html|tsx|ts)$/.test(file) && item.name !== 'cities.js') files.push(file);
    }
  }
  for (const directory of ['renderer', 'platform-adapters', 'fnos/app/ui', 'website/app']) collect(directory);
  let references = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const regex of [/\.t\(["']([\w.]+)["']/g, /siteT\(locale,\s*["']([\w.]+)["']/g, /data-i18n(?:-[\w-]+)?=["']([\w.]+)["']/g]) {
      for (const match of source.matchAll(regex)) {
        references++; assert(Object.hasOwn(dictionary, match[1]), `${file}: missing resource ${match[1]}`);
      }
    }
  }
  assert(references > 1000);
  assert.throws(() => resources.validate({ 'zh-CN': { x: '<img src=x>' }, 'en-US': { x: '<img src=x>' } }), /Invalid translation/);
});
