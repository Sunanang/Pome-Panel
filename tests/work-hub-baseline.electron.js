'use strict';
const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const output=process.env.POME_BASELINE_OUTPUT,profile=process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir',profile);if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken=()=>({ok:false,error:'fixture_missing'});require('../cursor-usage').fetchCursorUsage=async()=>({ok:false,error:'fixture_offline'});require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:false});require('../codex-auth').readLocalCodexToken=async()=>({ok:false,error:'fixture_missing'});
const {createPersistentStore}=require('../fnos/app/server/persistentStore');const store=createPersistentStore({filePath:path.join(profile,'nas-state.bin'),serverId:'baseline-server'});
const nas=require('../fnos/app/server/createApp').createApp({listenMode:'device-port',store});const listening=new Promise(r=>nas.server.listen(0,'127.0.0.1',r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const samples=[],geometry=[],diagnostics=[];let coldStart=process.hrtime.bigint();
function command(executable,args){try{return execFileSync(executable,args,{encoding:'utf8'}).trim();}catch{return 'unknown';}}
function save(name,data){fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');}
async function until(c,expression,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await c.executeJavaScript(expression))return;}catch{}await sleep(10);}throw new Error(`timeout: ${expression}`);}
let started=false;
app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).catch(error=>{diagnostics.push(error.stack);writeSummary();app.exit(1);});}));
async function run(c){
 await until(c,`!!window.NotchWorkspace && document.getElementById('home-note').value==='# 基线首页'`);
 const environment={schemaVersion:1,documentVersion:'1.0',command:'npm run check:work-hub',runAt:new Date().toISOString(),machineModel:process.platform==='darwin'?command('sysctl',['-n','hw.model']):'unknown (未提供系统型号命令)',cpu:os.cpus()[0]?.model,memoryBytes:os.totalmem(),os:{platform:process.platform,release:os.release(),version:os.version(),arch:process.arch},appVersion:require('../package.json').version,electronVersion:process.versions.electron,commit:command('git',['rev-parse','HEAD']),dirty:command('git',['status','--porcelain'])!=='',display:screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor,refreshRate:d.displayFrequency||'unknown'})),reducedMotion:await c.executeJavaScript(`matchMedia('(prefers-reduced-motion: reduce)').matches`),fixture:JSON.parse(process.env.POME_BASELINE_FIXTURE),coldStartupMs:Number(process.hrtime.bigint()-coldStart)/1e6,definition:'Main monotonic begin-open → visible default page (opacity ≥0.9), navigation hit test + verified input → main IPC acknowledgement',sourceHash:crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync(path.join(__dirname,'../scripts/check-work-hub-baseline.js'))).digest('hex'),sourceFiles:Object.fromEntries(['main.js','preload.js','renderer/app.js','renderer/styles.css','renderer/task-inbox.js','renderer/ai-sources.js','aiSourceHooks.js','scripts/codex-notify.js','scripts/claude-notify.js','scripts/cursor-notify.js','renderer/domain.js','renderer/workspace.js','workspace-sync.js','platform.js','taskInbox.js','workspaceBackup.js','syncRecovery.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')])),unverified:['Windows 真机','切换实体显示器与 DPI']};save('environment.json',environment);
 const win=BrowserWindow.fromWebContents(c);const original=win.getBounds();
 async function sample(group,index){let ms=null,error=null;const before=win.getBounds();
  try{
   await c.executeJavaScript(`document.getElementById('notch').click()`);
   await until(c,`document.getElementById('app').classList.contains('expanded') && !modeBusy && !document.getElementById('panel').inert`);
   await until(c, `(()=>{const tab=document.getElementById('tab-button-notes'),rect=tab.getBoundingClientRect();return Number(getComputedStyle(document.querySelector('.topbar')).opacity)>=0.9 && Number(getComputedStyle(document.querySelector('.panels')).opacity)>=0.9 && !!document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('#tab-button-notes');})()`);
   const id=require('../panelTiming').current();
   ms=await c.executeJavaScript(`(async()=>{if(activeTab!=='home')throw new Error('wrong default page'); document.getElementById('tab-button-notes').click();await new Promise(r=>requestAnimationFrame(r));if(activeTab!=='notes')throw new Error('navigation failed');const input=document.getElementById('notes-search');const rect=input.getBoundingClientRect();if(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)!==input)throw new Error('input not hittable');input.focus();input.value='基线笔记';input.dispatchEvent(new Event('input',{bubbles:true}));if(document.activeElement!==input||!document.querySelector('[data-note-id]'))throw new Error('input failed');return window.notchAPI.finishOpenTiming(${JSON.stringify(id)});})()`);
  }catch(e){error=e.message;}
  await c.executeJavaScript('setMode(false)');await until(c,`document.getElementById('app').classList.contains('collapsed') && !modeBusy`);
  const after=win.getBounds();const stable=JSON.stringify(after)===JSON.stringify(original);geometry.push({group,index,before,after,stable});
  if(group!=='warmup')samples.push({group,index,ms,success:!error&&stable,error,thresholdMs:300});
 }
 for(let i=0;i<5;i++)await sample('warmup',i);
 for(let i=0;i<20;i++)await sample('normal',i);
 await listening;
 const baseUrl=`http://127.0.0.1:${nas.server.address().port}`;const code=store.startPairing({uid:'baseline'}).code;
 const pair=await c.executeJavaScript(`window.notchAPI.syncPairClaim({baseUrl:${JSON.stringify(baseUrl)},pairingCode:${JSON.stringify(code)},deviceName:'隔离性能夹具'})`);if(!pair.ok)throw new Error(JSON.stringify(pair));
 const migration=await c.executeJavaScript(`window.notchAPI.syncRunMigration({localTodosJson:localStorage.getItem('notch-todo-data'),workspace:getWorkspaceSnapshotForSync()})`);if(!migration.ok)throw new Error(JSON.stringify(migration));
 nas.server.removeAllListeners('request');nas.server.on('request',(req,res)=>setTimeout(()=>Promise.resolve(nas.handle(req,res)).catch(error=>{res.writeHead(500);res.end(JSON.stringify({error:error.message}));}),20));
 environment.syncLoad={isolatedPersistentNas:true,artificialResponseDelayMs:20,reason:'确保同步请求覆盖唤出测量时段'};save('environment.json',environment);
 for(let i=0;i<20;i++){
  // The production sync transport runs against an isolated persistent NAS server.
  const syncing=c.executeJavaScript('window.notchAPI.syncRetry()').catch(e=>({error:e.message}));
  await sample('background-sync',i);const syncResult=await syncing;if(!syncResult.ok)diagnostics.push(`同步负载失败：${JSON.stringify(syncResult)}`);
 }
 save('geometry.json',geometry);save('nas-result.json',{serverRev:store.bucket('baseline').serverRev,counts:store.syncState('baseline'),checkpointBytes:fs.statSync(path.join(profile,'nas-state.bin')).size,journalBytes:fs.readdirSync(path.join(profile,'nas-state.bin.transactions')).filter(name=>name.endsWith('.bin')).reduce((sum,name)=>sum+fs.statSync(path.join(profile,'nas-state.bin.transactions',name)).size,0)});
 writeSummary();nas.server.close();app.exit(require('../scripts/work-hub-statistics').summarize(samples).passed&&!diagnostics.length?0:1);
}
function writeSummary(){const {groups}=require('../scripts/work-hub-statistics').summarize(samples);save('samples.json',{schemaVersion:1,documentVersion:'1.0',definition:'Main monotonic trigger → visible page opacity ≥0.9 and navigation hit test → verified input and IPC acknowledgement',samples,groups,diagnostics,unverified:['Windows 真机','实体屏幕切换与 DPI']});fs.writeFileSync(path.join(output,'summary.md'),`# Pome 工作中枢回归基线\n\n${Object.entries(groups).map(([name,row])=>`- ${name}: ${row.samples} 次，P95 ${row.p95??'未知'} ms，${row.passed?'通过':'未通过'}。`).join('\n')}\n\n原始样本见 samples.json；环境见 environment.json；几何记录见 geometry.json。\n\n${diagnostics.join('\n')}\n\nWindows 真机、实体屏幕切换及 DPI 未验证。\n`);}
require('../main.js');
