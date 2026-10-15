'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildFpk, readMetadata } = require('../scripts/build-fpk');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-fpk-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  };
  write('package.json', JSON.stringify({ version: '1.2.3' }));
  write('fnos/manifest', 'appname=pome-panel\nversion=1.2.3\nplatform=all\n');
  write('fnos/manifest.json', JSON.stringify({ version: '1.2.3' }));
  write('packages/sync-protocol/index.js', 'fresh protocol');
  write('fnos/app/packages/sync-protocol/index.js', 'old protocol');
  write('fnos/app/packages/sync-protocol/obsolete.js', 'must not ship');
  write('build/pome-panel-icon.png', 'brand icon');
  write('fnos/app/ui/images/icon_256.png', 'desktop icon');
  write('fnos/ICON.PNG', 'old icon');
  write('fnos/ICON_256.PNG', 'old desktop icon');
  write('fnos/cmd/main', '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(root, 'fnos/cmd/main'), 0o755);
  write('fnos/.DS_Store', 'local file');
  write('fnos/old.fpk', 'old package');
  write('fnos/app/node_modules/ignored.js', 'local dependency');
  return { root, write };
}

test('NAS build refreshes an isolated payload and writes a versioned FPK plus verifiable checksum', t => {
  const { root } = fixture(t);
  let temporary;
  const bytes = Buffer.from('simulated fnpack output');
  const artifact = buildFpk({ root, fnpack: '/official/fnpack', run(executable, args, options) {
    assert.equal(executable, '/official/fnpack');
    assert.deepEqual(args.slice(0, 2), ['build', '--directory']);
    const payload = args[2]; temporary = options.cwd;
    assert.equal(path.dirname(payload), temporary);
    assert.notEqual(payload, path.join(root, 'fnos'));
    assert.equal(fs.readFileSync(path.join(payload, 'app/packages/sync-protocol/index.js'), 'utf8'), 'fresh protocol');
    assert.equal(fs.existsSync(path.join(payload, 'app/packages/sync-protocol/obsolete.js')), false);
    assert.equal(fs.readFileSync(path.join(payload, 'ICON.PNG'), 'utf8'), 'brand icon');
    assert.equal(fs.readFileSync(path.join(payload, 'ICON_256.PNG'), 'utf8'), 'desktop icon');
    for (const ignored of ['.DS_Store', 'old.fpk', 'app/node_modules']) assert.equal(fs.existsSync(path.join(payload, ignored)), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(payload, 'cmd/main')).mode & 0o111, 0o111);
    fs.writeFileSync(path.join(temporary, 'pome-panel.fpk'), bytes);
  } });
  assert.equal(path.basename(artifact), 'Pome-Panel-1.2.3-fnos-all.fpk');
  assert.deepEqual(fs.readFileSync(artifact), bytes);
  assert.equal(fs.readFileSync(`${artifact}.sha256`, 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(artifact)}\n`);
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.readFileSync(path.join(root, 'fnos/app/packages/sync-protocol/index.js'), 'utf8'), 'old protocol');
  assert.equal(fs.readFileSync(path.join(root, 'fnos/ICON.PNG'), 'utf8'), 'old icon');
});

for (const manifest of ['fnos/manifest', 'fnos/manifest.json']) {
  test(`NAS build rejects a mismatched ${manifest} before invoking fnpack`, t => {
    const { root, write } = fixture(t);
    write(manifest, manifest.endsWith('.json') ? JSON.stringify({ version: '1.0.0' }) : 'version=1.0.0\n');
    assert.throws(() => buildFpk({ root, run() { assert.fail('must not invoke fnpack'); } }), /versions must match/);
    assert.equal(fs.existsSync(path.join(root, 'dist.noindex')), false);
  });
}

test('NAS build rejects an unexpected application or architecture', t => {
  const { root, write } = fixture(t);
  write('fnos/manifest', 'appname=other\nversion=1.2.3\nplatform=x86\n');
  assert.throws(() => readMetadata(root), /platform=all/);
});

test('fnpack failures propagate and clean the temporary payload', t => {
  const { root } = fixture(t); let temporary;
  assert.throws(() => buildFpk({ root, run(_executable, _args, options) {
    temporary = options.cwd; throw new Error('fnpack validation failed');
  } }), /fnpack validation failed/);
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.existsSync(path.join(root, 'dist.noindex')), false);
});

for (const output of ['missing', 'empty']) {
  test(`NAS build rejects ${output} output instead of uploading an invalid artifact`, t => {
    const { root } = fixture(t); let temporary;
    assert.throws(() => buildFpk({ root, run(_executable, _args, options) {
      temporary = options.cwd;
      if (output === 'empty') fs.writeFileSync(path.join(temporary, 'pome-panel.fpk'), '');
    } }), /did not produce a non-empty/);
    assert.equal(fs.existsSync(temporary), false);
    assert.equal(fs.existsSync(path.join(root, 'dist.noindex')), false);
  });
}
