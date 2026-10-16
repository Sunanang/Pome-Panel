const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const now = new Date().toISOString();
const cursor = { ok: true, detected: true, authSource: 'local', fetchedAt: now,
  auto: { percent: 40 }, other: { percent: 12 }, grokBot: { percent: 20, resetAt: now }, billing: { cycleEnd: now } };
const codex = { ok: true, detected: true, plan: 'plus', updatedAt: now,
  primary: { percent: 86, windowMinutes: 300, resetsAt: Date.now() / 1000 + 3600 }, secondary: { percent: 10, windowMinutes: 10080, resetsAt: Date.now() / 1000 + 86400 }, credits: { balance: 20 } };
const missing = { ok: true, detected: false, configured: false };
async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 638, show: false, frame: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  const js = (code) => win.webContents.executeJavaScript(code);
  async function capture(name) {
    if (!process.env.AI_USAGE_SCREENSHOTS) return;
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(process.env.AI_USAGE_SCREENSHOTS, name), (await win.webContents.capturePage()).toPNG());
  }
  async function supply(c, d) {
    return js(`(async () => {
      window.fixtureCursor = ${JSON.stringify(c)}; window.fixtureCodex = ${JSON.stringify(d)};
      window.notchAPI = { getCursorUsage: async ({force}) => { window.cursorForce = force; return window.fixtureCursor; },
        getCodexUsage: async () => { window.codexReads = (window.codexReads || 0) + 1; return window.fixtureCodex; } };
      await window.NotchAiUsage.refresh({force:true});
      return document.getElementById('home-cursor').dataset.aiSources;
    })()`);
  }
  async function inspectQuotaLayout(size) {
    const layout = await js(`(() => {
      const tile=document.getElementById('home-cursor'), style=getComputedStyle(tile);
      const rows=[...tile.querySelectorAll('.ai-quota-row')];
      const visible=[...tile.querySelectorAll('.ai-usage-provider')].filter(el=>!el.hidden);
      const shapes=rows.map(row=>[row.className,...[...row.children].map(el=>el.className)].join('|'));
      const tracks=visible.map(provider=>provider.querySelector('.cursor-usage-track'));
      const footnotes=visible.map(provider=>provider.querySelector('.cursor-usage-footnote'));
      const last=visible[visible.length-1];
      const content=last&&[...last.children].filter(el=>getComputedStyle(el).display!=='none').at(-1);
      return {shapes,widths:tracks.map(el=>el.getBoundingClientRect().width),
        heights:tracks.map(el=>getComputedStyle(el).height),
        fullWidth:visible.every(provider=>[...provider.querySelectorAll('.ai-quota-row')].every(row=>Math.abs(row.getBoundingClientRect().width-row.querySelector('.cursor-usage-track').getBoundingClientRect().width)<1)),
        helpBelow:visible.every(provider=>[...provider.querySelectorAll('.ai-quota-row')].every(row=>row.querySelector('.ai-quota-help').getBoundingClientRect().top>=row.querySelector('.cursor-usage-track').getBoundingClientRect().bottom)),
        footnotes:footnotes.map(el=>el.textContent),
        footSingleLine:footnotes.every(el=>getComputedStyle(el).whiteSpace==='nowrap'&&(el.clientHeight===0||el.clientHeight<=parseFloat(getComputedStyle(el).lineHeight)+1)),
        bottomGap:content?tile.getBoundingClientRect().bottom-content.getBoundingClientRect().bottom:null,
        paddingBottom:parseFloat(style.paddingBottom),
        rowCount:last?.querySelectorAll('.ai-quota-row').length,
        rowHeight:last?.querySelector('.ai-quota-row').getBoundingClientRect().height,
        trackHeight:parseFloat(getComputedStyle(tracks[0]||tile).height),
        namesSize:last&&parseFloat(getComputedStyle(last.querySelector('.cursor-usage-meta > span')).fontSize),
        percentSize:last&&parseFloat(getComputedStyle(last.querySelector('.cursor-usage-meta strong')).fontSize),
        percentageFits:visible.every(provider=>[...provider.querySelectorAll('.cursor-usage-meta strong')].every(el=>el.scrollWidth<=el.clientWidth)),
        width:tile.getBoundingClientRect().width,height:tile.getBoundingClientRect().height,
        overflow:tile.scrollWidth>tile.clientWidth};
    })()`);
    assert.ok(layout.shapes.length >= 4, 'unknown quotas retain one placeholder; real windows determine row count');
    assert.equal(new Set(layout.shapes).size, 1, 'both providers must have the same row component and child structure');
    assert.equal(layout.overflow, false);
    assert.equal(layout.footSingleLine, true, 'footnotes must stay on one line');
    assert.equal(layout.percentageFits, true);
    for (const foot of layout.footnotes) assert.doesNotMatch(foot, /手动 Token|本机 Codex|本机 Cursor|Plus|账期至|周重置/);
    if (['medium','large'].includes(size)) {
      assert.equal(layout.fullWidth, true, 'bars must span the whole row');
      assert.equal(layout.helpBelow, true, 'reset and billing information must follow the bar');
      if (layout.widths.length === 2) {
        assert.ok(Math.abs(layout.widths[0]-layout.widths[1])<1, 'providers must have equal bar widths');
        assert.equal(layout.heights[0],layout.heights[1]);
      }
    }
    if (size === 'mini' && layout.rowCount) {
      assert.equal(layout.width,196); assert.equal(layout.height,118);
      assert.ok(layout.bottomGap<=layout.paddingBottom+4, 'mini content must fill the available height');
      assert.ok(layout.bottomGap>=layout.paddingBottom-1, 'mini content must not overflow bottom padding');
      assert.ok(layout.rowCount<=3); assert.equal(layout.namesSize,12); assert.equal(layout.percentSize,12);
      assert.ok(layout.trackHeight>=4 && layout.trackHeight<=5);
    }
    return layout;
  }
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await js('setMode(true); new Promise(r=>setTimeout(r,550))');
    assert.equal(await supply(cursor, codex), 'cursor-codex');
    assert.equal(await js("localStorage.getItem('notch-ai-usage-tab-v1')"), 'codex', 'first default must choose the least remaining quota');
    await js("document.getElementById('home-cursor').dataset.widgetSize='small'; document.getElementById('ai-tab-cursor').click()");
    assert.equal(await js("localStorage.getItem('notch-ai-usage-tab-v1')"), 'cursor');
    await supply(cursor, { ...codex, primary: { percent: 98 } });
    assert.equal(await js("document.getElementById('home-cursor').dataset.aiActive"), 'cursor');
    assert.equal(await js("document.getElementById('ai-tab-codex').dataset.level"), 'critical');
    for (const [used, level] of [[79.9, 'ok'], [80, 'warn'], [94.9, 'warn'], [95, 'critical']]) {
      await supply(cursor, { ...codex, primary: { percent: used }, secondary: null });
      assert.equal(await js("document.getElementById('ai-tab-codex').dataset.level"), level);
      assert.equal(await js("document.getElementById('home-cursor').dataset.aiActive"), 'cursor');
      assert.match(await js("document.getElementById('ai-tab-codex').getAttribute('aria-label')"), /Codex 最少剩余额度：\d+%/);
    }
    await supply(cursor, { ...codex, primary: null, secondary: null });
    assert.equal(await js("document.getElementById('ai-tab-codex').dataset.level"), 'ok');
    assert.equal(await js("document.querySelector('#codex-usage-rows strong').textContent"), '--%');
    assert.equal(await js("document.querySelector('#codex-usage-rows [role=progressbar]').hasAttribute('aria-valuenow')"), false);
    assert.equal(await js("document.querySelector('#codex-usage-rows i').style.width"), '0%');
    // A weekly-only primary is a single weekly row, never a fabricated five-hour pool.
    await supply(missing, { ...codex, primary: { percent: 20, windowMinutes: 10080 }, secondary: null });
    assert.equal(await js("document.querySelectorAll('#codex-usage-rows .ai-quota-row').length"), 1);
    assert.equal(await js("document.querySelector('#codex-usage-rows .cursor-usage-meta > span').textContent"), '每周额度');
    // Extra model windows scroll within every supported tile size.
    await supply(missing, { ...codex, windows: Array.from({length:8}, (_,index)=>({id:`pool-${index}`,label:`Model ${index}`,percent:index*10,windowMinutes:300})) });
    for (const size of ['mini','small','medium','large']) {
      const extra = await js(`(async()=>{
        const tile=document.getElementById('home-cursor'); tile.dataset.widgetSize='${size}';
        tile.style.width='${['mini','small'].includes(size)?196:404}px';
        tile.style.height='${size==='mini'?118:size==='large'?510:248}px';
        await new Promise(r=>setTimeout(r,30));
        const pools=document.querySelector('.ai-usage-providers'); pools.scrollTop=10000;
        return {count:document.querySelectorAll('#codex-usage-rows .ai-quota-row').length,
          overflow:tile.scrollWidth>tile.clientWidth||tile.scrollHeight>tile.clientHeight,scroll:pools.scrollTop};
      })()`);
      assert.equal(extra.count,8); assert.equal(extra.overflow,false,`dynamic windows ${size} stay in tile`);
      if(size!=='large')assert.ok(extra.scroll>0,`dynamic windows ${size} remain reachable`);
    }
    const staleTime = new Date(Date.now()-120000).toISOString();
    await supply({...cursor,stale:true,cached:true,fetchedAt:staleTime},missing);
    assert.match(await js("document.getElementById('cursor-usage-footnote').textContent"), /刷新失败，显示上次数据/);
    assert.equal(await js("document.getElementById('cursor-usage-auto-pct').textContent"),'60%');
    // A real renderer reload must restore the saved selection.
    await js('window.notchAPI=undefined');
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await js('setMode(true); new Promise(r=>setTimeout(r,550))');
    await supply(cursor, codex);
    assert.equal(await js("document.getElementById('home-cursor').dataset.aiActive"), 'cursor');
    const cases = [[cursor, codex, 'cursor-codex'], [cursor, missing, 'cursor'], [missing, codex, 'codex'], [missing, missing, 'none']];
    if (process.env.AI_USAGE_SCREENSHOTS) await js('document.querySelectorAll(".home-bento > [data-home-module]:not(#home-cursor)").forEach(el=>el.style.visibility="hidden")');
    for (const [c, d, sources] of cases) {
      assert.equal(await supply(c, d), sources);
      for (const size of ['mini', 'small', 'medium', 'large']) {
        const layout = await js(`(async () => {
          const tile = document.getElementById('home-cursor');
          tile.dataset.widgetSize='${size}';
          // Keep the fixture visible without changing the user's layout registry or migration.
          Object.assign(tile.style, {position:'fixed',left:'20px',top:'20px',width:'${['mini', 'small'].includes(size) ? 196 : 404}px',height:'${size === 'mini' ? 118 : size === 'large' ? 510 : 248}px',display:'flex'});
          await new Promise(r=>setTimeout(r,50));
          const c=document.getElementById('ai-provider-cursor'), d=document.getElementById('ai-provider-codex');
          return {tabs:!document.getElementById('ai-usage-tabs').hidden,cHidden:c.hidden,dHidden:d.hidden,
            cLeft:c.getBoundingClientRect().left,dLeft:d.getBoundingClientRect().left,
            cTop:c.getBoundingClientRect().top,dTop:d.getBoundingClientRect().top,
            empty:!document.getElementById('ai-usage-empty').hidden,
            cText:document.getElementById('cursor-usage-auto-pct').textContent,
            cWidth:document.getElementById('cursor-usage-auto-fill').style.width,
            cLabel:document.querySelector('#cursor-usage-rows [role=progressbar]').getAttribute('aria-label'),
            cValue:document.querySelector('#cursor-usage-rows [role=progressbar]').getAttribute('aria-valuenow'),
            dText:document.querySelector('#codex-usage-rows strong').textContent,
            dWidth:document.querySelector('#codex-usage-rows i').style.width,
            dValue:document.querySelector('#codex-usage-rows [role=progressbar]').getAttribute('aria-valuetext'),
            title:tile.getAttribute('aria-label'),
            settingsPercent:document.getElementById('settings-codex-percent').textContent,
            sourceSize:parseFloat(getComputedStyle(document.querySelector('#ai-provider-cursor .ai-usage-source b')).fontSize),
            tabSize:parseFloat(getComputedStyle(document.getElementById('ai-tab-cursor')).fontSize),
            percentOverflow:[...tile.querySelectorAll('.cursor-usage-meta strong')].some(el=>el.scrollWidth>el.clientWidth && el.clientWidth>0),
            overflowX:tile.scrollWidth>tile.clientWidth, overflowY:tile.scrollHeight>tile.clientHeight};
        })()`);
        assert.equal(layout.empty, sources === 'none');
        assert.equal(layout.tabs, sources === 'cursor-codex' && ['mini', 'small'].includes(size));
        assert.equal(layout.overflowX, false, `${sources} ${size} horizontal overflow`);
        assert.equal(layout.overflowY, false, `${sources} ${size} vertical overflow`);
        assert.equal(layout.percentOverflow, false, `${sources} ${size} percent text must fit`);
        assert.match(layout.title, /剩余额度$/);
        assert.equal(layout.sourceSize, size === 'mini' ? 12 : 13);
        assert.equal(layout.tabSize, size === 'mini' ? 12 : 13);
        if (c === cursor) {
          assert.equal(layout.cText, '60%'); assert.equal(layout.cWidth, '60%');
          assert.equal(layout.cLabel, 'Cursor Auto 剩余额度'); assert.equal(layout.cValue, '60');
        }
        if (d === codex) {
          assert.equal(layout.dText, '14%'); assert.equal(layout.dWidth, '14%');
          assert.equal(layout.dValue, '14%');
          assert.equal(layout.settingsPercent, '5 小时 14% · 每周 90%');
        }
        if (sources === 'cursor-codex' && size === 'medium') { assert.equal(layout.cHidden, false); assert.equal(layout.dHidden, false); assert.ok(layout.dLeft > layout.cLeft); assert.equal(layout.dTop, layout.cTop); }
        if (sources === 'cursor-codex' && size === 'large') assert.ok(layout.dTop > layout.cTop);
        const cursorLayout = await inspectQuotaLayout(size);
        if (sources === 'cursor-codex' && ['mini', 'small'].includes(size)) {
          await js("document.getElementById('ai-tab-codex').click()");
          const codexLayout = await js(`(() => {
            const tile=document.getElementById('home-cursor');
            const foot=document.getElementById('codex-usage-footnote');
            return {overflow:tile.scrollHeight>tile.clientHeight || tile.scrollWidth>tile.clientWidth,
              footVisible:getComputedStyle(foot).display!=='none', text:foot.textContent};
          })()`);
          assert.equal(codexLayout.overflow, false, `Codex tab ${size} overflow`);
          assert.equal(codexLayout.footVisible, size !== 'mini');
          assert.match(codexLayout.text, /^更新于/);
          const codexQuotaLayout = await inspectQuotaLayout(size);
          if (size === 'mini') {
            assert.ok(codexQuotaLayout.rowHeight>cursorLayout.rowHeight, 'two Codex rows must receive more height');
            assert.match(await js("document.getElementById('codex-usage-mini-reset').textContent"), /重置/);
          }
          await capture(`codex-tab-${size}.png`);
          await js("document.getElementById('ai-tab-cursor').click()");
        }
        await capture(`${sources}-${size}.png`);
      }
    }
    await js("document.querySelector('.ai-open-settings').click(); new Promise(r=>setTimeout(r,200))");
    assert.equal(await js("document.getElementById('tab-settings').getAttribute('aria-hidden')"), 'false');
    assert.equal(await js('document.activeElement.id'), 'settings-cursor-token');
    await supply({ ...cursor, ok: false, configured: true, manualTokenInvalid: true }, missing);
    for (const size of ['mini', 'small', 'medium', 'large']) {
      const errorLayout = await js(`(async () => {
        const tile=document.getElementById('home-cursor'); tile.dataset.widgetSize='${size}';
        tile.style.width='${['mini','small'].includes(size) ? 196 : 404}px';
        tile.style.height='${size === 'mini' ? 118 : size === 'large' ? 510 : 248}px';
        await new Promise(r=>setTimeout(r,30));
        return {overflow:tile.scrollHeight>tile.clientHeight || tile.scrollWidth>tile.clientWidth,
          sourceVisible:getComputedStyle(document.querySelector('#ai-provider-cursor .ai-usage-source')).display!=='none'};
      })()`);
      assert.equal(errorLayout.overflow, false, `Cursor invalid ${size} overflow`);
      assert.equal(errorLayout.sourceVisible, true, `Cursor invalid ${size} source label must be visible`);
    }

    assert.equal(await js("document.getElementById('cursor-usage-auto-pct').textContent"), '--%');
    assert.equal(await js("document.getElementById('ai-cursor-source').textContent"), 'Token 失效');
    assert.match(await js("document.getElementById('cursor-usage-footnote').textContent"), /Token 已失效，本机登录也不可用 · 去设置/);
    assert.equal(await js("document.getElementById('cursor-usage-auto-fill').style.width"), '0%');
    assert.equal(await js("document.querySelector('#cursor-usage-rows [role=progressbar]').hasAttribute('aria-valuenow')"), false);
    // Check longest text in mini and edge values without altering the provider data.
    await supply({ ...cursor, auto: { percent: 0 }, other: { percent: 100 }, grokBot: { percent: 125 } },
      { ...codex, primary: { percent: 40.5 }, secondary: null });
    const edge = await js(`(async () => {
      document.getElementById('home-cursor').dataset.widgetSize='mini';
      await new Promise(r=>setTimeout(r,30));
      return {text:[...document.querySelectorAll('#cursor-usage-rows strong')].map(el=>el.textContent),
        widths:[...document.querySelectorAll('#cursor-usage-rows i')].map(el=>el.style.width),
        overflow:[...document.querySelectorAll('#cursor-usage-rows strong')].some(el=>el.scrollWidth>el.clientWidth),
        codexText:document.querySelector('#codex-usage-rows strong').textContent,
        raw:window.fixtureCodex.primary.percent};
    })()`);
    assert.deepEqual(edge.text, ['100%', '0%', '0%']);
    assert.deepEqual(edge.widths, ['100%', '0%', '0%']); assert.equal(edge.overflow, false);
    assert.equal(edge.codexText, '60%'); assert.equal(edge.raw, 40.5);
    await supply(missing, { ...codex, detected:false, configured:true, authSource:'manual' });
    assert.equal(await js("document.getElementById('ai-codex-source').textContent"), '手动 Token · Plus');
    for (const fallback of [false, true]) {
      await supply(missing, { ...(fallback ? codex : missing), configured:true,
        authSource:fallback ? 'local' : null, manualTokenInvalid:true, remoteError:'codex_token_invalid' });
      for (const size of ['mini','small','medium','large']) {
        const layout = await js(`(async () => {
          const tile=document.getElementById('home-cursor'); tile.dataset.widgetSize='${size}';
          tile.style.width='${['mini','small'].includes(size)?196:404}px';
          tile.style.height='${size==='mini'?118:size==='large'?510:248}px';
          await new Promise(r=>setTimeout(r,30));
          const source=document.getElementById('ai-codex-source');
          return {overflow:tile.scrollHeight>tile.clientHeight||tile.scrollWidth>tile.clientWidth,
            label:source.textContent,red:source.classList.contains('is-error'),
            visible:getComputedStyle(source.parentElement).display!=='none',
            guide:!document.getElementById('settings-codex-token-guide').hidden,
            percent:document.querySelector('#codex-usage-rows strong').textContent,
            footer:document.getElementById('codex-usage-footnote').textContent};
        })()`);
        assert.equal(layout.overflow,false,`Codex invalid ${size} overflow`);
        assert.equal(layout.red,true); assert.equal(layout.visible,true); assert.equal(layout.guide,true);
        assert.equal(layout.label,fallback?'Token 失效 · 已改用本机':'Token 失效');
        assert.equal(layout.percent,fallback?'14%':'--%');
        assert.match(layout.footer,/Codex Token 已失效，请重新获取 · 去设置/);
      }
    }
    await js("document.querySelector('#codex-usage-footnote .ai-inline-settings').click(); new Promise(r=>setTimeout(r,200))");
    assert.equal(await js('document.activeElement.id'),'settings-codex-token');
    await supply(missing,{...codex,detected:false,configured:true,authSource:'manual',remoteError:'codex_network_failed',manualTokenInvalid:false});
    assert.match(await js("document.getElementById('codex-usage-footnote').textContent"),/暂时无法联网查询 · 更新于/);
    assert.equal(await js("document.getElementById('settings-codex-token-guide').hidden"),true);
    await supply(cursor, { ...codex, primary: { percent: 86, windowMinutes: 300, resetsAt: Date.now() / 1000 - 10 } });
    assert.equal(await js("document.querySelector('#codex-usage-rows .ai-quota-row').dataset.expired"), 'true');
    assert.equal(await js("document.getElementById('codex-usage-footnote').classList.contains('is-stale')"), true);
    await js("document.getElementById('cursor-usage-refresh').click(); new Promise(r=>setTimeout(r,50))");
    assert.equal(await js('window.cursorForce'), true);
    assert.ok(await js('window.codexReads') > 0);
    assert.deepEqual(errors, []);
    console.log('AI remaining quotas, bar widths, accessible labels, larger source titles, four sizes, tab indicators, errors and settings passed');
  } finally { win.destroy(); }
}
main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
