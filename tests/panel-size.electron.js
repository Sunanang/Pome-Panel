'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,screen}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA;
fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'.ui-welcome-done'),'1');
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
const output=process.env.POME_REVIEW_SHOTS||path.join(__dirname,'../dist.noindex/panel-size');fs.mkdirSync(output,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
const watchdog=setTimeout(()=>{console.error('Panel size acceptance timed out');app.exit(1)},120000);
app.on('web-contents-created',(_,c)=>c.once('did-finish-load',()=>{
  if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
  run(c).then(()=>{clearTimeout(watchdog);console.log('Panel presets, capacity, settings, footprints, persistence and screenshots passed',process.env.POME_PANEL_SIZE_RESTART?'restart':'initial');app.quit()})
    .catch(async e=>{console.error(e);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG())}catch{}app.exit(1)});
}));
async function run(c){
 c.on('console-message',details=>{if(details.level==='error')console.error('Renderer:',details.message)});
 const js=async s=>{try{return await c.executeJavaScript(s,true)}catch(e){console.error('Evaluation:',s);throw e}},win=BrowserWindow.fromWebContents(c);
 async function until(check,label){for(let i=0;i<350;i++){if(await check())return;await sleep(20)}throw Error('Timed out '+label)}
 await until(()=>js('!!window.NotchHome&&!!window.NotchWorkspace&&!workspaceReloadPending&&!tabBusy'),'startup');
 c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 win.removeAllListeners('blur');win.showInactive();await js('setMode(true)');await until(()=>js('isExpanded&&!modeBusy'),'expanded');await sleep(300);
 await js("document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false)");
 async function tab(id){await js(`setActiveTab(${JSON.stringify(id)})`);await until(()=>js(`activeTab===${JSON.stringify(id)}&&!tabBusy`),id)}
 async function shot(name){await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');c.invalidate();await sleep(500);fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG())}
 const current=()=>js('NotchHome.getVisibility()');
 if(process.env.POME_PANEL_SIZE_RESTART){
   assert.equal((await js('notchAPI.getAppSettings()')).panelSize,'compact');
   assert.deepEqual(win.getContentSize(),[880,520]);
   assert.deepEqual((await current()).visibleIds,['sun','pomodoro','cursor','almanac']);
   await shot('compact-restarted');return;
 }
 const before=await js(`JSON.stringify({sizes:localStorage.getItem(HOME_SIZES_KEY),order:localStorage.getItem(HOME_ORDER_KEY),hidden:localStorage.getItem(HOME_HIDDEN_MODULES_KEY),placements:localStorage.getItem(HOME_PLACEMENTS_KEY)})`);
 assert.deepEqual((await current()).storedHiddenIds,['music','recorder']);
 assert.equal((await js('notchAPI.setPanelSize("bogus")')).ok,false);
 const styles=await js(`Object.fromEntries([...document.querySelectorAll('[data-home-module]')].map(e=>[e.dataset.homeModule,{size:e.dataset.widgetSize,background:getComputedStyle(e).backgroundImage,font:getComputedStyle(e).fontSize}]))`);
 for(const [preset,width,height,used,ids] of [
   ['standard',1240,638,44,['sun','pomodoro','cursor','almanac','inbox','commands','mirror','note']],
   ['medium',1040,580,36,['sun','pomodoro','cursor','almanac','inbox','commands','mirror']],
   ['compact',880,520,18,['sun','pomodoro','cursor','almanac']],
 ]){
   await tab('settings');
   await js(`NotchSettings.reveal(document.querySelector('[data-panel-size="${preset}"]'),{block:'center'}); document.querySelector('#settings-panel-size [data-panel-size="${preset}"]').click()`);
   await until(async()=> (await js('notchAPI.getAppSettings()')).panelSize===preset,preset+' saved');
   await until(()=>js(`document.documentElement.dataset.panelSize===${JSON.stringify(preset)}`),'render preset');
   // 窗口尺寸受屏幕工作区限制：CI 的 Windows runner 只有 1024x768，
   // standard(1240) 与 medium(1040) 都会被系统压窄，这不是回归。
   // 屏幕放得下就严格校验，放不下只校验没超出屏宽、以及设置与布局都按预设生效。
   const workArea=screen.getPrimaryDisplay().workAreaSize;
   if(width<=workArea.width&&height<=workArea.height){
     assert.deepEqual(win.getContentSize(),[width,height]);
   }else{
     assert.ok(win.getContentSize()[0]<=workArea.width,preset+' 窗口宽不应超过屏幕工作区');
     assert.ok(win.getContentSize()[1]<=workArea.height,preset+' 窗口高不应超过屏幕工作区');
   }
   const visibility=await current();assert.equal(visibility.capacity.used,used);assert.deepEqual(visibility.visibleIds,ids);
   const row=await js(`(()=>{const block=document.getElementById('settings-panel-size-row'),controls=document.getElementById('settings-panel-size'),language=document.getElementById('settings-language');const b=block.getBoundingClientRect(),l=language.getBoundingClientRect(),r=controls.getBoundingClientRect();return {overlap:b.top<l.bottom&&b.bottom>l.top,contained:r.left>=b.left&&r.right<=b.right,selected:controls.querySelectorAll('[aria-pressed="true"]').length}})()`);
   assert.equal(row.overlap,false);assert.equal(row.contained,true);assert.equal(row.selected,1);
   await shot(preset+'-settings');
   await js('NotchSettings.reveal(document.getElementById("settings-home-module-status").parentElement,{block:"start"})');
   await until(()=>js('document.getElementById("settings-home-module-status").dataset.state==="warning"'),'capacity warning');
   const controls=await js(`Object.fromEntries([...document.querySelectorAll('[data-settings-home-module]')].map(e=>[e.dataset.settingsHomeModule,{checked:e.checked,disabled:e.disabled}]))`);
   if(preset==='compact'){
     assert.deepEqual(controls.inbox,{checked:false,disabled:true});
     assert.equal((await js('NotchHome.setModuleVisible("inbox",true)')).error,'capacity_exceeded');
   }
   await shot(preset+'-capacity');await tab('home');
   assert.deepEqual(await js('[...homeTiles].filter(e=>!e.hidden).sort((a,b)=>Number(a.style.order)-Number(b.style.order)).map(e=>e.dataset.homeModule)'),ids);
   const geometry=await js(`(()=>{const e=document.getElementById('home-bento');const b=e.getBoundingClientRect();return {scroll:e.scrollHeight,height:e.clientHeight,tiles:[...e.querySelectorAll('[data-home-module]:not([hidden])')].map(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1}),grid:getComputedStyle(e).gridTemplateRows}})()`);
   assert(geometry.scroll<=geometry.height+1,JSON.stringify(geometry));assert(geometry.tiles.every(Boolean));
   await shot(preset+'-home');
   const after=await js(`JSON.stringify({sizes:localStorage.getItem(HOME_SIZES_KEY),order:localStorage.getItem(HOME_ORDER_KEY),hidden:localStorage.getItem(HOME_HIDDEN_MODULES_KEY),placements:localStorage.getItem(HOME_PLACEMENTS_KEY)})`);
   assert.equal(after,before,'window preset does not write tile preferences');
   const same=await js(`Object.fromEntries([...document.querySelectorAll('[data-home-module]')].map(e=>[e.dataset.homeModule,{size:e.dataset.widgetSize,background:getComputedStyle(e).backgroundImage,font:getComputedStyle(e).fontSize}]))`);
   assert.deepEqual(same,styles,'tile size labels, backgrounds and base fonts stay intact');
 }
 // Other tabs retain internal scrolling / existing split views at compact size.
 for(const id of ['todo','notes','links','recordings','credentials','clip','settings']){
   if(id==='clip')await js('notchAPI.setFeature("clip",true)');await tab(id);
   assert.deepEqual(win.getContentSize(),[880,520]);
   assert.equal(await js(`document.getElementById('tab-'+activeTab).scrollWidth<=document.getElementById('tab-'+activeTab).clientWidth+1`),true,id+' horizontal overflow');
 }
 await tab('todo');await js(`document.querySelector('.todo-deadline-trigger').click()`);await sleep(120);
 assert.equal(await js(`(()=>{const e=document.getElementById('todo-date-popover'),r=e.getBoundingClientRect();return !e.hidden&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true,'compact date popover fits');
 await shot('compact-date-popover');
 await js(`notchAPI.setPanelSize('medium')`);
 assert.equal(await js(`document.getElementById('todo-date-popover').hidden && !todoEditorContext`),true,'size change closes the date editor without retaining its editing context');
 await js(`notchAPI.setPanelSize('compact')`);
 await until(()=>js('innerWidth===880&&innerHeight===520'),'compact viewport after resize');await tab('recordings');
 await js(`document.getElementById('recording-configure').click()`);await sleep(120);
 const modal=await js(`(()=>{const e=document.querySelector('#transcription-settings-backdrop .transcription-settings-card'),r=e.getBoundingClientRect(),b=document.getElementById('transcription-settings-save').getBoundingClientRect();return {card:r.toJSON(),button:b.toJSON(),width:innerWidth,height:innerHeight,hidden:document.getElementById('transcription-settings-backdrop').hidden}})()`);
 assert(!modal.hidden&&modal.card.left>=-1&&modal.card.top>=-1&&modal.card.right<=modal.width+1&&modal.card.bottom<=modal.height+1&&modal.button.top>=modal.card.top-1&&modal.button.bottom<=modal.card.bottom+1,'compact transcription dialog and footer fit: '+JSON.stringify(modal));
 await shot('compact-transcription-dialog');await js(`document.getElementById('transcription-settings-cancel').click()`);
 await tab('home');await js('PomeSun.openLocation()');await sleep(200);
 assert.equal(await js(`(()=>{const p=document.getElementById('sun-location-popover'),r=p.getBoundingClientRect();return !p.hidden&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true,'compact location popover fits');
 await shot('compact-popover');await js('PomeSun.closeLocation()');
 // Real BrowserWindow positioning with the cursor input controlled by this fixture.
 const nativeCursor=screen.getCursorScreenPoint;let pointer;screen.getCursorScreenPoint=()=>pointer;
 const area=screen.getDisplayMatching(win.getBounds()).workArea;
 try{
  for(const edge of ['top','right','bottom','left']){
   await js('setMode(false)');await until(()=>js('!isExpanded&&!modeBusy'),'collapse for dock');
   const b=win.getBounds();pointer={x:b.x+2,y:b.y+2};await js('notchAPI.startPanelDrag()');
   pointer={x:edge==='left'?area.x+1:edge==='right'?area.x+area.width-1:area.x+Math.round(area.width/2),y:edge==='top'?area.y+1:edge==='bottom'?area.y+area.height-1:area.y+Math.round(area.height/2)};
   await js('notchAPI.movePanelDrag()');const dock=await js('notchAPI.endPanelDrag()');assert.equal(dock.edge,edge);
   await js('setMode(true)');await until(()=>js('isExpanded&&!modeBusy'),'expand dock');
   for(const preset of ['standard','medium','compact']){
    await js(`notchAPI.setPanelSize('${preset}')`);const bounds=win.getBounds();
    assert(bounds.x>=area.x&&bounds.y>=area.y&&bounds.x+bounds.width<=area.x+area.width&&bounds.y+bounds.height<=area.y+area.height,JSON.stringify(bounds));
    if(edge==='left')assert.equal(bounds.x,dock.x);
    if(edge==='right')assert.equal(bounds.x+bounds.width,dock.x+dock.width);
    if(edge==='top')assert.equal(bounds.y,dock.y);
    if(edge==='bottom')assert.equal(bounds.y+bounds.height,dock.y+dock.height);
   }
  }
 }finally{screen.getCursorScreenPoint=nativeCursor;await js('notchAPI.resetPanelPosition()')}
 // Active local settings and the complete user's preferred module set survive renderer reload.
 await new Promise(r=>{c.once('did-finish-load',r);c.reload()});await until(()=>js('!!window.NotchHome&&!workspaceReloadPending'),'reload');
 assert.equal((await js('notchAPI.getAppSettings()')).panelSize,'compact');
 assert.deepEqual((await current()).visibleIds,['sun','pomodoro','cursor','almanac']);
 // An existing customized layout with large footprints must survive a restart
 // and a compact drag preview without overwriting its saved standard canvas.
 const stored=await js(`Object.fromEntries([HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_HIDDEN_MODULES_KEY,HOME_PLACEMENTS_KEY].map(k=>[k,localStorage.getItem(k)]))`);
 await js(`(()=>{
   const ids=['cursor','sun','commands'];homeOrder=[...ids,...HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id))];
   homeSizes={...HOME_SIZE_DEFAULTS,cursor:'large',sun:'medium'};
   hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id));homeWorkingLayout=null;
   applyHomeLayout(resolveValidatedHomeLayout(hiddenHomeModules),{reason:'initial'});saveHiddenHomeModules();saveHomeLayout();
 })()`);
 const custom=await js(`({order:[...homeOrder],sizes:{...homeSizes},hidden:[...hiddenHomeModules],placements:localStorage.getItem(HOME_PLACEMENTS_KEY)})`);
 await new Promise(r=>{c.once('did-finish-load',r);c.reload()});await until(()=>js('!!window.NotchHome&&!workspaceReloadPending'),'custom reload');
 assert.deepEqual(await js(`({order:[...homeOrder],sizes:{...homeSizes},hidden:[...hiddenHomeModules],placements:localStorage.getItem(HOME_PLACEMENTS_KEY)})`),custom);
 for(const preset of ['standard','medium','compact']){
   await js(`notchAPI.setPanelSize('${preset}')`);await sleep(50);
   assert.equal(await js(`document.getElementById('home-cursor').dataset.widgetSize`),'large');
   assert.equal(await js(`localStorage.getItem(HOME_PLACEMENTS_KEY)`),custom.placements);
 }
 await tab('home');await js('setMode(true)');await until(()=>js('isExpanded&&!modeBusy'),'custom expand');
 const preview=await js(`(async()=>{
   document.getElementById('home-layout-edit').click();
   const a=document.getElementById('home-cursor'),b=document.getElementById('home-sun');
   a.setPointerCapture=()=>{};a.hasPointerCapture=()=>false;
   const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
   const point=r=>({clientX:r.left+r.width/2,clientY:r.top+r.height/2});
   const base={bubbles:true,cancelable:true,isPrimary:true,pointerId:904,button:0,buttons:1};
   a.dispatchEvent(new PointerEvent('pointerdown',{...base,...point(ar)}));
   homeBento.dispatchEvent(new PointerEvent('pointermove',{...base,...point(br)}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const e=homeBento.querySelector('.home-swap-placeholder'),r=e?.getBoundingClientRect(),box=homeBento.getBoundingClientRect();
   const fits=!!r&&r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1;
   homeBento.dispatchEvent(new PointerEvent('pointercancel',{...base,...point(br),buttons:0}));
   document.getElementById('home-layout-cancel').click();return fits;
 })()`);
 assert(preview,'compact drag preview uses the projected grid');
 await js(`Object.entries(${JSON.stringify(stored)}).forEach(([key,value])=>localStorage.setItem(key,value))`);
}
require('../main.js');
