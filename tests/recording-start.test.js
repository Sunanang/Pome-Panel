'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Domain = require('../renderer/domain');
const source = fs.readFileSync(path.join(__dirname, '../renderer/workspace.js'), 'utf8');
const capture = source.slice(source.indexOf('  async function showMicrophonePermissionHint()'), source.indexOf('  function startRecording()'));
function harness({ denied = false, unavailable = false, error = 'NotReadableError' } = {}) {
  const errors = [], calls = [];
  const transcript = { textContent: '', hidden: true, replaceChildren() { this.textContent = ''; },
    append(value) { if (typeof value === 'string') this.textContent += value; } };
  const context = {
    recordingStatus: 'idle', recordingCaptureIssue: '', transcriptionConfig: {}, liveTranscript: transcript,
    navigator: { mediaDevices: { getUserMedia: async () => { calls.push('capture'); throw { name: error }; } } },
    window: { MediaRecorder: unavailable ? null : function () {},
      NotchUi: { showError: value => errors.push(value) },
      notchAPI: { ensureMicrophone: async () => !denied,
        getMediaAccessStatus: async () => ({ status: 'denied', message: 'permission-denied', canOpenSettings: true, pane: 'microphone' }),
        openPrivacySettings: pane => calls.push(pane) } },
    document: { createElement: () => ({ addEventListener() {} }) },
    pomeLocaleRendererWorkspace: { t: key => key, bind: (node, prop, value) => { node[prop] = value(); } },
    stopMediaTracks: () => calls.push('stop-tracks'), discardRecordingDraft() {},
    updateRecordingUi: () => { if (context.pending) transcript.textContent = 'waiting-for-permission'; }, startRecording() {},
  };
  vm.createContext(context); vm.runInContext(capture, context);
  const task = Domain.createExclusiveAsyncTask(pending => { context.pending = pending; context.updateRecordingUi(); });
  return { context, transcript, errors, calls, start: () => task.run(() => context.startRecordingAttempt()) };
}

test('microphone denial is visible outside the home tile and offers the system privacy action', async () => {
  const h = harness({ denied: true }); await h.start();
  assert.equal(h.errors.length, 1); assert(!h.calls.includes('capture'));
  assert.equal(h.transcript.textContent, 'permission-denied'); assert.equal(h.transcript.hidden, false);
  h.errors[0].onRepair(); assert.deepEqual(h.calls, ['microphone']);
});

for (const [error, key, attempts] of [
  ['NotFoundError', 'copy.noMicrophoneDeviceFound.a4c8e1', 2],
  ['NotReadableError', 'copy.noMicrophoneInputCheckTheSystemAudio.ef1c9a', 1],
]) test(`${error}: failure survives pending-state cleanup and releases capture resources`, async () => {
  const h = harness({ error }); await h.start();
  assert.equal(h.transcript.textContent, key); assert.equal(h.errors[0].messageKey, key);
  assert.equal(h.calls.filter(value => value === 'capture').length, attempts);
  assert.equal(h.calls.filter(value => value === 'stop-tracks').length, 1);
  assert.equal(h.context.recordingStatus, 'idle');
});

test('unavailable capture APIs return an actionable failure instead of silently doing nothing', async () => {
  const h = harness({ unavailable: true }); await h.start();
  assert.equal(h.transcript.textContent, 'copy.couldnTStartRecordingCheckTheMicrophone.8c52b6');
  assert.equal(h.errors.length, 1); assert.deepEqual(h.calls, []);
});

test('unsupported audio constraints retry once without processing; permission denial never retries', async () => {
  const h = harness(), constraints = [], stream = {};
  h.context.navigator.mediaDevices.getUserMedia = async value => {
    constraints.push(value); if (constraints.length === 1) throw { name: 'OverconstrainedError' }; return stream;
  };
  assert.equal(await h.context.requestRecordingStream(), stream);
  assert.equal(constraints.length, 2); assert.equal(constraints[1].audio, true);
  const denied = harness({ error: 'NotAllowedError' }); await denied.start();
  assert.equal(denied.calls.filter(value => value === 'capture').length, 1);
});

test('the saved-recording toast opens its own recording after another item has been selected', async () => {
  let action, tab;
  const context = { Domain, recordingStatus: 'saving', recordingCaptureIssue: '',
    recordings: [{ id: 'other', audioPath: 'recordings/other.webm' }], recordingTranscript: '',
    transcriptionConfig: {}, liveTranscript: null, selectedRecordingId: 'other', recordingDraftId: 'saved',
    activeRecordingDraft: () => ({ id: 'saved', createdAt: 123 }),
    window: { notchAPI: { saveRecording: async () => ({ ok: true, audioPath: 'recordings/saved.webm' }) } },
    updateRecordingUi() {}, persistRecordings() {}, renderRecordings() {},
    showStatusToast: (_message, options) => { action = options.onAction; },
    setActiveTab: value => { tab = value; }, pomeLocaleRendererWorkspace: { t: key => key } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function finalizeRecording('), source.indexOf('  // 麦克风被系统挡住时')), context);
  await context.finalizeRecording({ size: 10, type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(10) }, 1000);
  context.selectedRecordingId = 'other'; action();
  assert.equal(context.selectedRecordingId, 'saved'); assert.equal(tab, 'recordings');
  context.recordings = context.recordings.filter(item => item.id !== 'saved');
  context.selectedRecordingId = 'other'; action();
  assert.equal(context.selectedRecordingId, 'other', 'deleted recording is not resurrected by a stale action');
});
