'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA,home=path.join(profile,'isolated-home');fs.mkdirSync(home);
process.env.POME_HOOK_TEST_HOME=home;process.env.POME_TEST_NOTIFICATIONS='1';
app.commandLine.appendSwitch('user-data-dir',profile);if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken=()=>({ok:false});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false});
const {readConfig,editNotify}=require('../aiSourceHooks');
const artifacts=path.join(__dirname,'../dist.noindex/ai-sources');fs.mkdirSync(artifacts,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false,port;const errors=[];
app.on('pome-test-notification-port',value=>{port=value;});
const watchdog=setTimeout(()=>{console.error('AI source fixture timed out',errors);app.exit(1);},90000);
app.on('web-contents-created',(_event,c)=>{c.on('console-message',details=>{if(details.level==='error'&&!details.message.includes('ERR_'))errors.push(details.message);});c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);console.log('AI sources: isolated connect/disconnect/repair/test, 3 empty states, first detection, legacy GPT and N1–N4 passed');app.exit(0);}).catch(e=>{console.error(e,errors);app.exit(1);});});});
async function run(c){
 const js=code=>c.executeJavaScript(code);
 async function until(expr){for(let i=0;i<300;i++){try{if(await js(expr))return;}catch{}await sleep(30);}throw new Error('Timeout: '+expr);}
 async function capture(name){await sleep(500);fs.writeFileSync(path.join(artifacts,name+'.png'),(await c.capturePage()).toPNG());}
 await until(`!!window.NotchTaskInbox && window.NotchAiSources?.getState().ready && document.getElementById('home-inbox').dataset.sourceState==='none'`);await js('setMode(true)');
 assert.equal(await js(`document.getElementById('home-inbox-read-all').hidden`),true,'N3: empty hides read-all');await capture('empty-none');
 const tabReady=await js(`(async()=>{const original=ipcSetTab;let release;ipcSetTab=()=>new Promise(resolve=>{release=resolve});try{const switching=setActiveTab('notes');await new Promise(resolve=>requestAnimationFrame(resolve));const input=document.getElementById('notes-search'),r=input.getBoundingClientRect();const ready=document.querySelector('.tab-panel.active').id==='tab-notes' && !input.closest('.tab-panel').inert && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===input;release();await switching;return ready;}finally{ipcSetTab=original;await setActiveTab('home');}})()`);assert.equal(tabReady,true,'first input must work before a slow native tab IPC replies');

 const initial=await js(`({sizes:{...homeSizes},hidden:[...hiddenHomeModules],layout:JSON.parse(JSON.stringify(homeWorkingLayout))})`);
 for(const size of ['mini','small']){
  await js(`homeSizes={...homeSizes,inbox:'${size}'};hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!['music','inbox'].includes(id));homeWorkingLayout=NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules);applyHomeLayout(homeWorkingLayout,{reason:'initial'})`);
  await until(`document.getElementById('home-inbox').dataset.widgetSize==='${size}'`);assert.equal(await js(`(()=>{const t=document.getElementById('home-inbox');return t.scrollWidth<=t.clientWidth+1 && t.scrollHeight<=t.clientHeight+1})()`),true);await capture('empty-'+size);
 }
 await js(`homeSizes=${JSON.stringify(initial.sizes)};hiddenHomeModules=${JSON.stringify(initial.hidden)};homeWorkingLayout=${JSON.stringify(initial.layout)};applyHomeLayout(homeWorkingLayout,{reason:'initial'})`);
 for(const dir of ['.codex','.claude','.cursor'])fs.mkdirSync(path.join(home,dir));
 const config=path.join(home,'.codex/config.toml'),original='# User configuration\nnotify = ["echo", "original-notify"]\n[model]\nname="untouched"\n';fs.writeFileSync(config,original);
 fs.writeFileSync(path.join(home,'.claude/settings.json'),JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'echo original'}]}]},permissions:{allow:['Read']}},null,4));
 await js('NotchAiSources.refresh()');await until(`document.getElementById('home-inbox').dataset.sourceState==='suggestion'`);await capture('first-detection');
 await js(`document.querySelector('.home-inbox-empty-actions button:last-child').click()`);await js(`NotchAiSources.dismiss('claude');NotchAiSources.dismiss('cursor');location.reload()`);
 await until(`window.NotchAiSources?.getState().ready && document.getElementById('home-inbox').dataset.sourceState==='none'`);assert.equal(await js(`NotchAiSources.getState().suggestion`),undefined,'dismiss persists across reload');await js('setMode(true)');
 await js(`setActiveTab('settings')`);await until(`document.querySelectorAll('.ai-source-row').length===3`);
 assert.equal(await js(`document.querySelectorAll('.ai-source-restart-hint').length`),0,'detection alone must not ask to restart');
 assert.equal(await js(`getComputedStyle(document.querySelector('.settings-column-primary')).overflowY`),'auto');
 await js(`document.querySelector('.ai-source-row[data-source="codex"] button').click()`);await until(`document.getElementById('ai-source-confirm').open`);
 assert.equal(fs.readFileSync(config,'utf8'),original,'confirmation preview must not write');
 const bounds=await js(`(()=>{const d=document.getElementById('ai-source-confirm').getBoundingClientRect(),b=document.querySelector('.ai-source-row[data-source="codex"] button').getBoundingClientRect();return {top:d.top,bottom:d.bottom,left:d.left,right:d.right,h:innerHeight,w:innerWidth,buttonTop:b.top}})()`);assert(bounds.top>=0&&bounds.bottom<=bounds.h&&bounds.left>=0&&bounds.right<=bounds.w);assert(bounds.top<bounds.buttonTop,'confirmation floats above button');await capture('settings-confirm');
 await js(`document.getElementById('ai-source-confirm-cancel').click()`);assert.equal(fs.readFileSync(config,'utf8'),original);
 assert.equal(await js(`document.querySelectorAll('.ai-source-restart-hint').length`),0,'cancelled preview must not ask to restart');
 async function assertRestartSources(expected){
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('.ai-source-restart-hint'),hint=>({source:hint.closest('.ai-source-row').dataset.source,text:hint.textContent}))`),expected.map(source=>({source,text:source==='claude'?'已写入配置，请退出 Claude Code 并重新启动后生效':`已写入配置，请完全退出并重新打开 ${{codex:'Codex',claude:'Claude Code',cursor:'Cursor'}[source]} 后生效`})));
 }
 // Simulate a failed apply using only the isolated fixture configuration.
 await js(`NotchAiSources.request('cursor')`);await until(`document.getElementById('ai-source-confirm').open`);
 fs.writeFileSync(path.join(home,'.cursor/hooks.json'),'{}');
 await js(`document.getElementById('ai-source-confirm-apply').click()`);await until(`!document.getElementById('ai-source-confirm').open && document.getElementById('ai-sources-status').textContent.includes('配置文件已变化')`);
 await assertRestartSources([]);assert.equal(await js(`document.getElementById('ai-sources-status').textContent.includes('重新打开')`),false,'failed source must not ask to restart');
 async function apply(source,action='connect'){
  await js(`NotchAiSources.request('${source}','${action}',document.querySelector('.ai-source-row[data-source="${source}"] button'))`);await until(`document.getElementById('ai-source-confirm').open`);await js(`document.getElementById('ai-source-confirm-apply').click()`);await until(`!document.getElementById('ai-source-confirm').open && NotchAiSources.getState().sources.find(s=>s.source==='${source}').state==='${action==='disconnect'?'disconnected':'connected'}'`);
 }
 await apply('codex');assert(fs.readdirSync(path.dirname(config)).some(n=>n.includes('.pome-backup-')));
 await assertRestartSources(['codex']);assert(await js(`document.getElementById('ai-sources-status').textContent.includes('完全退出并重新打开 Codex')`));
 const beforeTest=await js('window.notchAPI.getTaskInbox()');const test=await js(`NotchAiSources.test('codex')`);assert.equal(test.ok,true,JSON.stringify(test));assert.equal(test.message,'测试通知已送达');assert.equal((await js('window.notchAPI.getTaskInbox()')).total,beforeTest.total,'tests do not enter history or unread');await capture('settings-test-delivered');
 await assertRestartSources(['codex']);
 // An already matching config is skipped: successful detection is not a new write.
 await js(`(async()=>{const preview=await notchAPI.previewAiSource('claude','connect');return notchAPI.applyAiSource(preview.preview.token);})()`);await js('NotchAiSources.refresh()');
 await apply('claude');assert.equal(await js(`document.getElementById('ai-sources-status').textContent`),'配置无需修改');await assertRestartSources(['codex']);await apply('claude','disconnect');
 await js(`setActiveTab('home')`);await until(`document.getElementById('home-inbox').dataset.sourceState==='waiting'`);await capture('empty-waiting');
 const parsed=readConfig(config,'codex');const stale=[...parsed.value.notify];stale[2]='/missing/Pome Panel';fs.writeFileSync(config,editNotify(parsed,stale));await js('NotchAiSources.refresh()');await until(`document.getElementById('home-inbox').dataset.sourceState==='error'`);assert(await js(`getComputedStyle(document.getElementById('home-inbox')).backgroundImage.includes('radial-gradient')`));await capture('empty-source-error');
 await js(`document.querySelector('.home-inbox-empty-actions button').click()`);await until(`document.getElementById('ai-source-confirm').open && document.getElementById('ai-source-confirm-title').textContent.includes('修复')`);await capture('home-repair-confirm');await js(`document.getElementById('ai-source-confirm-cancel').click()`);

 await js(`setActiveTab('settings')`);await apply('codex','repair');
 await assertRestartSources(['codex']);
 fs.writeFileSync(path.join(home,'.cursor/hooks.json'),JSON.stringify({version:1,hooks:{stop:[{command:"ELECTRON_RUN_AS_NODE=1 '/missing/node' '/missing/cursor-notify.js' '--pome-panel-hook=cursor'"}]}}));
 await js('NotchAiSources.refresh()');await capture('settings-mixed-states');
 await apply('claude');await apply('cursor','repair');
 await assertRestartSources(['codex','claude','cursor']);assert(await js(`document.getElementById('ai-sources-status').textContent.includes('完全退出并重新打开 Cursor')`));
 for(const source of ['claude','cursor'])assert.equal((await js(`NotchAiSources.test('${source}')`)).ok,true);
 await capture('settings-all-connected');
 const cursorFile=path.join(home,'.cursor/hooks.json'),legacyCursor=JSON.parse(fs.readFileSync(cursorFile));
 delete legacyCursor.hooks.afterAgentResponse;fs.writeFileSync(cursorFile,JSON.stringify(legacyCursor));
 await js('NotchAiSources.refresh()');
 await until(`Array.from(document.querySelectorAll('.ai-source-row[data-source="cursor"] button')).some(button=>button.textContent==='补全摘要')`);
 assert.equal(await js(`NotchAiSources.getState().sources.find(row=>row.source==='cursor').state`),'connected','legacy stop-only stays connected');
 await js(`Array.from(document.querySelectorAll('.ai-source-row[data-source="cursor"] button')).find(button=>button.textContent==='补全摘要').click()`);
 await until(`document.getElementById('ai-source-confirm').open`);
 await js(`document.getElementById('ai-source-confirm-apply').click()`);
 await until(`!document.getElementById('ai-source-confirm').open && !NotchAiSources.getState().sources.find(row=>row.source==='cursor').summaryHookMissing`);
 assert.equal(JSON.parse(fs.readFileSync(cursorFile)).hooks.afterAgentResponse.length,1);

 await apply('codex','disconnect');await assertRestartSources(['claude','cursor']);assert.equal(await js(`document.getElementById('ai-sources-status').textContent.includes('Codex')`),false);assert.deepEqual(readConfig(config,'codex').value.notify,['echo','original-notify']);await apply('codex');
 await js(`setActiveTab('home')`);const beforeToggle=await js(`({sizes:{...homeSizes},placements:JSON.parse(JSON.stringify(homeWorkingLayout.placements))})`);
 assert.equal((await js(`NotchHome.setModuleVisible('inbox',false)`)).ok,true);
 assert.equal(await js(`document.getElementById('home-inbox-placeholder').hidden`),false,'N1: vacated slot has add-module placeholder');
 const slot=await js(`(()=>{const a=document.getElementById('home-inbox-placeholder').getBoundingClientRect();return {w:a.width,h:a.height}})()`);assert(slot.w>0&&slot.h>0);await capture('hidden-inbox-placeholder');
 await js(`document.getElementById('home-inbox-placeholder').click()`);await until(`document.querySelector('.tab.active').dataset.tab==='settings'`);assert.equal(await js(`document.activeElement.matches('[data-settings-home-module="inbox"]')`),true);
 assert.equal((await js(`NotchHome.setModuleVisible('inbox',true)`)).ok,true);assert.deepEqual(await js(`({sizes:{...homeSizes},placements:JSON.parse(JSON.stringify(homeWorkingLayout.placements))})`),beforeToggle);
 while(!port)await sleep(10);const send=(source,payload)=>fetch(`http://127.0.0.1:${port}/notify/${source}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 assert.equal((await send('gpt',{event_id:'reject-new-gpt'})).status,404);
 assert.equal((await send('codex',{title:'legacy without identity'})).status,202,'Bug A: missing identity is received');
 for(let i=0;i<12;i++)assert.equal((await send('cursor',{event_id:'cursor-'+i,title:'Cursor completed'})).status,202);
 const invalid=await fetch(`http://127.0.0.1:${port}/notify/cursor`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{invalid'});assert.equal(invalid.status,400);await until(`document.getElementById('task-inbox-status').textContent.includes('完成事件无法处理')`);assert.equal((await js('window.notchAPI.getTaskInbox()')).total,13);
 await js('NotchTaskInbox.refresh()');await until(`document.getElementById('home-inbox-badge').textContent==='9+'`);await js(`setActiveTab('notes')`);
 const normalBadge=await js(`(()=>{const r=document.getElementById('home-inbox-badge').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const inboxFile=path.join(profile,'task-inbox.json'),intact=fs.readFileSync(inboxFile);fs.writeFileSync(inboxFile,'corrupt fixture');assert.equal((await send('cursor',{event_id:'fail',title:'真实完成写入失败'})).status,503);await until(`document.getElementById('home-inbox-badge').textContent==='!'`);
 assert.deepEqual(await js(`(()=>{const r=document.getElementById('home-inbox-badge').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`),normalBadge,'N4: ! and 9+ have identical bounds');
 fs.writeFileSync(inboxFile,intact);await js('NotchTaskInbox.refresh()');await until(`document.getElementById('home-inbox').dataset.error!=='true'`);
 const saved=JSON.parse(fs.readFileSync(inboxFile));saved.records[0].source='gpt';fs.writeFileSync(inboxFile,JSON.stringify(saved));await js('NotchTaskInbox.refresh()');await js('NotchTaskInbox.refresh()');await until(`document.querySelector('.home-inbox-row')?.getAttribute('aria-label')?.startsWith('其他')`);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({threeSources:true,temporaryHome:home,emptyStates:true,firstDetection:true,confirmation:true,testNoHistory:true,preservedNotify:true,placeholder:true,badgeAligned:true,legacyOther:true,consoleErrors:errors},null,2));
}
require('../main.js');
