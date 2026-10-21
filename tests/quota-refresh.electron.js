'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const out = process.env.QUOTA_REFRESH_EVIDENCE;
if(!out)app.disableHardwareAcceleration();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const watchdog = setTimeout(() => { console.error('Quota refresh test timed out'); app.exit(1); }, 85000);
async function main() {
  await app.whenReady();
  win = new BrowserWindow({ width:1240,height:638,show:Boolean(out),frame:false,webPreferences:{backgroundThrottling:false} });
  const js = source => win.webContents.executeJavaScript(source);
  await win.loadFile(path.join(__dirname,'../renderer/index.html'));
  await js(`setMode(true);PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'));document.querySelectorAll('.home-bento > [data-home-module]:not(#home-cursor)').forEach(n=>n.style.visibility='hidden')`);
  const future = Date.now()/1000 + 86400 * 3;
  const source = (short, long) => ({ok:true,detected:true,fetchedAt:new Date().toISOString(),primary:{percent:100-short,windowMinutes:300,resetsAt:future-3600},secondary:{percent:100-long,windowMinutes:10080,resetsAt:future}});
  await js(`window.fixture=${JSON.stringify({codex:source(100,0),claude:source(80,18),cursor:{ok:true,detected:true,auto:{percent:28,windowMinutes:43200},other:{percent:59,windowMinutes:43200},billing:{cycleEnd:new Date(future*1000).toISOString()}}})};window.calls=0;window.failQuota=false;
    window.notchAPI=Object.fromEntries(NotchAiProviders.usageProviders().map(({id,request})=>[request,async()=>{window.calls++;await new Promise(r=>setTimeout(r,80));return failQuota?{ok:false,detected:true,error:'offline'}:fixture[id]||{ok:true,detected:false};}]));
    NotchAiUsage.refresh({force:true})`);
  await sleep(900);
  async function size(name, w, h, saveImage = true, imageName = name) {
    await js(`Object.assign(document.getElementById('home-cursor').style,{position:'fixed',left:'24px',top:'110px',width:'${w}px',height:'${h}px',display:'flex',visibility:'visible'});document.getElementById('home-cursor').dataset.widgetSize='${name}';document.getElementById('ui-capsule-hint').hidden=true`);
    await sleep(100);
    const bounds=await js(`(()=>{const tile=document.getElementById('home-cursor'),t=tile.getBoundingClientRect();return [...tile.querySelectorAll('.ai-usage-provider')].flatMap(el=>{const c=el.getBoundingClientRect();return [...el.querySelectorAll('.q-ring,.ai-usage-source,.q-compact-caption,.q-bottleneck')].filter(n=>n.checkVisibility()).flatMap(n=>{const r=n.getBoundingClientRect();return r.left<c.left-1||r.right>c.right+1||r.top<c.top-7||r.bottom>c.bottom+1?[{provider:el.dataset.provider,node:n.className,left:r.left-c.left,right:r.right-c.left,top:r.top-c.top,bottom:r.bottom-c.top,cellWidth:c.width,cellHeight:c.height}]:[]})})})()`);
    assert.deepEqual(bounds,[],`${name} content fits`);
    assert.equal(await js(`[...document.querySelectorAll('#home-cursor .q-compact-caption')].filter(n=>n.checkVisibility()).every(n=>n.scrollHeight<=n.clientHeight+1)`),true,`${name} explanation lines do not clip`);
    if(name!=='mini'){
      assert.equal(await js(`document.querySelector('#home-cursor .q-bottleneck')===null`),true,`${imageName} non-mini cells have no badges or badge lanes`);
      assert.deepEqual(await js(`[...document.querySelectorAll('#home-cursor .q-ring-center > [data-main-number],#home-cursor .q-ring-center > [data-main-amount]')].filter(n=>n.checkVisibility()).flatMap(n=>{const text=n.getBoundingClientRect(),ring=n.closest('.q-ring').getBoundingClientRect(),circle=n.closest('.q-ring').querySelector('.q-ring-track'),stroke=Number(circle.getAttribute('stroke-width'))*ring.width/Number(n.closest('.q-ring').querySelector('svg').getAttribute('viewBox').split(' ')[2]),cx=ring.left+ring.width/2,cy=ring.top+ring.height/2,corner=Math.hypot(Math.max(Math.abs(text.left-cx),Math.abs(text.right-cx)),Math.max(Math.abs(text.top-cy),Math.abs(text.bottom-cy)));return corner>ring.width/2-stroke-1?[{id:n.closest('[data-provider]').dataset.provider,text:n.textContent,width:text.width,height:text.height,diameter:ring.width,corner,interior:ring.width/2-stroke-1}]:[]})`),[],`${imageName} values including currency fit entirely inside the ring stroke`);
    }
    if(out && saveImage){fs.mkdirSync(out,{recursive:true});const rect=await js(`(()=>{const r=document.getElementById('home-cursor').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);const shot=await win.webContents.capturePage();const dpr=await js('devicePixelRatio');const crop=Object.fromEntries(Object.entries(rect).map(([k,v])=>[k,Math.round(v*dpr)]));fs.writeFileSync(path.join(out,imageName+'.png'),shot.crop(crop).toPNG());
      if(name==='medium'&&imageName.endsWith('8ai')){
        const scroll=await js(`document.getElementById('ai-usage-providers').scrollTop`);
        await js(`document.getElementById('ai-usage-providers').scrollTop=140`);await sleep(100);
        fs.writeFileSync(path.join(out,imageName+'-middle.png'),(await win.webContents.capturePage()).crop(crop).toPNG());
        await js(`document.getElementById('ai-usage-providers').scrollTop=${scroll}`);
      }
    }
  }
  for(const args of [['mini',196,118],['small',196,248],['medium',404,248],['large',404,510]]) {
    await size(...args);
    const strike=await js(`(()=>{const p=document.querySelector('#ai-provider-codex '+(document.getElementById('home-cursor').dataset.widgetSize==='mini'?'.q-mini-value':'.q-ring-center')+' .q-pct'),line=getComputedStyle(p,'::after');return {native:getComputedStyle(p).textDecorationLine,percent:getComputedStyle(p.querySelector('small')).textDecorationLine,content:line.content,width:parseFloat(line.width),box:p.getBoundingClientRect().width,top:parseFloat(line.top),height:p.getBoundingClientRect().height}})()`);
    assert.equal(strike.native,'none',args[0]+' no separate font-metric strikes');
    assert.equal(strike.percent,'none');assert.equal(strike.content,'""');
    assert(Math.abs(strike.width-strike.box)<1,args[0]+' one line spans number and percent');
    assert(Math.abs(strike.top-strike.height/2)<1,args[0]+' line has a single shared height');
  }
  assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.depleted`),'true');
  assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring').getAttribute('aria-valuenow')`),'100');
  // Unknown/long reset copy and the longest corner badge must fit in both
  // languages, in two-column small cards and the eight-source dense layouts.
  await js(`window.savedFixture=structuredClone(fixture)`);
  for(const locale of ['en-US','zh-CN'])for(const count of [2,8]){
    const crowded={codex:source(100,0),claude:source(80,18)};
    if(count===8)Object.assign(crowded,{
      cursor:{ok:true,detected:true,auto:{percent:0,windowMinutes:43200},other:{percent:100,windowMinutes:86400,resetsAt:future}},
      grokbot:source(80,18),
      copilot:{ok:true,configured:true,windows:[{id:'premium',percent:20},{id:'chat',percent:20},{id:'completions',percent:20}]},
      antigravity:{ok:true,detected:true,windows:[{id:'short',label:'Gemini',percent:0,windowMinutes:300},{id:'long',label:'Gemini',percent:100,windowMinutes:10080,resetsAt:future}]},
      grok:{ok:true,configured:true,primary:{currency:'USD',balance:10}},manus:{ok:true,configured:true,windows:[{unit:'credits',balance:0}]}
    });
    await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'));fixture=${JSON.stringify(crowded)};NotchAiUsage.refresh({force:true})`);
    await sleep(950);
    for(const args of [['mini',196,118],['small',196,248],['medium',404,248],['large',404,510]])await size(...args,true,`${args[0]}-${locale}-${count}ai`);
  }
  await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'));fixture=savedFixture;NotchAiUsage.refresh({force:true})`);
  await sleep(950);
  await size('medium',404,248,false);
  const ringPosition=()=>js(`(()=>{const r=document.querySelector('#ai-provider-codex .q-ring').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
  const constrainedPosition=await ringPosition();
  await js(`fixture.codex.secondary.percent=70;NotchAiUsage.refresh({force:true})`);
  assert.deepEqual((await ringPosition()).slice(2),constrainedPosition.slice(2),'a disappearing row badge does not change ring diameter');
  await js(`fixture.codex.secondary.percent=100;NotchAiUsage.refresh({force:true})`);
  assert.deepEqual((await ringPosition()).slice(2),constrainedPosition.slice(2),'a returning badge keeps the shared diameter while the existing value store animates position');
  await sleep(950);
  await size('large',404,510,false);
  await js(`fixture.codex.primary.percent=50;NotchAiUsage.refresh({force:true})`);
  await sleep(150);
  const before=await js(`Number(document.querySelector('#ai-provider-codex [data-main-number]').firstChild.textContent)`);
  assert(before>50&&before<100,'ring number passes through intermediate values');
  const continuation=await js(`(async()=>{const values=[];const end=performance.now()+320;function sample(){values.push(Number(document.querySelector('#ai-provider-codex [data-main-number]').firstChild.textContent));if(performance.now()<end)requestAnimationFrame(sample)}sample();fixture.codex.primary.percent=20;await NotchAiUsage.refresh({force:true});await new Promise(r=>setTimeout(r,340));return values})()`);
  assert(continuation.every((v,i)=>!i||Math.abs(v-continuation[i-1])<15),'retargeted frames remain continuous');
  await sleep(900);
  assert.equal(await js(`document.querySelector('#ai-provider-codex [data-main-number]').textContent`),'80%');
  await js(`NotchAiUsage.refresh({force:true})`);
  assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.animating`),'false','identical values skip animation');
  await js(`failQuota=true;NotchAiUsage.refresh({force:true})`);
  assert.equal(await js(`document.querySelector('#ai-provider-codex [data-main-number]').textContent`),'80%');
  assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.animating`),'false','failure retains old value without a new tween');
  await js(`failQuota=false;NotchAiUsage.refresh({force:true})`);
  const calls=await js('calls');
  await js(`(async()=>{await setMode(false);await setMode(true);document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('notch:tabchange'))})()`);
  await sleep(160);assert.equal(await js('calls'),calls,'repeated shows inside thirty seconds use cache');
  await js(`(async()=>{window.originalNow=Date.now;Date.now=()=>originalNow()+31000;await setMode(false);await setMode(true)})()`);
  await sleep(220);assert.equal(await js('calls'),calls+8,'show after thirty seconds refreshes once');
  await js('void(Date.now=originalNow)');
  if(out){
    // Record the actual Electron viewport while reveal, cached values and the fresh
    // result are displayed. No desktop-capture permission or real account is used.
    await size('medium',404,248,false);
    if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1240,height:638,deviceScaleFactor:1,mobile:false});
    await js(`window.recordCanvas=document.createElement('canvas');recordCanvas.width=1240;recordCanvas.height=638;window.recordContext=recordCanvas.getContext('2d');window.chunks=[];window.recorder=new MediaRecorder(recordCanvas.captureStream(30),{mimeType:'video/webm;codecs=vp9'});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();window.motionFrames=[];window.trackMotion=true;requestAnimationFrame(function track(t){motionFrames.push(t);if(trackMotion)requestAnimationFrame(track)});setMode(false)`);
    let busy=false;
    const frames=[];
    const start=Date.now();
    const capture=async(_event,method,params)=>{
      if(method!=='Page.screencastFrame')return;
      void win.webContents.debugger.sendCommand('Page.screencastFrameAck',{sessionId:params.sessionId});
      if(busy)return;busy=true;
      try {await js(`(async()=>{const image=new Image();image.src='data:image/jpeg;base64,${params.data}';await image.decode();recordContext.drawImage(image,0,0,1240,638)})()`);frames.push(Date.now()-start);} finally {busy=false;}
    };
    win.webContents.debugger.on('message',capture);
    await win.webContents.debugger.sendCommand('Page.startScreencast',{format:'jpeg',quality:75,maxWidth:1240,maxHeight:638,everyNthFrame:1});
    await sleep(400);
    await js(`fixture.codex.primary.percent=65;fixture.codex.secondary.percent=92;fixture.claude.primary.percent=10;setMode(true);NotchAiUsage.refresh({force:true})`);
    await sleep(1400);
    await js(`fixture.codex.primary.percent=25;fixture.codex.secondary.percent=100;document.getElementById('cursor-usage-refresh').click()`);
    await sleep(1400);
    await win.webContents.debugger.sendCommand('Page.stopScreencast');
    win.webContents.debugger.removeListener('message',capture);while(busy)await sleep(10);
    const video=await js(`new Promise(resolve=>{recorder.onstop=async()=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};recorder.stop()})`);
    fs.writeFileSync(path.join(out,'panel-refresh.webm'),Buffer.from(video,'base64'));
    fs.writeFileSync(path.join(out,'recording-frames.json'),JSON.stringify({captures:frames,raf:await js('trackMotion=false;motionFrames')}));
    const review=await js(`(async()=>{const v=document.createElement('video');v.src=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));await new Promise(r=>v.onloadedmetadata=r);const shots=[];for(const time of [.7,1.1,2.2,2.6]){v.currentTime=time;await new Promise(r=>v.onseeked=r);recordContext.drawImage(v,0,0);shots.push(recordCanvas.toDataURL('image/png').split(',')[1])}return {width:v.videoWidth,height:v.videoHeight,shots}})()`);
    review.shots.forEach((shot,i)=>fs.writeFileSync(path.join(out,`motion-frame-${i}.png`),Buffer.from(shot,'base64')));
    fs.writeFileSync(path.join(out,'video-review.json'),JSON.stringify({width:review.width,height:review.height}));
  }
  // Removing a source mid-tween must stop painting its detached card. Reconnect
  // starts a new reading rather than continuing an old account's cached value.
  await js(`fixture.codex.primary.percent=50;NotchAiUsage.refresh({force:true})`);
  await sleep(120);
  await js(`window.detachedCodex=document.getElementById('ai-provider-codex');window.connectedCodex=structuredClone(fixture.codex);fixture.codex={ok:true,detected:false};NotchAiUsage.refresh({force:true})`);
  await js(`window.detachedPaints=0;window.detachedObserver=new MutationObserver(records=>detachedPaints+=records.length);detachedObserver.observe(detachedCodex,{subtree:true,childList:true,attributes:true,characterData:true})`);
  await sleep(850);
  assert.equal(await js('detachedPaints'),0,'a disconnected card has no remaining animation callbacks');
  await js(`detachedObserver.disconnect();window.realQuotaRaf=requestAnimationFrame;window.realQuotaCancel=cancelAnimationFrame;window.heldQuotaFrames=new Map();window.heldQuotaFrameId=0;window.requestAnimationFrame=cb=>{heldQuotaFrames.set(++heldQuotaFrameId,cb);return heldQuotaFrameId};window.cancelAnimationFrame=id=>heldQuotaFrames.delete(id);fixture.codex=connectedCodex;NotchAiUsage.refresh({force:true})`);
  assert.equal(await js(`document.querySelector('#ai-provider-codex [data-main-number]').textContent`),'0%','a disconnected source releases cached animation values');
  await js(`(()=>{const frames=[...heldQuotaFrames.values()];heldQuotaFrames.clear();window.requestAnimationFrame=realQuotaRaf;window.cancelAnimationFrame=realQuotaCancel;const end=performance.now()+1200;frames.forEach(frame=>frame(end))})()`);
  assert.equal(await js(`document.querySelector('#ai-provider-codex [data-main-number]').textContent`),'50%','reconnect reaches its new reading after the controlled frame');
  if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await js(`fixture.codex.primary.percent=7;NotchAiUsage.refresh({force:true})`);
  assert.equal(await js(`document.querySelector('#ai-provider-codex [data-main-number]').textContent`),'93%');
  assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.animating`),'false');
  console.log('Quota reveal cache/debounce, manual refresh, interrupted/same/failed/reduced animations and four sizes passed');
}
main().then(()=>{clearTimeout(watchdog);win?.destroy();app.quit();},error=>{console.error(error);app.exit(1);});
