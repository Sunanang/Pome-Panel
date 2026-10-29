/* Small, local affordances shared by the existing workbench views. */
(() => {
  'use strict';
  const I=window.PomeI18n, $=id=>document.getElementById(id);
  function label(node,key,args){I.bind(node,'textContent',()=>I.t(key,args));return node;}
  function help(parent,key){const p=label(document.createElement('p'),key);p.className='experience-hint';parent?.append(p);return p;}
  function action(key,run){const b=label(document.createElement('button'),key);b.type='button';b.className='workspace-button compact';b.addEventListener('click',run);return b;}
  function search(id,key,parent,before,onInput){
    const input=document.createElement('input');input.type='search';input.id=id;input.className='experience-search';
    I.bind(input,'placeholder',()=>I.t(key));I.bind(input,'ariaLabel',()=>I.t(key));
    input.addEventListener('input',()=>onInput(input.value));parent.insertBefore(input,before||null);return input;
  }
  const aiHint=help(null,'ux.ai.capabilities');$('settings-ai-sources-list').before(aiHint);
  help(document.querySelector('.settings-api-card'),'ux.record.configHint');
  help(document.querySelector('.credentials-form-card'),'ux.credentials.hint');
  const todoHint=help(null,'ux.todo.hint');
  I.bind(todoHint,'title',()=>I.t('ux.todo.hint'));
  $('todo-add-category').before(todoHint);
  help(document.querySelector('.clip-panel'),'ux.clip.hint');
  search('clip-search','ux.search.clip',$('clip-toolbar'),$('clip-clear-btn'),()=>{clipDataVersion++;renderClipList();});
  search('links-search','ux.search.links',document.querySelector('.links-toolbar'),null,value=>document.dispatchEvent(new CustomEvent('notch:link-search',{detail:value})));
  const nav=document.createElement('nav');nav.className='settings-experience-nav';I.bind(nav,'ariaLabel',()=>I.t('copy.pomePanelSettings.e4a017'));
  for(const [id,key] of [['settings-ai-sources','ux.settings.ai'],['settings-device-anchor','ux.settings.device'],['settings-api-anchor','ux.settings.recording'],['settings-display-anchor','ux.settings.display'],['experience-backup','ux.backup.title'],['settings-nas-sync-card','copy.nasSync.deb3d4']]){
    nav.append(action(key,()=>{const target=$(id);if(target){for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;target.scrollIntoView({block:'start',behavior:'instant'});}target?.classList.add('experience-highlight');setTimeout(()=>target?.classList.remove('experience-highlight'),1000);}));
  }
  document.querySelector('.settings-device-card').id='settings-device-anchor';document.querySelector('.settings-api-card').id='settings-api-anchor';document.querySelector('.settings-display-card').id='settings-display-anchor';
  $('settings-page').before(nav);
  nav.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('notch:settings-navigate')));
  const backup=document.createElement('section');backup.id='experience-backup';backup.className='tile settings-card experience-backup';
  backup.append(label(document.createElement('h3'),'ux.backup.title'));help(backup,'ux.backup.hint');
  const backupActions=document.createElement('div');backupActions.className='experience-actions';
  for(const [id,key] of [['settings-nas-export-backup','copy.exportDataBackup.652e8a'],['settings-nas-restore-backup','copy.restoreDataBackup.8838f6']])backupActions.append(action(key,()=>$(id).click()));
  backup.append(backupActions);document.querySelector('.settings-column-secondary').insertBefore(backup,$('settings-nas-sync-card'));
  const nasGuide=help($('settings-nas-pair-fields'),'ux.nas.guide');nasGuide.classList.add('nas-pair-guide');
  // Keep the same form and handlers, changing the disclosure label according to binding state.
  function nasLabel(){const summary=$('ui-nas-troubleshoot')?.querySelector('summary');if(summary)label(summary,window.__pomeNasUi?.bound?'ui.nas.troubleshoot':'ux.nas.connection');}
  new MutationObserver(nasLabel).observe($('ui-nas-message'),{childList:true,subtree:true});nasLabel();
  document.querySelector('#transcription-settings-backdrop .transcription-settings-head').after(help(null,'ux.record.configHint'));
  help(document.getElementById('transcription-region').parentElement,'ux.record.regionHint');
  // Optional protocol/model details remain available, below the everyday controls.
  for(const selector of ['#transcription-workspace','#llm-base-url','#llm-model']){
    const field=document.querySelector(selector)?.closest('label,.transcription-field');if(field)field.classList.add('transcription-advanced-field');
  }
  const advanced=document.createElement('details');advanced.className='transcription-advanced';advanced.append(label(document.createElement('summary'),'copy.advanced.d6e618'));
  $('transcription-settings-backdrop').querySelector('.transcription-settings-actions').before(advanced);
  document.querySelectorAll('.transcription-advanced-field').forEach(field=>advanced.append(field));
  // Preferences stay on this device and do not affect recognition language or stored content.
  const preference=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
  function savePreference(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}}
  function selectPreference(key,title,options,fallback,onChange){
    const row=document.createElement('label');row.className='settings-device-row settings-select-row';row.append(label(document.createElement('span'),title));
    const select=document.createElement('select');select.id=key;
    for(const [value,textKey] of options){const option=document.createElement('option');option.value=value;label(option,textKey);select.append(option);}
    select.value=preference(key,fallback);row.append(select);document.querySelector('.settings-device-card').append(row);
    select.addEventListener('change',()=>{const previous=preference(key,fallback);if(!savePreference(key,select.value)){select.value=previous;window.NotchUi?.showError({messageKey:'ux.preference.failed',scope:'experience:preferences',onRepair:()=>select.focus()});return;}onChange(select.value);});return select;
  }
  selectPreference('pome-weather-unit','ux.weather.unit',[['c','ux.weather.c'],['f','ux.weather.f']],'c',()=>window.PomeSun?.render());
  const motion=selectPreference('pome-interface-motion','ux.motion.title',[['system','settings.system'],['reduce','ux.motion.reduce']],'system',applyMotion);
  function applyMotion(){document.documentElement.classList.toggle('experience-reduced-motion',motion.value==='reduce');document.dispatchEvent(new CustomEvent('notch:motion-preference'));}
  applyMotion();
  window.PomeExperience={highlight(node){if(!node)return;node.classList.add('experience-highlight');setTimeout(()=>node.classList.remove('experience-highlight'),1000);},closeOverlayOnEscape(){if($('sun-location-popover') && !$('sun-location-popover').hidden){window.PomeSun?.closeLocation();return true;}return false;}};
  // A successful clipboard write gets feedback beside the action, without shifting content.
  document.addEventListener('notch:copied',e=>{const target=e.detail?.target;if(!target?.isConnected)return;target.classList.add('experience-copied');const old=target.getAttribute('aria-label');target.setAttribute('aria-label',I.t('ui.copied'));setTimeout(()=>{target.classList.remove('experience-copied');if(target.isConnected&&old)target.setAttribute('aria-label',old);},1000);});
})();
