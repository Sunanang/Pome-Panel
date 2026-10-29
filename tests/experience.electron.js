'use strict';
// Production renderer + native WebM, isolated data, fake mic/camera, no real accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain,clipboard}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA||fs.mkdtempSync(path.join(os.tmpdir(),'pome-experience-'));
process.env.TODO_TEST_USER_DATA=profile;process.env.POME_HOOK_TEST_HOME=path.join(profile,'hook-home');process.env.POME_TEST_LANGUAGE='zh-CN';
fs.mkdirSync(process.env.POME_HOOK_TEST_HOME,{recursive:true});
app.commandLine.appendSwitch('user-data-dir',profile);app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});
require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_no_auth'});
require('../codex-usage-remote').createCodexUsageService=()=>({tokenState:()=>({manualTokenInvalid:false}),getUsage:async()=>({ok:true,detected:false}),reset(){}});
clipboard.read=async()=>[];clipboard.write=async()=>{};clipboard.writeText=async()=>{};clipboard.clear=()=>{};
let pairCalls=0;const external=[];require('electron').shell.openExternal=async url=>{external.push(url);};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,(e,...args)=>{
  if(channel==='windows:list')return {items:[],error:null};
  if(channel==='links:inspect')return {ok:true,title:'Reference example',url:args[0]};
  if(channel==='credentials:list')return {ok:true,secureStorage:true,items:[]};
  if(channel==='sync:pair-claim'){pairCalls++;return {ok:false,error:'fixture_offline'};}
  if(channel==='shell:openExternal'){external.push(args[0]);return true;}
  return fn(e,...args);
});
const output=process.env.POME_EXPERIENCE_SHOTS||path.join(__dirname,'../dist.noindex/experience');fs.mkdirSync(output,{recursive:true});
let started=false;const errors=[],checks=[];
const watchdog=setTimeout(()=>{console.error('Experience timeout',errors);app.exit(1);},90000);
app.on('web-contents-created',(_,c)=>{
 c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message);});
 c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
 run(c).then(()=>{clearTimeout(watchdog);fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));console.log('Experience acceptance passed:',checks.join(', '));app.exit(0);}).catch(async e=>{console.error(e,errors);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG());}catch{}app.exit(1);});});
});
async function run(c){
 const win=BrowserWindow.fromWebContents(c),js=s=>c.executeJavaScript(s,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(s){for(let i=0;i<250;i++){if(await js(s).catch(()=>false))return;await sleep(20);}throw Error('Timeout '+s);}
 async function click(s){const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Missing '+${JSON.stringify(s)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,hit:h===e||e.contains(h)}})()`);assert(r.hit,'hittable '+s);c.sendInputEvent({type:'mouseMove',x:Math.round(r.x),y:Math.round(r.y)});c.sendInputEvent({type:'mouseDown',x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});c.sendInputEvent({type:'mouseUp',x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});await sleep(90);}
 async function key(keyCode,modifiers=[]){c.sendInputEvent({type:'keyDown',keyCode,modifiers});c.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(90);}
 async function type(s,text){await click(s);c.selectAll();await sleep(30);await key('Backspace');if(text)c.insertText(text);await sleep(40);}
 async function tab(id){await click('#tab-button-'+id);await until(`activeTab==='${id}'&&!tabBusy`);await sleep(180);}
 async function shot(id){await js('document.fonts.ready');await sleep(160);fs.writeFileSync(path.join(output,id+'.png'),(await c.capturePage()).toPNG());}
 await until('!!window.PomeExperience && !workspaceReloadPending');win.removeAllListeners('blur');win.show();win.focus();
 await js('setMode(true)');await until('!modeBusy');
 for(const locale of ['zh-CN','en-US']) {
   await js(`notchAPI.setLanguage('${locale}')`);await until(`document.documentElement.lang==='${locale}'`);await sleep(100);
   const hint=await js(`(()=>{const e=document.querySelector('#ui-capsule-hint'),r=e.getBoundingClientRect(),t=e.querySelector('span').getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect();return {shown:!e.hidden,aligned:Math.abs(t.left-b.left)<1,gap:b.top-t.bottom,inside:b.bottom<=r.bottom-8,crop:{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}}})()`);
   assert(hint.shown&&hint.aligned&&hint.gap>=9&&hint.inside,'capsule hint has aligned copy/action and a visible vertical gap');
   fs.writeFileSync(path.join(output,'capsule-hint-'+locale+'.png'),(await c.capturePage(hint.crop)).toPNG());
 }
 await js('notchAPI.setLanguage("zh-CN")');await until('document.documentElement.lang==="zh-CN"');
 checks.push('capsule help copy/action alignment and spacing in both languages');
 await js(`document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);notchAPI.setFeature('clip',true)`);
 await tab('home');
 // Native button hit testing is necessary: a visible icon can still be covered.
 await click('#record-start');await until('NotchWorkspace.isRecordingActive()');await sleep(2200);await click('#record-pause');
 await tab('recordings');assert.match(await js("document.querySelector('.recording-detail').innerText"),/已暂停/);assert.doesNotMatch(await js("document.querySelector('.recording-detail').innerText"),/仍在录制/);
 await shot('recording-paused-zh');await tab('home');await click('#record-stop');await until('!NotchWorkspace.isRecordingActive()');assert.equal(await js('activeTab'),'home','stop does not navigate to the library');
 await click('#ui-open-recordings');await until('activeTab==="recordings"&&!tabBusy');await until('!!document.querySelector(".recording-player audio") && document.querySelector("audio").readyState>=2');
 assert.equal(await js('document.querySelector(".recording-player-seek").disabled'),false,'native WebM can seek before playback');
 assert.notEqual(await js('document.querySelector(".recording-player-duration").textContent'),'—:—');
 await click('.recording-player-toggle');await sleep(120);await js(`{const r=document.querySelector('.recording-player-seek');r.value='1.5';r.dispatchEvent(new Event('input',{bubbles:true}));}`);
 await until('document.querySelector("audio").currentTime>=1.4');await click('.recording-player-toggle');await shot('webm-player-zh');checks.push('native WebM duration/play/seek and independent stop button');
 await click('#recording-configure');await click('.transcription-advanced summary');await sleep(100);await type('#transcription-workspace','draft-workspace');await key('Escape');assert.equal(await js('isExpanded'),true);assert.equal(await js('document.querySelector("#transcription-settings-backdrop").hidden'),true);assert.equal(await js('document.activeElement.id'),'recording-configure');checks.push('transcription Esc restores focus');
 await tab('todo');const before=await js('JSON.stringify(data)');await click('.todo-deadline-trigger');await key('Escape');assert.equal(await js('isExpanded'),true);assert.equal(await js('document.querySelector("#todo-date-popover").hidden'),true);assert.equal(await js('JSON.stringify(data)'),before,'preview/escape never modifies tasks');checks.push('date Esc and no-op preview');
 await tab('settings');await click('#settings-shortcut-change');await key('Escape');assert.equal(await js('isExpanded'),true);assert.equal(await js('document.querySelector("#shortcut-recorder").hidden'),true);checks.push('shortcut Esc cancels without collapsing');
 await js(`document.querySelector('#ui-nas-troubleshoot').open=true;NotchUi.clearError();`);await type('#settings-nas-sync-base-url','');await type('#settings-nas-pair-code','');await click('#settings-nas-pair-submit');
 assert.equal(pairCalls,0);assert.equal(await js('document.activeElement.id'),'settings-nas-sync-base-url');assert.equal(await js('document.querySelector("#ui-error-bar").hidden'),true);assert.match(await js('document.querySelector("#settings-nas-sync-hint").textContent'),/六位/);await shot('nas-validation-zh');checks.push('NAS field validation without network or persistent error');
 await js(`document.querySelector('#experience-backup').scrollIntoView({block:'start'})`);await shot('backup-entry-zh');
 await tab('links');const count=await js('document.querySelectorAll(".link-row").length');await type('#link-add','not a url');await key('Enter');assert.equal(await js('document.querySelectorAll(".link-row").length'),count);assert.equal(await js('document.querySelector("#links-status").hidden'),false);
 await type('#link-add','example.com');await key('Enter');await until('document.querySelector("#link-groups").innerText.includes("Reference example")');await type('#links-search','absent-fixture');assert.match(await js('document.querySelector("#link-groups").innerText'),/没有匹配/);await type('#links-search','');checks.push('invalid link rejected, valid link metadata, search empty/recovery');
 await js(`document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{clipboard:{history:[{id:'one',type:'text',text:'Search target sample',timestamp:Date.now()},{id:'two',type:'text',text:'Other text',timestamp:Date.now()-1}],favorites:['one']}}}));`);
 await tab('clip');await type('#clip-search','target');assert.equal(await js('document.querySelectorAll(".clip-item").length'),1);await click('#clip-clear-btn');await until('document.querySelector("#content-delete-confirm").open');
 assert.match(await js('document.querySelector("#content-delete-message").textContent'),/2.*1/);await shot('clipboard-clear-scope-zh');await click('#content-delete-cancel');assert.equal(await js('clipHistory.length'),2);
 await click('#clip-clear-btn');await until('document.querySelector("#content-delete-confirm").open');await js(`clipHistory.push({id:'new-sync',type:'text',text:'Arrived while confirming',timestamp:Date.now()});`);await click('#content-delete-apply');assert.equal(await js('clipHistory.length'),3,'sync arriving during confirmation cancels destructive operation');
 await type('#clip-search','');await click('#clip-clear-btn');await click('#content-delete-apply');assert.equal(await js('clipHistory.length'),0);await js('notchAPI.setLanguage("en-US")');await until('document.documentElement.lang==="en-US"');assert.doesNotMatch(await js('document.querySelector(".clip-empty").textContent'),/[\u4e00-\u9fff]/);checks.push('clipboard search, full scope confirm, cancellation/sync race, locale cache');
 await tab('recordings');await click('#recording-configure');assert.equal(await js('document.querySelector("#transcription-language").value'),'zh');assert.equal(await js('document.querySelector("#transcription-region").value'),'beijing');
 const footer=await js(`(()=>{let e=document.querySelector('#transcription-settings-save'),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}})()`);assert(footer.top>0&&footer.bottom<footer.height,'English dialog footer visible');await shot('transcription-en');await js('document.querySelector("#transcription-region").value="singapore"');await click('#transcription-api-help');assert.match(external.at(-1),/ap-southeast-1/);await key('Escape');checks.push('locale change preserves recognition choices, English footer visible');
 // Reflow changes presentation, never the user's saved widget placement.
 await tab('home');await until('!document.querySelector("#ai-usage-empty").hidden');const layout=await js('localStorage.getItem(HOME_PLACEMENTS_KEY)'),bounds=win.getBounds();win.setMinimumSize(600,400);
 for(const width of [900,740]){win.setBounds({...bounds,width,height:500});await sleep(260);const info=await js(`(()=>{let b=document.querySelector('#home-bento');return {scroll:b.scrollHeight,height:b.clientHeight,ids:[...b.querySelectorAll('[data-home-module]:not([hidden])')].map(e=>e.dataset.homeModule)}})()`);assert(info.scroll>info.height);await js(`document.querySelector('#home-bento').scrollTop=0`);await shot('home-'+width+'-top-en');await js(`document.querySelector('#home-bento').scrollTop=9999`);await shot('home-'+width+'-en');await click('.ai-open-settings');assert.equal(await js('activeTab'),'settings');await tab('home');assert.equal(await js('localStorage.getItem(HOME_PLACEMENTS_KEY)'),layout);}
 win.setBounds(bounds);await sleep(200);await js(`document.querySelector('#home-bento').scrollTop=0`);await shot('home-en');
 const crop=await js(`(()=>{let r=document.querySelector('#home-cursor').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);fs.writeFileSync(path.join(output,'ai-settings-button-en.png'),(await c.capturePage(crop)).toPNG());
 await js('notchAPI.setLanguage("zh-CN")');await until('document.documentElement.lang==="zh-CN"');await sleep(100);fs.writeFileSync(path.join(output,'ai-settings-button-zh.png'),(await c.capturePage(crop)).toPNG());await click('.ai-open-settings');await tab('home');await js('notchAPI.setLanguage("en-US")');await until('document.documentElement.lang==="en-US"');
 checks.push('900/740 scrollable homepage preserves saved layout and localized settings actions remain clickable');
 await tab('settings');await js(`{const s=document.querySelector('#pome-interface-motion');s.value='reduce';s.dispatchEvent(new Event('change'));}`);assert.equal(await js('document.documentElement.classList.contains("experience-reduced-motion")'),true);
 await js(`{const s=document.querySelector('#pome-weather-unit');s.value='f';s.dispatchEvent(new Event('change'));}`);assert.equal(await js('localStorage.getItem("pome-weather-unit")'),'f');checks.push('local temperature and motion preferences');
 await tab('home');await js('setMode(false)');await until('!modeBusy');await js('setMode(true)');await until('!modeBusy');assert.equal(await js('document.querySelector("#shortcut-recorder").hidden'),true);assert.deepEqual(errors,[]);
}
require('../main');
