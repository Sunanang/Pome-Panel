'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../aiProviderCatalog');

test('catalog exposes stable ids and capability matrix', () => {
  assert.deepEqual(catalog.ids(), ['cursor', 'codex', 'claude', 'grokbot', 'grok', 'copilot', 'antigravity', 'manus']);
  assert.deepEqual(catalog.hookableIds(), ['cursor', 'codex', 'claude', 'grok', 'copilot', 'antigravity']);
  assert.deepEqual(catalog.completionIds(), ['cursor', 'codex', 'claude', 'grok', 'copilot', 'antigravity', 'manus']);
  assert.deepEqual(catalog.httpNotifyIds(), ['cursor', 'codex', 'claude', 'grok', 'copilot', 'antigravity']);
  assert.equal(catalog.get('grok').capabilities.completion, 'partial');
  assert.equal(catalog.get('grok').hookable, true);
  assert.equal(catalog.get('grok').surface, 'cli');
  assert.equal(catalog.get('copilot').surface, 'cli');
  assert.equal(catalog.get('cursor').surface, 'ide');
  assert.equal(catalog.get('antigravity').surface, 'desktop');
  assert.equal(catalog.get('manus').surface, 'api');
  assert.equal(catalog.get('manus').capabilities.completion, 'partial');
  assert.equal(catalog.get('manus').hookable, false);
  assert.equal(catalog.get('grok').ownershipKey, 'providers.ownership.grok');
  assert.equal(catalog.get('grokbot').ownershipKey, 'providers.ownership.grokbot');
  assert.match(catalog.get('grok').ownership, /xAI/);
  assert.match(catalog.get('grokbot').ownership, /Cursor/);
  assert.equal(catalog.get('manus').capabilities.usage, 'partial');
  assert.equal(catalog.usageProviders().length, 8);
});

test('every enabled completion source has branding and a portable NAS representation', () => {
  const fs=require('node:fs'),path=require('node:path');
  const domain=require('../renderer/notification-domain'),{normalizeSyncedCompletion}=require('../packages/sync-protocol');
  for(const source of catalog.completionIds()) {
    assert.equal(domain.normalize({source}).sourceKey,source);
    assert(fs.existsSync(path.join(__dirname,'../renderer',domain.iconPath(source))),source+' icon');
    assert(normalizeSyncedCompletion({id:'record',source,receivedAt:1,readAt:null}),source+' NAS validation');
  }
});
