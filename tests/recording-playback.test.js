'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../renderer/workspace.js'), 'utf8');
function harness() {
  const requests = [], revoked = [], players = [];
  const context = { selectedRecordingId: 'a', Blob, URL: {
    createObjectURL: () => `blob:${players.length}`,
    revokeObjectURL: value => revoked.push(value),
  }, window: { notchAPI: { readRecording: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } },
  pomeLocaleRendererWorkspace: { t: key => key, bind: (node, key, read) => { node[key] = read(); } },
  document: { createElement: () => {
    const player = { pauses: 0, loads: 0, pause() { this.pauses++; }, load() { this.loads++; },
      addEventListener(name, callback) { this[name] = callback; },
      removeAttribute(name) { delete this[name]; } };
    players.push(player); return player;
  } } };
  vm.createContext(context);
  vm.runInContext('let currentAudioUrl = "", currentAudioElement = null, recordingAudioGeneration = 0;\n'
    + source.slice(source.indexOf('  function pauseRecordingAudio()'), source.indexOf('  function renderRecordingDetail()')), context);
  // This harness tests media reads and resource lifetime; real controls are
  // exercised against Chromium in workbench.electron.js.
  context.createRecordingPlayer = audio => audio;
  const container = () => ({ isConnected: true, textContent: 'loading', replaceChildren(player) { this.player = player; } });
  return { context, requests, revoked, players, container };
}
const recording = { id: 'a', audioPath: 'recordings/a.wav' };
const audio = { bytes: new Uint8Array([1, 2]), mimeType: 'audio/wav' };

test('missing, empty and rejected audio reads leave loading with an unavailable state', async () => {
  const h = harness();
  const missing = h.container();
  await h.context.loadRecordingAudio({ id: 'a' }, missing);
  assert.match(missing.textContent, /audioFileUnavailable/);
  const rejected = h.container(), job = h.context.loadRecordingAudio(recording, rejected);
  h.requests[0].reject(new Error('IPC disconnected')); await job;
  assert.match(rejected.textContent, /audioFileUnavailable/);
  const empty = h.container(), emptyJob = h.context.loadRecordingAudio(recording, empty);
  h.requests[1].resolve({ bytes: new Uint8Array() }); await emptyJob;
  assert.match(empty.textContent, /audioFileUnavailable/);
  assert.equal(h.players.length, 0);
});

test('re-rendering the same recording rejects old reads even if containers remain connected', async () => {
  const h = harness(), old = h.container(), next = h.container();
  const first = h.context.loadRecordingAudio(recording, old);
  h.context.releaseRecordingAudio();
  const second = h.context.loadRecordingAudio(recording, next);
  h.requests[1].resolve(audio); await second;
  h.requests[0].resolve(audio); await first;
  assert.equal(h.players.length, 1);
  assert.equal(old.player, undefined);
  assert.equal(next.player, h.players[0]);
  assert.deepEqual(h.revoked, []);
});

test('release pauses the old player, detaches media and revokes its URL exactly once', async () => {
  const h = harness(), container = h.container();
  const job = h.context.loadRecordingAudio(recording, container);
  h.requests[0].resolve(audio); await job;
  const player = h.players[0], url = player.src;
  h.context.pauseRecordingAudio();
  assert.equal(player.src, url, 'leaving the tab pauses without discarding a usable player');
  h.context.releaseRecordingAudio(); h.context.releaseRecordingAudio();
  assert.equal(player.pauses, 2);
  assert.equal(player.loads, 1);
  assert.equal(player.src, undefined);
  assert.deepEqual(h.revoked, [url]);
});

test('a read completing after removal or unload cannot create an orphan Blob URL', async () => {
  for (const cancel of [h => { h.context.releaseRecordingAudio(); }, (_h, c) => { c.isConnected = false; }]) {
    const h = harness(), c = h.container(), job = h.context.loadRecordingAudio(recording, c);
    cancel(h, c); h.requests[0].resolve(audio); await job;
    assert.equal(h.players.length, 0);
  }
});

test('decoder failure releases the broken media and shows an unavailable state', async () => {
  const h = harness(), container = h.container(), job = h.context.loadRecordingAudio(recording, container);
  h.requests[0].resolve(audio); await job;
  h.players[0].error();
  assert.match(container.textContent, /audioFileUnavailable/);
  assert.equal(h.revoked.length, 1);
  assert.equal(h.players[0].src, undefined);
});
