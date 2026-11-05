'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
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
const watchdog = setTimeout(() => { console.error('Settings UI timed out', errors); app.exit(1); }, 120000);
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
  await until('!!NotchAiSources?.getState().ready && !!NotchHome && !!NotchSettings');
  const win = BrowserWindow.fromWebContents(c); win.removeAllListeners('blur'); win.show(); win.focus();
  await js(`setMode(true)`); await until('!modeBusy');
  await js(`setActiveTab('settings')`); await until(`activeTab==='settings' && !tabBusy`);
  await delay(350);
  await js('NotchAiUsage.openSettings()');
  assert.equal(await js(`(()=>{const card=document.getElementById('settings-ai-sources').getBoundingClientRect(),column=document.getElementById('settings-content').getBoundingClientRect();return Math.abs(card.top-column.top)<2})()`),true,'quota settings entry scrolls to the merged AI card heading');
  await js(`NotchSettings.select('display')`);
  const gridColumns = await js(`['settings-feature-list','settings-home-module-list'].map(id=>getComputedStyle(document.getElementById(id)).gridTemplateColumns.split(' ').length)`);
  await js(`NotchSettings.select('ai')`);
  // Compare permanent navigation markup. Feature visibility, the active tab,
  // unread badges and the animated indicator are independently updated state.
  const headerSignature = `(()=>{const h=document.querySelector('.topbar');return [h,...h.querySelectorAll('*')].map(e=>({tag:e.tagName,attrs:[...e.attributes].filter(a=>!(e.matches('.tab,.badge')&&['hidden','aria-hidden','aria-selected','aria-label','tabindex','title','data-dot','data-error'].includes(a.name))&&!(e.id==='tab-indicator'&&a.name==='style')).map(a=>[a.name,a.name==='class'?a.value.split(' ').filter(c=>c!=='active').sort().join(' '):a.value]).sort(([a],[b])=>a.localeCompare(b)),text:e.children.length||e.matches('.badge')?null:e.textContent}))})()`;
  const header = await js(headerSignature);
  // A disclosure must handle its own native Space activation, not close Pome.
  await js(`{const d=document.getElementById('ui-token-manual-cursor');d.open=false;d.querySelector('summary').scrollIntoView({block:'nearest'});d.querySelector('summary').focus()}`);
  c.sendInputEvent({type:'keyDown',keyCode:'Space'});c.sendInputEvent({type:'keyUp',keyCode:'Space'});await delay(100);
  assert.equal(await js('isExpanded'),true,'Space on Token settings does not collapse the panel');
  assert.equal(await js("document.getElementById('ui-token-manual-cursor').open"),true,'Space opens the inline Token disclosure');
  await js("document.getElementById('ui-token-manual-cursor').open=false;document.activeElement.blur();document.getElementById('settings-content').scrollTop=0");

  const structure = await js(`(()=>({
    groups:[...document.querySelectorAll('[data-settings-group]')].map(e=>({id:e.dataset.settingsGroup,cards:[...e.querySelectorAll(':scope>.settings-card')].map(card=>card.className)})),
    oldQuota:!!document.getElementById('settings-ai-usage-card'),
    obsolete:document.querySelectorAll('#settings-ai-sources .ai-source-matrix,#settings-ai-sources .ai-source-capabilities,#settings-ai-sources .ai-attention-section').length,
    testButtons:[...document.querySelectorAll('#settings-ai-sources button,#home-inbox button')].filter(e=>e.textContent==='发送测试').length,
    tokens:[...document.querySelectorAll('#settings-ai-sources input[type=password]')].map(e=>({id:e.id,provider:e.id.replace('settings-','').replace('-token',''),visible:e.checkVisibility(),row:e.closest('.ai-source-row')?.dataset.source})),
    features:document.querySelectorAll('.settings-display-card [data-settings-feature]').length,
    modules:document.querySelectorAll('.settings-display-card [data-settings-home-module]').length,

    primaryColor:getComputedStyle(document.querySelector('[data-source=codex] .ai-source-actions button')).color,
    primaryBackground:getComputedStyle(document.querySelector('[data-source=codex] .ai-source-actions button')).backgroundColor,
    quotaOnly:getComputedStyle(document.querySelector('[data-source=grokbot] .ai-source-state')).borderTopStyle,
    quotaAction:document.querySelector('[data-source=grokbot] .ai-source-actions').textContent,
    claudeButton:!!document.querySelector('[data-source=claude] .ai-source-actions button')
  }))()`);
  assert.deepEqual(structure.groups.map(group=>group.id),['common','appearance','display','ai','data','nas']);
  assert.deepEqual(structure.groups.map(group=>group.cards.length),[1,2,1,2,3,1]);
  assert.equal(await js(`document.querySelector('#tab-settings input[type=search],.settings-experience-nav')`),null);
  await js(`NotchSettings.select('common')`);
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
  assert.equal(await js(`(()=>{const props=['height','backgroundColor','borderRadius','color','colorScheme','appearance'];const base=getComputedStyle(document.getElementById('settings-language'));return ['pome-weather-unit','pome-interface-motion'].every(id=>{const s=getComputedStyle(document.getElementById(id));return props.every(p=>s[p]===base[p])})})()`),true,'weather and motion selects match device select chrome');

  assert.equal(await js(`document.getElementById('settings-ai-sources-title').textContent`),'AI');
  assert.equal(await js(`document.querySelectorAll('.ai-token-details > summary [id$="-token-status"]').length`),6,'all token status nodes survive locale updates');
  assert.equal(structure.oldQuota,false); assert.equal(structure.obsolete,0); assert.equal(structure.testButtons,0);
  assert.equal(structure.tokens.length,6);
  for (const token of structure.tokens) { assert(token.provider && token.id.includes(token.provider)); assert.equal(token.visible,false); assert.equal(token.row,token.provider,'Token stays with its own source'); }
  const buttons=await js(`['settings-shortcut-change','settings-reset-panel-position','settings-workspace-open','settings-workspace-choose','settings-data-export','settings-data-restore','settings-cursor-token-save','settings-codex-token-clear'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e),label=getComputedStyle(e.firstElementChild||e);return {background:s.backgroundColor,radius:s.borderRadius,border:s.borderTopWidth,borderColor:s.borderTopColor,font:s.fontSize,labelFont:label.fontSize,color:s.color,minHeight:s.minHeight}})`);
  for(const button of buttons)assert.deepEqual(button,buttons[0],'secondary actions share one style');
  const selects=await js(`['settings-language','settings-default-tab','pome-weather-unit','pome-interface-motion','transcription-language','transcription-region'].map(id=>{const s=getComputedStyle(document.getElementById(id));return {background:s.backgroundColor,radius:s.borderRadius,border:s.borderTopColor,height:s.height,font:s.fontSize,arrow:s.backgroundImage,color:s.color}})`);
  for(const select of selects)assert.deepEqual(select,selects[0],'select fields share one style across pages and dialogs');
  assert.equal(structure.features,6); assert.equal(structure.modules,11);
  assert.deepEqual(gridColumns,[2,2]);
  const luminance = color => {
    const rgb = color.match(/[\d.]+/g).slice(0,3).map(Number).map(n => n/255).map(n => n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const contrast = [luminance(structure.primaryColor),luminance(structure.primaryBackground)].sort((a,b)=>b-a);
  assert((contrast[0]+.05)/(contrast[1]+.05)>=4.5,'primary action retains readable text contrast');
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
  assert.equal(await js(`document.querySelectorAll('.ai-token-details > summary [id$="-token-status"]').length`),6,'all token status nodes survive locale updates');
  assert.equal(await js(`document.querySelector('[data-provider-save=grok]')?.textContent`),'Save');
  await js(`document.getElementById('settings-grok-token').value='';notchAPI.setLanguage('zh-CN')`); await until(`document.documentElement.lang==='zh-CN'`);
  await until(`document.querySelector('[data-provider-save=grok]')?.textContent==='保存'`);
  for(const locale of ['en-US','zh-CN']) {
    await js(`NotchSettings.select('common');(()=>{const s=document.getElementById('settings-language');s.value='${locale}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(`document.documentElement.lang==='${locale}'&&!document.getElementById('settings-language').disabled`);
    assert.equal((await js('notchAPI.getAppSettings()')).language,locale,'language select persists its value');
    if(output){
      fs.mkdirSync(output,{recursive:true});
      await js(`document.getElementById('settings-language').closest('label').scrollIntoView({block:'start',behavior:'instant'});document.activeElement.blur();document.getElementById('ui-capsule-hint').hidden=true;document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
      c.invalidate();await delay(200);
      fs.writeFileSync(path.join(output,'language-controls-'+locale+'.png'),(await c.capturePage()).toPNG());
    }
  }
  const matrix=[];
  for(const preset of ['standard','medium','compact']) {
    await js(`notchAPI.setPanelSize('${preset}')`);
    await until(`document.documentElement.dataset.panelSize==='${preset}'`);
    for(const group of ['common','appearance','display','ai','data','nas']) {
      await js(`document.querySelector('[data-settings-group-target="${group}"]').click();document.getElementById('ui-capsule-hint').hidden=true;document.activeElement.blur()`);
      await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const geometry=await js(`(()=>{const group=document.querySelector('.settings-group:not([hidden])'),content=document.getElementById('settings-content'),sidebar=document.querySelector('.settings-sidebar'),r=content.getBoundingClientRect(),nav=sidebar.getBoundingClientRect(),cards=[...group.querySelectorAll(':scope>.settings-card')].map(card=>card.getBoundingClientRect());content.scrollTop=content.scrollHeight;return {active:group.dataset.settingsGroup,selected:document.querySelectorAll('.settings-sidebar [aria-selected="true"]').length,groupCount:document.querySelectorAll('.settings-group:not([hidden])').length,overflow:content.scrollWidth>content.clientWidth+1,navVisible:nav.left>=0&&nav.top>=0&&nav.bottom<=innerHeight&&nav.right<r.left,cardWidths:cards.map(card=>card.width),scroll:content.scrollTop}})()`);
      assert.equal(geometry.active,group);assert.equal(geometry.selected,1);assert.equal(geometry.groupCount,1);assert.equal(geometry.overflow,false,preset+'/'+group+' horizontal overflow');assert(geometry.navVisible);
      assert(geometry.cardWidths.every(width=>Math.abs(width-geometry.cardWidths[0])<1),preset+'/'+group+' equal card widths');
      await js(`document.getElementById('settings-content').scrollTop=0`);
      // Clear feedback generated by earlier fixture actions for the visual gallery.
      if(output)await js("document.getElementById('settings-inline-note').textContent=''");
      if(group==='ai') {
        assert.deepEqual(await js(`[...document.querySelectorAll('.ai-source-row')].map(row=>row.dataset.source)`),['cursor','codex','grokbot','claude','grok','copilot','antigravity','manus']);
        assert.equal(await js(`[...document.querySelectorAll('.ai-source-main')].every(row=>getComputedStyle(row).display==='flex'&&getComputedStyle(row).flexDirection==='row'&&getComputedStyle(row.parentElement).paddingTop==='13px')`),true,'AI rows stay horizontal with 13px padding');
        assert.equal(await js(`document.querySelector('#settings-api-anchor').closest('[data-settings-group]').dataset.settingsGroup`),'ai');
      }
      if(group==='common')assert.equal(await js(`(()=>{const rows=[...document.querySelectorAll('#settings-group-common .settings-device-row:not([hidden])')];return rows.slice(1).every(row=>getComputedStyle(row).borderTopWidth==='1px')})()`),true,'common rows including meeting and bubbles have separators');
      if(group==='data')assert.equal(await js(`(()=>{const folder=document.querySelector('.settings-workspace-row');return getComputedStyle(folder).borderBottomWidth==='0px'&&[...document.querySelectorAll('.experience-backup')].every(card=>{const a=card.querySelector('.settings-backup-copy').getBoundingClientRect(),b=card.querySelector('button').getBoundingClientRect();return b.left>=a.right+10&&Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<2})})()`),true,'data has no trailing divider; backup copy and action share a row');
      if(group==='appearance')assert.equal(await js(`(()=>{const row=document.querySelector('.settings-weather-effects-row'),note=row.nextElementSibling;return note.classList.contains('settings-weather-attribution')&&getComputedStyle(row).borderBottomWidth==='0px'&&getComputedStyle(note).borderTopWidth==='0px'&&getComputedStyle(note).borderBottomWidth==='0px'})()`),true,'weather attribution has no dividing hairline');
      if(group==='data'){
        await js("notchAPI.setLanguage('en-US')");await until("document.documentElement.lang==='en-US'");
        assert.equal(await js(`Array.from(document.querySelectorAll('.experience-backup')).every(card=>{const a=card.querySelector('.settings-backup-copy').getBoundingClientRect(),b=card.querySelector('button').getBoundingClientRect();return b.left>=a.right+10&&Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<2})`),true,'English backup cards keep copy and action on one row');
        if(output){await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');fs.writeFileSync(path.join(output,preset+'-data-en.png'),(await c.capturePage()).toPNG());}
        await js("notchAPI.setLanguage('zh-CN')");await until("document.documentElement.lang==='zh-CN'");
      }
      if(group==='nas')assert.equal(await js(`['ui-nas-troubleshoot','settings-nas-advanced','settings-nas-details'].every(id=>document.getElementById(id).tagName==='SECTION'&&document.getElementById(id).checkVisibility())`),true,'NAS has no collapsed connection/content/troubleshooting sections');
      if(output) { fs.mkdirSync(output,{recursive:true}); c.invalidate();await delay(80);fs.writeFileSync(path.join(output,preset+'-'+group+'.png'),(await c.capturePage()).toPNG()); }
      matrix.push({preset,group,...geometry});
    }
  }
  await js(`notchAPI.setPanelSize('standard')`);await until(`document.documentElement.dataset.panelSize==='standard'`);
  await js(`NotchSettings.select('ai');document.getElementById('settings-grok-token').value='draft-survives-navigation';NotchSettings.select('data');NotchSettings.select('ai')`);
  assert.equal(await js(`document.getElementById('settings-grok-token').value`),'draft-survives-navigation');
  for(const [target,group] of [['settings-device-anchor','common'],['settings-api-anchor','ai'],['settings-display-anchor','display'],['experience-backup','data'],['settings-nas-sync-card','nas']]) {
    assert.equal(await js(`NotchSettings.reveal('${target}')`),true);
    assert.equal(await js(`NotchSettings.getGroup()`),group,'legacy anchor reveals its group');
  }
  await js(`setActiveTab('home')`);await until(`activeTab==='home'&&!tabBusy`);
  await js(`NotchSettings.reveal('settings-codex-token-card');setActiveTab('settings')`);await until(`activeTab==='settings'&&!tabBusy`);
  assert.equal(await js('NotchSettings.getGroup()'),'ai','queued deep link survives Settings entry');
  await js(`setActiveTab('home')`);await until(`activeTab==='home'&&!tabBusy`);
  await js(`setActiveTab('settings')`);await until(`activeTab==='settings'&&!tabBusy`);
  assert.equal(await js('NotchSettings.getGroup()'),'common','ordinary entry defaults to Common');
  await js(`document.getElementById('settings-nav-common').focus()`);
  for(const type of ['keyDown','keyUp'])c.sendInputEvent({type,keyCode:'Down'});
  await until(`NotchSettings.getGroup()==='appearance'`);
  assert.equal(await js('document.activeElement.id'),'settings-nav-appearance','keyboard moves selection and focus together');
  await js(`NotchSettings.select('ai');document.getElementById('settings-api-configure').click()`);
  await until(`!document.getElementById('transcription-settings-backdrop').hidden`);
  assert.equal(await js(`document.getElementById('transcription-settings-title').textContent`),'录音转写与命名');
  assert.equal(await js(`(()=>{const values=getComputedStyle(document.getElementById('transcription-api-key')).backgroundColor.match(/[\\d.]+/g).map(Number);return (values[3]??1)<.5||Math.max(...values.slice(0,3))<100})()`),true,'recording modal retains dark inputs rather than opaque white fields');
  if(output){await js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');await delay(150);fs.writeFileSync(path.join(output,'recording-modal.png'),(await c.capturePage()).toPNG());}
  await js(`document.getElementById('transcription-settings-cancel').click()`);
  if(output)for(const [group,target,name] of [['common','settings-auto-meeting-mode','meeting-signals'],['appearance','settings-mirror-preview','mirror-cover'],['ai','settings-cursor-token-card','ai-tokens'],['ai','settings-manus-token-card','ai-manus-recording'],['nas','settings-nas-content-results','nas-content-details']]){
    await js(`NotchSettings.reveal('${target}',{block:'center'});document.activeElement.blur()`);await delay(100);
    fs.writeFileSync(path.join(output,name+'.png'),(await c.capturePage()).toPNG());
    assert.equal(await js('NotchSettings.getGroup()'),group);
  }
  await js(`document.getElementById('settings-grok-token').value='';NotchSettings.select('display')`);
  if(output)fs.writeFileSync(path.join(output,'group-matrix.json'),JSON.stringify(matrix,null,2));
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
  await js(`hiddenHomeModules=[...new Set([...hiddenHomeModules,'windows'])];saveHiddenHomeModules();document.dispatchEvent(new CustomEvent('notch:home-modules-changed',{detail:NotchHome.getVisibility()}));`);
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
  await until(`document.querySelector('[data-settings-home-module=${visible[0]}]').checked && document.querySelector('[data-settings-home-module=${visible[0]}]').disabled`);
  assert.equal(await js('NotchHome.getVisibility().visibleIds.length'),1);
  assert.equal((await js(`NotchHome.setModuleVisible('${visible[0]}',false)`)).error,'at_least_one_required');
  assert.deepEqual((await js('notchAPI.getAppSettings()')).features,featureBefore);
  assert.deepEqual(errors,[]);
}
require('../main');
