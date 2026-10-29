'use strict';
// Isolated production UI: long links, all scrollbar directions, task cards and
// real pointer/keyboard filter actions. Never reads a real workspace or account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'pome-visual-'));
process.env.TODO_TEST_USER_DATA = profile;
process.env.POME_HOOK_TEST_HOME = path.join(profile, 'hook-home');
process.env.POME_TEST_LANGUAGE = 'zh-CN';
fs.mkdirSync(process.env.POME_HOOK_TEST_HOME, { recursive: true });
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
require('../codex-usage-remote').createCodexUsageService = () => ({ tokenState: () => ({}), getUsage: async () => ({ok:true,detected:false}), reset() {} });
clipboard.read = async () => []; clipboard.write = async () => {}; clipboard.writeText = async () => {}; clipboard.clear = () => {};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => handle(channel, (event, ...args) => {
  if (channel === 'windows:list') return { items: [], error: null };
  if (channel === 'credentials:list') return { ok: true, secureStorage: true, items: [{id:'sample',service:'Pome sample account',account:'sample@example.invalid',passwordMask:'••••••'}] };
  return fn(event, ...args);
});
const output = process.env.POME_VISUAL_SHOTS || path.join(__dirname, '../dist.noindex/visual-consistency');
fs.mkdirSync(output, {recursive:true});
let started = false;
const timer = setTimeout(() => { console.error('Visual consistency timed out'); app.exit(1); }, 90000);
app.on('web-contents-created', (_, c) => c.once('did-finish-load', () => {
  if (started || !c.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(c).then(() => { clearTimeout(timer); console.log('Visual consistency: global scrollbars, unclipped links, solid surfaces, separate tasks and animated filters passed'); app.exit(0); }).catch(async error => {
    console.error(error); fs.writeFileSync(path.join(output, 'failure.png'), (await c.capturePage()).toPNG()); app.exit(1);
  });
}));
async function run(c) {
  const js = code => c.executeJavaScript(code, true), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const win = BrowserWindow.fromWebContents(c), checks = [];
  async function until(code) { for (let i=0;i<250;i++) { if(await js(code).catch(()=>false))return; await sleep(20); } throw Error('Timeout '+code); }
  async function click(selector, wait = 40) {
    const point = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,hit:h===e||e.contains(h)}})()`);
    assert(point.hit, selector+' receives input');
    for (const type of ['mouseMove','mouseDown','mouseUp']) c.sendInputEvent({type,x:Math.round(point.x),y:Math.round(point.y),...(type==='mouseMove'?{}:{button:'left',clickCount:1})});
    if(wait)await sleep(wait);
  }
  async function tab(id) { await click('#tab-button-'+id); await until(`activeTab==='${id}'&&!tabBusy`); await js(`Promise.all(document.getElementById('tab-${id}').getAnimations().map(a=>a.finished.catch(()=>{})))`); }
  async function shot(name) { await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG()); }
  await until('!!window.PomeExperience&&!workspaceReloadPending');
  win.removeAllListeners('blur'); win.show(); win.focus();
  c.debugger.attach('1.3');
  await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await js(`setMode(true)`); await until('!modeBusy');
  await js(`document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);notchAPI.setFeature('clip',true)`);
  assert.equal(await js('document.querySelectorAll(".home-experience-toolbar").length'),0,'Home has no permanent layout toolbar');
  await js(`(()=>{
    const now=Date.now();for(const p of PRIORITIES)data[p]=Array.from({length:p==='P0'?20:3},(_,i)=>({id:p+'-'+i,text:i===0?'分块待办 · Long task content stays inside its own card':'独立任务 '+i,done:false,createdAt:now,deadline:new Date(now+86400000).toISOString()}));saveData(data);renderTodoBoard();
    document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection',{detail:{
      links:Array.from({length:2},(_,g)=>({id:'group-'+g,name:g?'Reference material · 项目资料':'其他',links:Array.from({length:25},(_,i)=>({id:'link-'+g+'-'+i,title:'A long reference title · 链接完整背景与右侧操作 '+i,url:'https://example.invalid/reference/'+i,createdAt:now}))})),
      clipboard:{history:[{id:'text-a',type:'text',text:'First sample',timestamp:now},{id:'text-b',type:'text',text:'Second sample',timestamp:now},{id:'image-a',type:'image',imagePath:'clipboard-images/sample.png',timestamp:now}],favorites:['text-a']}
    }}));
  })()`);
  const bounds=win.getBounds(); win.setMinimumSize(600,400);
  for (const width of [1240,740]) {
    win.setContentSize(width,638); await sleep(100); await tab('links');
    const hover=await js(`(()=>{const r=document.querySelector('.link-item').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    c.sendInputEvent({type:'mouseMove',x:Math.round(hover.x),y:Math.round(hover.y)});
    await sleep(100);
    const rows=await js(`(()=>{const l=document.querySelector('.link-list');return [...l.children].map(e=>{const r=e.getBoundingClientRect(),p=l.getBoundingClientRect();return {right:r.right,parentRight:p.right,overflow:e.scrollWidth>e.clientWidth+1,transform:getComputedStyle(e).transform}})})()`);
    assert(rows.every(r=>r.right<=r.parentRight-2&&!r.overflow&&(r.transform==='none'||r.transform==='matrix(1, 0, 0, 1, 0, 0)')),width+'px link cards and actions fit without horizontal clipping: '+JSON.stringify(rows[0]));
    assert.equal(await js(`document.querySelector('.link-list').scrollWidth<=document.querySelector('.link-list').clientWidth+1`),true);
    await shot('links-'+width);
    c.sendInputEvent({type:'mouseMove',x:10,y:10}); await sleep(30);
    const scroll=await js(`(()=>{const names=['.link-list','.link-groups','.window-list','.notes-list','.recording-list','.credential-list','.settings-column-primary','.todo-list'];return names.map(s=>{const e=document.querySelector(s),bar=getComputedStyle(e,'::-webkit-scrollbar');return {selector:s,width:bar.width,height:bar.height,thumb:getComputedStyle(e,'::-webkit-scrollbar-thumb').backgroundColor,standard:getComputedStyle(e).scrollbarWidth}})})()`);
    // A hovered scroll container can expose its hover thumb color even when
    // querying the pseudo element. Compare all states to the shared palette.
    const palette=await js(`(()=>{const e=document.createElement('div');e.style.cssText='position:fixed;visibility:hidden';document.body.append(e);try{return ['--scrollbar-thumb','--scrollbar-thumb-hover','--scrollbar-thumb-active'].map(v=>{e.style.backgroundColor='var('+v+')';return getComputedStyle(e).backgroundColor})}finally{e.remove()}})()`);
    assert(scroll.every(s=>s.width==='4px'&&s.height==='4px'&&palette.includes(s.thumb)&&s.standard==='auto'),JSON.stringify(scroll));
    checks.push({width,scrollbars:scroll});
  }
  win.setBounds(bounds); await tab('todo');
  const header=await js(`(()=>{const e=document.querySelector('.todo-page-heading'),h=e.querySelector('.experience-hint'),a=e.querySelector('#todo-add-category'),s=e.querySelector('#todo-board-summary');return {duplicate:e.querySelectorAll('h2').length,oneRow:Math.abs(h.getBoundingClientRect().top+h.offsetHeight/2-a.getBoundingClientRect().top-a.offsetHeight/2)<2,clipped:h.scrollWidth>h.clientWidth,title:h.title,summary:s.textContent}})()`);
  assert.equal(header.duplicate,0);assert(header.oneRow&&header.title&&header.summary,'todo summary, help and add action share one row');
  const task=await js(`(()=>{const q=document.querySelector('.quadrant'),e=q.querySelector('.todo-item');return {quadrant:getComputedStyle(q).backgroundColor,row:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderTopWidth,gap:parseFloat(getComputedStyle(document.querySelector('#todo-sections')).gap)}})()`);
  assert(task.quadrant==='rgb(26, 26, 29)'&&task.row!=='rgba(0, 0, 0, 0)'&&task.border==='1px'&&task.gap>=10,JSON.stringify(task));
  await shot('todo-cards');
  for(const [id,selector] of [['links','.link-group'],['recordings','.recording-detail'],['credentials','.credentials-library'],['settings','.settings-card']]) {
    await tab(id); assert.equal(await js(`getComputedStyle(document.querySelector('#tab-${id} ${selector}')).backgroundColor`),'rgb(26, 26, 29)',id+' has a solid reading background'); await shot(id+'-solid');
  }
  await tab('clip');
  for(const [filter,count] of [['text',2],['image',1],['faved',1],['all',3]]) {
    await click('.clip-filter[data-filter="'+filter+'"]',0);
    await until(`clipFilter==='${filter}'`);
    const state=await js(`({count:document.querySelectorAll('.clip-item').length,motion:document.querySelector('.clip-filter-indicator').getAnimations().some(a=>a.playState==='running'),content:document.querySelector('#clip-list').getAnimations().some(a=>a.playState==='running')})`);
    assert.equal(state.count,count); assert(state.motion&&state.content,filter+' animates both the selection and results');
    if(filter==='image')await shot('clipboard-filter-motion'); await sleep(230);
  }
  await click('.clip-filter[data-filter="text"]',0);await click('.clip-filter[data-filter="image"]',0);await click('.clip-filter[data-filter="faved"]',0);await sleep(250);
  assert.equal(await js(`document.querySelector('.clip-filter-indicator').getAnimations().filter(a=>a.playState==='running').length`),0,'rapid filter changes leave no stale animations');
  const before=await js('JSON.stringify({history:clipHistory,favorites:clipFavorites})');
  await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click('.clip-filter[data-filter="all"]',0);await until(`clipFilter==='all'`);
  assert.equal(await js(`document.querySelector('.clip-filter-indicator').getAnimations().some(a=>a.playState==='running')||document.querySelector('#clip-list').getAnimations().some(a=>a.playState==='running')`),false,'reduced motion changes results without movement');
  assert.equal(await js('JSON.stringify({history:clipHistory,favorites:clipFavorites})'),before,'filtering and motion never modify clipboard content');
  await shot('clipboard-reduced-motion');
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,task,filterMotion:true,reducedMotion:true,isolated:true},null,2));
}
require('../main.js');
