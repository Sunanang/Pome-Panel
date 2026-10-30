'use strict';
// Explicit native acceptance: creates only its own two AppKit windows. Requires
// an interactive macOS session, Accessibility permission and Xcode CLI tools.
// It temporarily enters a fullscreen Space, then returns and closes the fixture.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {createDarwinAdapter}=require('../platform-adapters/darwin');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await fn())return;}catch{}await sleep(100);}throw Error('Native Space fixture timed out');}
async function main(){
 if(process.platform!=='darwin')throw Error('Unverified: this native check requires macOS');
 const trusted=execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',"ObjC.import('ApplicationServices'); String(Boolean($.AXIsProcessTrusted()))"],{encoding:'utf8',timeout:5000}).trim();
 if(trusted!=='true')throw Error('Unverified: Accessibility permission required; this test never requests or changes it');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pome-windows-spaces-'));
 let child;const result={passed:false,checks:[],scans:[],unverified:['multiple physical displays']};
 const state=()=>JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
 function command(action,index){const file=path.join(dir,'command.json');fs.writeFileSync(file+'.tmp',JSON.stringify({action,index}));fs.renameSync(file+'.tmp',file);}
 async function cleanup(){
  if(child&&!child.killed){
   try{if(state().windows[1].fullScreen){command('fullscreen',1);await until(()=>!state().windows[1].fullScreen,8000);await sleep(1000);}command('exit',1);await until(()=>child.exitCode!==null||child.signalCode!==null,4000);}catch{child.kill();}
  }
  fs.rmSync(dir,{recursive:true,force:true});
 }
 try{
  const binary=path.join(dir,'fixture');
  execFileSync('/usr/bin/xcrun',['swiftc',path.join(__dirname,'fixtures/windows-spaces.swift'),'-o',binary,'-module-cache-path',path.join(dir,'module-cache')],{timeout:60000,stdio:'pipe'});
  child=spawn(binary,[dir],{stdio:'ignore'});await until(()=>state().windows.length===2);result.pid=state().pid;
  let adapter=createDarwinAdapter();
  function onScreen(number){
   const query=`ObjC.import('Foundation');ObjC.import('CoreGraphics');function run(){const rows=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly,$.kCGNullWindowID)));return String(rows.some(row=>Number(row.kCGWindowNumber)===${number}));}`;
   return execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',query],{encoding:'utf8',timeout:3000}).trim()==='true';
  }
  async function scan(label){const start=Date.now();const list=await adapter.windows.list();assert.equal(list.error,null);const rows=list.items.filter(row=>row.pid===result.pid);result.scans.push({label,ms:Date.now()-start,rows:rows.map(({id,title,windowNumber,axRemoteId})=>({id,title,windowNumber,axRemoteId}))});return rows;}
  let rows=await scan('same desktop');assert.equal(rows.length,2);const a=rows.find(row=>row.title.endsWith('A')),b=rows.find(row=>row.title.endsWith('B'));assert(a?.axRemoteId&&b?.axRemoteId);result.checks.push('two standard roots with exact remote identities');
  command('fullscreen',1);await until(()=>state().windows[1].fullScreen);await sleep(1300);
  const query=`ObjC.import('ApplicationServices');ObjC.import('Foundation');function run(){const application=$.AXUIElementCreateApplication(${result.pid}),out=Ref();const error=$.AXUIElementCopyAttributeValue(application,$('AXWindows'),out);return JSON.stringify({error,count:error===0?Number(ObjC.castRefToObject(out[0]).count):null});}`;
  result.publishedDuringFullscreen=JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',query],{encoding:'utf8',timeout:5000}));
  rows=await scan('fullscreen with existing cache');assert.equal(rows.length,2);
  // Cold start while the other desktop is invisible must work too: keeping a
  // previously observed row alone would not fix the reported missing windows.
  adapter=createDarwinAdapter();await until(async()=>{rows=await scan('cold fullscreen Space');return rows.length===2;});
  assert.equal(rows.find(row=>row.title.endsWith('A')).id,a.id);assert.equal(rows.find(row=>row.title.endsWith('B')).id,b.id);result.checks.push('cold discovery across normal/fullscreen Spaces, with stable IDs');
  assert.equal(await adapter.windows.focus(a.id),true);await until(()=>state().focused===0);await until(()=>onScreen(a.windowNumber));result.checks.push('exact focus and onscreen presence on normal desktop A');
  assert.equal(await adapter.windows.focus(b.id),true);await until(()=>state().focused===1);await until(()=>onScreen(b.windowNumber));result.checks.push('exact focus and onscreen presence on fullscreen B');
  command('fullscreen',1);await until(()=>!state().windows[1].fullScreen);await sleep(1000);
  rows=await scan('after fullscreen');assert.equal(rows.length,2);assert.equal(rows.find(row=>row.title.endsWith('A')).id,a.id);assert.equal(rows.find(row=>row.title.endsWith('B')).id,b.id);
  command('close',0);await sleep(300);assert.equal(await adapter.windows.focus(a.id),false);result.checks.push('closed native reference refused');
  result.passed=true;
 }catch(error){result.error=error.stack;throw error;}finally{
  await cleanup();
  if(process.env.POME_WINDOWS_SPACES_RESULT)fs.writeFileSync(process.env.POME_WINDOWS_SPACES_RESULT,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
