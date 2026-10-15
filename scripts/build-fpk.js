#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');

function readMetadata(root) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = Object.fromEntries(fs.readFileSync(path.join(root, 'fnos/manifest'), 'utf8')
    .split(/\r?\n/).filter(line => line.includes('=')).map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
  const manifestJson = JSON.parse(fs.readFileSync(path.join(root, 'fnos/manifest.json'), 'utf8'));
  if (manifest.version !== version || manifestJson.version !== version) {
    throw new Error('NAS manifests and package.json versions must match');
  }
  if (manifest.appname !== 'pome-panel' || !/^\d+\.\d+\.\d+$/.test(version) || manifest.platform !== 'all') {
    throw new Error('Expected pome-panel with a semantic version and platform=all');
  }
  return { version, appname: manifest.appname };
}

// Also used by the existing preparation-only shell entry point.
function preparePayload(root, destination) {
  const protocol = path.join(destination, 'app/packages/sync-protocol');
  fs.rmSync(protocol, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(protocol), { recursive: true });
  fs.cpSync(path.join(root, 'packages/sync-protocol'), protocol, { recursive: true });
  fs.copyFileSync(path.join(root, 'build/pome-panel-icon.png'), path.join(destination, 'ICON.PNG'));
  fs.copyFileSync(path.join(destination, 'app/ui/images/icon_256.png'), path.join(destination, 'ICON_256.PNG'));
}

function buildFpk({ root = projectRoot, outputDir = path.join(root, 'dist.noindex'),
  fnpack = process.env.FNPACK || 'fnpack', run = execFileSync } = {}) {
  const { version, appname } = readMetadata(root);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-fpk-'));
  try {
    const payload = path.join(temporary, 'payload');
    fs.cpSync(path.join(root, 'fnos'), payload, { recursive: true,
      filter: source => !['.DS_Store', 'node_modules'].includes(path.basename(source)) && !source.endsWith('.fpk') });
    preparePayload(root, payload);
    run(fnpack, ['build', '--directory', payload], { cwd: temporary, stdio: 'inherit' });
    const built = path.join(temporary, `${appname}.fpk`);
    if (!fs.existsSync(built) || !fs.statSync(built).isFile() || fs.statSync(built).size === 0) {
      throw new Error(`fnpack did not produce a non-empty ${appname}.fpk`);
    }
    const filename = `Pome-Panel-${version}-fnos-all.fpk`;
    fs.mkdirSync(outputDir, { recursive: true });
    const artifact = path.join(outputDir, filename);
    fs.copyFileSync(built, artifact);
    const digest = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    fs.writeFileSync(`${artifact}.sha256`, `${digest}  ${filename}\n`);
    return artifact;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    if (process.argv[2] === '--prepare-only') {
      preparePayload(projectRoot, path.join(projectRoot, 'fnos'));
      console.log('NAS protocol and icons refreshed; no FPK was built.');
    } else {
      console.log(`NAS package: ${buildFpk()}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildFpk, preparePayload, readMetadata };
