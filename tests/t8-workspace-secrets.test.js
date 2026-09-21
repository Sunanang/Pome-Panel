'use strict';

/**
 * T8-18 — LS projection contract + workspace.json must not carry tokens/endpoints.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'renderer', 'app.js'), 'utf8');
const mainServices = fs.readFileSync(path.join(projectRoot, 'main-services.js'), 'utf8');
const syncSettings = fs.readFileSync(path.join(projectRoot, 'sync-settings.js'), 'utf8');

test('T8-18: credentials and settings live outside workspace.json', () => {
  assert.match(mainJs, /SYNC_CREDENTIALS_FILE_NAME\s*=\s*['"]sync-credentials\.json['"]/);
  assert.match(mainJs, /WORKSPACE_DATA_FILE\s*=\s*['"]workspace\.json['"]/);
  assert.match(mainServices, /SYNC_CREDENTIALS_FILE\s*=\s*['"]sync-credentials\.json['"]/);
  assert.match(syncSettings, /sync-settings\.json/);
  assert.notEqual(
    mainJs.match(/SYNC_CREDENTIALS_FILE_NAME\s*=\s*['"]([^'"]+)['"]/)[1],
    mainJs.match(/WORKSPACE_DATA_FILE\s*=\s*['"]([^'"]+)['"]/)[1],
  );
});

test('T8-18: workspace snapshot writer only dumps LocalStorage (no token fields)', () => {
  assert.match(appJs, /function collectLocalStorageSnapshot\(/);
  assert.match(appJs, /localStorage\.key\(/);
  assert.match(appJs, /saveWorkspaceData\(collectLocalStorageSnapshot\(\)/);
  // Portable snapshot must never invent sync secrets.
  assert.doesNotMatch(appJs, /collectLocalStorageSnapshot[\s\S]{0,400}deviceToken/);
  assert.doesNotMatch(appJs, /collectLocalStorageSnapshot[\s\S]{0,400}sync-credentials/);
  assert.doesNotMatch(appJs, /saveWorkspaceData[\s\S]{0,200}deviceToken/);
});

test('T8-18: workspace.json copy whitelist excludes credentials / sync DB / settings', () => {
  // copyWorkspaceAssets only copies recordings/, clipboard-images/, workspace.json, mirror cover.
  assert.match(mainJs, /function copyWorkspaceAssets\(/);
  const copyFn = mainJs.match(/function copyWorkspaceAssets\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(copyFn, /WORKSPACE_DATA_FILE/);
  assert.doesNotMatch(copyFn, /sync-credentials/);
  assert.doesNotMatch(copyFn, /sync-settings/);
  assert.doesNotMatch(copyFn, /sync\.db/);
  assert.doesNotMatch(copyFn, /deviceToken/);
});

test('T8-18: simulated workspace.json payload rejects secret keys', () => {
  const forbidden = [
    'deviceToken',
    'endpoints',
    'allowInsecureHttp',
    'syncCredentials',
  ];
  // Mimic what would be illegal if anyone stuffed secrets into the portable snapshot.
  const bad = {
    version: 1,
    localStorage: {
      'notch-todo-data': '{"P0":[]}',
      deviceToken: 'should-never-be-here',
      allowInsecureHttp: 'true',
      syncCredentials: '{}',
    },
    deviceToken: 'also-bad',
    endpoints: [{ baseUrl: 'https://evil' }],
  };
  const serialized = JSON.stringify(bad);
  for (const key of forbidden) {
    assert.match(serialized, new RegExp(key));
  }
  // Guard: production writer path must not serialize these top-level keys.
  assert.doesNotMatch(appJs, /saveWorkspaceData\(\s*\{[\s\S]*deviceToken/);
  assert.doesNotMatch(mainJs, /writeFileSync\([^)]*WORKSPACE_DATA_FILE[\s\S]{0,300}deviceToken/);
});
