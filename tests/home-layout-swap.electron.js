const assert = require('node:assert/strict');
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

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1240, height: 638, show: false, webPreferences: { backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  try {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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
        document.getElementById('home-layout-save').click();
        return {...after,preview,stored:JSON.parse(localStorage.getItem(HOME_PLACEMENTS_KEY))};
      })()`);
      assert.equal(result.preview.width,result.preview.expectedWidth,'drop placeholder keeps dragged width');
      assert.equal(result.preview.height,result.preview.expectedHeight,'drop placeholder keeps dragged height');
      assert.equal(result.sourceSize,sizes.cursor); assert.equal(result.targetSize,sizes.recorder);
      assert.equal(result.preview.targetSize,sizes.recorder);
      assert.deepEqual(result.sizes,result.beforeSizes,'swap must not overwrite saved size preferences');
      assert.equal(domain.validateHomeWidgetLayout(result.layout,Object.keys(placements)),true);
      assert.deepEqual(result.stored,result.layout.placements);
      assert.equal(result.previewCleared,true);
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
          persisted:stored===localStorage.getItem(HOME_PLACEMENTS_KEY),toast:document.querySelector('#ui-error-bar p')?.textContent,
          dragging:homeBento.classList.contains('layout-dragging'),placeholder:!!homeBento.querySelector('.home-swap-placeholder')};
      } finally { NotchDomain.swapHomeWidgetPlacements=real; }
    })()`);
    assert.equal(failure.unchanged,true,JSON.stringify(failure)); assert.equal(failure.persisted,true);
    assert.equal(failure.toast,'空间不够，无法交换');
    assert.equal(failure.dragging,false); assert.equal(failure.placeholder,false);
    assert.deepEqual(errors,[]);
    console.log('Homepage swap keeps sizes, previews original footprints, packs without gaps, persists positions and rejects failed drops');
  } finally { win.destroy(); }
}
main().then(()=>app.quit(),error=>{console.error(error);app.exit(1);});
