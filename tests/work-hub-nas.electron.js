'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,dialog}=require('electron');const profile=process.env.TODO_TEST_USER_DATA;
const {normalizeSyncedCompletion}=require('../packages/sync-protocol');
const {openSyncStore,TODO_PRIORITIES}=require('../sync-store');
const {accountIdFromBinding}=require('../todos-sync');
require('../taskInbox').createTaskInbox({filePath:path.join(profile,'task-inbox.json')}).accept({source:'codex',eventId:'recovery-kept-completion',title:'保留完成历史'});
app.commandLine.appendSwitch('user-data-dir',profile);if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken=()=>({ok:false,error:'fixture_missing'});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false,error:'fixture_offline'});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_missing'});
const {createPersistentStore}=require('../fnos/app/server/persistentStore');let store=createPersistentStore({filePath:path.join(profile,'nas.bin'),serverId:'nas-fixture'});
const nas=require('../fnos/app/server/createApp').createApp({listenMode:'device-port',store});const listening=new Promise(r=>nas.server.listen(0,'127.0.0.1',r));
const destination=path.join(profile,'backup.zip');dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[destination]});
const backupTodos=Object.fromEntries(TODO_PRIORITIES.map(priority=>[priority,[{id:`recovery-${priority}`,text:`备份 ${priority}`,done:false,createdAt:1,deadline:'',remindedAt:0}]]));
const backupCategories=Object.fromEntries(TODO_PRIORITIES.map(priority=>[priority,`分类 ${priority}`]));
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'notch-home-note':'# 本机备份首页',
 'notch-todo-data':JSON.stringify(backupTodos),'notch-todo-category-names-v1':JSON.stringify(backupCategories)}}));
