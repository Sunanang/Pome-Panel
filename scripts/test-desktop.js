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
run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.js')).map((name) => `tests/${name}`)]);
env.TODO_TEST_LOG = path.join(root, 'dist.noindex', 'windows-smoke', 'renderer-test.log');
fs.mkdirSync(path.dirname(env.TODO_TEST_LOG), { recursive: true });
fs.writeFileSync(env.TODO_TEST_LOG, '');
for (const file of ['notch-focus', 'retained-workspace', 'startup']) {
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-renderer-test-'));
  env.TODO_TEST_USER_DATA = testProfile;
  run(require('electron'), [`tests/${file}.electron.js`]);
  fs.rmSync(testProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
for (const file of [
  'main.js',
  'main-services.js',
  'platform.js',
  'preload.js',
  'sqliteProbe.js',
  'sync-store.js',
  'sync-migration.js',
  'todos-sync.js',
  'sync-settings.js',
  'packages/sync-protocol/index.js',
  'packages/sync-protocol/schema.js',
  'packages/sync-protocol/collections.js',
  'packages/sync-protocol/mutation.js',
  'packages/sync-protocol/pull.js',
  'packages/sync-protocol/pairing.js',
  'packages/sync-protocol/migration.js',
  'packages/sync-protocol/endpoints.js',
  'renderer/domain.js',
  'renderer/effects.js',
  'renderer/app.js',
  'renderer/workspace.js',
  'renderer/icon-motion.js',
  'renderer/notification.js',
  'renderer/nas-sync-pair.js',
  'renderer/nas-sync-migration.js',
  'renderer/nas-sync-settings.js',
  'build/afterPack.js',
  'scripts/codex-notify.js',
  'scripts/claude-notify.js',
  'scripts/smoke-app.js',
  'fnos/app/server/schema.js',
  'fnos/app/server/auth.js',
  'fnos/app/server/csrf.js',
  'fnos/app/server/store.js',
  'fnos/app/server/routes.js',
  'fnos/app/server/createApp.js',
  'fnos/app/server/index.js',
  'fnos/app/server/testHarness.js',
  'fnos/app/server/pairing.js',
  'fnos/app/ui/pair.js',
]) {
  run(process.execPath, ['--check', file]);
}
