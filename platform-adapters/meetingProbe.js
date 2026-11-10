'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => execFile(file, args,
    { timeout: 7000, maxBuffer: 128 * 1024, windowsHide: true, ...options },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
}

function createMeetingProbe({ platform = process.platform, packaged = false, exec = run, launch = spawn,
  ownPid = process.pid, ownExecutable = process.execPath, ownCameraLabels = () => [] } = {}) {
  let binaryPromise, worker, pending, output = '', retryAt = 0, epoch = 0;
  function close(error = Error('probe_stopped')) {
    const previous = worker; worker = null; output = '';
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
    previous?.kill();
  }
  async function macBinary() {
    const bundled = path.join(__dirname, 'meeting-probe');
    if (packaged) { if (!fs.existsSync(bundled)) throw Error('probe_missing'); return bundled; }
    if (!binaryPromise) binaryPromise = (async () => {
      const source = path.join(__dirname, 'meeting-probe.swift');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 20);
      // A private per-user temporary directory prevents substitution by another user.
      const dir = path.join(os.tmpdir(), `pome-meeting-${process.getuid?.() ?? 'user'}`);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const binary = path.join(dir, `probe-${process.arch}-${hash}`);
      if (!fs.existsSync(binary)) {
        const temporary = `${binary}-${process.pid}`;
        await exec('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
          '-module-cache-path', path.join(dir, 'modules'), source, '-o', temporary], { timeout: 90000 });
        fs.renameSync(temporary, binary);
      }
      return binary;
    })().catch(error => { binaryPromise = null; throw error; });
    return binaryPromise;
  }
  async function startWorker() {
    const version = epoch;
    let file, args;
    if (platform === 'darwin') { file = await macBinary(); args = ['--watch']; }
    else if (platform === 'win32') {
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      file = powershell; args = ['-NoLogo', '-NoProfile', '-Mta', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'meeting-probe.ps1'), '-OwnPid', String(ownPid), '-OwnExecutable', ownExecutable];
    } else return;
    if (version !== epoch) throw Error('probe_stopped');
    const child = launch(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    worker = child;
    const failed = () => {
      if (worker !== child) return;
      retryAt = Date.now() + 30000; close(Error('probe_unavailable'));
    };
    child.on('error', failed); child.on('exit', failed);
    child.stdin.on('error', failed);
    child.stderr.on('data', () => {}); // Never log app/window titles or raw OS responses.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (worker !== child) return;
      output += chunk;
      if (output.length > 128 * 1024) { failed(); return; }
      let end;
      while ((end = output.indexOf('\n')) !== -1) {
        const line = output.slice(0, end).replace(/^\uFEFF/, '').trim(); output = output.slice(end + 1);
        if (!line || !pending) continue;
        let result;
        try { result = JSON.parse(line); if (result?.schemaVersion !== 1) throw Error('invalid_probe'); }
        catch { failed(); return; }
        const request = pending; pending = null; clearTimeout(request.timer); request.resolve(result);
      }
    });
  }
  const sample = async () => {
    const version = epoch;
    if (!['darwin', 'win32'].includes(platform)) return {};
    if (Date.now() < retryAt) throw Error('probe_unavailable');
    if (!worker) await startWorker();
    if (version !== epoch || !worker) throw Error('probe_stopped');
    if (pending) throw Error('probe_busy');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { retryAt = Date.now() + 30000; close(Error('probe_timeout')); }, 12000);
      pending = { resolve, reject, timer };
      worker.stdin.write(JSON.stringify({ ownCameraLabels: ownCameraLabels() }) + '\n');
    });
  };
  sample.stop = () => { epoch++; close(); };
  return sample;
}
module.exports = { createMeetingProbe };
