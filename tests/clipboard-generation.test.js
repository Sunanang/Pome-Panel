'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { reduceClipboardObservation } = require('../main-services');
const platformPolicy = require('../platform');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('async function baselineCurrentClipboard(');
const pollingSource = source.slice(start, source.indexOf('function setHoverSpaceShortcut(', start));
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const text = value => ({ concealed: false, text: value, image: null });
const image = value => ({ concealed: false, text: '', image: { fingerprint: value, pngBuffer: Buffer.from(value) } });
function fixture() {
  let root = '/fixture/one', read = async () => text(''), write = async () => {}, random = 0, timer = 0;
  const events = [], files = new Map(), writes = [], removals = [];
  const context = { clipPollingEnabled: true, clipPolling: false, clipPollingGeneration: 0,
    clipObservationState: { textFingerprint: 'baseline', imageFingerprint: null },
    clipBaselineTimer: null, clipPollTimer: null, lastClipImageProbeAt: 0,
    CLIP_IMAGE_POLL_INTERVAL_MS: 0, CLIP_POLL_INTERVAL_MS: 500, CLIP_IMAGES_DIR_NAME: 'clipboard-images',
    mainWindow: { isDestroyed: () => false, webContents: { send: (channel, payload) => events.push({ channel, payload }) } },
    readSystemClipboard: (...args) => read(...args), workspaceRoot: () => root,
    ensureClipImagesDir() {}, getClipImagesDir: () => path.join(root, 'clipboard-images'),
    Date: { now: () => 5000 }, Math: { random: () => ++random / 1000 },
    path, platformPolicy, reduceClipboardObservation,
    fs: { promises: {
      async writeFile(file, bytes, options) {
        assert.equal(options?.flag, 'wx'); writes.push(file);
        if (files.has(file)) throw Object.assign(Error('exists'), { code: 'EEXIST' });
        files.set(file, Buffer.from(bytes)); await write(file);
      },
      async unlink(file) { removals.push(file); files.delete(file); },
    } },
    setTimeout: () => ++timer, clearTimeout() {}, setInterval: () => ++timer, clearInterval() {},
  };
  vm.createContext(context); vm.runInContext(pollingSource, context);
  return { context, events, files, writes, removals,
    setRead: value => { read = value; }, setWrite: value => { write = value; }, setRoot: value => { root = value; },
    restart() { context.stopClipboardPolling(); context.startClipboardPolling(); },
    async baseline(value) { read = async () => value; await context.baselineCurrentClipboard(context.clipPollingGeneration); },
  };
}
test('late clipboard reads from a disabled generation cannot enter history or overwrite a new baseline', async () => {
  const f = fixture(), old = deferred(); f.setRead(() => old.promise);
  const task = f.context.pollClipboard(); f.restart(); await f.baseline(text('new-baseline'));
  old.resolve(text('old-generation')); await task;
  assert.equal(f.events.length, 0); assert.equal(f.context.clipObservationState.textFingerprint, 'new-baseline');
});
test('an old polling finally cannot release the newer generation lock', async () => {
  const f = fixture(), old = deferred(), current = deferred();
  f.setRead(() => old.promise); const oldTask = f.context.pollClipboard();
  f.restart(); await f.baseline(text('new-baseline'));
  let reads = 0; f.setRead(() => { reads++; return current.promise; });
  const currentTask = f.context.pollClipboard(); old.resolve(text('old-generation')); await oldTask;
  assert.equal(f.context.clipPolling, true);
  await f.context.pollClipboard(); assert.equal(reads, 1);
  current.resolve(text('new-content')); await currentTask;
  assert.equal(f.context.clipPolling, false); assert.equal(f.events.length, 1); assert.equal(f.events[0].payload.text, 'new-content');
});
test('late baseline failures cannot erase the new generation baseline', async () => {
  const f = fixture(), old = deferred(); f.setRead(() => old.promise);
  const baseline = f.context.baselineCurrentClipboard(f.context.clipPollingGeneration);
  f.restart(); await f.baseline(text('new-baseline')); old.reject(Error('old-read-failed')); await baseline;
  assert.equal(f.context.clipObservationState.textFingerprint, 'new-baseline');
});
test('workspace changes during a clipboard read discard that observation', async () => {
  const f = fixture(), old = deferred(); f.setRead(() => old.promise);
  const task = f.context.pollClipboard(); f.setRoot('/fixture/two'); old.resolve(image('old-workspace')); await task;
  assert.equal(f.events.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.context.clipObservationState.imageFingerprint, null);
});
test('late image writes remove only their unpublished exclusive file and preserve newer cycle files and fingerprints', async () => {
  const f = fixture(), oldWrite = deferred(), writing = deferred();
  f.setRead(async () => image('old-image'));
  f.setWrite(file => { writing.resolve(file); return oldWrite.promise; });
  const oldTask = f.context.pollClipboard(), oldPath = await writing.promise;
  f.restart(); await f.baseline(text(''));
  f.setRead(async () => image('new-image')); f.setWrite(async () => {}); await f.context.pollClipboard();
  const newPath = f.writes[1]; assert(f.files.has(newPath));
  oldWrite.resolve(); await oldTask;
  assert.equal(f.events.length, 1); assert.equal(f.events[0].payload.imagePath, platformPolicy.portableMediaPath('clipboard-images', newPath));
  assert.equal(f.context.clipObservationState.imageFingerprint, 'new-image');
  assert(!f.files.has(oldPath)); assert(f.files.has(newPath)); assert.deepEqual(f.removals, [oldPath]);
});
test('workspace changes during image writes cannot publish old relative paths or suppress a retry in the new workspace', async () => {
  const f = fixture(), oldWrite = deferred(), writing = deferred();
  f.setRead(async () => image('same-image')); f.setWrite(file => { writing.resolve(file); return oldWrite.promise; });
  const task = f.context.pollClipboard(), oldPath = await writing.promise;
  f.setRoot('/fixture/two'); oldWrite.resolve(); await task;
  assert.equal(f.events.length, 0); assert.equal(f.context.clipObservationState.imageFingerprint, null); assert(!f.files.has(oldPath));
  f.setWrite(async () => {}); await f.context.pollClipboard();
  assert.equal(f.events.length, 1); assert(f.writes[1].startsWith('/fixture/two/'));
});
test('image name collisions never unlink a file that another task already owns', async () => {
  const f = fixture(); f.context.Math.random = () => .5;
  const name = `clip-${(5000).toString(36)}${(.5).toString(36).slice(2,8)}.png`;
  const existing = path.join('/fixture/one/clipboard-images', name); f.files.set(existing, Buffer.from('other-task'));
  f.setRead(async () => image('collision')); await f.context.pollClipboard();
  assert.equal(f.events.length, 0); assert.equal(f.files.get(existing).toString(), 'other-task'); assert.equal(f.removals.length, 0);
  assert.equal(f.context.clipObservationState.imageFingerprint, null);
});
test('a failed image write leaves its fingerprint retryable', async () => {
  const f = fixture(); f.setRead(async () => image('retry-image')); f.setWrite(async () => { throw Error('disk-full'); });
  await f.context.pollClipboard(); assert.equal(f.context.clipObservationState.imageFingerprint, null); assert.equal(f.events.length, 0);
  f.setWrite(async () => {}); await f.context.pollClipboard();
  assert.equal(f.context.clipObservationState.imageFingerprint, 'retry-image'); assert.equal(f.events.length, 1);
});
