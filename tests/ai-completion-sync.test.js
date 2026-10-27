'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTaskInbox } = require('../taskInbox');
const { createPersistentStore } = require('../fnos/app/server/persistentStore');
const { createApp } = require('../fnos/app/server/createApp');
const { dispatch } = require('../fnos/app/server/testHarness');
const { buildWorkspaceEntities, projectWorkspaceEntities, planWorkspaceSync, mutationFromEntity, hashesForEntities, pullWorkspacePages } = require('../workspace-sync');
const { normalizeSyncedCompletion, completionSyncKey, validateMutation, mergeSyncedCompletions } = require('../packages/sync-protocol');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'pome-completion-sync-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const filePath = path.join(root,'nas.bin');
  const server = createPersistentStore({filePath,serverId:'nas',maintenanceIntervalMs:Infinity});
  const client = name => ({ name, cursor:'0', index:{}, inbox:createTaskInbox({filePath:path.join(root,`${name}.json`),now:() => 100000}) });
  return {root,filePath,server,a:client('a'),b:client('b')};
}
function nativeEvent(i) { return {source:'codex',eventId:`event-${i}`,title:`Result ${i}`,completedAt:i+1}; }
function entities(rows) { return buildWorkspaceEntities({aiCompletions:rows}).entities; }
async function cycle(server, client) {
  const pulled = server.pull('u',{collection:'aiCompletions',cursor:client.cursor,deviceId:client.name});
  assert.equal(pulled.error,undefined);
  const localEntities = entities(client.inbox.snapshotForSync());
  const plan = planWorkspaceSync({index:client.index,localEntities,remoteChanges:pulled.changes});
  const snapshot = projectWorkspaceEntities(plan.mergedEntities).snapshot;
  client.inbox.replaceFromSync(snapshot.aiCompletions);
  if(plan.toPush.length) {
    const token = server.issueToken({uid:'u',deviceId:client.name});
    const app = createApp({listenMode:'device-port',store:server});
    const response = await dispatch(app,{method:'POST',url:'/api/v1/sync/push',headers:{authorization:`Bearer ${token}`},body:{mutations:plan.toPush.map(row => mutationFromEntity(row,{deviceId:client.name,baseServerRev:pulled.serverRev}))}});
    assert.equal(response.statusCode,200, response.body);
    assert.ok(response.getJson().applied.every(row => ['applied','duplicate'].includes(row.status)));
  }
  client.index = plan.nextIndex;
  client.cursor = pulled.nextCursor;
  return plan;
}

test('Grok prompt turns sync through NAS, propagate reads and share history capacity', async t => {
  const {a,b,server} = fixture(t);
  const {grokCompletion} = require('../scripts/grok-notify');
  const sample = require('./fixtures/grok-stop.json');
  const accept = i => {
    const event = grokCompletion({...sample,promptId:`prompt-${i}`,lastAssistantMessage:`Grok result ${i}`});
    return a.inbox.accept({...event,title:event.last_assistant_message,window:{cwd:'/private/local-project'}});
  };
  assert.equal(accept(1).duplicate,false);assert.equal(accept(2).duplicate,false);assert.equal(accept(1).duplicate,true);
  const built = buildWorkspaceEntities({aiCompletions:a.inbox.snapshotForSync(),commands:[{id:'unrelated',text:'Keep syncing commands'}]}).entities;
  assert.equal(built.filter(row => row.collection==='aiCompletions').length,2);
  assert.ok(built.some(row => row.entityId==='command:unrelated'));
  await cycle(server,a);await cycle(server,b);
  assert.equal(b.inbox.list().total,2);
  const imported=b.inbox.list().items[0];assert.equal(imported.source,'grok');assert.equal(imported.window,null);
  b.inbox.markRead(imported.id);await cycle(server,b);await cycle(server,a);
  assert.equal(a.inbox.list().items.find(row => row.completionEventId===imported.completionEventId).readAt,100000);
  for(let i=3;i<=110;i++)accept(i);
  await cycle(server,a);await cycle(server,b);await cycle(server,a);
  assert.equal(a.inbox.list().total,100);assert.equal(b.inbox.list().total,100);
  assert.equal([...server.bucket('u').live.values()].filter(row => row.collection==='aiCompletions').length,100);
  assert.deepEqual(new Set(a.inbox.snapshotForSync().map(completionSyncKey)),new Set(b.inbox.snapshotForSync().map(completionSyncKey)));
});

