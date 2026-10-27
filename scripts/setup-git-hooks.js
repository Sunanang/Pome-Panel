#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

// Store active hooks outside the checkout so switching to main cannot remove them.
// The common directory also keeps the protection active in linked worktrees.
const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir']));
const hooksDir = path.join(commonDir, 'pome-hooks');
fs.mkdirSync(hooksDir, { recursive: true });
for (const name of ['pre-commit', 'pre-push']) {
  const target = path.join(hooksDir, name);
  fs.copyFileSync(path.join(root, '.githooks', name), target);
  fs.chmodSync(target, 0o755);
}
git(['config', '--local', 'core.hooksPath', hooksDir]);
console.log(`Local branch protection enabled: ${hooksDir}`);
