'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');
assert(process.env.TODO_TEST_USER_DATA, 'An isolated profile is required');
app.setPath('userData', process.env.TODO_TEST_USER_DATA); app.disableHardwareAcceleration();
const phase = process.env.POME_VARIANT_PHASE || 'review';
const output = process.env.POME_VARIANT_SHOTS || path.join(__dirname, '../dist.noindex/layout-variant-review');
const aiOutput = process.env.POME_VARIANT_AI_SHOTS || path.join(__dirname, '../dist.noindex/ai-usage-variant');
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(aiOutput, { recursive: true });
const now = Date.parse('2026-11-04T04:30:00Z'), future = (now + 3 * 86400000) / 1000;
const data = count => Object.fromEntries(Object.entries({
  cursor: { ok: true, detected: true, fetchedAt: new Date(now).toISOString(), auto: { percent: 28, resetsAt: future, windowMinutes: 43200 }, other: { percent: 20, resetsAt: future, windowMinutes: 43200 } },
  codex: { ok: true, detected: true, fetchedAt: new Date(now).toISOString(), primary: { percent: 15, resetsAt: future - 3600, windowMinutes: 300 }, secondary: { percent: 5, resetsAt: future, windowMinutes: 10080 } },
  grokbot: { ok: false, detected: true, error: 'fixture_unavailable' },
  claude: { ok: true, detected: true, fetchedAt: new Date(now).toISOString(), primary: { percent: 35, resetsAt: future, windowMinutes: 300 }, secondary: { percent: 20, resetsAt: future, windowMinutes: 10080 } },
  antigravity: {ok:true,detected:true,fetchedAt:new Date(now).toISOString(),windows:[{id:'primary',label:'Gemini',percent:40,windowMinutes:300,resetsAt:future}]},
  copilot: {ok:true,detected:true,configured:true,fetchedAt:new Date(now).toISOString(),windows:[{id:'premium',percent:25,resetsAt:future}]},
}).slice(0, count));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => { console.error('Layout variant review timed out'); app.exit(1); }, 100000);
async function main() {
  console.log('Review: waiting for Electron');
  await app.whenReady();
  console.log('Review: creating window');
  const win = new BrowserWindow({ width: 1040, height: 650, show: false, frame: false, webPreferences: { sandbox: false, preload: path.join(__dirname, 'home-layout-variant.preload.js'), backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code), errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error('Renderer:', event.message); } });
  win.webContents.on('render-process-gone', (_event, details) => { console.error('Renderer exited:', details); app.exit(1); });
  console.log('Review: loading renderer');
  await win.loadFile(path.join(__dirname, '../renderer/index.html')); win.show(); win.focus();
  console.log('Review: renderer loaded');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await win.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}');
  async function until(expr) { for (let i = 0; i < 200; i++) { if (await js(expr)) return; await sleep(20); } throw Error('Timeout: ' + expr); }
  const settle = () => js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  await until('!!window.PomeAlmanac && !!window.PomeSun && !!window.NotchTaskInbox && !!window.NotchAiUsage');
  console.log('Review: widgets ready');
  await js(`Date.now=()=>${now};setMode(true);document.getElementById('ui-capsule-hint').hidden=true;
    PomeAlmanac.setPreviewDate('2026-11-04T12:30:00+08:00');PomeSun.setLocation({source:'manual',name:'上海',lat:31.23,lng:121.47,tz:'Asia/Shanghai'},{persist:false});PomeSun.setPreviewNow('2026-11-04T12:30:00+08:00');
    document.querySelectorAll('.home-bento>[data-home-module]').forEach(node=>node.style.visibility='hidden');`);
  await sleep(400);
  await js(`document.querySelector('#ui-capsule-hint button')?.click();localStorage.setItem('pome-capsule-hints-v1','2');document.getElementById('ui-capsule-hint').hidden=true;
    const mat=document.createElement('div');Object.assign(mat.style,{position:'fixed',inset:'0',background:'var(--bg-base)',zIndex:'1',pointerEvents:'none'});document.getElementById('home-bento').append(mat)`);
  const metrics = {};
  async function supply(count, overrides = {}) {
    await js(`notchAPI.fixtureUsage(${JSON.stringify({ ...data(count), ...overrides })});NotchAiUsage.refresh({force:true})`); await settle();
  }
  async function place(id, size, variant, width, height) {
    await js(`document.querySelectorAll('.home-bento>[data-home-module]').forEach(node=>node.style.visibility='hidden');
      {const node=document.getElementById('home-${id}');node.hidden=false;node.dataset.widgetSize='${size}';
      ${variant ? `node.dataset.layoutVariant='${variant}'` : 'delete node.dataset.layoutVariant'};
      Object.assign(node.style,{position:'fixed',left:'24px',top:'24px',width:'${width}px',height:'${height}px',visibility:'visible',transform:'none',zIndex:'2'});}`);
    await settle(); await sleep(70);
  }
  async function shot(id, name, dir = output) {
    win.webContents.sendInputEvent({type:'mouseMove',x:1010,y:620}); await settle();
    const box = await js(`(()=>{const r=document.getElementById('home-${id}').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage(box)).toPNG());
    metrics[name] = await js(`(()=>{const root=document.getElementById('home-${id}'),box=root.getBoundingClientRect();return {size:root.dataset.widgetSize,variant:root.dataset.layoutVariant||'',width:box.width,height:box.height,overflow:root.scrollWidth>root.clientWidth+1||root.scrollHeight>root.clientHeight+1,
      geometry:[...root.querySelectorAll('${id === 'cursor' ? '.ai-usage-source,.q-ring,.q-compact-caption,.q-icon' : id === 'almanac' ? '.almanac-daynum,.almanac-row,.almanac-meta-grid' : id === 'sun' ? '.sun-head,.sun-hero,.sun-arc-wrap,.sun-times,.sun-next-list,.sun-stats' : '.home-inbox-head,.home-inbox-row,.home-inbox-footer'}')].filter(n=>n.checkVisibility({checkVisibilityCSS:true})).map(n=>{const r=n.getBoundingClientRect(),style=getComputedStyle(n);return {node:n.className,x:r.x-box.x,y:r.y-box.y,w:r.width,h:r.height,font:style.fontSize,text:n.textContent.trim()}})};})()`);
    if(id==='inbox'&&name.includes('unstretched')){
      metrics[name].dom=await js(`document.getElementById('home-inbox').innerHTML`);
      metrics[name].styles=await js(`(()=>{const root=document.getElementById('home-inbox');return [root,...root.querySelectorAll('*')].map(node=>{const style=getComputedStyle(node);return Object.fromEntries(['backgroundColor','backgroundImage','backdropFilter','boxShadow','filter','opacity','mixBlendMode','isolation','maskImage','color','font','lineHeight','display','visibility','borderColor','borderRadius','overflow','transform'].map(key=>[key,style[key]]))})})()`);
    }
  }
  await supply(3);
  for (const id of ['almanac', 'sun', 'cursor', 'inbox']) {
    for (const [size, width, height] of [['mini', 196, 118], ['small', 196, 248], ['medium', 404, 248], ['large', 404, 510]]) {
      await place(id, size, '', width, height); await shot(id, `${id}-unstretched-${size}`);
    }
    for (const [variant, width, height] of [['wide', 600, 248], ['tall', 320, 510]]) {
      await place(id, id === 'almanac' ? 'small' : 'medium', variant, width, height); await shot(id, `${id}-${variant}`);
      if(phase==='review'&&id==='sun'&&variant==='wide')assert.equal(await js(`(()=>{const wrap=document.querySelector('#home-sun .sun-arc-wrap'),svg=wrap.querySelector('svg'),padding=getComputedStyle(wrap),height=wrap.clientHeight-parseFloat(padding.paddingTop)-parseFloat(padding.paddingBottom);return Math.abs(svg.viewBox.baseVal.width/svg.viewBox.baseVal.height-wrap.clientWidth/height)<.02})()`),true,'wide solar arc fills width without stretching text or circles');
    }
  }
  async function inspectAI(name, count) {
    const report = await js(`(()=>{const grid=document.getElementById('ai-usage-providers');return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cards:[...grid.querySelectorAll('.ai-usage-provider')].map(card=>{const ring=card.querySelector('.q-ring'),rect=card.getBoundingClientRect();return {id:card.dataset.provider,state:card.dataset.state,ring:ring?.checkVisibility()?ring.getBoundingClientRect().width:0,number:card.querySelector('[data-main-number]')?.checkVisibility()||false,bars:[...card.querySelectorAll('.cursor-usage-track')].filter(n=>n.checkVisibility()).length,color:card.querySelector('.q-gradient-start')?getComputedStyle(card.querySelector('.q-gradient-start')).stopColor:'',text:card.innerText,width:rect.width}})};})()`);
    metrics[name].ai = report;
    if (phase !== 'review') return;
    assert.equal(report.cards.length, count, name + ': visible providers');
    assert.equal(report.columns, name.startsWith('wide') ? count : Math.min(2, count), name + ': columns');
    for (const card of report.cards) {
      assert.equal(card.bars, 0, name + '/' + card.id + ': no duplicate bars');
      if (card.state === 'error') { assert.equal(card.ring, 0, name + ': error has no empty ring'); assert(card.text.trim()); }
      else { assert(card.ring >= 56, name + '/' + card.id + ': ring >=56px, got ' + card.ring); assert(card.number, name + ': visible percentage'); }
    }
    assert.equal(new Set(report.cards.filter(card => card.ring).map(card => card.color)).size, report.cards.filter(card => card.ring).length, name + ': distinct brands');
  }
  for (const [variant, count, width, height] of [['wide', 3, 600, 248], ['wide', 4, 800, 248], ['tall', 2, 320, 510], ['tall', 4, 404, 510], ['tall', 1, 320, 510]]) {
    const chosen = count === 2 ? { grokbot: { ok: true, detected: false } } : {};
    await supply(count === 2 ? 3 : count, chosen);
    await place('cursor', 'medium', variant, width, height);
    const name = `${variant}-${count}-providers`; await shot('cursor', name, aiOutput); await inspectAI(name, count);
  }
  for (const size of ['small', 'medium', 'large']) { await supply(3); await place('cursor', size, '', size === 'small' ? 196 : 404, size === 'large' ? 510 : 248); await shot('cursor', `unstretched-${size}`, aiOutput); }
  // Alert colors override provider brands without altering icon assets.
  for (const [level, used] of [['warn',85],['critical',95]]) {
    await supply(3,{codex:{...data(3).codex,primary:{percent:used,windowMinutes:300,resetsAt:future},secondary:{percent:used,windowMinutes:10080,resetsAt:future}}});
    await place('cursor','medium','wide',600,248); await shot('cursor',`wide-${level}`,aiOutput);
    if(phase==='review'){
      const palette=await js(`(()=>{const card=document.getElementById('ai-provider-codex');return {level:card.dataset.level,color:getComputedStyle(card.querySelector('.q-gradient-start')).stopColor}})()`);
      assert.equal(palette.level,level);assert.equal(palette.color,level==='warn'?'rgb(255, 180, 84)':'rgb(255, 123, 114)');
    }
  }
  // The logical mini footprint may also be stretched; only its presentation changes.
  if(phase==='review'){
    await supply(3,{grokbot:{ok:true,detected:true,fetchedAt:new Date(now).toISOString(),primary:{percent:1,windowMinutes:10080,resetsAt:future}}});
    await place('cursor','medium','wide',600,248);await shot('cursor','wide-3-ready',aiOutput);await inspectAI('wide-3-ready',3);
    await supply(4);await place('cursor','medium','full',600,510);await shot('cursor','full-4-providers',aiOutput);await inspectAI('full-4-providers',4);
    await supply(3);await place('cursor','mini','wide',600,248);await shot('cursor','wide-mini-footprint',aiOutput);await inspectAI('wide-mini-footprint',3);
    assert.equal(await js(`document.getElementById('home-cursor').dataset.widgetSize`),'mini');
    assert.equal(await js(`[...document.querySelectorAll('#home-cursor .ai-usage-provider[data-state="ok"] .q-compact-caption')].every(n=>n.textContent.includes('重置'))`),true,'stretched mini retains reset captions');
    await supply(6);await place('cursor','medium','wide',404,248);await shot('cursor','wide-6-narrow',aiOutput);await inspectAI('wide-6-narrow',6);
    assert.equal(await js(`(()=>{const grid=document.getElementById('ai-usage-providers');grid.scrollLeft=grid.scrollWidth;const last=grid.lastElementChild.getBoundingClientRect(),r=grid.getBoundingClientRect();return last.right<=r.right+1&&grid.scrollWidth>grid.clientWidth})()`),true,'many providers remain reachable inside the card');
  }
  // Rendering an unchanged layout marker must not recreate the solar SVG.
  if(phase==='review'){
    await js(`window.reviewSky=document.querySelector('#home-sun .sun-sky');const sun=document.getElementById('home-sun');for(let i=0;i<10;i++)sun.dataset.layoutVariant=sun.dataset.layoutVariant`);
    await settle();assert.equal(await js(`reviewSky===document.querySelector('#home-sun .sun-sky')`),true,'unchanged sun marker does not rerender');
  }
  await place('inbox', 'medium', 'tall', 320, 510);
  await until(`document.querySelectorAll('.home-inbox-row').length===${phase === 'baseline' ? 5 : 8}`);
  const before = await js('notchAPI.fixtureInboxReads()'); await sleep(200);
  assert.equal(await js('notchAPI.fixtureInboxReads()'), before, 'observers must settle instead of fetching repeatedly');
  assert.equal(await js('document.querySelectorAll(".home-inbox-listener").length'), 1, 'one listener label after repeated resizing');
  const baselineDir=process.env.POME_VARIANT_BASELINE_SHOTS;
  if(phase==='review'&&baselineDir){
    assert(fs.existsSync(path.join(baselineDir,'metrics-baseline.json')),'Explicit baseline must exist');
    const baseline=JSON.parse(fs.readFileSync(path.join(baselineDir,'metrics-baseline.json'),'utf8'));
    const comparison=[];
    for(const [name,metric]of Object.entries(metrics).filter(([name])=>name.includes('-unstretched-'))){
      assert.deepEqual(metric.geometry,baseline[name].geometry,name+': baseline geometry and content');
      if(name.startsWith('inbox-')){
        assert.deepEqual(metric.styles,baseline[name].styles,name+': exact computed styles');
        assert.equal(metric.dom,baseline[name].dom,name+': original DOM');
        const pixels=nativeImage.createFromPath(path.join(output,name+'.png')).toBitmap().equals(nativeImage.createFromPath(path.join(baselineDir,name+'.png')).toBitmap());
        comparison.push({name,geometry:true,styles:true,dom:true,pixels});
      }else if(!name.startsWith('cursor-')){
        const actual=nativeImage.createFromPath(path.join(output,name+'.png')).toBitmap(),expected=nativeImage.createFromPath(path.join(baselineDir,name+'.png')).toBitmap();
        assert(actual.equals(expected),name+': baseline pixels');comparison.push({name,geometry:true,pixels:true});
      }else{
        const actual=nativeImage.createFromPath(path.join(output,name+'.png')),expected=nativeImage.createFromPath(path.join(baselineDir,name+'.png'));
        const scale=actual.getSize().width/metric.width;
        for(const icon of metric.geometry.filter(node=>node.node.split(' ').includes('q-icon'))){
          const rect={x:Math.round(icon.x*scale),y:Math.round(icon.y*scale),width:Math.round(icon.w*scale),height:Math.round(icon.h*scale)};
          assert(actual.crop(rect).toBitmap().equals(expected.crop(rect).toBitmap()),name+': icon pixels unchanged');
        }
        comparison.push({name,geometry:true,icons:true,brandColorsIntentional:true});
      }
    }
    fs.writeFileSync(path.join(output,'baseline-comparison.json'),JSON.stringify(comparison,null,2));
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'metrics-' + phase + '.json'), JSON.stringify(metrics, null, 2));
  console.log('Layout variant native evidence:', phase, Object.keys(metrics).length, 'frames', output, aiOutput);
}
main().then(() => { clearTimeout(timer); app.exit(0); }).catch(error => { console.error(error); app.exit(1); });
