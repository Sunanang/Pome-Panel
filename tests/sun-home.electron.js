const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const domain = require('../renderer/domain');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => { console.error('Sun/home regression timed out'); app.exit(1); }, 60000);

async function runPlatform(name) {
  const win = new BrowserWindow({ width: 1240, height: 638, frame: false, show: false,
    webPreferences: { backgroundThrottling: false, partition: `sun-home-${name}`,
      sandbox: false, preload: path.join(__dirname, 'sun-home.preload.js'),
      additionalArguments: [`--sun-test-platform=${name}`] } });
  const errors = [];
  const js = code => win.webContents.executeJavaScript(code).catch(error => {
    console.error('Failed renderer check:', code, 'Console errors:', errors);
    throw error;
  });
  const frames = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  async function until(code) {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise(r => setTimeout(r, 20));
    }
    throw Error(`Timed out: ${code}`);
  }
  async function capture(label) {
    if (!process.env.SUN_HOME_SCREENSHOTS) return;
    fs.mkdirSync(process.env.SUN_HOME_SCREENSHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.SUN_HOME_SCREENSHOTS, `${name}-${label}.png`), (await win.webContents.capturePage()).toPNG());
  }
  async function readLayout() {
    return js(`({hidden:NotchHome.getVisibility().hiddenIds,storedHidden:hiddenHomeModules,
      sizes:{...homeSizes},placements:structuredClone(homeWorkingLayout.placements)})`);
  }
  async function assertBounds(label) {
    await frames();
    const state = await js(`(() => {
      const pop=document.getElementById('sun-location-popover'), p=pop.getBoundingClientRect();
      const b=document.getElementById('panel').getBoundingClientRect();
      return {hidden:pop.hidden,left:p.left,right:p.right,top:p.top,bottom:p.bottom,
        width:p.width,height:p.height,scrollHeight:pop.scrollHeight,clientHeight:pop.clientHeight,
        resultsScroll:pop.querySelector('ul').scrollHeight>pop.querySelector('ul').clientHeight,
        bounds:{left:Math.max(8,b.left+8),right:Math.min(innerWidth-8,b.right-8),
          top:Math.max(8,b.top+8),bottom:Math.min(innerHeight-8,b.bottom-8)}};
    })()`);
    assert.equal(state.hidden, false, label);
    assert(state.width > 0 && state.height > 0, JSON.stringify(state));
    assert(state.left >= state.bounds.left - 1 && state.right <= state.bounds.right + 1, `${label}: ${JSON.stringify(state)}`);
    assert(state.top >= state.bounds.top - 1 && state.bottom <= state.bounds.bottom + 1, `${label}: ${JSON.stringify(state)}`);
    return state;
  }
  async function assertReachable(selector) {
    const reachable = await js(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({block:'nearest'});
      const r=el.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return el===hit || el.contains(hit);
    })()`);
    assert.equal(reachable, true, selector);
  }
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer/index.html'));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await js('setMode(true)');
    const initial = await readLayout();
    if (name === 'win32') {
      assert(!initial.hidden.includes('sun'), 'fresh Windows enables sun: ' + JSON.stringify(await js(`({freshWindowsHome,caps:readPlatformCapabilities(),initial:${JSON.stringify(initial)}})`)));
      assert(initial.hidden.includes('music') && initial.hidden.includes('windows'));
      assert(!initial.storedHidden.includes('music') && !initial.storedHidden.includes('windows'), 'platform restrictions must not overwrite saved preferences');
      assert(domain.validateHomeWidgetLayout({ placements: initial.placements, allowGaps: false }, Object.keys(initial.placements)), 'fresh Windows fills all 48 cells');
    } else {
      assert(initial.hidden.includes('sun'), 'Mac keeps its existing default visibility');
      assert.equal(initial.sizes.pomodoro, 'mini');
      assert.equal(initial.sizes.commands, 'mini');
      assert.deepEqual(initial.placements.inbox, { column: 8, row: 0, width: 4, height: 2 });
    }
    await capture('default-home');
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await until('!!window.NotchHome && !!window.PomeSun');
    assert.deepEqual(await readLayout(), initial, 'default layout survives a reload');
    await js('setMode(true)');

    if (name === 'win32') {
      await js(`(() => {
        const old=NotchDomain.normalizeHomeInboxLayout({order:HOME_ORDER_DEFAULTS,sizes:HOME_SIZE_DEFAULTS,
          hiddenIds:['music','windows','sun'],registry:HOME_MODULE_REGISTRY});
        localStorage.setItem(HOME_ORDER_KEY,JSON.stringify(HOME_ORDER_DEFAULTS));
        localStorage.setItem(HOME_SIZES_KEY,JSON.stringify(HOME_SIZE_DEFAULTS));
        localStorage.setItem(HOME_HIDDEN_MODULES_KEY,'["sun"]');
        localStorage.setItem(HOME_PLACEMENTS_KEY,JSON.stringify(old.placements));
      })()`);
      await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
      await until('!!window.NotchHome && !!window.PomeSun');
      assert.deepEqual(await readLayout(), initial, 'an untouched old Windows default upgrades to the filled, sun-enabled default');
      assert.equal(await js(`localStorage.getItem(HOME_HIDDEN_MODULES_KEY)`), '[]');
      await js('setMode(true)');
    }

    // Explicitly saved user sizes, visibility and gaps must not be replaced by first-run defaults.
    await js(`(() => {
      localStorage.setItem(HOME_SIZES_KEY,JSON.stringify({...homeSizes,sun:'mini',cursor:'mini'}));
      localStorage.setItem(HOME_HIDDEN_MODULES_KEY,JSON.stringify(HOME_MODULE_REGISTRY.filter(id=>id!=='cursor')));
      localStorage.setItem(HOME_PLACEMENTS_KEY,JSON.stringify({cursor:{column:0,row:0,width:2,height:1}}));
    })()`);
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
    await until('!!window.NotchHome && !!window.PomeSun');
    const custom = await readLayout();
    assert(custom.hidden.includes('sun'));
    assert.deepEqual(custom.placements, { cursor: { column: 0, row: 0, width: 2, height: 1 } });
    assert.equal(custom.sizes.cursor, 'mini');
    await js('setMode(true)');

    for (const [column, row] of [[0, 0], [10, 0], [0, 3], [10, 3]]) {
      await js(`(() => {
        PomeSun.closeLocation();
        hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='sun');
        homeSizes.sun='mini';
        homeWorkingLayout={allowGaps:true,placements:{sun:{column:${column},row:${row},width:2,height:1}},variants:{sun:'mini'}};
        applyHomeLayout(homeWorkingLayout,{reason:'initial'});
        PomeSun.setLocation(null,{persist:false});
        document.querySelector('#home-sun [data-sun-place]').click();
      })()`);
      await assertBounds(`corner ${column},${row}`);
      await js(`(() => {const q=document.getElementById('sun-city-query');q.value='a';q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      assert.equal(await js(`document.querySelectorAll('[data-sun-city]').length`), 8);
      await assertBounds('search expands results');
      await assertReachable('#sun-city-results li:last-child [data-sun-city]');
      await js(`document.querySelector('[data-sun-manual]').click()`);
      const manual = await assertBounds('manual form expands content');
      assert(manual.resultsScroll || manual.scrollHeight > manual.clientHeight, 'long content is internally scrollable');
      await js(`(() => {
        const f=document.querySelector('[data-sun-manual-form]');
        f.elements.lat.value='100';f.elements.lng.value='121.47';
        f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      })()`);
      await assertBounds('validation message grows content');
      await assertReachable('[data-sun-manual-error]');
      await assertReachable('[data-sun-manual-form] button');
      await js(`(() => {
        const f=document.querySelector('[data-sun-manual-form]');f.elements.lat.value='31.23';f.elements.name.value='保留的草稿';
        PomeSun.render();window.dispatchEvent(new Event('focus'));
      })()`);
      assert.equal(await js(`document.querySelector('[data-sun-manual-form]').elements.name.value`), '保留的草稿', 'refresh/focus keeps the open form draft');
      if (column === 10 && row === 3) await capture('bottom-right-manual');
    }

    // A configured city anchors at the card header instead of the empty-state footer.
    for (const [size, width, height] of [['mini', 2, 1], ['small', 2, 2], ['medium', 4, 2], ['large', 4, 4]]) {
      await js(`(() => {
        PomeSun.closeLocation();homeSizes.sun=${JSON.stringify(size)};
        homeWorkingLayout={allowGaps:true,placements:{sun:{column:${12 - width},row:${4 - height},width:${width},height:${height}}},variants:{}};
        applyHomeLayout(homeWorkingLayout,{reason:'initial'});
        PomeSun.setLocation({source:'city',id:'fixture',name:'上海',admin:'中国',lat:31.23,lng:121.47,tz:'Asia/Shanghai'},{persist:false});
        PomeSun.openLocation('a');document.querySelector('[data-sun-manual]').click();
        const f=document.querySelector('[data-sun-manual-form]');f.elements.lat.value='31.23';f.elements.lng.value='121.47';f.elements.name.value='保留的草稿';
      })()`);
      await assertBounds(`configured ${size} at bottom edge`);
      await assertReachable('[data-sun-manual-form] button');
    }

    for (const size of [[900, 500], [380, 360], [1240, 638]]) {
      win.setContentSize(...size);
      await assertBounds(`viewport ${size}`);
      await assertReachable('[data-sun-manual-form] button');
    }
    await js(`(() => { const f=document.querySelector('[data-sun-manual-form]');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`);
    assert.equal(await js(`PomeSun.getLocation().source`), 'manual');
    assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true);
    await js(`PomeSun.openLocation('shanghai');document.querySelector('[data-sun-city]').click()`);
    assert.equal(await js(`PomeSun.getLocation().source`), 'city');

    // Every production collapse route must close before IPC/animation completes.
    for (const action of ["document.querySelector('.topbar').click()", 'notchAPI.fixtureCollapse()', 'notchAPI.fixtureToggle()', 'setMode(false)']) {
      await js(`PomeSun.openLocation('a');document.querySelector('[data-sun-manual]').click()`);
      const closedImmediately = await js(`(() => {${action};return document.getElementById('sun-location-popover').hidden;})()`);
      assert.equal(closedImmediately, true, action);
      await until("!modeBusy && document.getElementById('app').classList.contains('collapsed')");
      win.setContentSize(85, 9);
      assert.equal(await js(`getComputedStyle(document.getElementById('sun-location-popover')).display`), 'none', 'no popover remains in the collapsed capsule');
      await js(`window.dispatchEvent(new Event('focus'));PomeSun.render()`);
      assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true);
      win.setContentSize(1240, 638);
      await js('setMode(true)');
      assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true, 'reopening must not restore the popover');
    }
    for (const action of [
      "window.dispatchEvent(new Event('blur'))",
      "document.getElementById('app').classList.add('closing')",
      "document.dispatchEvent(new CustomEvent('notch:modechange',{detail:{expanded:false}}))",
      "document.getElementById('home-sun').hidden=true",
    ]) {
      await js(`PomeSun.openLocation('a');${action}`);
      await frames();
      assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true, action);
      await js(`document.getElementById('app').classList.remove('closing');document.getElementById('home-sun').hidden=false;window.dispatchEvent(new Event('focus'))`);
      assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true);
    }
    await js(`PomeSun.openLocation('a');setActiveTab('notes')`);
    assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true, 'leaving home closes the body-level dialog');
    await js(`setActiveTab('home');PomeSun.openLocation('')`);
    await js(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));`);
    assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true, 'hide/show never restores the open dialog');
    await js(`PomeSun.openLocation('')`);
    assert.equal(await js(`document.querySelector('[data-sun-manual-form]').hidden`), true, 'manual expansion resets on a new explicit open');
    await js(`document.getElementById('sun-city-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    assert.equal(await js(`document.getElementById('sun-location-popover').hidden`), true);

    // Damaged persisted IANA zones must not abort widget startup or prevent
    // opening its city selector; retain coordinates and recover to host time.
    await js(`localStorage.setItem('notch-sun-location-v1',JSON.stringify({lat:39.9042,lng:116.4074,name:'保留的地点',source:'manual',tz:'Asia/NotARealZone'}))`);
    await new Promise(resolve => { win.webContents.once('did-finish-load',resolve);win.webContents.reload(); });
    await until('!!window.PomeSun && !!window.NotchHome');
    assert.equal(await js('PomeSun.getLocation().name'),'保留的地点');
    assert.equal(await js('PomeSun.getLocation().tz'),await js('Intl.DateTimeFormat().resolvedOptions().timeZone'));
    await js('setMode(true)');
    await js(`hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='sun');homeSizes.sun='medium';homeWorkingLayout=null;applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});PomeSun.render()`);
    assert.equal(await js('!!document.querySelector("#home-sun .sun-arc")'),true);
    await capture('invalid-timezone-recovered');
    await js(`PomeSun.openLocation('')`);await assertBounds('recovered timezone city dialog');await js('PomeSun.closeLocation()');
    assert.deepEqual(errors, []);
    console.log(`${name}: homepage defaults, saved preferences and city popover checks passed`);
  } finally { win.destroy(); }
}

app.whenReady().then(async () => {
  await runPlatform('win32');
  await runPlatform('darwin');
  console.log('Windows fresh-home fill, Mac defaults, saved layouts, sun dialog edges/content and collapse lifecycle passed');
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
