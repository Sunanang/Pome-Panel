'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA;
assert(profile,'isolated userData required');
process.env.POME_TEST_NOTIFICATIONS='1';
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
const inbox=require('../taskInbox').createTaskInbox({filePath:path.join(profile,'task-inbox.json')});
for(let i=0;i<6;i++)inbox.accept({source:'codex',eventId:'fill-'+i,title:'布局回归任务 '+(i+1)+'：保留完成记录与原有操作'});
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>originalHandle(name,name==='windows:list'?()=>({items:[{id:'fill-window',appName:'Terminal',title:'面板布局验收'}],error:null}):fn);
const output=process.env.POME_REVIEW_SHOTS||path.join(__dirname,'../dist.noindex/home-fill');fs.mkdirSync(output,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
const watchdog=setTimeout(()=>{console.error('Home fill acceptance timed out');app.exit(1)},90000);
app.on('web-contents-created',(_,c)=>c.once('did-finish-load',()=>{
 if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
 run(c).then(()=>{clearTimeout(watchdog);console.log('Home fill: user layout, all-read alignment, footprint preservation, resize, drag and reload passed');app.quit()})
 .catch(async error=>{console.error(error);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG())}catch{}app.exit(1)});
}));
async function run(c){
 const js=code=>c.executeJavaScript(code,true),win=BrowserWindow.fromWebContents(c);
 const errors=[];c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message)});
 async function until(check,label){for(let i=0;i<300;i++){if(await check())return;await sleep(20)}throw Error('Timeout '+label)}
 await until(()=>js('!!window.NotchHome&&!!window.NotchWorkspace&&!workspaceReloadPending'),'startup');
 win.removeAllListeners('blur');win.show();await js('setMode(true)');await until(()=>js('isExpanded&&!modeBusy'),'expanded');
 c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 async function connectedSource(){
   await until(()=>js('window.NotchAiSources?.getState().ready'),'source fixture');
   await js(`(()=>{const sources=window.NotchAiSources;window.NotchAiSources={...sources,getState:()=>{const state=sources.getState();return {...state,sources:state.sources.map(row=>row.source==='codex'?{...row,state:'connected'}:row),listener:{...state.listener,listening:true,meetingMode:false}}}};document.dispatchEvent(new Event('notch:ai-sources-changed'));})()`);
 }
 await connectedSource();
 await js(`document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);
   const ids=['pomodoro','note','inbox','windows','cursor'];
   homeOrder=[...ids,...HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id))];
   homeSizes={...HOME_SIZE_DEFAULTS,pomodoro:'small',note:'small',inbox:'medium',windows:'medium',cursor:'medium'};
   hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id));homeWorkingLayout=null;
   applyHomeLayout(resolveValidatedHomeLayout(hiddenHomeModules),{reason:'initial'});saveHiddenHomeModules();saveHomeLayout();`);
 const saved=await js(`[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_HIDDEN_MODULES_KEY,HOME_PLACEMENTS_KEY].map(k=>localStorage.getItem(k))`);
 async function shot(name){await js('document.fonts.ready');c.invalidate();await sleep(350);fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG())}
 async function filled(){
   await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const state=await js(`(()=>{const box=homeBento.getBoundingClientRect(),gap=parseFloat(getComputedStyle(homeBento).columnGap);
     const rects=[...homeTiles].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect().toJSON());
     const coverage=rects.reduce((sum,r)=>sum+(r.width+gap)*(r.height+gap)/((box.width+gap)*(box.height+gap)),0);
     return {box:box.toJSON(),rects,coverage,scroll:homeBento.scrollHeight,height:homeBento.clientHeight};})()`);
   assert(Math.abs(state.coverage-1)<0.0001,JSON.stringify(state));
   assert(state.scroll<=state.height+1,'no outer Home scroll');
   for(let i=0;i<state.rects.length;i++){
     const a=state.rects[i],b=state.box;assert(a.left>=b.left-1&&a.top>=b.top-1&&a.right<=b.right+1&&a.bottom<=b.bottom+1);
     for(let j=i+1;j<state.rects.length;j++){const b=state.rects[j];assert(!(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1),'no overlaps')}
   }
 }
 async function header(){
   const state=await js(`(()=>{const head=document.querySelector('.home-inbox-head').getBoundingClientRect(),button=document.getElementById('home-inbox-read-all').getBoundingClientRect(),status=document.querySelector('.home-inbox-listener').getBoundingClientRect();return {head:head.toJSON(),button:button.toJSON(),status:status.toJSON()}})()`);
   assert(Math.abs(state.head.right-state.button.right)<=1,'all-read action stays at the right edge: '+JSON.stringify(state));
   assert(state.status.width>0,'healthy listener caption is present alongside the action');
   if(await js(`document.getElementById('home-inbox').dataset.widgetSize!=='small'`))assert(state.status.right<=state.button.left-3,'listener precedes the action');
 }
 for(const [preset,count,used] of [['medium',5,32],['compact',4,24],['medium',5,32]]){
   await js(`notchAPI.setPanelSize('${preset}')`);await until(()=>js(`homePanelSize==='${preset}'`),'preset');await sleep(150);
   assert.equal((await js('NotchHome.getVisibility()')).visibleIds.length,count);
   assert.equal((await js('NotchHome.getVisibility()')).capacity.used,used);
   await filled();await header();await shot('user-'+preset+'-home');
   assert.deepEqual(await js(`[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_HIDDEN_MODULES_KEY,HOME_PLACEMENTS_KEY].map(k=>localStorage.getItem(k))`),saved,'preset projection must not write layout preferences');
 }
 await until(()=>js('document.querySelectorAll(".home-inbox-row").length>0'),'task rows');
 await js(`document.getElementById('home-inbox-read-all').click()`);
 await until(()=>js('document.getElementById("home-inbox-read-all").disabled'),'mark read');await header();await shot('all-read-right');
 const crop=await js(`(()=>{const r=document.getElementById('home-inbox').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
 fs.writeFileSync(path.join(output,'inbox-right.png'),(await c.capturePage(crop)).toPNG());
 for(const preset of ['medium','compact']){
   await js(`notchAPI.setPanelSize('${preset}')`);await sleep(150);
   for(const size of ['small','medium']){
     await js(`(()=>{const tile=document.getElementById('home-inbox'),r=tile.getBoundingClientRect();tile.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+15,clientY:r.top+15}));document.querySelector('[data-home-ctx-size="${size}"]').click()})()`);
     await sleep(150);assert.equal(await js('document.getElementById("home-inbox").dataset.widgetSize'),size);
     await filled();await header();await shot(preset+'-resize-'+size);
   }
 }
 const dragSizes=await js('JSON.stringify(homeSizes)');
 await js(`(async()=>{
   document.getElementById('home-layout-edit').click();
   const tile=document.getElementById('home-pomodoro'),target=document.getElementById('home-note');
   tile.setPointerCapture=()=>{};tile.hasPointerCapture=()=>false;
   const a=tile.getBoundingClientRect(),b=target.getBoundingClientRect(),center=r=>({clientX:r.left+r.width/2,clientY:r.top+r.height/2});
   const p={bubbles:true,cancelable:true,isPrimary:true,pointerId:818,button:0,buttons:1};
   tile.dispatchEvent(new PointerEvent('pointerdown',{...p,...center(a)}));
   homeBento.dispatchEvent(new PointerEvent('pointermove',{...p,...center(b)}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   homeBento.dispatchEvent(new PointerEvent('pointerup',{...p,...center(b),buttons:0}));
   document.getElementById('home-layout-save').click();
 })()`);
 assert.deepEqual(await js('homeOrder.slice(0,2)'),['note','pomodoro']);
 assert.equal(await js('JSON.stringify(homeSizes)'),dragSizes,'narrow dragging cannot resize siblings to fill the saved standard canvas');
 await filled();await header();await shot('compact-dragged');
 await new Promise(r=>{c.once('did-finish-load',r);c.reload()});
 await until(()=>js('!!window.NotchHome&&!workspaceReloadPending'),'reload');await js('setMode(true)');await until(()=>js('isExpanded&&!modeBusy'),'re-expanded');
 await connectedSource();await filled();await header();
 assert.deepEqual(errors,[]);
}
require('../main');
