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
const designSizes = { mini: [189,126], small: [189,264], medium: [389,264], large: [389,540] };
const currentSizes = { mini: [196,118], small: [196,248], medium: [404,248], large: [404,510] };
const screenshots = process.env.AI_USAGE_SCREENSHOTS;
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 700, show: false, frame: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const js = code => win.webContents.executeJavaScript(code);
  const settle = () => js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  async function supply(snapshots) {
    await js(`(async()=>{
      window.quotaFixture=${JSON.stringify(snapshots)};
      const absent=${JSON.stringify(absent)};
      window.notchAPI=Object.fromEntries(NotchAiProviders.usageProviders().map(({id,request})=>[request,async({force})=>{
        window.quotaForce=force;return window.quotaFixture[id]||absent;
      }]));
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
  }
  async function inspect() {
    return js(`(()=>{
      const tile=document.getElementById('home-cursor'),items=[...tile.querySelectorAll('.ai-usage-provider')];
      const box=tile.getBoundingClientRect(),grid=tile.querySelector('.ai-usage-providers');
      const fits=r=>r.left>=box.left&&r.right<=box.right+1&&r.top>=box.top&&r.bottom<=box.bottom+1;
      return {ids:items.map(el=>el.dataset.provider),states:items.map(el=>el.dataset.state),
        noTabs:!tile.querySelector('[role=tab], [role=tablist], .ai-usage-tabs'),
        overflow:tile.scrollWidth>tile.clientWidth||tile.scrollHeight>tile.clientHeight,
        ringsFit:items.every(el=>fits(el.querySelector('.q-ring').getBoundingClientRect())),
        cellsFit:items.every(el=>fits(el.getBoundingClientRect())),
        gridScroll:grid.scrollHeight>grid.clientHeight+1,
        cols:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        rows:getComputedStyle(grid).gridTemplateRows.split(' ').length,
        summary:!!grid.querySelector('.q-summary'),
        more:tile.querySelector('.q-more-ring')?.textContent||tile.querySelector('#ai-usage-footer button')?.textContent||'',
        title:tile.querySelector('#ai-usage-title').textContent,
        percentagesFit:items.every(el=>[...el.querySelectorAll('.q-pct')].every(v=>v.clientWidth===0||v.scrollWidth<=v.clientWidth+1))};
    })()`);
  }
  try {
    await win.loadFile(path.join(__dirname,'../renderer/index.html'));
    await js(`setMode(true);PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'));new Promise(r=>setTimeout(r,550))`);
    await js(`document.documentElement.dataset.liquidGlass='0';document.querySelectorAll('.home-bento > [data-home-module]:not(#home-cursor)').forEach(el=>el.style.visibility='hidden');localStorage.setItem('notch-ai-usage-tab-v1','codex')`);
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
        assert.equal(view.percentagesFit,true,`${size}/${count} percentages fit`);
        assert.equal(view.ids.length,['mini','small'].includes(size)?Math.min(count,3):count);
        if (count===3) assert.deepEqual(view.ids,['cursor','codex','grokbot']);
        // Warn (Claude 18%) precedes auth errors, followed by lowest ok remaining.
        if (count===5 && ['mini','small'].includes(size)) assert.deepEqual(view.ids,['claude','copilot','cursor']);
        if (count===5 && size==='mini') assert.equal(view.more,'+2');
        if (count===5 && size==='small') assert.equal(view.more,'+2 个来源');
        if (count===5 && size==='large') {
          assert.equal(view.summary,true);assert.equal(view.cols,2);assert.equal(view.rows,3);
          assert.match(await js(`document.querySelector('.q-summary').textContent`),/Claude Code18%/);
          assert.match(await js(`document.querySelector('.q-summary').textContent`),/1 个来源需处理/);
          // Pure auth-error (no local windows) keeps dashed track + alert.
          assert.equal(await js(`document.querySelector('#ai-provider-copilot .q-ring-track').hasAttribute('stroke-dasharray')`),true);
          assert.equal(await js(`document.querySelector('#ai-provider-copilot .q-alert')!=null`),true);
        }
        if (size==='medium') {assert.equal(view.cols,Math.min(count,3));assert.equal(view.gridScroll,false,'up to five providers fit simultaneously');}

        await capture(`${size}-${count}ai`);
        if(count===2 && size!=='mini') {
          assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
          await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').click()`);
          assert.equal(await js(`document.getElementById('codex-usage-rows').matches(':popover-open')`),true);
          await capture(`${size}-2ai-details`);
          await js(`document.querySelector('#ai-provider-codex [data-quota-toggle]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
          assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
          await js(`document.getElementById('ai-provider-cursor').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))`);
          assert.equal(await js(`document.getElementById('cursor-usage-rows').matches(':popover-open')`),true);
          await js(`document.getElementById('ai-provider-cursor').dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}))`);
          assert.equal(await js(`!!document.querySelector('.cursor-usage-rows:popover-open')`),false);
        }
        await resize(size,currentSizes);
        const real = await inspect();
        assert.equal(real.overflow,false,`${size}/${count} actual home overflow`);
        assert.equal(real.ringsFit,true,`${size}/${count} actual home rings`);
        if (size==='medium') assert.equal(real.gridScroll,false,'five providers fit actual home dimensions');
      }
    }
    await supply({...three,claude});await resize('mini');
    assert.equal((await inspect()).ids.length,4);assert.equal((await inspect()).more,'');
    await capture('mini-4ai');
    await supply({...five,grok:{ok:true,configured:true,primary:{currency:'USD',balance:12.34}}});await resize('large');
    assert.equal((await inspect()).summary,false);assert.equal((await inspect()).rows,3);
    assert.equal((await inspect()).ids.length,6);assert.equal((await inspect()).ringsFit,true);
    await capture('large-6ai');
    // Every configured source remains reachable simultaneously at larger sizes, without a source switcher.
    const eight={...five,grok:{ok:true,configured:true,primary:{currency:'USD',balance:12.34}},manus:{ok:true,configured:true,primary:{unit:'credits',balance:60}},antigravity:{ok:true,detected:true,windows:[{label:'Gemini',percent:30}]}};
    await supply(eight);
    for(const size of ['medium','large']){await resize(size);assert.equal((await inspect()).ids.length,8);assert.equal((await inspect()).overflow,false);assert.equal((await inspect()).gridScroll,false);await capture(`${size}-8ai`);}
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
    // Currency and credits have no percentage denominator: show an alarm without inventing a 0% reading.
    const depleted={grok:{ok:true,configured:true,primary:{currency:'USD',balance:0}},manus:{ok:true,configured:true,primary:{unit:'credits',balance:0}}};
    await supply(depleted);
    for(const size of ['mini','small','medium','large']) {
      await resize(size);
      assert.equal((await inspect()).overflow,false);assert.equal((await inspect()).ringsFit,true);
      for(const [id,copy] of [['grok','余额已耗尽'],['manus','积分已耗尽']]) {
        const alarm=await js(`(()=>{const p=document.getElementById('ai-provider-${id}');return {state:p.dataset.state,level:p.dataset.level,empty:p.dataset.balanceEmpty,title:p.title,aria:p.querySelector('.q-ring').getAttribute('aria-label'),percent:p.querySelector('.q-ring').hasAttribute('aria-valuenow'),alert:!!p.querySelector('.q-alert'),track:getComputedStyle(p.querySelector('.q-ring-track')).stroke,amount:getComputedStyle(p.querySelector('.q-mini-value, .q-pct')).color}})()`);
        assert.equal(alarm.state,'critical');assert.equal(alarm.level,'critical');assert.equal(alarm.empty,'true');
        assert.match(alarm.title,new RegExp(copy));assert.equal(alarm.percent,false);
        assert.equal(alarm.track,'rgb(255, 123, 114)');assert.equal(alarm.amount,'rgb(255, 138, 128)');
        if(size!=='mini') assert.equal(alarm.alert,false);
      }
      await capture(`depleted-${size}`);
    }
    await supply({...three,...depleted});await resize('large');
    assert.match(await js(`document.querySelector('.q-summary').textContent`),/2 个来源需处理/);
    await capture('depleted-large-5ai');
    await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'))`);
    assert.match(await js(`document.getElementById('ai-provider-grok').title`),/Balance depleted/);
    assert.match(await js(`document.getElementById('ai-provider-manus').title`),/Credits depleted/);
    await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
    await supply({grok:{...depleted.grok,primary:{currency:'USD',balance:1}},manus:{...depleted.manus,primary:{unit:'credits',balance:1}}});
    assert.equal(await js(`[...document.querySelectorAll('.ai-usage-provider')].every(p=>p.dataset.state==='ok'&&p.dataset.balanceEmpty==='false'&&!p.querySelector('.q-alert'))`),true);
    // Ring uses every window, even when a compact view folds window details.
    await supply({cursor:{...cursor,auto:{percent:10},other:{percent:97}}});await resize('small');
    assert.equal(await js(`document.querySelector('#ai-provider-cursor .q-ring').getAttribute('aria-valuenow')`),'3');
    for(const [used,level] of [[79.9,'ok'],[80,'warn'],[89.9,'warn'],[90,'critical'],[100,'critical']]){
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
    assert.equal(await js(`getComputedStyle(document.querySelector('#ai-provider-cursor .q-ring')).opacity`),'0.5');
    assert.equal(await js(`getComputedStyle(document.querySelector('#ai-provider-cursor .q-compact-caption')).display`),'block');
    assert.equal(await js(`document.getElementById('cursor-usage-other-pct').textContent`),'41%');
    assert.match(await js(`document.getElementById('ai-provider-cursor').title`),/数据过期/);
    await capture('state-stale');
    // IPC outages retain successful data without pretending a new fetch succeeded.
    await js(`notchAPI.getCursorUsage=async()=>{throw Error('fixture offline')};NotchAiUsage.refresh({force:true})`);
    assert.equal(await js(`document.getElementById('cursor-usage-other-pct').textContent`),'41%');
    // All provider/state combinations remain bounded in every size.
    for(const size of ['mini','small','medium','large']) {
      await supply({cursor:invalid,codex:{...codex,stale:true},grokbot});await resize(size);
      const view=await inspect();assert.equal(view.overflow,false);assert.equal(view.ringsFit,true);
      assert.equal(await js(`document.querySelector('#ai-provider-cursor .q-ring-track').hasAttribute('stroke-dasharray')`),true);
      assert.match(await js(`document.getElementById('ai-provider-cursor').title`),/需重新获取 Token/);
      await capture(`states-${size}`);
    }
    await supply({cursor:invalid});await resize('large');
    await js(`document.querySelector('#ai-provider-cursor [data-quota-settings]').click();new Promise(r=>setTimeout(r,250))`);
    assert.equal(await js(`document.activeElement.id`),'settings-cursor-token');
    await supply({codex:{...codex,configured:true,manualTokenInvalid:true,authSource:'local'}});
    assert.match(await js(`document.getElementById('ai-provider-codex').title`),/Token 失效 · 已改用本机/);
    assert.equal(await js(`document.querySelector('#codex-usage-rows strong').textContent`),'41%');
    assert.equal(await js(`document.getElementById('ai-provider-codex').dataset.state`),'error');
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring-track').hasAttribute('stroke-dasharray')`),true);
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-ring .q-pct').textContent`),'41%');
    assert.equal(await js(`document.querySelector('#ai-provider-codex .q-alert')`),null);
    await resize('medium');
    await capture('state-token-local');
    await supply({codex:{ok:true,detected:true,configured:true,manualTokenInvalid:true}});
    assert.equal(await js(`document.getElementById('ai-codex-source').textContent`),'Token 失效');
    await supply({codex:{...codex,authSource:'manual',configured:true,detected:false}});
    assert.match(await js(`document.getElementById('ai-provider-codex').title`),/手动 Token/);
    assert.match(await js(`document.getElementById('ai-provider-codex').title`),/Plus/);
    assert.match(await js(`document.getElementById('ai-provider-codex').title`),/Credits: 20/);
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
      assert.equal((await inspect()).overflow,false);
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
    assert.doesNotMatch(await js(`document.getElementById('ai-provider-cursor').title`),/需重新获取 Token/);
    await capture('state-network');
    await supply(five);await resize('large');
    await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'))`);await settle();
    assert.doesNotMatch(await js(`document.getElementById('home-cursor').textContent`),/[\u3400-\u9fff]/);
    assert.equal((await inspect()).overflow,false);assert.equal(await js(`document.querySelector('.q-summary button').textContent`),'1 source needs attention');await capture('large-5ai-en');
    await js(`document.getElementById('cursor-usage-refresh').click();new Promise(r=>setTimeout(r,100))`);
    assert.equal(await js('window.quotaForce'),true);
    assert.deepEqual(errors,[]);
    console.log('AI dashboard: simultaneous providers, all sizes, folding, urgency, rings, branded icons, scrolling windows, errors, fallback, locale, refresh and screenshots passed');
  } finally {win.destroy();}
}
main().then(()=>app.quit(),error=>{console.error(error);app.exit(1)});
