'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
const home = path.join(profile, 'isolated-home');
for (const name of ['.cursor', '.codex', '.claude']) fs.mkdirSync(path.join(home, name), { recursive: true });
// Skip first-run welcome so settings interactions are not blocked by the dialog.
fs.writeFileSync(path.join(profile, '.first-run-done'), '1');
fs.writeFileSync(path.join(profile, '.ui-welcome-done'), '1');
process.env.POME_HOOK_TEST_HOME = home;
process.env.POME_TEST_NOTIFICATIONS = '1';
app.commandLine.appendSwitch('user-data-dir', profile);
app.disableHardwareAcceleration();
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const output = process.env.POME_SETTINGS_SCREENSHOTS;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
let started = false;
const watchdog = setTimeout(() => { console.error('Settings UI timed out', errors); app.exit(1); }, 45000);
app.on('web-contents-created', (_event, c) => {
  c.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  c.once('did-finish-load', () => {
    if (started || !c.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(c).then(() => { clearTimeout(watchdog); console.log('Settings A: merged cards, stable token inputs, independent toggles, last-widget protection, localization and header passed'); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run(c) {
  const js = code => c.executeJavaScript(code);
  async function until(expr) {
    for (let i = 0; i < 250; i++) { if (await js(expr)) return; await delay(20); }
    throw new Error('Timed out: ' + expr);
  }
  await until('!!NotchAiSources?.getState().ready && !!NotchHome');
  await js(`setMode(true)`); await until('!modeBusy');
  await js(`setActiveTab('settings')`); await until(`activeTab==='settings' && !tabBusy`);
  await delay(350);
  await js('NotchAiUsage.openSettings()');
  assert.equal(await js(`(()=>{const card=document.getElementById('settings-ai-sources').getBoundingClientRect(),column=document.querySelector('.settings-column-primary').getBoundingClientRect();return Math.abs(card.top-column.top)<2})()`),true,'quota settings entry scrolls to the merged AI card heading');
  await js(`document.querySelector('.settings-column-primary').scrollTop=0`);
  // Compare permanent navigation markup. Feature visibility, the active tab,
  // unread badges and the animated indicator are independently updated state.
  const headerSignature = `(()=>{const h=document.querySelector('.topbar');return [h,...h.querySelectorAll('*')].map(e=>({tag:e.tagName,attrs:[...e.attributes].filter(a=>!(e.matches('.tab,.badge')&&['hidden','aria-hidden','aria-selected','aria-label','tabindex','title','data-dot','data-error'].includes(a.name))&&!(e.id==='tab-indicator'&&a.name==='style')).map(a=>[a.name,a.name==='class'?a.value.split(' ').filter(c=>c!=='active').sort().join(' '):a.value]).sort(([a],[b])=>a.localeCompare(b)),text:e.children.length||e.matches('.badge')?null:e.textContent}))})()`;
  const header = await js(headerSignature);
  const structure = await js(`(()=>({
    primary:[...document.querySelectorAll('.settings-column-primary > .settings-card')].map(e=>e.className),
    secondary:[...document.querySelectorAll('.settings-column-secondary > .settings-card')].map(e=>e.className),
    oldQuota:!!document.getElementById('settings-ai-usage-card'),
    obsolete:document.querySelectorAll('#settings-ai-sources .ai-source-matrix,#settings-ai-sources .ai-source-capabilities,#settings-ai-sources .ai-attention-section').length,
    testButtons:[...document.querySelectorAll('#settings-ai-sources button,#home-inbox button')].filter(e=>e.textContent==='发送测试').length,
    tokens:[...document.querySelectorAll('#settings-ai-sources input[type=password]')].map(e=>({id:e.id,provider:e.closest('.ai-source-row')?.dataset.source,visible:e.checkVisibility()})),
    features:document.querySelectorAll('.settings-display-card [data-settings-feature]').length,
    modules:document.querySelectorAll('.settings-display-card [data-settings-home-module]').length,
    columns:getComputedStyle(document.getElementById('settings-feature-list')).gridTemplateColumns.split(' ').length,
    homeColumns:getComputedStyle(document.getElementById('settings-home-module-list')).gridTemplateColumns.split(' ').length,
    primaryColor:getComputedStyle(document.querySelector('[data-source=codex] .ai-source-actions button')).color,
    quotaOnly:getComputedStyle(document.querySelector('[data-source=grokbot] .ai-source-state')).borderTopStyle,
    quotaAction:document.querySelector('[data-source=grokbot] .ai-source-actions').textContent,
    claudeButton:!!document.querySelector('[data-source=claude] .ai-source-actions button')
  }))()`);
  assert.equal(structure.primary.length,3);
  for (const [i,name] of ['mirror','api','ai-sources'].entries()) assert(structure.primary[i].includes(`settings-${name}-card`));
  for (const [i,name] of ['nas-sync','display','device'].entries()) assert(structure.secondary[i].includes(`settings-${name}-card`));
  assert.equal(await js(`document.querySelectorAll('.settings-page .tile-label').length`),1,'only mirror cover keeps its eyebrow');
  assert.equal(await js(`!!document.querySelector('.settings-mirror-card .tile-label')`),true);
  assert.equal(await js(`!!document.querySelector('.settings-device-card .settings-language-row #settings-language')`),true,'language is a device setting');
  assert.equal(await js(`!!document.getElementById('settings-task-notifications')`),true,'top bubble toggle lives with device settings');
  assert.equal(await js(`document.getElementById('settings-task-notifications').checked`),true,'top bubble reminders default on');
  assert.equal(await js(`(()=>{const a=getComputedStyle(document.querySelector('.settings-auto-launch-row > i'));const t=getComputedStyle(document.querySelector('.settings-task-notifications-row > i'));return t.width===a.width&&t.height===a.height&&t.borderRadius===a.borderRadius&&t.width==='32px'})()`),true,'top bubble uses the same pill switch as launch at login');
  // Click the label (same as a real pointer); the checkbox itself is visually hidden.
  await js(`document.querySelector('.settings-task-notifications-row').click()`);
  await until(`!document.getElementById('settings-task-notifications').disabled && document.getElementById('settings-task-notifications').checked===false`);
  assert.equal((await js('notchAPI.getAppSettings()')).taskNotifications,false);
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    await js(`document.querySelector('.settings-task-notifications-row').scrollIntoView({block:'center',behavior:'instant'});document.activeElement.blur();document.getElementById('ui-capsule-hint').hidden=true;document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
    c.invalidate(); await delay(200);
    fs.writeFileSync(path.join(output, 'task-notifications-off.png'), (await c.capturePage()).toPNG());
  }
  await js(`document.querySelector('.settings-task-notifications-row').click()`);
  await until(`!document.getElementById('settings-task-notifications').disabled && document.getElementById('settings-task-notifications').checked===true`);
  assert.equal((await js('notchAPI.getAppSettings()')).taskNotifications,true);
  assert.equal(await js(`document.querySelector('.settings-language-card')`),null);
  assert.equal(await js(`(()=>{const props=['height','minWidth','paddingLeft','paddingRight','backgroundColor','borderColor','borderRadius','fontSize','fontFamily','color','appearance','colorScheme'];const [a,b]=['settings-language','settings-default-tab'].map(id=>getComputedStyle(document.getElementById(id)));return props.every(p=>a[p]===b[p])})()`),true,'language and default-page selects share the same appearance');

  assert.equal(structure.secondary.length,3);
  assert.equal(await js(`document.getElementById('settings-ai-sources-title').textContent`),'AI');
  assert.equal(structure.oldQuota,false); assert.equal(structure.obsolete,0); assert.equal(structure.testButtons,0);
  assert.equal(structure.tokens.length,6);
  for (const token of structure.tokens) { assert(token.provider && token.id.includes(token.provider)); assert.equal(token.visible,false); }
  assert.equal(structure.features,6); assert.equal(structure.modules,11);
  assert.equal(structure.columns,2); assert.equal(structure.homeColumns,2);
  assert.equal(structure.primaryColor,'rgb(18, 19, 24)');
  assert.equal(structure.quotaOnly,'solid'); assert.equal(structure.quotaAction,'无需接入'); assert.equal(structure.claudeButton,true);
  assert.equal(await js(`document.querySelector('[data-source=manus] .ai-source-state').textContent`),'API');
  assert.equal(await js(`document.querySelector('[data-source=manus] .ai-source-actions').textContent`),'下方配置 Token 与完成提醒');
  await js(`NotchAiSources.openSettings('grok')`);
  await until(`document.activeElement?.id==='settings-grok-token'`);
  assert.equal(await js(`NotchAiSources.compactPath('/Users/demo/Library/Application Support/Claude/config.json')`),'~/Library/Application Support/Claude/config.json');
  assert.equal(await js(`NotchAiSources.compactPath('C:\\\\Users\\\\demo\\\\.claude\\\\settings.json')`),'~\\.claude\\settings.json');
  assert.equal(await js(`NotchAiSources.compactPath('/tmp/fixture-home/.cursor/hooks.json')`),'~/.cursor/hooks.json');
  // Detection, listener updates and localization may re-render rows while a user types.
  await js(`document.getElementById('settings-grok-token').value='unsaved-fixture';document.getElementById('settings-grok-team').value='unsaved-team';document.getElementById('settings-grok-team').dispatchEvent(new Event('input'));document.getElementById('settings-grok-token').focus();NotchAiSources.refresh()`);
  await until(`document.activeElement.id==='settings-grok-token'`);
  await js(`notchAPI.setLanguage('en-US')`); await until(`document.documentElement.lang==='en-US'`);
  assert.equal(await js(`document.getElementById('settings-grok-token').value`),'unsaved-fixture');
  assert.equal(await js(`document.getElementById('settings-grok-team').value`),'unsaved-team');
  assert.equal(await js(`document.activeElement.id`),'settings-grok-token');
  assert.equal(await js(`document.querySelector('.settings-display-card > .settings-card-heading strong').textContent`),'Display');
  assert.equal(await js(`document.querySelector('[data-source=grokbot] .ai-source-actions').textContent`),'No setup needed');
  assert.equal(await js(`document.querySelector('[data-source=manus] .ai-source-actions').textContent`),'Configure the token and completion alerts below');
  assert.equal(await js(`document.getElementById('settings-ai-sources-title').textContent`),'AI');
  assert.equal(await js(`document.querySelector('[data-provider-save=grok]')?.textContent`),'Save');
  await js(`document.getElementById('settings-grok-token').value='';notchAPI.setLanguage('zh-CN')`); await until(`document.documentElement.lang==='zh-CN'`);
  await until(`document.querySelector('[data-provider-save=grok]')?.textContent==='保存'`);
  for(const locale of ['en-US','zh-CN']) {
    await js(`(()=>{const s=document.getElementById('settings-language');s.value='${locale}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(`document.documentElement.lang==='${locale}'&&!document.getElementById('settings-language').disabled`);
    assert.equal((await js('notchAPI.getAppSettings()')).language,locale,'language select persists its value');
    if(output){
      fs.mkdirSync(output,{recursive:true});
      await js(`document.getElementById('settings-language').closest('label').scrollIntoView({block:'start',behavior:'instant'});document.activeElement.blur();document.getElementById('ui-capsule-hint').hidden=true;document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
      c.invalidate();await delay(200);
      fs.writeFileSync(path.join(output,'language-controls-'+locale+'.png'),(await c.capturePage()).toPNG());
    }
  }
  if (output) {
    fs.mkdirSync(output,{recursive:true});
    // Only synthetic hook configurations in the temporary HOME are written.
    for (const id of ['cursor','claude']) {
      const result = await js(`(async()=>{const p=await notchAPI.previewAiSource('${id}','connect');return notchAPI.applyAiSource(p.preview.token)})()`);
      assert.equal(result.ok,true);
    }
    await js('NotchAiSources.refresh()');
    await js(`document.getElementById('settings-grok-team').value='';delete document.getElementById('settings-grok-team').dataset.dirty`);
    await until(`document.querySelector('[data-source=cursor]').dataset.state==='connected'`);
    await js(`document.querySelectorAll('.settings-column').forEach(e=>e.scrollTop=0);document.activeElement.blur()`);
    c.invalidate();
    await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    await delay(200);
    fs.writeFileSync(path.join(output,'settings-viewport.png'),(await c.capturePage()).toPNG());
    const proof = await js(`(()=>{const h=document.querySelector('.topbar');return {html:h.outerHTML,styles:[h,...h.querySelectorAll('*')].map(e=>({tag:e.tagName,css:getComputedStyle(e).cssText,values:Array.from(getComputedStyle(e),k=>[k,getComputedStyle(e).getPropertyValue(k)])})),rect:h.getBoundingClientRect().toJSON()}})()`);
    fs.writeFileSync(path.join(output,'header-after.json'),JSON.stringify(proof));
    const geometry=await js(`(()=>{const a=document.getElementById('settings-ai-sources').getBoundingClientRect(),c=document.querySelector('.settings-column-primary').getBoundingClientRect();return {x:a.x-c.x,y:a.y-c.y,width:a.width,height:a.height}})()`);
    fs.writeFileSync(path.join(output,'ai-geometry.json'),JSON.stringify(geometry));
    const columns = await js(`[...document.querySelectorAll('.settings-column')].map(e=>({rect:e.getBoundingClientRect().toJSON(),height:e.scrollHeight,viewport:innerWidth}))`);
    for (let column=0;column<columns.length;column++) {
      const info=columns[column], step=Math.floor(info.rect.height);
      info.segments=[];
      for (let offset=0;offset<info.height;offset+=step) {
        const actual=await js(`(()=>{const e=document.querySelectorAll('.settings-column')[${column}];e.style.scrollBehavior='auto';e.scrollTo({top:${offset},behavior:'instant'});return e.scrollTop})()`);
        c.invalidate();await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await delay(100);
        const file=`column-${column}-${offset}.png`;
        fs.writeFileSync(path.join(output,file),(await c.capturePage()).toPNG());
        info.segments.push({file,offset:actual});
        if(actual+step>=info.height)break;
      }
    }
    fs.writeFileSync(path.join(output,'capture-columns.json'),JSON.stringify(columns));
    await js(`document.querySelectorAll('.settings-column').forEach(e=>e.scrollTop=0)`);
  }
  const homeBefore = await js('NotchHome.getVisibility()');
  const featureBefore = (await js('notchAPI.getAppSettings()')).features;
  for (const id of ['todo','notes','links','recordings','credentials','clip']) {
    const before = featureBefore[id];
    await js(`document.querySelector('[data-settings-feature=${id}]').click()`);
    await until(`!document.querySelector('[data-settings-feature=${id}]').disabled && document.querySelector('[data-settings-feature=${id}]').checked===${!before}`);
    await until(`document.getElementById('tab-button-${id}').hidden===${!!before}`);
    assert.equal((await js('notchAPI.getAppSettings()')).features[id],!before);
    assert.deepEqual(await js('NotchHome.getVisibility()'),homeBefore,'workspace switches keep home settings independent');
    await js(`document.querySelector('[data-settings-feature=${id}]').click()`);
    await until(`!document.querySelector('[data-settings-feature=${id}]').disabled && document.querySelector('[data-settings-feature=${id}]').checked===${before}`);
    await until(`document.getElementById('tab-button-${id}').hidden===${!before}`);
  }
  const visible = await js('NotchHome.getVisibility().visibleIds');
  // Actual settings inputs dispatch through NotchHome, independently of feature IPC.
  await js(`document.querySelector('[data-settings-home-module=note]').click()`);
  await until(`!NotchHome.isVisible('note')`);
  await js(`document.querySelector('[data-settings-home-module=note]').click()`);
  await until(`NotchHome.isVisible('note')`);
  assert.deepEqual((await js('notchAPI.getAppSettings()')).features,featureBefore);
  await js(`document.activeElement.blur()`);
  assert.deepEqual(await js(headerSignature),header,'settings changes retain navigation structure');
  for (const id of visible.slice(1)) {
    await js(`document.querySelector('[data-settings-home-module=${id}]').click()`);
    await until(`!NotchHome.isVisible('${id}')`);
  }
  await js(`document.querySelector('[data-settings-home-module=${visible[0]}]').click()`);
  await until(`document.querySelector('[data-settings-home-module=${visible[0]}]').checked && !document.querySelector('[data-settings-home-module=${visible[0]}]').disabled`);
  assert.equal(await js('NotchHome.getVisibility().visibleIds.length'),1);
  assert.equal((await js(`NotchHome.setModuleVisible('${visible[0]}',false)`)).error,'at_least_one_required');
  assert.deepEqual((await js('notchAPI.getAppSettings()')).features,featureBefore);
  assert.deepEqual(errors,[]);
}
require('../main');
