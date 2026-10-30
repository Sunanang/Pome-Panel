'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),cp=require('node:child_process');
const electron=require('electron'),{app,dialog,BrowserWindow,ipcMain}=electron;
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(1);};
process.on('uncaughtException',error=>{console.error(error);app.exit(1);});
const profile=process.env.TODO_TEST_USER_DATA;
assert(profile,'isolated profile required');
app.commandLine.appendSwitch('user-data-dir',profile);
if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
const explicit=process.env.POME_SHELL_TEST_CASE==='explicit';
Object.defineProperty(app,'isPackaged',{configurable:true,get:()=>true});
if(explicit)process.env.POME_PACKAGED_TEST_MODE='1';else delete process.env.POME_PACKAGED_TEST_MODE;
const hookHome=path.join(profile,'safe-home');fs.mkdirSync(hookHome,{recursive:true});os.homedir=()=>hookHome;
let loginWrites=0;app.setLoginItemSettings=()=>{loginWrites++;};app.getLoginItemSettings=()=>({openAtLogin:false});
const adapters=require('../platform-adapters'),load=adapters.loadAdapter;let permissionChecks=0;
adapters.loadAdapter=(...args)=>{const adapter=load(...args);adapter.windows.list=async()=>({items:[],error:null});if(adapter.permissions)adapter.permissions.selfCheck=async()=>{permissionChecks++;};return adapter;};
const http=require('http'),createServer=http.createServer;const ports=[];
http.createServer=(...args)=>{const server=createServer(...args),listen=server.listen;server.listen=function(port,host,...rest){ports.push(port);return listen.call(this,0,host,...rest);};return server;};
let tray,attachedMenu,menuRequested=0;const trayEvents=[];
const RealTray=electron.Tray;
const injected=Object.create(electron);
Object.defineProperty(injected,'Tray',{value:function(...args){tray=new RealTray(...args);const set=tray.setContextMenu.bind(tray),on=tray.on.bind(tray);tray.on=(name,fn)=>on(name,(...values)=>{trayEvents.push(name);return fn(...values);});tray.setContextMenu=menu=>{attachedMenu=menu;return set(menu);};tray.popUpContextMenu=()=>{menuRequested++;};return tray;}});
const Module=require('node:module'),loadModule=Module._load,mainFile=require.resolve('../main.js');
Module._load=function(request,parent,...rest){const value=loadModule.call(this,request,parent,...rest);return request==='electron'&&parent?.filename===mainFile?injected:value;};
let deferredTray;const immediate=global.setImmediate;
global.setImmediate=(fn,...args)=>String(fn).includes('createTray()')?(deferredTray=fn,{unref(){}}):immediate(fn,...args);
let selected='',errors=0;dialog.showOpenDialog=async()=>({canceled:!selected,filePaths:selected?[selected]:[]});dialog.showMessageBox=async()=>{errors++;return{response:1};};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){try{if(await Promise.race([Promise.resolve().then(fn),sleep(300).then(()=>false)]))return;}catch{}await sleep(40);}throw Error('desktop shell timeout');}
const watchdog=setTimeout(()=>{console.error('Desktop shell acceptance timed out');app.exit(1);},45000);let started=false;
app.on('web-contents-created',(_event,c)=>c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(watchdog);console.log('Desktop shell passed: '+(explicit?'explicit packaged isolation':'inherited test cleanup, tray lifecycle/click, layer recovery and WebP cover'));app.exit(0);}).catch(error=>{console.error(error);app.exit(1);});}));
async function run(c){
 const win=BrowserWindow.fromWebContents(c),js=code=>c.executeJavaScript(code);
 await until(()=>js('!!window.NotchWorkspace&&!workspaceReloadPending'));
 if(explicit){assert.equal(process.env.TODO_TEST_USER_DATA,profile);assert.equal(tray,undefined);assert.deepEqual(ports,[]);assert.equal(loginWrites,0);assert.equal(permissionChecks,0);return;}
 assert.equal(process.env.TODO_TEST_USER_DATA,undefined);assert.equal(process.env.POME_HOOK_TEST_HOME,undefined);assert(ports.includes(43821));assert(loginWrites>0);if(process.platform==='darwin')assert.equal(permissionChecks,1);
 assert.equal(typeof deferredTray,'function');await until(()=>win.isVisible());
 // Closing during the deferred-tray gap keeps a reachable capsule.
 win.close();await sleep(80);assert.equal(win.isVisible(),true);
 deferredTray();await until(()=>!win.isVisible());assert(tray&&!tray.isDestroyed());if(process.platform==='darwin')assert.equal(attachedMenu,null);
 await sleep(500);assert.equal(win.isVisible(),false,'startup timer cannot undo an explicit hide');
 let nativeTrayClick=false,nativeTrayMethod='event fixture';
 if(process.platform==='darwin'&&electron.systemPreferences.isTrustedAccessibilityClient(false)&&!process.env.CI){
  const rect=tray.getBounds();console.log('Own tray bounds',rect,'trusted',electron.systemPreferences.isTrustedAccessibilityClient(false));assert(rect.width>0&&rect.height>0,'own status item must be visible for native click acceptance');
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  const script=`ObjC.import('CoreGraphics');ObjC.import('ApplicationServices');const original=$.CGEventGetLocation($.CGEventCreate(null));const p=$.CGPointMake(${x},${y});$.CGWarpMouseCursorPosition(p);$.CGEventPost($.kCGHIDEventTap,$.CGEventCreateMouseEvent(null,$.kCGEventMouseMoved,p,0));delay(.5);$.CGEventPost($.kCGHIDEventTap,$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseDown,p,0));delay(.08);$.CGEventPost($.kCGHIDEventTap,$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseUp,p,0));delay(.2);$.CGWarpMouseCursorPosition(original);JSON.stringify({trusted:Boolean($.AXIsProcessTrusted()),postAccess:typeof $.CGPreflightPostEventAccess==='function'?Boolean($.CGPreflightPostEventAccess()):null});`;
  const diagnostic=await new Promise((resolve,reject)=>cp.execFile('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:5000},(error,stdout)=>error?reject(error):resolve(stdout)));console.log('Native click capability',diagnostic.trim());nativeTrayMethod='CGEvent';
  await sleep(200);
  if(!trayEvents.includes('click')){
   const press=`ObjC.import('ApplicationServices');ObjC.import('Foundation');function read(e,n){const r=Ref();const error=$.AXUIElementCopyAttributeValue(e,$(n),r);return error===0?ObjC.castRefToObject(r[0]):null;}function run(){const app=$.AXUIElementCreateApplication(${process.pid}),bar=read(app,'AXExtrasMenuBar'),children=bar?read(bar,'AXChildren'):null;if(!children||Number(children.count)!==1)return JSON.stringify({count:children?Number(children.count):null});return JSON.stringify({count:1,error:$.AXUIElementPerformAction(children.objectAtIndex(0),$('AXPress'))});}`;
   const diagnostic=await new Promise((resolve,reject)=>cp.execFile('/usr/bin/osascript',['-l','JavaScript','-e',press],{timeout:5000},(error,stdout)=>error?reject(error):resolve(stdout)));console.log('Native status AX press',diagnostic.trim());
   nativeTrayMethod='AXPress';
  }
  nativeTrayClick=true;
 }else tray.emit('click');
 try{await until(()=>js('isExpanded&&!modeBusy'));}catch(error){console.error('Tray diagnostics',trayEvents,win.isVisible(),await js('({isExpanded,modeBusy})'));throw error;}assert(win.isVisible());
 if(process.platform==='darwin'){tray.emit('right-click');assert.equal(menuRequested,1);}
 // Real Chromium WebP encoding preserves alpha and bounds oversized input.
 const bytes=Buffer.alloc(3200*40*4);for(let i=0;i<bytes.length;i+=4){bytes[i+2]=200;bytes[i+3]=i<bytes.length/2?0:255;}
 const image=electron.nativeImage.createFromBitmap(bytes,{width:3200,height:40});selected=path.join(profile,'cover.png');fs.writeFileSync(selected,image.toPNG());
 fs.writeFileSync(path.join(profile,'mirror-cover.jpg'),image.resize({width:200}).toJPEG(90));
 assert.match(await js('notchAPI.getMirrorImage()'),/^data:image\/png;base64,/,'legacy JPEG remains readable');
 const result=await js('notchAPI.chooseMirrorImage()');assert.equal(result.ok,true);assert.match(result.dataUrl,/^data:image\/webp;base64,/);
 const cover=fs.readFileSync(path.join(profile,'mirror-cover.webp'));assert.equal(cover.toString('ascii',0,4),'RIFF');assert.equal(cover.toString('ascii',8,12),'WEBP');
 const dimensions=await js(`(async()=>{const image=new Image();image.src=${JSON.stringify(result.dataUrl)};await image.decode();const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:image.width,height:image.height,alpha:ctx.getImageData(1,1,1,1).data[3]};})()`);
 assert.equal(dimensions.width,1600);assert.equal(dimensions.height,20);assert.equal(dimensions.alpha,0);assert.equal(await js('notchAPI.getMirrorImage()'),result.dataUrl);assert.equal(errors,0);
 const output=process.env.POME_SHELL_SHOTS;if(output){fs.mkdirSync(output,{recursive:true});await js("setActiveTab('settings')");await sleep(300);await js("document.getElementById('settings-mirror-preview').scrollIntoView({block:'center'})");await sleep(200);fs.writeFileSync(path.join(output,'settings-webp.png'),(await c.capturePage()).toPNG());fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({nativeTrayClick,nativeTrayMethod,explicitHidePreserved:true,webp:true,dimensions,requestedPort:ports[0]},null,2));}
}
require('../main.js');
