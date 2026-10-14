'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),v8=require('node:v8');
const {createPersistentStore}=require('../fnos/app/server/persistentStore');
const {createMemoryStore}=require('../fnos/app/server/store');
const {planWorkspaceSync,entityHash,pushWorkspaceEntities}=require('../workspace-sync');
function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pome-followups-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const mutation=(id,key,payload,collection='todos')=>({entityId:id,clientMutationId:key,deviceId:'device',baseServerRev:0,collection,payload,op:'upsert'});
test('small NAS changes do not rewrite checkpoint or serialize unrelated audio',t=>{
 const filePath=path.join(directory(t),'state.bin');let store=createPersistentStore({filePath,serverId:'s'});
 const media='MEDIA-NEVER-IN-TODO-LOG'+Buffer.alloc(4*1024*1024,1).toString('base64');store.applyPush('u',[mutation('recording:large','audio',{audioBase64:media},'recordings')]);const checkpoint=fs.readFileSync(filePath);
 store.applyPush('u',[mutation('todo','todo',{text:'small',categoryId:'P0'})]);const logs=fs.readdirSync(filePath+'.transactions').filter(n=>n.endsWith('.bin')).sort();const bytes=fs.readFileSync(path.join(filePath+'.transactions',logs.at(-1)));assert(bytes.length<5000);assert.equal(bytes.includes(Buffer.from('MEDIA-NEVER-IN-TODO-LOG')),false);assert.deepEqual(fs.readFileSync(filePath),checkpoint);
 store=createPersistentStore({filePath,serverId:'s'});assert.equal(store.bucket('u').live.get('recording:large').payload.audioBase64,media);assert.equal(store.bucket('u').live.get('todo').payload.text,'small');
});
test('legacy store migrates; compaction retains replay protection and recovery snapshots',t=>{
 const filePath=path.join(directory(t),'state.bin'),old=createMemoryStore({serverId:'s'});old.applyPush('u',[mutation('todo','first',{text:'old'})]);fs.writeFileSync(filePath,v8.serialize(old.exportState()));let store=createPersistentStore({filePath,serverId:'s'});assert.equal(v8.deserialize(fs.readFileSync(filePath)).version,3);
 const state=store.recovery.state('u');store.recovery.prepare('u',{operationId:'op',baseServerRev:state.serverRev,fingerprint:state.fingerprint},'device');store.recovery.verify('u','op','device');
 for(let i=0;i<260;i++)store.applyPush('u',[mutation(`t-${i}`,`key-${i}`,{text:`${i}`})]);store=createPersistentStore({filePath,serverId:'s'});assert.equal(store.recovery.get('u','op','device').verified,true);assert.equal(store.applyPush('u',[mutation('todo','first',{text:'should not replace'})]).applied[0].status,'duplicate');assert.equal(store.bucket('u').live.get('todo').payload.text,'old');assert(fs.readdirSync(filePath+'.transactions').length<256);
});
test('journal corruption or sequence gaps fail closed without overwriting files',t=>{
 const filePath=path.join(directory(t),'state.bin');const store=createPersistentStore({filePath,serverId:'s'});store.applyPush('u',[mutation('todo','first',{text:'old'})]);const journal=path.join(filePath+'.transactions',fs.readdirSync(filePath+'.transactions')[0]);const bytes=fs.readFileSync(journal);bytes[bytes.length-1]^=1;fs.writeFileSync(journal,bytes);assert.throws(()=>createPersistentStore({filePath,serverId:'s'}),/checksum/);assert.deepEqual(fs.readFileSync(journal),bytes);
});
test('remote edit versus local deletion attributes preserved version to current remote writer',()=>{
 const base={entityId:'note:n',collection:'notes',payload:{kind:'archive',id:'n',title:'标题',content:'base',updatedAt:1700000000000}};
 const remote={...base,payload:{...base.payload,content:'remote'},deviceId:'remote-device',deviceName:'远端 Mac',serverRev:2,op:'upsert'};
 const plan=planWorkspaceSync({index:{'note:n':entityHash(base)},localEntities:[],remoteChanges:[remote],deviceName:'本机'});const copy=plan.toPush.find(e=>e.payload?.conflict);assert.equal(copy.payload.conflict.deviceName,'远端 Mac');assert.equal(copy.payload.conflict.deviceId,'remote-device');assert(!copy.payload.title.includes('本机'));assert(!/T\d\d:.*Z/.test(copy.payload.title));
});
test('superseded NAS pull payload identifies actual latest writer rather than old log writer',()=>{
 const s=createMemoryStore();s.issueToken({uid:'u',deviceId:'a',name:'A'});s.issueToken({uid:'u',deviceId:'b',name:'B'});s.applyPush('u',[mutation('todo','a',{text:'old'})],{deviceId:'a'});s.applyPush('u',[mutation('todo','b',{text:'new'})],{deviceId:'b'});const rows=s.pull('u',{cursor:'0',collection:'todos'}).changes;assert(rows.every(r=>r.payload.text==='new'&&r.deviceId==='b'&&r.deviceName==='B'&&r.serverRev===2));
});
test('one conflicting note does not block later batches or reacknowledge refused items',async()=>{
 const entities=Array.from({length:510},(_,i)=>({entityId:`note:${i}`,collection:'notes',payload:{kind:'archive',id:String(i),content:'text'}}));let batches=0;
 const result=await pushWorkspaceEntities({entities,deviceId:'d',pushMutations:async batch=>{batches++;return {ok:true,applied:batch.map(m=>({clientMutationId:m.clientMutationId,status:m.entityId==='note:0'?'conflict':'applied'}))};}});
 assert.equal(batches,2);assert.equal(result.pushed,509);assert.deepEqual(result.conflictIds,['note:0']);assert.equal(result.confirmedIds.includes('note:0'),false);assert(result.confirmedIds.includes('note:509'));
});
test('hot inbox file corruption cannot be silently overwritten by cached records',t=>{
 const filePath=path.join(directory(t),'inbox.json'),inbox=require('../taskInbox').createTaskInbox({filePath});inbox.accept({completedAt:1,source:'codex',taskId:'original'});fs.writeFileSync(filePath,'broken');assert.throws(()=>inbox.accept({completedAt:1,source:'codex',taskId:'new'}),/外部发生变化/);assert.equal(fs.readFileSync(filePath,'utf8'),'broken');
});
test('snapshot verification and staging logs do not duplicate protected media',t=>{
 const filePath=path.join(directory(t),'state.bin'),store=createPersistentStore({filePath,serverId:'s'});const media='PROTECTED-MEDIA'+Buffer.alloc(1024*1024,2).toString('base64');store.applyPush('u',[mutation('recording:large','audio',{audioBase64:media},'recordings')]);const state=store.recovery.state('u');store.recovery.prepare('u',{operationId:'snapshot',baseServerRev:state.serverRev,fingerprint:state.fingerprint},'device');store.recovery.verify('u','snapshot','device');
 let names=fs.readdirSync(filePath+'.transactions').filter(n=>n.endsWith('.bin')).sort();const verification=fs.readFileSync(path.join(filePath+'.transactions',names.at(-1)));assert(verification.length<3000);assert.equal(verification.includes(Buffer.from('PROTECTED-MEDIA')),false);
 store.recovery.stage('u',{operationId:'snapshot',chunkId:0,entities:[{collection:'todos',entityId:'small',payload:{text:'small'}}]},'device');names=fs.readdirSync(filePath+'.transactions').filter(n=>n.endsWith('.bin')).sort();assert(fs.statSync(path.join(filePath+'.transactions',names.at(-1))).size<3000);
 const restarted=createPersistentStore({filePath,serverId:'s'});assert.equal(restarted.recovery.get('u','snapshot','device').verified,true);const row=restarted.bucket('u').recoveries.get('snapshot');assert.equal(row.snapshot[0].payload.audioBase64,media);assert.equal(row.chunks.get(0)[0].payload.text,'small');
});
