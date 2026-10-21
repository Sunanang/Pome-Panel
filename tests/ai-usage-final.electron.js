'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
app.disableHardwareAcceleration();
const out = process.env.QUOTA_FINAL_EVIDENCE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reference = { mini:[189,126], small:[189,264], medium:[389,264], large:[782,480] };
const actual = { mini:[196,118], small:[196,248], medium:[404,248], large:[404,510] };
const now = Date.now(), future = (now + 3 * 86400000) / 1000;
const snapshot = (short, long = 88) => ({ok:true,detected:true,fetchedAt:new Date(now).toISOString(),primary:{percent:100-short,windowMinutes:300,resetsAt:future-3600},secondary:{percent:100-long,windowMinutes:10080,resetsAt:future}});
function fixture(count, state) {
  const value = {cursor:{ok:true,detected:true,fetchedAt:new Date(now).toISOString(),auto:{percent:28,windowMinutes:43200,resetsAt:future},other:{percent:59,windowMinutes:43200,resetsAt:future}},codex:snapshot(41),grokbot:{ok:true,detected:true,primary:{percent:1,windowMinutes:10080,resetsAt:future}}};
  if(count>=4)value.claude=snapshot(80,18);
  if(count>=5)value.antigravity={ok:true,detected:true,windows:[{id:'5h',label:'Gemini',percent:12,windowMinutes:300,resetsAt:future-3600},{id:'week',label:'Gemini',percent:43,windowMinutes:10080,resetsAt:future}]};
  if(count>=6)value.copilot={ok:true,configured:true,windows:[{id:'premium',percent:20},{id:'chat',percent:20},{id:'completions',percent:20}]};
  if(state==='critical')value.claude=snapshot(90,8);
  if(['out','all-out'].includes(state)){delete value.grokbot;value.antigravity={ok:true,detected:true,windows:[{id:'5h',label:'Gemini',percent:12,windowMinutes:300,resetsAt:future-3600},{id:'week',label:'Gemini',percent:43,windowMinutes:10080,resetsAt:future}]};}
  if(state==='out')value.claude=snapshot(100,0);
  if(state==='multi-out'){value.codex=snapshot(100,0);value.claude=snapshot(100,0);}
  if(state==='all-out')for(const id of Object.keys(value))value[id]=id==='cursor'?{...value.cursor,auto:{percent:70,windowMinutes:43200,resetsAt:future},other:{percent:100,windowMinutes:86400,resetsAt:future}}:id==='grokbot'?{...value[id],primary:{percent:100,windowMinutes:10080,resetsAt:future}}:snapshot(100,0);
  if(state==='error')value.copilot={ok:false,configured:true,manualTokenInvalid:true,status:401};
  if(state==='stale'){delete value.grokbot;value.claude=snapshot(80,18);}
  if(state==='stale')for(const data of Object.values(value)){data.stale=true;data.fetchedAt=new Date(now-3*3600000).toISOString();}
  return value;
}
let win;
const timer=setTimeout(()=>{console.error('Final quota matrix timed out');app.exit(1);},150000);
async function main(){
  await app.whenReady();
  win=new BrowserWindow({width:1240,height:700,show:false,frame:false,webPreferences:{backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code), errors=[];
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  await win.loadFile(path.join(__dirname,'../renderer/index.html'));
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await js(`setMode(true);PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'));window.fixture={};window.notchAPI=Object.fromEntries(NotchAiProviders.usageProviders().map(({id,request})=>[request,async()=>fixture[id]||{ok:true,detected:false}]));document.querySelectorAll('.home-bento>[data-home-module]:not(#home-cursor)').forEach(n=>n.style.visibility='hidden')`);
  const settle=()=>js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  async function supply(data){await js(`fixture=${JSON.stringify(data)};NotchAiUsage.refresh({force:true})`);await settle();}
  async function size(name, dimensions){const [w,h]=dimensions[name];await js(`Object.assign(document.getElementById('home-cursor').style,{position:'fixed',left:'24px',top:'24px',width:'${w}px',height:'${h}px',display:'flex',visibility:'visible'});document.getElementById('home-cursor').dataset.widgetSize='${name}';document.getElementById('ui-capsule-hint').hidden=true`);await settle();}
  async function capture(name){if(!out)return;fs.mkdirSync(out,{recursive:true});await settle();const r=await js(`(()=>{const r=document.getElementById('home-cursor').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,dpr:devicePixelRatio}})()`);const shot=await win.webContents.capturePage();fs.writeFileSync(path.join(out,name+'.png'),shot.crop({x:Math.round(r.x*r.dpr),y:Math.round(r.y*r.dpr),width:Math.round(r.width*r.dpr),height:Math.round(r.height*r.dpr)}).toPNG());}
  async function inspect(){return js(`(()=>{const tile=document.getElementById('home-cursor'),grid=document.getElementById('ai-usage-providers'),cards=[...grid.querySelectorAll('.ai-usage-provider')];return {overflow:tile.scrollWidth>tile.clientWidth+1||tile.scrollHeight>tile.clientHeight+1,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,rows:getComputedStyle(grid).gridTemplateRows.split(' ').length,cards:cards.map(card=>{const r=card.getBoundingClientRect(),ring=card.querySelector('.q-ring').getBoundingClientRect(),badge=card.querySelector('.q-badge-slot .q-bottleneck')?.getBoundingClientRect(),name=card.querySelector('.ai-usage-source b'),foot=card.querySelector('.cursor-usage-footnote');return {id:card.dataset.provider,state:card.dataset.state,hasBars:card.dataset.hasBars==='true',headerBottom:card.querySelector('.ai-usage-source').getBoundingClientRect().bottom,captionTop:(foot.checkVisibility()?foot:card.querySelector('.q-compact-caption')).getBoundingClientRect().top,width:r.width,height:r.height,ring:{x:ring.x,y:ring.y,width:ring.width,height:ring.height},reserved:card.dataset.badgeRow,headerWrap:getComputedStyle(name).whiteSpace!=='nowrap',errorText:card.dataset.state==='error'?card.innerText:'',overflow:[...card.querySelectorAll('.ai-usage-source,.q-ring,.q-mini-value,.q-inline-rows,.q-compact-caption,.cursor-usage-footnote')].filter(n=>n.checkVisibility({checkVisibilityCSS:true})).flatMap(n=>{const b=n.getBoundingClientRect();return b.left<r.left-.6||b.right>r.right+.6||b.top<r.top-.6||b.bottom>r.bottom+.6?[{node:n.className,x:b.x-r.x,y:b.y-r.y,w:b.width,h:b.height,cardW:r.width,cardH:r.height}]:[]}),badge:badge?{bottom:badge.bottom,center:(badge.left+badge.right)/2}:null,tracks:[...card.querySelectorAll('.q-inline-rows .cursor-usage-track')].filter(n=>n.checkVisibility()).map(n=>{const b=n.getBoundingClientRect();return {x:b.x,width:b.width,right:b.right}}),footY:foot.checkVisibility()?foot.getBoundingClientRect().bottom:card.querySelector('.q-compact-caption').getBoundingClientRect().bottom}})}})()`);}
  const matrix=[[3,'normal'],[4,'warn'],[5,'critical'],[4,'out'],[5,'multi-out'],[4,'all-out'],[6,'error'],[3,'stale']];
  for(const [count,state]of matrix){
    await supply(fixture(count,state));
    for(const format of ['reference','actual'])for(const name of ['mini','small','medium','large']){
      await size(name,format==='reference'?reference:actual);
      await capture(`${name}-${count}ai-${state}${format==='actual'?'-real':''}`);
      const v=await inspect(),prefix=`${format}/${name}/${count}/${state}`;
      assert.equal(v.overflow,false,prefix+' tile overflow');
      assert.equal(await js(`(()=>{const b=document.getElementById('cursor-usage-refresh').getBoundingClientRect(),s=document.querySelector('#cursor-usage-refresh svg').getBoundingClientRect();return Math.abs((s.left+s.right-b.left-b.right)/2)<.5&&Math.abs((s.top+s.bottom-b.top-b.bottom)/2)<.5&&s.left>=b.left&&s.right<=b.right})()`),true,prefix+' refresh icon stays centered inside its button');
      assert.equal(v.cards.length,name==='mini'&&count>4?3:name==='small'?Math.min(4,count):count,prefix+' sources stay present');
      assert.deepEqual(v.cards.flatMap(c=>c.overflow),[],prefix+' cell content');
      assert(v.cards.every(c=>Math.abs(c.ring.width-v.cards[0].ring.width)<.5),prefix+' shared diameter');
      if(name==='mini'&&count>4)assert.equal(await js(`(()=>{const more=document.querySelector('#home-cursor .q-more-ring').getBoundingClientRect(),ring=document.querySelector('#home-cursor .q-ring').getBoundingClientRect();return Math.abs(more.y-ring.y)<.5})()`),true,prefix+' +N aligns with the provider rings');
      if(name!=='mini'){
        assert(v.cards.every(c=>!c.headerWrap),prefix+' names stay on one line');
        if(format==='reference')assert(Math.abs(v.cards[0].ring.width-(name==='small'?38:name==='medium'?count===3?72:count===4?60:32:count===3?140:count===4?120:80))<.5,prefix+' specified ring diameter');
        assert.equal(await js(`(()=>{const size='${name}';return [...document.querySelectorAll('#home-cursor .q-inline-rows')].every(rows=>{const first=rows.querySelector('.cursor-usage-track'),ring=rows.closest('[data-provider]').querySelector('.q-ring').getBoundingClientRect();if(size!=='large'&&Math.abs(rows.getBoundingClientRect().top-ring.bottom-(size==='small'?8:10))>.6)return false;return [...rows.querySelectorAll('.ai-quota-row')].every(row=>{const label=row.querySelector('.q-window-short').getBoundingClientRect(),bar=row.querySelector('.cursor-usage-track').getBoundingClientRect(),value=row.querySelector('.q-pct'),v=value.getBoundingClientRect();return Math.abs(bar.left-label.right-3)<.6&&Math.abs(v.left-bar.right-4)<.6&&getComputedStyle(value).fontSize===getComputedStyle(value.querySelector('small')).fontSize})})})()`),true,prefix+' ring/bar gaps and fixed grid columns');

        assert(v.cards.every(c=>Math.abs(c.width-v.cards[0].width)<.5&&Math.abs(c.height-v.cards[0].height)<.5),prefix+' equal cells');
        assert(v.cards.every(c=>!c.badge),prefix+' no corner badges or reserved lanes');
        for(const c of v.cards.filter(c=>!c.hasBars))assert(Math.abs(c.ring.y+c.ring.height/2-(c.headerBottom+c.captionTop)/2)<.6,prefix+' no-bar ring centers in remaining space '+c.id);
        for(let i=0;i<v.cards.length;i+=v.columns){const row=v.cards.slice(i,i+v.columns),bars=row.filter(c=>c.hasBars);assert(bars.every(c=>Math.abs(c.ring.y-bars[0].ring.y)<.6),prefix+' row rings with bars align');assert(row.every(c=>Math.abs(c.footY-row[0].footY)<.6),prefix+' footnotes align');}
        for(const c of v.cards){if(c.tracks.length)assert(c.tracks.every(t=>Math.abs(t.width-c.tracks[0].width)<.5&&Math.abs(t.x-c.tracks[0].x)<.5),prefix+' equal tracks '+c.id);if(c.state==='error')assert.doesNotMatch(c.errorText,/%|--/,prefix+' invalid card has no placeholder quota');}
        assert.equal(await js(`!!document.querySelector('#home-cursor .q-summary')`),false,'no onboarding filler in the empty fifth-source slot');
      }
      if(name==='small')assert.equal(v.columns,2,prefix+' small two equal columns');
      if(name==='large'||name==='medium')assert.equal(v.columns,count<=4?count:3,prefix+' final columns');
      if(name==='small')assert.equal(await js(`document.getElementById('ai-usage-more').hidden`),count<=4,prefix+' hidden sources use the header count');
      if(name==='mini'&&state==='error')assert.match(await js(`document.getElementById('ai-usage-footer').textContent`),/^Copilot 失效 · 去设置$/);
      if(name==='mini'&&state==='error')assert.equal(await js(`document.querySelector('#ai-provider-copilot .cursor-usage-footnote').checkVisibility()`),false,'mini uses one invalid label below the ring');
      if(name==='mini'&&state==='all-out')assert.match(await js(`document.getElementById('ai-usage-footer').textContent`),/^全部额度 0%/);
      if(name==='mini'&&['out','multi-out','all-out','critical','warn'].includes(state))assert.notEqual(await js(`getComputedStyle(document.getElementById('ai-usage-footer')).color`),await js(`getComputedStyle(document.getElementById('ai-usage-updated')).color`),'urgent mini summary retains its status color');
      if(state==='stale'&&name!=='mini')assert.equal(await js(`getComputedStyle(document.querySelector('.ai-usage-provider .q-gauge-group')).filter`),'grayscale(1)',prefix+' stale readings are gray');
      if(state==='stale'){assert.equal(await js(`document.getElementById('ai-usage-updated').textContent`),name==='mini'||name==='small'?'已过期 3 小时':'数据已过期 · 3 小时前');assert.equal(await js(`getComputedStyle(document.querySelector('.ai-usage-provider ${name==='mini'?'.q-ring':'.q-gauge-group'}')).opacity`),'0.45');}
    }
  }
  // English strings must retain the same geometry and short window labels.
  await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'))`);
  for (const [count,state] of [[3,'normal'],[4,'warn'],[5,'multi-out'],[6,'error']]) {
    await supply(fixture(count,state));
    for (const name of ['mini','small','medium','large']) {
      await size(name,actual);await capture(`${name}-${count}ai-${state}-en-real`);
      const v=await inspect();
      assert.equal(v.overflow,false,`English ${name}/${count} tile overflow`);
      assert.deepEqual(v.cards.flatMap(c=>c.overflow),[],`English ${name}/${count} cell content`);
      assert.deepEqual(await js(`[...document.querySelectorAll('#home-cursor .q-compact-caption')].filter(n=>n.checkVisibility({checkVisibilityCSS:true})&&n.scrollHeight>n.clientHeight+1).map(n=>({text:n.textContent,scroll:n.scrollHeight,height:n.clientHeight}))`),[],`English ${name}/${count} complete explanation lines`);
      assert.deepEqual(await js(`[...document.querySelectorAll('#home-cursor .q-window-short')].filter(n=>n.checkVisibility()&&n.textContent.length<=5&&n.scrollWidth>n.clientWidth+1).map(n=>({text:n.textContent,font:getComputedStyle(n).font,width:n.clientWidth,scroll:n.scrollWidth,label:n.closest('.home-tile')?.style.getPropertyValue('--q-window-label-width')}))`),[],`English ${name}/${count} short window names remain readable`);
    }
  }
  await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
  // Credential expiry, transient failures and recent stale data use distinct copy.
  for (const locale of ['zh-CN','en-US']) {
    await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'))`);
    await supply({});
    await supply({cursor:{ok:false,detected:true,error:'network'}});
    for(const name of ['mini','small','medium','large']) {
      await size(name,actual);await capture(`${name}-network-${locale}`);
      const copy=await js(`({value:document.querySelector('#ai-provider-cursor .q-mini-value').textContent,foot:document.getElementById('cursor-usage-footnote').textContent,summary:document.getElementById('ai-usage-footer').textContent,title:document.getElementById('ai-provider-cursor').title})`);
      assert.equal(copy.value,locale==='zh-CN'?'失败':'Error');
      assert.match(copy.foot,locale==='zh-CN'?/^失败重试$/:/^ErrorRetry$/);
      assert.doesNotMatch(copy.title+copy.summary,/失效|invalid|expired/i);
      if(name==='mini') {
        assert.equal(await js(`document.getElementById('ai-usage-footer').dataset.quotaRetry`),'cursor');
        assert.equal(await js(`document.getElementById('ai-usage-footer').hasAttribute('data-quota-settings')`),false);
        await js(`window.retryQuotaCalls=0;notchAPI.getCursorUsage=async()=>{retryQuotaCalls++;return fixture.cursor};document.getElementById('ai-usage-footer').click();NotchAiUsage.refresh({force:true})`);
      } else await js(`document.querySelector('#cursor-usage-footnote [data-quota-retry]').click();NotchAiUsage.refresh({force:true})`);
      assert(await js('retryQuotaCalls>0'),'failure action actually retries');
      assert.equal(await js(`activeTab`),'home','network errors never send the user to credential settings');
    }
    const recent={...snapshot(55),stale:true,fetchedAt:new Date(now-20*60000).toISOString()};
    await supply({codex:recent});
    for(const name of ['mini','small','medium','large']) {
      await size(name,actual);await capture(`${name}-recent-stale-${locale}`);
      const text=await js(`document.getElementById('ai-usage-updated').textContent`);
      assert.match(text,locale==='zh-CN'?/不足 1 小时/:/<1h/);assert.doesNotMatch(text,/0 小时|0h/);
    }
    for(const count of [3,4,5,6]) {
      const data=fixture(count,'multi-out');await supply(data);await size('small',actual);
      const spans=await js(`[...document.querySelectorAll('#ai-provider-codex .q-compact-caption>span')].map(n=>n.textContent)`);
      assert.equal(spans.length,1,'small footer contains only the real reset time');
      assert.doesNotMatch(spans[0],/%/);
      assert.match(spans.at(-1),locale==='zh-CN'?/恢复$/:/^Recovers /);
      assert.equal(await js(`(()=>{const n=document.querySelector('#ai-provider-codex .q-compact-caption');return n.scrollHeight<=n.clientHeight+1})()`),true,'both bottleneck and recovery fit');
      await capture(`small-${count}ai-two-line-${locale}`);
    }
  }
  await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
  await supply({grokbot:{...fixture(3,'normal').grokbot,authSource:'manual'}});
  assert.match(await js(`document.getElementById('ai-provider-grokbot').title`),/Cursor Sand.*手动 Token/,'Grok Bot identifies the Sand pool and actual credential source');
  await supply({codex:{...snapshot(100,0),primary:{percent:0,windowMinutes:300},secondary:{percent:100,windowMinutes:10080}}});
  for(const name of ['small','medium','large']){await size(name,actual);assert.equal(await js(`document.querySelector('#ai-provider-codex .q-compact-caption').textContent`),'','missing provider reset data never invents a time');}
  // Equal grids cannot change track lengths while values acquire more digits.
  await supply(fixture(4,'warn'));await size('medium',actual);
  const providerTracks=await js(`Object.fromEntries([...document.querySelectorAll('#home-cursor .ai-usage-provider')].map(card=>[card.dataset.provider,card.querySelector('.q-inline-rows .cursor-usage-track')?.getBoundingClientRect().width||0]))`);
  assert(providerTracks.codex>providerTracks.cursor+5,'short Codex labels reclaim width independently of Cursor');
  assert.equal(providerTracks.grokbot,0,'a single window has no duplicate compact progress bar');
  assert.equal(await js(`[...document.querySelectorAll('#home-cursor .ai-usage-provider')].every(card=>{const labels=[...card.querySelectorAll('.q-inline-rows .q-window-short')];if(!labels.length)return true;const end=Math.max(...labels.map(label=>{const range=document.createRange();range.selectNodeContents(label);return range.getBoundingClientRect().right})),track=card.querySelector('.q-inline-rows .cursor-usage-track').getBoundingClientRect();return track.left-end>=2&&track.left-end<=4.5})`),true,'provider-local longest label stays close to its tracks');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const tracks=()=>js(`Object.fromEntries([...document.querySelectorAll('#home-cursor .q-inline-rows .cursor-usage-track')].map(n=>[n.closest('[data-provider]').dataset.provider+'/'+n.closest('[data-pool]').dataset.pool,n.getBoundingClientRect().width]))`);
  for(const name of ['small','medium','large']) {
    await size(name,actual);
    const widths=await tracks();
    for(const used of [100,92,0]){
      await js(`fixture.codex.secondary.percent=${used};NotchAiUsage.refresh({force:true})`);
      for(const delay of [0,80,160,500]){await sleep(delay);assert.deepEqual(await tracks(),widths,name+' 0%, 8%, 100% and sampled animation frames retain exact provider track widths');}
    }
  }
  // Both the title icon and the invalid indicator share the geometric center.
  await supply(fixture(6,'error'));await size('mini',actual);await sleep(900);
  assert.deepEqual(await js(`[...document.querySelectorAll('#home-cursor .q-ring-center')].flatMap(center=>{const icon=center.querySelector('.q-icon,.q-alert'),r=center.getBoundingClientRect(),b=icon.getBoundingClientRect();return Math.abs((b.left+b.right-r.left-r.right)/2)>.5||Math.abs((b.top+b.bottom-r.top-r.bottom)/2)>.5?[center.closest('[data-provider]').dataset.provider]:[]})`),[],'mini icon/error centers');
  await js(`document.getElementById('ai-usage-footer').click()`);await sleep(200);
  assert.equal(await js(`document.getElementById('tab-settings').classList.contains('active')`),true,'invalid summary repairs the selected provider');
  assert.deepEqual(errors,[],'renderer console');
  console.log('Final quota: four sizes x 3–6 sources, all states, equal cells/rings, centered no-bar cells, fixed animated tracks, gray expiry and mini repair passed');
}
main().then(()=>{clearTimeout(timer);win?.destroy();app.quit();},error=>{console.error(error);app.exit(1);});
