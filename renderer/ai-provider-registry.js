(function (root, factory) {
  const registry = factory(typeof module === 'object' && module.exports
    ? require('../aiProviderCatalog')
    : root.NotchAiProviders);
  if (typeof module === 'object' && module.exports) module.exports = registry;
  else root.NotchAiProviders = registry;
})(typeof window === 'object' ? window : globalThis, function (catalog) {
  'use strict';
  // Thin re-export of the shared catalog for renderer script order and tests.
  return catalog;
});
