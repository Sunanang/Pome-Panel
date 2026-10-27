'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskInbox, completionEventId, rebuildTaskInbox, MAX_RECORDS } = require('../taskInbox');
const { createPersistentStore } = require('../fnos/app/server/persistentStore');
const { digest } = require('../fnos/app/server/recovery');
const { pullFullSnapshot, pullWorkspacePages, planWorkspaceSync, entityHash } = require('../workspace-sync');
const DAY = 86400000;
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-capacity-')); t.after(() => fs.rmSync(dir, {recursive:true, force:true})); return dir; }
function mutation(id, key, base = 0, op = 'upsert') { return {schemaVersion:1, collection:'todos', entityId:id, payload:{text:key, categoryId:'P0',done:false}, op, clientMutationId:key, deviceId:'a', baseServerRev:base, clientTime:1}; }
function fixture(t, options = {}) { let clock = 100000; const args = {filePath:path.join(directory(t),'state.bin'), serverId:'s', now:()=>clock, maintenanceIntervalMs:Infinity, ...options}; let store = createPersistentStore(args); return {get store(){return store;}, args, advance(ms){clock+=ms;}, reload(){store=createPersistentStore(args);return store;}}; }
function transport(store, deviceId = 'a') { return async args => {const body={schemaVersion:1,minSupported:1,maxSupported:1,...store.pull('u',{...args,deviceId})};return {ok:!body.error,error:body.error,body};}; }

test('completion ID dedupes delayed retries, restart and retains successive completions in one session', t => {
 const filePath=path.join(directory(t),'inbox.json');let clock=10000,inbox=createTaskInbox({filePath,now:()=>clock});
 const first={source:'claude',taskId:'session',completedAt:'2026-10-13T02:00:00Z',title:'完成'};
 const row=inbox.accept(first).record;inbox.markRead(row.id);clock+=10000;
 assert.equal(inbox.accept(first).duplicate,true);inbox=createTaskInbox({filePath,now:()=>clock});clock+=10000;
 assert.equal(inbox.accept(first).duplicate,true);assert.equal(inbox.get(row.id).readAt,10000);assert.equal(inbox.get(row.id).receivedAt,10000);
 assert.equal(inbox.accept({...first,completedAt:'2026-10-13T02:01:00Z'}).duplicate,false);
 assert.equal(inbox.list().total,2);
 assert.equal(completionEventId({source:'codex',event_id:'same'}),completionEventId({source:'codex',eventId:'same'}));
 assert.notEqual(completionEventId({source:'cursor',event_id:'same'}),completionEventId({source:'codex',event_id:'same'}));
 assert.equal(inbox.accept({source:'gpt',taskId:'ambiguous'}).error,'invalid_source');
 assert.equal(inbox.accept({source:'gpt',completedAt:1}).error,'invalid_source');
 for(let i=0;i<MAX_RECORDS;i++) { clock++; inbox.accept({source:'codex',eventId:`capacity-${i}`}); }
 const saved=JSON.parse(fs.readFileSync(filePath));assert.equal(saved.records.length,MAX_RECORDS);assert.equal(Object.keys(saved.dedupe).length,MAX_RECORDS);
 assert.equal(inbox.accept(first).duplicate,false); // record and its dedupe were evicted together
});

test('inbox rebuild cancellation preserves bytes; confirmation keeps exact backup and works after restart', t => {
 const filePath=path.join(directory(t),'inbox.json');fs.writeFileSync(filePath,'broken');
 assert.equal(rebuildTaskInbox({filePath}).canceled,true);assert.equal(fs.readFileSync(filePath,'utf8'),'broken');
 const result=rebuildTaskInbox({filePath,confirmed:true,now:()=>1});assert(result.backupPath.includes('.corrupt-'));assert.equal(fs.readFileSync(result.backupPath,'utf8'),'broken');
 const inbox=createTaskInbox({filePath});assert.equal(inbox.accept({source:'cursor',eventId:'after-rebuild'}).ok,true);assert.equal(createTaskInbox({filePath}).list().total,1);
});