let phase='startup';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const watchdog=setTimeout(()=>{console.error('NAS Electron tests timed out during '+phase);app.exit(1);},60000);
async function until(c,expr){for(let i=0;i<300;i++){try{if(await c.executeJavaScript(expr))return;}catch{}await sleep(30);}throw new Error('timeout: '+expr);}
let started=false;app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);nas.server.close();console.log('Paired restore pause, invalidated preview, verified NAS overwrite and rollback checks passed');app.exit(0);}).catch(e=>{console.error(e);app.exit(1);});}));
async function run(c){
 const ready=`!!window.NotchWorkspace && !workspaceReloadPending && sessionStorage.getItem('notch-workspace-hydrated')==='1' && document.getElementById('home-note').value==='# 本机备份首页'`;
 await until(c,ready);await c.executeJavaScript('setMode(true)');
 phase='backup export';
 const exported=await c.executeJavaScript('window.notchAPI.backupExport()');assert.equal(exported.ok,true);
 await listening;const baseUrl=`http://127.0.0.1:${nas.server.address().port}`,pairingCode=store.startPairing({uid:'u'}).code;
 phase='pair claim';
 const pair=await c.executeJavaScript(`window.notchAPI.syncPairClaim({baseUrl:${JSON.stringify(baseUrl)},pairingCode:${JSON.stringify(pairingCode)}})`);assert.equal(pair.ok,true,JSON.stringify(pair));
 const accountId=accountIdFromBinding(pair.status);
 phase='migration';
 const migration=await c.executeJavaScript(`window.notchAPI.syncRunMigration({localTodosJson:localStorage.getItem('notch-todo-data'),workspace:getWorkspaceSnapshotForSync()})`);assert.equal(migration.ok,true,JSON.stringify(migration));
 for(const priority of TODO_PRIORITIES)assert.equal(store.bucket('u').live.get(`recovery-${priority}`).payload.categoryId,priority);
 const categoriesBeforeOverwrite=Object.fromEntries(TODO_PRIORITIES.map(priority=>[priority,store.bucket('u').live.get(`category:${priority}`)?.payload.name]));
 const indexFile=path.join(profile,'sync-workspace-index.json');
 const completionIndex=()=>Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(indexFile)).hashes).filter(([id])=>id.startsWith('completion:')));
 // Migration seeds its existing UID-keyed cursor; recovery must preserve it.
 const completionCursor=()=>{const db=openSyncStore(path.join(profile,'sync.db'));try{return db.getPullCursor(pair.status.uid,'aiCompletions').cursor;}finally{db.close();}};
 const initialCompletionIndex=completionIndex(),initialCompletionCursor=completionCursor();assert.equal(Object.keys(initialCompletionIndex).length,1);assert.notEqual(initialCompletionCursor,null);
 store.applyPush('u',[{collection:'notes',entityId:'note:nas-only',op:'upsert',payload:{kind:'archive',id:'nas-only',title:'NAS 独有',content:'必须预览删除'},clientMutationId:'nas-only',deviceId:'other',baseServerRev:store.bucket('u').serverRev}],{deviceId:'other'});
 phase='restore preview';
 const preview=await c.executeJavaScript('window.notchAPI.backupPreview()');assert.equal(preview.ok,true,JSON.stringify(preview));
 phase='restore';
 const duplicateRestore=await c.executeJavaScript(`(()=>{window.firstRestore=window.notchAPI.backupRestore(${JSON.stringify(preview.previewId)});return window.notchAPI.backupRestore(${JSON.stringify(preview.previewId)})})()`);
 assert.equal(duplicateRestore.error,'workspace_switching','concurrent restores must not share the staging area');
 await c.executeJavaScript('window.firstRestore').catch(()=>{});
 await until(c,ready);
 phase='paused sync';
 let status=await c.executeJavaScript('window.notchAPI.syncGetStatus()');assert.equal(status.recovery.paused,true);
 const pendingCompletion=normalizeSyncedCompletion({id:'during-pause',source:'cursor',receivedAt:Date.now(),readAt:null,title:'暂停期间的远端完成'});
 store.applyPush('u',[{collection:'aiCompletions',entityId:`completion:${pendingCompletion.id}`,op:'upsert',payload:pendingCompletion,clientMutationId:'completion-during-pause',deviceId:'other',baseServerRev:store.bucket('u').serverRev}],{deviceId:'other'});
 const rev=store.bucket('u').serverRev;const retry=await c.executeJavaScript('window.notchAPI.syncRetry()');assert.equal(retry.error,'sync_paused_after_restore');assert.equal(store.bucket('u').serverRev,rev);
 // Persisted pause survives renderer reinitialization and prevents SQLite overriding restored notes/todos.
 phase='renderer reload';
 await c.executeJavaScript('sessionStorage.clear()');
 const reloaded=new Promise(resolve=>c.once('did-finish-load',resolve));c.reload();await reloaded;await until(c,ready);
 phase='recovery preview';
 status=await c.executeJavaScript('window.notchAPI.syncGetStatus()');assert.equal(status.recovery.paused,true);
 // All eight task and category names changed while paused must survive overwrite,
 // including P4–P7, and rollback must restore their previous values.
 await c.executeJavaScript(`PRIORITIES.forEach(priority=>{data[priority][0].text='暂停修改 '+priority;todoCategoryNames[priority]='暂停分类 '+priority;});
   localStorage.setItem('notch-todo-data',JSON.stringify(data));localStorage.setItem('notch-todo-category-names-v1',JSON.stringify(todoCategoryNames));void 0`);
 const impact=await c.executeJavaScript('window.notchAPI.recoveryPreview()');assert.equal(impact.ok,true,JSON.stringify(impact));assert(impact.deletes.includes('note:nas-only'));
 for(const priority of TODO_PRIORITIES){assert(!impact.deletes.includes(`recovery-${priority}`));assert(!impact.deletes.includes(`category:${priority}`));
   assert(impact.updates.includes(`recovery-${priority}`));assert([...impact.adds,...impact.updates].includes(`category:${priority}`));}
 await c.executeJavaScript(`document.getElementById('home-note').value='# 暂停期间新修改';localStorage.setItem('notch-home-note','# 暂停期间新修改')`);
 phase='stale recovery';
 const stale=await c.executeJavaScript(`window.notchAPI.recoveryExecute(${JSON.stringify(impact.previewId)})`);assert.equal(stale.error,'preview_expired');assert.equal(store.bucket('u').serverRev,rev);
 const expiredImpact=await c.executeJavaScript('window.notchAPI.recoveryPreview()');assert.equal(expiredImpact.ok,true);
 const beforeExpiry=await c.executeJavaScript('window.notchAPI.syncGetStatus()');const expiredId=beforeExpiry.recovery.operationId;const state=store.recovery.state('u');
 store.recovery.prepare('u',{operationId:expiredId,baseServerRev:state.serverRev,fingerprint:state.fingerprint},pair.status.deviceId);store.recovery.verify('u',expiredId,pair.status.deviceId);store.bucket('u').recoveries.get(expiredId).createdAt=Date.now()-2*86400000;
 phase='expired recovery';
 const expiredResult=await c.executeJavaScript(`window.notchAPI.recoveryExecute(${JSON.stringify(expiredImpact.previewId)})`);assert.equal(expiredResult.error,'recovery_expired');const afterExpiry=await c.executeJavaScript('window.notchAPI.syncGetStatus()');assert.equal(afterExpiry.recovery.paused,true);assert.notEqual(afterExpiry.recovery.operationId,expiredId);
 const fresh=await c.executeJavaScript('window.notchAPI.recoveryPreview()');assert.equal(fresh.ok,true,JSON.stringify(fresh));
 phase='verified recovery';
 const [covered,duplicateRecovery]=await c.executeJavaScript(`Promise.all([window.notchAPI.recoveryExecute(${JSON.stringify(fresh.previewId)}),window.notchAPI.recoveryExecute(${JSON.stringify(fresh.previewId)})])`);assert.equal(duplicateRecovery.error,'workspace_switching');assert.equal(covered.ok,true,JSON.stringify(covered));assert.equal(store.bucket('u').live.has('note:nas-only'),false);assert.equal(store.bucket('u').live.get('note:home').payload.markdown,'# 暂停期间新修改');
 for(const priority of TODO_PRIORITIES){assert.equal(store.bucket('u').live.get(`recovery-${priority}`).payload.text,`暂停修改 ${priority}`);
   assert.equal(store.bucket('u').live.get(`category:${priority}`).payload.name,`暂停分类 ${priority}`);}
 const projection=openSyncStore(path.join(profile,'sync.db'));try{
   const projected=projection.buildTodosLocalStorageProjection(accountId);
   for(const priority of TODO_PRIORITIES){assert.equal(projected.todos[priority][0].text,`暂停修改 ${priority}`);assert.equal(projected.categoryNames[priority],`暂停分类 ${priority}`);}
 }finally{projection.close();}
 assert.deepEqual(completionIndex(),initialCompletionIndex);assert.equal(completionCursor(),initialCompletionCursor);assert(store.bucket('u').live.has(`completion:${pendingCompletion.id}`));
 status=await c.executeJavaScript('window.notchAPI.syncGetStatus()');assert.equal(status.recovery.paused,false);
 const operationId=status.recovery.operationId;const restarted=createPersistentStore({filePath:path.join(profile,'nas.bin'),serverId:'nas-fixture'});assert.equal(restarted.recovery.get('u',operationId,pair.status.deviceId).status,'committed');
 phase='recovery rollback';
 const rolled=await c.executeJavaScript(`window.notchAPI.recoveryRollback(${JSON.stringify(operationId)})`);assert.equal(rolled.ok,true,JSON.stringify(rolled));assert(store.bucket('u').live.has('note:nas-only'));assert(rolled.rollbackRev>covered.serverRev);
 for(const priority of TODO_PRIORITIES){assert.equal(store.bucket('u').live.get(`recovery-${priority}`).payload.text,`备份 ${priority}`);
   assert.equal(store.bucket('u').live.get(`category:${priority}`)?.payload.name,categoriesBeforeOverwrite[priority]);}
 status=await c.executeJavaScript('window.notchAPI.syncGetStatus()');assert.equal(status.recovery.paused,true);
 const artifacts=path.join(__dirname,'../dist.noindex/iteration-validation/nas-integration');fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({pairedRestorePaused:true,previewInvalidated:true,deletedNasOnly:true,serverRev:covered.serverRev,rollbackRev:rolled.rollbackRev,snapshot:store.recovery.get('u',operationId,pair.status.deviceId)},null,2));
}
require('../main.js');
