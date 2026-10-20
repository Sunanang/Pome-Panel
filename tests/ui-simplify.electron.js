'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,ipcMain,BrowserWindow}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA,restart=process.env.POME_UI_RESTART==='1';
const home=path.join(profile,'isolated-home');fs.mkdirSync(home,{recursive:true});process.env.POME_HOOK_TEST_HOME=home;process.env.POME_TEST_NOTIFICATIONS='1';
app.commandLine.appendSwitch('user-data-dir',profile);app.disableHardwareAcceleration();if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
if(restart){for(const name of ['.first-run-done','.ui-welcome-done'])fs.rmSync(path.join(profile,name),{force:true});const file=path.join(profile,'app-settings.json');const data=JSON.parse(fs.readFileSync(file,'utf8'));delete data.onboardingPending;fs.writeFileSync(file,JSON.stringify(data));}
const stamp=new Date().toISOString();
require('../cursor-usage').readAuthToken=()=>({ok:true,token:'fixture-local-cursor'});
require('../cursor-usage').fetchCursorUsage=async({manualToken}={})=>({ok:true,detected:true,configured:!!manualToken,authSource:manualToken?'manual':'local',auto:{percent:35},other:{percent:50},fetchedAt:stamp});
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:true,authSource:'local',updatedAt:stamp,primary:{percent:50}});
require('../codex-auth').readLocalCodexToken=async()=>({ok:true,token:'fixture-local-codex'});
require('../codex-usage-remote').createCodexUsageService=()=>({tokenState:()=>({manualTokenInvalid:false}),getUsage:async({manualToken}={})=>({ok:true,detected:true,configured:!!manualToken,authSource:manualToken?'manual':'local',updatedAt:stamp,primary:{percent:50}}),reset(){}});
let failSave=false;const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>originalHandle(channel,(event,...args)=>channel==='cursor:set-token'&&failSave?{ok:false,error:'secure_storage_unavailable'}:listener(event,...args));
require('../grokbot-usage').createGrokbotUsageService=()=>({getUsage:async()=>({ok:true,detected:false}),reset(){}});
let nativeError=true;
const adapters=require('../platform-adapters'),load=adapters.loadAdapter;adapters.loadAdapter=(...args)=>{const adapter=load(...args);adapter.windows.list=async()=>({items:[],error:nativeError?'native_unavailable':null});return adapter;};
const output=path.join(__dirname,'../dist.noindex/ui-simplify/flows');fs.mkdirSync(output,{recursive:true});
let started=false;const errors=[];const timer=setTimeout(()=>{console.error('Simplification timed out',errors);app.exit(1);},90000);
app.on('web-contents-created',(_event,c)=>{c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message);});c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(timer);console.log('UI simplification: welcome/upgrade, presets, acquisition/save failures, diagnostics, dual entries, hidden tabs, confirmations, capsule hints and Windows fallback passed');app.exit(0);}).catch(e=>{console.error(e,errors);app.exit(1);});});});
async function run(c){
 const js=code=>c.executeJavaScript(code),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(expr){for(let i=0;i<350;i++){if(await js(expr).catch(()=>false))return;await sleep(20);}throw Error('Timeout '+expr);}
 async function capture(name){await sleep(850);await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');c.invalidate();await sleep(40);fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG());}
 await until('!!window.NotchUi && !!window.NotchWorkspace');await js('setMode(true)');await until('!modeBusy');
 if(restart){
  await sleep(250);assert.equal(await js(`document.getElementById('ui-welcome').open`),false,'upgrade with existing data must not enter welcome');
  assert.deepEqual(await js('NotchHome.getVisibility().visibleIds'),JSON.parse(fs.readFileSync(path.join(output,'saved-visible.json'),'utf8')));
  return;
 }
 assert.equal((await js('notchAPI.getAppSettings()')).onboardingPending,true);
 await until(`document.getElementById('ui-welcome').open`);await capture('welcome-1');
 assert.deepEqual(await js('NotchHome.getVisibility().visibleIds'),['pomodoro','cursor','inbox','note']);
 await js(`document.querySelector('#ui-welcome .primary').click()`);await capture('welcome-2');
 assert.equal(await js(`document.querySelectorAll('#ui-welcome-modules input:checked').length`),4);
 await js(`document.querySelector('#ui-welcome .primary').click()`);await capture('welcome-3');
 await js(`document.querySelector('#ui-welcome .primary').click()`);await until(`!document.getElementById('ui-welcome').open`);
 assert.equal((await js('notchAPI.getAppSettings()')).onboardingPending,false);await capture('home-simple');
 // Capsule help persists a maximum of three openings and closes on collapse.
 for(let i=0;i<4;i++){
  await js('setMode(false)');await until('!modeBusy');await js('setMode(true)');await until('!modeBusy');
  assert.equal(await js(`document.getElementById('ui-capsule-hint').hidden`),i>=3);
  if(i===0)await capture('capsule-hint');
 }
 await js(`setActiveTab('settings')`);await until(`activeTab==='settings'&&!tabBusy`);
 assert.equal(await js(`document.getElementById('ui-capsule-hint').hidden`),true);
 for(const id of ['cursor','codex']){
  assert.equal(await js(`document.getElementById('ui-token-manual-${id}').open`),false);
  await js(`document.getElementById('settings-${id}-token-fetch').click()`);
  await until(`notchAPI.get${id==='cursor'?'Cursor':'Codex'}TokenStatus().then(s=>s.configured)`);
  assert.equal(await js(`document.getElementById('settings-${id}-token').value`),'');
  assert.equal(await js(`document.getElementById('ui-token-manual-${id}').open`),false);
 }
 await js('NotchAiUsage.refresh({force:true})');await sleep(100);
 assert.match(await js(`document.getElementById('settings-cursor-token-status').textContent`),/已生效/);
 await js(`NotchAiSources.openSettings('cursor')`);await until(`document.activeElement.id==='settings-cursor-token'`);await capture('token-manual');
 await js(`document.getElementById('ui-token-manual-cursor').open=false`);await capture('token-default');
 const before=await js('notchAPI.getCursorTokenStatus()');failSave=true;
 await js(`document.getElementById('settings-cursor-token-fetch').click()`);await until(`document.getElementById('settings-cursor-token-hint').classList.contains('error')`);
 assert.equal((await js('notchAPI.getCursorTokenStatus()')).configured,before.configured);failSave=false;
 await js(`NotchUi.showError({diagnostic:'ECONNREFUSED https://user:pass@nas.local/pome?token=secret Bearer private-value',onRepair:()=>{window.fixtureRepaired=true}})`);
 assert.doesNotMatch(await js(`document.querySelector('#ui-error-bar p').textContent`),/ECONN|Bearer/);
 await js(`document.querySelector('#ui-error-bar button').click()`);assert.equal(await js('window.fixtureRepaired'),true);
 await js(`document.querySelectorAll('#ui-error-bar button')[1].click()`);await until(`document.querySelectorAll('#ui-error-bar button')[1].textContent==='已复制'`);
 assert.doesNotMatch(await js(`document.querySelector('#ui-error-details pre').textContent`),/secret|private-value|user:pass/);await capture('error-bar');
 await js(`document.getElementById('ui-error-bar').hidden=true`);
 // Only the short summary appears before choosing details; cancel is inert.
 await js(`window.fixtureConfirmed='pending';NotchUi.confirm({title:'替换 NAS 数据？',message:'将使用本机资料替换 NAS，现有资料会先备份。',detail:'新增 2 项，修改 1 项，删除 3 项。'}).then(v=>window.fixtureConfirmed=v);void 0`);
 assert.equal(await js(`document.getElementById('ui-data-confirm-details').open`),false);await capture('confirmation');
 await js(`document.getElementById('ui-data-confirm-details').open=true`);await capture('confirmation-details');
 await js(`document.querySelector('#ui-data-confirm button').click()`);assert.equal(await js('window.fixtureConfirmed'),false);
 // All presets use the existing layout validator and protect an active recording.
 for(const name of ['simple','balanced','all']){assert.equal((await js(`NotchHome.applyPreset('${name}')`)).ok,true,name);assert.equal(await js('NotchDomain.validateHomeWidgetLayout(homeWorkingLayout,NotchHome.getVisibility().visibleIds,12,4)'),true);}
 const guarded=await js(`(()=>{const original=NotchWorkspace.isRecordingActive,before=JSON.stringify(NotchHome.getVisibility());NotchWorkspace.isRecordingActive=()=>true;try{return {result:NotchHome.applyPreset('simple'),unchanged:before===JSON.stringify(NotchHome.getVisibility())}}finally{NotchWorkspace.isRecordingActive=original}})()`);
 assert.equal(guarded.result.ok,false);assert.equal(guarded.unchanged,true);
 await js(`document.getElementById('ui-home-presets').scrollIntoView({block:'center'})`);await capture('presets');
 await js(`setActiveTab('home')`);
 const reachable=await js(`(()=>{const tile=document.querySelector('.home-note'),box=tile.getBoundingClientRect();return [...tile.querySelectorAll('.note-toolbar button')].filter(e=>e.checkVisibility()).every(e=>{const r=e.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right+1})})()`);
 assert.equal(reachable,true,'quick-note modes, open and save must fit compact tiles');
 await capture('home-dual-entry');
 await js(`document.getElementById('home-note').value='# 双入口验证';document.getElementById('ui-open-notes').click()`);await until(`activeTab==='notes'`);
 assert.match(await js(`document.getElementById('notes-editor').value`),/双入口验证/);
 await js(`notchAPI.setFeature('notes',false)`);await until(`document.getElementById('tab-button-notes').hidden`);assert.equal(await js(`document.getElementById('ui-open-notes').hidden`),true);
 await js(`notchAPI.setFeature('notes',true);setActiveTab('home')`);await until(`!document.getElementById('ui-open-notes').hidden`);
 await js(`document.getElementById('ui-open-recordings').click()`);await until(`activeTab==='recordings'`);
 await js(`notchAPI.setFeature('recordings',false)`);await until(`document.getElementById('tab-button-recordings').hidden`);assert.equal(await js(`document.getElementById('ui-open-recordings').hidden`),true);await js(`notchAPI.setFeature('recordings',true);setActiveTab('home')`);
 // A second renderer simulates Windows capability branches without enabling native code on this Mac.
 const win=new BrowserWindow({width:1240,height:638,show:false,frame:false,webPreferences:{backgroundThrottling:false}});
 await win.loadFile(path.join(__dirname,'../renderer/index.html'));
 const wjs=code=>win.webContents.executeJavaScript(code);
 await wjs(`window.fixtureNative=false;window.notchAPI={capabilities:{platform:'win32',features:{winNativeSetting:true}},listWindows:async()=>fixtureNative?{items:[{id:'fixture-window',title:'Cursor',appName:'Cursor'}]}:{items:[],error:'native_unavailable'},setWinNative:async()=>{fixtureNative=true;return {ok:true,nativeAvailable:true,winNative:true}}};void 0`);
 await wjs('setMode(true)');await wjs("NotchHome.applyPreset('all');NotchWorkspace.refreshWindows(true)");
 await wjs('document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,700)))');
 for(let i=0;i<200&&!await wjs(`!!document.getElementById('ui-enable-win-native')`);i++)await sleep(20);
 assert.equal(await wjs(`!!document.getElementById('ui-enable-win-native')`),true);
 fs.writeFileSync(path.join(output,'windows-inline-off.png'),(await win.webContents.capturePage()).toPNG());
 await wjs(`document.getElementById('ui-enable-win-native').click()`);
 for(let i=0;i<200&&!await wjs(`!!document.querySelector('.window-item')`);i++)await sleep(20);
 assert.equal(await wjs(`!!document.querySelector('.window-item')`),true);
 await wjs('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 fs.writeFileSync(path.join(output,'windows-inline-on.png'),(await win.webContents.capturePage()).toPNG());
 await wjs(`fixtureNative=false;notchAPI.setWinNative=async()=>({ok:true,nativeAvailable:false,nativeReason:'forced_disabled'});NotchWorkspace.refreshWindows(true)`);
 await wjs(`document.getElementById('ui-enable-win-native').click();new Promise(r=>setTimeout(r,100))`);
 assert.equal(await wjs(`!document.getElementById('ui-error-bar').hidden && !document.getElementById('ui-enable-win-native').disabled`),true);
 fs.writeFileSync(path.join(output,'windows-inline-failed.png'),(await win.webContents.capturePage()).toPNG());
 win.destroy();
 fs.writeFileSync(path.join(output,'saved-visible.json'),JSON.stringify(await js('NotchHome.getVisibility().visibleIds')));
 assert.deepEqual(errors,[]);
}
require('../main.js');
