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
  async function capture(label) {
    await frames();
    fs.writeFileSync(path.join(shots, `${label}.png`), (await win.webContents.capturePage()).toPNG());
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
  await until(`document.querySelectorAll('#todo-sections .quadrant').length >= 4`);
  assert.equal(await js(`document.querySelectorAll('#todo-sections .quadrant').length`), 4);
  await capture('02-todo-default-4');

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

  // Rebuild board while popover is open — popover node must survive.
  await js(`renderTodoBoard()`);
  assert.equal(await js(`!!document.getElementById('todo-date-popover')`), true, 'popover survives board rebuild');

  await js(`document.getElementById('todo-date-popover').hidden = true`);
  // Headless Electron has no native confirm UI — stub before remove.
  await js(`(() => {
    window.confirm = () => true;
    removeTodoCategory('P4');
  })()`);
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

  assert.deepEqual(errors, [], errors.join('\\n'));
  console.log('todo-board-fixes: sun seed, recorder head entry, time pickers, categories OK');
  console.log(`shots: ${shots}`);
  clearTimeout(watchdog);
  app.exit(0);
}

app.whenReady().then(() => main().catch((error) => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
}));
