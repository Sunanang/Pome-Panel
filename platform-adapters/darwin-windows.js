'use strict';

// Enumeration and focus share AX identities. CG's all-window inventory is only
// a discovery hint: a row still needs to be an AXStandardWindow. In particular,
// never turn a CG backing surface or a position in that inventory into a target.
const AX_HELPERS = String.raw`
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
ObjC.import('Foundation');
function readAX(element, name) {
  const value = Ref();
  if ($.AXUIElementCopyAttributeValue(element, $(name), value) !== 0) return null;
  return ObjC.castRefToObject(value[0]);
}
function textAX(element, name) {
  const value = readAX(element, name);
  return value ? String(ObjC.unwrap(value) || '') : '';
}
function standardWindow(element) {
  return element && textAX(element, 'AXRole') === 'AXWindow' && textAX(element, 'AXSubrole') === 'AXStandardWindow';
}
function standardWindows(pid) {
  const application = $.AXUIElementCreateApplication(pid);
  $.AXUIElementSetMessagingTimeout(application, .18);
  const windows = readAX(application, 'AXWindows');
  const result = [];
  if (windows) for (let i = 0; i < Number(windows.count); i++) {
    const window = windows.objectAtIndex(i);
    if (!standardWindow(window)) continue;
    result.push({ element: window, identity: String($.CFHash(window)), index: i });
  }
  // AppKit may omit other-Space windows from AXWindows while still publishing
  // its focused/main window. Read these without activating the application.
  for (const attribute of ['AXFocusedWindow', 'AXMainWindow']) {
    const window = readAX(application, attribute);
    if (standardWindow(window) && !result.some(entry => $.CFEqual(entry.element, window)))
      result.push({ element: window, identity: String($.CFHash(window)), index: -1 });
  }
  return { application: application, windows: result };
}
// These compatibility symbols are not public API. Missing symbols disable only
// cross-Space discovery; the normal AX path remains available. No TCC changes.
let remoteAX = false;
try {
  ObjC.bindFunction('_AXUIElementCreateWithRemoteToken', ['id', ['id']]);
  ObjC.bindFunction('_AXUIElementGetWindow', ['int', ['id', 'unsigned int *']]);
  remoteAX = true;
} catch (_) {}
function remoteElement(pid, id) {
  if (!remoteAX || !Number.isSafeInteger(id) || id < 0) return null;
  const bytes = [], alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (const word of [pid, 0, 0x636f636f, id % 4294967296, Math.floor(id / 4294967296)])
    for (let byte = 0; byte < 4; byte++) bytes.push((word >>> (byte * 8)) & 255);
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset], b = bytes[offset + 1], c = bytes[offset + 2];
    const value = a * 65536 + (b || 0) * 256 + (c || 0);
    encoded += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63]
      + (b === undefined ? '=' : alphabet[(value >>> 6) & 63]) + (c === undefined ? '=' : alphabet[value & 63]);
  }
  try { return $._AXUIElementCreateWithRemoteToken($.NSData.alloc.initWithBase64EncodedStringOptions($(encoded), 0)); }
  catch (_) { return null; }
}
function nativeWindowNumber(element) {
  if (!remoteAX || !element) return 0;
  const value = Ref();
  try { return $._AXUIElementGetWindow(element, value) === 0 ? Number(value[0]) || 0 : 0; }
  catch (_) { return 0; }
}
function inventory() {
  const byPid = {};
  try {
    ObjC.import('CoreGraphics');
    const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID));
    for (let index = 0; index < Number(list.count); index++) {
      const row = ObjC.deepUnwrap(list.objectAtIndex(index)), bounds = row.kCGWindowBounds || {};
      // No on-screen, display-coordinate, title, or alpha filter: other displays,
      // Spaces, full-screen and minimized windows are valid discovery candidates.
      if (Number(row.kCGWindowLayer) !== 0 || !(bounds.Width > 0 && bounds.Height > 0)) continue;
      const pid = Number(row.kCGWindowOwnerPID), number = Number(row.kCGWindowNumber);
      if (pid > 0 && number > 0) (byPid[pid] || (byPid[pid] = [])).push(number);
    }
  } catch (_) {}
  return byPid;
}
function discoverWindows(pid, published, candidates, previous, deadline, force) {
  const roots = [], known = new Set(), windows = published.windows;
  function inspect(element, id, expected) {
    if (!element) return;
    const number = nativeWindowNumber(element);
    if (!number || !candidates.has(number) || known.has(number)) return;
    if (expected && (number !== expected.windowNumber || String($.CFHash(element)) !== expected.identity)) return;
    if (textAX(element, 'AXRole') !== 'AXWindow') return; // descendants can share the containing window's number
    known.add(number);
    const identity = String($.CFHash(element));
    roots.push({ remoteId: id, windowNumber: number, identity: identity });
    if (!standardWindow(element)) return;
    const existing = windows.find(entry => $.CFEqual(entry.element, element));
    if (existing) { existing.remoteId = id; existing.windowNumber = number; }
    else windows.push({ element: element, identity: identity, index: -1, remoteId: id, windowNumber: number });
  }
  for (const root of (Array.isArray(previous.roots) ? previous.roots : [])) {
    if (Date.now() >= deadline) {
      // Preserve unvisited hints for the next fair turn, but never emit an
      // unvalidated cached row into this scan's result.
      if (candidates.has(root.windowNumber)) roots.push(root);
      continue;
    }
    inspect(remoteElement(pid, root.remoteId), root.remoteId, root);
  }
  // A CFHash-derived location is only an optimization, never identity evidence.
  // Validate a round trip with CFEqual; changed OS hashing just falls back to the
  // bounded cursor below. This also anchors discovery near long-lived apps' IDs.
  const zero = remoteElement(pid, 0), one = remoteElement(pid, 1);
  const base = zero ? Number($.CFHash(zero)) : NaN, stride = one ? Number($.CFHash(one)) - base : NaN;
  const anchors = [];
  for (const entry of windows) {
    if (Date.now() >= deadline) break;
    entry.windowNumber = entry.windowNumber || nativeWindowNumber(entry.element);
    const hint = (Number(entry.identity) - base) / stride;
    if (!Number.isSafeInteger(hint) || hint < 0) continue;
    const element = remoteElement(pid, hint);
    if (!element || !$.CFEqual(element, entry.element)) continue;
    inspect(element, hint);
    anchors.push(Math.max(0, hint - 64));
  }
  // Resume rather than repeatedly inspecting only low element IDs. New Spaces
  // don't erase already resolved roots; every reused root is checked for liveness.
  let cursor = Number.isSafeInteger(previous.cursor) && previous.cursor >= 0 ? previous.cursor : 0;
  const originalCursor = cursor;
  let anchor = 0, near = anchors.length ? anchors[0] : 0;
  const inventoryKey = Array.from(candidates).sort((a, b) => a - b).join(',');
  const oldNumbers = new Set(String(previous.inventoryKey || '').split(','));
  const added = Array.from(candidates).some(number => !oldNumbers.has(String(number)));
  // New windows can receive IDs below an already advanced search cursor. Sweep
  // that prefix once while continuing the main cursor, so neither newly created
  // low IDs nor old sparse high IDs are permanently missed.
  let rescanCursor = added && cursor > 0 ? 0 : Number.isSafeInteger(previous.rescanCursor) ? previous.rescanCursor : -1;
  const rescanEnd = added && cursor > 0 ? cursor : Number.isSafeInteger(previous.rescanEnd) ? previous.rescanEnd : 0;
  const sweep = force || previous.inventoryKey !== inventoryKey || !(previous.nextSweepAt > Date.now());
  $.AXUIElementSetMessagingTimeout(published.application, .025);
  while (sweep && known.size < candidates.size && Date.now() < deadline && cursor < Number.MAX_SAFE_INTEGER) {
    inspect(remoteElement(pid, cursor), cursor);
    cursor++;
    if (rescanCursor >= 0 && rescanCursor < rescanEnd && Date.now() < deadline) {
      inspect(remoteElement(pid, rescanCursor), rescanCursor);
      rescanCursor++;
      if (rescanCursor >= rescanEnd) rescanCursor = -1;
    }
    if (anchor < anchors.length && Date.now() < deadline) {
      inspect(remoteElement(pid, near), near);
      near++;
      if (near >= anchors[anchor] + 128) { anchor++; near = anchors[anchor] || 0; }
    }
  }
  return { roots: roots, cursor: cursor, rescanCursor: rescanCursor, rescanEnd: rescanEnd, inventoryKey: inventoryKey,
    nextSweepAt: sweep && (cursor > originalCursor || known.size >= candidates.size) ? Date.now() + 15000 : previous.nextSweepAt || 0 };
}
`;

