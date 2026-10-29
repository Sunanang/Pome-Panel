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
  win.webContents.on('console-message', detail => {
    if (detail.level === 'error') errors.push(detail.message);
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
    assert.equal(await js(`document.querySelector('#home-almanac').matches('[title]') || !!document.querySelector('#home-almanac [title]')`), false, `${size}: almanac must not show hover tooltips`);
    assert.ok(Math.abs(overflow.scaleX - 1) < .01 && Math.abs(overflow.scaleY - 1) < .01, `${size}: screenshot must capture the settled layout`);
    if (size !== 'mini') {
      const timing = await js(`(() => {
        const el = document.querySelector('#home-almanac .almanac-jq-time');
        const r = el.getBoundingClientRect(), tile = document.getElementById('home-almanac').getBoundingClientRect();
        return { text: el.textContent, dateTime: el.dateTime, visible: r.left >= tile.left && r.right <= tile.right && r.bottom <= tile.bottom };
      })()`);
      assert.match(timing.text, /约17:38北京时间/);
      assert.equal(timing.dateTime, '2026-10-23T17:38:00+08:00');
      assert.equal(timing.visible, true, `${size}: term time visible`);
    }
    if (size === 'mini') {
      const miniFoot = await js(`(() => {
        const foot = document.querySelector('#home-almanac .almanac-mini-foot');
        const style = getComputedStyle(foot);
        return {
          direction: style.flexDirection,
          yi: !!foot?.querySelector('.yi'),
          ji: !!foot?.querySelector('.ji'),
          sep: !!foot?.querySelector('.sep'),
        };
      })()`);
      assert.equal(miniFoot.direction, 'column', 'mini 宜/忌 must stack on two lines');
      assert.equal(miniFoot.yi && miniFoot.ji && !miniFoot.sep, true);
    }
    if (size === 'medium' || size === 'large') {
      const align = await js(`(() => {
        const day = document.querySelector('#home-almanac .almanac-daynum');
        const chip = document.querySelector('#home-almanac .almanac-chip-jieqi');
        if (!day || !chip) return { ok: false, reason: 'missing' };
        const dayTop = day.getBoundingClientRect().top;
        const chipTop = chip.getBoundingClientRect().top;
        const delta = chipTop - dayTop;
        // Chip is nudged below the day box top to match numeral ink.
        return { ok: delta >= 6 && delta <= 14, dayTop, chipTop, delta };
      })()`);
      assert.equal(align.ok, true, `${size}: 霜降 top must sit with date ink (delta=${align.delta})`);
    }
    const bg = await js(`(() => {
      const tile = document.getElementById('home-almanac');
      const glass = document.documentElement.dataset.liquidGlass === '1';
      // Liquid-glass clears .tile background-image; the photo lives on ::before.
      const image = getComputedStyle(tile, glass ? '::before' : undefined).backgroundImage;
      const expect = ${JSON.stringify(size === 'mini' ? 'almanac-bg-mini.webp' : size === 'large' ? 'almanac-bg-tall.webp' : 'almanac-bg.webp')};
      const beforeOpacity = parseFloat(getComputedStyle(tile, '::before').opacity || '0');
      return { image, expect, glass, beforeOpacity, ok: image.includes(expect) && image.includes('linear-gradient') && (!glass || beforeOpacity > 0.5) };
    })()`);
    assert.equal(bg.ok, true, `${size} background must use ${bg.expect}: ${bg.image}`);
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

  for (const [name, year, month, date, expected] of [
    ['early-and-late-zi', 2026, 1, 4, ['早子00:00–00:59', '晚子23:00–23:59']],
    ['late-zi-only', 2026, 10, 24, ['晚子23:00–23:59']],
    ['next-year-term', 2026, 12, 31, ['小寒', '1/5 约', '北京时间']],
  ]) {
    await js(`PomeAlmanac.setPreviewDate(new Date(${year}, ${month - 1}, ${date}, 12))`);
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const probe = await js(`(() => {
      const tile = document.getElementById('home-almanac'), r = tile.getBoundingClientRect();
      return { text: tile.textContent, title: tile.title, early: [...tile.querySelectorAll('.almanac-hour em')].filter(el => el.textContent === '早子').length,
        fits: [...tile.querySelectorAll('.almanac-hour, .almanac-jq-time')].every(el => { const e=el.getBoundingClientRect(); return e.left >= r.left && e.right <= r.right && e.bottom <= r.bottom; }),
        rect: {x:Math.floor(r.x), y:Math.floor(r.y), width:Math.ceil(r.width), height:Math.ceil(r.height)} };
    })()`);
    for (const text of expected) assert(probe.text.includes(text), `${name}: ${text}`);
    if (name === 'late-zi-only') assert.equal(probe.early, 0);
    assert.equal(probe.fits, true, `${name}: time intervals visible`);
    assert.equal(probe.title, '', `${name}: almanac must not show a hover tooltip`);
    fs.writeFileSync(path.join(shots, `${name}.png`), (await win.capturePage(probe.rect)).toPNG());
  }
  await js(`PomeI18n.setState(PomeI18n.snapshot('en-US',['en-US']));window.dispatchEvent(new Event('pome:language-changed'));PomeAlmanac.render()`);
  assert.doesNotMatch(await js('document.querySelector("#home-almanac .almanac-weekday").textContent'),/[\u4e00-\u9fff]/,'Gregorian weekday follows interface language');
  assert.equal(await js('document.querySelector("#home-almanac").getAttribute("aria-label")'),'Chinese almanac');
  await js('document.querySelector("#ui-capsule-hint button")?.click();document.querySelector("#home-almanac .almanac-explanation").open=true;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  assert.match(await js('document.querySelector("#home-almanac .almanac-explanation").textContent'),/UTC\+8/);
  await js('new Promise(r=>setTimeout(r,180))');const box=await js(`(()=>{const r=document.querySelector('#home-almanac').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);const full=await win.capturePage(box);fs.writeFileSync(path.join(shots,'explanation-en.png'),full.toPNG());
  assert.deepEqual(errors, []);
  console.log('almanac-home: four sizes, minute precision, timezone, early/late Zi and year boundary OK');
  console.log('shots:', shots);
  clearTimeout(watchdog);
  app.exit(0);
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
});
