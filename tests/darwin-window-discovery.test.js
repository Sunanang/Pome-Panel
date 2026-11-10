'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { WINDOWS_LIST_JXA, WINDOW_FOCUS_JXA } = require('../platform-adapters/darwin-windows');

// Execute the shipped JXA algorithm with controlled AX and CG responses. The CG
// inventory contains other-display/Space/fullscreen windows and backing surfaces;
// only AX standard roots may become rows or exact focus targets.
function fixture({ privateApi = true, farId = 18, hashId = id => 4000 + id * 16 } = {}) {
  let now = 10000, current = 2, frontmost = 70;
  const calls = { inventory: [], focused: [], remote: [] };
  const window = (id, number, title, extra = {}) => ({ pid: 70, id, number, title, role: 'AXWindow', subrole: 'AXStandardWindow', alive: true, ...extra });
  const a = window(2, 102, 'screen one');
  const b = window(17, 117, 'screen two', { x: -1920, y: -1080 });
  const c = window(farId, 118, 'other Space fullscreen');
  const backing = window(19, 119, 'backing', { subrole: 'AXUnknown' });
  const elements = new Map([a, b, c, backing].map(row => [row.id, row]));
  const published = [a], app = { pid: 70, application: true };
  const array = items => ({ count: items.length, objectAtIndex: index => items[index] });
  const nativeApp = { processIdentifier: 70, activationPolicy: 0, localizedName: 'Browser',
    bundleURL: { path: '/Applications/Browser.app' }, bundleIdentifier: 'test.browser',
    launchDate: { timeIntervalSince1970: 42 }, activateWithOptions: () => { frontmost = 70; } };
  const $ = value => value;
  Object.assign($, {
    NSWorkspace: { sharedWorkspace: { runningApplications: array([nativeApp]), get frontmostApplication() { return { processIdentifier: frontmost }; } } },
    NSRunningApplication: { runningApplicationWithProcessIdentifier: () => ({ activateWithOptions: () => { frontmost = 70; }, isNil: () => false }) },
    NSApplicationActivateIgnoringOtherApps: 1,
    NSData: { alloc: { initWithBase64EncodedStringOptions: encoded => Buffer.from(encoded, 'base64') } },
    kCGWindowListOptionAll: 0, kCGNullWindowID: 0, kCFBooleanTrue: true, kCFBooleanFalse: false,
    AXIsProcessTrusted: () => true,
    AXUIElementCreateApplication: () => app,
    AXUIElementSetMessagingTimeout: () => 0,
    CFHash: element => hashId(element.id),
    CFEqual: (left, right) => left.pid === right.pid && left.id === right.id,
    AXUIElementCopyAttributeValue(element, attribute, out) {
      if (element.application) {
        if (attribute === 'AXWindows') { out[0] = array(published); return 0; }
        if (attribute === 'AXFocusedWindow' || attribute === 'AXMainWindow') { out[0] = elements.get(current); return 0; }
        return -25205;
      }
      if (!element.alive) return -25202;
      const values = { AXRole: element.role, AXSubrole: element.subrole, AXTitle: element.title, AXMinimized: !!element.minimized };
      if (!(attribute in values)) return -25205;
      out[0] = values[attribute]; return 0;
    },
    _AXUIElementCreateWithRemoteToken(data) {
      now += 0.2;
      assert.equal(data.readUInt32LE(0), 70); assert.equal(data.readUInt32LE(8), 0x636f636f);
      const id = Number(data.readBigUInt64LE(12)); calls.remote.push(id);
      return elements.get(id) || { pid: 70, id, alive: false };
    },
    _AXUIElementGetWindow(element, out) { if (!element.alive) return -25202; out[0] = element.number; return 0; },
    CGWindowListCopyWindowInfo(option, relative) {
      calls.inventory.push([option, relative]);
      return array([...elements.values()].filter(row => row.alive).map(row => ({
        kCGWindowOwnerPID: 70, kCGWindowNumber: row.number, kCGWindowLayer: 0,
        kCGWindowIsOnscreen: row === a || row === b,
        kCGWindowBounds: { X: row.x || 0, Y: row.y || 0, Width: 600, Height: 400 },
      })));
    },
    AXUIElementSetAttributeValue(element, attribute, value) {
      if (attribute === 'AXFocusedWindow') current = value.id;
      if (attribute === 'AXMinimized') element.minimized = value;
      return 0;
    },
    AXUIElementPerformAction(element) { calls.focused.push(element.id); return element.alive ? 0 : -25202; },
  });
  const context = { $, Set, Number, Array, String, JSON, Date: { now: () => now }, Ref: () => [], delay: () => {},
    ObjC: { import: () => {}, unwrap: value => value, deepUnwrap: value => value, castRefToObject: value => value,
      bindFunction: () => { if (!privateApi) throw Error('symbol unavailable'); } } };
  function execute(source, args) { const scope = vm.createContext({ ...context, args }); return JSON.parse(vm.runInContext(source + '\nJSON.stringify(run(args))', scope)); }
  return { a, b, c, elements, published, calls,
    scan: (state = {}, force = false) => JSON.parse(execute(WINDOWS_LIST_JXA, [999, JSON.stringify(state), 'extended', force ? 'force' : 'scheduled'])),
    focus: row => execute(WINDOW_FOCUS_JXA, [70, row.axWindowId, row.axRemoteId, row.windowNumber]),
    advance: ms => { now += ms; }, setCurrent: id => { current = id; }, setFrontmost: pid => { frontmost = pid; } };
}