for (const source of ['copilot','antigravity']) test(`${source} rounds, retries, reads and overflow converge through NAS`, async t => {
  const {a,b,server}=fixture(t);
  const accept=i=>a.inbox.accept({source,eventId:`${source}-round-${i}`,title:`${source} result ${i}`,completedAt:i+1,
    window:{app:source==='copilot'?'Terminal':'Antigravity',cwd:'/private/local-project'}});
  accept(1);accept(2);assert.equal(accept(1).duplicate,true);
  await cycle(server,a);await cycle(server,b);assert.equal(b.inbox.list().total,2);
  const read=b.inbox.list().items[0];assert.equal(read.source,source);assert.equal(read.window,null);
  b.inbox.markRead(read.id);await cycle(server,b);await cycle(server,a);
  assert.equal(a.inbox.list().items.find(row=>row.completionEventId===read.completionEventId).readAt,100000);
  for(let i=3;i<=115;i++)accept(i);
  await cycle(server,a);await cycle(server,b);await cycle(server,a);
  assert.equal(a.inbox.list().total,100);assert.equal(b.inbox.list().total,100);
  assert.equal([...server.bucket('u').live.values()].filter(row=>row.collection==='aiCompletions').length,100);
  assert.deepEqual(new Set(a.inbox.snapshotForSync().map(completionSyncKey)),new Set(b.inbox.snapshotForSync().map(completionSyncKey)));
});

test('two devices sync completions through NAS HTTP, dedupe events, propagate reads and retain only 100', async t => {
  const {a,b,server,filePath} = fixture(t);
  const local = a.inbox.accept({...nativeEvent(1),window:{app:'Codex',cwd:'/private/local-project',title:'Local window'}}).record;
  await cycle(server,a); await cycle(server,b);
  assert.equal(b.inbox.list().total,1);
  const imported = b.inbox.list().items[0];
  assert.equal(imported.window,null);
  assert.equal(b.inbox.accept(nativeEvent(1)).duplicate,true);
  assert.equal(a.inbox.get(local.id).window.cwd,'/private/local-project');
  b.inbox.markRead(imported.id);
  await cycle(server,b); await cycle(server,a);
  assert.equal(a.inbox.get(local.id).readAt,100000);
  assert.equal(server.bucket('u').live.values().next().value.payload.window,undefined);
  // Independent offline additions with explicit reception times model two devices.
  const rows = Array.from({length:150},(_,i) => ({...normalizeSyncedCompletion({...local,id:`legacy-${i}`,completionEventId:`stable-${i}`,receivedAt:i,readAt:i % 2 ? null : i}),window:null}));
  a.inbox.replaceFromSync(rows.slice(0,90));
  b.inbox.replaceFromSync(rows.slice(60));
  await cycle(server,a); await cycle(server,b);
  await cycle(server,a); await cycle(server,b); await cycle(server,a);
  assert.equal(a.inbox.list().total,100); assert.equal(b.inbox.list().total,100);
  assert.equal([...server.bucket('u').live.values()].filter(row => row.collection==='aiCompletions').length,100);
  assert.deepEqual(new Set(a.inbox.snapshotForSync().map(completionSyncKey)),new Set(b.inbox.snapshotForSync().map(completionSyncKey)));
  const restarted = createPersistentStore({filePath,serverId:'nas'});
  assert.equal([...restarted.bucket('u').live.values()].filter(row => row.collection==='aiCompletions').length,100);
});

