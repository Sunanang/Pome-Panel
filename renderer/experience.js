/* Small, local affordances shared by the existing workbench views. */
(() => {
  'use strict';
  const I=window.PomeI18n, $=id=>document.getElementById(id);
  function label(node,key,args){I.bind(node,'textContent',()=>I.t(key,args));return node;}
  function help(parent,key){const p=label(document.createElement('p'),key);p.className='experience-hint';parent?.append(p);return p;}
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
  // Backup actions share the existing handlers, in separate Data cards.
  document.querySelectorAll('[data-backup-action]').forEach(button => {
    button.addEventListener('click', () => $(button.dataset.backupAction)?.click());
  });
  const nasGuide=help($('settings-nas-pair-fields'),'ux.nas.guide');nasGuide.classList.add('nas-pair-guide');
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
    select.value=preference(key,fallback);row.append(select);$('settings-appearance-card').append(row);
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
