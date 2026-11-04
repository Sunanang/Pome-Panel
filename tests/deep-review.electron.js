'use strict';
// Native input and isolated storage: no real accounts, media or clipboard writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,BrowserWindow,ipcMain}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA;assert(profile,'isolated profile required');
const phase=process.env.POME_AUDIT_PHASE||'interaction',baseline=process.env.POME_AUDIT_BASELINE==='1';
const output=path.join(__dirname,'../dist.noindex/deep-review');fs.mkdirSync(output,{recursive:true});
process.env.POME_HOOK_TEST_HOME=path.join(profile,'hook-home');fs.mkdirSync(process.env.POME_HOOK_TEST_HOME,{recursive:true});
process.env.POME_TEST_LANGUAGE='zh-CN';process.env.POME_TEST_NOTIFICATIONS='1';
app.commandLine.appendSwitch('user-data-dir',profile);app.disableHardwareAcceleration();
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
const fixtures=[{id:'a',text:'git status -sb',comment:'原备注',createdAt:1},{id:'b',text:'npm test',comment:'回归测试',createdAt:2},{id:'c',text:'pwd',createdAt:3}];
const corrupt={commands:['notch-home-commands',{unexpected:'commands'}],recordings:['notch-recordings',{unexpected:'recordings'}],windows:['notch-hidden-windows',{unexpected:'windows'}],links:['notch-link-groups',[null,{id:'invalid',name:'异常分组',links:{}},{id:'valid',name:'正常分组',links:[null,{id:'link',url:'https://example.com',title:'示例'}]}]]};
const storage={'notch-home-commands':JSON.stringify(fixtures)};
if(corrupt[phase])storage[corrupt[phase][0]]=JSON.stringify(corrupt[phase][1]);
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:storage}));
fs.writeFileSync(path.join(profile,'.ui-welcome-done'),'1');
const writes=[],errors=[],handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,channel==='clipboard:write'?(_e,v)=>{writes.push(v);return true}:channel==='windows:list'?()=>({items:[],error:null}):fn);
let started=false;const timer=setTimeout(()=>{console.error('Deep review timed out',errors);app.exit(1)},90000);
app.on('web-contents-created',(_e,c)=>{
 c.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('ERR_'))errors.push(e.message)});
 c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(timer);app.exit(0)}).catch(async e=>{console.error(e,errors);try{fs.writeFileSync(path.join(output,phase+'-failure.png'),(await c.capturePage()).toPNG())}catch{}app.exit(1)})});
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(c){
 const js=s=>c.executeJavaScript(s,true),win=BrowserWindow.fromWebContents(c),result={phase,baseline};
 async function until(s,limit=250){for(let i=0;i<limit;i++){if(await js(s))return true;await sleep(20)}return false}
 async function shot(name){await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG())}
 const ready=await until('!!window.NotchWorkspace&&!workspaceReloadPending',corrupt[phase]?100:250);
 result.ready=ready;
 if(corrupt[phase]){
   result.errors=errors;
   await sleep(400);
   result.fileRawPreserved=JSON.parse(fs.readFileSync(path.join(profile,'workspace.json'),'utf8')).localStorage[corrupt[phase][0]]===storage[corrupt[phase][0]];
   result.rawPreserved=await js(`localStorage.getItem(${JSON.stringify(corrupt[phase][0])})===${JSON.stringify(storage[corrupt[phase][0]])}`);
   if(ready){win.removeAllListeners('blur');win.show();win.focus();
     c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
     await js("setMode(true)");assert(await until('isExpanded&&!modeBusy'));
     await js("document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false)");await js("setActiveTab('settings')");await until("activeTab==='settings'&&!tabBusy");await js("NotchSettings.select('common')");if(phase==='links'){await js("setActiveTab('links')");await until("activeTab==='links'&&!tabBusy");result.goodLinkKept=await js("getLinkGroupsForSync().some(g=>g.links.some(l=>l.id==='link'))");}}
   if(ready){assert(await until("app.classList.contains('expanded')&&Number(getComputedStyle(panel,'::before').opacity)>.99"));result.visible=true;}
   await shot(phase+(baseline?'-before':'-after'));
   fs.writeFileSync(path.join(output,phase+(baseline?'-before':'-after')+'.json'),JSON.stringify(result,null,2));
   if(!baseline){assert.equal(ready,true,'bad collection must not disable the workspace');assert.equal(result.rawPreserved,true,'startup never overwrites malformed original bytes');assert.equal(result.fileRawPreserved,true,'disk mirror retains the original collection');if(phase==='links')assert.equal(result.goodLinkKept,true,'valid link survives malformed neighbors');assert.deepEqual(errors,[]);}
   console.log('Deep review storage',JSON.stringify(result));return;
 }
 assert(ready);win.removeAllListeners('blur');win.show();win.focus();
 c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await js("setMode(true)");assert(await until('isExpanded&&!modeBusy'));
 await js("setActiveTab('home')");assert(await until("activeTab==='home'&&!tabBusy"));
 await js(`document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='commands');homeSizes.commands='large';homeWorkingLayout=null;applyHomeLayout(resolveValidatedHomeLayout(hiddenHomeModules),{reason:'initial'});`);
 async function click(selector){
   const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,hit:h===e||e.contains(h)}})()`);assert(p.hit,'real hit '+selector);
   for(const type of ['mouseMoved','mousePressed','mouseReleased'])await c.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});await sleep(60);
 }
 const row=id=>`.command-item[data-id="${id}"]`;
 const saved=()=>js('getCommandsForSync()');
 const project=items=>js(`document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{commands:${JSON.stringify(items)}}}))`);
 await click(row('a')+' .command-comment');
 await js("{const i=document.querySelector('.command-edit');i.value='备注失焦保存';i.dispatchEvent(new Event('input',{bubbles:true}))}");
 await click(row('a')+' [data-action="copy-command"]');
 result.copyAfterBlur=writes.length===1&&writes[0].text===fixtures[0].text;
 result.noteSaved=(await saved())[0].comment==='备注失焦保存';
 await shot(baseline?'copy-blur-before':'copy-blur-after');
 await click(row('a')+' .command-comment');
 await js("document.querySelector('.command-edit').value='切换编辑行'");
 await click(row('b')+' .command-comment');
 result.nextEditor=await js(`!!document.querySelector('${row('b')} .command-edit')`);
 await shot(baseline?'cross-row-before':'cross-row-after');
 await js("document.querySelector('.command-edit')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
 await shot(baseline?'interaction-before':'interaction-after');
 await click(row('c')+' .command-text');
 await js("document.querySelector('.command-edit').value='pwd -P'");
 await click(row('c')+' [data-action="delete-command"]');
 result.deleteAfterTextBlur=await js("document.getElementById('content-delete-confirm').open");
 result.latestDeletePreview=result.deleteAfterTextBlur&&await js("document.querySelector('.content-delete-preview').textContent.includes('pwd -P')");
 if(result.deleteAfterTextBlur){await shot('delete-after-text-blur');await js("document.getElementById('content-delete-cancel').click()");}

 // An authoritative projection can replace a record while its delete preview is open.
 await project(fixtures);await click(row('a')+' [data-action="delete-command"]');assert(await until("document.getElementById('content-delete-confirm').open"));
 const newer=fixtures.map(x=>x.id==='a'?{...x,text:'git diff --stat',comment:'同步到的新内容'}:x);
 await project(newer);await js("document.getElementById('content-delete-apply').click()");await sleep(80);
 result.singlePreserved=(await saved()).some(x=>x.id==='a'&&x.text==='git diff --stat');
 await project(fixtures);await click(row('a')+' [data-action="delete-command"]');assert(await until("document.getElementById('content-delete-confirm').open"));
 await project(fixtures.map(x=>x.id==='a'?{...x,comment:'只有备注被同步更新'}:x));
 await js("document.getElementById('content-delete-apply').click()");await sleep(80);
 result.noteOnlyUpdatePreserved=(await saved()).some(x=>x.id==='a'&&x.comment==='只有备注被同步更新');

 await project(fixtures);
 await js(`{document.querySelector('${row('a')}').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));document.querySelector('${row('b')}').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));}`);
 await click('#command-bulk-delete');assert(await until("document.getElementById('content-delete-confirm').open"));
 await project(newer);await js("document.getElementById('content-delete-apply').click()");await sleep(80);
 result.bulkPreserved=(await saved()).some(x=>x.id==='a'&&x.text==='git diff --stat');
 result.bulkUnchangedDeleted=!(await saved()).some(x=>x.id==='b');
 result.unselectedPreserved=(await saved()).some(x=>x.id==='c');
 await shot(baseline?'delete-race-before':'delete-race-after');
 fs.writeFileSync(path.join(output,phase+(baseline?'-before':'-after')+'.json'),JSON.stringify(result,null,2));
 console.log('Deep review interactions',JSON.stringify(result));
 if(!baseline){for(const key of ['copyAfterBlur','noteSaved','nextEditor','deleteAfterTextBlur','latestDeletePreview','singlePreserved','noteOnlyUpdatePreserved','bulkPreserved','bulkUnchangedDeleted','unselectedPreserved'])assert.equal(result[key],true,key);assert.deepEqual(errors,[]);}
}
require('../main');