test('rebuild backup failure cannot empty original, and changed preview must be confirmed again', t => {
 const filePath=path.join(directory(t),'inbox.json');fs.writeFileSync(filePath,'broken');
 const disk=Object.create(fs);disk.renameSync=()=>{throw new Error('ENOSPC');};
 assert.throws(()=>rebuildTaskInbox({filePath,confirmed:true,disk}),/ENOSPC/);assert.equal(fs.readFileSync(filePath,'utf8'),'broken');
 assert.equal(rebuildTaskInbox({filePath,confirmed:true,expectedDigest:'stale'}).error,'preview_expired');assert.equal(fs.readFileSync(filePath,'utf8'),'broken');
});

test('logs require all paired acknowledgements; offline expiry requires an immutable paged full snapshot', async t => {
 const f=fixture(t);const s=f.store;s.issueToken({uid:'u',deviceId:'a'});s.issueToken({uid:'u',deviceId:'b'});
 for(let i=0;i<510;i++)s.applyPush('u',[mutation(`t${i}`,`k${i}`,i)],{deviceId:'a'});
 s.pull('u',{cursor:'510',deviceId:'a'});s.compact();assert.equal(s.bucket('u').changeLog.length,510);
 f.advance(91*DAY);s.compact();assert.equal(s.bucket('u').changeLog.length,0);assert.equal(s.pull('u',{cursor:'0',deviceId:'b'}).error,'full_resync_required');
 const first=s.pull('u',{full:true,collection:'todos',deviceId:'b'});assert.equal(first.changes.length,500);assert.equal(first.hasMore,true);
 s.applyPush('u',[mutation('later','later',510)],{deviceId:'a'});
 const second=s.pull('u',{cursor:first.nextCursor,full:true,collection:'todos',deviceId:'b'});assert.equal(second.changes.length,10);assert.equal(second.serverRev,510);assert.equal(second.nextCursor,'510');
 assert.equal(s.pull('u',{cursor:first.nextCursor,full:true,collection:'todos',deviceId:'a'}).error,'full_snapshot_expired');
 const full=await pullFullSnapshot({pullPage:transport(s,'b'),collection:'todos'});assert.equal(full.changes.length,511);
 f.reload();assert.equal(f.store.pull('u',{cursor:'0',deviceId:'b'}).error,'full_resync_required');
});

test('acknowledged prefix compacts without waiting 90 days and expired old mutations cannot execute again', t => {
 const f=fixture(t);const s=f.store;for(const deviceId of ['a','b'])s.issueToken({uid:'u',deviceId});
 const old=mutation('x','old');s.applyPush('u',[old],{deviceId:'a'});s.applyPush('u',[mutation('x','delete',1,'delete')],{deviceId:'a'});
 s.pull('u',{cursor:'2',deviceId:'a'});s.pull('u',{cursor:'2',deviceId:'b'});s.compact();assert.equal(s.bucket('u').logFloor,2);
 assert.equal(s.applyPush('u',[old],{deviceId:'a'}).applied[0].status,'duplicate');
 f.advance(91*DAY);s.compact();assert.equal(s.bucket('u').mutationResults.size,0);
 f.reload();assert.equal(f.store.applyPush('u',[old],{deviceId:'a'}).applied[0].status,'expired');assert.equal(f.store.bucket('u').live.has('x'),false);
 assert.equal(f.store.applyPush('u',[mutation('forged','future',9999)],{deviceId:'a'}).applied[0].status,'expired');assert.equal(f.store.bucket('u').serverRev,2);
 assert.equal(f.store.applyPush('u',[mutation('new','fresh',2)],{deviceId:'a'}).applied[0].status,'applied');
});

test('cleanup protects latest overwrite, rollback window and active snapshots while removing old unused ones', t => {
 const f=fixture(t,{retentionMs:5*DAY,rollbackWindowMs:30*DAY});const s=f.store;
 function prepare(id){const state=s.recovery.state('u');s.recovery.prepare('u',{operationId:id,baseServerRev:state.serverRev,fingerprint:state.fingerprint},'a');s.recovery.verify('u',id,'a');}
 function commit(id){s.recovery.commit('u',{operationId:id,chunkCount:0,entitiesHash:digest([])},'a');}
 s.applyPush('u',[mutation('x','x')],{deviceId:'a'});prepare('unused');prepare('old');commit('old');
 f.advance(6*DAY);prepare('latest');commit('latest');prepare('active');s.compact();assert(!s.bucket('u').recoveries.has('unused'));assert(s.bucket('u').recoveries.has('old'));assert(s.bucket('u').recoveries.has('latest'));assert(s.bucket('u').recoveries.has('active'));
 f.advance(31*DAY);s.compact();assert(!s.bucket('u').recoveries.has('old'));assert(!s.bucket('u').recoveries.has('active'));assert(s.bucket('u').recoveries.has('latest'));f.reload();assert(f.store.bucket('u').recoveries.has('latest'));
});

