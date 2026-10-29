'use strict';

// Keep enumeration and focus on the same public AX window objects. CFHash is
// only a lookup key: collisions are rejected and focus is verified by CFEqual.
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
function standardWindows(pid) {
  const application = $.AXUIElementCreateApplication(pid);
  $.AXUIElementSetMessagingTimeout(application, .18);
  const windows = readAX(application, 'AXWindows');
  const result = [];
  if (windows) for (let i = 0; i < Number(windows.count); i++) {
    const window = windows.objectAtIndex(i);
    if (textAX(window, 'AXRole') !== 'AXWindow' || textAX(window, 'AXSubrole') !== 'AXStandardWindow') continue;
    result.push({ element: window, identity: String($.CFHash(window)), index: i });
  }
  return { application: application, windows: result };
}
`;

const WINDOWS_LIST_JXA = AX_HELPERS + String.raw`
// POME_WINDOW_SCAN
function run(argv) {
  if (!$.AXIsProcessTrusted()) return JSON.stringify({ rows: [], error: 'accessibility_permission_required' });
  const selfPid = Number(argv[0]), rows = [], seen = {}, collisions = {};
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (let i = 0; i < Number(apps.count); i++) {
    const app = apps.objectAtIndex(i), pid = Number(app.processIdentifier);
    if (!pid || pid === selfPid || Number(app.activationPolicy) !== 0) continue;
    const name = String(ObjC.unwrap(app.localizedName) || '');
    const appPath = app.bundleURL ? String(ObjC.unwrap(app.bundleURL.path) || '') : '';
    const bundleId = String(ObjC.unwrap(app.bundleIdentifier) || '');
    try {
      const entries = standardWindows(pid).windows;
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
          minimized: minimized ? Boolean(ObjC.unwrap(minimized)) : false });
      }
    } catch (error) { /* One unavailable application must not hide the others. */ }
  }
  return JSON.stringify({ rows: rows.filter(row => !collisions[row.pid + ':' + row.axWindowId]) });
}`;

const WINDOW_FOCUS_JXA = AX_HELPERS + String.raw`
// POME_WINDOW_FOCUS
function run(argv) {
  const pid = Number(argv[0]), identity = String(argv[1] || '');
  if (!pid || !/^\d+$/.test(identity) || !$.AXIsProcessTrusted()) return 'false';
  const state = standardWindows(pid);
  const matches = state.windows.filter(entry => entry.identity === identity);
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
