'use strict';
const {app}=require('electron');const assert=require('node:assert/strict');
app.commandLine.appendSwitch('user-data-dir',process.env.TODO_TEST_USER_DATA);if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken=()=>({ok:false,error:'fixture_missing'});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false,error:'fixture_offline'});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_missing'});
let started=false;const watchdog=setTimeout(()=>{console.error('Cold restart verification timed out');app.exit(1);},15000);
app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);console.log('Actual Electron process restart retained '+process.env.POME_RESTART_CHECK);app.exit(0);}).catch(e=>{console.error(e);app.exit(1);});}));
async function run(c){
 for(let i=0;i<200;i++){try{if(await c.executeJavaScript('!!window.NotchWorkspace'))break;}catch{}await new Promise(r=>setTimeout(r,30));}
 if(process.env.POME_RESTART_CHECK==='inbox') {const inbox=await c.executeJavaScript('window.notchAPI.getTaskInbox()');assert.equal(inbox.total,3);assert.equal(inbox.unread,1);assert.equal(inbox.items.length,3);assert.equal(inbox.items[1].readAt!==null,true);const original=JSON.parse(require('node:fs').readFileSync(require('node:path').join(process.env.TODO_TEST_USER_DATA,'inbox-before-rebuild.json')));assert.equal(original.records.length,50);assert.equal(original.records.filter(r=>r.readAt!==null).length,1);const store=require('../taskInbox').createTaskInbox({filePath:require('node:path').join(process.env.TODO_TEST_USER_DATA,'task-inbox.json')});assert.equal(store.accept({source:'codex',eventId:require('../taskInbox').completionEventId({source:'codex',event_id:'stable-after-rebuild'})}).duplicate,true);}
 else {const status=await c.executeJavaScript('window.notchAPI.syncGetStatus()');assert.equal(status.bound,true);assert.equal(status.recovery.paused,true);const result=await c.executeJavaScript('window.notchAPI.syncRetry()');assert.equal(result.error,'sync_paused_after_restore');}
}
require('../main.js');
