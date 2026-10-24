'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
const shots = process.env.POME_WEATHER_SCREENSHOTS || path.join(__dirname, '../dist.noindex/sun-weather');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
let clock = Date.parse('2026-10-24T08:30:00Z'), calls = 0, fail = false, pendingResolve = null, deferred = false;
let current = { temperature_2m: 10.7, relative_humidity_2m: 78, weather_code: 0, wind_speed_10m: 0 };
let rejectWeatherSetting=false;
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,channel==='settings:set-weather-effects'
  ? (event,...args)=>rejectWeatherSetting ? {ok:false,error:'save_failed'} : fn(event,...args) : fn);
const weather = require('../sunWeather'), create = weather.createSunWeatherService;
weather.createSunWeatherService = options => create({ ...options, now: () => clock,
  readCache: () => ({ version: 1, entries: { '7.000000,7.000000': { attemptedAt: clock - 29 * 60 * 1000,
    data: { temperature: 9.9, humidity: 78, code: 0, windSpeed: 0, updatedAt: clock - 29 * 60 * 1000 } } } }),
  fetchImpl: async () => {
  calls++;
  if (deferred) return new Promise(resolve => { pendingResolve = () => resolve(new Response(JSON.stringify({ current: { ...current } }))); });
  if (fail) throw new Error('fixture_offline');
  return new Response(JSON.stringify({ current: { ...current } }));
} });
const errors = [];
dialog.showErrorBox = (title, message) => errors.push(`${title}: ${message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Weather acceptance timed out', errors); app.exit(1); }, 110000);
let started = false;
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', detail => { if (detail.level === 'error' && !detail.message.includes('ERR_')) errors.push(detail.message); });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => { clearTimeout(watchdog); console.log('Weather: four sizes, ten locales, aged disk cache, wake-only refresh, retained failure DOM, settings, layering and all motion families passed'); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run(c) {
  fs.mkdirSync(shots, { recursive: true });
  const js = code => c.executeJavaScript(code);
  async function until(expression) {
    for (let i = 0; i < 250; i++) { if (await js(expression).catch(() => false)) return; await sleep(20); }
    const state = await js('({hidden:document.hidden,app:document.getElementById("app")?.className,home:document.getElementById("tab-home")?.className,weather:window.PomeSun?.getWeather()})').catch(() => null);
    throw new Error(`Timed out: ${expression}; ${JSON.stringify(state)}`);
  }
  const tick = async () => { clock += 30 * 60 * 1000 + 1; await js(`window.weatherClock=${clock}`); };
  async function capture(name, tileOnly = true) {
    await js('document.querySelector("#ui-capsule-hint button")?.click()');
    c.sendInputEvent({type:'mouseMove',x:1,y:1});
    await js('document.fonts.ready'); await sleep(100);
    const rect = tileOnly ? await js(`(()=>{const r=document.getElementById('home-sun').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`) : undefined;
    fs.writeFileSync(path.join(shots, name + '.png'), (await c.capturePage(rect)).toPNG());
  }
  async function size(value) {
    await js(`homeSizes.sun=${JSON.stringify(value)};homeWorkingLayout=null;applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});PomeSun.render()`);
    await js('Promise.allSettled(homeLayoutMotionAnimations.map(animation=>animation.finished))');
    await js('PomeSun.render();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  async function assertGeometry(value) {
    const result = await js(`(()=>{const t=document.getElementById('home-sun'),w=t.querySelector('.wx'),p=t.querySelector('.sun-place'),head=t.querySelector('.sun-head,.sun-mini-top');
      const a=w.getBoundingClientRect(),b=p.getBoundingClientRect(),r=t.getBoundingClientRect(),text=w.querySelector('.txt');
      return {overlap:a.right>b.left+.5,inside:a.left>=r.left&&a.right<=r.right+.5&&b.right<=r.right+.5,
        textFits:text.scrollWidth<=text.clientWidth+1,readingFits:(w.querySelector('.wx-reading')||text).getBoundingClientRect().right<=a.right-3,
        caption:!!t.querySelector('.sun-count .num'),arc:!!t.querySelector('.sun-arc'),
        contentZ:getComputedStyle(head).zIndex,canvas:t.querySelectorAll('.wx-fx').length,
        placeWidth:p.querySelector('span').clientWidth,placeOverflow:p.querySelector('span').scrollWidth>p.querySelector('span').clientWidth,
        pinOnly:getComputedStyle(p.querySelector('span')).display==='none',label:t.querySelector('.wx').textContent};})()`);
    assert.equal(result.overlap, false, JSON.stringify(result)); assert.equal(result.inside, true, JSON.stringify(result));
    assert.equal(result.textFits, true, JSON.stringify(result)); assert(result.caption && result.arc);
    assert.equal(result.readingFits,true,JSON.stringify(result));
    assert.equal(result.contentZ, '3');
    if(value!=='mini') {
      const baselines=await js(`(()=>{const nodes=document.querySelectorAll('#home-sun .wx-state,#home-sun .wx-separator,#home-sun .wx-reading');return [...nodes].map(node=>{const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';node.append(marker);const y=marker.getBoundingClientRect().top;marker.remove();return y;});})()`);
      assert(Math.max(...baselines)-Math.min(...baselines)<=.25,'weather name, separator and temperature share a baseline: '+JSON.stringify(baselines));
    }
    if (value==='mini') assert(result.pinOnly);
    if (value==='small') assert(result.placeWidth>=18,'room for a whole character and ellipsis: '+JSON.stringify(result));
    if (value==='mini'||value==='small') assert.equal(result.canvas,0);
  }
  await until('!!window.PomeSun && !!window.NotchWorkspace');
  assert.equal(calls,0,'collapsed startup never requests weather');
  // Keep this fixture visible without stealing focus from the user's panel.
  // Focus/blur collapse behavior has its own production regression suite.
  BrowserWindow.fromWebContents(c).showInactive();
  await js(`window.weatherClock=${clock};Date.now=()=>window.weatherClock;PomeSun.setPreviewNow('2026-10-24T16:30:00+08:00');
    hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='sun');homeOrder=['sun',...HOME_MODULE_REGISTRY.filter(id=>id!=='sun')];
    PomeSun.setLocation({lat:39.9042,lng:116.4074,name:'北京',source:'manual',tz:'Asia/Shanghai'},{persist:false})`);
  assert.equal(calls,0);
  await size('medium');
  await js('PomeSun.setLocation({lat:7,lng:7,name:"cached",source:"manual",tz:"Asia/Shanghai"},{persist:false});setMode(true)');
  await until('PomeSun.getWeather().data?.temperature===9.9');assert.equal(calls,0,'fresh disk cache makes no request');
  clock += 2 * 60 * 1000;await js(`window.weatherClock=${clock};document.dispatchEvent(new CustomEvent('notch:modechange',{detail:{expanded:true}}))`);
  await until('PomeSun.getWeather().data?.temperature===10.7');
  assert.equal(calls,1,'cache expires on its original timestamp, not 30 minutes after renderer startup');
  await js('PomeSun.setLocation({lat:39.9042,lng:116.4074,name:"北京",source:"manual",tz:"Asia/Shanghai"},{persist:false})');
  await js('setMode(true)');
  await until('PomeSun.getWeather().data?.temperature===10.7'); assert.equal(calls,2);
  for (const value of ['mini','small','medium','large']) {
    await size(value); await assertGeometry(value); await capture(value);
    if(value==='medium'||value==='large') assert.equal(await js('getComputedStyle(document.querySelector("#home-sun .wx .ic")).display!=="none"'),true,'a naturally short clear label must retain its icon');
    if(value==='large') assert.equal(await js('!document.querySelector("#home-sun .wx-humidity").hidden'),true,'clear weather has room for humidity on large cards');
  }
  for (const [code,name,temperature] of [[1,'乌鲁木齐'],[56,'呼和浩特',-27.7],[96,'乌鲁木齐'],[82,'呼和浩特']]) {
    current.weather_code=code; current.temperature_2m=temperature ?? 10.7; await tick();
    await js(`PomeSun.setLocation({lat:${30+code/100},lng:116,name:${JSON.stringify(name)},source:'manual',tz:'Asia/Shanghai'},{persist:false})`);
    await until(`PomeSun.getWeather().data?.code===${code}`);
    for(const value of ['mini','small']) { await size(value);await assertGeometry(value);await capture(`${value}-stress-${code}`); }
  }
  for (const id of ['en-US','de-DE','fr-FR','ru-RU','es-ES','pt-BR','ja-JP','ko-KR','zh-TW','zh-CN']) {
    await js(`notchAPI.setLanguage(${JSON.stringify(id)})`);await until(`document.documentElement.lang===${JSON.stringify(id)}`);
    current.weather_code=56;current.temperature_2m=-27.7;await tick();
    await js('document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');
    await until('PomeSun.getWeather().data?.code===56');
    for (const value of ['mini','small','medium','large']) {
      await size(value);await capture(`${value}-${id}`);await assertGeometry(value);
      if(value==='small' && id==='zh-CN') assert.equal(await js('(()=>{const n=document.querySelector("#home-sun .wx-state");return n.scrollWidth<=n.clientWidth+1})()'),true,'Chinese compact weather stays complete beside the ellipsized location');
    }
  }
  current.weather_code=82;current.temperature_2m=10.7;await tick();
  await js('document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');await until('PomeSun.getWeather().data?.code===82');
  await size('medium');
  const before=calls; await js('PomeSun.render();document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');
  await sleep(70);assert.equal(calls,before,'same half hour does not request');
  await tick(); await js('PomeSun.render()');await sleep(70);assert.equal(calls,before,'expired but continuously visible does not poll');
  fail=true;await js('window.retainedWeatherNode=document.querySelector("#home-sun .wx");document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');
  await sleep(150);assert.equal(calls,before+1);assert.equal(await js('PomeSun.getWeather().data.code'),82);
  assert.equal(await js('document.querySelector("#home-sun .wx")===window.retainedWeatherNode'),true,'silent failure preserves weather DOM');
  await js('document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');await sleep(70);assert.equal(calls,before+1);
  fail=false;
  const families=[[45,'fog'],[0,'haze','haze'],[0,'dust','dust'],[0,'sleet','sleet'],[51,'drizzle'],[61,'rain-light'],[63,'rain-mid'],[65,'rain-heavy'],[71,'snow-light'],[73,'snow-mid'],[75,'snow-heavy'],[95,'thunder'],[96,'hail']];
  for(const [code,family,condition] of families){
    current.weather_code=code;current.wind_speed_10m=0;current.condition=condition;await tick();
    await js('document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');
    await until(`PomeSun.getWeather().effects.active && PomeSun.getWeather().effects.family===${JSON.stringify(family)}`);
    const a=await js('PomeSun.getWeather().effects.time');
    await until(`PomeSun.getWeather().effects.time>${a}`);
    if([65,75,95].includes(code))await capture({65:'rain',75:'snow',95:'thunder'}[code]);
    if(condition) { assert.equal(await js('PomeSun.getWeather().data.condition'),condition);await capture(family); }
  }
  for(const [code,wind,family] of [[0,25,'wind'],[0,40,'wind-strong'],[65,30,'rain-wind']]){
    current.weather_code=code;current.wind_speed_10m=wind;await tick();await js('document.dispatchEvent(new CustomEvent("notch:modechange",{detail:{expanded:true}}))');
    await until(`PomeSun.getWeather().effects.family===${JSON.stringify(family)} && PomeSun.getWeather().effects.active`);
  }
  await js('PomeSun.render();setActiveTab("settings")');await sleep(250);
  assert.equal(await js('document.getElementById("settings-weather-effects").checked'),true);
  assert.equal(await js('document.querySelector(".settings-device-card #settings-weather-effects")!==null'),true);
  assert.equal(await js('document.querySelector(".settings-weather-attribution a").href'),'https://open-meteo.com/');
  await js('document.getElementById("settings-weather-effects").scrollIntoView({block:"center"})');await capture('settings',false);
  rejectWeatherSetting=true;
  await js('document.querySelector(".settings-weather-effects-row").click()');
  await until('!document.getElementById("settings-weather-effects").disabled && document.getElementById("settings-weather-effects").checked');
  assert.equal(await js('notchAPI.getAppSettings().then(s=>s.weatherEffects)'),true,'a failed write restores the persisted setting');
  assert.equal(await js('document.getElementById("settings-inline-note").classList.contains("error")'),true);
  await capture('settings-save-error',false);rejectWeatherSetting=false;
  await js('document.querySelector(".settings-weather-effects-row").click()');
  await until('!document.getElementById("settings-weather-effects").disabled && !document.getElementById("settings-weather-effects").checked');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'app-settings.json'))).weatherEffects,false);
  assert.equal(await js('document.getElementById("settings-inline-note").textContent'),'', 'a successful retry clears the stale failure');
  await js('setActiveTab("home")');await sleep(120);assert.equal(await js('document.querySelector("#home-sun .wx-fx")'),null);
  assert(await js('!!document.querySelector("#home-sun .wx")'));
  await js('notchAPI.setWeatherEffects(true)');await until('PomeSun.getWeather().effects.active');
  c.debugger.attach('1.3');
  await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await until('!PomeSun.getWeather().effects.active');assert.equal(await js('!!document.querySelector("#home-sun .wx-fx")'),false);
  await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await until('PomeSun.getWeather().effects.active');c.debugger.detach();
  await js('setActiveTab("notes")');await until('!PomeSun.getWeather().effects.active');
  await js('setActiveTab("home")');await until('PomeSun.getWeather().effects.active');
  await js('setMode(false)');await until('!PomeSun.getWeather().effects.active');
  const closedCalls=calls;await tick();await sleep(100);assert.equal(calls,closedCalls);
  await js('setMode(true)');await until(`PomeSun.getWeather().effects.active`);assert.equal(calls,closedCalls+1);
  await js('PomeSun.setLocation(null,{persist:false})');await sleep(60);assert.equal(await js('!!document.querySelector("#home-sun .wx")'),false);
  // A late response for another city must never overwrite the current city.
  deferred=true;
  await js('PomeSun.setLocation({lat:1,lng:1,name:"slow",source:"manual"},{persist:false})');
  for(let i=0;i<100&&!pendingResolve;i++)await sleep(10);
  const finish=pendingResolve;deferred=false;current.weather_code=71;
  await js('PomeSun.setLocation({lat:2,lng:2,name:"fast",source:"manual"},{persist:false})');
  await until('PomeSun.getWeather().data?.code===71');current.weather_code=0;finish();await sleep(100);
  assert.equal(await js('PomeSun.getWeather().data.code'),71);
  const formCalls=calls;
  await js('PomeSun.openLocation();document.querySelector("[data-sun-manual]").click();const f=document.querySelector("[data-sun-manual-form]");f.elements.lat.value="";f.elements.lng.value="";f.requestSubmit()');
  await until('!document.querySelector("[data-sun-manual-error]").hidden');
  assert.equal(await js('PomeSun.getLocation().lat'),2);assert.equal(calls,formCalls,'invalid manual input never requests weather');
  await capture('location-validation',false);await js('PomeSun.closeLocation()');
  // Isolated tests normally disable background throttling to finish startup
  // behind the real panel. Use production visibility semantics for this check.
  // Hiding also triggers the normal asynchronous blur/collapse workflow.
  c.setBackgroundThrottling(true);
  BrowserWindow.fromWebContents(c).hide();
  await until('document.hidden && !PomeSun.getWeather().effects.active');
  BrowserWindow.fromWebContents(c).show();
  await until('!document.hidden');
  assert.deepEqual(errors,[]);
}
require('../main');
