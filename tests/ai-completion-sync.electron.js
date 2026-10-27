'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { app, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
clipboard.read = async () => [];
process.env.POME_TEST_NOTIFICATIONS = '1';
require('../cursor-usage').readAuthToken = () => ({ok:false});
require('../cursor-usage').fetchCursorUsage = async () => ({ok:false});
require('../codex-usage').readCodexUsage = async () => ({ok:true,detected:false});
require('../codex-auth').readLocalCodexToken = async () => ({ok:false});
const adapters = require('../platform-adapters'), loadAdapter = adapters.loadAdapter;
adapters.loadAdapter = (...args) => {
  const adapter = loadAdapter(...args);
  adapter.windows.resolveTaskApp = async () => null;
  return adapter;
};
const {createTaskInbox} = require('../taskInbox');
createTaskInbox({filePath:path.join(profile,'task-inbox.json')}).accept({source:'codex',eventId:'before-pair',title:'配对前的完成记录'});
const {createPersistentStore} = require('../fnos/app/server/persistentStore');
const {normalizeSyncedCompletion,completionSyncKey} = require('../packages/sync-protocol');
const nasFile = path.join(profile,'nas.bin');
const store = createPersistentStore({filePath:nasFile,serverId:'completion-nas'});
const nas = require('../fnos/app/server/createApp').createApp({listenMode:'device-port',store});
let duringCommit = null;
const request = nas.server.listeners('request')[0];
nas.server.removeAllListeners('request');
nas.server.on('request',(req,res) => {
  if (duringCommit && req.url === '/api/v1/migration/commit') {
    const action = duringCommit; duringCommit = null;
    action().then(() => request(req,res)).catch(error => {console.error(error);res.writeHead(500);res.end();});
  } else request(req,res);
});
const listening = new Promise(resolve => nas.server.listen(0,'127.0.0.1',resolve));
let port, started = false, phase = 'startup';
app.on('pome-test-notification-port',value => {port = value;});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const watchdog = setTimeout(() => {console.error('AI completion sync timed out',phase);app.exit(1);},45000);
app.on('web-contents-created',(_event,c) => c.once('did-finish-load',() => {
  if(started || !c.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(c).then(() => {clearTimeout(watchdog);nas.server.close();console.log('AI completion NAS: first migration, HTTP completion, silent pull, count limit, read sync and durable restart passed');app.exit(0);})
    .catch(error => {console.error(phase,error);app.exit(1);});
}));
async function run(c) {
  const js = code => c.executeJavaScript(code);
  async function until(expression) {for(let i=0;i<300;i++){if(await js(expression).catch(() => false)) return;await sleep(20);}throw new Error(expression);}
  await until(`!!window.NotchTaskInbox && !workspaceReloadPending && sessionStorage.getItem('notch-workspace-hydrated')==='1'`);
  await listening;
  const baseUrl = `http://127.0.0.1:${nas.server.address().port}`;
  const pairingCode = store.startPairing({uid:'u'}).code;
  phase = 'pair';
  const pair = await js(`window.notchAPI.syncPairClaim(${JSON.stringify({baseUrl,pairingCode})})`);
  assert.equal(pair.ok,true,JSON.stringify(pair));
  phase = 'migration';
  const migration = await js(`window.notchAPI.syncRunMigration({localTodosJson:localStorage.getItem('notch-todo-data'),workspace:getWorkspaceSnapshotForSync()})`);
  assert.equal(migration.ok,true,JSON.stringify(migration));
  const live = () => [...store.bucket('u').live.values()].filter(row => row.collection === 'aiCompletions');
  assert.equal(live().length,1);
  assert.equal(live()[0].payload.title,'配对前的完成记录');
  await js('window.receivedCompletions=0;window.notchAPI.onTaskCompletion(() => window.receivedCompletions++);void 0;');
  phase = 'remote overflow';
  const time = Date.now();
  const rows = Array.from({length:150},(_,i) => normalizeSyncedCompletion({id:`remote-${i}`,source:'claude',title:`远端完成 ${i}`,receivedAt:time+i,readAt:null}));
  store.applyPush('u',rows.map(row => ({collection:'aiCompletions',entityId:`completion:${row.id}`,op:'upsert',payload:row,clientMutationId:`remote-${row.id}`,deviceId:'other',baseServerRev:store.bucket('u').serverRev})),{deviceId:'other'});
  assert.equal(live().length,100);
  await js('window.notchAPI.syncRetry()');
  await until(`document.getElementById('home-inbox-unread').textContent==='100'`);
  let inbox = await js('window.notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.total,100);assert.equal(inbox.items[0].title,'远端完成 149');
  assert.equal(await js('receivedCompletions'),0,'NAS import never replays completion notifications');
  const status = await js('window.notchAPI.syncGetDashboard()');
  assert.equal(status.contentResults['AI 完成'].ok,true,JSON.stringify(status.contentResults));
  phase = 'read sync';
  const row = inbox.items[0], key = `completion:${completionSyncKey(row)}`;
  await js(`window.notchAPI.markTaskRead(${JSON.stringify(row.id)})`);
  await js('window.notchAPI.syncRetry()');
  assert.notEqual(store.bucket('u').live.get(key).payload.readAt,null);
  phase = 'local HTTP completion';
  for(let i=0;i<300 && !port;i++) await sleep(20);
  const payload = {event_id:'native-after-pair',title:'本机新完成',task_id:'fixture',completed_at:Date.now()};
  // Ensure the real local completion arrives after all remote reception times.
  await sleep(Math.max(0,time+160-Date.now()));
  for(let i=0;i<2;i++) {
    const response = await fetch(`http://127.0.0.1:${port}/notify/codex`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(response.status,202,await response.text());
  }
  await js('window.notchAPI.syncRetry()');
  assert.equal(live().length,100);
  assert.ok(live().some(row => row.payload.title==='本机新完成'));
  assert.equal(await js('receivedCompletions'),1);
  inbox = await js('window.notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.total,100);assert.equal(inbox.items.filter(row => row.title==='本机新完成').length,1);
  phase = 'Grok native prompt identity and NAS sync';
  const {grokCompletion} = require('../scripts/grok-notify'), grokSample = require('./fixtures/grok-stop.json');
  for(const [index,i] of [1,2,2].entries()) {
    const grok = grokCompletion({...grokSample,cwd:profile,promptId:`nas-grok-${i}`,lastAssistantMessage:`Grok 同步 ${i}`,timestamp:new Date().toISOString()});
    const response=await fetch(`http://127.0.0.1:${port}/notify/grok`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(grok)});
    assert.equal(response.status,202);assert.equal((await response.json()).result,index===2?'duplicate':'queued');
  }
  await js('window.notchAPI.syncRetry()');
  assert.equal(live().length,100);assert.equal(live().filter(row=>row.payload.source==='grok').length,2);
  inbox=await js('window.notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.items.filter(row=>row.source==='grok').length,2);
  const grokRow=inbox.items.find(row=>row.source==='grok');
  await js(`window.notchAPI.markTaskRead(${JSON.stringify(grokRow.id)})`);await js('window.notchAPI.syncRetry()');
  assert.notEqual(store.bucket('u').live.get(`completion:${completionSyncKey(grokRow)}`).payload.readAt,null);
  phase = 'Copilot and Antigravity completion sync';
  const {copilotCompletion}=require('../scripts/copilot-notify'),{antigravityCompletion}=require('../scripts/antigravity-notify');
  for(const [source,payload] of [
    ['copilot',copilotCompletion({...require('./fixtures/copilot-stop.json'),cwd:profile,timestamp:Date.now(),transcriptPath:''},{event:'agentStop'})],
    ['antigravity',antigravityCompletion({...require('./fixtures/antigravity-stop.json'),workspacePaths:[profile]})],
  ]) {
    for(let i=0;i<2;i++) {
      const response=await fetch(`http://127.0.0.1:${port}/notify/${source}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      assert.equal(response.status,202);assert.equal((await response.json()).result,i?'duplicate':'queued');
    }
    await js('window.notchAPI.syncRetry()');
    const stored=live().find(row=>row.payload.source===source);assert(stored,`${source} must reach NAS`);
    assert.equal(stored.payload.window,undefined);assert.equal(stored.payload.cwd,undefined);
    const local=(await js('window.notchAPI.getTaskInbox({limit:100})')).items.find(row=>row.source===source);
    await js(`window.notchAPI.markTaskRead(${JSON.stringify(local.id)})`);await js('window.notchAPI.syncRetry()');
    assert.notEqual(store.bucket('u').live.get(`completion:${completionSyncKey(local)}`).payload.readAt,null);
    assert.equal(live().length,100);
  }
  phase = 'NAS authority and completion during migration';
  duringCommit = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/notify/codex`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:'during-migration',title:'同步期间的新完成',completed_at:Date.now()})});
    assert.equal(response.status,202);
  };
  const fromNas = await js(`window.notchAPI.syncRunMigration({choice:'use_nas',localTodosJson:localStorage.getItem('notch-todo-data'),workspace:getWorkspaceSnapshotForSync()})`);
  assert.equal(fromNas.ok,true,JSON.stringify(fromNas));
  inbox = await js('window.notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.total,100);
  assert.ok(inbox.items.some(row => row.title==='同步期间的新完成'));
  await js('window.notchAPI.syncRetry()');
  assert.ok(live().some(row => row.payload.title==='同步期间的新完成'));
  phase = 'NAS restart';
  const restarted = createPersistentStore({filePath:nasFile,serverId:'completion-nas'});
  assert.equal([...restarted.bucket('u').live.values()].filter(row => row.collection==='aiCompletions').length,100);
  assert.equal(createTaskInbox({filePath:path.join(profile,'task-inbox.json')}).list().total,100);
}
require('../main.js');