const WINDOWS_LIST_JXA = AX_HELPERS + String.raw`
// POME_WINDOW_SCAN
function run(argv) {
  if (!$.AXIsProcessTrusted()) return JSON.stringify({ rows: [], error: 'accessibility_permission_required' });
  const selfPid = Number(argv[0]), rows = [], seen = {}, collisions = {}, discovery = {};
  let previous = {};
  try { previous = JSON.parse(argv[1] || '{}'); } catch (_) {}
  const extended = remoteAX && argv[2] !== 'public-only';
  const candidates = extended ? inventory() : {}, scanDeadline = Date.now() + 2200;
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  const count = Number(apps.count), offset = Number.isInteger(previous._offset) ? Math.abs(previous._offset) % Math.max(1, count) : 0;
  discovery._offset = (offset + 1) % Math.max(1, count);
  for (let turn = 0; turn < count; turn++) {
    const i = (offset + turn) % count;
    const app = apps.objectAtIndex(i), pid = Number(app.processIdentifier);
    if (!pid || pid === selfPid || Number(app.activationPolicy) !== 0) continue;
    const name = String(ObjC.unwrap(app.localizedName) || '');
    const appPath = app.bundleURL ? String(ObjC.unwrap(app.bundleURL.path) || '') : '';
    const bundleId = String(ObjC.unwrap(app.bundleIdentifier) || '');
    try {
      const published = standardWindows(pid);
      const launch = (app.launchDate ? Number(app.launchDate.timeIntervalSince1970) : 0) || 0;
      const prior = previous[pid] && previous[pid].launch === launch ? previous[pid] : {};
      if (extended) {
        try {
          const state = discoverWindows(pid, published, new Set(candidates[pid] || []), prior, Math.min(scanDeadline, Date.now() + 140), argv[3] === 'force');
          discovery[pid] = { launch: launch, roots: state.roots, cursor: state.cursor,
            rescanCursor: state.rescanCursor, rescanEnd: state.rescanEnd,
            inventoryKey: state.inventoryKey, nextSweepAt: state.nextSweepAt };
        } catch (_) { /* Keep the published AX windows if compatibility discovery fails. */ }
      }
      const entries = published.windows;
      for (const entry of entries) {
        const key = pid + ':' + entry.identity;
        if (seen[key]) {
          if (!$.CFEqual(seen[key], entry.element)) collisions[key] = true;
          continue;
        }
        seen[key] = entry.element;
        const title = textAX(entry.element, 'AXTitle').replace(/\s+/g, ' ').trim() || name;
        const minimized = readAX(entry.element, 'AXMinimized');
        rows.push({ pid: pid, appName: name, appPath: appPath, bundleId: bundleId,
          title: title, windowIndex: entry.index, axWindowId: entry.identity,
          minimized: minimized ? Boolean(ObjC.unwrap(minimized)) : false,
          windowNumber: entry.windowNumber || 0, axRemoteId: Number.isSafeInteger(entry.remoteId) ? String(entry.remoteId) : '' });
      }
    } catch (error) { /* One unavailable application must not hide the others. */ }
  }
  return JSON.stringify({ rows: rows.filter(row => !collisions[row.pid + ':' + row.axWindowId]), discovery: discovery });
}`;

