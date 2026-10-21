(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.NotchAiProviders = catalog;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const CAP = Object.freeze({ VERIFIED: 'verified', PARTIAL: 'partial', UNSUPPORTED: 'unsupported' });

  function provider(row) {
    return Object.freeze({
      id: row.id,
      label: row.label,
      ownership: row.ownership || '',
      ownershipKey: row.ownershipKey || '',
      icon: row.icon || `assets/inbox/${row.id}.svg`,
      hookable: row.hookable === true,
      surface: row.surface || 'desktop',
      connection: row.connection || (row.hookable ? 'hook' : 'catalog'),
      request: row.request || null,
      settingsCard: row.settingsCard || null,
      completionNoteKey: row.completionNoteKey || null,
      pools: row.pools ? Object.freeze(row.pools.map((pool) => Object.freeze(pool))) : null,
      capabilities: Object.freeze({
        usage: row.capabilities?.usage || CAP.UNSUPPORTED,
        completion: row.capabilities?.completion || CAP.UNSUPPORTED,
        attention: row.capabilities?.attention || CAP.UNSUPPORTED,
      }),
    });
  }

  const providers = Object.freeze([
    provider({
      id: 'cursor',
      label: 'Cursor',
      ownership: 'Cursor / Anysphere plan quota',
      ownershipKey: 'providers.ownership.cursor',
      icon: 'assets/inbox/cursor.svg',
      hookable: true,
      surface: 'ide',
      request: 'getCursorUsage',
      settingsCard: 'settings-cursor-token-card',
      pools: Object.freeze([
        Object.freeze(['auto', 'auto', 'Auto']),
        Object.freeze(['other', 'other', 'Other']),
      ]),
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.UNSUPPORTED },
    }),
    provider({
      id: 'codex',
      label: 'Codex',
      ownership: 'OpenAI Codex / ChatGPT plan quota',
      ownershipKey: 'providers.ownership.codex',
      icon: 'assets/inbox/codex.svg',
      hookable: true,
      request: 'getCodexUsage',
      settingsCard: 'settings-codex-token-card',
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.UNSUPPORTED },
    }),
    provider({
      id: 'claude',
      label: 'Claude Code',
      ownership: 'Anthropic Claude Code plan quota',
      ownershipKey: 'providers.ownership.claude',
      icon: 'assets/inbox/claude.svg',
      hookable: true,
      surface: 'cli',
      request: 'getClaudeUsage',
      settingsCard: 'settings-claude-token-card',
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.PARTIAL },
    }),
    provider({
      id: 'grokbot',
      label: 'Grok Bot',
      ownership: 'Cursor/Anysphere sand pool (requires Cursor sign-in)',
      ownershipKey: 'providers.ownership.grokbot',
      icon: 'assets/inbox/grokbot.svg',
      hookable: false,
      request: 'getGrokbotUsage',
      settingsCard: 'settings-grokbot-token-card',
      pools: Object.freeze([Object.freeze(['primary', 'primary', 'Grok Bot'])]),
      capabilities: { usage: CAP.PARTIAL, completion: CAP.UNSUPPORTED, attention: CAP.UNSUPPORTED },
    }),
    provider({
      id: 'grok',
      label: 'Grok',
      ownership: 'xAI developer prepaid ledger (Management API key and team ID)',
      ownershipKey: 'providers.ownership.grok',
      icon: 'assets/inbox/grok.svg',
      hookable: true,
      surface: 'cli',
      request: 'getGrokUsage',
      settingsCard: 'settings-grok-token-card',
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.UNSUPPORTED },
    }),
    provider({
      id: 'copilot',
      label: 'Copilot',
      ownership: 'GitHub Copilot plan quota',
      ownershipKey: 'providers.ownership.copilot',
      icon: 'assets/inbox/copilot.svg',
      hookable: true,
      surface: 'cli',
      completionNoteKey: 'providers.completionScope.copilot',
      request: 'getCopilotUsage',
      settingsCard: 'settings-copilot-token-card',
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.UNSUPPORTED },
    }),
    provider({
      id: 'antigravity',
      label: 'Antigravity',
      ownership: 'Google Antigravity / Cloud Code quota',
      ownershipKey: 'providers.ownership.antigravity',
      icon: 'assets/inbox/antigravity.svg',
      hookable: true,
      completionNoteKey: 'providers.completionScope.antigravity',
      request: 'getAntigravityUsage',
      settingsCard: 'settings-antigravity-token-card',
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.UNSUPPORTED },
    }),
    provider({
      id: 'manus',
      label: 'Manus',
      ownership: 'Manus spendable credit balance (official API key)',
      ownershipKey: 'providers.ownership.manus',
      icon: 'assets/inbox/manus.svg',
      hookable: false,
      surface: 'api',
      connection: 'api',
      completionNoteKey: 'providers.completionScope.manus',
      request: 'getManusUsage',
      settingsCard: 'settings-manus-token-card',
      capabilities: { usage: CAP.PARTIAL, completion: CAP.PARTIAL, attention: CAP.UNSUPPORTED },
    }),
  ]);

  const byId = Object.freeze(Object.fromEntries(providers.map((row) => [row.id, row])));

  function get(id) {
    return byId[id] || null;
  }

  function ids() {
    return providers.map((row) => row.id);
  }

  function hookableIds() {
    return providers.filter((row) => row.hookable).map((row) => row.id);
  }

  function completionIds() {
    return providers.filter((row) => row.capabilities.completion !== CAP.UNSUPPORTED).map((row) => row.id);
  }

  // Local HTTP /notify whitelist. API-polled sources (Manus) are history-capable
  // but must not open an external loopback notify endpoint.
  function httpNotifyIds() {
    return providers
      .filter((row) => row.hookable && row.capabilities.completion !== CAP.UNSUPPORTED)
      .map((row) => row.id);
  }

  function usageProviders() {
    return providers.filter((row) => row.capabilities.usage !== CAP.UNSUPPORTED && row.request);
  }

  function labels() {
    return Object.freeze(Object.fromEntries(providers.map((row) => [row.id, row.label])));
  }

  return {
    CAP,
    providers,
    get,
    ids,
    hookableIds,
    completionIds,
    httpNotifyIds,
    usageProviders,
    labels,
  };
});
