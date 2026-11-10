'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const section = source.slice(source.indexOf('  const visibilityOwner = mainWindow;'), source.indexOf("  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))"));

function harness() {
  let visible = false, destroyed = false, poll, unref = false, cleared = false;
  const sent = [], events = new Map(), pageEvents = new Map();
  const timer = { unref: () => { unref = true; } };
  const context = {
    mainWindow: {
      isVisible: () => visible, isDestroyed: () => destroyed,
      on: (name, callback) => events.set(name, callback), once: (name, callback) => events.set(name, callback),
      webContents: { isDestroyed: () => destroyed, send: (...args) => sent.push(args),
        on: (name, callback) => pageEvents.set(name, callback) },
    },
    setInterval: callback => { poll = callback; return timer; },
    clearInterval: value => { assert.equal(value, timer); cleared = true; },
  };
  vm.createContext(context); vm.runInContext(section, context);
  return { sent, events, pageEvents, poll: () => poll(), visible: value => { visible = value; },
    destroy: () => { destroyed = true; }, unref: () => unref, cleared: () => cleared };
}

test('native visibility fallback detects changes without show/hide events and deduplicates IPC', () => {
  const h = harness(); h.pageEvents.get('did-finish-load')(); h.poll();
  h.visible(true); h.poll(); h.events.get('show')(); h.poll();
  h.visible(false); h.poll(); h.events.get('hide')();
  assert.deepEqual(h.sent, [['window:visibility-changed', false], ['window:visibility-changed', true], ['window:visibility-changed', false]]);
});

test('a reloaded renderer receives the current state even when visibility has not changed', () => {
  const h = harness(); h.visible(true); h.pageEvents.get('did-finish-load')();
  h.pageEvents.get('did-finish-load')();
  assert.deepEqual(h.sent, [['window:visibility-changed', true], ['window:visibility-changed', true]]);
});

test('visibility monitoring does not retain the process or access a destroyed window', () => {
  const h = harness(); assert.equal(h.unref(), true);
  h.destroy(); h.poll(); assert.deepEqual(h.sent, []);
  h.events.get('closed')(); assert.equal(h.cleared(), true);
});
