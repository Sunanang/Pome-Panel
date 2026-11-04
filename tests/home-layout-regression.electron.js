'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA;assert(profile,'isolated profile required');
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS='1';require('./provider-usage-fixtures.cjs');
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'notch-home-commands':JSON.stringify([
 {id:'one',text:'git log --pretty=oneline',createdAt:1},{id:'two',text:'npm test',createdAt:2},{id:'three',text:'git status --short',createdAt:3},
])}}));
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,name==='windows:list'?()=>({items:[],error:null}):fn);
const shots=process.env.POME_REVIEW_SHOTS||path.join(__dirname,'../dist.noindex/home-layout-regression');fs.mkdirSync(shots,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
const watchdog=setTimeout(()=>{console.error('Layout regression timeout');app.exit(1)},90000);
app.on('web-contents-created',(_,c)=>c.once('did-finish-load',()=>{
 if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
 run(c).then(()=>{clearTimeout(watchdog);console.log('Screenshot 4444: all presets, command comment gaps, edit/save/cancel, recorder alignment and error-bar bounds passed');app.quit()})
 .catch(async error=>{console.error(error);try{fs.writeFileSync(path.join(shots,'failure.png'),(await c.capturePage()).toPNG())}catch{}app.exit(1)});
}));
async function run(c){
 const win=BrowserWindow.fromWebContents(c),js=async s=>{try{return await c.executeJavaScript(s,true)}catch(error){console.error('Renderer check:',s);throw error}};
 const errors=[];c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message)});
 async function until(check){for(let i=0;i<300;i++){if(await check())return;await sleep(20)}throw Error('fixture not ready')}
 await until(()=>js('!!window.NotchHome&&!!window.NotchWorkspace&&!workspaceReloadPending'));
 win.removeAllListeners('blur');win.show();await js('setMode(true)');await until(()=>js('isExpanded&&!modeBusy'));
 c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await js(`(()=>{
  document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);
  const placements={cursor:{column:0,row:0,width:2,height:2},commands:{column:2,row:0,width:2,height:2},recorder:{column:4,row:1,width:2,height:2},note:{column:6,row:0,width:2,height:2},inbox:{column:8,row:0,width:4,height:2},windows:{column:0,row:2,width:4,height:2},sun:{column:6,row:2,width:4,height:2}};
  const ids=Object.keys(placements);homeOrder=[...ids,...HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id))];
  homeSizes={...HOME_SIZE_DEFAULTS,...Object.fromEntries(ids.map(id=>[id,NotchDomain.sizeNameFromPlacement(placements[id])]))};
  hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id));
  homeWorkingLayout={allowGaps:true,placements,variants:Object.fromEntries(ids.map(id=>[id,NotchDomain.layoutVariantForPlacement(placements[id])]))};
  applyHomeLayout(homeWorkingLayout,{reason:'initial'});saveHiddenHomeModules();saveHomeLayout();
  for(let i=0;i<3;i++){
    const row=document.querySelectorAll('.command-item')[i];
    row.querySelector('.command-comment').click();const input=row.querySelector('.command-edit');
    input.value=['查看最近提交','运行回归测试','检查工作区'][i];input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  }
 })()`);
 async function shot(name){
   await js('document.fonts.ready');c.invalidate();await sleep(200);fs.writeFileSync(path.join(shots,name+'.png'),(await c.capturePage()).toPNG());
   if(name==='standard-view'){
     const crop=await js(`(()=>{const r=document.querySelector('[data-home-module="commands"]').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
     fs.writeFileSync(path.join(shots,'commands-comments.png'),(await c.capturePage(crop)).toPNG());
   }
 }
 async function check(label){
   await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const state=await js(`(()=>{
    const box=homeBento.getBoundingClientRect(),bounds=document.getElementById('panels').getBoundingClientRect(),gap=parseFloat(getComputedStyle(homeBento).columnGap);
    const tiles=[...homeTiles].filter(e=>!e.hidden).map(e=>({id:e.dataset.homeModule,...e.getBoundingClientRect().toJSON()}));
    const rows=[...document.querySelectorAll('.command-item')].map(e=>e.getBoundingClientRect().toJSON());
    const bar=document.getElementById('home-layout-edit-bar'),b=bar.getBoundingClientRect();
    const now=document.querySelector('#home-sun .sun-now'),times=document.querySelector('#home-sun .sun-times');
    return {box:box.toJSON(),bounds:bounds.toJSON(),tiles,coverage:tiles.reduce((sum,r)=>sum+(r.width+gap)*(r.height+gap)/((box.width+gap)*(box.height+gap)),0),gaps:rows.slice(1).map((r,i)=>r.top-rows[i].bottom),editing:!bar.hidden,edit:b.toJSON(),scroll:homeBento.scrollHeight,client:homeBento.clientHeight,sun:now&&times&&!document.getElementById('home-sun').hidden?{now:now.getBoundingClientRect().toJSON(),times:times.getBoundingClientRect().toJSON()}:null};
   })()`);
   fs.writeFileSync(path.join(shots,label+'.json'),JSON.stringify(state,null,2));
   assert(state.gaps.every(gap=>gap>=4.9),label+' command rows need space: '+JSON.stringify(state.gaps));
   assert(Math.abs(state.coverage-1)<0.0001,label+' fills available area: '+state.coverage);
   assert(state.box.bottom<=state.bounds.bottom+1,label+' fits above error bar');
   assert(state.scroll<=state.client+1,label+' no outer Home scroll');
   if(state.editing)assert(state.edit.bottom<=state.box.top+1,label+' edit actions do not cover widget headers');
   if(state.sun)assert(state.sun.now.bottom<=state.sun.times.top-1,label+' sun chart label clears the time legend: '+JSON.stringify(state.sun));
   assert(Math.abs(state.tiles.find(t=>t.id==='recorder').top-state.box.top)<=1,label+' recorder starts at the top, not in a floating middle row');
   for(const tile of state.tiles)assert(tile.top>=state.box.top-1&&tile.bottom<=state.box.bottom+1&&tile.left>=state.box.left-1&&tile.right<=state.box.right+1,label+' tile within viewport '+tile.id);
   assert(await js(`(()=>{const list=document.getElementById('command-list');list.scrollTop=list.scrollHeight;const row=list.lastElementChild.getBoundingClientRect(),box=list.getBoundingClientRect();const reachable=row.bottom<=box.bottom+1&&row.top<box.bottom;list.scrollTop=0;return reachable})()`),label+' last commented command remains reachable by scrolling');
 }
 await js(`document.getElementById('home-layout-edit').click();NotchUi.showError({message:'当前系统安全存储不可用，暂时无法保存密码。',scope:'fixture-storage',onRepair:()=>true})`);
 await shot('standard-edit-error');await check('standard-edit-error');
 await js(`(async()=>{await setActiveTab('settings');document.getElementById('panels').scrollTop=50;await setActiveTab('home')})()`);
 await check('standard-return-with-error');await shot('standard-return-with-error');
 await js(`document.getElementById('home-layout-cancel').click();NotchUi.clearError()`);
 const saved=await js(`[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_PLACEMENTS_KEY].map(k=>localStorage.getItem(k))`);
 for(const preset of ['standard','medium','compact','standard']){
   await js(`notchAPI.setPanelSize('${preset}')`);await until(()=>js(`homePanelSize==='${preset}'&&!modeBusy`));
   await check(preset+'-view');await shot(preset+'-view');
   for(const [action,id] of [['save','home-layout-save'],['cancel','home-layout-cancel']]){
     await js(`document.getElementById('home-layout-edit').click()`);await check(preset+'-edit-'+action);await shot(preset+'-edit-'+action);
     await js(`document.getElementById('${id}').click()`);await check(preset+'-after-'+action);
   }
   await js(`NotchUi.showError({message:'当前系统安全存储不可用，暂时无法保存密码。',scope:'fixture-storage',onRepair:()=>true});document.getElementById('home-layout-edit').click()`);
   await check(preset+'-edit-error');await shot(preset+'-edit-error');
   await js(`document.getElementById('home-layout-cancel').click();NotchUi.clearError()`);
   assert.deepEqual(await js(`[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_PLACEMENTS_KEY].map(k=>localStorage.getItem(k))`),saved,'presentation must not rewrite the saved layout');
 }
 assert.deepEqual(await js('getCommandsForSync().map(c=>c.comment)'),['查看最近提交','运行回归测试','检查工作区']);
 assert.deepEqual(errors,[]);
}
require('../main');
