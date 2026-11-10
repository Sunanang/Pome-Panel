'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createMeetingModeMonitor } = require('../meetingMode');
const { createMeetingProbe } = require('../platform-adapters/meetingProbe');

function fixture() {
  let time = 0;
  const changes = [];
  const monitor = createMeetingModeMonitor({ now: () => time, onChange: s => changes.push(s) });
  return { monitor, changes, at: (at, sample) => { time = at; monitor.accept(sample); } };
}
test('camera requires continuous use; other signals suppress immediately; every active reason must clear', () => {
  const { monitor, at } = fixture();
  at(0, { camera: true, sharing: false, focus: false });
  at(2999, { camera: true }); assert.equal(monitor.snapshot().active, false);
  at(3000, { camera: true }); assert.deepEqual(monitor.snapshot().reasons, ['camera']);
  at(4000, { camera: true, sharing: true, focus: true });
  assert.deepEqual(monitor.snapshot().reasons, ['camera', 'sharing', 'focus']);
  at(5000, { camera: false, sharing: false, focus: true });
  at(35000, { camera: false, sharing: false, focus: true });
  assert.deepEqual(monitor.snapshot().reasons, ['focus']);
  at(36000, { focus: false }); at(65999, { focus: false }); assert.equal(monitor.snapshot().active, true);
  at(66000, { focus: false }); assert.equal(monitor.snapshot().active, false);
});
test('brief camera use, interrupted entry and interrupted recovery do not toggle', () => {
  const { monitor, at } = fixture();
  at(0, { camera: true }); at(2000, { camera: false }); at(4000, { camera: true });
  at(6999, { camera: true }); assert.equal(monitor.snapshot().active, false);
  at(7000, { camera: true }); at(8000, { camera: false }); at(37999, { camera: true });
  at(39000, { camera: false }); at(68999, { camera: false }); assert.equal(monitor.snapshot().active, true);
  at(69000, { camera: false }); assert.equal(monitor.snapshot().active, false);
});
test('unavailable, malformed, stale and failed samples cannot clear an existing pause', () => {
  const { monitor, at } = fixture();
  at(0, { focus: true }); at(1, { focus: false });
  at(40000, { focus: { active: false, available: false, error: 'focus_not_shared' } });
  assert.equal(monitor.snapshot().active, true);
  assert.equal(monitor.snapshot().signals.focus.available, false);
  at(50000, { focus: 'false' }); at(60000, { focus: null }); at(70000, {});
  assert.equal(monitor.snapshot().active, true);
  at(80000, { focus: false }); at(109999, { focus: false }); assert.equal(monitor.snapshot().active, true);
  at(110000, { focus: false }); assert.equal(monitor.snapshot().active, false);
});
test('automatic preference is independent and disabling it clears only runtime automatic state', () => {
  const { monitor, at } = fixture();
  at(0, { sharing: true }); monitor.setEnabled(false);
  assert.equal(monitor.snapshot().active, false); assert.deepEqual(monitor.snapshot().reasons, []);
  monitor.setEnabled(true); assert.equal(monitor.snapshot().active, false);
});
test('unchanged samples do not flood UI updates', () => {
  const { at, changes } = fixture();
  at(0, { camera: false, sharing: false, focus: false });
  at(2000, { camera: false, sharing: false, focus: false }); assert.equal(changes.length, 1);
});
test('late probe completion after stop is ignored', async () => {
  let resolve, changes = 0;
  const monitor = createMeetingModeMonitor({ probe: () => new Promise(r => { resolve = r; }), onChange: () => changes++ });
  monitor.start(); monitor.stop(); resolve({ focus: true }); await Promise.resolve();
  assert.equal(changes, 0); assert.equal(monitor.snapshot().active, false);
});
test('Windows worker persists, reads Unicode JSON, never loads koffi, and closes on stop', async () => {
  let launches = 0, args, killed = false;
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { killed = true; };
  const probe = createMeetingProbe({ platform: 'win32', launch: (_file, parameters) => { launches++; args = parameters; return child; } });
  const first = probe(); await Promise.resolve();
  child.stdout.write('\uFEFF{"schemaVersion":1,"camera":false,"sharing":true,"focus":false}\n');
  assert.equal((await first).sharing, true);
  const second = probe(); child.stdout.write('{"schemaVersion":1,"camera":true,"sharing":false,"focus":false}\n');
  assert.equal((await second).camera, true); assert.equal(launches, 1);
  assert(args.includes('-NoProfile')); assert(args.some(arg => arg.endsWith('meeting-probe.ps1')));
  probe.stop(); assert.equal(killed, true);
});
test('worker death rejects an in-flight sample and reports unavailable instead of all-clear', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const probe = createMeetingProbe({ platform: 'win32', launch: () => child });
  const sample = probe(); await Promise.resolve(); child.emit('exit', 1);
  await assert.rejects(sample, /probe_unavailable/); await assert.rejects(probe(), /probe_unavailable/);
});
test('stopping while the helper starts cancels the sample without leaving a pending request', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const probe = createMeetingProbe({ platform: 'win32', launch: () => child });
  const sample = probe(); probe.stop(); await assert.rejects(sample, /probe_stopped/);
});
test('Windows native helper compiles and reports real read-only states', { skip: process.platform !== 'win32' }, async () => {
  const probe = createMeetingProbe();
  try {
    const sample = await probe();
    assert.equal(sample.schemaVersion, 1);
    for (const key of ['camera', 'sharing', 'focus']) {
      assert.equal(typeof sample[key].available, 'boolean');
      if (sample[key].available) assert.equal(typeof sample[key].active, 'boolean');
      else assert.equal(sample[key].active, null);
    }
  } finally { probe.stop(); }
});
