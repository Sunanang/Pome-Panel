(function (root, factory) {
  const registry = factory();
  if (typeof module === 'object' && module.exports) module.exports = registry;
  else root.NotchAiProviders = registry;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  // Register only implemented providers. A brand name is not an integration.
  const providers = Object.freeze([
    Object.freeze({ id: 'cursor', label: 'Cursor', request: 'getCursorUsage', settingsCard: 'settings-cursor-token-card',
      pools: Object.freeze([['auto', 'auto', 'Auto'], ['other', 'other', 'Other'], ['grok', 'grokBot', 'Grok Bot']]) }),
    Object.freeze({ id: 'codex', label: 'Codex', request: 'getCodexUsage', settingsCard: 'settings-codex-token-card' }),
  ]);
  return { providers, get: id => providers.find(provider => provider.id === id) };
});
