'use strict';

/**
 * Acceptance: home almanac widget at four sizes for 2026-10-23.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const userData = process.env.TODO_TEST_USER_DATA
  || fs.mkdtempSync(path.join(os.tmpdir(), 'pome-almanac-'));
const shots = process.env.ALMANAC_SHOTS
  || path.join(__dirname, '..', 'dist.noindex', 'almanac-home');

app.setPath('userData', userData);
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => {
  console.error('almanac-home timed out');
  app.exit(1);
}, 90000);

async function main() {
  fs.mkdirSync(shots, { recursive: true });
  const win = new BrowserWindow({
    width: 1240,
    height: 638,
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
  win.webContents.on('console-message', (_e, _level, message) => {
    if (/error|failed|registry/i.test(message)) errors.push(message);
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const until = async (expr, tries = 80) => {
    for (let i = 0; i < tries; i += 1) {
      if (await js(expr)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout: ${expr}`);
  };

  await until(`typeof NotchAlmanac === 'object' && typeof PomeAlmanac === 'object'`);
  await js(`(() => {
    hiddenHomeModules = HOME_MODULE_REGISTRY.filter((id) => id !== 'almanac');
    homeSizes.almanac = 'medium';
    homeOrder = ['almanac', ...HOME_MODULE_REGISTRY.filter((id) => id !== 'almanac')];
    homeWorkingLayout = null;
    const layout = NotchDomain.resolveHomeWidgetLayout(homeOrder, homeSizes, hiddenHomeModules);
    applyHomeLayout(layout, { reason: 'initial' });
    setMode(true);
    PomeAlmanac.setPreviewDate(new Date(2026, 9, 23, 12, 0, 0));
  })()`);
  await until(`!!document.querySelector('#home-almanac .almanac-daynum')`);
  await until(`isExpanded && !modeBusy && document.getElementById('app').classList.contains('expanded')`);
  await js(`document.fonts.ready`);

  const probe = await js(`(() => {
    const day = NotchAlmanac.buildAlmanacDay(new Date(2026, 9, 23, 12, 0, 0));
    return {
      lunar: day.lunar.monthDay,
      jieQi: day.jieQi.today,
      next: day.jieQi.nextName,
      jianChu: day.jianChu,
      zhiShen: day.zhiShen,
      text: document.querySelector('#home-almanac').innerText,
    };
  })()`);
  assert.equal(probe.lunar, '九月十四');
  assert.equal(probe.jieQi, '霜降');
  assert.equal(probe.next, '立冬');
  assert.equal(probe.jianChu, '成');
  assert.equal(probe.zhiShen, '天刑');
  assert.match(probe.text, /建除/);
  assert.match(probe.text, /天刑|成/);

  for (const size of ['mini', 'small', 'medium', 'large']) {
    await js(`(() => {
      homeSizes.almanac = ${JSON.stringify(size)};
      homeWorkingLayout = null;
      const layout = NotchDomain.resolveHomeWidgetLayout(homeOrder, homeSizes, hiddenHomeModules);
      applyHomeLayout(layout, { reason: 'resize' });
      PomeAlmanac.setPreviewDate(new Date(2026, 9, 23, 12, 0, 0));
    })()`);
    await until(`document.querySelector('#home-almanac')?.dataset.widgetSize === ${JSON.stringify(size)}
      && document.querySelector('#home-almanac .almanac-${size}')`);
    const aspectPreserved = await js(`(() => {
      const tile = document.getElementById('home-almanac');
      return tile.getAnimations().every(animation => animation.effect.getKeyframes().every(frame => {
        if (!frame.transform || frame.transform === 'none') return true;
        const matrix = new DOMMatrixReadOnly(frame.transform);
        return Math.abs(matrix.a - 1) < .001 && Math.abs(matrix.d - 1) < .001;
      }));
    })()`);
    assert.equal(aspectPreserved, true, `${size}: layout animation must not stretch glyphs`);
    await js(`Promise.allSettled(homeLayoutMotionAnimations.map(animation => animation.finished))`);
    await until(`!document.getElementById('home-bento').classList.contains('layout-motion-active')`);
    await js(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const overflow = await js(`(() => {
      const tile = document.querySelector('#home-almanac');
      return {
        size: tile.dataset.widgetSize,
        cls: tile.firstElementChild?.className || '',
        overflowX: tile.scrollWidth > tile.clientWidth + 1,
        overflowY: tile.scrollHeight > tile.clientHeight + 1,
        day: tile.querySelector('.almanac-daynum')?.textContent,
        height: Math.round(tile.getBoundingClientRect().height),
        scaleX: tile.getBoundingClientRect().width / tile.offsetWidth,
        scaleY: tile.getBoundingClientRect().height / tile.offsetHeight,
      };
    })()`);
    assert.equal(overflow.size, size);
    assert.equal(overflow.cls, `almanac-${size}`);
    assert.equal(overflow.day, '23');
    assert.equal(overflow.overflowX, false, `${size} overflowX`);
    assert.equal(overflow.overflowY, false, `${size} overflowY`);
    assert.ok(Math.abs(overflow.scaleX - 1) < .01 && Math.abs(overflow.scaleY - 1) < .01, `${size}: screenshot must capture the settled layout`);
    // capturePage rect uses DIP, matching getBoundingClientRect().
    const dip = await js(`(() => {
      const r = document.querySelector('#home-almanac').getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.x)),
        y: Math.max(0, Math.floor(r.y)),
        width: Math.max(1, Math.ceil(r.width)),
        height: Math.max(1, Math.ceil(r.height)),
      };
    })()`);
    const image = await win.capturePage(dip);
    fs.writeFileSync(path.join(shots, `${size}.png`), image.toPNG());
  }

  assert.equal(errors.filter((line) => /registry/i.test(line)).length, 0, errors.join('\n'));
  console.log('almanac-home: four sizes OK');
  console.log('shots:', shots);
  clearTimeout(watchdog);
  app.exit(0);
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
});
