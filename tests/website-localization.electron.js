'use strict';

// Start the website first (npm run dev --prefix website -- --port 4173).
// Run with Electron; POME_WEBSITE_TEST_URL can target a static export instead.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const languages = require('../localization/languages.json');
const messages = require('../website/app/translations.json');
const output = process.env.POME_LOCALIZATION_SCREENSHOTS || path.join(__dirname, '../dist.noindex/localization');
const base = (process.env.POME_WEBSITE_TEST_URL || 'http://localhost:4173').replace(/\/$/, '');
app.commandLine.appendSwitch('user-data-dir', process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'pome-site-')));
app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Website localization timed out'); app.exit(1); }, 150000);

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const win = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message); });
  const js = code => win.webContents.executeJavaScript(code);
  try {
    for (const { id, route } of languages) {
      await win.loadURL(base + route);
      for (let i = 0; i < 200; i++) {
        if (await js('!!document.querySelector(".site-language summary")')) break;
        await sleep(50);
      }
      assert.equal(await js('document.documentElement.lang'), id);
      assert.equal(await js('document.querySelectorAll(".site-language a").length'), 10);
      assert((await js('document.body.textContent')).includes(messages[id]['copy.downloadForWindows.4eb3ae']));
      await sleep(3000);
      assert.deepEqual(errors, [], 'No hydration or browser runtime errors');
      assert.equal(await js('document.querySelector("[data-hero-boot]").dataset.heroBoot'), 'ready', 'Reduced motion still reveals the product');
      for (const [label, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
        win.setContentSize(width, height); await sleep(200);
        await js('document.querySelector(".site-language").open=true'); await sleep(100);
        const rect = await js(`(() => {
          const menu = document.querySelector('.site-language nav').getBoundingClientRect();
          const chooser = document.querySelector('.site-language summary').getBoundingClientRect();
          const brand = document.querySelector('.brand-lockup').getBoundingClientRect();
          const links = document.querySelector('.hero-nav-links').getBoundingClientRect();
          return { left: menu.left, right: menu.right, width: innerWidth, scroll: document.documentElement.scrollWidth,
            overlaps: brand.right > chooser.left || (links.width > 0 && links.right > chooser.left) };
        })()`);
        assert(rect.left >= 0 && rect.right <= rect.width, `${id}: menu inside viewport`);
        assert(rect.scroll <= rect.width, `${id}: page inside viewport`);
        assert.equal(rect.overlaps, false, `${id}: language menu must not cover navigation`);
        fs.writeFileSync(path.join(output, `${id}-website-${label}.png`), (await win.webContents.capturePage()).toPNG());
      }
      win.setContentSize(1280, 900);
      console.log('Website language passed:', id);
    }
    const navigated = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await js('document.querySelector(".site-language a[lang=ja-JP]").click()');
    await navigated;
    assert.equal(await js('document.documentElement.lang'), 'ja-JP');
    assert.deepEqual(errors, []);
    clearTimeout(watchdog);
    console.log('Ten website routes, hydration, desktop/mobile menus and navigation passed');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
