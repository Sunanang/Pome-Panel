'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {app,BrowserWindow}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA,home=path.join(profile,'hook-home');
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS='1';
fs.mkdirSync(path.join(home,'.copilot'),{recursive:true});fs.mkdirSync(path.join(home,'.gemini/antigravity'),{recursive:true});
require('../cursor-usage').readAuthToken=()=>({ok:false});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false});
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false});
const adapters=require('../platform-adapters'),loadAdapter=adapters.loadAdapter;
const {createTaskApps,windowsAppPaths}=require('../platform-adapters/task-apps');
const launched=[],fakeEnv={LOCALAPPDATA:'C:\\fixture',SystemRoot:'C:\\Windows'};
const terminalPlist='/System/Applications/Utilities/Terminal.app/Contents/Info.plist';
const appPlist='/Applications/Antigravity.app/Contents/Info.plist';
const idePlist='/Applications/Antigravity IDE.app/Contents/Info.plist';
const files=new Set([terminalPlist,appPlist,idePlist,...windowsAppPaths('copilot',fakeEnv),...windowsAppPaths('antigravity',fakeEnv),...windowsAppPaths('antigravity',fakeEnv,'Antigravity IDE')]);
adapters.loadAdapter=(...args)=>{
  const adapter=loadAdapter(...args);adapter.windows.resolveTaskApp=async()=>null;
  adapter.taskApps=createTaskApps(process.platform,{env:fakeEnv,disk:{
    realpathSync:fs.realpathSync,statSync:file=>files.has(file)?{isFile:()=>true}:fs.statSync(file),
  },runFile:async(file,argv)=>{
    if(file.endsWith('PlistBuddy'))return argv.at(-1).includes('Antigravity IDE')?'fixture.antigravity-ide':argv.at(-1).includes('Antigravity')?'fixture.antigravity':'fixture.terminal';
    if(file.endsWith('osascript'))return '[]';
    launched.push({file,argv});return '';
  },startFile:async(file,argv)=>launched.push({file,argv})});return adapter;
};
const output=path.join(__dirname,'../dist.noindex/additional-completion');fs.mkdirSync(output,{recursive:true});
const C=require('./fixtures/copilot-stop.json'),A=require('./fixtures/antigravity-stop.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let port,started=false;
app.on('pome-test-notification-port',value=>{port=value;});
const watchdog=setTimeout(()=>{console.error('Additional provider completion timed out');app.exit(1);},60000);
app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{
  if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
  run(c).then(()=>{clearTimeout(watchdog);console.log('Copilot CLI / Antigravity: config UI, real hook scripts, repeated turns, failures, exclusions, branding and source opening passed',output);app.exit(0);})
    .catch(error=>{console.error(error);app.exit(1);});
}));
async function until(check,label){for(let i=0;i<300;i++){if(await check())return;await delay(20);}throw new Error('Timed out: '+label);}
const win=()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith('/renderer/notification.html'));
async function run(contents){
  const js=code=>contents.executeJavaScript(code);
  let expectedEvent;
  await until(()=>js('window.NotchAiSources?.getState().ready===true'),'source list');
  await js('setMode(true);setActiveTab("settings")');
  for(const source of ['copilot','antigravity']){
    await js(`NotchAiSources.request('${source}','connect')`);
    await until(()=>js('document.getElementById("ai-source-confirm").open'),'confirmation');
    await js('document.getElementById("ai-source-confirm-apply").click()');
    await until(()=>js(`NotchAiSources.getState().sources.find(row=>row.source==='${source}').state==='connected'`),'connected '+source);
    assert.equal((await js(`NotchAiSources.test('${source}')`)).ok,true);
    const note=await js(`document.querySelector('.ai-source-row[data-source="${source}"] .ai-source-capability').textContent`);
    assert(note.includes(source==='copilot'?'Copilot CLI':'Antigravity'));
  }
  assert.equal((await js('notchAPI.getTaskInbox()')).total,0,'marked tests create no history');
  fs.writeFileSync(path.join(output,'settings-connected.png'),(await contents.capturePage()).toPNG());
  await js('setActiveTab("home")');await until(async()=>Boolean(port),'receiver port');
  const config=source=>JSON.parse(fs.readFileSync(source==='copilot'?path.join(home,'.copilot/hooks/pome-panel.json'):path.join(home,'.gemini/config/hooks.json')));
  async function trigger(source,payload,event='agentStop'){
    const data=config(source),entry=source==='copilot'?data.hooks[event][0]:data['pome-panel'].Stop[0];
    await new Promise((resolve,reject)=>{
      const env={...process.env,...entry.env,POME_NOTIFY_PORT:String(port)};
      const child=source==='copilot'?spawn(entry.exec,entry.args,{env,stdio:['pipe','ignore','ignore']})
        :spawn(entry.command,{shell:true,env,stdio:['pipe','ignore','ignore']});
      child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('hook failed')));child.stdin.end(JSON.stringify(payload));
    });
    const adapted=source==='copilot'?require('../scripts/copilot-notify').copilotCompletion(payload,{event}):require('../scripts/antigravity-notify').antigravityCompletion(payload);
    expectedEvent=adapted?require('../taskInbox').completionEventId(adapted):null;
  }
  async function shown(title,source,status,name,open=false){
    await until(async()=>win()?.isVisible()&&await win().webContents.executeJavaScript(`!root.hidden && !isHiding && root.classList.contains('is-visible') && currentNotification.eventId.startsWith(${JSON.stringify(expectedEvent+':')}) && titleElement.textContent===${JSON.stringify(title)}`),title);
    const w=win();await delay(450);
    const state=await w.webContents.executeJavaScript('({source:currentNotification.sourceKey,status:currentNotification.status,brand:getComputedStyle(document.getElementById("notification-brand")).maskImage})');
    assert.equal(state.source,source);assert.equal(state.status,status);assert(state.brand.includes(`/inbox/${source}.svg`));
    await until(()=>js(`document.querySelector('.home-inbox-source-wrap[data-source="${source}"] img')?.naturalWidth>0`),'inbox branding');
    const capture=await w.webContents.capturePage(),pixels=capture.toBitmap();let bright=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&pixels[i]+pixels[i+1]+pixels[i+2]>450)bright++;
    assert(bright>100,'screenshot must contain rendered content, not an empty transition');
    fs.writeFileSync(path.join(output,name+'.png'),capture.toPNG());
    const count=launched.length;await w.webContents.executeJavaScript(`document.getElementById('${open?'notification-open':'notification-close'}').click()`);await delay(550);
    assert.equal(launched.length,count+(open&&process.platform==='darwin'?1:0));
  }
  const transcript=path.join(profile,'copilot-events.jsonl');
  const payload={...C,cwd:profile,transcriptPath:transcript,timestamp:Date.now()};
  for(const i of [1,2]){
    fs.writeFileSync(transcript,JSON.stringify({type:'assistant.message',id:`answer-${i}`,data:{content:`Copilot 第 ${i} 轮结果`,toolRequests:[]}})+'\n');
    await trigger('copilot',payload);await shown(`Copilot 第 ${i} 轮结果`,'copilot','completed',`copilot-${i}`,true);
    await trigger('copilot',payload); // Same transcript result is a retry.
  }
  const error={...payload,timestamp:Date.now(),recoverable:false,errorContext:'model_call',error:{message:'Copilot 模型调用失败'}};
  await trigger('copilot',error,'errorOccurred');await shown(error.error.message,'copilot','failed','copilot-failed');
  const anti={...A,workspacePaths:[profile]};
  await trigger('antigravity',anti);await shown('Antigravity 已完成任务','antigravity','completed','antigravity-completed',true);
  await trigger('antigravity',anti);
  const failed={...anti,executionNum:2,terminationReason:'error',error:'Antigravity 任务执行失败'};
  await trigger('antigravity',failed);await shown(failed.error,'antigravity','failed','antigravity-failed');
  const cli={...anti,executionNum:3,transcriptPath:profile.replace(/\\/g,'/')+'/antigravity-cli/brain/conversation/transcript.jsonl'};
  await trigger('antigravity',cli);await shown('Antigravity 已完成任务','antigravity','completed','antigravity-cli',true);
  if(process.platform==='darwin')assert.equal(launched.at(-1).argv[1],'fixture.terminal');
  const ide={...anti,executionNum:4,transcriptPath:profile.replace(/\\/g,'/')+'/antigravity-ide/brain/conversation/transcript.jsonl'};
  await trigger('antigravity',ide);await shown('Antigravity 已完成任务','antigravity','completed','antigravity-ide',true);
  if(process.platform==='darwin')assert.equal(launched.at(-1).argv[1],'fixture.antigravity-ide');
  const before=(await js('notchAPI.getTaskInbox({limit:100})')).total;assert.equal(before,7);
  fs.writeFileSync(transcript,JSON.stringify({type:'assistant.message',id:'child-only',data:{content:'Child result must stay hidden'}})+'\n');
  await trigger('copilot',{...payload,agentId:'child'});await trigger('copilot',{...payload,hook_event_name:'SessionEnd'});
  await trigger('copilot',{...error,recoverable:true},'errorOccurred');
  await trigger('antigravity',{...anti,executionNum:44,fullyIdle:false});await trigger('antigravity',{...anti,executionNum:45,parentConversationId:'parent'});
  assert.equal((await js('notchAPI.getTaskInbox()')).total,before);
  await js(`PomeI18n.setState({preference:'en-US',effectiveLocale:'en-US'});window.dispatchEvent(new Event('pome:language-changed'));setActiveTab('settings')`);
  await until(()=>js('document.querySelector(".ai-source-row[data-source=copilot] .ai-source-capability").textContent.includes("currently support Copilot CLI")'),'localized scope');
  for(const source of ['copilot','antigravity']){
    const result=await js(`(async()=>{const p=await notchAPI.previewAiSource('${source}','disconnect');return notchAPI.applyAiSource(p.preview.token)})()`);assert.equal(result.ok,true);
  }
}
require('../main');