test('power loss before checkpoint rename retains old state; after rename replays only uncovered journal', t => {
 const disk=Object.create(fs),f=fixture(t,{fileSystem:disk});const s=f.store;s.applyPush('u',[mutation('x','x')],{deviceId:'a'});f.advance(91*DAY);
 disk.renameSync=(a,b)=>{if(b===f.args.filePath)throw new Error('power_loss');fs.renameSync(a,b);};assert.throws(()=>s.compact(),/power_loss/);assert.equal(s.bucket('u').logFloor,0);assert.equal(f.reload().bucket('u').changeLog.length,1);
 disk.renameSync=fs.renameSync;disk.unlinkSync=file=>{if(file.endsWith('.bin'))throw new Error('power_loss_after_checkpoint');fs.unlinkSync(file);};assert.throws(()=>f.store.compact(),/power_loss/);
 disk.unlinkSync=fs.unlinkSync;const loaded=f.reload();assert.equal(loaded.bucket('u').logFloor,1);assert.equal(loaded.bucket('u').changeLog.length,0);assert.equal(loaded.bucket('u').live.get('x').payload.text,'x');
 loaded.applyPush('u',[mutation('y','y',1)],{deviceId:'a'});assert.equal(f.reload().bucket('u').live.size,2);
});

test('workspace full resync fetches current versions and ordinary note conflict preservation still applies', async t => {
 const f=fixture(t),s=f.store;const old={entityId:'note:n',collection:'notes',payload:{kind:'archive',id:'n',title:'N',content:'old',updatedAt:1}};
 s.applyPush('u',[{...mutation('note:n','old'),...old}],{deviceId:'a'});s.applyPush('u',[{...mutation('note:n','remote',1),...old,payload:{...old.payload,content:'remote'}}],{deviceId:'a'});f.advance(91*DAY);s.compact();
 const result=await pullWorkspacePages({store:{getPullCursor:()=>({cursor:'0'})},accountId:'a',collections:['notes'],pullPage:transport(s)});assert(result.ok);assert.equal(result.fullCollections.length,1);
 const plan=planWorkspaceSync({index:{'note:n':entityHash(old)},localEntities:[{...old,payload:{...old.payload,content:'offline edit'}}],remoteChanges:result.remoteChanges});assert(plan.toPush.some(e=>e.payload.conflict));assert.equal(plan.mergedEntities.find(e=>e.entityId==='note:n').payload.content,'remote');
});

test('NAS HTTP rejects truncated cursors and expired requests, and exposes an explicit full pull', async t => {
 const { createApp }=require('../fnos/app/server/createApp'),{dispatch}=require('../fnos/app/server/testHarness');
 const f=fixture(t),s=f.store,token=s.issueToken({uid:'u',deviceId:'a'});
 const headers={authorization:`Bearer ${token}`};s.applyPush('u',[mutation('x','old')],{deviceId:'a'});f.advance(91*DAY);s.compact();
 // Authentication is independent from history expiry. Issue a current token.
 const fresh=s.issueToken({uid:'u',deviceId:'a'});headers.authorization=`Bearer ${fresh}`;
 const app=createApp({listenMode:'device-port',store:s});
 const stale=await dispatch(app,{method:'GET',url:'/api/v1/sync/pull?collection=todos&cursor=0',headers});assert.equal(stale.statusCode,409);assert.equal(stale.getJson().error,'full_resync_required');
 const full=await dispatch(app,{method:'GET',url:'/api/v1/sync/pull?collection=todos&full=1',headers});assert.equal(full.statusCode,200);assert.equal(full.getJson().fullSnapshot,true);assert.equal(full.getJson().changes.length,1);
 const push=await dispatch(app,{method:'POST',url:'/api/v1/sync/push',headers,body:{mutations:[mutation('x','old')]}});assert.equal(push.statusCode,409);assert.equal(push.getJson().error,'mutation_expired_resync_required');assert.equal(s.bucket('u').serverRev,1);
});

