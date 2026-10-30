'use strict';
// Real window-widget renderer with controlled metadata, isolated data and no real accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow,ipcMain,clipboard}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA||fs.mkdtempSync(path.join(os.tmpdir(),'pome-windows-'));
process.env.TODO_TEST_USER_DATA=profile;process.env.POME_HOOK_TEST_HOME=path.join(profile,'hook-home');process.env.POME_TEST_LANGUAGE='zh-CN';
fs.mkdirSync(process.env.POME_HOOK_TEST_HOME,{recursive:true});
app.commandLine.appendSwitch('user-data-dir',profile);app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
if(process.platform==='win32'){const p=require('../platform'),original=p.resolveCapabilities;p.resolveCapabilities=(...args)=>{const caps=original(...args);return {...caps,features:{...caps.features,windowSwitcher:true}}};}
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});
require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_no_auth'});
require('../codex-usage-remote').createCodexUsageService=()=>({tokenState:()=>({manualTokenInvalid:false}),getUsage:async()=>({ok:true,detected:false}),reset(){}});
clipboard.read=async()=>[];clipboard.write=async()=>{};clipboard.writeText=async()=>{};clipboard.clear=()=>{};
const focusCalls=[],listRequests=[];let windowItems=[],focusResult=true,listFailure=false;
let pairCalls=0,captureMode='',releaseCapture;const external=[];require('electron').shell.openExternal=async url=>{external.push(url);};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,(e,...args)=>{
  if(channel==='notes:capture-module'&&captureMode==='hold')return new Promise(resolve=>{releaseCapture=resolve});
  if(channel==='notes:capture-module'&&captureMode==='fail')return null;
  if((channel==='windows:list'||channel==='windows:focus')&&!e.sender.getURL().endsWith('/renderer/index.html'))return fn(e,...args);
  if(channel==='windows:list'){listRequests.push(args[0]);return {items:listFailure?[]:windowItems,error:listFailure?'window_scan_failed':null};}
  if(channel==='windows:focus'){focusCalls.push(args[0]);return focusResult;}
  if(channel==='links:inspect')return {ok:true,title:'Reference example',url:args[0]};
  if(channel==='credentials:list')return {ok:true,secureStorage:true,items:[]};
  if(channel==='sync:pair-claim'){pairCalls++;return {ok:false,error:'fixture_offline'};}
  if(channel==='shell:openExternal'){external.push(args[0]);return true;}
  return fn(e,...args);
});
const output=process.env.POME_WINDOWS_SHOTS||path.join(__dirname,'../dist.noindex/windows-widget');fs.mkdirSync(output,{recursive:true});
let started=false;const errors=[],checks=[];
const watchdog=setTimeout(()=>{console.error('Window widget timeout',errors);app.exit(1);},90000);
app.on('web-contents-created',(_,c)=>{
 c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message);});
 c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
 run(c).then(()=>{clearTimeout(watchdog);fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));console.log('Window widget acceptance passed:',checks.map(c=>typeof c==='string'?c:Object.keys(c).join('/')).join(', '));app.exit(0);}).catch(async e=>{console.error(e,errors);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG());}catch{}app.exit(1);});});
});
async function run(c){
 const win=BrowserWindow.fromWebContents(c),js=s=>c.executeJavaScript(s,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(s){for(let i=0;i<300;i++){if(await js(s).catch(()=>false))return;await sleep(20);}throw Error('Timeout '+s);}
 async function click(s){const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(s)});if(!e)throw Error('Missing '+${JSON.stringify(s)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,hit:h===e||e.contains(h)}})()`);assert(r.hit,'hittable '+s);c.sendInputEvent({type:'mouseMove',x:Math.round(r.x),y:Math.round(r.y)});c.sendInputEvent({type:'mouseDown',x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});c.sendInputEvent({type:'mouseUp',x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});await sleep(50);if(s==='#note-save-btn')await until('!noteInput.readOnly');}
 async function key(keyCode,modifiers=[]){c.sendInputEvent({type:'keyDown',keyCode,modifiers});c.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(50);}
 async function tab(id){await js(`setActiveTab('${id}')`);await until(`activeTab==='${id}'&&!tabBusy`);await sleep(180);}
 async function input(s,text){await js(`(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
 async function shot(id){await js('document.fonts.ready');await sleep(100);fs.writeFileSync(path.join(output,id+'.png'),(await c.capturePage()).toPNG());}
 await until('!!window.NotchWorkspace&&!workspaceReloadPending');win.removeAllListeners('blur');win.show();win.focus();await js('setMode(true)');await until('!modeBusy');await js("document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false)");
 const apps=[['Terminal','/System/Applications/Utilities/Terminal.app'],['Google Chrome','/Applications/Google Chrome.app'],['WeChat','/Applications/WeChat.app']];
 const icons={};for(const [name,file] of apps)try{icons[name]=process.platform==='darwin'?await require('../platform-adapters/darwin').createDarwinAdapter().windows.appIcon(file):(await app.getFileIcon(file,{size:'normal'})).toDataURL()}catch{}
 windowItems=[...Array.from({length:5},(_,i)=>({id:'terminal-'+i,pid:100,appName:'Terminal',title:['Pome-Panel — npm start','FNMessageBots — 日志检查','~/coding — zsh','Pome-Panel — npm test','服务器连接 — ssh'][i],icon:icons.Terminal})),...['a · 项目设计文档','b · 浏览器窗口验收'].map((title,i)=>({id:'browser-'+i,pid:200,appName:'Google Chrome',title,icon:icons['Google Chrome']})),{id:'wechat',pid:300,appName:'WeChat',title:'微信',icon:icons.WeChat}];
 await click('#windows-refresh');await until('document.querySelectorAll("#window-list .window-item").length===8');await shot(process.env.POME_WINDOWS_AUDIT==='before'?'01-before':'02-after');if(process.env.POME_WINDOWS_AUDIT!=='before'){const r=await js(`(()=>{const r=document.querySelector('.home-windows').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);fs.writeFileSync(path.join(output,'02-after-module.png'),(await c.capturePage(r)).toPNG());}
 if(process.env.POME_WINDOWS_AUDIT!=='before'){
  assert.equal(listRequests.at(-1),true,'manual refresh reaches the native discovery force flag');
  await click('.window-item[data-id=browser-0]');assert.equal(focusCalls.at(-1),'browser-0');await click('.window-item[data-id=browser-1]');assert.equal(focusCalls.at(-1),'browser-1');
  const beforeKeys=focusCalls.length;await js(`document.querySelector('.window-item[data-id=browser-0]').focus()`);await key('Space');assert.equal(focusCalls.length,beforeKeys+1,'Space activates the focused window row');assert.equal(await js('isExpanded'),true,'row Space does not collapse the workspace');
  const geometry=await js(`(()=>{const r=document.querySelector('.window-item').getBoundingClientRect();return {width:r.width,height:r.height,cols:getComputedStyle(document.querySelector('#window-list')).gridTemplateColumns}})()`);assert(geometry.width>140&&geometry.height>=50,'window titles have a readable row');
  const outsider=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../preload.js'),contextIsolation:true,sandbox:true}});await outsider.loadURL('data:text/html,<body>Window ownership fixture</body>');for(const expression of ['notchAPI.listWindows()','notchAPI.focusWindow("browser-0")'])assert.match(await outsider.webContents.executeJavaScript(expression+`.then(()=>'',e=>e.message)`),/workspace_owner_required/);outsider.destroy();
  const originalItems=[...windowItems];windowItems.push({id:'same-one',appName:'Terminal',title:'同名终端',axWindowId:'801'},{id:'same-two',appName:'Terminal',title:'同名终端',axWindowId:'802'});await click('#windows-refresh');
  await js(`document.querySelector('.window-item[data-id=same-one]').scrollIntoView({block:'nearest'})`);const drag=await js(`(()=>{const r=document.querySelector('.window-item[data-id=same-one]').getBoundingClientRect(),b=document.querySelector('.home-windows').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,out:b.left-30}})()`);
  c.sendInputEvent({type:'mouseDown',x:Math.round(drag.x),y:Math.round(drag.y),button:'left',clickCount:1});await sleep(550);c.sendInputEvent({type:'mouseMove',x:Math.round(drag.out),y:Math.round(drag.y),button:'left'});c.sendInputEvent({type:'mouseUp',x:Math.round(drag.out),y:Math.round(drag.y),button:'left',clickCount:1});await sleep(120);
  assert.equal(await js(`!!document.querySelector('.window-item[data-id=same-one]')`),false,'hide one AX window');assert.equal(await js(`!!document.querySelector('.window-item[data-id=same-two]')`),true,'keep its same-title sibling');await click('#windows-hidden');assert.equal(await js('document.querySelectorAll(".window-item").length'),10);windowItems=originalItems;await sleep(450);
  windowItems.push(...Array.from({length:14},(_,i)=>({id:'extra-'+i,pid:400,appName:'Code',title:'Workspace '+i,axWindowId:String(400+i)})));await click('#windows-refresh');assert.equal(await js('document.querySelectorAll(".window-item").length'),22,'all windows are reachable beyond the old 15-entry cap');
  await js(`document.querySelector('#window-list').scrollTop=100;document.querySelector('.window-item[data-id=browser-0]').focus({preventScroll:true})`);const scroll=await js('document.querySelector("#window-list").scrollTop');await click('#windows-refresh');assert(Math.abs(await js('document.querySelector("#window-list").scrollTop')-scroll)<2,'refresh preserves scroll');
  await js(`document.querySelector('.window-item[data-id=browser-0]').focus({preventScroll:true});document.querySelector('#windows-refresh').click()`);await until(`document.activeElement?.dataset.id==='browser-0'&&!document.querySelector('.window-item[data-id=browser-0]').disabled`);
  focusResult=false;await js(`document.querySelector('.window-item[data-id=browser-0]').scrollIntoView({block:'nearest'})`);const homeScroll=await js('document.querySelector("#home-bento").scrollTop');await click('.window-item[data-id=browser-0]');assert.equal(await js('document.querySelector("#ui-error-bar").hidden'),false,'stale target reports a persistent failure');assert.equal(await js('document.activeElement?.dataset.id'),'browser-0','failed focus keeps its keyboard target');await sleep(100);assert.equal(await js('document.querySelector("#home-bento").scrollTop'),homeScroll,'error keeps the Home page in place');await shot('03-focus-failure');focusResult=true;await click('.window-item[data-id=browser-0]');assert.equal(await js('document.querySelector("#ui-error-bar").hidden'),true);
  windowItems=windowItems.slice(0,8);await click('#windows-refresh');await js('notchAPI.setLanguage("en-US")');await until('document.documentElement.lang==="en-US"');await shot('04-english');
  windowItems[0].minimized=true;await click('#windows-refresh');assert.match(await js('document.querySelector(".window-item[data-id=terminal-0]").innerText'),/Minimized/);
  listFailure=true;await click('#windows-refresh');assert.equal(await js('document.querySelector("#ui-error-bar").hidden'),false);listFailure=false;await click('#windows-refresh');assert.equal(await js('document.querySelector("#ui-error-bar").hidden'),true);
  for(const size of ['mini','small']){
   const point=await js(`(()=>{const r=document.querySelector('.home-windows').getBoundingClientRect();return {x:r.x+32,y:r.y+20}})()`);c.sendInputEvent({type:'mouseDown',x:Math.round(point.x),y:Math.round(point.y),button:'right',clickCount:1});c.sendInputEvent({type:'mouseUp',x:Math.round(point.x),y:Math.round(point.y),button:'right',clickCount:1});await until(`!document.querySelector('#home-context-menu').hidden`);await click(`[data-home-ctx-size="${size}"]`);await sleep(400);
   const dims=await js(`(()=>{const l=document.querySelector('#window-list'),r=l.getBoundingClientRect();return {width:r.width,cols:getComputedStyle(l).gridTemplateColumns.split(' ').length,rows:l.querySelectorAll('.window-item').length,scroll:l.scrollHeight>l.clientHeight}})()`);assert.equal(dims.cols,1,'small widget uses readable single-column rows');assert.equal(dims.rows,8);assert(dims.scroll,'all compact entries remain scrollable');await shot('07-'+size);
  }

 }
 checks.push('eight sample windows, system icons, exact A/B click IDs, same-title hide/restore, 22 reachable rows, scroll/focus retention, persistent failures/recovery, bilingual labels and mini/small layouts');
 assert.deepEqual(errors,[]);
}
require('../main');
