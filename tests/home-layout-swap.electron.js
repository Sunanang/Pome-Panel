const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const domain = require('../renderer/domain');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);

const fixtures = [
  { cursor: { column: 0, row: 0, width: 4, height: 4 }, recorder: { column: 4, row: 0, width: 4, height: 4 }, music: { column: 8, row: 0, width: 4, height: 4 } },
  { cursor: { column: 0, row: 0, width: 4, height: 2 }, recorder: { column: 4, row: 0, width: 2, height: 2 },
    music: { column: 6, row: 0, width: 2, height: 2 }, windows: { column: 8, row: 0, width: 4, height: 2 },
    mirror: { column: 0, row: 2, width: 4, height: 2 }, note: { column: 4, row: 2, width: 4, height: 2 }, commands: { column: 8, row: 2, width: 4, height: 2 } },
  { cursor: { column: 0, row: 0, width: 4, height: 2 }, recorder: { column: 0, row: 2, width: 2, height: 2 },
    music: { column: 2, row: 2, width: 2, height: 2 }, windows: { column: 4, row: 0, width: 4, height: 4 }, mirror: { column: 8, row: 0, width: 4, height: 4 } },
  { cursor: { column: 0, row: 0, width: 4, height: 4 }, recorder: { column: 10, row: 2, width: 2, height: 2 },
    music: { column: 8, row: 2, width: 2, height: 2 }, windows: { column: 8, row: 0, width: 4, height: 2 }, mirror: { column: 4, row: 0, width: 4, height: 4 } },
];

