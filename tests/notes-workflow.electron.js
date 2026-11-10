'use strict';
// Production renderer + native WebM, isolated data, fake mic/camera, no real accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain,clipboard}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA||fs.mkdtempSync(path.join(os.tmpdir(),'pome-notes-'));
process.env.TODO_TEST_USER_DATA=profile;process.env.POME_HOOK_TEST_HOME=path.join(profile,'hook-home');process.env.POME_TEST_LANGUAGE='zh-CN';
fs.mkdirSync(process.env.POME_HOOK_TEST_HOME,{recursive:true});
app.commandLine.appendSwitch('user-data-dir',profile);app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});
require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_no_auth'});
require('../codex-usage-remote').createCodexUsageService=()=>({tokenState:()=>({manualTokenInvalid:false}),getUsage:async()=>({ok:true,detected:false}),reset(){}});
clipboard.read=async()=>[];clipboard.write=async()=>{};clipboard.writeText=async()=>{};clipboard.clear=()=>{};
let pairCalls=0,captureMode='',releaseCapture;const external=[];require('electron').shell.openExternal=async url=>{external.push(url);};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,(e,...args)=>{
  if(channel==='notes:capture-module'&&captureMode==='hold')return new Promise(resolve=>{releaseCapture=resolve});
  if(channel==='notes:capture-module'&&captureMode==='fail')return null;
  if(channel==='windows:list')return {items:[],error:null};
  if(channel==='links:inspect')return {ok:true,title:'Reference example',url:args[0]};
  if(channel==='credentials:list')return {ok:true,secureStorage:true,items:[]};
  if(channel==='sync:pair-claim'){pairCalls++;return {ok:false,error:'fixture_offline'};}
  if(channel==='shell:openExternal'){external.push(args[0]);return true;}
  return fn(e,...args);
});
const output=process.env.POME_NOTES_SHOTS||path.join(__dirname,'../dist.noindex/notes-workflow');fs.mkdirSync(output,{recursive:true});
let started=false;const errors=[],checks=[];
const watchdog=setTimeout(()=>{console.error('Notes workflow timeout',errors);app.exit(1);},90000);
app.on('web-contents-created',(_,c)=>{
 c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message);});
 c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
 run(c).then(()=>{clearTimeout(watchdog);fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));console.log('Notes workflow acceptance passed:',checks.map(c=>typeof c==='string'?c:Object.keys(c).join('/')).join(', '));app.exit(0);}).catch(async e=>{console.error(e,errors);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG());}catch{}app.exit(1);});});
});
async function run(c){
 const win=BrowserWindow.fromWebContents(c),js=s=>c.executeJavaScript(s,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(s){for(let i=0;i<300;i++){if(await js(s).catch(()=>false))return;await sleep(20);}throw Error('Timeout '+s);}
 async function click(s){const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Missing '+${JSON.stringify(s)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,hit:h===e||e.contains(h)}})()`);assert(r.hit,'hittable '+s);c.sendInputEvent({type:'mouseMove',x:Math.round(r.x),y:Math.round(r.y)});c.sendInputEvent({type:'mouseDown',x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});c.sendInputEvent({type:'mouseUp',x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});await sleep(50);if(s==='#note-save-btn')await until('!noteInput.readOnly');}
 async function key(keyCode,modifiers=[]){c.sendInputEvent({type:'keyDown',keyCode,modifiers});c.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(50);}
 async function tab(id){await js(`setActiveTab('${id}')`);await until(`activeTab==='${id}'&&!tabBusy`);await sleep(180);}
 async function input(s,text){await js(`(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
 async function shot(id){await js('document.fonts.ready');await sleep(100);fs.writeFileSync(path.join(output,id+'.png'),(await c.capturePage()).toPNG());}
 c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await until('!!window.NotchWorkspace&&!workspaceReloadPending');win.removeAllListeners('blur');win.show();win.focus();await js('setMode(true)');await until('!modeBusy');await js("document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false)");
 const nl='\n',body=Array.from({length:18},(_,i)=>['## 第 '+(i+1)+' 节','',('这是一段 **加粗** 与普通正文，保持阅读位置。').repeat(5),'','- 第一项','- 第二项','','```js','const value = 42;','```',''].join(nl)).join(nl);
 await js(`applyWorkspaceNotes({home:'',archive:[{id:'long',title:'长文位置验收',content:${JSON.stringify(body)},createdAt:1,updatedAt:1},{id:'other',title:'另一个笔记',content:${JSON.stringify('# Another note\n\n[Open reference](https://example.invalid/reference)')},createdAt:2,updatedAt:2}]});selectedNoteId='long';renderNotesLibrary()`);
 await tab('notes');assert.equal(await js('notesDetailMode'),'preview');assert.equal(await js('document.querySelectorAll("[data-notes-mode],[data-note-mode]").length'),0);
 assert.equal(await js('document.querySelectorAll(".notes-rename").length'),0,'no separate rename button');
 await click('.notes-detail-title');c.selectAll();c.insertText('长文位置验收 · 直接改名');
 await until('loadNoteArchive().find(n=>n.id==="long").title==="长文位置验收 · 直接改名"');
 assert.equal(await js('notesDetailMode'),'preview','editing the title keeps the body in preview');
 checks.push('native title input renames directly without a separate button or changing body mode');
 const positions=[];
 for(const selector of ['h2','p','ul','pre']){
   await js(`(()=>{const p=document.querySelector('#notes-preview'),e=p.querySelectorAll('${selector}')[7];e.dataset.anchor='yes';p.scrollTop+=e.getBoundingClientRect().top-p.getBoundingClientRect().top-24;})()`);
   const before=await js('PomeNoteView.capturePreview(document.querySelector("#notes-preview"))');
   if(selector==='h2')await shot('01-notes-preview');
   await click('[data-anchor=yes]');assert.equal(await js('notesDetailMode'),'edit');assert.equal(await js("getComputedStyle(document.querySelector('#notes-editor')).outlineStyle"),'none','editor has no blue focus frame');
   const editY=await js(`(()=>{const e=document.querySelector('#notes-editor'),m=PomeNoteView.mirror(e);try{return m.rectAt(${before.offset}).top-m.bounds.top-e.scrollTop}finally{m.destroy()}})()`);
   assert(Math.abs(editY-before.y)<2,selector+' preview→edit preserves visible glyph');
   if(selector==='h2')await shot('02-notes-edit');
   await click('.notes-save');assert.equal(await js('notesDetailMode'),'preview');
   const after=await js('PomeNoteView.capturePreview(document.querySelector("#notes-preview"))');
   assert.equal(after.offset,before.offset,selector+' returns same first glyph');assert(Math.abs(after.y-before.y)<2,selector+' edit→preview stays in place '+JSON.stringify({before,editY,after}));
   positions.push({selector,before,editY,after});if(selector==='h2')await shot('03-notes-saved');
 }
 checks.push({positionTransfers:positions});
 const scroll=await js('document.querySelector("#notes-preview").scrollTop');
 await click('[data-note-id="other"]');await click('#notes-preview a');assert.equal(await js('notesDetailMode'),'preview');assert.equal(external.at(-1),'https://example.invalid/reference');
 await click('[data-note-id="long"]');assert(Math.abs(await js('document.querySelector("#notes-preview").scrollTop')-scroll)<2,'per-note reading position');
 await js('document.querySelector("#notes-preview").focus()');await key('Enter');assert.equal(await js('notesDetailMode'),'edit');
 await input('#notes-editor',body+'\n新输入');await sleep(350);assert.equal(await js('notesDetailMode'),'edit','autosave stays editing');assert.match(await js('loadNoteArchive().find(n=>n.id==="long").content'),/新输入/);
 await js("window.originalNotesEditor=document.querySelector('#notes-editor');renderNotesLibrary()");assert.equal(await js("originalNotesEditor===document.querySelector('#notes-editor')"),true);
 // Fail local persistence exactly once. No successful preview transition is allowed.
 await js("window.nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===NOTE_ARCHIVE_KEY)throw Error('fixture_write_failed');return nativeSet.call(this,k,v)};void 0");
 await click('.notes-save');assert.equal(await js('notesDetailMode'),'edit');assert.equal(await js('document.querySelector("#ui-error-bar").hidden'),false);
 await js('Storage.prototype.setItem=nativeSet;void 0');await key('s',[process.platform==='darwin'?'meta':'control']);assert.equal(await js('notesDetailMode'),'preview');checks.push('links, per-note position, autosave remains edit, retained editor, failed save/retry, keyboard Save');
 await tab('home');const draft='今天的项目随笔\n\n背景、标题、按钮和正文，整张随笔记一起收走。\n先收窄成漏斗，再吸入顶部笔记。';
 await input('#home-note',draft);await sleep(340);assert.equal(await js('noteMode'),'edit');assert.equal(await js('localStorage.getItem(NOTE_KEY)'),draft);await shot('04-home-draft');
 const material=await js(`(async()=>{const p=await PomeNoteFlight.prepare(noteInput),r=homeNote.getBoundingClientRect();window.genieExpectedMaterial=p.bitmap;if(!p.bitmap)return {missing:true};const b=p.bitmap,ctx=b.getContext('2d'),colors=new Set();for(let y=Math.floor(b.height*.64);y<b.height-12;y+=9)for(let x=20;x<b.width-20;x+=9){const a=ctx.getImageData(x,y,1,1).data;if(a[3]>0)colors.add([a[0],a[1],a[2]].join(','));}return {rect:p.rect,tile:{x:r.x,y:r.y,width:r.width,height:r.height},colors:colors.size,dataURL:b.toDataURL()}})()`);
 assert(!material.missing,'native module snapshot is available');assert(material.colors>30,'the detached background retains the original image texture');assert(Math.abs(material.rect.y-material.tile.y)<1&&Math.abs(material.rect.height-material.tile.height)<2,'snapshot includes the title, controls and full module');
 fs.writeFileSync(path.join(output,'00-whole-module-snapshot.png'),Buffer.from(material.dataURL.split(',')[1],'base64'));delete material.dataURL;checks.push({moduleMaterial:material});
 assert.equal(await js('notchAPI.captureNoteModule({x:0,y:0,width:-1,height:10})'),null,'invalid capture rectangles rejected');
 const outsider=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../preload.js'),contextIsolation:true,sandbox:true}});await outsider.loadURL('data:text/html,<html><body>Capture ownership fixture</body></html>');
 assert.match(await outsider.webContents.executeJavaScript(`notchAPI.captureNoteModule({x:0,y:0,width:100,height:100}).then(()=>'',e=>e.message)`),/workspace_owner_required/);outsider.destroy();
 await js("window.genieOriginalStart=PomeNoteFlight.start;PomeNoteFlight.start=function(p){window.genieLastBitmap=p?.bitmap;return genieOriginalStart(p)};void 0");
 const count=await js('loadNoteArchive().length');
 await click('#note-save-btn');assert.equal(await js('noteInput.value'),'');assert.equal(await js('activeTab'),'home');assert.equal(await js('loadNoteArchive().length'),count+1);assert.equal(await js('PomeNoteFlight.isActive()'),true);assert.equal(await js("document.querySelector('.note-flight').dataset.scope"),'module');await shot('05-flight-native-speed');
 const recall=await js(`(()=>{const a=genieExpectedMaterial,b=genieLastBitmap,A=a.getContext('2d').getImageData(0,0,a.width,a.height).data,B=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let expected=0,matched=0;for(let y=100;y<a.height*.55;y++)for(let x=20;x<a.width-20;x++){const i=(y*a.width+x)*4;if(A[i]>150&&A[i+1]>150&&A[i+2]>150){expected++;if(B[i]>110&&B[i+1]>110&&B[i+2]>110)matched++;}}return matched/expected})()`);assert(recall>.9,'flight contains the painted draft, not a stale empty module: '+recall);checks.push({foregroundRecall:recall});
 // Start another draft while the previous text is still travelling.
 await click('#home-note');c.insertText('下一条草稿');await until('!homeCollecting');await sleep(340);assert.equal(await js('noteInput.value'),'下一条草稿');assert.equal(await js('localStorage.getItem(NOTE_KEY)'),'下一条草稿');
 await js(`applyWorkspaceNotes({home:${JSON.stringify(draft)},archive:[]})`);assert.equal(await js('noteInput.value'),'下一条草稿');assert.equal(await js('loadNoteArchive().length'),1,'unacknowledged collection survives stale projection');
 await click('#note-save-btn');await until('!homeCollecting');await input('#home-note','第三条草稿');await sleep(340);
 const archive=await js('loadNoteArchive()');assert.equal(archive.length,2);
 await js(`applyWorkspaceNotes({home:${JSON.stringify(draft)},archive:[]})`);assert.equal(await js('loadNoteArchive().length'),2,'two offline collections survive');assert.equal(await js('noteInput.value'),'第三条草稿');
 await js(`applyWorkspaceNotes({home:'',archive:${JSON.stringify(archive)}})`);assert.equal(await js('localStorage.getItem(NOTE_COLLECTION_KEY)'),null,'acknowledged collections released');assert.equal(await js('noteInput.value'),'第三条草稿');
 checks.push('native 720ms whole-module Genie flight, immediate detach, new draft untouched, two offline collections and stale/acknowledged projections');
 // A partial multi-key write must roll the archive back and retain the draft.
 const oldArchive=await js('localStorage.getItem(NOTE_ARCHIVE_KEY)');
 await js("Storage.prototype.setItem=function(k,v){if(k===NOTE_KEY&&v==='')throw Error('fixture_partial_write');return nativeSet.call(this,k,v)};void 0");await click('#note-save-btn');assert.equal(await js('noteInput.value'),'第三条草稿');assert.equal(await js('localStorage.getItem(NOTE_ARCHIVE_KEY)'),oldArchive);assert.equal(await js('PomeNoteFlight.isActive()'),false);await js('Storage.prototype.setItem=nativeSet;void 0');
 await js("document.documentElement.classList.add('experience-reduced-motion')");await click('#note-save-btn');await until('!homeCollecting');assert.equal(await js('PomeNoteFlight.isActive()'),false);assert.equal(await js('noteInput.value'),'');await js("document.documentElement.classList.remove('experience-reduced-motion')");
 // Actual slowed frames reveal the curved funnel and whole-module absorption. Production duration stays 720ms.
 await input('#home-note',draft);await js("document.documentElement.style.setProperty('--note-flight-ms','1500')");await click('#note-save-btn');await sleep(100);await shot('06-flight-start-slow');await sleep(180);await shot('07-flight-middle-slow');assert(await js(`(()=>{const b=genieLastBitmap,c=b.getContext('2d');let white=0;for(let y=Math.floor(b.height*.8);y<b.height-10;y+=2)for(let x=20;x<b.width-20;x+=2){const p=c.getImageData(x,y,1,1).data;if(p[0]>150&&p[1]>150&&p[2]>150)white++;}return white<20})()`),'viewport toast is excluded from the flying module');await sleep(180);await shot('08-flight-tail-slow');await until('!homeCollecting');await js("document.documentElement.style.removeProperty('--note-flight-ms')");await shot('09-home-collected');
 await input('#home-note','resize cleanup');await click('#note-save-btn');await js("window.dispatchEvent(new Event('resize'))");await until('!homeCollecting');assert.equal(await js('PomeNoteFlight.isActive()'),false);
 await input('#home-note','collapse cleanup');await click('#note-save-btn');await js("document.dispatchEvent(new Event('notch:will-collapse'))");await until('!homeCollecting');assert.equal(await js('document.querySelector(".note-flight")'),null);
 await input('#home-note','tab cleanup');await click('#note-save-btn');await tab('notes');await until('!homeCollecting');assert.equal(await js('PomeNoteFlight.isActive()'),false);
 // Editing archived content never refills the home input.
 await js("document.querySelector('#notes-preview').focus()");await key('Enter');await input('#notes-editor','collected and edited');await click('.notes-save');await tab('home');assert.equal(await js('noteInput.value'),'');
 await js('notchAPI.setLanguage("en-US")');await until('document.documentElement.lang==="en-US"');assert.doesNotMatch(await js('statusToast.innerText'),/[\u4e00-\u9fff]/,'visible collection feedback follows locale');await input('#home-note','Recoverable English draft');await sleep(350);await tab('notes');await tab('home');assert.equal(await js('noteInput.value'),'Recoverable English draft');assert.equal(await js('noteMode'),'edit');await shot('10-home-english-draft');
 // Snapshot failure or timeout skips only decoration; saving still completes.
 captureMode='fail';await input('#home-note','capture unavailable');await click('#note-save-btn');await until('!homeCollecting');assert.equal(await js('noteInput.value'),'');assert.equal(await js('PomeNoteFlight.isActive()'),false);
 captureMode='hold';await input('#home-note','capture timeout');await click('#note-save-btn');await until('!homeCollecting');assert.equal(await js('noteInput.readOnly'),false);assert.equal(await js('document.documentElement.classList.contains("note-snapshotting")'),false);assert.equal(await js('noteInput.value'),'');assert(await js('loadNoteArchive().some(n=>n.content==="capture timeout")'));captureMode='';releaseCapture(null);await sleep(70);assert.equal(await js('PomeNoteFlight.isActive()'),false);checks.push('snapshot failure/timeout still saves and releases the input');
 // Native text selection keeps preview active instead of entering edit on mouse-up.
 await tab('notes');await js("selectedNoteId=loadNoteArchive().find(n=>n.content==='collected and edited').id;renderNotesLibrary()");
 const range=await js("(()=>{const r=document.querySelector('#notes-preview p').getBoundingClientRect();return {x:r.left+3,y:r.top+r.height/2}})()");
 c.sendInputEvent({type:'mouseDown',x:Math.round(range.x),y:Math.round(range.y),button:'left',clickCount:1});c.sendInputEvent({type:'mouseMove',x:Math.round(range.x+100),y:Math.round(range.y),button:'left'});c.sendInputEvent({type:'mouseUp',x:Math.round(range.x+100),y:Math.round(range.y),button:'left',clickCount:1});await sleep(70);
 assert.equal(await js('getSelection().isCollapsed'),false);assert.equal(await js('notesDetailMode'),'preview');await js('getSelection().removeAllRanges()');
 await click('#notes-new');assert.equal(await js('notesDetailMode'),'edit');await input('#notes-editor','New blank note becomes preview only after Save');await click('.notes-save');assert.equal(await js('notesDetailMode'),'preview');
 await tab('home');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await click('#note-save-btn');await until('!homeCollecting');assert.equal(await js('PomeNoteFlight.isActive()'),false);await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await input('#home-note','Persisted draft across renderer reload');await sleep(2300);await js('persistHomeNoteDraft()');c.reload();await until('!!window.NotchWorkspace&&!workspaceReloadPending&&typeof noteInput!=="undefined"&&noteInput?.value==="Persisted draft across renderer reload"');
 await js('setMode(true)');await until('!modeBusy');await tab('home');assert.equal(await js('noteMode'),'edit');assert.equal(await js('notePreview.hidden'),true);
 await js('applyWorkspaceNotes({home:JSON.parse(localStorage.getItem(NOTE_COLLECTION_KEY))[0].home,archive:[]})');assert.equal(await js('noteInput.value'),'Persisted draft across renderer reload','pending collections still guard stale projection after reload');
 checks.push('borderless editing, native whole-module material, capture ownership and bounds, partial-write rollback, system/manual reduced motion, resize/collapse/tab cleanup, independent home draft, English localization, native selection, new-note Save and draft recovery across reload');
 if(process.env.POME_NOTES_FRAMES){
  const frames=process.env.POME_NOTES_FRAMES;fs.mkdirSync(frames,{recursive:true});const timeline=[],images=[];
  await tab('home');await input('#home-note',draft);await js("document.documentElement.style.setProperty('--note-flight-ms','1500');dismissStatusToast(false)");await sleep(200);
  const capture=(_event,method,params)=>{
   if(method!=='Page.screencastFrame')return;
   void c.debugger.sendCommand('Page.screencastFrameAck',{sessionId:params.sessionId});
   const file=String(images.length).padStart(4,'0')+'.jpg';images.push(Buffer.from(params.data,'base64'));timeline.push({file,at:params.metadata.timestamp*1000});
  };
  c.debugger.on('message',capture);await c.debugger.sendCommand('Page.startScreencast',{format:'jpeg',quality:88,maxWidth:1240,maxHeight:638,everyNthFrame:1});await sleep(350);
  await js('saveHomeNote()');await until('!homeCollecting');await sleep(450);await c.debugger.sendCommand('Page.stopScreencast');c.debugger.removeListener('message',capture);
  images.forEach((buffer,i)=>fs.writeFileSync(path.join(frames,timeline[i].file),buffer));
  await js("document.documentElement.style.removeProperty('--note-flight-ms')");fs.writeFileSync(path.join(frames,'timeline.json'),JSON.stringify(timeline));assert(images.length>20,'continuous native animation frames');
 }
 assert.deepEqual(errors,[]);
}
require('../main');
