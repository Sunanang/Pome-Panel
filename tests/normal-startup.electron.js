'use strict';
const assert=require('node:assert/strict');
const {app,dialog,systemPreferences,BrowserWindow}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
// Exercise the production bootstrap with no test-mode bypass. Only host side
// effects are injected: never register Electron or request real OS permission.
delete process.env.TODO_TEST_USER_DATA;
require('../cursor-usage').readAuthToken=()=>({ok:false});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false});
let login=false,loginWrites=0,permissions=0;
app.getLoginItemSettings=()=>({openAtLogin:login});app.setLoginItemSettings=({openAtLogin})=>{login=openAtLogin;loginWrites++;};
const adapters=require('../platform-adapters'),original=adapters.loadAdapter;
adapters.loadAdapter=(...args)=>{const adapter=original(...args);if(adapter.permissions)adapter.permissions.selfCheck=async()=>{permissions++;await new Promise(()=>{});};return adapter;};
systemPreferences.subscribeNotification=()=>1;systemPreferences.unsubscribeNotification=()=>{};
dialog.showMessageBox=async()=>({response:1});
const watchdog=setTimeout(()=>{console.error('Normal empty-profile startup timed out');app.exit(1);},20000);let started=false;
app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);console.log('Normal startup path with fresh profile, tray and pending permission check passed');app.exit(0);}).catch(e=>{console.error(e);app.exit(1);});}));
async function run(c){
 for(let i=0;i<200;i++){if(await c.executeJavaScript('!!window.NotchWorkspace'))break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(process.env.TODO_TEST_USER_DATA,undefined);assert(BrowserWindow.fromWebContents(c).isVisible());
 await c.executeJavaScript(`document.getElementById('notch').click()`);
 for(let i=0;i<200;i++){if(await c.executeJavaScript(`document.getElementById('app').classList.contains('expanded') && !modeBusy`))break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(await c.executeJavaScript(`document.getElementById('app').classList.contains('expanded')`),true);
 if(process.platform==='darwin'){assert.equal(permissions,1);assert(loginWrites>0);}
}
require('../main.js');
