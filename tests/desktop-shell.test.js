'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const policy=require('../platform'),source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const boot=source.slice(source.indexOf('// Production installations ignore'),source.indexOf("const WebSocket = require('ws')"));
test('packaged startup ignores only leaked test controls before any profile/service initialization',()=>{
 for(const packaged of [true,false])for(const optin of ['', '1']){
  const env={TODO_TEST_USER_DATA:'/fixture',POME_PACKAGED_TEST_MODE:optin,POME_HOOK_TEST_HOME:'/fixture/hooks',POME_TEST_NOTIFICATIONS:'1',DASHSCOPE_API_KEY:'keep'};
  const scope=vm.createContext({platformPolicy:policy,app:{isPackaged:packaged},process:{env}});vm.runInContext(boot,scope);
  const isolated=!packaged||optin==='1';assert.equal(Boolean(env.TODO_TEST_USER_DATA),isolated);assert.equal(env.DASHSCOPE_API_KEY,'keep');
  assert.equal(Boolean(env.POME_HOOK_TEST_HOME),isolated);assert.equal(Boolean(env.POME_TEST_NOTIFICATIONS),isolated);
 }
 assert.equal(policy.desktopTestEnvironment({packaged:true,env:{POME_PACKAGED_TEST_MODE:'1'}}).testMode,false);
});

function harness(platform='darwin'){
 const events=[],handlers={},contentsHandlers={};let visible=true,loading=false,contextMenu='unset';
 const window={isDestroyed:()=>false,isVisible:()=>visible,showInactive:()=>{visible=true;events.push('show');},hide:()=>{visible=false;events.push('hide');},webContents:{isLoadingMainFrame:()=>loading,once:(key,fn)=>contentsHandlers[key]=fn,send:channel=>events.push(channel)}};
 class Tray{constructor(){events.push('create');}isDestroyed(){return false;}setToolTip(){}setIgnoreDoubleClickEvents(){}on(key,fn){handlers[key]=fn;}setContextMenu(menu){contextMenu=menu;}popUpContextMenu(menu){events.push(menu===scope.trayMenu?'menu':'wrong-menu');}destroy(){events.push('destroy');}}
 const scope={process:{platform},mainWindow:window,isQuitting:false,desktopTrayExpected:true,pendingHideUntilTray:false,hideWhenCollapsed:false,startupRecoveryDismissed:false,tray:null,trayMenu:null,trayOpenQueued:false,currentMode:'collapsed',Tray,
 createNotchTrayIcon:()=>({isEmpty:()=>false}),Menu:{buildFromTemplate:items=>items},PomeI18n:{t:key=>key},isAutoLaunchEnabled:()=>false,applyMainWindowLayer:()=>events.push('layer'),repositionWindow:()=>{},getTargetDisplay:()=>({}),activateMainWindow:()=>events.push('activate'),requestRendererCollapse:()=>events.push('collapse'),console:{error:()=>events.push('error')},createWindow:()=>{scope.mainWindow=window;events.push('window');}};
 vm.createContext(scope);
 vm.runInContext(source.slice(source.indexOf('function hideMainWindowSafely()'),source.indexOf('// ============ Codex')),scope);
 vm.runInContext(source.slice(source.indexOf('function showMainPanelFromTray()'),source.indexOf("ipcMain.handle('window:begin-open'")),scope);
 return{scope,events,handlers,contentsHandlers,visible:()=>visible,loading:value=>loading=value,contextMenu:()=>contextMenu};
}
test('macOS left click expands directly and right click keeps the current menu',()=>{
 const h=harness();h.scope.createTray();assert.equal(h.contextMenu(),null);h.handlers.click();assert(h.events.includes('shortcut:toggle-panel'));h.handlers['right-click']();assert.equal(h.events.at(-1),'menu');
 h.scope.currentMode='expanded';h.events.length=0;h.handlers.click();assert(!h.events.includes('shortcut:toggle-panel'),'an expanded panel stays open');
});
test('Windows keeps its attached native context menu',()=>{const h=harness('win32');h.scope.createTray();assert(Array.isArray(h.contextMenu()));assert.equal(h.handlers['right-click'],undefined);});
test('hide before tray creation keeps a reachable capsule and completes after tray ready',()=>{
 const h=harness();h.scope.hideWindowAfterCollapse();assert.equal(h.visible(),true);assert.equal(h.scope.pendingHideUntilTray,true);
 h.scope.createTray();assert.equal(h.visible(),false);assert.equal(h.scope.pendingHideUntilTray,false);
});
test('reopening cancels a queued hide and a failed tray never strands a hidden panel',()=>{
 const h=harness();h.scope.hideWindowAfterCollapse();h.scope.showMainPanelFromTray();h.scope.createTray();assert.equal(h.visible(),true);
 const failed=harness();failed.scope.Tray=class{constructor(){throw Error('fixture');}};failed.scope.hideWindowAfterCollapse();failed.scope.createTray();assert.equal(failed.visible(),true);assert.equal(failed.scope.tray,null);
});
test('tray recreation/open waits for the renderer without duplicating toggle events',()=>{
 const h=harness();h.scope.mainWindow=null;h.loading(true);h.scope.showMainPanelFromTray();h.scope.showMainPanelFromTray();assert.equal(h.events.filter(e=>e==='window').length,1);assert.equal(h.events.filter(e=>e==='shortcut:toggle-panel').length,0);
 h.loading(false);h.contentsHandlers['did-finish-load']();assert.equal(h.events.filter(e=>e==='shortcut:toggle-panel').length,1);
});
test('tray left click recreates a destroyed main window instead of no-op',()=>{
 const h=harness();h.scope.createTray();h.scope.mainWindow=null;h.events.length=0;
 h.handlers.click();
 assert.equal(h.events.filter(e=>e==='window').length,1);
 assert(h.events.includes('shortcut:toggle-panel'));
});
test('quitting prevents late tray construction',()=>{const h=harness();h.scope.isQuitting=true;h.scope.createTray();assert(!h.events.includes('create'));});
