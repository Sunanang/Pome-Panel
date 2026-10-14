'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const w=require('../workspace-sync');
const {createMemoryStore}=require('../fnos/app/server/store');
const note=(text,id='n')=>({entityId:`note:${id}`,collection:'notes',op:'upsert',payload:{kind:'archive',id,title:'原笔记',content:text,createdAt:1,updatedAt:2}});
const remote=(e,rev=2)=>({...e,serverRev:rev});
test('both note upload orders retain different versions without using device timestamps',()=>{
 for(const [left,right] of [['A','B'],['B','A']]){
  const base=note('base'),local=note(left),other=note(right);
  const plan=w.planWorkspaceSync({index:{'note:n':w.entityHash(base)},localEntities:[local],remoteChanges:[remote(other)],deviceName:'device'});
  const notes=w.projectWorkspaceEntities(plan.mergedEntities).snapshot.notes.archive;
  assert.deepEqual(new Set(notes.map(n=>n.content)),new Set(['A','B']));assert.equal(plan.toPush.length,1);assert(plan.toPush[0].payload.conflict);
  const repeat=w.planWorkspaceSync({index:plan.nextIndex,localEntities:plan.mergedEntities,remoteChanges:[remote(other)],deviceName:'device'});assert.equal(repeat.toPush.length,0);
 }
});
test('own upload echo preserves later edit without conflict, remote fast-forward replaces clean version',()=>{
 const base=note('base'),edit=note('edit');
 const echo=w.planWorkspaceSync({index:{'note:n':w.entityHash(base)},localEntities:[edit],remoteChanges:[remote(base)]});
 assert.equal(echo.mergedEntities.length,1);assert.equal(echo.toPush[0].payload.content,'edit');
 const advance=w.planWorkspaceSync({index:{'note:n':w.entityHash(base)},localEntities:[base],remoteChanges:[remote(edit)]});assert.equal(advance.toPush.length,0);assert.equal(advance.mergedEntities[0].payload.content,'edit');
});
test('delete versus unsynced edit keeps version as a new note without resurrecting deleted original',()=>{
 const base=note('base'),edit=note('edit');const plan=w.planWorkspaceSync({index:{'note:n':w.entityHash(base)},localEntities:[edit],remoteChanges:[{entityId:'note:n',collection:'notes',op:'delete',serverRev:3}]});
 assert.equal(plan.mergedEntities.length,1);assert.notEqual(plan.mergedEntities[0].entityId,'note:n');assert.equal(plan.mergedEntities[0].payload.content,'edit');
});
test('editing a conflict copy produces a flat version family, dedupes retries, survives projection/normalization',()=>{
 const base=note('base');const initial=w.planWorkspaceSync({index:{'note:n':w.entityHash(base)},localEntities:[note('A')],remoteChanges:[remote(note('B'))],deviceName:'device'});
 const copy=initial.toPush[0];const local={...copy,payload:{...copy.payload,content:'copy-A'}};const other={...copy,payload:{...copy.payload,content:'copy-B'}};
 const next=w.planWorkspaceSync({index:{[copy.entityId]:w.entityHash(copy)},localEntities:[local],remoteChanges:[remote(other)]});
 assert.equal(next.mergedEntities.length,2);const newer=next.toPush[0];assert.equal(newer.payload.conflict.originId,'note:n');assert.equal(newer.payload.conflict.originalTitle,'原笔记');assert.equal((newer.payload.title.match(/冲突副本/g)||[]).length,1);
 const normalized=require('../renderer/domain').normalizeNoteArchive(w.projectWorkspaceEntities(next.mergedEntities).snapshot.notes.archive);assert(normalized.every(n=>n.conflict.originId==='note:n'));
 const rebuilt=w.buildWorkspaceEntities({notes:{archive:normalized}}).entities;assert(rebuilt.every(e=>e.payload.conflict.originId==='note:n'));
});
test('NAS rejects racing stale note upsert so next pull can preserve both versions',()=>{
 const store=createMemoryStore();const apply=(entity,key,baseServerRev)=>store.applyPush('u',[{...entity,clientMutationId:key,deviceId:key,baseServerRev}]);
 apply(note('base'),'init',0);assert.equal(apply(note('A'),'one',1).applied[0].status,'applied');assert.equal(apply(note('B'),'two',1).applied[0].status,'conflict');assert.equal(store.bucket('u').live.get('note:n').payload.content,'A');
});
test('todo completion versus title/deadline edit settles whole accepted versions in either upload order',()=>{
 for(const order of [['complete','edit'],['edit','complete']]){
  const server=createMemoryStore();
  const versions={complete:{id:'todo',text:'原任务',done:true,categoryId:'P0',createdAt:1,deadline:'2026-10-13T15:30:00.000Z',remindedAt:0},edit:{id:'todo',text:'修改标题',done:false,categoryId:'P0',createdAt:1,deadline:'2026-10-14T15:30:00.000Z',remindedAt:0}};
  for(const kind of order)server.applyPush('u',[{collection:'todos',entityId:'todo',op:'upsert',payload:versions[kind],clientMutationId:kind,deviceId:kind,baseServerRev:0,clientTime:kind==='complete'?99999999:1}],{deviceId:kind});
  assert.equal(server.bucket('u').serverRev,2);assert.deepEqual(server.bucket('u').live.get('todo').payload,versions[order[1]]);
  // Retrying the already accepted older operation cannot undo the newer version.
  const older=order[0];assert.equal(server.applyPush('u',[{collection:'todos',entityId:'todo',op:'upsert',payload:versions[older],clientMutationId:older,deviceId:older,baseServerRev:0}],{deviceId:older}).applied[0].status,'duplicate');assert.deepEqual(server.bucket('u').live.get('todo').payload,versions[order[1]]);
 }
});