test('cold discovery includes other displays, offscreen Spaces and fullscreen without graph-only ghosts', () => {
  const h = fixture(), result = h.scan();
  assert.deepEqual(result.rows.map(row => row.title).sort(), ['screen one', 'screen two', 'other Space fullscreen'].sort());
  assert.equal(result.rows.some(row => row.title === 'backing'), false);
  assert.equal(result.rows.every(row => row.axRemoteId), true);
  assert.deepEqual(h.calls.inventory, [[0, 0]], 'all windows, without an on-screen filter');
});

test('changed OS hashing falls back to discovery instead of trusting a hash-derived element', () => {
 const h=fixture({hashId:id=>4000+id*id*16}),rows=h.scan().rows;
 assert.deepEqual(rows.map(row=>row.axRemoteId).sort(),['2','17','18'].sort());
 assert.equal(h.focus(rows.find(row=>row.title==='other Space fullscreen')),'true');
});

test('leaving a Space keeps live resolved roots and removes genuinely closed windows', () => {
  const h = fixture(), first = h.scan();
  h.published.splice(0); h.setCurrent(17);
  const second = h.scan(first.discovery);
  assert.deepEqual(second.rows.map(row => row.axWindowId).sort(), first.rows.map(row => row.axWindowId).sort());
  h.c.alive = false;
  const third = h.scan(second.discovery);
  assert.equal(third.rows.length, 2); assert.equal(third.rows.some(row => row.windowNumber === 118), false);
});

test('off-Space focus resolves the cached element and verifies both AX and native window identities', () => {
  const h = fixture(), row = h.scan().rows.find(row => row.title === 'other Space fullscreen');
  h.setFrontmost(999); assert.equal(h.focus(row), 'true'); assert.equal(h.calls.focused.every(id => id === h.c.id), true);
  h.calls.focused.length = 0;
  assert.equal(h.focus({ ...row, windowNumber: 102 }), 'false'); assert.deepEqual(h.calls.focused, []);
  h.c.alive = false; assert.equal(h.focus(row), 'false'); assert.deepEqual(h.calls.focused, []);
});

test('unavailable compatibility symbols preserve focused/main windows and ordinary AX focus', () => {
  const h = fixture({ privateApi: false }); h.setCurrent(17);
  const rows = h.scan().rows; assert.deepEqual(rows.map(row => row.title).sort(), ['screen one', 'screen two']);
  assert.deepEqual(h.calls.inventory, []); assert.deepEqual(h.calls.remote, []);
  assert.equal(h.focus(rows.find(row => row.title === 'screen two')), 'true');
});

test('bounded discovery resumes high element IDs and unchanged inventories avoid busy rescanning', () => {
  const h = fixture({ farId: 5000 }); let result = h.scan();
  const firstCursor = result.discovery[70].cursor; assert(firstCursor > 0 && firstCursor < 5000);
  const before = h.calls.remote.length; result = h.scan(result.discovery);
  assert(h.calls.remote.length - before < 30, 'cached roots are validated without another brute-force sweep');
  const cursor = result.discovery[70].cursor;
  result = h.scan(result.discovery, true);
  assert(result.discovery[70].cursor > cursor, 'manual refresh immediately resumes bounded discovery');
  for (let attempt = 0; attempt < 12 && !result.rows.some(row => row.windowNumber === 118); attempt++) {
    h.advance(16000); result = h.scan(result.discovery);
  }
  assert(result.rows.some(row => row.windowNumber === 118), 'the cursor must eventually reach a sparse high-ID window');
});

test('new off-Space windows below a progressed cursor are discovered without losing the high-ID frontier', () => {
 const h=fixture({farId:100}),first=h.scan();assert(first.discovery[70].cursor>100);
 const oldCursor=first.discovery[70].cursor;
 h.elements.set(80,{pid:70,id:80,number:180,title:'new background window',role:'AXWindow',subrole:'AXStandardWindow',alive:true});
 const next=h.scan(first.discovery);
 assert(next.rows.some(row=>row.title==='new background window'));
 assert(next.discovery[70].cursor>=oldCursor,'the main cursor still makes forward progress');
});