test('NAS merges stale unread writes monotonically, trims overflow and rejects resurrection after restart', t => {
  const {server,filePath} = fixture(t);
  const rows = Array.from({length:140},(_,i) => normalizeSyncedCompletion({id:`r-${i}`,source:'cursor',receivedAt:i,readAt:null,title:`Result ${i}`}));
  const mutations = rows.map((row,i) => mutationFromEntity({collection:'aiCompletions',entityId:`completion:${row.id}`,payload:row},{deviceId:'a',clientMutationId:`m-${i}`}));
  server.applyPush('u',mutations,{deviceId:'a'});
  assert.equal(server.bucket('u').live.size,100);
  assert.equal(server.bucket('u').tombstones.size,40);
  const row = rows.at(-1), entityId = `completion:${row.id}`;
  const write = (payload,key) => server.applyPush('u',[mutationFromEntity({collection:'aiCompletions',entityId,payload},{deviceId:'b',clientMutationId:key,baseServerRev:server.bucket('u').serverRev})],{deviceId:'b'});
  write({...row,readAt:50},'read'); write(row,'stale-unread');
  assert.equal(server.bucket('u').live.get(entityId).payload.readAt,50);
  const reopened = createPersistentStore({filePath,serverId:'nas'});
  assert.equal(reopened.bucket('u').live.get(entityId).payload.readAt,50);
  const old = mutations[0];
  const result = reopened.applyPush('u',[{...old,clientMutationId:'offline-stale-copy',baseServerRev:reopened.bucket('u').serverRev}],{deviceId:'b'});
  assert.equal(result.applied[0].status,'duplicate');
  assert.equal(reopened.bucket('u').live.has(old.entityId),false);
});

test('merge capacity and failed-delete retry share the same limit as local load and projection', () => {
  const rows = Array.from({length:130},(_,i) => normalizeSyncedCompletion({id:`r-${i}`,source:'claude',receivedAt:i,readAt:null}));
  const all = rows.map(row => ({collection:'aiCompletions',entityId:`completion:${row.id}`,op:'upsert',payload:row}));
  const plan = planWorkspaceSync({index:{},localEntities:all.slice(0,60),remoteChanges:all.slice(60)});
  assert.equal(plan.mergedEntities.length,100);
  assert.equal(plan.toPush.filter(row => row.op==='upsert').length,30);
  assert.equal(projectWorkspaceEntities(all).snapshot.aiCompletions.length,100);
  const merged = planWorkspaceSync({index:hashesForEntities(all),localEntities:all,remoteChanges:all});
  assert.equal(merged.toPush.filter(row => row.op==='delete').length,30);
  const retry = planWorkspaceSync({index:merged.appliedIndex,localEntities:merged.mergedEntities,remoteChanges:[]});
  assert.equal(retry.toPush.filter(row => row.op==='delete').length,30);
  const read = {...rows[100],readAt:3};
  assert.equal(mergeSyncedCompletions(rows[100],read).readAt,3);
});

test('sync preserves local IDs and focus metadata, restores dedupe and rejects partial invalid history atomically', t => {
  const {a,root} = fixture(t);
  const first = a.inbox.accept({...nativeEvent(1),window:{app:'Codex',cwd:root}}).record;
  const incoming = normalizeSyncedCompletion({...first,readAt:1});
  a.inbox.replaceFromSync([incoming]);
  assert.equal(a.inbox.get(first.id).window.cwd,root);
  assert.equal(a.inbox.get(first.id).readAt,1);
  assert.equal(a.inbox.accept(nativeEvent(1)).duplicate,true);
  const before = fs.readFileSync(path.join(root,'a.json'));
  assert.throws(() => a.inbox.replaceFromSync([incoming,{source:'invalid'}]),/invalid_ai_completion/);
  assert.deepEqual(fs.readFileSync(path.join(root,'a.json')),before);
  a.inbox.replaceFromSync([]);
  assert.equal(a.inbox.list().total,0);
});

test('protocol rejects malformed records, wrong namespaces and identity mismatches', async () => {
  const row = normalizeSyncedCompletion({id:'x',source:'codex',receivedAt:1,readAt:null});
  const mutation = mutationFromEntity({collection:'aiCompletions',entityId:`completion:${row.id}`,payload:row},{deviceId:'a'});
  assert.equal(validateMutation(mutation).ok,true);
  for(const value of [{...mutation,payload:{...row,source:'unknown'}},{...mutation,payload:{...row,readAt:'no'}},{...mutation,entityId:`completion:${'a'.repeat(64)}`},{...mutation,collection:'todos'}]) assert.equal(validateMutation(value).ok,false);
  const result = await pullWorkspacePages({store:{getPullCursor:() => ({cursor:'0'})},accountId:'a',collections:['aiCompletions'],pullPage:async () => ({ok:false,error:'collection_not_enabled'})});
  assert.equal(result.ok,false);
});
