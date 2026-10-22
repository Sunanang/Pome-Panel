(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchUiDomain = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  function diagnostic(value) {
    return String(value || '').slice(0, 12000)
      .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|pairingCode)["']?\s*[:=]\s*)["']?[^\s,"'<>}]+["']?/gi, '$1[redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, '[redacted]')
      .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
        try { const u = new URL(raw); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.href; } catch { return '[address]'; }
      });
  }
  function errorKey(value) {
    const s = String(value || '');
    const localCodex = s.match(/\b(codex_auth_missing|codex_token_missing|codex_auth_read_failed)\b/)?.[1];
    const localCodexKeys = {
      codex_auth_missing: 'copy.noReadableCodexSignInFoundSign.d77b80',
      codex_token_missing: 'copy.noUsableTokenFoundInLocalCodex.fab797',
      codex_auth_read_failed: 'copy.couldnTReadCodexSignInRetry.5e8c59',
    };
    if (localCodex) return localCodexKeys[localCodex];
    const localCursor = s.match(/\b(cursor_db_missing|cursor_token_missing|cursor_db_read_failed)\b/)?.[1];
    const localCursorKeys = {
      cursor_db_missing: 'copy.noLocalCursorDataFoundInstallCursor.f5b341',
      cursor_token_missing: 'copy.cursorIsnTSignedInLocallySign.45a8a8',
      cursor_db_read_failed: 'copy.couldnTReadCursorSignInRetry.6bf381',
    };
    if (localCursor) return localCursorKeys[localCursor];
    if (/空间不够|not enough space|layout_invalid|layout_read_only/i.test(s)) return 'ui.error.layout';
    if (/ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|连接|连不上|network|offline/i.test(s)) return 'ui.error.connection';
    if (/401|403|token|credential|auth/i.test(s)) return 'ui.error.signIn';
    if (/hook|stop|notify|钩子|配置文件/i.test(s)) return 'ui.error.hook';
    if (/storage|保存|存储|ENOSPC|EACCES/i.test(s)) return 'ui.error.storage';
    return 'ui.error.generic';
  }
  function normalizeAddress(value) {
    const raw = String(value || '').trim();
    // Only add encryption by default. Never downgrade or send a credential probe.
    return raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? 'https://' + raw : raw;
  }
  return { diagnostic, errorKey, normalizeAddress };
});
