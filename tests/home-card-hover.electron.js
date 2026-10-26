'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'pome-card-hover-')));
const shots = process.env.POME_HOVER_SHOTS || path.join(__dirname, '../dist.noindex/home-card-hover');
const watchdog = setTimeout(() => { console.error('Card hover timed out'); app.exit(1); }, 60000);

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({width:1240,height:638,frame:false,show:false,webPreferences:{backgroundThrottling:false}});
  const errors = [];
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = code => win.webContents.executeJavaScript(code, true).catch(error => { console.error(code); throw error; });
  const frame = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const wait = ms => new Promise(r => setTimeout(r,ms));
  const capture = async name => {
    await frame();
    fs.writeFileSync(path.join(shots,`${name}.png`),(await win.webContents.capturePage()).toPNG());
  };
  const hover = (id, x=0.97, y=0.03, type='mouse', selector='') => js(`(() => {
    const tile=document.querySelector('[data-home-module="${id}"]'),r=tile.getBoundingClientRect();
    const target=${JSON.stringify(selector)} ? tile.querySelector(${JSON.stringify(selector)}) : tile;
    target.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:${JSON.stringify(type)},clientX:r.left+r.width*${x},clientY:r.top+r.height*${y},buttons:0}));
  })()`);
  const state = id => js(`(() => {
    const tile=document.querySelector('[data-home-module="${id}"]'),s=getComputedStyle(tile),m=new DOMMatrixReadOnly(s.transform);
    return {active:tile.classList.contains('is-hover-tilted'),transform:s.transform,
      limit:parseFloat(s.getPropertyValue('--tile-tilt-angle')),x:parseFloat(tile.style.getPropertyValue('--tile-pointer-x')||'0'),y:parseFloat(tile.style.getPropertyValue('--tile-pointer-y')||'0'),m13:m.m13,m23:m.m23,scaleX:Math.hypot(m.m11,m.m12,m.m13)};
  })()`);
  try {
    fs.mkdirSync(shots,{recursive:true});
    await win.loadFile(path.join(__dirname,'../renderer/index.html'));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await js(`(async()=>{
      PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));
      const ids=['mirror','pomodoro','almanac','note','commands','cursor'];
      hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id));
      homeOrder=[...ids,...HOME_MODULE_REGISTRY.filter(id=>!ids.includes(id))];
      const placements=Object.fromEntries(ids.map((id,i)=>[id,{column:(i%3)*4,row:i<3?0:2,width:4,height:2}]));
      ids.forEach(id=>homeSizes[id]='medium');
      homeWorkingLayout={allowGaps:false,placements,variants:Object.fromEntries(ids.map(id=>[id,'wide']))};
      applyHomeLayout(homeWorkingLayout,{reason:'initial'});
      const input=document.getElementById('command-add');input.value='先核实来源，再给出事实、风险和替代解释，保持独立判断。';
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      document.getElementById('home-note').value='轻微倾斜，稳定阅读。输入和编辑时保持平面。';
      await setMode(true);await document.fonts.ready;
      document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);
      window.hoverStored=[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_PLACEMENTS_KEY,'notch-home-commands'].map(key=>localStorage.getItem(key));
    })()`);
    await wait(550);
    assert.equal(await js(`matchMedia('(hover: hover)').matches`),true,'Desktop hover capability is required for visual acceptance');
    await capture('01-rest');
    for (const [id,limit,name] of [['mirror',2.5,'02-photo-hover'],['pomodoro',2,'03-timer-hover'],['commands',1,'04-text-hover']]) {
      await hover(id);await wait(240);
      const s=await state(id);
      assert.equal(s.active,true);assert.equal(s.limit,limit);assert.notEqual(s.transform,'none');
      assert(Math.abs(s.m13)<=Math.sin(limit*Math.PI/180)+0.001);
      assert(Math.abs(s.m23)<=Math.sin(limit*Math.PI/180)+0.001);
      assert(Math.abs(s.m13)>0.005&&Math.abs(s.m23)>0.005,'both axes should tilt visibly');
      assert(Math.abs(s.scaleX-1)<0.001,'decorative tilt must not add scaling');
      assert.equal(await js(`document.querySelectorAll('.is-hover-tilted').length`),1);
      await capture(name);
    }
    const scheduling=await js(`(async()=>{
      homeBento.dispatchEvent(new PointerEvent('pointerleave'));await new Promise(r=>setTimeout(r,220));
      const tile=document.getElementById('home-pomodoro'),r=tile.getBoundingClientRect();
      let writes=0;const observer=new MutationObserver(records=>writes+=records.length);observer.observe(tile,{attributes:true,attributeFilter:['style','class']});
      for(let i=0;i<300;i++)tile.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:r.left+r.width*(i===299?.8:.2),clientY:r.top+r.height*.2,buttons:0}));
      const before=writes;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      observer.disconnect();return {before,writes,x:parseFloat(tile.style.getPropertyValue('--tile-pointer-x'))};
    })()`);
    assert.equal(scheduling.before,0);assert(scheduling.writes<=6);assert(Math.abs(scheduling.x-.6)<.01);

    // Controls remain stationary and usable; hovering never starts the mirror.
    assert.equal(await js(`document.querySelector('.home-mirror').classList.contains('live')`),false);
    await hover('pomodoro',.5,.5,'mouse','#pomodoro-toggle');await wait(220);
    assert.equal((await state('pomodoro')).transform,'none');
    await js(`document.getElementById('pomodoro-toggle').click()`);
    assert.equal(await js(`document.getElementById('home-pomodoro').dataset.state`),'running');
    await js(`document.getElementById('pomodoro-toggle').click()`);
    await hover('note');await wait(220);
    await js(`document.getElementById('home-note').focus()`);await frame();
    await hover('note');await frame();
    assert.equal((await state('note')).transform,'none');
    assert.equal(await js(`document.activeElement.id`),'home-note');
    await capture('05-focused-input');
    await js(`document.activeElement.blur()`);

    // Returning does not loop. Leaving before the queued frame cannot tilt later.
    await hover('mirror');await wait(220);
    await js(`homeBento.dispatchEvent(new PointerEvent('pointerleave'))`);await wait(260);
    assert.equal((await state('mirror')).transform,'none');
    await hover('mirror');await js(`homeBento.dispatchEvent(new PointerEvent('pointerleave'))`);await frame();await wait(220);
    assert.equal((await state('mirror')).transform,'none');
    await capture('06-returned');
    for (const action of [
      `window.dispatchEvent(new Event('blur'))`,
      `window.dispatchEvent(new Event('resize'))`,
      `document.dispatchEvent(new Event('notch:will-collapse'))`,
      `document.dispatchEvent(new CustomEvent('notch:tabchange',{detail:{tab:'notes'}}))`,
      `applyHomeLayout(homeWorkingLayout,{reason:'initial'})`,
    ]) {
      await hover('mirror');await frame();await js(action);await frame();
      assert.equal((await state('mirror')).transform,'none',action);
    }
    await hover('mirror');await frame();await hover('mirror',.9,.1,'touch');await wait(220);
    assert.equal((await state('mirror')).transform,'none');
    await hover('mirror');await frame();
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await frame();await hover('mirror');await frame();
    assert.equal((await state('mirror')).transform,'none');
    await capture('07-reduced-motion');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await frame();await hover('mirror');await wait(220);
    await js(`document.getElementById('home-layout-edit').click()`);await hover('mirror');await frame();
    assert.equal((await state('mirror')).transform,'none');
    await capture('08-layout-edit');
    assert.deepEqual(await js(`[HOME_ORDER_KEY,HOME_SIZES_KEY,HOME_PLACEMENTS_KEY,'notch-home-commands'].map(key=>localStorage.getItem(key))`),await js('hoverStored'));
    assert.equal(await js(`document.querySelector('.command-text').title`),'先核实来源，再给出事实、风险和替代解释，保持独立判断。');
    assert.deepEqual(errors,[]);
    console.log('Card hover: bounded 2/2.5/1 degree tilt without scale, frame coalescing, controls, focus, leave/cancel, reduced motion and edit isolation passed');
    console.log('Screenshots:',shots);
  } finally { win.destroy(); }
}
main().then(()=>{clearTimeout(watchdog);app.quit()},error=>{console.error(error);clearTimeout(watchdog);app.exit(1)});
