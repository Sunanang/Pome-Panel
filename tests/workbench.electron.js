'use strict';

// Real renderer acceptance with an isolated profile, sample content, a silent
// PCM recording and in-memory credential IPC. No real secrets or microphone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'pome-workbench-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.POME_HOOK_TEST_HOME = path.join(profile, 'isolated-home');
process.env.POME_TEST_LANGUAGE = 'zh-CN';
fs.mkdirSync(process.env.POME_HOOK_TEST_HOME, { recursive: true });
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false, error: 'fixture_no_auth' });
require('../codex-usage-remote').createCodexUsageService = () => ({
  tokenState: () => ({ manualTokenInvalid: false }), getUsage: async () => ({ ok: true, detected: false }), reset() {},
});
clipboard.read = async () => [];
clipboard.write = async () => {};
clipboard.writeText = async () => {};
clipboard.clear = () => {};
const output = process.env.POME_WORKBENCH_SHOTS || path.join(__dirname, '../dist.noindex/workbench');
fs.mkdirSync(output, { recursive: true });
const errors = [], steps = [];
let credentials = [
  { id: 'credential-a', service: 'GitHub · Workbench demo', account: 'demo@example.invalid', passwordMask: '••••••••••', createdAt: Date.now() },
  { id: 'credential-b', service: 'NAS 开发环境 · Development workspace', account: 'local-demo', passwordMask: '••••••••••', createdAt: Date.now() },
];
let saveCalls = 0, failSave = true, holdCredentialList = false, releaseCredentialList = null, failAudioDelete = false;
const audioBytes = Buffer.alloc(44 + 8000 * 2 * 12);
audioBytes.write('RIFF', 0); audioBytes.writeUInt32LE(audioBytes.length - 8, 4); audioBytes.write('WAVEfmt ', 8);
audioBytes.writeUInt32LE(16, 16); audioBytes.writeUInt16LE(1, 20); audioBytes.writeUInt16LE(1, 22);
audioBytes.writeUInt32LE(8000, 24); audioBytes.writeUInt32LE(16000, 28); audioBytes.writeUInt16LE(2, 32);
audioBytes.writeUInt16LE(16, 34); audioBytes.write('data', 36); audioBytes.writeUInt32LE(audioBytes.length - 44, 40);
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
  if (channel === 'windows:list') return { items: [], error: null };
  if (channel === 'credentials:list') {
    if (holdCredentialList) return new Promise(resolve => { releaseCredentialList = () => { holdCredentialList = false; resolve({ok:true,secureStorage:true,items:credentials}); }; });
    return { ok: true, secureStorage: true, items: credentials };
  }
  if (channel === 'recordings:delete') return !failAudioDelete;
  if (channel === 'credentials:save') {
    saveCalls += 1;
    if (failSave) return { ok: false, error: 'save_failed' };
    const item = { ...args[0], id: 'created-in-workbench', password: undefined, passwordMask: '••••••••••', createdAt: Date.now() };
    credentials = [...credentials, item];
    return { ok: true, item };
  }
  if (channel === 'recordings:read') return { bytes: audioBytes, mimeType: 'audio/wav' };
  return listener(event, ...args);
});
const watchdog = setTimeout(() => { console.error('Workbench acceptance timed out', errors); app.exit(1); }, 120000);
let started = false;
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', detail => { if (detail.level === 'error' && !detail.message.includes('ERR_')) errors.push(detail.message); });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => { clearTimeout(watchdog); console.log('Workbench: six-page geometry, search, credential create/cancel/privacy, real playback controls, locales and reduced motion passed'); app.exit(0); })
      .catch(async error => { console.error(error, errors);try{fs.writeFileSync(path.join(output, 'failure.png'),(await contents.capturePage()).toPNG());console.error(await contents.executeJavaScript('({hidden:document.hidden,focus:document.hasFocus(),active:document.activeElement?.id,clicks:window.workbenchClicks})'));}catch{}app.exit(1); });
  });
});