test('todo full resync rebases offline edits and cancels upserts of remotely deleted IDs', async t => {
 const {openSyncStore}=require('../sync-store'),{ensureBoundAccount,runTodosSyncCycle}=require('../todos-sync');
 const f=fixture(t),s=f.store;const db=openSyncStore(':memory:');t.after(()=>db.close());const {accountId}=ensureBoundAccount(db,{uid:'u',serverId:'s',deviceId:'a'});
 s.applyPush('u',[mutation('deleted','first')],{deviceId:'a'});s.applyPush('u',[mutation('deleted','delete',1,'delete')],{deviceId:'a'});s.applyPush('u',[mutation('kept','remote',2)],{deviceId:'a'});
 for(const id of ['deleted','new','kept'])assert(db.writeLocalMutation({...mutation(id,`offline-${id}`,1),accountId}).ok);
 f.advance(91*DAY);s.compact();
 const result=await runTodosSyncCycle(db,{accountId,pullPage:transport(s),pushMutations:async rows=>{const body=s.applyPush('u',rows,{deviceId:'a'});return {ok:true,...body};}});
 assert.equal(result.ok,true);assert.equal(s.bucket('u').live.has('deleted'),false);assert.equal(s.bucket('u').live.get('new').payload.text,'offline-new');assert.equal(s.bucket('u').live.get('kept').payload.text,'offline-kept');assert.equal(db.listPendingOutbox(accountId).length,0);
});

test('Claude forwarding reads stable message identity and keeps equal text from successive turns distinct', t => {
 const {lastAssistantMessage}=require('../scripts/claude-notify');const transcript=path.join(directory(t),'conversation.jsonl');
 const row=(uuid,timestamp)=>({type:'assistant',uuid,timestamp,message:{content:[{type:'text',text:'相同完成文本'}]}});
 fs.writeFileSync(transcript,JSON.stringify(row('message-1','2026-10-13T02:00:00Z'))+'\n');const first=lastAssistantMessage(transcript);assert.equal(first.eventId,'message-1');assert.equal(lastAssistantMessage(transcript).eventId,first.eventId);
 fs.appendFileSync(transcript,JSON.stringify(row('message-2','2026-10-13T02:01:00Z'))+'\n');const second=lastAssistantMessage(transcript);assert.equal(second.text,first.text);assert.notEqual(second.eventId,first.eventId);
});

test('a failed full snapshot page leaves todo database and pending queue unchanged', async t => {
 const {openSyncStore}=require('../sync-store'),{ensureBoundAccount,runTodosSyncCycle}=require('../todos-sync');
 const db=openSyncStore(':memory:');t.after(()=>db.close());const {accountId}=ensureBoundAccount(db,{uid:'u',serverId:'s',deviceId:'a'});db.writeLocalMutation({...mutation('local','local'),accountId});let calls=0;
 const result=await runTodosSyncCycle(db,{accountId,pullPage:async args=>{if(!args.full)return {ok:false,error:'full_resync_required'};if(calls++===0)return {ok:true,body:{schemaVersion:1,minSupported:1,maxSupported:1,fullSnapshot:true,changes:[{entityId:'remote',collection:'todos',op:'upsert',payload:{text:'remote',categoryId:'P0'},serverRev:4}],nextCursor:'full:fixture:1',hasMore:true,serverRev:4}};return {ok:false,error:'full_snapshot_expired'};},pushMutations:async()=>{throw new Error('must not push');}});
 assert.equal(result.ok,false);assert.equal(db.listPendingOutbox(accountId).length,1);assert.equal(db.getEntity(accountId,'todos','remote'),null);assert.equal(db.getPullCursor(accountId).cursor,null);
});

test('v2 checkpoint and journal upgrade together to a format older retention-unaware servers cannot read', t => {
 const v8=require('node:v8'),f=fixture(t),s=f.store;s.applyPush('u',[mutation('x','x')],{deviceId:'a'});
 const checkpoint=v8.deserialize(fs.readFileSync(f.args.filePath));checkpoint.version=2;fs.writeFileSync(f.args.filePath,v8.serialize(checkpoint));
 const loaded=f.reload();assert.equal(loaded.bucket('u').live.get('x').payload.text,'x');assert.equal(v8.deserialize(fs.readFileSync(f.args.filePath)).version,3);
 loaded.applyPush('u',[mutation('y','y',1)],{deviceId:'a'});assert.equal(f.reload().bucket('u').live.size,2);
});
