'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,dialog,BrowserWindow}=require('electron');
const sourceCalls=[];
const sourceApps={codex:{pid:101,appName:'ChatGPT',bundleId:'fixture.codex'},cursor:{pid:102,appName:'Cursor',bundleId:'fixture.cursor'},claude:{pid:103,appName:'Terminal',bundleId:'fixture.terminal'}};
// Never open host applications from integration tests.
const adapters=require('../platform-adapters'),originalAdapter=adapters.loadAdapter;
adapters.loadAdapter=(...args)=>{
 const adapter=originalAdapter(...args);
 adapter.windows.resolveTaskApp=async source=>sourceApps[source]||null;
 adapter.taskApps.open=async record=>{sourceCalls.push({source:record.source,cwd:record.window?.cwd||null});return {ok:true,message:'已打开来源软件。'};};
 return adapter;
};
const profile=process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken=()=>({ok:false,error:'fixture_missing'});
require('../cursor-usage').fetchCursorUsage=async()=>({ok:false,error:'fixture_offline'});
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});
require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_missing'});
process.env.POME_TEST_NOTIFICATIONS='1';
const archived=Array.from({length:250},(_,i)=>({id:`note-${i}`,title:`笔记 ${i}`,content:`正文 ${i}`,createdAt:1,updatedAt:2}));
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'notch-home-note':'# 原始备份内容\n\n预览不能叠字','notch-note-archive-v1':JSON.stringify(archived),'notch-todo-data':JSON.stringify({P0:[{id:'t1',text:'真实待办',done:false,createdAt:1,deadline:'',remindedAt:0}],P1:[],P2:[],P3:[]}),'notch-test-preference':'keep'}}));
const destination=path.join(profile,'export.pome-backup.zip');
dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[destination]});
dialog.showMessageBox=async()=>({response:1});
const errors=[];let port;
app.on('pome-test-notification-port',value=>{port=value;});
const watchdog=setTimeout(()=>{console.error('Work hub integration timed out',errors);process.exit(1);},60000);
async function until(c,expression){for(let i=0;i<300;i++){try{if(await c.executeJavaScript(expression))return;}catch{}await new Promise(r=>setTimeout(r,30));}throw new Error(`Timed out: ${expression}`);}
let started=false;
app.on('web-contents-created',(_event,c)=>{
 c.on('console-message',details=>{if(details.level==='error'&&!details.message.includes('ERR_'))errors.push(details.message);});
 c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);console.log('Work hub production Electron checks passed');app.exit(0);}).catch(e=>{console.error(e,errors);app.exit(1);});});
});
async function run(c){
 await until(c,`!!window.NotchWorkspace && document.getElementById('home-note').value.includes('原始备份内容')`);
 await c.executeJavaScript('setMode(true)');
 assert.equal(await c.executeJavaScript(`getComputedStyle(document.getElementById('home-note')).display`),'none');
 assert.equal(await c.executeJavaScript(`document.getElementById('credential-password').type`),'password');
 const exported=await c.executeJavaScript('window.notchAPI.backupExport()');assert.equal(exported.ok,true,JSON.stringify(exported));
 const inspected=await require('../workspaceBackup').inspectWorkspaceBackup(destination);
 assert.equal(JSON.parse(inspected.storage['notch-note-archive-v1']).length,250);assert.equal(JSON.parse(inspected.storage['notch-todo-data']).P0[0].text,'真实待办');inspected.dispose();
 const preview=await c.executeJavaScript('window.notchAPI.backupPreview()');assert.equal(preview.ok,true,JSON.stringify(preview));
 await c.executeJavaScript(`document.getElementById('home-note').value='确认后发生变化';localStorage.setItem('notch-home-note','确认后发生变化')`);
 const stale=await c.executeJavaScript(`window.notchAPI.backupRestore(${JSON.stringify(preview.previewId)})`);assert.equal(stale.error,'preview_expired');
 while(!port)await new Promise(r=>setTimeout(r,10));
 for(let i=0;i<50;i++){
  const response=await fetch(`http://127.0.0.1:${port}/notify/${['codex','claude','cursor'][i%3]}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:`completion-${i}`,taskId:`task-${i}`,title:`完成 ${i}`,project:'fixture',cwd:'/Users/fixture/AICompanion'})});assert.equal(response.status,202);
 }
 let inbox=await c.executeJavaScript('window.notchAPI.getTaskInbox()');assert.equal(inbox.total,50);assert.equal(inbox.items.length,20);assert.equal(inbox.unread,50);
 await c.executeJavaScript(`setActiveTab('home')`);await until(c,`document.querySelectorAll('.home-inbox-row').length===5`);
 await c.executeJavaScript(`document.querySelector('.home-inbox-pagination button:last-child').click()`);await until(c,`document.querySelector('.home-inbox-pagination span').textContent==='第 2 页'`);
 await c.executeJavaScript(`document.querySelector('.home-inbox-row').click()`);await until(c,`document.getElementById('home-inbox-unread-label').textContent==='49 条未读'`);
 const inboxDisk=JSON.parse(fs.readFileSync(path.join(profile,'task-inbox.json')));assert.equal(inboxDisk.records.filter(r=>r.readAt!==null).length,1);
 for(const source of ['codex','cursor','claude']){
  const record=inbox.items.find(row=>row.source===source);
  assert.equal(record.window.bundleId,`fixture.${source==='claude'?'terminal':source}`);assert.equal(record.window.cwd,'/Users/fixture/AICompanion');
  const opened=await c.executeJavaScript(`window.notchAPI.openTaskSource(${JSON.stringify(record.id)})`);
  assert.equal(opened.ok,true);assert.deepEqual(sourceCalls.at(-1),{source,cwd:'/Users/fixture/AICompanion'});
 }
 assert.equal((await c.executeJavaScript(`window.notchAPI.openTaskSource('unknown-record')`)).ok,false);
 // Inline inbox follows the ordinary Escape collapse policy.
 c.send('key:escape');await until(c,`!document.getElementById('app').classList.contains('expanded')`);await c.executeJavaScript('setMode(true)');
 const second=await c.executeJavaScript('window.notchAPI.backupPreview()');assert.equal(second.ok,true);
 await c.executeJavaScript(`window.notchAPI.backupRestore(${JSON.stringify(second.previewId)})`).catch(()=>{});
 await until(c,`document.getElementById('home-note').value.includes('原始备份内容') && !!window.NotchWorkspace`);
 assert.equal(await c.executeJavaScript(`localStorage.getItem('notch-test-preference')`),'keep');
 inbox=await c.executeJavaScript('window.notchAPI.getTaskInbox()');assert.equal(inbox.total,50);assert.equal(inbox.unread,49);
 const snapshots=fs.readdirSync(path.join(profile,'workspace-snapshots'));assert.equal(snapshots.length,1);
 const previous=await require('../workspaceBackup').inspectWorkspaceBackup(path.join(profile,'workspace-snapshots',snapshots[0]));assert.equal(previous.storage['notch-home-note'],'确认后发生变化');previous.dispose();
 // Screenshot is an inspectable result of the actual production renderer.
 await c.executeJavaScript('setMode(true)');await c.executeJavaScript(`setActiveTab('home');window.NotchTaskInbox.refresh()`);await until(c,`document.querySelectorAll('.home-inbox-row').length===5`);
 const artifacts=path.join(__dirname,'../dist.noindex/iteration-validation/ui');fs.mkdirSync(artifacts,{recursive:true});
 await new Promise(resolve=>setTimeout(resolve,650));
 fs.writeFileSync(path.join(artifacts,'inbox.png'),(await c.capturePage()).toPNG());
 await c.executeJavaScript(`setActiveTab('home')`);
 await new Promise(resolve=>setTimeout(resolve,300));
 fs.writeFileSync(path.join(artifacts,'home.png'),(await c.capturePage()).toPNG());
 const inboxPath=path.join(profile,'task-inbox.json'), intact=fs.readFileSync(inboxPath);
 fs.writeFileSync(inboxPath,'broken-review-fixture');
 const rejected=await fetch(`http://127.0.0.1:${port}/notify/codex`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:'after-corruption',taskId:'after-corruption',title:'不得虚报成功'})});
 assert.equal(rejected.status,503);await until(c,`document.getElementById('home-inbox-badge').textContent==='!'`);
 const failedState=await c.executeJavaScript('window.notchAPI.getTaskInbox()');assert.equal(failedState.ok,false);assert.equal(fs.readFileSync(inboxPath,'utf8'),'broken-review-fixture');
 await c.executeJavaScript(`window.NotchTaskInbox.refresh()`);
 await until(c,`!document.getElementById('task-inbox-rebuild').hidden`);
 await c.executeJavaScript(`setMode(true)`);
 await new Promise(r=>setTimeout(r,650));
 assert.equal(await c.executeJavaScript(`document.getElementById('task-inbox-dialog')===null`),true);
 fs.writeFileSync(path.join(artifacts,'inbox-rebuild-confirm.png'),(await c.capturePage()).toPNG());
 dialog.showMessageBox=async()=>({response:0});
 const canceled=await c.executeJavaScript('window.notchAPI.rebuildTaskInbox()');assert.equal(canceled.canceled,true);assert.equal(fs.readFileSync(inboxPath,'utf8'),'broken-review-fixture');
 dialog.showMessageBox=async (...args)=>{const options=args.at(-1);assert(options.detail.includes('.corrupt-'));return {response:1};};
 await c.executeJavaScript(`document.getElementById('task-inbox-rebuild').click()`);await until(c,`document.getElementById('task-inbox-status').textContent.includes('已重建')`);
 const backup=fs.readdirSync(profile).find(n=>n.startsWith('task-inbox.json.corrupt-'));assert(backup);assert.equal(fs.readFileSync(path.join(profile,backup),'utf8'),'broken-review-fixture');
 const send=payload=>fetch(`http://127.0.0.1:${port}/notify/codex`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const event={event_id:'stable-after-rebuild',taskId:'same-session',title:'重建后完成'};
 assert.equal((await send(event)).status,202);
 await new Promise(r=>setTimeout(r,2100));
 const duplicate=await send(event);assert.equal((await duplicate.json()).result,'duplicate');
 const incomplete=await send({taskId:'missing-identity',title:'旧钩子无身份也接收'});assert.equal(incomplete.status,202);const legacy=(await c.executeJavaScript('window.notchAPI.getTaskInbox()')).items.find(row=>row.taskId==='missing-identity');await c.executeJavaScript(`window.notchAPI.markTaskRead(${JSON.stringify(legacy.id)})`);
 await c.executeJavaScript(`(async()=>window.notchAPI.markTaskRead((await window.notchAPI.getTaskInbox()).items.find(row=>row.taskId==='same-session').id))()`);
 assert.equal((await send({...event,event_id:'next-round'})).status,202);
 // Preserve the original history in a separate file for the process-restart assertions.
 fs.writeFileSync(path.join(profile,'inbox-before-rebuild.json'),intact);
 await c.executeJavaScript(`window.NotchTaskInbox.refresh()`);
 await until(c,`document.getElementById('home-inbox-badge').textContent==='1'`);
 const rebuilt=await c.executeJavaScript('window.notchAPI.getTaskInbox()');assert.equal(rebuilt.total,3);assert.equal(rebuilt.unread,1);
 assert.deepEqual(errors,[]);
}
require('../main.js');
