'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {app,BrowserWindow,ipcMain}=require('electron');
let copiedCommand;const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>handle(channel,channel==='clipboard:write'?async(_event,value)=>{copiedCommand=value;return true}:handler);
const profile=process.env.TODO_TEST_USER_DATA,home=path.join(profile,'hook-home');
fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
fs.writeFileSync(path.join(profile,'.ui-welcome-done'),'1');
const {createAiSourceHooks}=require('../aiSourceHooks');
const hooks=createAiSourceHooks({homeDir:home,env:{},runtimeCheck:()=>true});
const output=process.env.POME_REVIEW_SHOTS||path.join(__dirname,'../dist.noindex/notification-listener');fs.mkdirSync(output,{recursive:true});
app.commandLine.appendSwitch('user-data-dir',profile);if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS='1';
require('../cursor-usage').readAuthToken=()=>({ok:false});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false,port;
const blocker=http.createServer();const listen=http.Server.prototype.listen;let collide=true;
app.on('pome-test-notification-port',value=>{port=value});
const watchdog=setTimeout(()=>{console.error('Listener acceptance timed out');app.exit(1)},45000);
async function until(check,label){for(let i=0;i<350;i++){if(await check())return;await sleep(25)}throw new Error('Timed out: '+label)}
app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{
 if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
 run(c).then(()=>{clearTimeout(watchdog);console.log('Occupied-port recovery, persistent listening label, command comment copy/edit/reload, meeting UI and screenshots passed:',output);app.exit(0)}).catch(e=>{console.error(e);app.exit(1)});
}));
async function run(c){
 const js=s=>c.executeJavaScript(s);const panel=BrowserWindow.fromWebContents(c);
 await until(()=>js('!!window.NotchWorkspace && window.NotchAiSources?.getState().ready'),'startup');
 const initial=await js('notchAPI.getAiSources()');assert.equal(initial.listener.listening,false);assert.equal(initial.listener.error,'EADDRINUSE');
 await js('setMode(true)');await until(()=>js("document.querySelector('.home-inbox-listener').textContent.includes('监听不可用')"),'visible unavailable listener');
 await new Promise(r=>blocker.close(r));
 await until(()=>Boolean(port),'port recovery');await js('NotchAiSources.refresh()');
 await until(()=>js("document.querySelector('.home-inbox-listener').textContent==='监听中'"),'listening restored');
 assert.equal((await js("notchAPI.testAiSource('codex')")).ok,true);
 const response=await fetch(`http://127.0.0.1:${port}/notify/codex`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'agent-turn-complete','thread-id':'acceptance','turn-id':'normal','last-assistant-message':'已完成通知链路回归验证'})});assert.equal(response.status,202);
 await until(()=>js("document.querySelector('.home-inbox-row')?.textContent.includes('已完成通知链路回归验证')"),'record received');
 assert.equal(await js("document.querySelector('.home-inbox-listener').textContent"),'监听中','history does not hide listener');
 for (const size of ['mini','small','medium','large']) {
  const visible=await js(`(async()=>{const tile=document.getElementById('home-inbox');tile.dataset.widgetSize=${JSON.stringify(size)};tile.style.width=${JSON.stringify(['mini','small'].includes(size)?'190px':'392px')};await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const label=document.querySelector('.home-inbox-listener'),r=label.getBoundingClientRect(),b=tile.getBoundingClientRect();return getComputedStyle(label).display!=='none'&&r.width>0&&r.right<=b.right&&r.bottom<=b.bottom;})()`);
  assert.equal(visible,true,size+': listener remains visible in compact cards');
 }
 await js(`document.getElementById('home-inbox').style.removeProperty('width')`);
 await js(`document.querySelector('#ui-capsule-hint button')?.click();
  hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!['commands','inbox','recorder'].includes(id));
  homeSizes={...homeSizes,commands:'large',inbox:'large',recorder:'large'};
  applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});
  const input=document.getElementById('command-add');input.value='npm test';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  document.querySelector('[data-action="edit-comment"]').click();const edit=document.querySelector('.command-edit');edit.value='提交前运行回归测试';edit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
 const command=await js('getCommandsForSync()[0]');assert.equal(command.comment,'提交前运行回归测试');
 await js(`document.querySelector('[data-action="copy-command"]').click()`);
 await until(()=>Boolean(copiedCommand),'clipboard write');assert.equal(copiedCommand.text,'npm test');
 await js(`document.querySelector('[data-action="edit-comment"]').click();document.querySelector('.command-edit').value='不保存';document.querySelector('.command-edit').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
 assert.equal((await js('getCommandsForSync()[0]')).comment,command.comment);
 await sleep(500);await js('dismissStatusToast(false)');fs.writeFileSync(path.join(output,'home-listening-comments.png'),(await panel.capturePage()).toPNG());
 await js(`setActiveTab('settings')`);await js(`document.getElementById('settings-meeting-mode').click()`);
 await until(()=>js('(async()=> (await notchAPI.getAppSettings()).meetingMode)()'),'meeting enabled');
 await js(`NotchSettings.reveal(document.getElementById('settings-meeting-mode'),{block:'center'})`);await sleep(400);
 fs.writeFileSync(path.join(output,'meeting-mode.png'),(await panel.capturePage()).toPNG());
 await js(`setActiveTab('home')`);
 assert.equal(await js("document.querySelector('.home-inbox-listener').textContent"),'会议模式');
 await sleep(300);
 assert.equal(BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().endsWith('/notification.html')&&w.isVisible()),false);
 // Persistence: renderer and settings reload must retain comments and meeting mode.
 await new Promise(r=>{c.once('did-finish-load',r);c.reload()});
 await until(()=>js('!!window.NotchWorkspace'),'reload');
 assert.equal((await js('getCommandsForSync()[0]')).comment,command.comment);
 assert.equal((await js('notchAPI.getAppSettings()')).meetingMode,true);
 await js('notchAPI.setMeetingMode(false)');
}
(async()=>{
 const plan=await hooks.preview('codex');assert.equal((await hooks.apply(plan.token)).ok,true);
 await new Promise(r=>listen.call(blocker,0,'127.0.0.1',r));
 http.Server.prototype.listen=function(...args){if(collide&&args[0]===0&&args[1]==='127.0.0.1'){collide=false;args[0]=blocker.address().port}return listen.apply(this,args)};
 require('../main.js');
})().catch(e=>{console.error(e);app.exit(1)});
