'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const sources = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'ai-sources.js'), 'utf8');

test('sensitive IPC mutations require the main-window workspace owner', () => {
  for (const channel of [
    'credentials:list', 'credentials:get', 'credentials:save', 'credentials:delete-many', 'credentials:copy',
    'workspace:save-data', 'workspace:load-data', 'workspace:open', 'workspace:choose',
    'settings:set-feature', 'settings:set-task-notifications', 'settings:set-shortcut',
    'sync:pair-claim', 'sync:add-endpoint', 'sync:clear-binding', 'sync:todos-local-write',
    'tasks:recent',
  ]) {
    const block = main.match(new RegExp(`ipcMain\\.handle\\('${channel}'[\\s\\S]{0,240}`));
    assert.ok(block, `missing handler ${channel}`);
    assert.match(block[0], /requireWorkspaceOwner\(event\)/, `${channel} must check the main window owner`);
  }
});

test('task notification bounds follow the panel display, not the cursor', () => {
  const bounds = main.match(/function getTaskNotificationBounds\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(bounds, /getWindowDisplay\(\)/);
  assert.doesNotMatch(bounds, /getTargetDisplay\(\)/);
});

test('workspace asset copy prunes metadata that points at missing media', () => {
  assert.match(main, /function pruneMissingWorkspaceMedia\(/);
  assert.match(main, /pruneMissingWorkspaceMedia\(targetRoot\)/);
});

test('hiding Manus stops its completion listener', () => {
  assert.match(sources, /source === 'manus'[\s\S]{0,120}setManusCompletionEnabled\?\.\(false\)/);
});

test('unverified attention rows can be reopened after restart', () => {
  const show = main.match(/ipcMain\.handle\('ai-attention:show'[\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(show, /if \(!row\) return/);
  assert.doesNotMatch(show, /row\?\.state !== 'pending'/);
});
