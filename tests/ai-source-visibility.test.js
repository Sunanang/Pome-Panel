'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ai-source-visibility talks to localStorage only; give it a clean stub so the
// module can be exercised outside the renderer.
function freshModule() {
  delete require.cache[require.resolve('../renderer/ai-source-visibility')];
  return require('../renderer/ai-source-visibility');
}
function withStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  globalThis.localStorage = {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
  };
  return data;
}

test('hiding a source is device-local and survives a reload of the module', t => {
  const data = withStorage();
  t.after(() => { delete globalThis.localStorage; });
  const visibility = freshModule();
  assert.deepEqual(visibility.list(), []);
  visibility.hide('grokbot');
  visibility.hide('copilot');
  assert.deepEqual(visibility.list().sort(), ['copilot', 'grokbot']);
  assert.equal(visibility.has('grokbot'), true);
  assert.equal(JSON.parse(data.get(visibility.key)).length, 2);
  // A fresh module reads the same preference back from storage.
  assert.deepEqual(freshModule().list().sort(), ['copilot', 'grokbot']);
});

test('showing a source removes only that entry, and duplicate hides collapse', t => {
  t.after(() => { delete globalThis.localStorage; });
  withStorage();
  const visibility = freshModule();
  visibility.hide('grok'); visibility.hide('grok'); visibility.hide('manus');
  assert.deepEqual(visibility.list().sort(), ['grok', 'manus']);
  visibility.show('grok');
  assert.deepEqual(visibility.list(), ['manus']);
  visibility.clear();
  assert.deepEqual(visibility.list(), []);
});

test('corrupt or foreign stored values degrade to "nothing hidden" instead of throwing', t => {
  t.after(() => { delete globalThis.localStorage; });
  withStorage({ 'notch-ai-source-hidden-v1': '{not json' });
  assert.deepEqual(freshModule().list(), []);
  withStorage({ 'notch-ai-source-hidden-v1': JSON.stringify(['codex', 7, null, 'codex']) });
  assert.deepEqual(freshModule().list(), ['codex']);
});

test('the quota widget drops hidden sources but keeps the rest', t => {
  t.after(() => { delete globalThis.NotchAiSourceVisibility; });
  globalThis.NotchAiSourceVisibility = { list: () => ['grokbot'] };
  delete require.cache[require.resolve('../renderer/ai-usage-domain')];
  const D = require('../renderer/ai-usage-domain');
  const snapshots = {
    cursor: { detected: true, auto: { percent: 30 } },
    grokbot: { detected: true, ok: true, primary: { percent: 90 } },
  };
  assert.deepEqual(D.providers(snapshots), ['cursor']);
  globalThis.NotchAiSourceVisibility = { list: () => [] };
  delete require.cache[require.resolve('../renderer/ai-usage-domain')];
  assert.deepEqual(require('../renderer/ai-usage-domain').providers(snapshots).sort(), ['cursor', 'grokbot']);
});

test('the quota widget stops polling hidden sources and ships the entry points', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const usage = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai-usage.js'), 'utf8');
  assert.match(usage, /const activeProviders = \(\) => \{/, 'hidden sources are filtered before polling');
  assert.match(usage, /await Promise\.all\(activeProviders\(\)\.map/, 'refresh skips hidden sources');
  assert.match(usage, /const needs = activeProviders\(\)\.some/, 'tick skips hidden sources');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('scripts/ai-attention-notify.js'), 'the reminder script ships with the app');
  const macFiles = pkg.build.mac.files;
  if (Array.isArray(macFiles)) assert.ok(macFiles.includes('scripts/ai-attention-notify.js'), 'macOS packaging keeps the reminder script');
});

test('the settings list ships the hidden summary and loads the visibility module first', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(html, /<p class="ai-source-hidden-summary" id="ai-sources-hidden" hidden>/);
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.ok(order.indexOf('ai-source-visibility.js') >= 0, 'visibility module is loaded');
  assert.ok(order.indexOf('ai-source-visibility.js') < order.indexOf('ai-usage.js'), 'usage widget can read the preference');
});
