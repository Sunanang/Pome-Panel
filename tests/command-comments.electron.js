'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA; assert(profile, 'isolated profile required');
const phase = process.env.POME_COMMAND_PHASE || 'review';
const output = process.env.POME_COMMAND_SHOTS || path.join(__dirname, '../dist.noindex/command-comments');
fs.mkdirSync(output, {recursive:true});
const home = path.join(profile, 'hook-home'); fs.mkdirSync(home, {recursive:true});
process.env.POME_HOOK_TEST_HOME = home; process.env.POME_TEST_NOTIFICATIONS = '1';
app.commandLine.appendSwitch('user-data-dir', profile);app.disableHardwareAcceleration();
if(process.platform==='darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
const fixtures = [
  {id:'short',text:'git status -sb',comment:'看状态',createdAt:1},
  {id:'long',text:'pnpm --filter renderer dev --host 0.0.0.0 --port 5173',comment:'启动渲染进程',createdAt:2},
  {id:'none',text:'docker compose -f infra/docker-compose.yml up -d --remove-orphans',createdAt:3},
  {id:'long-note',text:'ssh mini.local',comment:'登录 Mac mini 跑打包脚本；这是旧数据里的较长备注，必须保留全文。',createdAt:4},
  {id:'fits',text:'pwd',createdAt:5},
];
fs.writeFileSync(path.join(profile,'workspace.json'),JSON.stringify({version:1,localStorage:{'notch-home-commands':JSON.stringify(fixtures)}}));
fs.writeFileSync(path.join(profile,'.ui-welcome-done'),'1');
const writes=[],handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,channel==='clipboard:write'?(_e,value)=>{writes.push(value);return true;}:channel==='windows:list'?()=>({items:[],error:null}):fn);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
const timer=setTimeout(()=>{console.error('Command comments timed out');app.exit(1)},100000);
app.on('web-contents-created',(_e,c)=>c.once('did-finish-load',()=>{
  if(started||!c.getURL().endsWith('/renderer/index.html'))return;started=true;
  run(c).then(()=>{clearTimeout(timer);console.log('Command comments:',phase,'passed');app.exit(0)}).catch(async error=>{console.error(error);try{fs.writeFileSync(path.join(output,'failure.png'),(await c.capturePage()).toPNG())}catch{}app.exit(1)});
}));
async function run(c){
  const win=BrowserWindow.fromWebContents(c),js=code=>c.executeJavaScript(code,true),errors=[];
  c.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('ERR_'))errors.push(event.message)});
  async function until(expr){for(let i=0;i<250;i++){if(await js(expr))return;await sleep(20)}throw Error('Timeout '+expr)}
  const settle=()=>js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  await until('!!window.NotchWorkspace&&!workspaceReloadPending');win.removeAllListeners('blur');win.show();win.focus();
  c.debugger.attach('1.3');await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await js('setMode(true)');await until('isExpanded&&!modeBusy');await js("setActiveTab('home')");await until("activeTab==='home'&&!tabBusy");
  await js(`document.querySelector('#ui-capsule-hint button')?.click();dismissStatusToast(false);document.querySelectorAll('.home-bento>[data-home-module]').forEach(node=>node.style.visibility='hidden')`);
  const metrics={};
  async function place(size,width,height,top=100){
    await js(`{const tile=document.querySelector('.home-commands');tile.hidden=false;tile.dataset.widgetSize='${size}';tile.dataset.layoutVariant='${{mini:'mini',small:'compact',medium:'wide',large:'tall'}[size]}';Object.assign(tile.style,{position:'fixed',left:'80px',top:'${top}px',width:'${width}px',height:'${height}px',visibility:'visible',transform:'none',zIndex:'5'});}`);await settle();
    // Fixed descendants may use a transformed ancestor as their containing block.
    await js(`{const tile=document.querySelector('.home-commands'),r=tile.getBoundingClientRect();tile.style.left=(parseFloat(tile.style.left)+80-r.left)+'px';tile.style.top=(parseFloat(tile.style.top)+${top}-r.top)+'px';}`);
    await settle();await sleep(50);
  }
  async function shot(name,full=false){await settle();const box=await js(`(()=>{const r=document.querySelector('.home-commands').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage(full?await js(`(()=>{const t=document.querySelector('.home-commands').getBoundingClientRect(),p=document.getElementById('command-tooltip'),r=p.matches(':popover-open')?p.getBoundingClientRect():t;const x=Math.max(0,Math.floor(Math.min(t.x,r.x)-12)),y=Math.max(0,Math.floor(Math.min(t.y,r.y)-12));return {x,y,width:Math.min(innerWidth-x,Math.ceil(Math.max(t.right,r.right)+12-x)),height:Math.min(innerHeight-y,Math.ceil(Math.max(t.bottom,r.bottom)+12-y))}})()`):box)).toPNG())}
  async function shell(){return js(`(()=>{const tile=document.querySelector('.home-commands');return [tile,tile.querySelector('.tile-head'),document.getElementById('command-add')].map(node=>{const style=getComputedStyle(node),r=node.getBoundingClientRect(),base=tile.getBoundingClientRect();return {rect:{x:r.x-base.x,y:r.y-base.y,w:r.width,h:r.height},styles:Object.fromEntries(['display','padding','borderRadius','backgroundImage','backgroundColor','font','height'].map(k=>[k,style[k]])),html:node===tile?null:node.outerHTML}})})()`)}
  for(const [size,w,h] of [['mini',196,118],['small',196,248],['medium',404,248],['large',404,510]]){
    await place(size,w,h);await shot(phase+'-'+size);metrics[size]={shell:await shell(),rows:await js(`[...document.querySelectorAll('.command-item')].filter(n=>n.checkVisibility()).map(n=>n.getBoundingClientRect().height)`)};
  }
  if(phase==='baseline'){fs.writeFileSync(path.join(output,'baseline.json'),JSON.stringify(metrics,null,2));return;}
  const baselinePath=path.join(output,'baseline.json');
  if(fs.existsSync(baselinePath)){
    const baseline=JSON.parse(fs.readFileSync(baselinePath));
    for(const size of Object.keys(metrics))assert.deepEqual(metrics[size].shell,baseline[size].shell,size+' preserves the shell/header/input exactly');
  }
  for(const size of Object.keys(metrics))assert(metrics[size].rows.every(height=>height===30),size+' has 30px single rows');
  const row=id=>`.command-item[data-id="${id}"]`;
  const tipOpen=()=>js("document.getElementById('command-tooltip').matches(':popover-open')");
  const stored=()=>js("JSON.parse(localStorage.getItem('notch-home-commands'))");
  async function move(x,y){await c.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(x),y:Math.round(y)});await sleep(35)}
  async function hover(id){
    await move(20,80);
    const box=await js(`(()=>{const r=document.querySelector(${JSON.stringify(row(id))}).getBoundingClientRect();return {x:r.x+12,y:r.y+r.height/2}})()`);
    await move(box.x,box.y);
  }
  async function tip(id,expect=true){
    await hover(id);assert.equal(await tipOpen(),false,'tooltip waits before appearing');
    await sleep(550);assert.equal(await tipOpen(),expect,'tooltip truncation condition for '+id);
    if(expect){
      const state=await js(`(()=>{const t=document.getElementById('command-tooltip'),r=t.getBoundingClientRect(),p=document.getElementById('panel').getBoundingClientRect();return {r:r.toJSON(),p:p.toJSON(),text:t.querySelector('.command-tooltip-text').textContent,comment:t.querySelector('.command-tooltip-comment')?.textContent}})()`);
      assert(state.r.width<=260.1&&state.r.x>=state.p.x+5&&state.r.right<=state.p.right-5,'tooltip horizontal bounds');
      assert(state.r.y>=state.p.y+5&&state.r.bottom<=state.p.bottom-5,'tooltip vertical bounds');
      const original=(await stored()).find(item=>item.id===id);
      assert.equal(state.text,original.text);assert.equal(state.comment,original.comment||undefined);
      return state;
    }
  }
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function edit(id,value,key='Enter'){
    await click(row(id)+' .command-comment');
    await js(`{const i=document.querySelector('.command-edit');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));}`);
    if(key==='blur')await js("document.getElementById('command-add').focus()");
    else await js(`document.querySelector('.command-edit').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
    assert.equal(await js("!!document.querySelector('.command-edit')"),false);
  }
  await place('medium',404,248);
  assert.equal(await js("document.querySelectorAll('.command-item [title]').length"),0,'no native title bubbles');
  assert.equal(await js(`document.querySelector('${row('long-note')} .command-comment').ariaLabel`),fixtures[3].comment,'assistive labels retain the complete note');
  assert.equal(await js(`getComputedStyle(document.querySelector('${row('none')} .command-comment')).display`),'none','empty comment occupies no slot');
  await hover('none');
  assert.deepEqual(await js(`(()=>{const r=document.querySelector('${row('none')} .command-comment').getBoundingClientRect();return [r.width,r.height]})()`),[18,18]);
  await shot('hover-add');
  await tip('short',false);await tip('fits',false);
  await js('document.activeElement.blur()');
  await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await tip('long');
  assert.equal(await js("document.querySelector('.home-commands').classList.contains('is-hover-tilted')"),true,'tooltip also works with card hover motion enabled');
  assert.equal(await js("getComputedStyle(document.getElementById('command-tooltip')).animationDuration"),'0.14s','tooltip fades in over 140ms');
  await c.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await move(20,80);await settle();
  await tip('none');assert.equal(await js("document.querySelector('.command-tooltip-comment')"),null);
  await shot('tip-none',true);
  await tip('long-note');await shot('tip-long',true);
  await move(20,80);assert.equal(await tipOpen(),false,'leave hides immediately');
  await place('small',196,248);await tip('short');await shot('tip-note',true);
  await place('mini',196,118);
  await tip('short');await shot('tip-mini',true);
  assert.equal(await js(`(()=>{const r=document.querySelector('${row('short')}');return [...r.querySelectorAll('.command-comment,.command-actions')].every(n=>!n.checkVisibility())})()`),true,'mini controls hidden even on hover');
  await place('large',404,510);
  const before=await stored();
  await edit('short','取消草稿','Escape');assert.deepEqual(await stored(),before,'Escape never writes');
  await click(row('short')+' .command-comment');
  await js(`{const i=document.querySelector('.command-edit');i.value='超过六字也可以保存';i.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.deepEqual(await js("(()=>{const e=document.querySelector('.command-comment-editor'),i=e.querySelector('input'),c=e.querySelector('span');return {width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,count:c.textContent,warning:c.classList.contains('is-long'),placeholder:i.placeholder,max:i.maxLength}})()"),{width:76,height:20,count:'9/6',warning:true,placeholder:'备注 ≤6字',max:1000});
  await hover('long');await sleep(550);assert.equal(await tipOpen(),false,'no tooltip while any row is being edited');
  await shot('edit-long');
  await js("document.querySelector('.command-edit').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
  assert.equal((await stored()).find(x=>x.id==='short').comment,'超过六字也可以保存','six is advisory');
  await edit('none','失焦保存','blur');assert.equal((await stored()).find(x=>x.id==='none').comment,'失焦保存');
  await edit('none','');assert.equal((await stored()).find(x=>x.id==='none').comment,undefined,'clear removes only the comment');
  await click(row('none')+' .command-comment');
  await js(`{const i=document.querySelector('.command-edit');i.value='中😀文';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));}`);
  assert.equal(await js("document.querySelector('.command-comment-count').textContent"),'3/6','counter uses Unicode characters');
  assert.equal(await js("!!document.querySelector('.command-edit')"),true,'IME Enter does not save');
  await js("document.querySelector('.command-edit').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal((await stored()).find(x=>x.id==='long-note').comment,fixtures[3].comment,'legacy long note survives edits to other rows');
  await click(row('long-note')+' [data-action="copy-command"]');
  assert.deepEqual(writes,[{type:'text',text:fixtures[3].text}],'copy never includes the note');
  await click(row('short')+' .command-text');
  await js("{const i=document.querySelector('.command-edit');i.value='git diff --stat';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}");
  assert.equal((await stored()).find(x=>x.id==='short').text,'git diff --stat','command editing remains available');
  await js("{const i=document.getElementById('command-add');i.value='npm run lint';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}");
  assert.equal((await stored())[0].text,'npm run lint');
  await tip('long');await js("document.getElementById('command-list').dispatchEvent(new Event('scroll'))");assert.equal(await tipOpen(),false,'scroll dismisses');
  await tip('long');await js("window.dispatchEvent(new Event('resize'))");assert.equal(await tipOpen(),false,'resize dismisses');
  await tip('long');await js("document.querySelector('.home-bento').dataset.layoutEditing='true'");await sleep(25);assert.equal(await tipOpen(),false,'layout editing dismisses');
  await tip('long',false);await js("document.querySelector('.home-bento').dataset.layoutEditing='false'");
  await tip('long');await js("document.querySelector('.home-commands').classList.add('is-dragging')");await sleep(25);assert.equal(await tipOpen(),false,'drag dismisses');
  await tip('long',false);await js("document.querySelector('.home-commands').classList.remove('is-dragging')");
  // Near the bottom and right edges: flip above and clamp horizontally.
  await place('small',196,248,200);
  await js(`{const tile=document.querySelector('.home-commands'),r=tile.getBoundingClientRect(),row=document.querySelector('${row('long')}').getBoundingClientRect(),p=document.getElementById('panel').getBoundingClientRect();tile.style.left=(parseFloat(tile.style.left)+p.right-202-r.left)+'px';tile.style.top=(parseFloat(tile.style.top)+p.bottom-12-row.bottom)+'px';}`);
  await settle();const flipped=await tip('long');
  const anchor=await js(`document.querySelector('${row('long')}').getBoundingClientRect().toJSON()`);
  assert(flipped.r.bottom<=anchor.top-5,'tooltip flips above with six-pixel spacing');
  await shot('tip-flipped',true);
  await place('large',404,510);await tip('long');
  await js("document.dispatchEvent(new CustomEvent('notch:home-layout-applied'))");assert.equal(await tipOpen(),false,'layout application dismisses');
  await tip('long');await js("setActiveTab('settings')");await until("activeTab==='settings'&&!tabBusy");assert.equal(await tipOpen(),false,'tab change dismisses');
  await js("setActiveTab('home')");await until("activeTab==='home'&&!tabBusy");
  await place('large',404,510);
  const count=(await stored()).length;await click(row('fits')+' [data-action="delete-command"]');await until("document.getElementById('content-delete-confirm').open");
  assert.equal((await stored()).length,count,'preview does not delete');await click('#content-delete-cancel');assert.equal((await stored()).length,count);
  await click(row('fits')+' [data-action="delete-command"]');await until("document.getElementById('content-delete-confirm').open");await click('#content-delete-apply');await until(`getCommandsForSync().length===${count-1}`);
  await js("{const rows=document.querySelectorAll('.command-item');rows[0].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));document.querySelector('.command-item:last-child').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));}");
  await click('#command-bulk-delete');await until("document.getElementById('content-delete-confirm').open");await click('#content-delete-apply');await until('!getCommandsForSync().length');
  assert.equal(await js("!!document.querySelector('.command-empty')"),true,'bulk clear remains available');
  assert.equal(await tipOpen(),false,'render clears the tooltip');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'review.json'),JSON.stringify(metrics,null,2));
}
require('../main');
