'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,dialog,ipcMain}=require('electron');
// Keep paging pending long enough to exercise the absent page label.
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>handle(channel,channel==='tasks:inbox'?async(event,options)=>{
 if(options?.offset>0)await new Promise(resolve=>setTimeout(resolve,100));
 return handler(event,options);
}:handler);
// The return-button check must not foreground a terminal on the host machine.
const adapters=require('../platform-adapters'),originalAdapter=adapters.loadAdapter;
adapters.loadAdapter=(...args)=>{
 const adapter=originalAdapter(...args);
 adapter.windows={...adapter.windows,list:async()=>({items:[],error:null}),resolveTaskApp:async()=>null};
 adapter.taskApps.open=async()=>({ok:true,message:'已打开来源软件。'});
 return adapter;
};
const profile=process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir',profile);if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken=()=>({ok:false,error:'fixture_missing'});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false,error:'fixture_offline'});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_missing'});
process.env.POME_TEST_NOTIFICATIONS='1';
let clock=Date.now()-125*60000;const inbox=require('../taskInbox').createTaskInbox({filePath:path.join(profile,'task-inbox.json'),now:()=>clock});
for(let i=0;i<125;i++){clock+=60000;const record=inbox.accept({source:['codex','claude','cursor'][i%3],eventId:`bento-${i}`,taskId:'fixture-session',title:['重构 task-inbox 待办并测试','修复 NAS 同步流程的错误提示','首页布局 gap 填充逻辑优化'][i%3],project:'Pome-Panel · 12 个文件变更'}).record;if(i<122)inbox.markRead(record.id);}
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'notch-home-note':'# Markdown 格式笔记…'}}));
const artifacts=path.join(__dirname,'../dist.noindex/inbox-bento');fs.mkdirSync(artifacts,{recursive:true});
const errors=[];let port,started=false,confirm=false;
app.on('pome-test-notification-port',value=>{port=value;});
dialog.showMessageBox=async(...args)=>{assert(args.at(-1).detail.includes('.corrupt-'));return {response:confirm?1:0};};
const watchdog=setTimeout(()=>{console.error('Bento inbox fixture timed out',errors);app.exit(1);},90000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(c,expr){for(let i=0;i<350;i++){try{if(await c.executeJavaScript(expr))return;}catch{}await sleep(25);}throw new Error('timeout: '+expr);}
app.on('web-contents-created',(_event,c)=>{c.on('console-message',details=>{if(details.level==='error'&&!details.message.includes('ERR_'))errors.push(details.message);});c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);console.log('Bento inbox: 4 sizes, inline paging, read-all, badge, disabled module, corruption/rebuild and legacy layouts passed');app.exit(0);}).catch(e=>{console.error(e,errors);app.exit(1);});});});
async function run(c){
 const js=code=>c.executeJavaScript(code);
 async function reload(){const loaded=new Promise(resolve=>c.once('did-finish-load',resolve));c.reload();await loaded;}
 async function capture(name){await sleep(700);fs.writeFileSync(path.join(artifacts,`${name}.png`),(await c.capturePage()).toPNG());}
 await until(c,`!!window.NotchTaskInbox && !workspaceReloadPending && sessionStorage.getItem('notch-workspace-hydrated')==='1' && document.getElementById('home-inbox-badge').textContent==='3'`);
 await js('setMode(true)');await sleep(800);
 const initial=await js(`({sizes:{...homeSizes},hidden:[...hiddenHomeModules],order:[...homeOrder],layout:JSON.parse(JSON.stringify(homeWorkingLayout))})`);
 assert.equal(await js(`document.getElementById('task-inbox-toggle')===null && document.getElementById('task-inbox-dialog')===null`),true);
 assert.equal(await js(`document.querySelectorAll('.home-inbox-row').length`),5);
 const positions=await js(`({inbox:homeWorkingLayout.placements.inbox,windows:homeWorkingLayout.placements.windows,linkMargin:getComputedStyle(document.getElementById('tab-button-links')).marginRight})`);
 const windowsAvailable=await js(`!notchAPI.capabilities.unavailableHomeModules.includes('windows')`);
 assert.deepEqual(positions.inbox,{column:8,row:0,width:4,height:2});assert.deepEqual(positions.windows,windowsAvailable?{column:8,row:2,width:4,height:2}:undefined);assert.equal(positions.linkMargin,'0px');
 assert.equal(await js(`NotchHome.isVisible('windows')`),windowsAvailable,'default layout respects native capability gating');
 assert.equal(await js(`getComputedStyle(document.getElementById('home-inbox')).backgroundImage.includes('radial-gradient')`),true);
 assert.equal(await js(`document.getElementById('home-inbox-badge').hidden`),true,'B3: selected home hides badge');
 await capture('default-medium');
 await js(`setActiveTab('notes')`);await until(c,`document.querySelector('.tab.active').dataset.tab==='notes'`);assert.equal(await js(`document.getElementById('home-inbox-badge').hidden`),false);await capture('notes-badge');
 await js(`document.getElementById('home-inbox-badge').click()`);await until(c,`document.querySelector('.tab.active').dataset.tab==='home' && document.getElementById('home-inbox').classList.contains('inbox-highlight')`);await capture('highlight');await sleep(650);assert.equal(await js(`document.getElementById('home-inbox').classList.contains('inbox-highlight')`),false);
 for(const [size,count] of [['mini',0],['small',3],['medium',5],['large',10]]){
  await js(`(() => {homeSizes={...homeSizes,inbox:${JSON.stringify(size)}};hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!['recorder','inbox'].includes(id));homeWorkingLayout=null;const layout=NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules);applyHomeLayout(layout,{reason:'initial'});})()`);
  await until(c,`document.getElementById('home-inbox').dataset.widgetSize==='${size}' && document.querySelectorAll('.home-inbox-row').length===${count}`);
  assert.equal(await js(`Array.from(document.querySelectorAll('.home-inbox-copy strong')).every(el=>el.title===el.textContent)`),true);
  if(size==='small')assert.equal(await js(`getComputedStyle(document.getElementById('home-inbox-read-all')).display!=='none' && getComputedStyle(document.getElementById('home-inbox-latest')).display!=='none'`),true);
  if(size==='mini')assert.equal(await js(`document.getElementById('home-inbox-unread').textContent`),'3');
  const overflow=await js(`(()=>{const t=document.getElementById('home-inbox');return {w:t.scrollWidth<=t.clientWidth+1,h:t.scrollHeight<=t.clientHeight+1}})()`);assert(overflow.w&&overflow.h,`inbox ${size} overflows`);await capture(size);
 }
 await js(`document.querySelector('.home-inbox-row').click()`);await until(c,`document.getElementById('home-inbox-badge').textContent==='2'`);assert.equal((await js('window.notchAPI.getTaskInbox()')).unread,2);assert.equal(await js(`document.querySelector('.home-inbox-detail')`),null);await until(c,`document.getElementById('task-inbox-status').textContent.length>0`);await capture('large-detail');
 await until(c,`document.querySelectorAll('.home-inbox-row').length===10`);
 await js(`document.querySelector('.home-inbox-pagination button:last-child').click()`);await until(c,`document.querySelector('.home-inbox-pagination span')?.textContent==='第 2 页'`);assert.equal(await js(`document.getElementById('task-inbox-dialog')===null`),true);
 await js(`document.getElementById('home-inbox-read-all').click()`);await until(c,`document.getElementById('home-inbox-unread-label').textContent==='' && document.getElementById('home-inbox-read-all').disabled`);assert.equal((await js('window.notchAPI.getTaskInbox()')).unread,0);
 while(!port)await sleep(10);
 const send=payload=>fetch(`http://127.0.0.1:${port}/notify/codex`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 for(let i=0;i<12;i++)assert.equal((await send({event_id:`bento-new-${i}`,title:`新完成 ${i}`})).status,202);
 await until(c,`document.getElementById('home-inbox-badge').textContent==='9+'`);
 assert.equal(await js(`document.getElementById('home-inbox-badge').hidden`),true);
 await js(`setActiveTab('notes')`);await until(c,`!document.getElementById('home-inbox-badge').hidden`);
 assert.equal(await js(`(()=>{const b=document.getElementById('home-inbox-badge').getBoundingClientRect(),t=document.querySelector('#tab-button-home .tab-label').getBoundingClientRect();return b.left>=t.right || b.bottom<=t.top})()`),true,'B3: 9+ does not cover home label');
 await capture('notes-9plus-badge');await js(`setActiveTab('home')`);
 await js(`homeSizes=${JSON.stringify(initial.sizes)};hiddenHomeModules=${JSON.stringify(initial.hidden)};homeOrder=${JSON.stringify(initial.order)};homeWorkingLayout=${JSON.stringify(initial.layout)};applyHomeLayout(homeWorkingLayout,{reason:'initial'});`);
 const beforeToggle=await js(`({sizes:{...homeSizes},placements:JSON.parse(JSON.stringify(homeWorkingLayout.placements))})`);
 const disabled=await js(`NotchHome.setModuleVisible('inbox',false)`);assert.equal(disabled.ok,true);await js(`setActiveTab('notes')`);await until(c,`document.querySelector('.tab.active').dataset.tab==='notes'`);assert.equal(await js(`document.getElementById('home-inbox-badge').hidden`),false);
 assert.equal(await js(`document.getElementById('home-inbox-badge').dataset.dot`),'true','B4: closed module shows dot');assert.equal(await js(`document.getElementById('home-inbox-badge').textContent`),'');
 await js(`document.getElementById('home-inbox-badge').click()`);await until(c,`document.querySelector('.tab.active').dataset.tab==='settings'`);assert.equal(await js(`document.activeElement.matches('[data-settings-home-module="inbox"]')`),true);
 // The retained slot must survive a real renderer reload while disabled.
 await reload();await until(c,`!!window.NotchTaskInbox && !!window.NotchHome && !NotchHome.isVisible('inbox')`);
 assert.equal((await js(`NotchHome.setModuleVisible('inbox',true)`)).ok,true);
 const afterToggle=await js(`({sizes:{...homeSizes},placements:JSON.parse(JSON.stringify(homeWorkingLayout.placements))})`);
 assert.deepEqual(afterToggle,beforeToggle,'B5: off/reload/on preserves every footprint and position');await js(`setActiveTab('home')`);await until(c,`document.querySelector('.tab.active').dataset.tab==='home'`);
 fs.writeFileSync(path.join(profile,'task-inbox.json'),'broken-bento-fixture');assert.equal((await send({event_id:'bento-corrupt',title:'不得吞掉错误'})).status,503);await until(c,`document.getElementById('home-inbox-badge').textContent==='!'`);
 await js('window.NotchTaskInbox.refresh()');await until(c,`!document.getElementById('task-inbox-rebuild').hidden`);assert.equal(await js(`document.getElementById('home-inbox').dataset.error`),'true');assert.equal(await js(`document.getElementById('home-inbox-read-all').hidden`),true,'B6: error hides read-all');assert.equal(await js(`document.getElementById('task-inbox-status').textContent.includes('请打开收件箱')`),false,'B2: no obsolete dialog wording');await capture('corrupt');
 await js(`setActiveTab('notes')`);await until(c,`document.querySelector('.tab.active').dataset.tab==='notes'`);await capture('notes-error-badge');await js(`setActiveTab('home')`);await until(c,`document.querySelector('.tab.active').dataset.tab==='home'`);
 await js(`document.getElementById('task-inbox-rebuild').click()`);await sleep(200);assert.equal(fs.readFileSync(path.join(profile,'task-inbox.json'),'utf8'),'broken-bento-fixture');confirm=true;
 await js(`document.getElementById('task-inbox-rebuild').click()`);await until(c,`document.getElementById('task-inbox-status').textContent.includes('已重建')`);assert(fs.readdirSync(profile).some(name=>name.startsWith('task-inbox.json.corrupt-')));assert.equal((await js('window.notchAPI.getTaskInbox()')).total,0);await js('window.NotchTaskInbox.refresh()');await capture('empty');
 assert.equal((await send({event_id:'bento-restored',title:'恢复接收'})).status,202);await until(c,`document.getElementById('home-inbox-badge').textContent==='1'`);
 // Real reload of a v0.11-era full custom layout must not overwrite its sizes.
 const oldPositions={cursor:{column:0,row:0,width:4,height:4},recorder:{column:4,row:0,width:4,height:4},note:{column:8,row:0,width:4,height:4}};
 const oldSizes={...initial.sizes,cursor:'large',recorder:'large',note:'large'};delete oldSizes.inbox;
 await js(`localStorage.setItem('notch-home-placements-v1',${JSON.stringify(JSON.stringify(oldPositions))});localStorage.setItem('notch-home-widget-sizes-v2',${JSON.stringify(JSON.stringify(oldSizes))});localStorage.setItem('notch-home-hidden-modules-v1',JSON.stringify(HOME_MODULE_REGISTRY.filter(id=>!['cursor','recorder','note','inbox'].includes(id))));localStorage.setItem('notch-home-order-v3',JSON.stringify(HOME_MODULE_REGISTRY.filter(id=>id!=='inbox')));`);await reload();
 await until(c,`!!window.NotchHome && !!window.NotchTaskInbox && document.getElementById('home-inbox-badge').dataset.dot==='true' && document.getElementById('home-inbox-unread-label').textContent==='1 条未读'`);await js('setMode(true)');
 const migrated=await js(`({sizes:JSON.parse(localStorage.getItem('notch-home-widget-sizes-v2')),placements:homeWorkingLayout.placements,hidden:NotchHome.getVisibility().hiddenIds})`);
 for(const id of Object.keys(oldSizes))assert.equal(migrated.sizes[id],oldSizes[id]);assert.deepEqual(migrated.placements,oldPositions);assert(migrated.hidden.includes('inbox'));assert.equal(await js(`NotchDomain.validateHomeWidgetLayout(homeWorkingLayout,['cursor','recorder','note'])`),true);
 const legacyOrder=['music','pomodoro','cursor','windows','recorder','mirror','note','commands','sun'];
 const legacySizes={...initial.sizes,windows:'large'};delete legacySizes.inbox;
 const legacyPositions=await js(`NotchDomain.resolveHomeWidgetLayout(${JSON.stringify(legacyOrder)},${JSON.stringify(legacySizes)},['sun']).placements`);
 await js(`localStorage.setItem('notch-home-placements-v1',${JSON.stringify(JSON.stringify(legacyPositions))});localStorage.setItem('notch-home-widget-sizes-v2',${JSON.stringify(JSON.stringify(legacySizes))});localStorage.setItem('notch-home-order-v3',${JSON.stringify(JSON.stringify(legacyOrder))});localStorage.setItem('notch-home-hidden-modules-v1','["sun"]');`);await reload();
 await until(c,`!!window.NotchHome && !!window.NotchTaskInbox && document.getElementById('home-inbox-badge').textContent==='1'`);
 assert.equal(await js(`NotchHome.isVisible('inbox')`),true);assert.equal(await js(`homeSizes.windows`),'medium');assert.deepEqual(await js(`homeWorkingLayout.placements.inbox`),{column:8,row:0,width:4,height:2});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({fourSizes:true,inlinePaging:true,readAll:true,badge:true,disabledModule:true,corruption:true,rebuild:true,legacyLayout:true,selectedHomeBadgeHidden:true,disabledBadgeDot:true,togglePreservesLayout:true,consoleErrors:errors},null,2));
}
require('../main.js');
