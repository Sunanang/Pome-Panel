'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/ui-simplify.js'), 'utf8');
const script = source.slice(source.indexOf('  let welcomeSettingsRevision = 0;'), source.indexOf("  const hint = document.createElement('aside')"));

test('a delayed initial settings read cannot reopen completed onboarding or restore an old shortcut', async () => {
  let complete, changed, shown = 0;
  const context = { settings: {}, firstWelcome: false,
    api: { onAppSettingsChanged: handler => { changed = handler; }, getAppSettings: () => new Promise(resolve => { complete = resolve; }) },
    renderWelcome: () => { shown++; }, welcome: { showModal: () => { shown++; } },
    document: { getElementById: () => ({ classList: { contains: () => true } }) } };
  vm.createContext(context); vm.runInContext(script, context);
  changed({ onboardingPending: false, shortcut: 'Alt+Space' });
  complete({ onboardingPending: true, shortcut: 'Space' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.firstWelcome, false); assert.equal(context.settings.shortcut, 'Alt+Space'); assert.equal(shown, 0);
});

test('a first-run settings read still shows onboarding without a newer broadcast', async () => {
  let shown = 0;
  const context = { settings: {}, firstWelcome: false,
    api: { onAppSettingsChanged() {}, getAppSettings: async () => ({ onboardingPending: true }) },
    renderWelcome() {}, welcome: { showModal: () => { shown++; } },
    document: { getElementById: () => ({ classList: { contains: () => true } }) } };
  vm.createContext(context); vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.firstWelcome, true); assert.equal(shown, 1);
});
