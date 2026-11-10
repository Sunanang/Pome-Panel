'use strict';
// Real macOS AX acceptance. Creates and closes only this test's own windows.
const {app,BrowserWindow,systemPreferences}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const childMode=process.env.POME_WINDOW_NATIVE_CHILD==='1';
const root=process.env.POME_WINDOW_NATIVE_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'pome-window-native-'));
fs.mkdirSync(root,{recursive:true});
app.commandLine.appendSwitch('user-data-dir',path.join(root,childMode?'child':'parent'));
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function write(name,value,dir=root){const file=path.join(dir,name);fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file)}
async function until(fn){for(let i=0;i<250;i++){try{const value=await fn();if(value)return value}catch{}await sleep(30)}throw Error('Native window fixture timeout')}
app.whenReady().then(async()=>{
 if(childMode){
  const windows=[];
  const terminalRole=process.env.POME_WINDOW_NATIVE_ROLE==='terminal';
  const titles=terminalRole?Array.from({length:5},(_,i)=>'Pome Terminal '+(i+1)):['Pome Browser a','Pome Browser b','Pome Same Title','Pome Same Title'];
  for(const [i,title] of titles.entries()){
   const w=new BrowserWindow({width:450,height:280,x:120+i*12,y:140+i*10,title,show:false});await w.loadURL('data:text/html,'+encodeURIComponent(`<title>${title}</title><body style="background:#1e2025;color:#f3eee7;font:20px system-ui;padding:24px"><h1>${title}</h1><p>Native window identity fixture ${i}</p></body>`));w.showInactive();windows.push(w);
  }
  if(terminalRole){const panel=new BrowserWindow({width:180,height:100,type:'panel',show:false});await panel.loadURL('data:text/html,<title>Pome utility panel</title>');panel.showInactive();panel.hide();windows.push(panel);}windows[terminalRole?0:1].focus();
  write('ready.json',{pid:process.pid,count:windows.length,visibleCount:windows.filter(w=>w.isVisible()).length,appHidden:app.isHidden()});let busy=false;
  setInterval(async()=>{
   write('state.json',{focused:windows.findIndex(w=>!w.isDestroyed()&&w.isFocused()),titles:windows.map(w=>w.isDestroyed()?null:w.getTitle())});
   const file=path.join(root,'command.json');if(busy||!fs.existsSync(file))return;busy=true;const command=JSON.parse(fs.readFileSync(file));fs.unlinkSync(file);
   try{const w=windows[command.index];if(command.action==='rename')w.setTitle(command.title);if(command.action==='close')w.destroy();if(command.action==='minimize'){w.minimize();await sleep(700);}if(command.action==='shot'){await sleep(100);fs.writeFileSync(command.file,(await w.webContents.capturePage()).toPNG())}write('done.json',{id:command.id});}finally{busy=false;}
  },30);return;
 }
 if(process.platform!=='darwin'||!systemPreferences.isTrustedAccessibilityClient(false)){console.log('Native AX window acceptance skipped: macOS with Accessibility permission required');app.exit(0);return}
 let child,terminalChild;const output=process.env.POME_WINDOWS_SHOTS||path.join(__dirname,'../dist.noindex/windows-native');fs.mkdirSync(output,{recursive:true});
 try{
  function start(role){return spawn(process.execPath,[__filename],{env:{...process.env,POME_WINDOW_NATIVE_CHILD:'1',POME_WINDOW_NATIVE_ROOT:path.join(root,role),POME_WINDOW_NATIVE_ROLE:role},stdio:'ignore'})}
  terminalChild=start('terminal');child=start('browser');
  const ready=await until(()=>JSON.parse(fs.readFileSync(path.join(root,'browser/ready.json'))));
  const terminalReady=await until(()=>JSON.parse(fs.readFileSync(path.join(root,'terminal/ready.json'))));
  const {createDarwinAdapter}=require('../platform-adapters/darwin');const adapter=createDarwinAdapter();
  let id=0;async function command(action,index,extra={},role='browser'){const dir=path.join(root,role);write('command.json',{id:++id,action,index,...extra},dir);await until(()=>JSON.parse(fs.readFileSync(path.join(dir,'done.json'))).id===id)}
  const rows=await until(async()=>{const result=await adapter.windows.list();const rows=result.items.filter(w=>w.pid===ready.pid||w.pid===terminalReady.pid);return rows.length>=9&&rows});
  assert.equal(rows.filter(w=>w.pid===terminalReady.pid).length,5,'five standard terminal fixtures, no extra backing surfaces');assert.equal(rows.filter(w=>w.title==='Pome utility panel').length,0,'hidden backing window excluded');assert.equal(rows.filter(w=>w.title==='Pome Same Title').length,2,'same-title real windows remain separate');
  const a=rows.find(w=>w.title==='Pome Browser a'),b=rows.find(w=>w.title==='Pome Browser b');
  for(const [item,index,name] of [[a,0,'05-native-browser-a'],[b,1,'06-native-browser-b'],[a,0,null]]){
   assert.equal(await adapter.windows.focus(item.id),true,'exact native focus '+item.title);await until(()=>JSON.parse(fs.readFileSync(path.join(root,'browser/state.json'))).focused===index);
   if(name)await command('shot',index,{file:path.join(output,name+'.png')});
  }
  await command('rename',0,{title:'Pome Browser a renamed'});const changed=(await adapter.windows.list()).items.find(w=>w.pid===ready.pid&&w.title==='Pome Browser a renamed');assert.equal(changed.id,a.id,'renaming and restacking preserve identity');
  assert.equal(await adapter.windows.focus(a.id),true);await until(()=>JSON.parse(fs.readFileSync(path.join(root,'browser/state.json'))).focused===0);
  const duplicates=(await adapter.windows.list()).items.filter(w=>w.pid===ready.pid&&w.title==='Pome Same Title');for(const row of duplicates)assert.equal(await adapter.windows.focus(row.id),true,'separate same-title window focus');
  await command('minimize',0,{},'terminal');const terminal=await until(async()=>(await adapter.windows.list()).items.find(w=>w.pid===terminalReady.pid&&w.title==='Pome Terminal 1'));assert(terminal.minimized);assert.equal(await adapter.windows.focus(terminal.id),true);await until(()=>JSON.parse(fs.readFileSync(path.join(root,'terminal/state.json'))).focused===0);
  await command('close',0);assert.equal(await adapter.windows.focus(a.id),false,'closed window never redirects to another');assert.equal(await adapter.windows.focus('forged'),false);
  write('result.json',{passed:true,fixtureProcesses:2,standardWindows:9,terminalWindows:5,duplicateTitleWindows:2,hiddenBackingWindowsListed:0,focusAB:true,renameStable:true,minimizedRestored:true,closedRefused:true});fs.copyFileSync(path.join(root,'result.json'),path.join(output,'native-checks.json'));console.log('Native AX: five terminal fixtures, distinct A/B and same-title focus, rename/restacking, minimized restore and closed-window rejection passed');
 }catch(error){console.error(error);app.exitCode=1}finally{child?.kill();terminalChild?.kill();app.exit(app.exitCode||0)}
});
