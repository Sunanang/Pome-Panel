'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
app.disableHardwareAcceleration();
const now = new Date().toISOString(), future = Date.now() / 1000 + 86400 * 7;
const absent = { ok: true, detected: false, configured: false };
const cursor = { ok: true, detected: true, authSource: 'local', fetchedAt: now,
  auto: { percent: 28 }, other: { percent: 59 }, billing: { cycleEnd: new Date(future * 1000).toISOString() } };
const codex = { ok: true, detected: true, authSource: 'local', plan: 'plus', updatedAt: now,
  primary: { percent: 59, windowMinutes: 300, resetsAt: future },
  secondary: { percent: 12, windowMinutes: 10080, resetsAt: future }, credits: { balance: 20 } };
const grokbot = { ok: true, detected: true, fetchedAt: now, primary: { percent: 1, resetsAt: future } };
const claude = { ok: true, detected: true, authSource: 'keychain', fetchedAt: now,
  primary: { percent: 82, windowMinutes: 300, resetsAt: future }, secondary: { percent: 37, windowMinutes: 10080, resetsAt: future } };
const invalid = { ok: false, configured: true, manualTokenInvalid: true, status: 401 };
const two = { cursor, codex }, three = { ...two, grokbot }, five = { ...three, claude, copilot: invalid };
const designSizes = { mini: [189,126], small: [189,264], medium: [389,264], large: [782,480] };
const currentSizes = { mini: [196,118], small: [196,248], medium: [404,248], large: [404,510] };
const screenshots = process.env.AI_USAGE_SCREENSHOTS;
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 700, show: false, frame: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const js = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}\nRenderer expression: ${code}`); });
  const settle = () => js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  async function supply(snapshots) {
    await js(`(async()=>{
      window.quotaFixture=${JSON.stringify(snapshots)};

      const absent=${JSON.stringify(absent)};
      window.notchAPI=Object.fromEntries(NotchAiProviders.usageProviders().map(({id,request})=>[request,async({force})=>{
        window.quotaForce=force;return window.quotaFixture[id]||absent;
      }]));
      for(const id of NotchAiProviders.ids()) document.dispatchEvent(new CustomEvent('notch:ai-provider-token-changed',{detail:{providerId:id}}));
      await NotchAiUsage.refresh({force:true});
    })()`);
    await settle();
  }
  async function resize(size, dimensions = designSizes) {
    const [width,height] = dimensions[size];
    await js(`Object.assign(document.getElementById('home-cursor').style,{position:'fixed',left:'24px',top:'24px',width:'${width}px',height:'${height}px',display:'flex',visibility:'visible'});document.getElementById('home-cursor').dataset.widgetSize='${size}'`);
    await settle();
  }
  async function capture(name) {
    if (!screenshots) return;
    await js("if(activeTab!=='home')setActiveTab('home');new Promise(r=>setTimeout(r,250))");
    await js("document.activeElement?.blur();document.getElementById('ui-capsule-hint').hidden=true");
    win.webContents.invalidate();
    await js('new Promise(r=>setTimeout(r,150))');
    await settle();
    const rect = await js(`(()=>{const r=document.getElementById('home-cursor').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const scale = win.webContents.getZoomFactor?.() || 1;
    const dpr = await js('window.devicePixelRatio||1');
    const factor = scale * dpr;
    const crop = {
      x: Math.round(rect.x * factor),
      y: Math.round(rect.y * factor),
      width: Math.round(rect.width * factor),
      height: Math.round(rect.height * factor),
    };
    fs.mkdirSync(screenshots,{recursive:true});
    const full = await win.webContents.capturePage();
    fs.writeFileSync(path.join(screenshots,name+'-full.png'),full.toPNG());
    fs.writeFileSync(path.join(screenshots,name+'.json'),JSON.stringify({rect,crop,factor,viewport:win.getContentSize()}));
    fs.writeFileSync(path.join(screenshots,name+'.png'),full.crop(crop).toPNG());
    if(name.startsWith('naming-')&&name.endsWith('-overview')){
      const card=await js(`(()=>{const r=document.getElementById('ai-provider-copilot').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
      fs.writeFileSync(path.join(screenshots,name+'-copilot.png'),full.crop(Object.fromEntries(Object.entries(card).map(([k,v])=>[k,Math.round(v*factor)]))).toPNG());
    }
    const focus=await js(`(()=>{const p=document.querySelector('.cursor-usage-rows:popover-open');if(!p)return null;const r=p.getBoundingClientRect(),t=document.getElementById('home-cursor').getBoundingClientRect();const x=Math.max(0,Math.min(r.left,t.left)-8),y=Math.max(0,Math.min(r.top,t.top)-8);return {x,y,width:Math.min(innerWidth,Math.max(r.right,t.right)+8)-x,height:Math.min(innerHeight,Math.max(r.bottom,t.bottom)+8)-y}})()`);
    if(focus)fs.writeFileSync(path.join(screenshots,name+'-focus.png'),full.crop(Object.fromEntries(Object.entries(focus).map(([k,v])=>[k,Math.round(v*factor)]))).toPNG());
    const popup=await js(`(()=>{const p=document.querySelector('.cursor-usage-rows:popover-open');if(!p)return null;const r=p.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    if(popup)fs.writeFileSync(path.join(screenshots,name+'-popover.png'),full.crop(Object.fromEntries(Object.entries(popup).map(([k,v])=>[k,Math.round(v*factor)]))).toPNG());

  }
  async function inspect() {
    return js(`(()=>{
      const tile=document.getElementById('home-cursor'),items=[...tile.querySelectorAll('.ai-usage-provider')];
      const box=tile.getBoundingClientRect(),grid=tile.querySelector('.ai-usage-providers');
      const fits=r=>r.left>=box.left&&r.right<=box.right+1&&r.top>=box.top&&r.bottom<=box.bottom+1;
      return {ids:items.map(el=>el.dataset.provider),states:items.map(el=>el.dataset.state),
        noTabs:!tile.querySelector('[role=tab], [role=tablist], .ai-usage-tabs'),
        contentOverflow:items.flatMap(el=>{const cell=el.getBoundingClientRect();return [...el.querySelectorAll('.ai-usage-source,.q-compact-caption,.q-ring,.q-ring-center,.q-ring .q-pct,.cursor-usage-footnote')].filter(n=>n.checkVisibility()).flatMap(n=>{const r=n.getBoundingClientRect();return r.left<cell.left-1||r.right>cell.right+1||r.top<cell.top-1||r.bottom>cell.bottom+1?[el.dataset.provider+':'+n.className]:[];});}),
        overflow:tile.scrollWidth>tile.clientWidth||tile.scrollHeight>tile.clientHeight,
        ringsFit:items.every(el=>fits(el.querySelector('.q-ring').getBoundingClientRect())),
        cellsFit:items.every(el=>fits(el.getBoundingClientRect())),
        gridScroll:grid.scrollHeight>grid.clientHeight+1,
        cols:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        rows:getComputedStyle(grid).gridTemplateRows.split(' ').length,
        summary:!!grid.querySelector('.q-summary'),
        more:tile.querySelector('.q-more-ring')?.textContent||(!tile.querySelector('#ai-usage-more').hidden?tile.querySelector('#ai-usage-more').textContent:'')||'',
        title:tile.querySelector('#ai-usage-title').textContent,
        percentagesFit:items.every(el=>[...el.querySelectorAll('.q-pct')].every(v=>v.clientWidth===0||v.scrollWidth<=v.clientWidth+1))};
    })()`);
  }
  try {
    await win.loadFile(path.join(__dirname,'../renderer/index.html'));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await js(`setMode(true);PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'));new Promise(r=>setTimeout(r,550))`);
    await js(`document.documentElement.dataset.liquidGlass='0';document.querySelectorAll('.home-bento > [data-home-module]:not(#home-cursor)').forEach(el=>el.style.visibility='hidden');localStorage.setItem('notch-ai-usage-tab-v1','codex')`);
    // Full names and compact scope labels come from one provider-independent formatter.
    const labelFixtures={
      cursor:{...cursor,billing:{cycleStart:new Date((future-30*86400)*1000).toISOString(),cycleEnd:new Date(future*1000).toISOString()}},
      codex,
      grokbot:{...grokbot,...require('../grokbot-usage').buildSnapshot({usagePercent:20,nextResetTimestampUtc:future},{})},
      claude:{...claude,...require('../claude-usage').buildSnapshot({five_hour:{utilization:20,resets_at:new Date(future*1000).toISOString()},seven_day:{utilization:40,resets_at:new Date(future*1000).toISOString()}})},
      copilot:{ok:true,configured:true,windows:[{id:'premium',label:'Premium',percent:20},{id:'chat',label:'Chat',percent:20},{id:'completions',label:'Completions',percent:20}]},
      antigravity:{ok:true,detected:true,windows:[{id:'gemini-week',label:'Gemini · Weekly',windowMinutes:10080,percent:20,resetsAt:future}]},
      grok:{ok:true,configured:true,primary:{currency:'USD',balance:12.34}},manus:{ok:true,configured:true,windows:[{label:'Credits',unit:'credits',balance:60}]},
    };
    for(const locale of ['zh-CN','en-US']){
      await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'))`);
      await supply(labelFixtures);await resize('large');
      const copy=await js(`Object.fromEntries([...document.querySelectorAll('.ai-usage-provider')].map(p=>[p.dataset.provider,[...p.querySelectorAll('.cursor-usage-rows[popover] .q-window-full')].map(n=>n.firstChild.textContent.trim())]))`);
      assert.deepEqual(copy.cursor,locale==='zh-CN'?['Cursor · 月额度','Other · 月额度']:['Cursor · Monthly quota','Other · Monthly quota']);
      assert.deepEqual(await js(`[...document.querySelectorAll('#ai-provider-cursor .q-inline-rows .q-window-short')].map(n=>n.textContent)`),['Cur','Oth'],locale+' compact Cursor pools keep English abbreviations');
      assert.deepEqual(copy.codex,locale==='zh-CN'?['5 小时额度','周额度']:['5-hour quota','Weekly quota']);
      assert.deepEqual(copy.claude,copy.codex,'Claude cadence names must match Codex');
      assert.deepEqual(copy.grokbot,[locale==='zh-CN'?'周额度':'Weekly quota']);
      assert.deepEqual(copy.copilot,locale==='zh-CN'?['高级请求额度','聊天额度','补全额度']:['Premium requests quota','Chat quota','Completions quota']);
      assert.deepEqual(copy.antigravity,[locale==='zh-CN'?'Gemini · 周额度':'Gemini · Weekly quota']);
      assert.deepEqual(copy.grok,[locale==='zh-CN'?'已入账预付余额':'Posted prepaid balance']);
      assert.deepEqual(copy.manus,[locale==='zh-CN'?'可用积分':'Available credits']);
      assert.doesNotMatch(await js(`document.getElementById('home-cursor').textContent`),/账期|每周额度|每日额度|Billing period|7 天 ·/);
      assert.deepEqual((await inspect()).contentOverflow,[],locale+' eight named sources stay inside their cells');
      assert.equal(await js(`document.querySelector('#ai-provider-copilot .q-main-scope')===null`),true,'an unreported period is not replaced by a pool identity in the ring');
      await capture(`naming-${locale}-overview`);
      assert.equal(await js(`document.querySelector('#ai-provider-copilot .ai-usage-source b').textContent`),'Copilot');
      const poolClipping=await js(`(()=>{const rows=document.querySelector('#ai-provider-copilot .q-inline-rows'),bounds=rows.getBoundingClientRect();return [...rows.querySelectorAll('.ai-quota-row')].flatMap(row=>[...row.querySelectorAll('.q-window-short,.q-pct,.cursor-usage-track')].filter(n=>n.checkVisibility()).flatMap(n=>{const r=n.getBoundingClientRect();return r.top<bounds.top-.5||r.bottom>bounds.bottom+.5?[{pool:row.dataset.pool,node:n.className,top:r.top-bounds.top,bottom:r.bottom-bounds.top,viewport:bounds.height,rowHeight:row.getBoundingClientRect().height,lineHeight:getComputedStyle(n).lineHeight}]:[]}))})()`);
      assert.deepEqual(poolClipping,[],locale+' all three Copilot pool rows fit without scrolling or clipping');
      assert.deepEqual(await js(`[...document.querySelectorAll('#ai-provider-copilot .q-inline-rows .ai-quota-row')].map(row=>[getComputedStyle(row.querySelector('.q-window-short')).textAlign,getComputedStyle(row.querySelector('.q-pct')).textAlign])`),[['left','left'],['left','left'],['left','left']],locale+' labels and percentages start at their fixed columns');
      await supply({cursor:labelFixtures.cursor,codex:labelFixtures.codex,grokbot:labelFixtures.grokbot,claude:labelFixtures.claude});
      for(const size of ['mini','small','medium','large']){
        await resize(size);await capture(`naming-${locale}-${size}`);
        assert.deepEqual((await inspect()).contentOverflow,[],locale+'/'+size+' standardized labels fit');
      }
      for(const id of ['cursor','codex','grokbot','claude']){
        await js(`document.querySelector('#ai-provider-${id} [data-quota-toggle]').click()`);
        assert.equal(await js(`document.querySelector('#${id}-usage-rows .q-window-full').checkVisibility()`),true,'full names remain visible in details');
        await capture(`naming-${locale}-${id}-details`);
        await js(`document.querySelector('#ai-provider-${id} [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      }
    }
    // Monthly Cursor cycles must show a calendar day on the card, not a bare weekday.
    // Domain and live UI both freeze "now" so week-boundary runs stay calendar-form.
    const D = require('../renderer/ai-usage-domain');
    const fixedNow = new Date(2026, 9, 21, 8).getTime();
    const monthBillingTime = new Date(2026, 10, 18, 11, 42).getTime();
    const yearBoundaryTime = new Date(2027, 0, 7, 9, 30).getTime();
    const monthStamp = D.recoveryTime(monthBillingTime, fixedNow);
    const monthDay = D.recoveryTime(monthBillingTime, fixedNow, { compact: true });
    assert.equal(monthStamp, '11/18 11:42');
    assert.equal(monthDay, '11/18');
    assert.equal(D.recoveryTime(yearBoundaryTime, fixedNow), '2027/1/7 09:30');
    assert.equal(D.recoveryTime(yearBoundaryTime, fixedNow, { compact: true }), '2027/1/7');
    const monthBilling = require('../cursor-usage').buildSnapshot({ billingCycleEnd: monthBillingTime }, {}).billing;
    await js(`(()=>{const fixed=${fixedNow};const orig=Date.now.bind(Date);Date.now=()=>fixed;window.__restoreDateNow=()=>{Date.now=orig;delete window.__restoreDateNow;};})()`);
    try {
      await supply({ cursor: { ...cursor, billing: monthBilling } });
      await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
      await resize('small');
      const smallCaption = await js(`document.querySelector('#ai-provider-cursor .q-compact-caption').textContent`);
      assert.equal(smallCaption, `${monthDay} 重置`, 'small calendar captions keep spaces and drop the clock');
      await capture('cursor-monthly-reset-date-small');
      await resize('large');
      assert.equal(await js(`document.querySelector('#ai-provider-cursor .q-compact-caption').textContent`), `${monthStamp} 重置`);
      await capture('cursor-monthly-reset-date');
    } finally {
      await js(`window.__restoreDateNow?.()`);
    }

    // Cursor billing and all provider reset labels share minute precision in the visible UI.
    const billingTime=new Date(2026,9,28,13,4,9).getTime();
    const billing=require('../cursor-usage').buildSnapshot({billingCycleEnd:billingTime},{}).billing;
    for(const locale of ['zh-CN','en-US']) {
      await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'))`);
      await supply({cursor:{...cursor,billing}});
      for(const size of ['mini','small','medium','large']) {
        await resize(size);
        await js(`document.querySelector('#ai-provider-cursor [data-quota-toggle]').click()`);
        assert.equal(await js(`[...document.querySelectorAll('#cursor-usage-rows .ai-quota-help')].every(n=>n.checkVisibility()&&n.textContent.includes('13:04')&&!n.textContent.includes('13:04:09')&&n.scrollWidth<=n.clientWidth+1)`),true,locale+'/'+size+' Cursor billing time uses shared minute precision');
        await capture(`cursor-reset-${locale}-${size}`);
        await js(`document.querySelector('#ai-provider-cursor [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      }
      await supply({cursor:{...cursor,billing:{cycleEnd:'2026-10-28'}}});
      assert.doesNotMatch(await js(`document.querySelector('#cursor-usage-rows .ai-quota-help').textContent`),/\d{2}:\d{2}/,'date-only input must not invent a reset time');
      await supply({cursor:{...cursor,billing:{cycleEnd:null}}});
      assert.equal(await js(`document.querySelector('#cursor-usage-rows .ai-quota-help').textContent===PomeI18n.t('copy.resetTimeUnknown.2446e1')`),true);
    }
    await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
    const minuteReset=billingTime/1000;
    const minuteSources={cursor:{...cursor,billing},codex:{...codex,primary:{percent:20,windowMinutes:300,resetsAt:minuteReset},secondary:null},claude:{...claude,primary:{percent:30,windowMinutes:300,resetsAt:minuteReset},secondary:null},grokbot:{...grokbot,primary:{percent:40,resetsAt:minuteReset}},copilot:{ok:true,configured:true,windows:[{id:'premium',percent:50,resetsAt:minuteReset}]},antigravity:{ok:true,detected:true,windows:[{id:'model',percent:60,windowMinutes:300,resetsAt:minuteReset}]}};
    for(const locale of ['zh-CN','en-US']) {
      await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'))`);
      await supply(minuteSources);await resize('large');
      assert.equal(await js(`[...document.querySelectorAll('#home-cursor .ai-usage-provider')].every(p=> (p.getAttribute('aria-description')||'').includes('13:04')&&!(p.getAttribute('aria-description')||'').includes('13:04:09')&&[...p.querySelectorAll('.ai-quota-help')].every(n=>n.textContent.includes('13:04')&&!n.textContent.includes('13:04:09')))`),true,locale+' all six timed sources use the same minute precision');
    }
    await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
    await supply({cursor:minuteSources.cursor,codex:minuteSources.codex});await resize('large');
    for(const id of ['cursor','codex']) {
      await js(`document.querySelector('#ai-provider-${id} [data-quota-toggle]').click()`);
      await capture(`uniform-minute-${id}`);
      await js(`document.querySelector('#ai-provider-${id} [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    }
    await supply({claude,copilot:{ok:true,configured:true,windows:[{percent:20}]}});
    for(const dimensions of [designSizes,currentSizes]){
      await resize('small',dimensions);
      assert.equal(await js(`[...document.querySelectorAll('#home-cursor .ai-usage-source b')].every(n=>n.scrollWidth<=n.clientWidth+1&&n.scrollHeight<=n.clientHeight+1)`),true,'small two-column source names remain complete');
      assert.deepEqual((await inspect()).contentOverflow,[]);
    }
    await capture('small-long-source-names');
    // A small card with one auth error and two healthy providers must contain
    // each title, value and repair link inside its own source cell.
    await supply({cursor:{...cursor,auto:{percent:50},other:{percent:50}},codex:{...codex,primary:{percent:50},secondary:{percent:50}},grokbot,copilot:invalid});
    await resize('small',currentSizes);await capture('small-error-regression');
    assert.deepEqual((await inspect()).contentOverflow,[],'small source cells must contain their content');
    assert.equal(await js(`['cursor','codex'].every(id=>{const n=document.querySelector('#ai-provider-'+id+' .q-ring .q-pct');return parseFloat(getComputedStyle(n).fontSize)>=5&&n.scrollWidth<=n.clientWidth+1})`),true,'healthy remaining values stay readable');
    assert.equal(await js(`document.querySelector('#ai-provider-copilot .q-alert').getBoundingClientRect().height>=9`),true,'the error icon must not collapse');
    assert.equal(await js(`[...document.querySelectorAll('#home-cursor .q-compact-caption')].every(el=>el.scrollWidth<=el.clientWidth+1)`),true,'compact explanations remain within their source cells');
    // The short window stays on the dashboard even when the weekly pool is nearly exhausted.
    const shortWindow={...codex,primary:{percent:20,windowMinutes:300,resetsAt:Date.now()/1000+3*3600},secondary:{percent:99,windowMinutes:10080,resetsAt:future}};
    await supply({codex:shortWindow,claude:{...claude,primary:{percent:5,windowMinutes:300,resetsAt:future}}});
    for(const size of ['mini','small','medium','large']) {
      await resize(size);
      const reading=await js(`(()=>{const p=document.getElementById('ai-provider-codex'),ring=p.querySelector('.q-ring');return {value:ring.getAttribute('aria-valuenow'),scope:p.dataset.quotaWindow,state:p.dataset.state,label:ring.getAttribute('aria-label'),values:[...p.querySelectorAll('.cursor-usage-rows[popover] .ai-quota-row strong')].map(n=>n.textContent)}})()`);
      assert.equal(reading.value,'80',size+' dashboard uses five hours, not the one-percent weekly balance');
      assert.equal(reading.scope,'primary');assert.equal(reading.state,'critical');assert.match(reading.label,/5 小时额度/);
      assert.deepEqual(reading.values,['80%','1%']);
      assert.deepEqual((await inspect()).contentOverflow,[]);
      await capture(`shortest-window-${size}`);
      await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').click()`);
      assert.equal(await js(`document.getElementById('codex-usage-rows').checkVisibility()`),true);
      await capture(`shortest-window-${size}-details`);
      await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    }
    await supply({codex:{...shortWindow,windows:[{id:'model-week',label:'Long model',percent:99,windowMinutes:10080,resetsAt:future},{id:'model-short',label:'Short model',percent:20,windowMinutes:300,resetsAt:future}]}});await resize('mini');
    assert.match(await js(`document.getElementById('ai-usage-footer').textContent`),/Codex.*周.*1%/,'mini summarizes the bottleneck while the ring keeps five hours');
    await supply({codex:{...shortWindow,secondary:{...shortWindow.secondary,percent:100}}});
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring').getAttribute('aria-valuenow')`),'80','weekly changes do not replace the five-hour reading');
    await supply({codex:{...shortWindow,primary:{...shortWindow.primary,percent:35}}});await resize('small');
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring').getAttribute('aria-valuenow')`),'65','refresh reflects changes in the five-hour window');
    await capture('shortest-window-updated');
    await supply({codex:{...shortWindow,primary:null}});
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring').getAttribute('aria-valuenow')`),'1','weekly-only data remains usable');
    await supply({codex:{...shortWindow,primary:{...shortWindow.primary,percent:null}}});
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring').hasAttribute('aria-valuenow')`),false,'missing short-window data does not borrow the weekly reading');
    await supply({codex:shortWindow});
    await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'))`);
    assert.match(await js(`document.querySelector('#ai-provider-codex .q-ring').getAttribute('aria-label')`),/5-hour quota.*80%/);
    await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
    for (const [count,snapshots] of [[2,two],[3,three],[5,five]]) {
      await supply(snapshots);
      for (const size of ['mini','small','medium','large']) {
        await resize(size);
        const view = await inspect();
        assert.equal(view.noTabs,true);
        assert.equal(view.title,'AI 额度');
        assert.equal(view.overflow,false,`${size}/${count} tile overflow`);
        assert.equal(view.ringsFit,true,`${size}/${count} ring clipping`);
        assert.equal(view.cellsFit,true,`${size}/${count} cell clipping`);
        assert.deepEqual(view.contentOverflow,[],`${size}/${count} content crosses source cell bounds`);
        assert.equal(view.percentagesFit,true,`${size}/${count} percentages fit`);
        assert.equal(view.ids.length,size==='mini'&&count>4?3:size==='small'?Math.min(4,count):count);
        if (count===3) assert.deepEqual(view.ids,['mini','small'].includes(size)?['cursor','codex','grokbot']:['cursor','codex','grokbot']);
        // Invalid credentials precede all quota states; small retains the four most urgent sources.
        if (count===5 && size==='mini') assert.deepEqual(view.ids,['copilot','claude','cursor']);
        if (count===5 && size==='small') assert.deepEqual(view.ids,['copilot','claude','cursor','codex']);
        if (count===5 && size==='mini') assert.equal(view.more,'+2');
        if (count===5 && size==='small') assert.equal(view.more,'+1');
        if (count===5 && size==='large') {
          assert.equal(view.summary,false);assert.equal(view.cols,3);assert.equal(view.rows,2);
          // Pure auth-error (no local windows) keeps dashed track + alert.
          assert.equal(await js(`document.querySelector('#ai-provider-copilot .q-ring-track').hasAttribute('stroke-dasharray')`),true);
          assert.equal(await js(`document.querySelector('#ai-provider-copilot .q-alert')!=null`),true);
        }
        if (size==='medium') {assert.equal(view.cols,count<=4?count:3);assert.equal(view.gridScroll,false,'up to five providers fit simultaneously');}

        await capture(`${size}-${count}ai`);
        if(count===2 && size!=='mini') {
          assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
          await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').click()`);
          assert.equal(await js(`document.getElementById('codex-usage-rows').matches(':popover-open')`),true);
          await capture(`${size}-2ai-details`);
          await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
          assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
          await js(`document.getElementById('ai-provider-cursor').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`);
          assert.equal(await js(`document.getElementById('cursor-usage-rows').matches(':popover-open')`),false,'hover details wait before opening');
          await new Promise((r) => setTimeout(r, 1100));
          assert.equal(await js(`document.getElementById('cursor-usage-rows').matches(':popover-open')`),true);
          assert.equal(await js(`!document.getElementById('ai-provider-cursor').title`),true,'native title tooltip must stay off');
          assert.match(await js(`document.querySelector('#cursor-usage-rows .ai-usage-detail-updated')?.textContent || ''`),/更新于/);
          await js(`document.getElementById('ai-provider-cursor').dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}))`);
          assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
        }
        await resize(size,currentSizes);
        const real = await inspect();
        assert.equal(real.overflow,false,`${size}/${count} actual home overflow`);
        assert.equal(real.ringsFit,true,`${size}/${count} actual home rings`);
        assert.deepEqual(real.contentOverflow,[],`${size}/${count} actual home cell content`);
        if (size==='medium') assert.equal(real.gridScroll,false,'five providers fit actual home dimensions');
      }
    }
    await supply({cursor:{...cursor,stale:true},codex:{...codex,manualTokenInvalid:true},grokbot});
    await resize('small',currentSizes);
    assert.deepEqual((await inspect()).contentOverflow,[],'stale and local-fallback values stay in their cells');
    assert.equal(await js(`!!document.querySelector('#ai-provider-cursor .q-ring .q-pct')&&!!document.querySelector('#ai-provider-codex .q-alert')`),true,'status text must not squeeze remaining values into an unreadable row');
    assert.equal(await js(`(()=>{const f=document.querySelector('#ai-provider-codex .cursor-usage-footnote');return f.textContent==='失效去设置'&&f.scrollWidth<=f.clientWidth+1})()`),true,'fallback status and repair action remain complete');
    await capture('small-status-regression');
    await supply({...five,copilot:absent});await resize('mini');
    assert.equal(await js(`(()=>{const f=document.getElementById('ai-usage-footer');return f.scrollWidth<=f.clientWidth+1&&!f.title&&f.getAttribute('aria-label')?.includes('Claude')})()`),true,'mini summary fits without native title tooltip');
    await js(`document.getElementById('ai-usage-footer').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    assert.equal(await js(`document.getElementById('claude-usage-rows').matches(':popover-open')`),true,'mini summary opens full details with keyboard');
    assert.equal(await js(`(()=>{const rows=document.getElementById('claude-usage-rows'),help=rows.querySelector('.ai-quota-help');return rows.checkVisibility()&&rows.getBoundingClientRect().height>40&&help.checkVisibility()&&help.textContent.length>0})()`),true,'mini details and reset copy must actually be visible');
    await capture('mini-footer-details');
    await js(`document.getElementById('ai-usage-footer').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
    await supply({...three,claude});await resize('mini');
    assert.equal((await inspect()).ids.length,4);assert.equal((await inspect()).more,'');
    await capture('mini-4ai');
    await supply({...five,grok:{ok:true,configured:true,primary:{currency:'USD',balance:12.34}}});await resize('large');
    assert.equal((await inspect()).summary,false);assert.equal((await inspect()).rows,2);
    assert.equal((await inspect()).ids.length,6);assert.equal((await inspect()).ringsFit,true);
    await capture('large-6ai');
    // Every configured source remains reachable simultaneously at larger sizes, without a source switcher.
    const eight={...five,grok:{ok:true,configured:true,primary:{currency:'USD',balance:12.34}},manus:{ok:true,configured:true,primary:{unit:'credits',balance:60}},antigravity:{ok:true,detected:true,windows:[{label:'Gemini',percent:30}]}};
    await supply(eight);
    for(const size of ['medium','large']){await resize(size);assert.equal((await inspect()).ids.length,8);assert.equal((await inspect()).overflow,false);assert.equal((await inspect()).gridScroll,true);assert.deepEqual((await inspect()).contentOverflow,[],`${size}/8 source cell content`);await capture(`${size}-8ai`);}
    assert.equal(await js(`[...document.querySelectorAll('.ai-usage-source b')].every(n=>getComputedStyle(n).whiteSpace==='nowrap'&&n.closest('.ai-usage-provider').getAttribute('aria-label')===n.getAttribute('aria-label'))`),true,'large names remain single-line with the full accessible name');
    for(const locale of ['en-US','zh-CN']) {
      await js(`PomeI18n.setState(PomeI18n.snapshot('${locale}',['${locale}']));window.dispatchEvent(new Event('pome:language-changed'))`);
      await resize('medium');
      assert.equal(await js(`(()=>{const f=document.querySelector('#ai-provider-copilot .cursor-usage-footnote');return [...f.children].every(n=>n.scrollWidth<=n.clientWidth+1)&&f.scrollWidth<=f.clientWidth+1})()`),true,locale+' error copy and action must not truncate');
    }
    await resize('large');
    assert.match(await js(`document.querySelector('#grok-usage-rows strong').textContent`),/12\.34/);
    assert.equal(await js(`document.querySelector('#manus-usage-rows strong').textContent`),'60');
    for(const id of ['grok','manus']) {
      assert.equal(await js(`document.querySelector('#${id}-usage-rows .cursor-usage-track').hidden`),true);
      assert.equal(await js(`document.querySelector('#ai-provider-${id} .q-ring').hasAttribute('aria-valuenow')`),false);
    }
    const brands=await js(`['grok','grokbot','manus'].map(id=>{const e=document.querySelector('#ai-provider-'+id+' .q-icon');return {id,mask:getComputedStyle(e.querySelector('i')).maskImage,bg:getComputedStyle(e).backgroundColor,tiled:e.classList.contains('q-icon-tiled')}})`);
    assert.equal(brands[0].tiled,false);assert.equal(brands[1].tiled,true);assert.notEqual(brands[0].bg,brands[1].bg);
    for(const icon of brands)assert(icon.mask.includes(icon.id+'.svg'));
    assert.notEqual(brands[0].mask,brands[1].mask,'Grok Bot must not reuse the Grok lettermark');
    // Currency and credits have no percentage denominator: show an alarm without inventing a 0% reading.
    const depleted={grok:{ok:true,configured:true,primary:{currency:'USD',balance:0}},manus:{ok:true,configured:true,primary:{unit:'credits',balance:0}}};
    await supply(depleted);
    for(const size of ['mini','small','medium','large']) {
      await resize(size);
      assert.equal((await inspect()).overflow,false);assert.equal((await inspect()).ringsFit,true);
      for(const [id,copy] of [['grok','余额已耗尽'],['manus','积分已耗尽']]) {
        const alarm=await js(`(()=>{const p=document.getElementById('ai-provider-${id}');return {state:p.dataset.state,level:p.dataset.level,empty:p.dataset.balanceEmpty,title:p.getAttribute('aria-description')||'',aria:p.querySelector('.q-ring').getAttribute('aria-label'),percent:p.querySelector('.q-ring').hasAttribute('aria-valuenow'),alert:!!p.querySelector('.q-alert'),track:getComputedStyle(p.querySelector('.q-ring-track')).stroke,amount:getComputedStyle(p.querySelector('.q-mini-value, .q-pct')).color}})()`);
        assert.equal(alarm.state,'depleted');assert.equal(alarm.level,'critical');assert.equal(alarm.empty,'true');
        assert.match(alarm.title,new RegExp(copy));assert.equal(alarm.percent,false);
        assert.equal(alarm.track,'rgba(255, 120, 110, 0.13)');
        if(size!=='mini') assert.equal(alarm.alert,false);
      }
      if(size!=='mini')assert.equal(await js(`['grok','manus'].every(id=>{const n=document.querySelector('#ai-provider-'+id+' .q-ring .q-pct'),r=n.closest('.q-ring').getBoundingClientRect(),b=n.getBoundingClientRect();return parseFloat(getComputedStyle(n).fontSize)>=${size==='small'?8:10}&&n.scrollWidth<=n.clientWidth+1&&b.left>=r.left&&b.right<=r.right})`),true,size+' amounts fit the final ring diameter and remain complete');
      await capture(`depleted-${size}`);
    }
    await supply({...three,...depleted});await resize('large');
    assert.equal(await js(`document.querySelectorAll('.ai-usage-provider[data-state=depleted]').length`),2);
    assert.equal(await js(`document.querySelector('.q-summary')===null`),true);
    await capture('depleted-large-5ai');
    await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'))`);
    assert.match(await js(`document.getElementById('ai-provider-grok').getAttribute('aria-description')`),/Balance depleted/);
    assert.match(await js(`document.getElementById('ai-provider-manus').getAttribute('aria-description')`),/Credits depleted/);
    await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
    await supply({grok:{...depleted.grok,primary:{currency:'USD',balance:1}},manus:{...depleted.manus,primary:{unit:'credits',balance:1}}});
    assert.equal(await js(`[...document.querySelectorAll('.ai-usage-provider')].every(p=>p.dataset.state==='ok'&&p.dataset.balanceEmpty==='false'&&!p.querySelector('.q-alert'))`),true);
    // With no cadence metadata, keep the source primary statistic instead of choosing its lowest reading.
    await supply({cursor:{...cursor,auto:{percent:10},other:{percent:97}}});await resize('small');
    assert.equal(await js(`document.querySelector('#ai-provider-cursor .q-ring').getAttribute('aria-valuenow')`),'90');
    for(const [used,level] of [[79.9,'ok'],[80,'warn'],[89.9,'warn'],[90,'critical'],[100,'depleted']]){
      await supply({codex:{...codex,primary:{percent:used},secondary:null}});
      assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.state`),level);
    }
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring-value').getAttribute('visibility')`),'hidden','zero must not draw a round-cap dot');
    await supply({codex:{...codex,primary:{percent:null,windowMinutes:10080},secondary:null}});
    assert.equal(await js(`document.querySelector('#codex-usage-rows strong').textContent`),'--%');
    assert.equal(await js(`document.querySelector('#codex-usage-rows [role=progressbar]').hasAttribute('aria-valuenow')`),false);
    assert.equal(await js(`document.querySelector('#codex-usage-rows .q-window-short').textContent`),'周');
    // Preserve stale values, original timestamps, and source hints.
    const oldTime=new Date(Date.now()-120000).toISOString();
    await supply({cursor:{...cursor,stale:true,fetchedAt:oldTime}});await resize('medium');
    assert.equal(await js(`document.getElementById('ai-provider-cursor').dataset.state`),'stale');
    assert.equal(await js(`getComputedStyle(document.querySelector('#ai-provider-cursor .q-gauge-group')).opacity`),'0.45');
    assert.equal(await js(`getComputedStyle(document.querySelector('#ai-provider-cursor .q-compact-caption')).display`),'flex');
    assert.equal(await js(`document.getElementById('cursor-usage-other-pct').textContent`),'41%');
    assert.match(await js(`document.getElementById('ai-provider-cursor').getAttribute('aria-description')`),/数据过期/);
    await capture('state-stale');
    // IPC outages retain successful data without pretending a new fetch succeeded.
    await js(`notchAPI.getCursorUsage=async()=>{throw Error('fixture offline')};NotchAiUsage.refresh({force:true})`);
    assert.equal(await js(`document.getElementById('cursor-usage-other-pct').textContent`),'41%');
    // All provider/state combinations remain bounded in every size.
    for(const size of ['mini','small','medium','large']) {
      await supply({cursor:invalid,codex:{...codex,stale:true},grokbot});await resize(size);
      const view=await inspect();assert.equal(view.overflow,false);assert.equal(view.ringsFit,true);
      assert.equal(await js(`document.querySelector('#ai-provider-cursor .q-ring-track').hasAttribute('stroke-dasharray')`),true);
      assert.match(await js(`document.getElementById('ai-provider-cursor').getAttribute('aria-description')`),/需重新获取 Token/);
      await capture(`states-${size}`);
    }
    await supply({cursor:invalid});await resize('large');
    await js(`document.querySelector('#ai-provider-cursor [data-quota-settings]').click();new Promise(r=>setTimeout(r,250))`);
    assert.equal(await js(`document.activeElement.id`),'settings-cursor-token');
    await supply({codex:{...codex,configured:true,manualTokenInvalid:true,authSource:'local'}});
    assert.match(await js(`document.getElementById('ai-provider-codex').getAttribute('aria-description')`),/Token 失效 · 已改用本机/);
    assert.equal(await js(`document.querySelector('#codex-usage-rows strong').textContent`),'41%');
    assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.state`),'error');
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring-track').hasAttribute('stroke-dasharray')`),true);
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring .q-pct')`),null,'invalid credentials keep quota values only in details');
    assert.equal(await js(`!!document.querySelector('#ai-provider-codex .q-alert')`),true,'invalid credentials always show the centered alert');
    await resize('medium');
    await capture('state-token-local');
    await supply({codex:{ok:true,detected:true,configured:true,manualTokenInvalid:true}});
    assert.match(await js(`document.getElementById('ai-provider-codex').getAttribute('aria-description')`),/Token 失效/);
    await supply({codex:{...codex,authSource:'manual',configured:true,detected:false}});
    assert.match(await js(`document.getElementById('ai-provider-codex').getAttribute('aria-description')`),/手动 Token/);
    assert.match(await js(`document.getElementById('ai-provider-codex').getAttribute('aria-description')`),/Plus/);
    assert.match(await js(`document.getElementById('ai-provider-codex').getAttribute('aria-description')`),/Credits: 20/);
    // A reset which has passed is stale on any provider, not just Codex.
    await supply({grokbot:{...grokbot,primary:{percent:1,resetsAt:Date.now()/1000-1}}});
    assert.equal(await js(`document.getElementById('ai-provider-grokbot').dataset.state`),'stale');
    // Multiple model pools remain scrollable within the tile, and content stays escaped.
    await supply({codex:{...codex,windows:Array.from({length:8},(_,i)=>({id:'model-'+i,label:i===0?'<img src=x onerror=alert(1)>':'Long model '+i,percent:20+i,windowMinutes:300}))}});
    for(const size of ['small','medium','large']) {
      await resize(size);
      await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('#ai-provider-codex [data-quota-toggle]').click()`);
      assert.equal(await js(`document.getElementById('codex-usage-rows').matches(':popover-open')`),true);
      assert.equal(await js(`document.querySelectorAll('#codex-usage-rows .ai-quota-row').length`),8);
      assert.equal(await js(`document.querySelector('#codex-usage-rows img')`),null);
      assert.equal((await inspect()).overflow,false,size+' multiple windows fit');
      assert.equal(await js(`(()=>{const e=document.getElementById('codex-usage-rows');e.scrollTop=10000;return e.scrollHeight>e.clientHeight?e.scrollTop>0:e.getBoundingClientRect().bottom<=e.closest('.ai-usage-provider').getBoundingClientRect().bottom})()`),true,`extra windows fit or scroll in ${size}`);
    }
    await supply({copilot:{ok:true,configured:true,unlimited:true,windows:[]}});
    assert.equal(await js(`document.querySelector('#copilot-usage-rows strong').textContent`),'无限');
    assert.equal(await js(`document.getElementById('ai-provider-copilot').dataset.state`),'ok');
    // Single-source and no-source cases retain their source and settings entry.
    for(const snapshots of [{cursor},{codex},{}]){
      await supply(snapshots);
      for(const size of ['mini','small','medium','large']){
        await resize(size);assert.equal((await inspect()).overflow,false);
        assert.equal(await js(`document.getElementById('ai-usage-empty').hidden`),Object.keys(snapshots).length>0);
        await capture(`${Object.keys(snapshots)[0]||'empty'}-${size}`);
      }
    }
    await js(`document.querySelector('.ai-open-settings').click();new Promise(r=>setTimeout(r,250))`);
    assert.equal(await js(`document.getElementById('tab-settings').getAttribute('aria-hidden')`),'false');
    await supply(three);await resize('medium');await js(`document.documentElement.dataset.liquidGlass='1'`);await capture('medium-3ai-glass');assert.equal((await inspect()).overflow,false);await js(`document.documentElement.dataset.liquidGlass='0'`);
    // A network failure must offer retry, never demand replacement credentials.
    await supply({cursor:{ok:false,detected:true,error:'network'}});await resize('medium');
    assert.doesNotMatch(await js(`document.getElementById('ai-provider-cursor').getAttribute('aria-description')`),/需重新获取 Token/);
    await capture('state-network');
    await supply(five);await resize('large');
    await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'))`);await settle();
    assert.doesNotMatch(await js(`document.getElementById('home-cursor').textContent`),/[\u3400-\u9fff]/);
    assert.equal((await inspect()).overflow,false);assert.equal(await js(`document.querySelector('.q-summary')===null`),true);assert.match(await js(`document.querySelector('#ai-provider-copilot .cursor-usage-footnote').textContent`),/Invalid/);await capture('large-5ai-en');
    await js(`document.getElementById('cursor-usage-refresh').click();new Promise(r=>setTimeout(r,100))`);
    assert.equal(await js('window.quotaForce'),true);
    assert.deepEqual(errors,[]);
    console.log('AI dashboard: simultaneous providers, all sizes, folding, urgency, rings, branded icons, scrolling windows, errors, fallback, locale, refresh and screenshots passed');
  } finally {win.destroy();}
}
main().then(()=>app.quit(),error=>{console.error(error);app.exit(1)});