async function run(c) {
  const js = code => c.executeJavaScript(code, true);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(expression) {
    for (let i = 0; i < 250; i += 1) { if (await js(expression).catch(() => false)) return; await sleep(20); }
    throw new Error('Timeout: ' + expression);
  }
  async function pointer(x, y) {
    c.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    c.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    c.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await sleep(80);
  }
  async function click(selector, fraction = .5) {
    const point = await js(`(() => { const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width*${fraction},y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,hittable:!!hit&&(hit===e||e.contains(hit))};})()`);
    assert.equal(point.hittable, true, selector + ' is visible and directly clickable; ' + JSON.stringify(await js('({isExpanded,modeBusy,tab:activeTab,app:document.getElementById("app").className})')));
    await pointer(point.x, point.y);
  }
  async function key(keyCode) { c.sendInputEvent({ type: 'keyDown', keyCode }); c.sendInputEvent({ type: 'keyUp', keyCode }); await sleep(80); }
  async function capture(name) {
    await js('document.fonts.ready'); await sleep(150);
    fs.writeFileSync(path.join(output, name + '.png'), (await c.capturePage()).toPNG());
  }
  async function tab(name) {
    await js(`setActiveTab(${JSON.stringify(name)})`);
    await until(`activeTab===${JSON.stringify(name)} && !tabBusy && document.getElementById('tab-${name}').classList.contains('active')`);
    await js(`Promise.all(document.getElementById('tab-${name}').getAnimations().map(a=>a.finished.catch(()=>{})))`);
  }
  await until('!!window.NotchWorkspace && !workspaceReloadPending');
  // This suite controls native hide/show to test privacy and page geometry.
  // Native blur may otherwise begin a normal collapse midway through those
  // controlled steps; focus/collapse behavior is covered by the lifecycle suites.
  BrowserWindow.fromWebContents(c).removeAllListeners('blur');
  BrowserWindow.fromWebContents(c).show();
  BrowserWindow.fromWebContents(c).focus();
  await js('setMode(true)'); await until('!modeBusy');
  await js(`document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);`);
  await js(`(() => {
    const now=Date.now();
    for(const priority of PRIORITIES)data[priority]=Array.from({length:priority==='P0'?24:5},(_,i)=>({id:priority+'-'+i,text:i===0?'长内容验收 · A deliberately long task title that must preserve its deadline and available actions without escaping the workspace':'工作台验收任务 '+(i+1),done:i===3,createdAt:now-i*3600000,deadline:i%2===0?new Date(now+86400000).toISOString():'',remindedAt:0}));
    saveData(data);renderTodoBoard();
    const notes=Array.from({length:12},(_,i)=>({id:'workbench-note-'+i,title:i===0?'Pome 的下一步 · Working at your own pace':'项目记录 '+i,content:i===0?'# 内容在中央\\n\\n随手记录，按需整理。\\n\\n'+Array.from({length:22},(_,j)=>'## 记录 '+(j+1)+'\\n\\nLong text stays inside a calm reading surface.').join('\\n\\n'):i===1?'# 项目记录 1\\n\\n保留原始 Markdown 标题。':i===2?'# [项目记录 2](https://example.invalid/reference)\\n\\n链接标题保持可用。':'项目资料与下一步行动。',createdAt:now-i*86400000,updatedAt:now-i*86400000}));
    document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{
      notes:{home:'',archive:notes},
      links:[{id:'workbench-links',name:'项目参考 · Reference material',links:Array.from({length:12},(_,i)=>({id:'link-'+i,title:i===0?'Long reference title · 项目资料与本轮设计评审的详细参考说明':'项目资料 '+i,url:'https://example.invalid/reference/'+i,createdAt:now}))}],
      recordings:[{id:'recording-a',title:'改版讨论 · Workbench review',transcript:'保留真实媒体状态与完整转写内容。\\n\\n'+Array.from({length:15},(_,i)=>'讨论记录 '+i+'：内容优先，操作保持清楚。').join('\\n'),durationMs:12000,createdAt:now,audioPath:'recordings/workbench-a.wav',mimeType:'audio/wav'},{id:'recording-b',title:'第二段录音 · Another recording',transcript:'用于验证切换录音时释放旧播放器。',durationMs:12000,createdAt:now-3600000,audioPath:'recordings/workbench-b.wav',mimeType:'audio/wav'}]
    }}));
    selectedNoteId='workbench-note-0';notesDetailMode='preview';
    window.workbenchClicks=[];document.addEventListener('click',event=>workbenchClicks.push({id:event.target.id,tag:event.target.tagName,cls:event.target.className}),true);window.workbenchRevoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{workbenchRevoked.push(url);revoke(url)};
  })()`);
  const bounds = BrowserWindow.fromWebContents(c).getBounds();
  const geometries = [];
  for (const locale of ['zh-CN', 'en-US', 'de-DE']) {
    await js(`notchAPI.setLanguage(${JSON.stringify(locale)})`);
    await until(`document.documentElement.lang===${JSON.stringify(locale)}`);
    for (const name of ['todo', 'notes', 'links', 'recordings', 'credentials', 'settings']) {
      await tab(name);
      const geometry = await js(`(() => { const p=document.getElementById('tab-${name}'),r=p.getBoundingClientRect();return {width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1||p.scrollWidth>p.clientWidth+1,visible:!p.inert&&p.getAttribute('aria-hidden')==='false'};})()`);
      assert.equal(geometry.visible, true, locale + ' ' + name + ' is active');
      assert.equal(geometry.overflow, false, locale + ' ' + name + ' has no horizontal overflow');
      assert.equal(BrowserWindow.fromWebContents(c).getBounds().width, bounds.width, 'tab changes keep the native window width');
      assert.equal(BrowserWindow.fromWebContents(c).getBounds().height, bounds.height, 'tab changes keep the native window height');
      geometries.push({ locale, tab: name, ...geometry });
      await capture(locale + '-' + name);
    }
  }
  assert(geometries.every(g => Math.abs(g.width - geometries[0].width) < 1 && Math.abs(g.height - geometries[0].height) < 1), 'all page content rectangles share one geometry: '+JSON.stringify(geometries));
  steps.push('six pages retain fixed geometry with long content in Chinese, English and German');
  await tab('notes'); await click('#notes-search');
  await js(`{const s=document.getElementById('notes-search');s.value='Working at your own pace';s.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await until('document.querySelectorAll("#notes-list [data-note-id]").length===1');
  assert.equal(await js('document.activeElement.id'), 'notes-search', 'search stays focused while results update');
  await js(`{const s=document.getElementById('notes-search');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));}`);
  steps.push('notes search is directly clickable and updates results without losing focus');
  await click('#notes-list [data-note-id="workbench-note-1"]');
  await until('!!document.querySelector("#notes-preview h1")');
  assert.equal(await js('document.querySelector("#notes-preview h1").hidden'), true, 'preview avoids repeating the matching document title');
  await click('#notes-preview');
  assert.equal(await js('document.getElementById("notes-editor").value.startsWith("# 项目记录 1")'), true, 'editing retains the original Markdown heading');
  await click('.notes-save');
  await js(`{window.workbenchNoteEditor=document.getElementById('notes-editor');const t=document.querySelector('.notes-detail-title');t.value='更名后的项目记录';t.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.equal(await js('document.querySelector("#notes-preview h1").hidden'), false, 'a distinct content heading remains visible after rename');
  assert.equal(await js('document.querySelector(".notes-document-heading").getAttribute("aria-label")'), '更名后的项目记录', 'the accessible document heading follows the visible title');
  assert.equal(await js('document.getElementById("notes-editor")===workbenchNoteEditor'), true, 'renaming retains the current editor node');
  await js('document.querySelector("#notes-list [data-note-id=workbench-note-2]").scrollIntoView({block:"nearest"})');
  await click('#notes-list [data-note-id="workbench-note-2"]');
  await until('!!document.querySelector("#notes-preview h1 a[data-note-href]")');
  assert.equal(await js('document.querySelector("#notes-preview h1").hidden'), false, 'a linked matching heading is preserved');
  await js('document.querySelector("#notes-preview h1 a[data-note-href]").focus()');
  assert.equal(await js('document.activeElement===document.querySelector("#notes-preview h1 a[data-note-href]")'), true, 'the linked content heading stays keyboard-focusable');
  steps.push('note title deduplication is preview-only and distinct content headings remain visible');

  await tab('credentials');
  const library = await js(`(() => {const f=document.querySelector('.credentials-form-card').getBoundingClientRect(),l=document.querySelector('.credentials-library').getBoundingClientRect();return {form:f.width,library:l.width,gap:l.left-f.right};})()`);
  assert(library.form > 200 && library.form < library.library && library.gap >= 10, 'credential form and library use separate narrow/wide cards');
  const open = async () => { await click('#credential-service'); assert.equal(await js('document.activeElement.id'), 'credential-service'); };
  const fillAndReveal = async () => {
    await js(`document.getElementById('credential-service').value='Unsaved workbench draft';document.getElementById('credential-account').value='demo@example.invalid';document.getElementById('credential-password').value='fixture-only-secret';`);
    await click('.credentials-form-card [data-credential-reveal]');
    assert.equal(await js('document.getElementById("credential-password").type'), 'text');
  };
  const masked = async label => {
    assert.equal(await js('document.getElementById("credential-password").type'), 'password', label + ' re-masks the password');
    assert.equal(await js('document.querySelector(".credentials-form-card [data-credential-reveal]").getAttribute("aria-pressed")'), 'false');
    assert.equal(await js('document.getElementById("credential-service").value'), 'Unsaved workbench draft', label + ' preserves the unsaved draft');
    assert.equal(saveCalls, 0, label + ' never saves');
  };
  await open(); await fillAndReveal(); await key('Escape'); c.send('key:escape'); await masked('Escape');
  assert.equal(await js('isExpanded'), true, 'duplicate Escape masks the password without collapsing the panel');
  await open(); await fillAndReveal(); BrowserWindow.fromWebContents(c).hide();
  await until('document.documentElement.dataset.windowVisible === "false" && document.getElementById("credential-password").type === "password"');
  await masked('Native hide'); BrowserWindow.fromWebContents(c).show();
  await until('document.documentElement.dataset.windowVisible === "true"');
  await open(); await fillAndReveal(); await tab('notes'); await masked('Tab change');
  await tab('credentials'); await open(); await fillAndReveal(); await js('setMode(false)'); await until('!modeBusy'); await masked('Collapse');
  await js('setMode(true)'); await until('!modeBusy'); await tab('credentials');
  steps.push('credential form stays in the left card; navigation and collapse preserve drafts and re-mask passwords');
  await open(); await click('#credential-save'); await until('!document.getElementById("credential-save").disabled');
  assert.equal(saveCalls, 1); assert.equal(await js('document.querySelector(".credentials-form-card").isConnected'), true, 'failed save keeps the form available');
  assert.equal(await js('document.getElementById("credential-password").value'), 'fixture-only-secret', 'failed save preserves the submitted password');
  failSave = false;
  await click('#credential-save'); await until('!document.getElementById("credential-save").disabled');
  assert.equal(saveCalls, 2); await until('document.querySelectorAll(".credential-item").length===3');
  assert.equal(await js('document.getElementById("credential-password").type'), 'password');
  assert.equal(await js('document.getElementById("credential-password").value'), '', 'successful save clears the secret draft');
  await js('window.NotchUi?.clearError?.("credentials")');
  steps.push('failed create stays editable; successful create clears its secret while keeping the left form available');
  await open(); await fillAndReveal(); holdCredentialList = true;
  await click('#credential-save'); await until('document.getElementById("credential-password").value === ""');
  assert(releaseCredentialList,'post-save list read is held');
  await js(`document.getElementById('credential-service').value='New draft during refresh';document.getElementById('credential-password').value='new-fixture-secret'`);
  releaseCredentialList(); await sleep(100);
  assert.equal(await js('document.querySelector(".credentials-form-card").isConnected'),true,'list refresh preserves the form');
  assert.equal(await js('document.getElementById("credential-password").value'),'new-fixture-secret');
  await capture('audit-fresh-draft');await js('document.getElementById("credential-password").type="password"');


  await tab('recordings');
  await click('.recording-item[data-id="recording-a"]');
  await until('document.querySelector(".recording-audio audio")?.readyState>=2 && !document.querySelector(".recording-player-seek").disabled');
  await js('window.workbenchAudio=document.querySelector(".recording-audio audio");window.workbenchAudioUrl=workbenchAudio.src');
  assert.equal(await js('document.querySelector(".recording-player-duration").textContent'), '00:12');
  await click('[data-player-action="toggle"]'); await until('!workbenchAudio.paused && workbenchAudio.currentTime>0');
  assert.equal(await js('document.querySelector("[data-player-action=toggle]").getAttribute("aria-pressed")'), 'true');
  await click('[data-player-action="toggle"]'); await until('workbenchAudio.paused');
  await js('document.querySelector("[data-player-action=toggle]").focus()');await key('Space');
  assert.equal(await js('isExpanded'),true,'Space activates the focused player button without collapsing the panel');
  await until('!workbenchAudio.paused');
  await key('Space');await until('workbenchAudio.paused');
  await click('.recording-player-seek', .65);
  assert.equal(await js('workbenchAudio.currentTime>workbenchAudio.duration*.35 && workbenchAudio.currentTime<workbenchAudio.duration*.9'), true, 'pointer seeking changes the real audio position');
  const beforeKey = await js('workbenchAudio.currentTime');
  await key('Right');
  assert(await js('workbenchAudio.currentTime') > beforeKey, 'the seek range supports keyboard adjustment');
  await js(`document.querySelector('[data-player-action="mute"]').addEventListener('pointerdown',event=>{
    workbenchAudio.dispatchEvent(new Event('timeupdate'));
    window.workbenchMuteTargetPreserved=event.target.isConnected;
  },{once:true})`);
  await click('[data-player-action="mute"]');
  assert.equal(await js('workbenchMuteTargetPreserved'), true, 'media refresh preserves the pressed icon until pointerup');
  assert.equal(await js('workbenchAudio.muted'), true);
  assert.equal(await js('document.querySelector("[data-player-action=mute]").getAttribute("aria-pressed")'), 'true');
  await click('[data-player-action="mute"]'); assert.equal(await js('workbenchAudio.muted'), false);
  await js(`{const rate=document.querySelector('.recording-player-rate');rate.value='1.5';rate.dispatchEvent(new Event('change',{bubbles:true}));}`);
  assert.equal(await js('workbenchAudio.playbackRate'), 1.5, 'changing playback speed updates the real media rate');
  await capture('recording-player-controls');
  await click('.recording-item[data-id="recording-b"]'); await until('document.querySelector(".recording-audio audio")?.readyState>=2');
  assert.equal(await js('!workbenchAudio.isConnected && !workbenchAudio.getAttribute("src") && workbenchAudio.paused && workbenchRevoked.includes(workbenchAudioUrl)'), true, 'selecting another recording releases the old media element and URL');
  steps.push('custom player controls real audio playback, seek, keyboard seek and mute; switching recordings releases the old media');
  failAudioDelete = true;
  const beforeDelete = await js('JSON.stringify(getWorkspaceSnapshotForSync().recordings)');
  await click('.recording-item[data-id="recording-b"] .recording-item-delete');
  await until('document.getElementById("content-delete-confirm").open');await click('#content-delete-apply');await sleep(120);
  assert.equal(await js('JSON.stringify(getWorkspaceSnapshotForSync().recordings)'),beforeDelete,'failed file deletion preserves audio metadata and transcript');
  assert.equal(await js('document.querySelector(".ui-error-bar")?.hidden===false'),true);
  await capture('audit-delete-failure');
  await click('.ui-error-bar > button:first-of-type');await until('document.getElementById("content-delete-confirm").open');
  await click('#content-delete-cancel');
  assert.equal(await js('JSON.stringify(getWorkspaceSnapshotForSync().recordings)'),beforeDelete,'repair still requires confirmation');
  failAudioDelete = false;
  await click('.ui-error-bar > button:first-of-type');await until('document.getElementById("content-delete-confirm").open');await click('#content-delete-apply');
  await until(`!document.querySelector('.recording-item[data-id="recording-b"]')`);
  assert.equal(await js('document.querySelector(".ui-error-bar").hidden'),true,'successful retry clears its stale deletion error');

  c.debugger.attach('1.3');
  await c.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await js('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
  await tab('credentials'); await open(); await js('document.getElementById("credential-password").type="password"');
  await until('!document.getElementById("credential-save").disabled');
  await tab('notes'); await capture('reduced-motion');
  assert.equal(await js('document.getAnimations().some(a=>a.playState==="running" && a.effect?.target?.closest?.(".tab-panel.active"))'), false, 'the active workbench page does not keep animating under reduced motion');
  steps.push('reduced motion retains usable navigation and form controls without persistent page animations');
  const contentBeforeResize = await js('JSON.stringify({todos:data,workspace:getWorkspaceSnapshotForSync()})');
  const responsive = [];
  for (const [width,height] of [[900,638],[740,638],[740,500]]) {
    BrowserWindow.fromWebContents(c).setContentSize(width,height);await sleep(180);
    for (const name of ['todo','notes','links','recordings','credentials','settings']) {
      await tab(name);
      const result = await js(`(() => {
        const panel=document.getElementById('tab-${name}');
        const selectors={todo:'#todo-add-category',notes:'#notes-search',links:'#link-add',recordings:'#recording-new',credentials:'#credential-save',settings:'.settings-auto-launch-row'};
        const target=panel.querySelector(selectors['${name}']);target?.scrollIntoView({block:'nearest',inline:'nearest'});
        const r=target?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const cards=[...panel.querySelectorAll('.settings-column > .settings-card')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
        const cardsOverlap=cards.some((a,i)=>cards.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2));
        return {width:innerWidth,height:innerHeight,cardsOverlap,overflow:document.documentElement.scrollWidth>innerWidth+1||panel.scrollWidth>panel.clientWidth+1,actionVisible:!!r&&r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,hittable:!!hit&&(hit===target||target.contains(hit))};
      })()`);
      assert.equal(result.overflow,false,`${width}×${height} ${name} stays inside the viewport`);
      assert.equal(result.cardsOverlap,false,`${width}×${height} ${name} content groups never overlap`);
      assert.equal(result.actionVisible,true,`${width}×${height} ${name} primary action is reachable`);
      assert.equal(result.hittable,true,`${width}×${height} ${name} primary action can receive input`);
      responsive.push({tab:name,...result});
      if(width===740)await capture(`${width}x${height}-${name}`);
    }
  }
  assert.equal(await js('JSON.stringify({todos:data,workspace:getWorkspaceSnapshotForSync()})'),contentBeforeResize,'responsive layout changes never alter workspace content');
  steps.push('900px and 740px widths plus a 500px-high viewport retain reachable primary actions without changing content');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ steps, geometries, responsive, errors, sampleData: true, isolated: true }, null, 2));
}
require('../main.js');