async function auditDragScheduling(win) {
  const js = code => win.webContents.executeJavaScript(code);
  const setup = () => js(`(() => {
    document.getElementById('home-layout-cancel').click();
    const placements=${JSON.stringify(fixtures[1])};
    homeSizes={...homeSizes,...Object.fromEntries(Object.entries(placements).map(([id,p])=>[id,NotchDomain.sizeNameFromPlacement(p)]))};
    homeOrder=[...Object.keys(placements),...HOME_MODULE_REGISTRY.filter(id=>!placements[id])];
    hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!placements[id]);
    homeWorkingLayout={allowGaps:false,placements,variants:Object.fromEntries(Object.entries(placements).map(([id,p])=>[id,NotchDomain.layoutVariantForPlacement(p)]))};
    applyHomeLayout(homeWorkingLayout,{reason:'initial'});
    document.getElementById('home-layout-edit').click();
  })()`);
  await setup();
  const scheduled = await js(`(async () => {
    const tile=document.getElementById('home-cursor');
    tile.setPointerCapture=()=>{};tile.hasPointerCapture=()=>false;
    const a=tile.getBoundingClientRect(),b=document.getElementById('home-recorder').getBoundingClientRect(),c=document.querySelector('[data-home-module="commands"]').getBoundingClientRect();
    const center=r=>({clientX:r.left+r.width/2,clientY:r.top+r.height/2});
    const pointer={bubbles:true,cancelable:true,isPrimary:true,pointerId:811,button:0,buttons:1};
    const move=r=>homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,...center(r)}));
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const beforeStored=localStorage.getItem(HOME_PLACEMENTS_KEY);
    const original=NotchDomain.swapHomeWidgetPlacements;
    let plans=0;NotchDomain.swapHomeWidgetPlacements=(...args)=>{plans++;return original(...args)};
    try {
      tile.dispatchEvent(new PointerEvent('pointerdown',{...pointer,...center(a)}));
      for(let i=0;i<300;i++)move(i%2?b:c);
      const beforeFrame=plans;
      await frame();
      const afterFrame=plans;
      const latestPoint=tile.style.getPropertyValue('--home-drag-x')===((center(b).clientX-center(a).clientX)+'px');
      move(c);await frame();move(b);await frame();
      const cachedPlans=plans;
      const placeholder=homeBento.querySelector('.home-swap-placeholder');
      move(c);await frame();
      const reusedPlaceholder=placeholder===homeBento.querySelector('.home-swap-placeholder');
      await new Promise(resolve=>setTimeout(resolve,250));
      const displacedBefore=targetPosition();
      move(a);await frame();
      await new Promise(resolve=>setTimeout(resolve,40));
      const returning=targetPosition();
      const smoothReturn=returning>displacedBefore+1 && returning<c.left-1;
      function targetPosition(){return document.querySelector('[data-home-module="commands"]').getBoundingClientRect().left;}
      // Release at b without a matching pointermove: use the actual release,
      // not the last rendered c preview. Pending paints cannot override it.
      homeBento.dispatchEvent(new PointerEvent('pointerup',{...pointer,...center(b),buttons:0}));
      const releasedAtB=homeWorkingLayout.placements.cursor.column===4 && homeWorkingLayout.placements.cursor.row===0;
      const landing=homeLayoutMotionAnimations.some(animation=>animation.effect.getTiming().duration===260);
      await Promise.allSettled(homeLayoutMotionAnimations.map(animation=>animation.finished));
      await frame();
      const stable=!homeBento.classList.contains('layout-motion-active') && !homeBento.querySelector('.home-swap-placeholder') && !tile.style.getPropertyValue('--home-drag-x');
      return {beforeFrame,afterFrame,latestPoint,cachedPlans,reusedPlaceholder,smoothReturn,releasedAtB,landing,stable,
        unsaved:beforeStored===localStorage.getItem(HOME_PLACEMENTS_KEY)};
    } finally { NotchDomain.swapHomeWidgetPlacements=original; }
  })()`);
  assert.deepEqual(scheduled, {beforeFrame:0,afterFrame:1,latestPoint:true,cachedPlans:2,reusedPlaceholder:true,smoothReturn:true,releasedAtB:true,landing:true,stable:true,unsaved:true});

  win.webContents.debugger.attach('1.3');
  for (const reduced of [false, true]) {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
    assert.equal(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`),reduced);
    for (const ending of ['pointercancel', 'blur', 'release']) {
      await setup();
      const result=await js(`(async () => {
        const tile=document.getElementById('home-cursor'),target=document.getElementById('home-recorder');
        tile.setPointerCapture=()=>{};tile.hasPointerCapture=()=>false;
        const a=tile.getBoundingClientRect(),b=target.getBoundingClientRect();
        const pointer={bubbles:true,cancelable:true,isPrimary:true,pointerId:812,button:0,buttons:1};
        const end={clientX:b.left+b.width/2,clientY:b.top+b.height/2};
        const before=JSON.stringify(homeWorkingLayout),stored=localStorage.getItem(HOME_PLACEMENTS_KEY);
        tile.dispatchEvent(new PointerEvent('pointerdown',{...pointer,clientX:a.left+8,clientY:a.top+8}));
        homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,...end}));
        if(${JSON.stringify(ending)}==='blur')window.dispatchEvent(new Event('blur'));
        else homeBento.dispatchEvent(new PointerEvent(${JSON.stringify(ending === 'release' ? 'pointerup' : 'pointercancel')},{...pointer,...end,buttons:0}));
        const hasLanding=homeLayoutMotionAnimations.length>0;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {changed:before!==JSON.stringify(homeWorkingLayout),unsaved:stored===localStorage.getItem(HOME_PLACEMENTS_KEY),
          cleared:!homeBento.querySelector('.home-swap-placeholder')&&!homeBento.classList.contains('layout-dragging')&&!tile.style.getPropertyValue('--home-drag-x'),hasLanding};
      })()`);
      assert.deepEqual(result,{changed:ending==='release',unsaved:true,cleared:true,hasLanding:ending==='release'&&!reduced},`${ending}, reduced=${reduced}: queued pointer events must not outlive cancellation`);
    }
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
  win.webContents.debugger.detach();
  await js(`document.getElementById('home-layout-cancel').click()`);
  console.log('Homepage drag: frame coalescing, cached previews, actual release target, cancelled queued frames, reduced motion and stable landing passed');
}

async function auditUiLifecycle(win) {
  const js = code => win.webContents.executeJavaScript(code);
  const shots = process.env.UI_LIFECYCLE_SHOTS || path.join(__dirname, '../dist.noindex/ui-lifecycle');
  fs.mkdirSync(shots, { recursive: true });
  const capture = async name => {
    await js('document.querySelector("#ui-capsule-hint button")?.click();dismissStatusToast(false);document.fonts.ready');
    await js('Promise.allSettled(homeLayoutMotionAnimations.map(animation=>animation.finished))');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  for (const [cancel, active] of [['escape', false], ['escape', true], ['cancel', true], ['blur', false], ['tab', true], ['collapse', false]]) {
    const result = await js(`(async () => {
      document.getElementById('home-layout-cancel').click();
      await setActiveTab('home');
      if (!isExpanded) await setMode(true);
      document.getElementById('home-layout-edit').click();
      const before=JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes,order:homeOrder});
      const stored=[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_PLACEMENTS_KEY].map(key=>localStorage.getItem(key));
      const tile=document.getElementById('home-cursor'),target=document.getElementById('home-recorder');
      tile.setPointerCapture=()=>{};tile.hasPointerCapture=()=>false;
      const a=tile.getBoundingClientRect(),b=target.getBoundingClientRect();
      const pointer={bubbles:true,cancelable:true,isPrimary:true,pointerId:73,button:0,buttons:1};
      const end={clientX:b.left+b.width/2,clientY:b.top+b.height/2};
      tile.dispatchEvent(new PointerEvent('pointerdown',{...pointer,clientX:a.left+8,clientY:a.top+8}));
      if (${active}) homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,...end}));
      const started=homeBento.classList.contains('layout-dragging');
      switch (${JSON.stringify(cancel)}) {
        case 'escape':document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));break;
        case 'cancel':document.getElementById('home-layout-cancel').click();break;
        case 'blur':window.dispatchEvent(new Event('blur'));break;
        case 'tab':await setActiveTab('notes');await setActiveTab('home');break;
        case 'collapse':await setMode(false);await setMode(true);break;
      }
      await new Promise(resolve=>setTimeout(resolve,170));
      const cancelled=!homeBento.classList.contains('layout-dragging')&&!tile.classList.contains('is-dragging')
        &&!homeBento.querySelector('.home-swap-placeholder');
      homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,...end}));
      homeBento.dispatchEvent(new PointerEvent('pointerup',{...pointer,...end,buttons:0}));
      const unchanged=before===JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes,order:homeOrder});
      const persisted=JSON.stringify(stored)===JSON.stringify([HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_PLACEMENTS_KEY].map(key=>localStorage.getItem(key)));
      document.getElementById('home-layout-cancel').click();
      return {started,cancelled,unchanged,persisted};
    })()`);
    assert.equal(result.started, active, `${cancel}: fixture starts the expected press/drag`);
    assert.equal(result.cancelled, true, `${cancel}: delayed or active drag is cancelled`);
    assert.equal(result.unchanged, true, `${cancel}: release after cancellation cannot swap cards`);
    assert.equal(result.persisted, true, `${cancel}: release after cancellation cannot persist a swap`);
  }
  await capture('layout-cancelled');
  const dock = await js(`(async () => {
    const surface=document.createElement('div'),item=document.createElement('button');
    surface.style.cssText='position:fixed;left:20px;top:20px;width:100px;height:50px';
    item.className='window-item';item.style.cssText='display:block;width:100px;height:50px';
    surface.append(item);document.body.append(surface);bindDockSurface(surface,'.window-item',1.12);
    const r=item.getBoundingClientRect();
    surface.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
    surface.dispatchEvent(new PointerEvent('pointerleave'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const values=['--dock-scale','--dock-lift','--dock-glow'].map(key=>item.style.getPropertyValue(key));
    surface.remove();return values;
  })()`);
  assert.deepEqual(dock, ['', '', ''], 'Dock leave cancels a queued hover repaint in the real DOM');

  const mirror = await js(`(async () => {
    hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='mirror');homeSizes.mirror='large';homeWorkingLayout=null;
    applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});
    const originalCapture=navigator.mediaDevices.getUserMedia,originalPlay=mirrorVideo.play;
    const requests=[],plays=[],counts=[0,0];
    const streams=counts.map((_,index)=>{
      const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
      canvas.getContext('2d').fillRect(0,0,2,2);
      const stream=canvas.captureStream(1),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
      track.stop=()=>{counts[index]++;stop();};return stream;
    });
    navigator.mediaDevices.getUserMedia=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
    mirrorVideo.play=()=>new Promise(resolve=>plays.push(resolve));
    try {
      const first=startMirror();await new Promise(resolve=>setTimeout(resolve,0));stopMirror();
      const second=startMirror();await new Promise(resolve=>setTimeout(resolve,0));
      requests[0].resolve(streams[0]);requests[1].resolve(streams[1]);
      await new Promise(resolve=>setTimeout(resolve,0));
      const adopted=mirrorStream===streams[1],onlyLatestPlays=plays.length===1,starting=mirrorStarting;
      plays.forEach(resolve=>resolve());await Promise.all([first,second]);stopMirror();
      return {counts,adopted,onlyLatestPlays,starting,stopped:!mirrorStream&&!mirrorVideo.srcObject&&!homeMirror.classList.contains('live')};
    } finally {
      stopMirror();streams.forEach(stream=>stream.getTracks().filter(track=>track.readyState!=='ended').forEach(track=>track.stop()));
      navigator.mediaDevices.getUserMedia=originalCapture;mirrorVideo.play=originalPlay;
    }
  })()`);
  assert.equal(mirror.adopted, true);
  assert.equal(mirror.onlyLatestPlays, true, 'cancelled stream never reaches video.play');
  assert.equal(mirror.starting, true, 'cancelled finally does not clear the next attempt');
  assert.deepEqual(mirror.counts, [1, 1], 'both synthetic tracks are released exactly once');
  assert.equal(mirror.stopped, true);
  await capture('mirror-cancelled');
  console.log('UI lifecycle: cancelled drags cannot swap, Dock leave cannot repaint, camera restart releases every synthetic track');
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 638, show: false, webPreferences: { backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await js("PomeI18n.setState(PomeI18n.snapshot('zh-CN', ['zh-CN'])); true");
    await js('setMode(true); new Promise(r=>setTimeout(r,550))');
    for (const placements of fixtures) {
      const sizes = Object.fromEntries(Object.entries(placements).map(([id, item]) => [id, domain.sizeNameFromPlacement(item)]));
      await js(`(() => {
        document.getElementById('home-layout-cancel').click();
        homeSizes={...homeSizes,...${JSON.stringify(sizes)}};
        homeOrder=[...${JSON.stringify(Object.keys(placements))},...HOME_MODULE_REGISTRY.filter(id=>!${JSON.stringify(Object.keys(placements))}.includes(id))];
        hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!${JSON.stringify(Object.keys(placements))}.includes(id));
        homeWorkingLayout={allowGaps:false,placements:${JSON.stringify(placements)},variants:{}};
        for(const [id,p] of Object.entries(homeWorkingLayout.placements)) homeWorkingLayout.variants[id]=NotchDomain.layoutVariantForPlacement(p);
        applyHomeLayout(homeWorkingLayout,{reason:'initial'});
        document.getElementById('home-layout-edit').click();
      })()`);
      const result = await js(`(async () => {
        const tile=document.getElementById('home-cursor'), target=document.getElementById('home-recorder');
        tile.setPointerCapture=()=>{}; tile.hasPointerCapture=()=>false;
        const source=tile.getBoundingClientRect(), destination=target.getBoundingClientRect();
        const start={clientX:source.left+source.width/2,clientY:source.top+source.height/2};
        const end={clientX:destination.left+destination.width/2,clientY:destination.top+destination.height/2};
        const pointer={bubbles:true,cancelable:true,isPrimary:true,pointerId:1,button:0,buttons:1};
        const beforeSizes={...homeSizes};
        tile.dispatchEvent(new PointerEvent('pointerdown',{...pointer,...start}));
        homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,...end}));
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const placeholder=homeBento.querySelector('.home-swap-placeholder');
        const preview={width:placeholder?.offsetWidth,height:placeholder?.offsetHeight,
          expectedWidth:tile.offsetWidth,expectedHeight:tile.offsetHeight,
          targetWidth:target.offsetWidth,targetHeight:target.offsetHeight,
          sourceSize:tile.dataset.widgetSize,targetSize:target.dataset.widgetSize};
        homeBento.dispatchEvent(new PointerEvent('pointerup',{...pointer,...end,buttons:0}));
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const after={layout:structuredClone(homeWorkingLayout),sizes:{...homeSizes},beforeSizes,
          sourceSize:tile.dataset.widgetSize,targetSize:target.dataset.widgetSize,
          previewCleared:!homeBento.querySelector('.home-swap-placeholder')};
        NotchUi.showError({diagnostic:'layout_invalid',scope:'home:layout'});
        document.getElementById('home-layout-save').click();
        return {...after,preview,errorCleared:document.getElementById('ui-error-bar').hidden,stored:JSON.parse(localStorage.getItem(HOME_PLACEMENTS_KEY))};
      })()`);
      assert.equal(result.preview.width,result.preview.expectedWidth,'drop placeholder keeps dragged width');
      assert.equal(result.preview.height,result.preview.expectedHeight,'drop placeholder keeps dragged height');
      assert.equal(result.sourceSize,sizes.cursor); assert.equal(result.targetSize,sizes.recorder);
      assert.equal(result.preview.targetSize,sizes.recorder);
      assert.deepEqual(result.sizes,result.beforeSizes,'swap must not overwrite saved size preferences');
      assert.equal(domain.validateHomeWidgetLayout(result.layout,Object.keys(placements)),true);
      assert.deepEqual(result.stored,result.layout.placements);
      assert.equal(result.previewCleared,true);
      assert.equal(result.errorCleared,true,'a saved swap clears the matching layout failure');
      for(const [id,before] of Object.entries(placements)) {
        assert.equal(result.layout.placements[id].width,before.width,id);
        assert.equal(result.layout.placements[id].height,before.height,id);
      }
      assert.equal(result.layout.placements.cursor.column,Math.min(placements.recorder.column,12-placements.cursor.width));
      assert.equal(result.layout.placements.cursor.row,Math.min(placements.recorder.row,4-placements.cursor.height));
    }
    const failure = await js(`(() => {
      document.getElementById('home-layout-edit').click();
      const before=JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes,order:homeOrder});
      const stored=localStorage.getItem(HOME_PLACEMENTS_KEY);
      const real=NotchDomain.swapHomeWidgetPlacements;
      NotchDomain.swapHomeWidgetPlacements=()=>null;
      try {
        const tile=document.getElementById('home-cursor'), target=document.getElementById('home-recorder');
        const a=tile.getBoundingClientRect(),b=target.getBoundingClientRect();
        const pointer={bubbles:true,cancelable:true,isPrimary:true,pointerId:1,button:0,buttons:1};
        tile.dispatchEvent(new PointerEvent('pointerdown',{...pointer,clientX:a.left+8,clientY:a.top+8}));
        homeBento.dispatchEvent(new PointerEvent('pointermove',{...pointer,clientX:b.left+b.width/2,clientY:b.top+b.height/2}));
        homeBento.dispatchEvent(new PointerEvent('pointerup',{...pointer,clientX:b.left+b.width/2,clientY:b.top+b.height/2,buttons:0}));
        return {unchanged:before===JSON.stringify({layout:homeWorkingLayout,sizes:homeSizes,order:homeOrder}),
          persisted:stored===localStorage.getItem(HOME_PLACEMENTS_KEY),toast:document.getElementById('status-toast-message').textContent,errorHidden:document.getElementById('ui-error-bar').hidden,
          dragging:homeBento.classList.contains('layout-dragging'),placeholder:!!homeBento.querySelector('.home-swap-placeholder')};
      } finally { NotchDomain.swapHomeWidgetPlacements=real; }
    })()`);
    assert.equal(failure.unchanged,true,JSON.stringify(failure)); assert.equal(failure.persisted,true);
    assert.equal(failure.toast,'空间不够，无法交换');
    assert.equal(failure.errorHidden,true,'space constraints use a short toast');
    assert.equal(failure.dragging,false); assert.equal(failure.placeholder,false);
    await auditDragScheduling(win);
    await auditUiLifecycle(win);
    assert.deepEqual(errors,[]);
    console.log('Homepage swap keeps sizes, previews original footprints, packs without gaps, persists positions and rejects failed drops');
  } finally { win.destroy(); }
}
main().then(()=>app.quit(),error=>{console.error(error);app.exit(1);});
