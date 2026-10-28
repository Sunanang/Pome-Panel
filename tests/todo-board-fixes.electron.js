'use strict';

/**
 * Acceptance: sun default city, recorder quick-entry placement,
 * custom todo time pickers, and dynamic todo categories.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const userData = process.env.TODO_TEST_USER_DATA
  || fs.mkdtempSync(path.join(os.tmpdir(), 'pome-todo-board-'));
const shots = process.env.TODO_BOARD_SHOTS
  || path.join(__dirname, '..', 'dist.noindex', 'todo-board-fixes');

app.setPath('userData', userData);
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => {
  console.error('todo-board-fixes timed out');
  app.exit(1);
}, 90000);

async function main() {
  fs.mkdirSync(shots, { recursive: true });
  // Clear sun location so first paint seeds Shanghai (or TZ suggestion).
  const win = new BrowserWindow({
    width: 1240,
    height: 700,
    frame: false,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: false,
      preload: path.join(__dirname, 'sun-home.preload.js'),
      additionalArguments: ['--sun-test-platform=darwin'],
    },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' && !String(details.message).includes('ERR_')) {
      errors.push(details.message);
    }
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const frames = () => js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  async function capture(label, selector) {
    // capturePage can otherwise catch the tab/expand transition's previous paint.
    await new Promise(resolve => setTimeout(resolve, 600));
    await frames();
    const rect = selector && await js(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
    fs.writeFileSync(path.join(shots, `${label}.png`), (await win.webContents.capturePage(rect || undefined)).toPNG());
  }
  async function until(code, tries = 120) {
    for (let i = 0; i < tries; i += 1) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out: ${code}`);
  }

  await win.loadFile(path.join(__dirname, '..', 'renderer/index.html'));
  await until('!!window.NotchDomain && !!document.getElementById("todo-sections")');
  await js(`(() => {
    localStorage.removeItem('notch-sun-location-v1');
    localStorage.removeItem('notch-todo-category-order-v1');
    if (window.PomeSun) {
      PomeSun.setLocation(null, { persist: false });
      PomeSun.render();
    }
  })()`);
  // Re-seed happens on widget remount only; force seed path used at startup.
  await js(`(() => {
    if (!window.PomeSun) return;
    const city = (window.POME_CITIES || []).find((c) => c.name === '上海' || c.en === 'Shanghai');
    if (city && window.NotchSun) {
      PomeSun.setLocation(window.NotchSun.locationFromCity(city), { persist: true });
    }
  })()`);
  await js(`(() => {
    hiddenHomeModules = HOME_MODULE_REGISTRY.filter((id) => !['recorder', 'sun', 'pomodoro', 'note'].includes(id));
    homeSizes.recorder = 'medium';
    homeSizes.sun = 'medium';
    homeWorkingLayout = {
      allowGaps: true,
      placements: {
        recorder: { column: 0, row: 0, width: 4, height: 2 },
        sun: { column: 4, row: 0, width: 4, height: 2 },
        pomodoro: { column: 8, row: 0, width: 4, height: 2 },
        note: { column: 0, row: 2, width: 12, height: 2 },
      },
      variants: {},
    };
    applyHomeLayout(homeWorkingLayout, { reason: 'initial' });
  })()`);
  await js('setMode(true)');
  await until('!modeBusy');
  await until(`document.getElementById('app').classList.contains('expanded')`);
  await js(`setActiveTab('home')`);
  await until(`!!document.querySelector('#home-sun [data-sun-place]')`);
  await until(`!!document.getElementById('ui-open-recordings')`);

  const sunPlace = await js(`document.querySelector('#home-sun [data-sun-place]')?.textContent || ''`);
  assert.match(sunPlace, /上海|Shanghai|北京|Beijing|[\\u4e00-\\u9fff]/, `sun place: ${sunPlace}`);
  assert.equal(
    await js(`!!document.querySelector('#home-sun .sun-empty')`),
    false,
    'sun must not show empty set-location card after seed'
  );

  const recorder = await js(`(() => {
    const btn = document.getElementById('ui-open-recordings');
    const tile = document.getElementById('home-recorder');
    const head = document.querySelector('#home-recorder .recorder-head');
    const title = document.getElementById('home-recording-state');
    const time = document.getElementById('home-recording-time');
    if (!btn || !tile || !head || !title || !time) return { ok: false };
    const br = btn.getBoundingClientRect();
    const tr = title.getBoundingClientRect();
    const timeR = time.getBoundingClientRect();
    const headR = head.getBoundingClientRect();
    const overlaps = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    return {
      ok: true,
      inTile: tile.contains(btn),
      inHead: head.contains(btn),
      overlapTitle: overlaps(br, tr),
      overlapTime: overlaps(br, timeR),
      belowHead: br.top >= headR.bottom - 1,
      btnBottom: br.bottom,
      tileBottom: tile.getBoundingClientRect().bottom,
    };
  })()`);
  assert.equal(recorder.inTile, true, 'quick-entry must be on the recorder tile');
  assert.equal(recorder.inHead, false, 'quick-entry must not crowd the title row');
  assert.equal(recorder.overlapTitle, false, `quick-entry overlaps title: ${JSON.stringify(recorder)}`);
  assert.equal(recorder.overlapTime, false, `quick-entry overlaps time: ${JSON.stringify(recorder)}`);
  assert.equal(recorder.belowHead, true, `quick-entry should sit below the head: ${JSON.stringify(recorder)}`);
  await capture('01-home-sun-recorder');

  await js(`document.querySelector('.ui-capsule-hint button')?.click()`);
  await js(`setActiveTab('todo')`);
  await until(`document.getElementById('tab-todo').classList.contains('active')`);
  await until(`document.getElementById('tab-button-todo')?.getAttribute('aria-selected') === 'true'`);
  await until(`document.querySelectorAll('#todo-sections .quadrant').length >= 4`);
  assert.equal(await js(`document.querySelectorAll('#todo-sections .quadrant').length`), 4);
  // Let tab paint settle before screenshot (rAF alone can still grab home).
  await new Promise((r) => setTimeout(r, 80));
  await capture('02-todo-default-4');
  assert.equal(
    await js(`document.getElementById('tab-button-todo')?.getAttribute('aria-selected')`),
    'true',
    '02 shot must be on todo tab'
  );

  assert.equal(await js(`!!document.querySelector('.todo-page-heading')`), true, 'todo heading provides a stable title and category action');
  const fill = await js(`(() => {
    const tab = document.getElementById('tab-todo').getBoundingClientRect();
    const sections = document.getElementById('todo-sections').getBoundingClientRect();
    const heading = document.querySelector('.todo-page-heading').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#todo-sections .quadrant')].map((el) => el.getBoundingClientRect());
    const bottom = Math.max(...cards.map((r) => r.bottom));
    const right = Math.max(...cards.map((r) => r.right));
    return {
      heightFill: sections.height / Math.max(1, tab.bottom - sections.top),
      belowHeading: sections.top >= heading.bottom - 1,
      widthFill: sections.width / tab.width,
      cardsReachBottom: (tab.bottom - bottom) <= 16,
      cardsReachRight: (tab.right - right) <= 16,
      cardCount: cards.length,
    };
  })()`);
  assert.ok(fill.heightFill >= 0.92, `todo grid must fill remaining content height: ${JSON.stringify(fill)}`);
  assert.equal(fill.belowHeading, true, 'todo categories follow their page heading');
  assert.ok(fill.widthFill >= 0.92, `todo grid must fill tab width: ${JSON.stringify(fill)}`);
  assert.equal(fill.cardsReachBottom, true, `4 cards must reach panel bottom: ${JSON.stringify(fill)}`);
  assert.equal(fill.cardsReachRight, true, `4 cards must reach panel right: ${JSON.stringify(fill)}`);
  const categoryAction = await js(`(() => {
    const b = document.getElementById('todo-add-category');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const heading = document.querySelector('.todo-page-heading').getBoundingClientRect();
    return {
      hidden: b.hidden,
      aria: b.getAttribute('aria-label'),
      inHeading: b.closest('.todo-page-heading') !== null,
      visible: r.left >= heading.left && r.right <= heading.right + 1 && r.top >= heading.top && r.bottom <= heading.bottom + 1,
      hittable: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#todo-add-category') === b,
      w: r.width,
      h: r.height,
    };
  })()`);
  assert.equal(categoryAction.hidden, false);
  assert.equal(categoryAction.aria, '添加分类');
  assert.equal(categoryAction.inHeading, true);
  assert.equal(categoryAction.visible, true, JSON.stringify(categoryAction));
  assert.equal(categoryAction.hittable, true, 'category action is directly clickable in the heading');
  assert.ok(categoryAction.w >= 28 && categoryAction.h >= 28, 'category action keeps a usable pointer target');
  await js(`document.getElementById('todo-add-category').click()`);
  await until(`document.querySelectorAll('#todo-sections .quadrant').length === 5`);
  assert.equal(await js(`document.querySelectorAll('#todo-sections .quadrant').length`), 5);
  assert.equal(await js(`!!document.querySelector('.quadrant[data-priority="P4"]')`), true);
  await capture('03-todo-added-5');

  // Rename + add a todo in P4, then rebuild from data-only order reconciliation.
  await js(`(() => {
    const input = document.querySelector('.todo-category-name[data-category="P4"]');
    input.value = '验收分类';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const add = document.querySelector('.add-row input[data-priority="P4"]');
    add.value = 'P4 同步可见条目';
    add.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await until(`document.querySelectorAll('.quadrant[data-priority="P4"] .todo-item').length === 1`);
  await capture('03b-todo-p4-item');

  await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').click()`);
  await until(`!document.getElementById('todo-date-popover').hidden`);
  const popHost = await js(`(() => {
    const pop = document.getElementById('todo-date-popover');
    const pr = pop.getBoundingClientRect();
    const card = pop.querySelector('.todo-editor-card')?.getBoundingClientRect();
    return {
      parentIsBody: pop.parentElement === document.body,
      fixed: getComputedStyle(pop).position === 'fixed',
      clippedByQuadrant: !!pop.closest('.quadrant'),
      clippedByPanel: !!pop.closest('.panel'),
      fullyOnScreen:
        pr.left >= 0 && pr.top >= 0 &&
        pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1,
      cardFullyVisible: !!card && card.height > 180 && card.bottom <= innerHeight + 1,
      height: pr.height,
    };
  })()`);
  assert.equal(popHost.parentIsBody, true, 'popover must portal to document.body');
  assert.equal(popHost.fixed, true, 'popover must be position:fixed');
  assert.equal(popHost.clippedByQuadrant, false);
  assert.equal(popHost.clippedByPanel, false);
  assert.equal(popHost.fullyOnScreen, true, JSON.stringify(popHost));
  assert.equal(popHost.cardFullyVisible, true, JSON.stringify(popHost));
  assert.equal(await js(`['todo-editor-hour','todo-editor-minute'].every(id => {
    const picker=document.getElementById(id), selected=picker.querySelector('[aria-selected="true"]');
    const p=picker.getBoundingClientRect(), s=selected.getBoundingClientRect();
    return s.top>=p.top&&s.bottom<=p.bottom;
  })`), true, 'first open must reveal the selected hour and minute, not start both lists at 00');
  const hitTest = await js(`(() => {
    const pop = document.getElementById('todo-date-popover');
    const card = pop.querySelector('.todo-editor-card');
    const cr = card.getBoundingClientRect();
    const samples = [
      [cr.left + cr.width / 2, cr.bottom - 3],
      [cr.left + 28, cr.bottom - 12],
      [cr.right - 28, cr.bottom - 12],
      [cr.left + cr.width / 2, cr.top + 8],
    ];
    return samples.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return {
        x, y,
        inPopover: !!(el && (el === pop || pop.contains(el))),
        id: el?.id || '',
        cls: String(el?.className || '').slice(0, 48),
      };
    });
  })()`);
  assert.ok(hitTest.every((s) => s.inPopover), `popover bottom hit-test failed: ${JSON.stringify(hitTest)}`);
  const hours = await js(`document.querySelectorAll('#todo-editor-hour button[data-value]').length`);
  const minutes = await js(`document.querySelectorAll('#todo-editor-minute button[data-value]').length`);
  assert.equal(hours, 24);
  assert.equal(minutes, 12);
  // Pick a late-evening time so "must be later than now" validation still passes.
  await js(`document.querySelector('#todo-editor-hour button[data-value="23"]').click()`);
  await js(`document.querySelector('#todo-editor-minute button[data-value="45"]').click()`);
  const picked = await js(`({
    hour: document.querySelector('#todo-editor-hour button[aria-selected="true"]')?.textContent,
    minute: document.querySelector('#todo-editor-minute button[aria-selected="true"]')?.textContent,
    trigger: document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"] span')?.textContent,
    error: document.getElementById('todo-editor-error')?.textContent || '',
  })`);
  assert.equal(picked.hour, '23');
  assert.equal(picked.minute, '45');
  assert.equal(picked.error, '', `time apply failed: ${picked.error}`);
  assert.match(String(picked.trigger || ''), /23:45/);
  await capture('04-todo-time-picker');

  // Bottom-right category must also escape clip (edge card).
  await js(`document.getElementById('todo-date-popover').hidden = true`);
  await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P3"]').click()`);
  await until(`!document.getElementById('todo-date-popover').hidden`);
  const edgePop = await js(`(() => {
    const pop = document.getElementById('todo-date-popover');
    const pr = pop.getBoundingClientRect();
    return {
      parentIsBody: pop.parentElement === document.body,
      fullyOnScreen:
        pr.left >= 0 && pr.top >= 0 &&
        pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1,
      height: pr.height,
    };
  })()`);
  assert.equal(edgePop.parentIsBody, true);
  assert.equal(edgePop.fullyOnScreen, true, JSON.stringify(edgePop));
  await capture('04b-todo-time-picker-edge');

  // Rebuild board while popover is open — popover node must survive.
  await js(`renderTodoBoard()`);
  assert.equal(await js(`!!document.getElementById('todo-date-popover')`), true, 'popover survives board rebuild');

  await js(`document.getElementById('todo-date-popover').hidden = true`);
  await js(`removeTodoCategory('P4');void 0`);
  await until(`document.getElementById('content-delete-confirm').open`);
  await js(`document.getElementById('content-delete-apply').click()`);
  await until(`!document.querySelector('.quadrant[data-priority="P4"]')`);
  await capture('05-todo-removed-p4');

  // Hidden order + non-empty remote-like data must resurface the column.
  await js(`(() => {
    data.P5 = [{ id: 'remote-p5', text: '远端分类条目', done: false, createdAt: Date.now(), deadline: '', remindedAt: 0 }];
    todoCategoryOrder = ['P0', 'P1', 'P2', 'P3'];
    localStorage.setItem('notch-todo-category-order-v1', JSON.stringify(todoCategoryOrder));
    localStorage.setItem('notch-todo-data', JSON.stringify(data));
    reconcileTodoCategoryOrderFromData();
    renderTodoBoard();
  })()`);
  await until(`!!document.querySelector('.quadrant[data-priority="P5"]')`);
  assert.equal(await js(`document.querySelector('.quadrant[data-priority="P5"] .todo-text')?.textContent`), '远端分类条目');
  await capture('06-todo-order-reconcile');

  // Opening is read-only, including imported minutes/seconds and missing dates.
  const deadlineSafety = await js(`(() => {
    const exact=new Date(Date.now()+3*86400000);exact.setHours(18,32,45,123);
    const regular=new Date(exact);regular.setMinutes(30,0,0);
    const rows=[
      {id:'deadline-exact',text:'18:32 打开不改期',deadline:exact.toISOString()},
      {id:'deadline-grid',text:'18:30 不重复保存',deadline:regular.toISOString()},
      {id:'deadline-empty',text:'无截止时间',deadline:''},
      {id:'deadline-past',text:'已过期不自动改期',deadline:new Date(2020,0,1,18,32,45,123).toISOString()},
    ].map(row=>({...row,done:false,createdAt:Date.now(),remindedAt:0}));
    data.P0.push(...rows);localStorage.setItem(STORAGE_KEY,JSON.stringify(data));renderList('P0');
    const baseline=localStorage.getItem(STORAGE_KEY), originalSet=Storage.prototype.setItem;
    const reminders=notchAPI.fixtureReminderScheduleCount();let writes=0;
    Storage.prototype.setItem=function(key,value){if(key===STORAGE_KEY)writes++;return originalSet.call(this,key,value);};
    const open=row=>{
      closeTodoEditor();editingTodo=null;renderList('P0');
      document.querySelector('[data-id="'+row.id+'"] [data-action="edit"]').click();
      document.querySelector('[data-id="'+row.id+'"] [data-action="edit-deadline"]').click();
    };
    try {
      open(rows[0]);
      const minuteShown=todoTimePickerValue(todoEditorMinute);
      document.querySelector('#todo-editor-hour button[aria-selected="true"]').click();
      document.querySelector('#todo-editor-minute button[aria-selected="true"]').click();
      document.querySelector('#todo-calendar-grid button.selected').click();
      closeTodoEditor();open(rows[0]);
      const readOnly={writes,reminders:notchAPI.fixtureReminderScheduleCount()-reminders,
        storageUnchanged:localStorage.getItem(STORAGE_KEY)===baseline,deadlineUnchanged:rows[0].deadline===exact.toISOString(),minuteShown};
      document.querySelector('#todo-editor-hour button[data-value="19"]').click();
      const changed=new Date(exact);changed.setHours(19,32,0,0);
      const changedOnce={writes,reminders:notchAPI.fixtureReminderScheduleCount()-reminders,
        stored:JSON.parse(localStorage.getItem(STORAGE_KEY)).P0.find(row=>row.id===rows[0].id).deadline===changed.toISOString()};
      document.querySelector('#todo-editor-hour button[data-value="19"]').click();
      document.querySelector('#todo-editor-minute button[data-value="32"]').click();
      closeTodoEditor();open(rows[0]);open(rows[1]);open(rows[2]);open(rows[3]);
      const noExtraWrites=writes===1&&notchAPI.fixtureReminderScheduleCount()-reminders===1;
      const missingUnchanged=data.P0.find(row=>row.id==='deadline-empty').deadline===''
        &&JSON.parse(localStorage.getItem(STORAGE_KEY)).P0.find(row=>row.id==='deadline-empty').deadline==='';
      closeTodoEditor();openTodoEditor('P0');
      document.querySelector('#todo-editor-minute button[data-value="45"]').click();
      const draftOnly=writes===1&&notchAPI.fixtureReminderScheduleCount()-reminders===1
        &&document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').dataset.deadlineSource==='manual';
      return {readOnly,changedOnce,noExtraWrites,missingUnchanged,draftOnly};
    } finally {Storage.prototype.setItem=originalSet;closeTodoEditor();editingTodo=null;renderList('P0');}
  })()`);
  assert.deepEqual(deadlineSafety,{readOnly:{writes:0,reminders:0,storageUnchanged:true,deadlineUnchanged:true,minuteShown:'32'},
    changedOnce:{writes:1,reminders:1,stored:true},noExtraWrites:true,missingUnchanged:true,draftOnly:true});
  fs.writeFileSync(path.join(shots,'deadline-readonly.json'),JSON.stringify(deadlineSafety,null,2));
  // Reopen the untouched 18:32 example for a visual check of its real minute.
  await js(`(() => {
    const row=data.P0.find(item=>item.id==='deadline-exact');const date=new Date(row.deadline);date.setHours(18,32,45,123);row.deadline=date.toISOString();
    localStorage.setItem(STORAGE_KEY,JSON.stringify(data));editingTodo={priority:'P0',id:row.id};renderList('P0');
    document.querySelector('[data-id="deadline-exact"]').scrollIntoView({block:'nearest'});
    document.querySelector('[data-id="deadline-exact"] [data-action="edit-deadline"]').click();
  })()`);
  await capture('06b-deadline-exact-minute');
  await capture('06c-deadline-exact-minute-popover', '#todo-date-popover');

  const unsetBehavior = await js(`(() => {
    const row=data.P0.find(item=>item.id==='deadline-empty');
    const originalSet=Storage.prototype.setItem;let writes=0;
    Storage.prototype.setItem=function(key,value){if(key===STORAGE_KEY)writes++;return originalSet.call(this,key,value);};
    const summary=()=>({writes,reminders:notchAPI.fixtureReminderScheduleCount()-baseline,
      pending:todoEditorContext.unset,state:todoEditorState.textContent,
      selected:document.querySelectorAll('#todo-calendar-grid .selected,#todo-date-popover .todo-time-picker [aria-selected="true"]').length,
      deadline:data.P0.find(item=>item.id===row.id).deadline,
      stored:JSON.parse(localStorage.getItem(STORAGE_KEY)).P0.find(item=>item.id===row.id).deadline});
    let baseline=0;
    const reopenEmpty=()=>{
      closeTodoEditor();row.deadline='';
      originalSet.call(localStorage,STORAGE_KEY,JSON.stringify(data));writes=0;baseline=notchAPI.fixtureReminderScheduleCount();
      editingTodo={priority:'P0',id:row.id};renderList('P0');
      document.querySelector('[data-id="deadline-empty"] [data-action="edit-deadline"]').click();
    };
    try {
      reopenEmpty();const initial=summary();
      document.getElementById('todo-calendar-next').click();const browsed=summary();
      PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));const english=summary();
      document.querySelector('#todo-calendar-grid [data-day="1"]').click();
      const selectedDay=summary();
      document.querySelector('#todo-calendar-grid [data-day="1"]').click();
      const repeatWrites=writes;
      closeTodoEditor();openTodoEditor('P0',row);const existingHasNoHint=todoEditorState.hidden;
      const timeSelections=[];
      for(const id of ['todo-editor-hour','todo-editor-minute']) {
        reopenEmpty();document.getElementById('todo-calendar-next').click();
        // Explicitly selecting the suggested value is a real empty -> set change.
        document.querySelector('#'+id+' [data-value="'+document.getElementById(id).dataset.value+'"]').click();
        timeSelections.push(summary());
      }
      reopenEmpty();document.getElementById('todo-calendar-previous').click();
      document.querySelector('#todo-calendar-grid [data-day="1"]').click();const invalid=summary();
      return {initial,browsed,english,selectedDay,repeatWrites,existingHasNoHint,timeSelections,invalid};
    } finally {Storage.prototype.setItem=originalSet;closeTodoEditor();PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));}
  })()`);
  const empty={writes:0,reminders:0,pending:true,state:'尚未设置 · 选择后生效',selected:0,deadline:'',stored:''};
  assert.deepEqual(unsetBehavior.initial,empty,'empty deadlines show no committed selection and do not write');
  assert.deepEqual(unsetBehavior.browsed,empty,'browsing months does not imply a selection');
  assert.deepEqual(unsetBehavior.english,{...empty,state:'Not set · Select to apply'});
  for(const value of [unsetBehavior.selectedDay,...unsetBehavior.timeSelections]) {
    assert.equal(value.writes,1);assert.equal(value.reminders,1);assert.equal(value.pending,false);
    assert.equal(value.state,'Set');assert.equal(value.selected,3);assert.equal(value.deadline,value.stored);
    assert(Number.isFinite(Date.parse(value.stored))&&Date.parse(value.stored)>Date.now());
  }
  assert.equal(unsetBehavior.repeatWrites,1);assert.equal(unsetBehavior.existingHasNoHint,true);
  assert.deepEqual(unsetBehavior.invalid,{...empty,state:'Not set · Select to apply'},'invalid choices stay unset');
  fs.writeFileSync(path.join(shots,'deadline-unset.json'),JSON.stringify(unsetBehavior,null,2));
  await js(`editingTodo={priority:'P0',id:'deadline-empty'};renderList('P0');
    document.querySelector('[data-id="deadline-empty"]').scrollIntoView({block:'nearest'});
    document.querySelector('[data-id="deadline-empty"] [data-action="edit-deadline"]').click();void 0`);
  await capture('06d-deadline-unset-zh', '#todo-date-popover');
  await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));void 0`);
  await capture('06e-deadline-unset-en', '#todo-date-popover');
  await js(`document.getElementById('todo-calendar-next').click();document.querySelector('#todo-calendar-grid [data-day="1"]').click();void 0`);
  await capture('06f-deadline-set-en', '#todo-date-popover');
  await js(`closeTodoEditor();PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));void 0`);
  await js(`closeTodoEditor();editingTodo=null;data.P0=data.P0.filter(row=>!row.id.startsWith('deadline-'));localStorage.setItem(STORAGE_KEY,JSON.stringify(data));renderList('P0');void 0`);

  // An identical or changed NAS projection must retain all unsaved form state.
  const preserved = await js(`(() => {
    const input=document.querySelector('.add-row input[data-priority="P0"]');
    const trigger=document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]');
    const name=document.querySelector('.todo-category-name[data-category="P0"]');
    input.value='同步中仍保留的草稿';
    trigger.dataset.deadline=new Date(Date.now()+5*86400000).toISOString();trigger.dataset.deadlineSource='manual';
    const deadline=trigger.dataset.deadline;
    name.value='尚未提交的分类名';
    editingTodo={priority:'P5',id:'remote-p5'};renderList('P5');
    let inline=document.querySelector('.todo-inline-name');inline.value='尚未提交的编辑';inline.focus();inline.setSelectionRange(1,4);
    const project=()=>applyTodosSyncProjectionPayload({todosJson:JSON.stringify(data),categoryNamesJson:JSON.stringify(todoCategoryNames)});
    project();
    const identical=input===document.querySelector('.add-row input[data-priority="P0"]')&&input.value==='同步中仍保留的草稿'&&trigger.dataset.deadline===deadline;
    data.P1.push({id:'remote-added',text:'同步新增待办',done:false,createdAt:Date.now(),deadline:'',remindedAt:0});
    project();
    inline=document.querySelector('.todo-inline-name');
    return {identical, draft:input.value,deadline:trigger.dataset.deadline===deadline,manual:trigger.dataset.deadlineSource,
      name:name.value,inline:inline.value,focused:document.activeElement===inline,selection:[inline.selectionStart,inline.selectionEnd],
      remoteVisible:!!document.querySelector('[data-id="remote-added"]')};
  })()`);
  assert.deepEqual(preserved, {identical:true,draft:'同步中仍保留的草稿',deadline:true,manual:'manual',name:'尚未提交的分类名',
    inline:'尚未提交的编辑',focused:true,selection:[1,4],remoteVisible:true});
  await capture('08-sync-preserves-drafts');

  // A structural update preserves surviving forms and invalidates popup anchors.
  await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').click()`);
  await js(`data.P6=[{id:'remote-p6',text:'新分类',done:false,createdAt:Date.now(),deadline:'',remindedAt:0}];
    applyTodosSyncProjectionPayload({todosJson:JSON.stringify(data),categoryNamesJson:JSON.stringify(todoCategoryNames)});void 0`);
  assert.equal(await js(`document.querySelector('.add-row input[data-priority="P0"]').value`),'同步中仍保留的草稿');
  assert.equal(await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').dataset.deadlineSource`),'manual');
  assert.equal(await js(`document.getElementById('todo-date-popover').hidden`),true);
  assert.equal(await js(`todoEditorContext===null`),true);

  // No pointerdown: exercise keyboard/programmatic page changes and shortcut collapse.
  await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').click();setActiveTab('settings')`);
  await until(`document.getElementById('tab-settings').getAttribute('aria-hidden')==='false'`);
  assert.equal(await js(`document.getElementById('todo-date-popover').hidden`),true);
  await capture('09-settings-no-calendar');
  await js(`setActiveTab('todo')`);
  await until(`document.getElementById('tab-todo').getAttribute('aria-hidden')==='false'`);
  await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').click();notchAPI.fixtureCollapse()`);
  await until(`!modeBusy&&!isExpanded`);
  assert.equal(await js(`document.getElementById('todo-date-popover').hidden`),true);
  assert.equal(await js(`todoEditorContext===null`),true);
  await capture('10-collapse-no-calendar');
  await js(`setMode(true)`);await until(`!modeBusy&&isExpanded`);
  await js(`setActiveTab('todo')`);
  await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]').click();
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;void 0`);
  assert.equal(await js(`document.getElementById('todo-date-popover').hidden`),true);
  // Remote removal must not leave an editor capable of mutating a deleted task.
  await js(`openTodoEditor('P5',data.P5[0]);data.P5=[];
    applyTodosSyncProjectionPayload({todosJson:JSON.stringify(data),categoryNamesJson:JSON.stringify(todoCategoryNames)});void 0`);
  assert.equal(await js(`todoEditorContext===null&&editingTodo===null&&document.getElementById('todo-date-popover').hidden`),true);

  // Seed stale Chinese chrome on an empty deadline trigger + bulk delete before switching locale.
  await js(`(() => {
    const trigger=document.querySelector('.todo-deadline-trigger[data-deadline-priority="P2"]');
    delete trigger.dataset.deadline; delete trigger.dataset.deadlineSource;
    trigger.classList.remove('selected'); trigger.querySelector('span').textContent='日期';
    document.querySelector('.todo-bulk-delete').textContent='删除';
  })()`);
  await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));void 0`);
  assert.equal(await js(`document.querySelector('.add-row input').placeholder`),'Add a task and press Enter to save…');
  assert.match(await js(`document.querySelector('.add-row input').getAttribute('aria-label')`),/^Add a task to /);
  assert.equal(await js(`document.querySelector('[data-remove-priority]').title`),'Delete category');
  assert.equal(await js(`document.querySelector('.todo-category-name').getAttribute('aria-label')`),'Rename task category');
  assert.equal(await js(`document.querySelector('.todo-deadline-trigger').getAttribute('aria-label')`),'Choose deadline');
  assert.equal(await js(`document.getElementById('todo-add-category').title`),'Add category');
  assert.equal(await js(`TODO_CATEGORY_DEFAULTS.P7`),'Category 8');
  assert.equal(await js(`document.querySelector('.todo-category-name').value`),'尚未提交的分类名','language changes preserve unsubmitted user names');
  assert.equal(await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P2"] span').textContent`),'Date');
  assert.equal(await js(`document.querySelector('.todo-bulk-delete').textContent`),'Delete');
  await js(`removeTodoCategory('P6');void 0`);
  await until(`document.getElementById('content-delete-confirm').open`);
  assert.equal(await js(`document.getElementById('content-delete-message').textContent`),'This category and its 1 task will be deleted.');
  await js(`document.getElementById('content-delete-cancel').click()`);
  await capture('11-english-todo-controls');
  await js(`PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));void 0`);
  assert.equal(await js(`document.querySelector('.add-row input').placeholder`),'添加待办，回车保存…');
  assert.match(await js(`document.querySelector('.add-row input').getAttribute('aria-label')`),/^添加.+待办$/);
  assert.equal(await js(`document.getElementById('todo-add-category').title`),'添加分类');
  assert.equal(await js(`document.querySelector('.todo-deadline-trigger[data-deadline-priority="P2"] span').textContent`),'日期');
  assert.equal(await js(`document.querySelector('.todo-bulk-delete').textContent`),'删除');

  // Fill to 8 categories — FAB must disappear.
  await js(`(() => {
    todoCategoryOrder = ['P0','P1','P2','P3','P4','P5','P6','P7'];
    PRIORITIES.forEach((p) => { if (!Array.isArray(data[p])) data[p] = []; });
    persistTodoCategoryOrder();
    renderTodoBoard();
  })()`);
  await until(`document.querySelectorAll('#todo-sections .quadrant').length === 8`);
  assert.equal(await js(`document.getElementById('todo-add-category').hidden`), true);
  await capture('07-todo-fab-hidden-at-8');

  assert.deepEqual(errors, [], errors.join('\\n'));
  console.log('todo-board-fixes: categories, visible time selection, sync drafts/edits/focus, popup lifecycle and bilingual controls OK');
  console.log(`shots: ${shots}`);
  clearTimeout(watchdog);
  app.exit(0);
}

app.whenReady().then(() => main().catch((error) => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
}));
