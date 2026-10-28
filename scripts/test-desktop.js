const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function run(executable, args) {
  console.log(`Checking ${args.join(' ')}`);
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error(result.error);
  if (result.status !== 0) {
    if (env.TODO_TEST_LOG && fs.existsSync(env.TODO_TEST_LOG)) console.error(fs.readFileSync(env.TODO_TEST_LOG, 'utf8'));
    process.exit(result.status || 1);
  }
}
run(process.execPath, ['scripts/localization-resources.js', '--check']);
run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.js')).map((name) => `tests/${name}`)]);
env.TODO_TEST_LOG = path.join(root, 'dist.noindex', 'windows-smoke', 'renderer-test.log');
fs.mkdirSync(path.dirname(env.TODO_TEST_LOG), { recursive: true });
fs.writeFileSync(env.TODO_TEST_LOG, '');
env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require=${JSON.stringify(path.join(root, 'tests/provider-usage-fixtures.cjs'))}`.trim();
for (const file of ['notch-focus', 'retained-workspace', 'workspace-lifecycle', 'metadata-races', 'migration-integrity', 'clipboard-generation', 'content-delete', 'workbench', 'startup', 'cursor-credentials', 'user-data-directory', 'todo-board-fixes', 'ai-usage', 'ai-usage-final', 'quota-refresh', 'codex-usage-accuracy', 'provider-credentials', 'home-layout-swap', 'home-card-hover', 'sun-home', 'sun-weather', 'almanac-home', 'security-recovery', 'history-retention', 'ai-completion-sync', 'additional-completion', 'manus-completion', 'notification', 'todo-reminders', 'ai-attention', 'work-hub', 'work-hub-nas', 'inbox-bento', 'inbox-pagination', 'inbox-corrupt-startup', 'ai-sources', 'settings-slim', 'ui-simplify', 'nas-settings-card', 'localization', 'normal-startup']) {
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-renderer-test-'));
  env.TODO_TEST_USER_DATA = testProfile;
  if (file === 'ui-simplify') env.POME_TEST_WELCOME = '1';
  run(require('electron'), [`tests/${file}.electron.js`]);
  if (file === 'todo-reminders') {
    env.POME_TODO_RESTART = '1';
    run(require('electron'), ['tests/todo-reminders.electron.js']);
    delete env.POME_TODO_RESTART;
  }
  if (file === 'user-data-directory') {
    for (const phase of ['migrate', 'restart', 'switch', 'switched-restart', 'custom', 'fresh']) {
      env.POME_PROFILE_PHASE = phase;
      run(require('electron'), ['tests/user-data-directory.electron.js']);
    }
    delete env.POME_PROFILE_PHASE;
  }
  if (file === 'ui-simplify') {
    env.POME_UI_RESTART = '1';
    run(require('electron'), ['tests/ui-simplify.electron.js']);
    delete env.POME_UI_RESTART; delete env.POME_TEST_WELCOME;
  }
  if (file === 'provider-credentials') {
    env.POME_PROVIDER_RESTART = '1';
    run(require('electron'), ['tests/provider-credentials.electron.js']);
    delete env.POME_PROVIDER_RESTART;
  }
  if (file === 'work-hub' || file === 'work-hub-nas') {
    env.POME_RESTART_CHECK = file === 'work-hub' ? 'inbox' : 'paused-sync';
    run(require('electron'), ['tests/work-hub-restart.electron.js']);
    delete env.POME_RESTART_CHECK;
  }
  fs.rmSync(testProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
for (const file of [
  'scripts/localization-resources.js',
  'localization/runtime.js',
  'userDataDirectory.js',
  'renderer/localization.js',
  'scripts/check-work-hub-baseline.js',
  'scripts/build-fpk.js',
  'scripts/work-hub-statistics.js',
  'tests/work-hub-baseline.electron.js',
  'panelTiming.js',
  'atomicStorage.js',
  'todoReminders.js',
  'taskInbox.js',
  'aiSourceHooks.js',
  'aiEventPolicy.js',
  'aiAttentionStore.js',
  'aiNotificationScheduler.js',
  'claudeAttentionAdapter.js',
  'scripts/claude-attention.js',
  'renderer/ai-attention.js',
  'renderer/ai-sources.js',
  'scripts/cursor-notify.js',
  'scripts/cursor-mcp-auth-notify.js',
  'workspaceBackup.js',
  'syncRecovery.js',
  'renderer/task-inbox.js',
  'renderer/task-inbox-domain.js',
  'platform-adapters/task-apps.js',
  'fnos/app/server/recovery.js',
  'fnos/app/server/transactionLog.js',
  'main.js',
  'main-services.js',
  'public-http.js',
  'cursor-usage.js',
  'platform-adapters/cursor-secrets.js',
  'codex-usage.js',
  'codex-usage-remote.js',
  'codex-auth.js',
  'codex-thread-metadata.js',
  'aiProviderCatalog.js',
  'grokbot-usage.js',
  'claude-usage.js',
  'copilot-usage.js',
  'grok-usage.js',
  'antigravity-usage.js',
  'manus-usage.js',
  'manusApi.js',
  'manusCompletionAdapter.js',
  'manusCompletionStore.js',
  'manusCompletionService.js',
  'renderer/ai-provider-registry.js',
  'renderer/ai-usage-domain.js',
  'renderer/ai-usage-animation.js',
  'renderer/ai-usage.js',
  'renderer/ui-simplify-domain.js',
  'renderer/ui-simplify.js',
  'renderer/delete-confirm.js',
  'platform.js',
  'platform-adapters/index.js',
  'platform-adapters/darwin.js',
  'platform-adapters/win32.js',
  'platform-adapters/win32-user32.js',
  'preload.js',
  'sqliteProbe.js',
  'sync-store.js',
  'sync-migration.js',
  'todos-sync.js',
  'workspace-sync.js',
  'sync-settings.js',
  'sync-tls-trust.js',
  'packages/sync-protocol/index.js',
  'packages/sync-protocol/todo-reminders.js',
  'packages/sync-protocol/schema.js',
  'packages/sync-protocol/collections.js',
  'packages/sync-protocol/ai-completions.js',
  'packages/sync-protocol/mutation.js',
  'packages/sync-protocol/pull.js',
  'packages/sync-protocol/pairing.js',
  'packages/sync-protocol/migration.js',
  'packages/sync-protocol/endpoints.js',
  'renderer/domain.js',
  'renderer/vendor/suncalc/suncalc.js',
  'renderer/cities.js',
  'renderer/sun.js',
  'renderer/sun-widget.js',
  'sunWeather.js',
  'renderer/weather-domain.js',
  'renderer/weather-effects.js',
  'renderer/weather-icons.js',
  'renderer/vendor/lunar-javascript/lunar.js',
  'renderer/almanac.js',
  'renderer/almanac-widget.js',
  'renderer/effects.js',
  'renderer/app.js',
  'renderer/workspace.js',
  'renderer/icon-motion.js',
  'renderer/notification.js',
  'renderer/notification-domain.js',
  'renderer/nas-sync-pair.js',
  'renderer/nas-sync-migration.js',
  'renderer/nas-sync-settings.js',
  'build/afterPack.js',
  'scripts/codex-notify.js',
  'scripts/claude-notify.js',
  'scripts/grok-notify.js',
  'scripts/copilot-notify.js',
  'scripts/antigravity-notify.js',
  'scripts/completion-forwarder.js',
  'scripts/smoke-app.js',
  'scripts/make-ico.js',
  'fnos/app/server/schema.js',
  'fnos/app/server/auth.js',
  'fnos/app/server/csrf.js',
  'fnos/app/server/store.js',
  'fnos/app/server/persistentStore.js',
  'fnos/app/server/routes.js',
  'fnos/app/server/createApp.js',
  'fnos/app/server/devicePort.js',
  'fnos/app/server/index.js',
  'fnos/app/server/gatewayHttp.js',
  'fnos/app/server/testHarness.js',
  'fnos/app/server/pairing.js',
  'fnos/app/ui/pair.js',
]) {
  run(process.execPath, ['--check', file]);
}
