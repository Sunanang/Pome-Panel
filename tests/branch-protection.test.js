const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-branch-protection-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const repo = path.join(folder, 'repo');
  const remote = path.join(folder, 'remote.git');
  fs.mkdirSync(repo);
  fs.cpSync(path.join(root, '.githooks'), path.join(repo, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(path.join(root, 'scripts/setup-git-hooks.js'), path.join(repo, 'scripts/setup-git-hooks.js'));
  function git(args, cwd = repo, check = true) {
    const result = spawnSync('git', [
      '-c', 'user.name=Branch protection test',
      '-c', 'user.email=branch-test@example.invalid',
      '-c', 'commit.gpgSign=false',
      '-c', 'tag.gpgSign=false',
      ...args,
    ], { cwd, encoding: 'utf8', timeout: 10000 });
    if (check) assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result;
  }
  function install() {
    const result = spawnSync(process.execPath, ['scripts/setup-git-hooks.js'], {
      cwd: repo, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  git(['init', '-b', 'main']);
  install();
  git(['init', '--bare', remote]);
  git(['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(repo, 'example.txt'), 'initial\n');
  git(['add', 'example.txt']);
  return { repo, remote, git, install };
}

test('installed hooks survive switching to main without hook sources and repeated installation', t => {
  const { git, repo, install } = fixture(t);
  git(['switch', '-c', 'dev']);
  git(['commit', '-m', 'base without hook sources']);
  git(['branch', 'main']);
  git(['add', '.githooks', 'scripts/setup-git-hooks.js']);
  git(['commit', '-m', 'add hook sources on dev']);
  install();
  install();
  const activeHooks = git(['config', '--local', '--get', 'core.hooksPath']).stdout.trim();
  assert.equal(fs.realpathSync(activeHooks), fs.realpathSync(path.join(repo, '.git', 'pome-hooks')));
  git(['switch', 'main']);
  assert.equal(fs.existsSync(path.join(repo, '.githooks')), false);
  const blocked = git(['commit', '--allow-empty', '-m', 'blocked after checkout'], undefined, false);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /main 仅用于发布/);
  git(['switch', 'dev']);
  git(['commit', '--allow-empty', '-m', 'development still allowed']);
});

test('real commits and amendments are blocked on main, but commits work on dev', t => {
  const { git } = fixture(t);
  const blocked = git(['commit', '-m', 'blocked development'], undefined, false);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /main 仅用于发布.*dev/);
  git(['switch', '-c', 'dev']);
  git(['commit', '-m', 'allowed development']);
  git(['branch', 'main']);
  git(['switch', 'main']);
  const amend = git(['commit', '--amend', '--no-edit'], undefined, false);
  assert.notEqual(amend.status, 0);
  assert.match(amend.stderr, /main 仅用于发布/);
});

test('real dev and version tag pushes remain allowed', t => {
  const { git, remote } = fixture(t);
  git(['switch', '-c', 'dev']);
  git(['commit', '-m', 'development']);
  git(['push', 'origin', 'dev']);
  git(['tag', 'v0.0.1']);
  git(['push', 'origin', 'v0.0.1']);
  const revision = git(['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(git(['rev-parse', 'refs/heads/dev'], remote).stdout.trim(), revision);
  assert.equal(git(['rev-parse', 'refs/tags/v0.0.1'], remote).stdout.trim(), revision);
});

test('real pushes to main are blocked for direct, mapped, forced, deleted and multi-ref updates', t => {
  const { git, repo, remote } = fixture(t);
  git(['switch', '-c', 'dev']);
  git(['commit', '-m', 'base']);
  git(['push', 'origin', 'dev']);
  const base = git(['rev-parse', 'HEAD']).stdout.trim();
  // Seed a remote main only in this disposable bare repository; no network is used.
  git(['update-ref', 'refs/heads/main', base], remote);
  fs.writeFileSync(path.join(repo, 'example.txt'), 'next development\n');
  git(['commit', '-am', 'next development']);
  git(['branch', 'main']);
  for (const refs of [
    ['main'], ['dev:main'], ['HEAD:refs/heads/main'],
    ['--force', 'dev:main'], ['--delete', 'main'], ['dev', 'dev:main'],
  ]) {
    const blocked = git(['push', 'origin', ...refs], undefined, false);
    assert.notEqual(blocked.status, 0, refs.join(' '));
    assert.match(blocked.stderr, /禁止直接推送 main/, refs.join(' '));
    assert.equal(git(['rev-parse', 'refs/heads/main'], remote).stdout.trim(), base);
    assert.equal(git(['rev-parse', 'refs/heads/dev'], remote).stdout.trim(), base);
  }
});
