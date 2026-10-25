'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1300, height: 720,
    webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => {
    if (details.level === 'error') errors.push(details.message);
  });
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { console.error('Renderer execution failed:', code.slice(0, 140), errors); throw error; }
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) {
      if (await js(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const shots = process.env.POME_WORKSPACE_LIFECYCLE_SHOTS || path.join(__dirname, '../dist.noindex/workspace-lifecycle');
  fs.mkdirSync(shots, { recursive: true });
  const capture = async name => {
    await js(`document.fonts.ready; document.getElementById('ui-capsule-hint')?.querySelector('button')?.click()`);
    await new Promise(resolve => setTimeout(resolve, 550));
    fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    await js(`(async () => {
      window.addEventListener('unhandledrejection', event => { window.testUnhandled = String(event.reason); });
      window.testReads = []; window.testRevoked = [];
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => { testRevoked.push(url); revoke(url); };
      // Valid, two-second mono PCM fixture; no microphone or real workspace.
      const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer);
      const word = (offset, text) => [...text].forEach((c, i) => bytes[offset + i] = c.charCodeAt(0));
      word(0,'RIFF'); view.setUint32(4,32036,true); word(8,'WAVE'); word(12,'fmt ');
      view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
      view.setUint32(24,8000,true); view.setUint32(28,16000,true); view.setUint16(32,2,true);
      view.setUint16(34,16,true); word(36,'data'); view.setUint32(40,32000,true);
      window.testAudio = {bytes, mimeType:'audio/wav'};
      window.notchAPI = {
        readRecording: () => new Promise((resolve,reject) => testReads.push({resolve,reject})),
        listWindows: async () => ({items:[{id:'fixture-window', appName:'Finder', title:'工作文件',displayName:'Finder'}]})
      };
      window.projectRecordings = rows => document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{recordings:rows}}));
      window.recordingRow = {id:'playback',title:'录音回放验收',durationMs:2000,createdAt:Date.now(),transcript:'验证切换、读取异常与播放器释放。',audioPath:'recordings/fixture.wav'};
      await setMode(true); await setActiveTab('recordings');
      projectRecordings([{...recordingRow,audioPath:''}]);
    })()`);
    await until(`document.querySelector('.recording-audio')?.textContent === PomeI18n.t('copy.audioFileUnavailable.d7ce80')`);
    await capture('recording-unavailable');
    await js(`projectRecordings([recordingRow]); testReads.at(-1).reject(new Error('read failed'));`);
    await until(`document.querySelector('.recording-audio')?.textContent === PomeI18n.t('copy.audioFileUnavailable.d7ce80')`);
    await js(`projectRecordings([recordingRow]); window.oldRead=testReads.at(-1); projectRecordings([recordingRow]); testReads.at(-1).resolve(testAudio);`);
    await until(`!!document.querySelector('.recording-audio audio')`);
    await js(`oldRead.resolve(testAudio);`);
    assert.equal(await js(`testRevoked.length`), 0, 'late read must not revoke current URL');
    await until(`document.querySelector('.recording-audio audio').readyState >= 2`);
    await capture('recording-ready');
    const cleanup = await js(`(async () => {
      window.player = document.querySelector('.recording-audio audio');
      await player.play(); await setActiveTab('notes'); const tabPaused=player.paused;
      await setActiveTab('recordings'); await player.play(); document.dispatchEvent(new Event('notch:will-collapse'));
      const collapsePaused=player.paused;
      projectRecordings([]);
      return {tabPaused,collapsePaused,srcRemoved:!player.getAttribute('src'),revoked:testRevoked.length,players:document.querySelectorAll('.recording-audio audio').length};
    })()`);
    assert.deepEqual(cleanup, { tabPaused: true, collapsePaused: true, srcRemoved: true, revoked: 1, players: 0 });
    await js(`projectRecordings([recordingRow]); testReads.at(-1).resolve({bytes:new Uint8Array([1,2,3]),mimeType:'audio/wav'});`);
    await until(`document.querySelector('.recording-audio')?.textContent === PomeI18n.t('copy.audioFileUnavailable.d7ce80')`);
    assert.equal(await js(`testRevoked.length`), 2, 'decoder failure must release its URL');
    await js(`(async () => { await setActiveTab('home'); await NotchWorkspace.refreshWindows(true); })()`);
    await until(`!!document.querySelector('.window-item[data-id="fixture-window"]')`);
    for (const type of ['pointercancel', 'notch:will-collapse', 'pointerup']) {
      const drag = await js(`(async () => {
        const item=document.querySelector('.window-item[data-id="fixture-window"]'), bounds=item.getBoundingClientRect();
        item.setPointerCapture=()=>{};item.hasPointerCapture=()=>false;
        const base={bubbles:true,cancelable:true,pointerId:91,button:0};
        item.dispatchEvent(new PointerEvent('pointerdown',{...base,clientX:bounds.x+10,clientY:bounds.y+10}));
        await new Promise(resolve=>setTimeout(resolve,490));
        document.dispatchEvent(new PointerEvent('pointermove',{...base,clientX:-30,clientY:-30}));
        const inRemovalZone=item.classList.contains('remove-ready');
        document.dispatchEvent(${JSON.stringify(type)}==='notch:will-collapse'?new Event('notch:will-collapse'):new PointerEvent(${JSON.stringify(type)},base));
        return {inRemovalZone,restored:!item.classList.contains('dragging')&&!item.classList.contains('remove-ready'),hidden:localStorage.getItem('notch-hidden-windows'),present:item.isConnected};
      })()`);
      if (type === 'pointerup') {
        assert.equal(drag.inRemovalZone && drag.restored && !drag.present, true, 'an explicit drop still hides the item');
        assert.deepEqual(JSON.parse(drag.hidden), ['Finder\u0000工作文件']);
      } else {
        assert.deepEqual(drag, { inRemovalZone: true, restored: true, hidden: null, present: true });
        if (type === 'notch:will-collapse') await capture('window-drag-cancelled');
      }
    }
    assert.equal(await js(`window.testUnhandled || ''`), '');
    assert.deepEqual(errors, []);
    console.log('Workspace playback failure/races/release, pause on tab/collapse, and cancelled window-removal checks passed');
  } finally { win.destroy(); }
}
main().then(() => app.quit(), error => { console.error(error); app.exit(1); });
