'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../aiProviderCatalog');

test('catalog exposes stable ids and capability matrix', () => {
  assert.deepEqual(catalog.ids(), ['cursor', 'codex', 'claude', 'grokbot', 'grok', 'copilot', 'antigravity', 'manus']);
  assert.deepEqual(catalog.hookableIds(), ['cursor', 'codex', 'claude']);
  assert.deepEqual(catalog.completionIds(), ['cursor', 'codex', 'claude']);
  assert.equal(catalog.get('grok').ownershipKey, 'providers.ownership.grok');
  assert.equal(catalog.get('grokbot').ownershipKey, 'providers.ownership.grokbot');
  assert.match(catalog.get('grok').ownership, /xAI/);
  assert.match(catalog.get('grokbot').ownership, /Cursor/);
  assert.equal(catalog.get('manus').capabilities.completion, 'unsupported');
  assert.equal(catalog.get('manus').capabilities.usage, 'partial');
  assert.equal(catalog.usageProviders().length, 8);
});
