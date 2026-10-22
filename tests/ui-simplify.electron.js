'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,ipcMain,BrowserWindow}=require('electron');
const profile=process.env.TODO_TEST_USER_DATA,restart=process.env.POME_UI_RESTART==='1';
const home=path.join(profile,'isolated-home');fs.mkdirSync(home,{recursive:true});process.env.POME_HOOK_TEST_HOME=home;process.env.POME_TEST_NOTIFICATIONS='1';
app.commandLine.appendSwitch('user-data-dir',profile);app.disableHardwareAcceleration();if(process.platform==='darwin')app.commandLine.appendSwitch('use-mock-keychain');
if(restart){for(const name of ['.first-run-done','.ui-welcome-done'])fs.rmSync(path.join(profile,name),{force:true});const file=path.join(profile,'app-settings.json');const data=JSON.parse(fs.readFileSync(file,'utf8'));delete data.onboardingPending;fs.writeFileSync(file,JSON.stringify(data));}
const stamp=new Date().toISOString();
require('../cursor-usage').readAuthToken=()=>({ok:true,token:'fixture-local-cursor'});
require('../cursor-usage').fetchCursorUsage=async({manualToken}={})=>({ok:true,detected:true,configured:!!manualToken,authSource:manualToken?'manual':'local',auto:{percent:35},other:{percent:50},fetchedAt:stamp});
require('../codex-usage').readCodexUsage=async()=>({ok:true,detected:true,authSource:'local',updatedAt:stamp,primary:{percent:50}});
require('../codex-auth').readLocalCodexToken=async()=>({ok:true,token:'fixture-local-codex'});
require('../codex-usage-remote').createCodexUsageService=()=>({tokenState:()=>({manualTokenInvalid:false}),getUsage:async({manualToken}={})=>({ok:true,detected:true,configured:!!manualToken,authSource:manualToken?'manual':'local',updatedAt:stamp,primary:{percent:50}}),reset(){}});
let failSave=false, failCodexSave=false, failWelcome='', welcomeSaves=0, failClear=false, failPair=false;
let localCursorError='', cursorActionError='', nasPairError='', localCodexError='', codexActionError='', providerSaveError='', releaseWelcome=null, cameraFailure=false;
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>originalHandle(channel,(event,...args)=>{
 if(channel==='settings:complete-welcome'){
  welcomeSaves++;
  if(failWelcome==='pending')return new Promise(resolve=>{releaseWelcome=()=>resolve({ok:false,error:'save_failed'});});
  if(failWelcome==='throw')throw new Error('fixture_save_failed');
  if(failWelcome)return {ok:false,error:'save_failed'};
 }
 if(channel==='cursor:read-local-token'&&localCursorError){
  if(localCursorError==='throw')throw new Error('fixture_cursor_read_failed');
  return {ok:false,error:localCursorError};
 }
 if(['cursor:set-token','cursor:clear-token'].includes(channel)&&cursorActionError){
  if(cursorActionError==='throw')throw new Error('fixture_cursor_write_failed');
  return {ok:false,error:cursorActionError};
 }
 if(channel==='codex:read-local-token'&&localCodexError){
  if(localCodexError==='throw')throw new Error('fixture_codex_read_failed');
  return {ok:false,error:localCodexError};
 }
 if(['codex:set-token','codex:clear-token'].includes(channel)&&codexActionError){
  if(codexActionError==='throw')throw new Error('fixture_codex_write_failed');
  return {ok:false,error:codexActionError};
 }
 if(channel==='ai-provider:set-token'&&providerSaveError){
  if(providerSaveError==='throw')throw new Error('fixture_provider_save_failed');
  return {ok:false,error:providerSaveError};
 }
 if(channel==='media:camera'&&cameraFailure)return true;
 if(channel==='cursor:set-token'&&failSave)return {ok:false,error:'secure_storage_unavailable'};
 if(channel==='codex:set-token'&&failCodexSave)return {ok:false,error:'secure_storage_unavailable'};
 if(channel==='ai-provider:clear-token'&&failClear)return {ok:false,error:'secure_storage_unavailable'};
 if(channel==='sync:pair-claim'&&(failPair||nasPairError))return {ok:false,error:nasPairError||'timeout',message:nasPairError?'NAS token 保存失败 / NAS token storage failed':'连接超时，请重试'};
 return listener(event,...args);
});
require('../grokbot-usage').createGrokbotUsageService=()=>({getUsage:async()=>({ok:true,detected:false}),reset(){}});
let nativeError=true;
const adapters=require('../platform-adapters'),load=adapters.loadAdapter;adapters.loadAdapter=(...args)=>{const adapter=load(...args);adapter.windows.list=async()=>({items:[],error:nativeError?'native_unavailable':null});return adapter;};
const output=path.join(__dirname,'../dist.noindex/ui-simplify/flows');fs.mkdirSync(output,{recursive:true});
let started=false;const errors=[];const timer=setTimeout(()=>{console.error('Simplification timed out',errors);app.exit(1);},150000);
app.on('web-contents-created',(_event,c)=>{c.on('console-message',d=>{if(d.level==='error'&&!d.message.includes('ERR_'))errors.push(d.message);});c.once('did-finish-load',()=>{if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;run(c).then(()=>{clearTimeout(timer);console.log('UI simplification: welcome/upgrade, independent widgets, acquisition/save failures, diagnostics, note save and recording entry, hidden tabs, confirmations, capsule hints and Windows fallback passed');app.exit(0);}).catch(e=>{console.error(e,errors);app.exit(1);});});});
async function run(c){
 const js=code=>c.executeJavaScript(code),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(expr){for(let i=0;i<350;i++){if(await js(expr).catch(()=>false))return;await sleep(20);}throw Error('Timeout '+expr);}
 async function capture(name){await sleep(850);await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');c.invalidate();await sleep(40);fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG());}
 await until('!!window.NotchUi && !!window.NotchWorkspace');await js('setMode(true)');await until('!modeBusy');
 if(restart){
  await sleep(250);assert.equal(await js(`document.getElementById('ui-welcome').open`),false,'upgrade with existing data must not enter welcome');
  assert.deepEqual(await js('NotchHome.getVisibility().visibleIds'),JSON.parse(fs.readFileSync(path.join(output,'saved-visible.json'),'utf8')));
  return;
 }
 // Fixture setup only: arbitrary widget sets replace the removed product presets.
 function seedHomeFixture(ids = HOME_MODULE_REGISTRY.filter(id=>!unavailableHomeModules.includes(id))) {
  if(ids.includes('windows'))windowsInlineRequested=true;
  hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id));
  homeOrder=[...ids,...HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id))];
  const defaults=Object.fromEntries(ids.map(id=>[id,HOME_SIZE_DEFAULTS[id]]));
  homeSizes={...HOME_SIZE_DEFAULTS,...NotchDomain.normalizeHomeWidgetSizes(defaults,defaults,'',48)};
  homeWorkingLayout=null;
  const layout=resolveValidatedHomeLayout(hiddenHomeModules,homeOrder,homeSizes,{forcePack:true,sealGaps:true});
  if(!layout)throw new Error('invalid home fixture');
  applyHomeLayout(layout,{reason:'visibility'});saveHiddenHomeModules();saveHomeLayout();
  document.dispatchEvent(new CustomEvent('notch:home-modules-changed',{detail:NotchHome.getVisibility()}));
 }
 await js(`window.fixtureHome=${seedHomeFixture.toString()};void 0`);
 assert.equal((await js('notchAPI.getAppSettings()')).onboardingPending,true);
 await until(`document.getElementById('ui-welcome').open`);await capture('welcome-1');
 const initialVisible=await js('NotchHome.getVisibility().visibleIds');
 await js(`document.querySelector('#ui-welcome .primary').click()`);await capture('welcome-2');
 assert.equal(await js(`document.querySelectorAll('#ui-welcome-modules input:checked').length`),initialVisible.length,'welcome starts with the existing layout');
 await js(`document.querySelectorAll('#ui-welcome-modules input').forEach(n=>{const wanted=['note','pomodoro','cursor','inbox'].includes(n.value);if(n.checked!==wanted)n.click()})`);
 assert.equal(await js(`document.querySelectorAll('#ui-welcome-modules input:checked').length`),4);
 // Escape temporarily closes the wizard; it never persists completion.
 await js(`document.getElementById('ui-welcome').dispatchEvent(new Event('cancel',{cancelable:true}))`);
 assert.equal(await js(`document.getElementById('ui-welcome').open`),false);
 assert.equal((await js('notchAPI.getAppSettings()')).onboardingPending,true);
 assert.equal(welcomeSaves,0);
 await js('setMode(false)');await until('!modeBusy');await js('setMode(true)');await until('!modeBusy');
 await until(`document.getElementById('ui-welcome').open`);
 assert.equal(await js(`document.querySelector('#ui-welcome > small').textContent`),'2 / 3');
 await js(`(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===HOME_HIDDEN_MODULES_KEY)throw new Error('fixture_storage_full');return write.call(this,k,v)};try{document.querySelector('#ui-welcome .primary').click()}finally{Storage.prototype.setItem=write}})()`);
 assert.equal(await js(`document.querySelector('#ui-welcome > small').textContent`),'2 / 3','unsaved module choices cannot advance welcome');
 assert.equal(await js(`document.getElementById('ui-welcome-error').hidden`),false);
 await js(`document.querySelector('#ui-welcome .primary').click()`);await capture('welcome-3');
 assert.deepEqual(await js('NotchHome.getVisibility().visibleIds'),['pomodoro','cursor','inbox','note'],'welcome applies explicit choices through individual switches');
 failWelcome='pending';const savesBefore=welcomeSaves;
 await js(`document.querySelector('#ui-welcome .ui-welcome-body button').click()`);
 await until(`document.querySelectorAll('#ui-welcome button:not(:disabled)').length===0`);
 await js(`document.querySelectorAll('#ui-welcome button').forEach(b=>b.click());window.dispatchEvent(new Event('pome:language-changed'))`);
 assert.equal(welcomeSaves,savesBefore+1,'all welcome buttons stay disabled while saving, including after rerender');
 assert.equal(await js(`document.querySelectorAll('#ui-welcome button:not(:disabled)').length`),0);
 await capture('welcome-busy');
 assert(releaseWelcome);releaseWelcome();
 await until(`!document.querySelector('#ui-welcome .ui-welcome-body button').disabled`);
 failWelcome='result';await js(`document.querySelector('#ui-welcome .primary').click()`);
 await until(`!document.getElementById('ui-welcome-error').hidden && !document.querySelector('#ui-welcome-error button').disabled`);
 assert.equal(await js(`document.getElementById('ui-welcome').open && document.getElementById('ui-error-bar').hidden`),true);
 assert.match(await js(`document.querySelector('#ui-welcome-error p').textContent`),/无法保存.*重试/);
 assert.equal((await js('notchAPI.getAppSettings()')).onboardingPending,true);await capture('welcome-save-failed');
 failWelcome='throw';await js(`document.querySelector('#ui-welcome-error button').click()`);
 await until(`document.querySelector('#ui-welcome-error pre').textContent.includes('fixture_save_failed') && !document.querySelector('#ui-welcome-error button').disabled`);
 failWelcome='';await js(`document.querySelector('#ui-welcome-error button').click()`);await until(`!document.getElementById('ui-welcome').open`);
 assert.equal((await js('notchAPI.getAppSettings()')).onboardingPending,false);await capture('home-selected-modules');
 // Capsule help persists a maximum of three openings and closes on collapse.
 for(let i=0;i<4;i++){
  await js('setMode(false)');await until('!modeBusy');await js('setMode(true)');await until('!modeBusy');
  assert.equal(await js(`document.getElementById('ui-capsule-hint').hidden`),i>=3);
  if(i===0)await capture('capsule-hint');
 }
 await js(`setActiveTab('settings')`);await until(`activeTab==='settings'&&!tabBusy`);
 assert.equal(await js(`document.getElementById('ui-capsule-hint').hidden`),true);
 for(const id of ['cursor','codex']){
  assert.equal(await js(`document.getElementById('ui-token-manual-${id}').open`),false);
  await js(`document.getElementById('settings-${id}-token-fetch').click()`);
  await until(`notchAPI.get${id==='cursor'?'Cursor':'Codex'}TokenStatus().then(s=>s.configured)`);
  assert.equal(await js(`document.getElementById('settings-${id}-token').value`),'');
  assert.equal(await js(`document.getElementById('ui-token-manual-${id}').open`),false);
 }
 await js('NotchAiUsage.refresh({force:true})');await sleep(100);
 assert.match(await js(`document.getElementById('settings-cursor-token-status').textContent`),/已生效/);
 await js(`NotchAiSources.openSettings('cursor')`);await until(`document.activeElement.id==='settings-cursor-token'`);await capture('token-manual');
 await js(`document.getElementById('ui-token-manual-cursor').open=false`);await capture('token-default');
 const before=await js('notchAPI.getCursorTokenStatus()');failSave=true;
 await js(`document.getElementById('settings-cursor-token-fetch').click()`);await until(`!document.getElementById('ui-error-bar').hidden && !document.getElementById('settings-cursor-token-fetch').disabled`);
 assert.equal(await js(`document.getElementById('settings-cursor-token-hint').textContent`),'');
 assert.equal((await js('notchAPI.getCursorTokenStatus()')).configured,before.configured);failSave=false;
 await js('setMode(false)');await until('!modeBusy');assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true);
 await js('setMode(true)');await until('!modeBusy');assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'unresolved errors return on expansion');
 await js(`document.getElementById('settings-cursor-token-fetch').click()`);await until(`!document.getElementById('settings-cursor-token-fetch').disabled && document.getElementById('ui-error-bar').hidden`);
 // Cursor read, save and clear failures preserve their exact localized problem.
 for(const locale of ['zh-CN','en-US']){
  await js(`notchAPI.setLanguage('${locale}')`);await until(`document.documentElement.lang==='${locale}'`);
  await js(`NotchAiSources.openSettings('cursor')`);await until(`document.activeElement.id==='settings-cursor-token'`);
  await js(`document.getElementById('settings-cursor-token').value='  ';document.getElementById('settings-cursor-token-save').click();NotchAiUsage.refresh({force:true})`);
  assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'empty Cursor token is only a field validation');
  assert.equal(await js(`document.getElementById('settings-cursor-token-hint').textContent===PomeI18n.t('copy.getOrPasteATokenFirstOr.f2f57e')`),true,'quota refresh preserves the field validation');
  if(locale==='zh-CN')await capture('cursor-token-required');
  for(const code of ['cursor_db_missing','cursor_token_missing','cursor_db_read_failed','throw']){
   localCursorError=code;
   await js(`document.getElementById('settings-cursor-token-fetch').click()`);
   await until(`!document.getElementById('settings-cursor-token-fetch').disabled && !document.getElementById('ui-error-bar').hidden`);
   const key={cursor_db_missing:'copy.noLocalCursorDataFoundInstallCursor.f5b341',cursor_token_missing:'copy.cursorIsnTSignedInLocallySign.45a8a8',cursor_db_read_failed:'copy.couldnTReadCursorSignInRetry.6bf381',throw:'copy.couldnTReadCursorSignInRetry.6bf381'}[code];
   assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('${key}')`),true,locale+'/'+code+' keeps the actual local-read problem');
   assert.equal(await js(`document.getElementById('settings-cursor-token-hint').textContent`),'');
   assert.match(await js(`document.querySelector('#ui-error-details pre').textContent`),new RegExp(code==='throw'?'cursor_db_read_failed':code));
   if(code==='cursor_db_read_failed')await capture('cursor-local-read-'+locale);
   await js(`NotchUi.clearError('token:cursor')`);
  }
  localCursorError='';
  for(const action of ['save','clear'])for(const code of ['secure_storage_unavailable','throw']){
   cursorActionError=code;
   await js(`document.getElementById('settings-cursor-token').value='fixture-cursor';document.getElementById('settings-cursor-token-${action}').click()`);
   await until(`!document.getElementById('settings-cursor-token-${action}').disabled && !document.getElementById('ui-error-bar').hidden`);
   const key=action==='clear'?'copy.couldnTClearTheTokenRetry.3cb9ef':code==='secure_storage_unavailable'?'copy.systemSecureStorageIsUnavailableCanT.3a9217':'copy.couldnTSaveTheTokenRetry.69484f';
   assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('${key}')`),true,locale+'/'+action+' never claims an expired login');
   cursorActionError='';
   await js(`document.getElementById('settings-cursor-token-${action}').click()`);
   await until(`!document.getElementById('settings-cursor-token-${action}').disabled && document.getElementById('ui-error-bar').hidden`);
  }
  cursorActionError='token_required';
  await js(`document.getElementById('settings-cursor-token').value='fixture-cursor';document.getElementById('settings-cursor-token-save').click()`);
  await until(`!document.getElementById('settings-cursor-token-save').disabled`);
  await js(`NotchAiUsage.refresh({force:true})`);
  assert.equal(await js(`document.getElementById('ui-error-bar').hidden && document.getElementById('settings-cursor-token-hint').textContent===PomeI18n.t('copy.getOrPasteATokenFirstOr.f2f57e')`),true,'server token validation also stays inline after quota refresh');
  cursorActionError='';
  await js(`document.getElementById('settings-cursor-token-clear').click()`);
  await until(`!document.getElementById('settings-cursor-token-clear').disabled`);
 }
 await js(`notchAPI.setLanguage('zh-CN')`);await until(`document.documentElement.lang==='zh-CN'`);
 failCodexSave=true;await js(`document.getElementById('settings-codex-token-fetch').click()`);
 await until(`!document.getElementById('ui-error-bar').hidden && !document.getElementById('settings-codex-token-fetch').disabled`);
 assert.equal(await js(`document.getElementById('settings-codex-token-hint').textContent`),'','Codex acquisition failure has one error surface');
 failCodexSave=false;await js(`document.getElementById('settings-codex-token-fetch').click()`);
 await until(`!document.getElementById('settings-codex-token-fetch').disabled && document.getElementById('ui-error-bar').hidden`);
 // Returned failures and rejected IPC calls must share one error surface.
 for(const code of ['codex_auth_missing','codex_token_missing','codex_auth_read_failed','throw']){
  localCodexError=code;
  await js(`NotchAiSources.openSettings('codex')`);
  await until(`document.activeElement.id==='settings-codex-token'`);
  await js(`document.getElementById('settings-codex-token-fetch').click()`);
  await until(`!document.getElementById('settings-codex-token-fetch').disabled && !document.getElementById('ui-error-bar').hidden`);
  assert.equal(await js(`document.getElementById('settings-codex-token-hint').textContent`),'');
  assert.match(await js(`document.querySelector('#ui-error-details pre').textContent`),code==='throw'?/fixture_codex_read_failed/:new RegExp(code));
  const messageKey={codex_auth_missing:'copy.noReadableCodexSignInFoundSign.d77b80',codex_token_missing:'copy.noUsableTokenFoundInLocalCodex.fab797',codex_auth_read_failed:'copy.couldnTReadCodexSignInRetry.5e8c59',throw:'copy.couldnTReadCodexSignInRetry.5e8c59'}[code];
  assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('${messageKey}')`),true,'local read failures must not claim an expired login');
  if(code==='codex_auth_read_failed'){
   await js(`notchAPI.setLanguage('en-US')`);
   await until(`document.documentElement.lang==='en-US'`);
   assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('${messageKey}')`),true);
   await js(`notchAPI.setLanguage('zh-CN')`);await until(`document.documentElement.lang==='zh-CN'`);
  }
  if(code==='codex_auth_missing')await capture('codex-local-missing');
  if(code==='codex_auth_read_failed'){
   await js(`document.querySelector('#ui-error-bar button').click()`);
   await until(`document.activeElement.id==='settings-codex-token'`);
   await capture('codex-read-failed');
  }
  await js(`NotchUi.clearError('token:codex')`);
 }
 localCodexError='';
 for(const action of ['save','clear'])for(const failure of ['secure_storage_unavailable','throw']){
  codexActionError=failure;
  await js(`NotchAiSources.openSettings('codex');document.getElementById('settings-codex-token').value='fixture-manual-codex';document.getElementById('settings-codex-token-${action}').click()`);
  await until(`!document.getElementById('settings-codex-token-${action}').disabled && !document.getElementById('ui-error-bar').hidden`);
  assert.equal(await js(`document.getElementById('settings-codex-token-hint').textContent`),'');
  if(failure!=='throw')await capture(`codex-${action}-failed`);
  codexActionError='';
  await js(`document.getElementById('settings-codex-token-${action}').click()`);
  await until(`!document.getElementById('settings-codex-token-${action}').disabled && document.getElementById('ui-error-bar').hidden`);
 }
 await js(`document.getElementById('settings-codex-token-save').click()`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'empty Codex token stays a field validation');
 await js(`NotchAiUsage.refresh({force:true})`);
 assert.notEqual(await js(`document.getElementById('settings-codex-token-hint').textContent`),'');
 await capture('codex-required-after-refresh');
 for(const id of ['copilot','grok','antigravity','manus']){
  for(const failure of ['secure_storage_unavailable','throw']){
   providerSaveError=failure;
   await js(`NotchAiSources.openSettings('${id}');document.getElementById('settings-${id}-token').value='fixture-${id}';document.querySelector('[data-provider-save=${id}]').click()`);
   await until(`!document.querySelector('[data-provider-save=${id}]').disabled && !document.getElementById('ui-error-bar').hidden`);
   assert.equal(await js(`document.getElementById('settings-${id}-token-hint').textContent`),'');
   for(const locale of ['en-US','zh-CN']){
    await js(`notchAPI.setLanguage('${locale}')`);await until(`document.documentElement.lang==='${locale}'`);
    assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('providers.tokenSaveFailed')`),true,'credential storage failures keep their explicit message across locale changes');
    assert.equal(await js(`document.querySelector('#ui-error-details pre').textContent.includes('provider_token_save_failed')`),true,'diagnostics use an operation code instead of translated copy');
    if(id==='copilot'&&failure!=='throw')await capture(`provider-save-failed-${locale}`);
   }
   await js(`document.querySelector('#ui-error-bar button').click()`);
   await until(`document.activeElement.id==='settings-${id}-token'`);
   if(id==='copilot'&&failure!=='throw')await capture('provider-save-failed');
   await js(`NotchUi.clearError('token:${id}')`);
  }
  for(const failure of ['token_required',...(id==='grok'?['grok_team_required']:[])]){
   providerSaveError=failure;
   await js(`document.querySelector('[data-provider-save=${id}]').click()`);
   await until(`!document.querySelector('[data-provider-save=${id}]').disabled`);
   assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'field validation must not become persistent');
   assert.notEqual(await js(`document.getElementById('settings-${id}-token-hint').textContent`),'');
  }
 }
 providerSaveError='';
 // A successful save clears its own failure; unrelated success cannot clear it.
 providerSaveError='secure_storage_unavailable';
 await js(`document.querySelector('[data-provider-save=copilot]').click()`);
 await until(`!document.querySelector('[data-provider-save=copilot]').disabled`);
 await js(`NotchUi.clearError('token:codex')`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false);
 providerSaveError='';await js(`document.querySelector('[data-provider-save=copilot]').click()`);
 await until(`!document.querySelector('[data-provider-save=copilot]').disabled && document.getElementById('ui-error-bar').hidden`);
 failClear=true;await js(`document.querySelector('[data-provider-clear=grok]').click()`);
 await until(`!document.getElementById('ui-error-bar').hidden && !document.querySelector('[data-provider-clear=grok]').disabled`);
 assert.equal(await js(`document.getElementById('settings-grok-token-hint').textContent`),'','provider clear failure has one error surface');
 for(const locale of ['en-US','zh-CN']){
  await js(`notchAPI.setLanguage('${locale}')`);await until(`document.documentElement.lang==='${locale}'`);
  assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('providers.tokenSaveFailed')`),true,'clear failures must not claim that login expired');
  assert.equal(await js(`document.querySelector('#ui-error-details pre').textContent.includes('provider_token_clear_failed')`),true);
 }
 failClear=false;await js(`document.querySelector('[data-provider-clear=grok]').click()`);
 await until(`!document.querySelector('[data-provider-clear=grok]').disabled && document.getElementById('ui-error-bar').hidden`);
 failPair=true;await js(`document.getElementById('settings-nas-sync-base-url').value='https://nas.example.invalid';document.getElementById('settings-nas-pair-code').value='123456';document.getElementById('settings-nas-pair-submit').click()`);
 await until(`!document.getElementById('ui-error-bar').hidden && document.querySelector('#ui-error-details pre').textContent.includes('NAS:')`);
 assert.equal(await js(`document.getElementById('settings-nas-sync-hint').textContent`),'','NAS pair failure has one error surface');
 await js(`NotchUi.clearError('token:cursor')`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'an unrelated success cannot clear a NAS failure');
 failPair=false;
 for(const locale of ['en-US','zh-CN']){
  nasPairError='token_store_failed';
  await js(`notchAPI.setLanguage('${locale}')`);await until(`document.documentElement.lang==='${locale}'`);
  await js(`document.getElementById('settings-nas-pair-submit').click()`);
  await until(`!document.getElementById('settings-nas-pair-submit').disabled && !document.getElementById('ui-error-bar').hidden`);
  assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('copy.pairingFailed.aea73b')`),true,'NAS token errors must not claim an AI login has expired');
  assert.equal(await js(`document.querySelector('#ui-error-bar small').textContent===PomeI18n.t('ui.error.nasRepair')`),true);
  assert.match(await js(`document.querySelector('#ui-error-details pre').textContent`),/token_store_failed/);
  await capture('nas-pair-domain-'+locale);
 }
 nasPairError='';
 await js(`document.querySelectorAll('#ui-error-bar button')[2].click();setActiveTab('home')`);
 await js(`setActiveTab('settings')`);await sleep(150);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'repainting NAS status cannot reopen a dismissed pair failure');
 await js(`NotchUi.showError({diagnostic:'ECONNREFUSED https://user:pass@nas.local/pome?token=secret Bearer private-value',onRepair:()=>{window.fixtureRepaired=true}})`);
 assert.doesNotMatch(await js(`document.querySelector('#ui-error-bar p').textContent`),/ECONN|Bearer/);
 await js(`document.querySelector('#ui-error-bar button').click()`);assert.equal(await js('window.fixtureRepaired'),true);
 await js(`document.querySelectorAll('#ui-error-bar button')[1].click()`);await until(`document.querySelectorAll('#ui-error-bar button')[1].textContent==='已复制'`);
 assert.doesNotMatch(await js(`document.querySelector('#ui-error-details pre').textContent`),/secret|private-value|user:pass/);await capture('error-bar');
 // Expanded diagnostics occupy their own region; controls can be scrolled into view above it.
 await js(`document.getElementById('ui-error-details').open=true`);
 for(const selector of ['[data-settings-home-module=music]','[data-settings-home-module=pomodoro]']){
  const accessible=await js(`(async()=>{const input=document.querySelector(${JSON.stringify(selector)}),control=input.closest('label')||input;control.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=control.getBoundingClientRect(),bar=document.getElementById('ui-error-bar').getBoundingClientRect(),panels=document.getElementById('panels').getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return {separate:panels.bottom<=bar.top+1,reachable:hit===control||control.contains(hit),visible:b.top>=panels.top-1&&b.bottom<=panels.bottom+1};})()`);
  assert.equal(accessible.separate,true);assert.equal(accessible.reachable,true,selector);assert.equal(accessible.visible,true,selector);
 }
 await capture('error-controls-accessible');
 await js(`document.getElementById('ui-error-details').open=false`);
 await js(`document.querySelectorAll('#ui-error-bar button')[2].click()`);
 await js('setMode(false)');await until('!modeBusy');await js('setMode(true)');await until('!modeBusy');
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'dismissed errors stay dismissed');
 // Only the short summary appears before choosing details; cancel is inert.
 await js(`window.fixtureConfirmed='pending';NotchUi.confirm({title:'替换 NAS 数据？',message:'将使用本机资料替换 NAS，现有资料会先备份。',detail:'新增 2 项，修改 1 项，删除 3 项。'}).then(v=>window.fixtureConfirmed=v);void 0`);
 assert.equal(await js(`document.getElementById('ui-data-confirm-details').open`),false);await capture('confirmation');
 await js(`document.getElementById('ui-data-confirm-details').open=true`);await capture('confirmation-details');
 await js(`document.querySelector('#ui-data-confirm button').click()`);assert.equal(await js('window.fixtureConfirmed'),false);
 // Short failure messages remain transient in either language; persistence is explicit.
 for(const message of ['无法打开摄像头','Couldn’t open the camera','invalid deadline']){
  await js(`showStatusToast(${JSON.stringify(message)},{duration:180})`);
  assert.equal(await js(`document.getElementById('ui-error-bar').hidden && !document.getElementById('status-toast').hidden`),true);
  await until(`document.getElementById('status-toast').hidden`);
 }
 await js(`showStatusToast('fixture failure',{kind:'error',scope:'fixture:operation',onRepair:()=>{window.fixtureToastRepaired=true}})`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false);
 await js(`document.querySelector('#ui-error-bar button').click()`);assert.equal(await js('fixtureToastRepaired'),true);
 await js(`NotchUi.clearError('fixture:operation');showStatusToast('无法打开摄像头',{kind:'error',duration:200,onAction:()=>{window.fixturePrivacyOpened=true},actionLabel:'打开隐私设置'})`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true);
 await js(`document.getElementById('status-toast-action').click()`);assert.equal(await js('fixturePrivacyOpened'),true);
 // Trigger the actual mirror click, with a failed media request and no real camera use.
 cameraFailure=true;await js(`setActiveTab('home');fixtureHome();window.fixtureGetUserMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new Error('fixture_camera_unavailable')};document.getElementById('mirror-stage').click()`);
 await until(`!mirrorStarting && !document.getElementById('status-toast').hidden`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden && mirrorStream===null`),true);
 await capture('camera-transient-toast');
 await until(`document.getElementById('status-toast').hidden`);
 await js(`navigator.mediaDevices.getUserMedia=fixtureGetUserMedia;setActiveTab('settings')`);cameraFailure=false;
 // An explicit title wins over diagnostic words such as auth/401.
 await js(`NotchUi.showError({diagnostic:'401 Codex auth',messageKey:'copy.couldnTReadCodexSignInRetry.5e8c59',scope:'token:codex'})`);
 assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('copy.couldnTReadCodexSignInRetry.5e8c59')`),true);
 await js(`NotchUi.clearError('token:codex')`);
 async function layoutFailure(){
  await js(`fixtureHome();setActiveTab('settings')`);
  await js(`(()=>{const validate=NotchDomain.validateHomeWidgetLayout;NotchDomain.validateHomeWidgetLayout=()=>false;try{const input=document.querySelector('[data-settings-home-module=sun]');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}finally{NotchDomain.validateHomeWidgetLayout=validate;}})()`);
  await until(`!document.getElementById('ui-error-bar').hidden`);
  assert.equal(await js(`NotchHome.getVisibility().visibleIds.includes('sun')`),true,'failed changes must keep the original layout');
  assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('copy.newLayoutVerificationFailedOriginalLayoutPreserved.dedc5e')`),true);
  assert.equal(await js(`document.querySelector('#ui-error-bar small').textContent===PomeI18n.t('ui.error.layoutRepair')`),true);
 }
 await layoutFailure();await capture('layout-failure');
 await js(`setActiveTab('home')`);
 await js(`document.querySelector('#ui-error-bar button').click()`);
 await until(`activeTab==='settings' && !tabBusy`);
 assert.equal(await js(`document.getElementById('settings-home-module-list').checkVisibility()`),true,'layout repair returns to the surviving widget switches');
 const unchanged=await js(`NotchHome.setModuleVisible('sun',true)`);assert.equal(unchanged.changed,false);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'no-op changes do not clear a failure');
 await js(`setActiveTab('home');document.getElementById('home-layout-edit').click();document.getElementById('home-layout-cancel').click()`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'cancel does not clear a failure');
 await js(`document.getElementById('home-layout-edit').click();document.getElementById('home-layout-save').click()`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'saving an unchanged edit does not clear a failure');
 // Failed saves preserve the edit and cancel snapshot, and a later save can retry.
 await js(`NotchUi.clearError();fixtureHome();setActiveTab('home')`);
 const beforeEdit=await js(`localStorage.getItem(HOME_SIZES_KEY)`);
 await js(`document.getElementById('home-layout-edit').click();document.getElementById('home-cursor').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200}));document.querySelector('[data-home-ctx-size=mini]').click()`);
 const editedSize=await js(`homeSizes.cursor`);
 assert.equal(editedSize,'mini');
 for(const key of ['HOME_ORDER_KEY','HOME_SIZES_KEY','HOME_PLACEMENTS_KEY']) {
  await js(`(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===${key})throw new Error('fixture_storage_full');return write.call(this,k,v)};try{document.getElementById('home-layout-save').click()}finally{Storage.prototype.setItem=write}})()`);
  assert.equal(await js(`homeBento.dataset.layoutEditing`),'true','failed '+key+' save stays editable');
  assert.equal(await js(`document.querySelector('#ui-error-bar p').textContent===PomeI18n.t('ui.error.layoutSave')`),true);
  assert.equal(await js(`document.querySelector('#ui-error-bar small').textContent===PomeI18n.t('ui.error.layoutSaveRepair')`),true);
  assert.equal(await js(`document.getElementById('status-toast').getAttribute('aria-hidden')`),'true','a failed save dismisses the previous transient toast');
  await until(`document.getElementById('status-toast').hidden`);
 }
 await capture('layout-save-failed-retained');
 await js(`setActiveTab('settings')`);
 await js(`document.querySelector('#ui-error-bar button').click()`);
 await until(`document.activeElement.id==='home-layout-save' && document.getElementById('tab-home').classList.contains('active')`);
 assert.equal(await js(`homeBento.dataset.layoutEditing`),'true','repair returns to the saved edit from another page');
 await js(`document.getElementById('home-layout-cancel').click()`);
 assert.equal(await js(`homeBento.dataset.layoutEditing`),'false');
 assert.equal(await js(`localStorage.getItem(HOME_SIZES_KEY)`),beforeEdit,'cancel after failed writes restores the original snapshot');
 await js(`document.getElementById('home-layout-edit').click();document.getElementById('home-cursor').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200}));document.querySelector('[data-home-ctx-size=mini]').click()`);
 await js(`(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('fixture_storage_full')};try{document.getElementById('home-layout-save').click()}finally{Storage.prototype.setItem=write}})()`);
 assert.equal(await js(`homeBento.dataset.layoutEditing`),'true');
 await js(`document.getElementById('home-layout-save').click()`);
 assert.equal(await js(`homeBento.dataset.layoutEditing`),'false','retry exits only after a successful save');
 assert.equal(await js(`JSON.parse(localStorage.getItem(HOME_SIZES_KEY)).cursor`),editedSize);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'successful retry clears its own error');
 await capture('layout-save-retry-succeeded');
 // A storage failure also resolves on retry when the user made no layout change.
 await js(`document.getElementById('home-layout-edit').click();(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('fixture_storage_full')};try{document.getElementById('home-layout-save').click()}finally{Storage.prototype.setItem=write}})()`);
 assert.equal(await js(`homeBento.dataset.layoutEditing`),'true');
 await js(`document.getElementById('home-layout-save').click()`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden && homeBento.dataset.layoutEditing==='false'`),true,'an unchanged retry clears its own storage failure');
 await layoutFailure();
 // Failed visibility persistence must not claim recovery.
 const unsaved=await js(`(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===HOME_HIDDEN_MODULES_KEY)throw new Error('fixture_storage_full');return write.call(this,key,value);};try{return NotchHome.setModuleVisible('sun',false);}finally{Storage.prototype.setItem=write;}})()`);
 assert.equal(unsaved.persisted,false);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'an unsaved visibility change does not clear a failure');
 await layoutFailure();
 await js(`const fixtureToggle=document.querySelector('[data-settings-home-module=sun]');fixtureToggle.checked=false;fixtureToggle.dispatchEvent(new Event('change',{bubbles:true}));`);
 await until(`document.getElementById('ui-error-bar').hidden && !NotchHome.getVisibility().visibleIds.includes('sun')`);
 await capture('layout-visibility-recovered');
 await layoutFailure();assert.equal((await js(`NotchHome.setModuleVisible('sun',false)`)).persisted,true);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'a saved visibility change clears a failure');
 // Saved resize also recovers, but preserves a failure belonging to another scope.
 await layoutFailure();await js(`setActiveTab('home')`);
 await js(`document.getElementById('home-cursor').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200}));document.querySelector('[data-home-ctx-size=mini]').click()`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),true,'saved resize clears a failure');
 await js(`NotchUi.showError({diagnostic:'Codex: fixture_failure',scope:'token:codex'});NotchHome.setModuleVisible('sun',false)`);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden`),false,'layout success cannot clear credential failures');
 await js(`NotchUi.clearError('token:codex')`);
 // Both space constraints are transient and preserve the current layout.
 const sizeFailure=await js(`(()=>{const before=JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes}),resolve=resolveValidatedHomeLayout;resolveValidatedHomeLayout=()=>null;try{document.getElementById('home-cursor').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:200}));document.querySelector('[data-home-ctx-size=mini]').click();return before===JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes});}finally{resolveValidatedHomeLayout=resolve;}})()`);
 assert.equal(sizeFailure,true);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden && !document.getElementById('status-toast').hidden`),true);
 await capture('layout-size-space-toast');await until(`document.getElementById('status-toast').hidden`);
 const swapFailure=await js(`(()=>{document.getElementById('home-layout-edit').click();const before=JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes,order:homeOrder}),swap=NotchDomain.swapHomeWidgetPlacements;NotchDomain.swapHomeWidgetPlacements=()=>null;try{const a=document.getElementById('home-cursor').getBoundingClientRect(),b=document.getElementById('home-recorder').getBoundingClientRect(),pointer={bubbles:true,cancelable:true,isPrimary:true,pointerId:1,button:0,buttons:1};document.getElementById('home-cursor').dispatchEvent(new PointerEvent('pointerdown',{...pointer,clientX:a.left+8,clientY:a.top+8}));homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,clientX:b.left+b.width/2,clientY:b.top+b.height/2}));homeBento.dispatchEvent(new PointerEvent('pointerup',{...pointer,clientX:b.left+b.width/2,clientY:b.top+b.height/2,buttons:0}));return before===JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes,order:homeOrder});}finally{NotchDomain.swapHomeWidgetPlacements=swap;}})()`);
 assert.equal(swapFailure,true);
 assert.equal(await js(`document.getElementById('ui-error-bar').hidden && document.getElementById('status-toast-message').textContent===PomeI18n.t('copy.notEnoughSpaceToSwap.94e606')`),true);
 await capture('layout-swap-space-toast');await until(`document.getElementById('status-toast').hidden`);
 await js(`document.getElementById('home-layout-cancel').click();setActiveTab('settings')`);
 // Independent switches retain validation, recording protection and the current layout.
 assert.equal(await js(`typeof NotchHome.applyPreset`),'undefined');
 assert.equal(await js(`document.querySelector('#ui-home-presets,[data-preset]')`),null);
 await js(`fixtureHome()`);
 const guarded=await js(`(()=>{const original=NotchWorkspace.isRecordingActive,before=JSON.stringify(NotchHome.getVisibility());NotchWorkspace.isRecordingActive=()=>true;try{return {result:NotchHome.setModuleVisible('recorder',false),unchanged:before===JSON.stringify(NotchHome.getVisibility())}}finally{NotchWorkspace.isRecordingActive=original}})()`);
 assert.equal(guarded.result.error,'recording_active');assert.equal(guarded.unchanged,true);
 for(const locale of ['zh-CN','en-US']) {
  const savedLayout=await js(`JSON.stringify(homeWorkingLayout)`);
  await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'))`);
  assert.equal(await js(`document.querySelector('#ui-home-presets,[data-preset]')`),null,'language changes cannot recreate presets');
  assert.equal(await js(`JSON.stringify(homeWorkingLayout)`),savedLayout,'settings repaint preserves the saved layout');
 }
 await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'));document.getElementById('settings-home-module-list').scrollIntoView({block:'center'})`);
 await capture('home-modules-no-presets');
 const moduleBounds=await js(`(()=>{const grid=document.getElementById('settings-home-module-list'),r=grid.getBoundingClientRect(),heading=grid.previousElementSibling.getBoundingClientRect();return {x:r.x,y:heading.y,width:r.width,height:r.bottom-heading.y,dpr:devicePixelRatio}})()`);
 fs.writeFileSync(path.join(output,'home-modules-no-presets-crop.png'),(await c.capturePage()).crop({x:Math.round(moduleBounds.x*moduleBounds.dpr),y:Math.round(moduleBounds.y*moduleBounds.dpr),width:Math.round(moduleBounds.width*moduleBounds.dpr),height:Math.round(moduleBounds.height*moduleBounds.dpr)}).toPNG());
 await js(`setActiveTab('home')`);
 const reachable=await js(`(()=>{const tile=document.querySelector('.home-note'),box=tile.getBoundingClientRect();return [...tile.querySelectorAll('.note-toolbar button')].filter(e=>e.checkVisibility()).every(e=>{const r=e.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right+1})})()`);
 assert.equal(reachable,true,'quick-note mode and save controls fit compact tiles');
 assert.equal(await js(`document.getElementById('ui-open-notes')`),null,'the quick note has no library shortcut');
 await js(`document.getElementById('home-note').value='# 保存验证';document.getElementById('home-note').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('note-save-btn').click()`);
 assert.equal(await js(`activeTab`),'home','saving a quick note stays on Home');
 await capture('home-note-without-open');
 const noteBounds=await js(`(()=>{const r=document.querySelector('.home-note').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,dpr:devicePixelRatio}})()`);
 fs.writeFileSync(path.join(output,'home-note-without-open-crop.png'),(await c.capturePage()).crop({x:Math.round(noteBounds.x*noteBounds.dpr),y:Math.round(noteBounds.y*noteBounds.dpr),width:Math.round(noteBounds.width*noteBounds.dpr),height:Math.round(noteBounds.height*noteBounds.dpr)}).toPNG());
 await js(`document.getElementById('tab-button-notes').click()`);await until(`activeTab==='notes'`);
 assert.match(await js(`document.getElementById('notes-editor').value`),/保存验证/);
 await js(`notchAPI.setFeature('notes',false)`);await until(`document.getElementById('tab-button-notes').hidden`);
 await js(`notchAPI.setFeature('notes',true);setActiveTab('home')`);await until(`!document.getElementById('tab-button-notes').hidden`);
 assert.equal(await js(`document.getElementById('ui-open-notes')`),null,'reenabling Notes does not recreate the removed button');
 await js(`document.getElementById('ui-open-recordings').click()`);await until(`activeTab==='recordings'`);
 await js(`notchAPI.setFeature('recordings',false)`);await until(`document.getElementById('tab-button-recordings').hidden`);assert.equal(await js(`document.getElementById('ui-open-recordings').hidden`),true);await js(`notchAPI.setFeature('recordings',true);setActiveTab('home')`);
 // A second renderer simulates Windows capability branches without enabling native code on this Mac.
 const win=new BrowserWindow({width:1240,height:638,show:false,frame:false,webPreferences:{backgroundThrottling:false}});
 await win.loadFile(path.join(__dirname,'../renderer/index.html'));
 const wjs=code=>win.webContents.executeJavaScript(code);
 await wjs(`window.fixtureNative=false;window.notchAPI={capabilities:{platform:'win32',features:{winNativeSetting:true}},listWindows:async()=>fixtureNative?{items:[{id:'fixture-window',title:'Cursor',appName:'Cursor'}]}:{items:[],error:'native_unavailable'},setWinNative:async()=>{fixtureNative=true;return {ok:true,nativeAvailable:true,winNative:true}}};void 0`);
 await wjs(`window.fixtureHome=${seedHomeFixture.toString()};void 0`);
 await wjs('setMode(true)');await wjs("fixtureHome();NotchWorkspace.refreshWindows(true)");
 await wjs('document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,700)))');
 for(let i=0;i<200&&!await wjs(`!!document.getElementById('ui-enable-win-native')`);i++)await sleep(20);
 assert.equal(await wjs(`!!document.getElementById('ui-enable-win-native')`),true);
 fs.writeFileSync(path.join(output,'windows-inline-off.png'),(await win.webContents.capturePage()).toPNG());
 await wjs(`document.getElementById('ui-enable-win-native').click()`);
 for(let i=0;i<200&&!await wjs(`!!document.querySelector('.window-item')`);i++)await sleep(20);
 assert.equal(await wjs(`!!document.querySelector('.window-item')`),true);
 await wjs('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 fs.writeFileSync(path.join(output,'windows-inline-on.png'),(await win.webContents.capturePage()).toPNG());
 await wjs(`fixtureNative=false;notchAPI.setWinNative=async()=>({ok:true,nativeAvailable:false,nativeReason:'forced_disabled'});NotchWorkspace.refreshWindows(true)`);
 await wjs(`document.getElementById('ui-enable-win-native').click();new Promise(r=>setTimeout(r,100))`);
 assert.equal(await wjs(`!document.getElementById('ui-error-bar').hidden && !document.getElementById('ui-enable-win-native').disabled`),true);
 fs.writeFileSync(path.join(output,'windows-inline-failed.png'),(await win.webContents.capturePage()).toPNG());
 win.destroy();
 fs.writeFileSync(path.join(output,'saved-visible.json'),JSON.stringify(await js('NotchHome.getVisibility().visibleIds')));
 assert.deepEqual(errors,[]);
}
require('../main.js');
