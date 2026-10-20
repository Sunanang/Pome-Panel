'use strict';
// Render the documentation mockup in an isolated Electron process, without main.js.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const revisionTwo = process.argv.includes('--revision=2');
const suffix = revisionTwo ? '-v2' : '';
const expectedHeight = revisionTwo ? 176 : 110;
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'pome-attention-design-')));
app.commandLine.appendSwitch('force-device-scale-factor', '2');
const deadline = setTimeout(() => { console.error('Design rendering timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1536, height: 1000, show: false, frame: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, revisionTwo ? 'attention-v2.html' : 'preview.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');
  const height = await win.webContents.executeJavaScript('Math.ceil(document.querySelector(".board").getBoundingClientRect().height)');
  win.setContentSize(1536, height);
  await new Promise(resolve => setTimeout(resolve, 400));
  const overview = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, `overview${suffix}.png`), overview.toPNG());
  for (const [id, name] of [['input-state', 'input'], ['select-state', 'select'], ['approve-state', 'approve']]) {
    const rect = await win.webContents.executeJavaScript(`(() => {
      const r = document.querySelector('#${id} .notification-root').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: 400, height: Math.round(r.height) };
    })()`);
    const snapshot = await win.webContents.capturePage(rect);
    fs.writeFileSync(path.join(__dirname, `${name}${suffix}.png`), snapshot.toPNG());
  }
  const checks = await win.webContents.executeJavaScript(`(() => {
    const roots = [...document.querySelectorAll('.notification-root')];
    const titles = [...document.querySelectorAll('.notification-title')].map(e => e.textContent);
    const bars = document.querySelectorAll('.notification-progress').length;
    document.querySelector('.notification-open').click();
    const opensSafely = document.querySelector('#demo').textContent.includes('不会打开其他软件');
    document.querySelector('.notification-close').click();
    const hidesOnly = roots[0].style.visibility === 'hidden' && document.querySelector('#demo').textContent.includes('仍保留');
    document.querySelector('.reset').click();
    return { titles, bars, opensSafely, hidesOnly, restored: !roots[0].style.visibility,
      rootSizes: roots.map(e => ({width:e.clientWidth,height:e.clientHeight})) };
  })()`);
  if (checks.bars !== 0 || !checks.opensSafely || !checks.hidesOnly || !checks.restored ||
      checks.rootSizes.some(r => r.width !== 400 || r.height !== expectedHeight)) throw new Error(JSON.stringify(checks));
  console.log(JSON.stringify({ overview: path.join(__dirname, `overview${suffix}.png`), logicalSize: [1536, height], checks }));
  clearTimeout(deadline);
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
