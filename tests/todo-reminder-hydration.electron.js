'use strict';
// Hold actual workspace import IPC to exercise parser-time reminder races.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {app,BrowserWindow,ipcMain,clipboard,dialog} = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
const output = process.env.POME_TODO_HYDRATION_SHOTS || path.join(__dirname,'../dist.noindex/todo-reminder-hydration');
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS='1';
process.env.POME_TEST_LANGUAGE='zh-CN';
clipboard.read=async()=>[];
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(profile,'app-settings.json'),JSON.stringify({taskNotifications:false}));
function seed(root,prefix,label) {
  fs.mkdirSync(root,{recursive:true});
  const now=Date.now(),deadline=new Date(now+1800000).toISOString();
  const rows=[
    {id:prefix+'-seen',text:label+' · 已提醒任务',deadline,remindedAt:0,createdAt:now,done:false},
    {id:prefix+'-unseen',text:label+' · 未提醒任务',deadline,remindedAt:0,createdAt:now,done:false},
  ];
  const todos=Object.fromEntries(Array.from({length:8},(_,i)=>['P'+i,i===0?rows:[]]));
  const receipt={id:rows[0].id,deadline,remindedAt:now-60000};
  fs.writeFileSync(path.join(root,'workspace.json'),JSON.stringify({version:1,updatedAt:now,localStorage:{'notch-todo-data':JSON.stringify(todos)}}));
  const file=path.join(root,'todo-reminders.json'),bytes=JSON.stringify({version:1,receipts:[receipt]})+'\n';
  fs.writeFileSync(file,bytes);
  return {root,rows,receipt,file,bytes};
}
const initial=seed(profile,'cold','首次导入');
const schedules=[],errors=[],phases=[];
let holdImport=true,releaseImport=null,choosePath='',started=false;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[choosePath]});
dialog.showMessageBox=async()=>({response:0});
dialog.showErrorBox=(title,message)=>errors.push(title+': '+message);
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,(event,...args)=>{
  if(channel==='workspace:load-data' && holdImport) return new Promise(resolve=>{releaseImport=()=>{holdImport=false;resolve(listener(event,...args));};});
  if(channel==='todos:schedule-reminders') {
    const result=listener(event,...args);
    schedules.push({ids:(args[0]||[]).map(row=>row.id),root:args[1],result});return result;
  }
  if(channel==='credentials:list')return {ok:true,secureStorage:true,items:[]};
  return listener(event,...args);
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const notice=()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith('/renderer/notification.html'));
async function until(check,label) {
  for(let i=0;i<300;i++){if(await check())return;await sleep(20);}
  throw new Error('Timeout: '+label);
}
const timer=setTimeout(()=>{console.error('Reminder hydration timed out',errors);app.exit(1);},60000);
app.on('web-contents-created',(_event,c)=>{
  c.on('console-message',detail=>{if(detail.level==='error'&&!detail.message.includes('ERR_'))errors.push(detail.message);});
  c.on('did-finish-load',()=>{
    if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
    run(c).then(()=>{clearTimeout(timer);console.log('Reminder hydration: cold import, real workspace switch, receipt preservation and authoritative deletion passed');app.exit(0);})
      .catch(async error=>{console.error(error,errors);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG());}catch{}app.exit(1);});
  });
});
async function run(c) {
  const js=code=>c.executeJavaScript(code,true);
  await until(()=>js('!!window.NotchWorkspace').catch(()=>false),'parser initialized');
  async function capture(w,name) {
    await w.webContents.executeJavaScript('document.fonts.ready');await sleep(550);
    fs.writeFileSync(path.join(output,name+'.png'),(await w.capturePage()).toPNG());
  }
  async function verifyImport(fixture,label) {
    await until(()=>Boolean(releaseImport),label+' import held');
    assert.equal(await js('todoReminderWorkspaceReady'),false);
    assert.equal(fs.readFileSync(fixture.file,'utf8'),fixture.bytes);
    const before=schedules.length;
    await js('rescheduleTodoReminders([]);true');
    assert.equal(schedules.length,before,'renderer never sends a temporary projection');
    assert.equal((await js('notchAPI.scheduleTodoReminders([])')).error,'workspace_not_ready');
    assert.equal((await js(`notchAPI.scheduleTodoReminders([],${JSON.stringify(fixture.root+'-old')})`)).error,'stale_workspace');
    assert.equal(fs.readFileSync(fixture.file,'utf8'),fixture.bytes,'rejected IPC does not touch durable receipts');
    const release=releaseImport;releaseImport=null;release();
    await until(()=>js(`todoReminderWorkspaceReady && !workspaceReloadPending && workspacePersistenceRoot===${JSON.stringify(fixture.root)} && data.P0.some(row=>row.id===${JSON.stringify(fixture.rows[0].id)}&&row.remindedAt===${fixture.receipt.remindedAt})`).catch(()=>false),label+' receipt restored');
    const rows=await js('PRIORITIES.flatMap(p=>data[p]||[])');
    assert.deepEqual(rows.map(row=>row.id),fixture.rows.map(row=>row.id),'only the selected workspace is adopted');
    assert.equal(rows[1].remindedAt,0);
    assert.equal(fs.readFileSync(fixture.file,'utf8'),fixture.bytes,'import preserves the original receipt');
    const win=BrowserWindow.fromWebContents(c);win.showInactive();
    await js('(async()=>{await setMode(true);await setActiveTab("todo");})()');
    await until(()=>js('isExpanded && !modeBusy && activeTab==="todo" && !tabBusy'),label+' task view');
    await js('document.querySelector("#ui-capsule-hint button")?.click();true');
    await capture(win,label+'-restored');
    await js('notchAPI.setTaskNotifications(true)');
    await until(async()=>{const w=notice();return w&&await w.webContents.executeJavaScript(`currentNotification?.title===${JSON.stringify(fixture.rows[1].text)} && isVisible && !isHiding`).catch(()=>false);},label+' unshown task delivered');
    const w=notice();
    assert.equal(await w.webContents.executeJavaScript('queueElement.hidden || !queueElement.textContent'),true,'already shown task never queues');
    await capture(w,label+'-unseen-only');
    await w.webContents.executeJavaScript('document.getElementById("notification-close").click()');
    await sleep(900);assert(!notice()||!notice().isVisible(),'no duplicate reminder after dismissing the unshown task');
    await js('notchAPI.setTaskNotifications(false)');
    phases.push({label,root:fixture.root,restored:rows.map(({id,remindedAt})=>({id,remindedAt})),delivered:fixture.rows[1].id});
  }
  await verifyImport(initial,'cold-import');
  const second=seed(path.join(profile,'second-workspace'),'switched','切换后');
  choosePath=second.root;holdImport=true;releaseImport=null;
  await js('void notchAPI.chooseWorkspace()');
  await verifyImport(second,'workspace-switch');
  const bytes=fs.readFileSync(second.file,'utf8');
  assert.equal((await js(`notchAPI.scheduleTodoReminders([],${JSON.stringify(initial.root)})`)).error,'stale_workspace');
  assert.equal(fs.readFileSync(second.file,'utf8'),bytes,'late old-workspace schedules cannot prune the new workspace');
  await js('for(const priority of PRIORITIES)data[priority]=[];saveData(data);true');
  await until(()=>JSON.parse(fs.readFileSync(second.file,'utf8')).receipts.length===0,'real deletion still prunes receipts');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({phases,schedules,authoritativeDeletePruned:true,consoleErrors:errors},null,2));
}
require('../main');
