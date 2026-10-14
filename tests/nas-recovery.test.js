'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPersistentStore}=require('../fnos/app/server/persistentStore');
const {digest}=require('../fnos/app/server/recovery');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pome-nas-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {filePath:path.join(root,'state.bin'),serverId:'fixture-server'};}
const entity=(id,text,collection='notes')=>({entityId:id,collection,payload:{kind:'archive',id:id.slice(5),content:text,title:'标题'}});
function push(store,e,key,rev=0){return store.applyPush('user',[{...e,op:'upsert',clientMutationId:key,baseServerRev:rev}],{deviceId:'one'});}
function prepare(store,operationId='op'){const state=store.recovery.state('user');store.recovery.prepare('user',{operationId,baseServerRev:state.serverRev,fingerprint:state.fingerprint},'one');store.recovery.verify('user',operationId,'one');return state;}
test('NAS snapshot survives restart, commit is atomic/idempotent, rollback makes newer revisions and preserves credentials',t=>{
 const options=fixture(t);let store=createPersistentStore(options);const token=store.issueToken({uid:'user',deviceId:'one'});
 const secret=entity('secret:s','ciphertext','secrets');push(store,entity('note:old','old'),'old');push(store,secret,'secret');const key=store.getOrCreateAccountSyncKey('user');
 prepare(store);store=createPersistentStore(options);assert.equal(store.recovery.get('user','op','one').verified,true);
 const incoming=[entity('note:new','new')];store.recovery.stage('user',{operationId:'op',chunkId:0,entities:incoming},'one');
 const result=store.recovery.commit('user',{operationId:'op',chunkCount:1,entitiesHash:digest(incoming)},'one');
 assert.equal(store.bucket('user').live.has('note:old'),false);assert.equal(store.bucket('user').live.get('note:new').payload.content,'new');
 assert.equal(store.recovery.commit('user',{operationId:'op'},'one').serverRev,result.serverRev);
 store=createPersistentStore(options);assert(store.verifyToken(token));assert.equal(store.peekAccountSyncKey('user'),key);
 const rolled=store.recovery.rollback('user','op','one');assert(rolled.rollbackRev>result.serverRev);assert.equal(store.bucket('user').live.get('note:old').payload.content,'old');assert.equal(store.bucket('user').live.has('note:new'),false);assert.deepEqual(store.bucket('user').live.get('secret:s').payload,secret.payload);
 assert.equal(store.recovery.rollback('user','op','one').rollbackRev,rolled.rollbackRev);
});
test('snapshot persistence or readback verification failure prohibits commit',t=>{
 const options=fixture(t);const disk=Object.create(fs);let fail=false;disk.renameSync=(a,b)=>{if(fail)throw new Error('ENOSPC');fs.renameSync(a,b);};const store=createPersistentStore({...options,fileSystem:disk});push(store,entity('note:old','old'),'old');
 const state=store.recovery.state('user');fail=true;assert.throws(()=>store.recovery.prepare('user',{operationId:'fail',baseServerRev:state.serverRev,fingerprint:state.fingerprint},'one'),/ENOSPC/);fail=false;assert.throws(()=>store.recovery.get('user','fail','one'),/not_found/);
 store.recovery.prepare('user',{operationId:'op',baseServerRev:state.serverRev,fingerprint:state.fingerprint},'one');assert.throws(()=>store.recovery.commit('user',{operationId:'op',chunkCount:0,entitiesHash:digest([])},'one'),/not_verified/);assert.equal(store.bucket('user').live.get('note:old').payload.content,'old');
});
test('stale preview, foreign operation owner, incomplete or modified staging cannot overwrite NAS',t=>{
 const store=createPersistentStore(fixture(t));push(store,entity('note:old','old'),'old');prepare(store);
 assert.throws(()=>store.recovery.get('user','op','other'),/not_found/);
 const entities=[entity('note:new','new')];store.recovery.stage('user',{operationId:'op',chunkId:0,entities},'one');
 assert.throws(()=>store.recovery.stage('user',{operationId:'op',chunkId:0,entities:[entity('note:new','different')]},'one'),/mismatch/);
 assert.throws(()=>store.recovery.commit('user',{operationId:'op',chunkCount:2,entitiesHash:digest(entities)},'one'),/incomplete/);
 push(store,entity('note:later','later'),'later',store.bucket('user').serverRev);
 assert.throws(()=>store.recovery.commit('user',{operationId:'op',chunkCount:1,entitiesHash:digest(entities)},'one'),/expired/);assert.equal(store.bucket('user').live.get('note:old').payload.content,'old');
});
test('rollback cannot silently undo changes made after overwrite',t=>{
 const store=createPersistentStore(fixture(t));push(store,entity('note:old','old'),'old');prepare(store);store.recovery.commit('user',{operationId:'op',chunkCount:0,entitiesHash:digest([])},'one');push(store,entity('note:later','later'),'later',store.bucket('user').serverRev);
 assert.throws(()=>store.recovery.rollback('user','op','one'),/expired/);assert.equal(store.bucket('user').live.get('note:later').payload.content,'later');
});
