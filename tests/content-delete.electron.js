'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
const shots = process.env.POME_DELETE_SHOTS || path.join(__dirname, '../dist.noindex/content-delete');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
clipboard.read = async () => [];
let credentials = [1,2,3].map(n => ({id:`credential-${n}`,service:`项目密钥 ${n}`,account:`demo-${n}@example.com`,passwordMask:'**********',createdAt:Date.now()}));
const deletes = { recordings: [], credentials: [] };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
  if(channel === 'credentials:list') return {ok:true,secureStorage:true,items:credentials};
  if(channel === 'credentials:delete-many') {
    deletes.credentials.push([...args[0]]);
    credentials = credentials.filter(row => !args[0].includes(row.id));
    return {ok:true};
  }
  if(channel === 'recordings:read') return null;
  if(channel === 'clipboard:readImage') return null;
  if(channel === 'recordings:delete') { deletes.recordings.push(args[0]);return true; }
  return listener(event,...args);
});
const errors=[];let started=false;
const watchdog=setTimeout(()=>{console.error('Content deletion timed out',errors);app.exit(1);},90000);
app.on('web-contents-created',(_event,c)=>{
  c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message);});
  c.once('did-finish-load',()=>{
    if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
    run(c).then(()=>{clearTimeout(watchdog);console.log('Content deletion and clipboard acceptance passed');app.exit(0);})
      .catch(error=>{console.error(error,errors);app.exit(1);});
  });
});
async function run(c) {
  fs.mkdirSync(shots,{recursive:true});
  const js=code=>c.executeJavaScript(code);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(code) {
    for(let i=0;i<200;i++){if(await js(code).catch(()=>false))return;await sleep(20);}
    throw new Error('Timed out: '+code);
  }
  async function capture(name) {
    await js('document.fonts.ready');await sleep(250);
    fs.writeFileSync(path.join(shots,name+'.png'),(await c.capturePage()).toPNG());
    if (await js('!!document.getElementById("content-delete-confirm")?.open')) {
      const rect=await js(`(()=>{const r=document.getElementById('content-delete-confirm').getBoundingClientRect();return {x:Math.floor(r.x)-8,y:Math.floor(r.y)-8,width:Math.ceil(r.width)+16,height:Math.ceil(r.height)+16};})()`);
      fs.writeFileSync(path.join(shots,name+'-detail.png'),(await c.capturePage(rect)).toPNG());
    }
  }
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await until('!!window.NotchWorkspace && !workspaceReloadPending');
  BrowserWindow.fromWebContents(c).showInactive();
  await js('notchAPI.setFeature("clip",true)');
  await js('setMode(true)');await until('!modeBusy');
  await js(`document.querySelector('#ui-capsule-hint button')?.click();
    document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{clipboard:{history:[
      {id:'clip-text',type:'text',text:'项目会议记录：整理本周进展与下一步计划。',timestamp:Date.now()},
      {id:'clip-url',type:'text',text:'https://example.com/project',timestamp:Date.now()},
      {id:'clip-image',type:'image',imagePath:'clipboard-images/fixture.png',timestamp:Date.now()}
    ],favorites:[]}}}));setActiveTab('clip');`);
  await until('!!document.querySelector(".clip-item .clip-fav-btn")');
  await js('document.querySelector(".clip-fav-btn").focus()');
  const bounds=await js(`(()=>{const gaps=[...document.querySelectorAll('.clip-item')].map(row=>{const a=row.querySelector('.clip-fav-btn').getBoundingClientRect(),b=row.querySelector('.clip-del-btn').getBoundingClientRect();return b.left-a.right;});return {gap:Math.min(...gaps),gaps};})()`);
  await capture(process.env.POME_DELETE_BASELINE?'clipboard-before':'clipboard-after');
  if(!process.env.POME_DELETE_BASELINE) {
    const rect=await js(`(()=>{const r=document.querySelector('.clip-item').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
    fs.writeFileSync(path.join(shots,'clipboard-controls.png'),(await c.capturePage(rect)).toPNG());
  }
  if(process.env.POME_DELETE_BASELINE){console.log('Baseline clipboard gap:',bounds.gap);return;}
  assert(bounds.gap>=5.9,'clipboard actions have distinct, separated hit targets');
  await click('.clip-fav-btn');assert.equal(await js('clipFavorites.includes("clip-image")'),true);
  assert.equal(await js('clipHistory.length'),3,'favorite never deletes an item');
  await click('.clip-del-btn');assert.equal(await js('clipHistory.length'),2,'delete remains separately clickable');
  assert.equal(await js('clipHistory.some(item=>item.id==="clip-image")'),false);
  const dialog='#content-delete-confirm';
  const open=selector=>`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.focus();b.click();})()`;
  const countFor=collection=>`JSON.stringify(getWorkspaceSnapshotForSync().${collection})`;
  async function preview(selector,name,state) {
    const before=await js(state),calls=JSON.stringify(deletes);
    await js(open(selector));await until(`document.querySelector('${dialog}').open`);
    assert.equal(await js(state),before,'opening never deletes '+name);
    assert.equal(JSON.stringify(deletes),calls,'opening never invokes destructive IPC');
    assert.equal(await js('document.activeElement.id'),'content-delete-cancel','cancel has initial focus');
    await capture(name);
    await click('#content-delete-cancel');await until(`!document.querySelector('${dialog}').open`);
    assert.equal(await js(state),before,'cancel preserves '+name);
    assert.equal(JSON.stringify(deletes),calls,'cancel never invokes destructive IPC');
    assert.equal(await js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`),true,'cancel restores trigger focus');
    return before;
  }
  async function approve(selector,state) {
    const before=await js(state);
    await js(open(selector));await until(`document.querySelector('${dialog}').open`);
    await click('#content-delete-apply');await until(`${state}!==${JSON.stringify(before)}`);
  }
  const shift=selector=>js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
  await js(`(()=>{
    const now=Date.now();
    for(const priority of PRIORITIES)data[priority]=[];
    data.P0=[1,2,3].map(n=>({id:'todo-'+n,text:'待办事项 '+n,done:false,createdAt:now,deadline:'',remindedAt:0}));
    data.P1=[{id:'category-existing',text:'分类中的待办',done:false,createdAt:now,deadline:''}];
    saveData(data);renderTodoBoard();
    document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{
      commands:[1,2,3].map(n=>({id:'command-'+n,text:'常用指令 '+n+'：整理项目进展',createdAt:now})),
      links:[{id:'group-1',name:'项目资料',links:[1,2,3].map(n=>({id:'link-'+n,title:'参考资料 '+n,url:'https://example.com/'+n,createdAt:now}))}],
      notes:{home:'',archive:[1,2].map(n=>({id:'note-'+n,title:'项目笔记 '+n,content:'# 项目计划\\n保存这段笔记内容。',createdAt:now,updatedAt:now}))},
      recordings:[1,2,3].map(n=>({id:'recording-'+n,title:'会议录音 '+n,transcript:'已保存的会议转写内容',durationMs:60000,createdAt:now,audioPath:'recordings/fixture-'+n+'.webm',mimeType:'audio/webm'}))
    }}));
    hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='commands');
    homeOrder=['commands',...HOME_MODULE_REGISTRY.filter(id=>id!=='commands')];homeSizes.commands='medium';homeWorkingLayout=null;
    applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});
  })()`);
  await js('setActiveTab("home")');
  const commands=countFor('commands');
  const command='.command-item[data-id="command-1"] [data-action="delete-command"]';
  await preview(command,'command-confirm',commands);
  await approve(command,commands);
  await shift('.command-item[data-id="command-2"]');await shift('.command-item[data-id="command-3"]');
  await preview('#command-bulk-delete','command-bulk-confirm',commands);await approve('#command-bulk-delete',commands);
  await js('setActiveTab("todo")');
  const todos='JSON.stringify(data.P0)';
  const todo='.todo-item[data-id="todo-1"] [data-action="delete"]';
  await preview(todo,'todo-confirm',todos);
  // Space activates the default cancel button, without toggling the panel.
  await js(open(todo));await until(`document.querySelector('${dialog}').open`);
  c.sendInputEvent({type:'keyDown',keyCode:'Space'});c.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await until(`!document.querySelector('${dialog}').open`);assert.equal(await js('isExpanded'),true);
  await js(open(todo));await until(`document.querySelector('${dialog}').open`);
  c.sendInputEvent({type:'keyDown',keyCode:'Escape'});c.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await until(`!document.querySelector('${dialog}').open`);await sleep(100);
  assert.equal(await js('isExpanded'),true,'Escape cancels without collapsing');
  await approve(todo,todos);
  await shift('.todo-item[data-id="todo-2"]');await shift('.todo-item[data-id="todo-3"]');
  await preview('.todo-bulk-delete[data-bulk-priority="P0"]','todo-bulk-confirm',todos);
  await approve('.todo-bulk-delete[data-bulk-priority="P0"]',todos);
  await preview('[data-remove-priority="P1"]','category-confirm','JSON.stringify(todoCategoryOrder)');
  // A group/category must not silently delete content added after the preview.
  await js(open('[data-remove-priority="P1"]'));await until(`document.querySelector('${dialog}').open`);
  await js(`data.P1.push({id:'arrived-later',text:'预览后新增的待办',done:false,createdAt:Date.now()})`);
  await click('#content-delete-apply');await sleep(40);
  assert.equal(await js('data.P1.some(item=>item.id==="arrived-later")'),true);assert.equal(await js('todoCategoryOrder.includes("P1")'),true);
  await js('setActiveTab("notes")');
  const notes=countFor('notes');
  await preview('[data-action="delete-note"]','note-confirm',notes);await approve('[data-action="delete-note"]',notes);
  await js('setActiveTab("links")');
  const links=countFor('links'),link='[data-link-id="link-1"] [data-action="delete-link"]';
  await preview(link,'link-confirm',links);await approve(link,links);
  await shift('[data-link-id="link-2"]');await shift('[data-link-id="link-3"]');
  await preview('[data-action="delete-group"]','link-group-confirm',links);
  await preview('#link-bulk-delete','link-bulk-confirm',links);await approve('#link-bulk-delete',links);
  await approve('[data-action="delete-group"]',links);
  await js('setActiveTab("recordings")');
  const recordings=countFor('recordings'),recording='[data-action="delete-recording"]';
  await preview(recording,'recording-confirm',recordings);await approve(recording,recordings);
  await until('!!document.querySelector(".recording-item[data-id=\\"recording-2\\"]")');
  const rowDelete='.recording-item[data-id="recording-2"] [data-action="delete-recording-item"]';
  await preview(rowDelete,'recording-row-confirm',recordings);
  await shift('.recording-item[data-id="recording-2"]');await shift('.recording-item[data-id="recording-3"]');
  await preview('#recording-bulk-delete','recording-bulk-confirm',recordings);await approve('#recording-bulk-delete',recordings);
  assert.equal(deletes.recordings.length,3,'each confirmed recording file is deleted once');
  await js('setActiveTab("credentials")');await until('document.querySelectorAll(".credential-item").length===3');
  const vault='document.getElementById("credential-list").textContent';
  const credential='.credential-item[data-id="credential-1"] [data-credential-delete]';
  await preview(credential,'credential-confirm',vault);await approve(credential,vault);
  await shift('.credential-item[data-id="credential-2"] .credential-copy');await shift('.credential-item[data-id="credential-3"] .credential-copy');
  await preview('#credential-bulk-delete','credential-bulk-confirm',vault);await approve('#credential-bulk-delete',vault);
  assert.deepEqual(deletes.credentials,[['credential-1'],['credential-2','credential-3']]);
  await js(`window.deleteResult='pending';PomeDeleteConfirm.open({items:['<img src=x onerror=alert(1)>','<script>private</script>'],messageKey:'ui.delete.description'}).then(v=>window.deleteResult=v);void 0`);
  assert.equal(await js('document.querySelectorAll(".content-delete-preview img,.content-delete-preview script").length'),0,'previews are text only');
  assert.equal(await js('PomeDeleteConfirm.open({items:["second"]})'),false,'concurrent dialogs never replace pending targets');
  // Backdrop cancellation must be a pointer press outside the dialog.
  c.sendInputEvent({type:'mouseDown',x:8,y:8,button:'left',clickCount:1});
  c.sendInputEvent({type:'mouseUp',x:8,y:8,button:'left',clickCount:1});
  await until('window.deleteResult===false');
  await js(`window.deleteResult='pending';PomeDeleteConfirm.open({items:['示例项目 '+ '很长的名称'.repeat(25), '第二项','第三项','第四项','第五项']}).then(v=>window.deleteResult=v);void 0`);
  await js(`notchAPI.setLanguage('en-US')`);await until('document.documentElement.lang==="en-US"');
  assert.equal(await js('document.getElementById("content-delete-title").textContent'),'Confirm deletion?');
  assert.equal(await js('document.querySelectorAll(".content-delete-preview li").length'),3);
  assert.equal(await js('document.getElementById("content-delete-more").textContent'),'2 more');
  await capture('confirmation-english');
  for(const locale of ['zh-CN','zh-TW','en-US','ja-JP','ko-KR','es-ES','fr-FR','de-DE','ru-RU','pt-BR']) {
    await js(`notchAPI.setLanguage(${JSON.stringify(locale)})`);await until(`document.documentElement.lang===${JSON.stringify(locale)}`);
    assert.equal(await js(`(()=>{const d=document.getElementById('content-delete-confirm'),r=d.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth+1;})()`),true,'localized modal stays within viewport: '+locale);
    assert.equal(await js('window.deleteResult'),'pending','locale changes never approve deletion');
  }
  await js('setMode(false)');await until('window.deleteResult===false && !modeBusy');
  assert.equal(await js('document.getElementById("content-delete-confirm").open'),false,'collapse cancels pending deletion');
  await js('setMode(true)');await until('!modeBusy');
  await js(`window.deleteResult='pending';PomeDeleteConfirm.open({items:['切换页面前的内容']}).then(v=>window.deleteResult=v);void 0`);
  await js('setActiveTab("links")');await until('window.deleteResult===false');
  fs.writeFileSync(path.join(shots,'result.json'),JSON.stringify({clipboardGap:bounds.gap,deletes,consoleErrors:errors},null,2));
  assert.deepEqual(errors,[]);
}
require('../main');
