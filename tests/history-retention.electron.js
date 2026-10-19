'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
clipboard.read = async () => [];
require('../cursor-usage').readAuthToken = () => ({ok:false});
require('../cursor-usage').fetchCursorUsage = async () => ({ok:false});
require('../codex-usage').readCodexUsage = async () => ({ok:true,detected:false});
require('../codex-auth').readLocalCodexToken = async () => ({ok:false});

const history = Array.from({length:140}, (_, i) => ({id:`c-${i}`,type:'text',text:`copy ${i}`,timestamp:i}));
const favorites = history.slice(0,20).map(row => row.id);
const images = path.join(profile,'clipboard-images');
fs.mkdirSync(images);
for (const name of ['shared','evicted']) fs.writeFileSync(path.join(images,`clip-${name}.png`), Buffer.from('fixture'));
for (const [index,name] of [[0,'shared'],[20,'shared'],[21,'evicted']]) {
  history[index] = {...history[index],type:'image',imagePath:`clipboard-images/clip-${name}.png`};
}
history[0].imagePath = path.join(images,'clip-shared.png'); // legacy absolute favorite, relative ordinary alias
fs.writeFileSync(path.join(profile,'workspace.json'), JSON.stringify({version:1,localStorage:{
  'notch-clip-history':JSON.stringify(history),'notch-clip-favorites':JSON.stringify(favorites),
}}));
const records = Array.from({length:140},(_, i) => ({id:`ai-${i}`,source:'codex',title:`完成 ${i}`,receivedAt:i,readAt:i % 2 ? null : i}));
fs.writeFileSync(path.join(profile,'task-inbox.json'),JSON.stringify({version:1,records,dedupe:{}}));

const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const errors = [];
let started = false;
const watchdog = setTimeout(() => {console.error('History retention timed out',errors);app.exit(1);},30000);
app.on('web-contents-created',(_event,c) => {
  c.on('console-message',details => {if(details.level === 'error' && !details.message.includes('ERR_')) errors.push(details.message);});
  c.once('did-finish-load',() => {
    if(started || !c.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(c).then(() => {clearTimeout(watchdog);console.log('History retention: startup, favorites, NAS projection, persisted capacity, image safety and AI count passed');app.exit(0);})
      .catch(error => {console.error(error,errors);app.exit(1);});
  });
});
async function run(c) {
  const js = code => c.executeJavaScript(code);
  async function until(expression) {
    for(let i=0;i<300;i++) {if(await js(expression).catch(() => false)) return;await sleep(25);}
    throw new Error(expression);
  }
  await until(`typeof getWorkspaceSnapshotForSync==='function' && getWorkspaceSnapshotForSync().clipboard.history.length===120`);
  let snapshot = await js('getWorkspaceSnapshotForSync().clipboard');
  assert.deepEqual(snapshot.favorites,favorites);
  assert.equal(snapshot.history[0].id,'c-139');
  assert.ok(snapshot.history.some(row => row.id==='c-0'));
  assert.ok(!snapshot.history.some(row => row.id==='c-20'));
  for(let i=0;i<100 && fs.existsSync(path.join(images,'clip-evicted.png'));i++) await sleep(20);
  assert.equal(fs.existsSync(path.join(images,'clip-evicted.png')),false);
  assert.equal(fs.existsSync(path.join(images,'clip-shared.png')),true,'favorite still owns the shared image');
  const inbox = await js('window.notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.total,100);assert.equal(inbox.unread,50);
  assert.equal(inbox.items[0].id,'ai-139');assert.equal(inbox.items.at(-1).id,'ai-40');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'task-inbox.json'))).records.length,100);
  assert.equal(await js(`document.querySelector('.home-inbox-retention').textContent`),'保留最新 100 条');

  await js(`(() => {
    const history=Array.from({length:170},(_,i)=>({id:'nas-'+i,type:'text',text:'NAS '+i,timestamp:i}));
    document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{clipboard:{history,favorites:['nas-0','nas-1','nas-2','nas-3','nas-4']}}}));
  })()`);
  snapshot = await js('getWorkspaceSnapshotForSync().clipboard');
  assert.equal(snapshot.history.length,105);assert.equal(snapshot.history[0].id,'nas-169');
  assert.equal(await js(`document.querySelector('#clip-list .clip-item')?.dataset.id`),'nas-169','sync also invalidates the rendered list');
  await js(`toggleClipFavorite('nas-0'); addClipEntry({type:'text',text:'new local copy'})`);
  snapshot = await js('getWorkspaceSnapshotForSync().clipboard');
  assert.equal(snapshot.history.length,104);
  assert.equal(snapshot.favorites.length,4);
  assert.ok(!snapshot.history.some(row => row.id==='nas-0'));
  assert.ok(snapshot.favorites.every(id => snapshot.history.some(row => row.id===id)));
  assert.equal(snapshot.history[0].text,'new local copy');
  await js('window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot())');
  const stored = JSON.parse(fs.readFileSync(path.join(profile,'workspace.json'))).localStorage;
  assert.equal(JSON.parse(stored['notch-clip-history']).length,104);
  assert.equal(JSON.parse(stored['notch-clip-favorites']).length,4);
  assert.deepEqual(errors,[]);
}
require('../main.js');
