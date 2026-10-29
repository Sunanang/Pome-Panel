'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function harness() {
  let time = 1000, escape;
  const collapsed = [];
  const context = { shortcutRecorderActive: true, shortcutRecorderEscapeAt: -Infinity,
    shortcutRecorder: { hidden: false }, performance: { now: () => time },
    isExpanded: true, todoEditorContext: null,
    window: { notchAPI: { onEscape: callback => { escape = callback; } } },
    document: { activeElement: null, querySelector: () => null }, setMode: value => collapsed.push(value),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function closeShortcutRecorder()'), source.indexOf('function keyEventToAccelerator(')), context);
  vm.runInContext(source.slice(source.indexOf("if (window.notchAPI && typeof window.notchAPI.onEscape === 'function')"), source.indexOf("if (window.notchAPI && typeof window.notchAPI.onToggleShortcut")), context);
  return { context, collapsed, escape: () => escape(), advance: ms => { time += ms; } };
}

test('DOM Escape before IPC closes shortcut capture without collapsing the panel', () => {
  const h = harness(); h.context.closeShortcutRecorderOnEscape(); h.advance(10); h.escape();
  assert.equal(h.context.shortcutRecorder.hidden, true); assert.deepEqual(h.collapsed, []);
});

test('IPC Escape before the DOM handler is also consumed once', () => {
  const h = harness(); h.escape(); h.advance(10); h.context.closeShortcutRecorderOnEscape();
  assert.equal(h.context.shortcutRecorder.hidden, true); assert.deepEqual(h.collapsed, []);
  h.advance(200); h.escape(); assert.deepEqual(h.collapsed, [false], 'a later Escape still collapses normally');
});

test('canceling shortcut capture does not swallow an unrelated later Escape', () => {
  const h = harness(); h.context.closeShortcutRecorder(); h.escape(); assert.deepEqual(h.collapsed, [false]);
});