const WINDOW_FOCUS_JXA = AX_HELPERS + String.raw`
// POME_WINDOW_FOCUS
function run(argv) {
  const pid = Number(argv[0]), identity = String(argv[1] || '');
  if (!pid || !/^\d+$/.test(identity) || !$.AXIsProcessTrusted()) return 'false';
  const state = standardWindows(pid);
  const remoteId = String(argv[2] || ''), expectedNumber = Number(argv[3]);
  if (/^\d{1,16}$/.test(remoteId) && expectedNumber > 0) {
    const element = remoteElement(pid, Number(remoteId));
    if (element && String($.CFHash(element)) === identity && nativeWindowNumber(element) === expectedNumber
      && standardWindow(element) && !state.windows.some(entry => $.CFEqual(entry.element, element)))
      state.windows.push({ element: element, identity: identity });
  }
  const matches = state.windows.filter(entry => entry.identity === identity
    && (!(expectedNumber > 0) || nativeWindowNumber(entry.element) === expectedNumber));
  // Closed, stale or ambiguous entries never fall back to the front window,
  // a title match, a menu item, or an index from a different enumeration.
  if (matches.length !== 1) return 'false';
  const target = matches[0].element;
  const minimized = readAX(target, 'AXMinimized');
  if (minimized && Boolean(ObjC.unwrap(minimized))) {
    if ($.AXUIElementSetAttributeValue(target, $('AXMinimized'), $.kCFBooleanFalse) !== 0) return 'false';
  }
  if ($.AXUIElementPerformAction(target, $('AXRaise')) !== 0) return 'false';
  const running = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (!running || running.isNil()) return 'false';
  running.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
  for (let attempt = 0; attempt < 6; attempt++) {
    $.AXUIElementSetAttributeValue(target, $('AXMain'), $.kCFBooleanTrue);
    $.AXUIElementSetAttributeValue(state.application, $('AXFocusedWindow'), target);
    $.AXUIElementPerformAction(target, $('AXRaise'));
    delay(.035);
    const focused = readAX(state.application, 'AXFocusedWindow');
    if (focused && $.CFEqual(focused, target)
      && Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier) === pid) return 'true';
  }
  return 'false';
}`;

module.exports = { WINDOWS_LIST_JXA, WINDOW_FOCUS_JXA };
