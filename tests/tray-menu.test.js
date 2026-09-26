'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const pkg = require('../package.json');

function trayMenuSource() {
  const start = mainJs.indexOf('function refreshTrayMenu()');
  const end = mainJs.indexOf('function createTray()');
  assert.ok(start >= 0 && end > start);
  return mainJs.slice(start, end);
}

test('tray menu keeps only the five product items', () => {
  const menu = trayMenuSource();
  for (const label of ['显示功能', '设置快捷键', '开机自动启动', '关于', '退出']) {
    assert.match(menu, new RegExp(`label: '${label}'`));
  }
  assert.doesNotMatch(menu, /API 配置|替换镜子配图|数据文件夹|重置面板位置|显示功能',\s*\n\s*submenu/);
  assert.match(menu, /showMainPanelFromTray/);
  assert.match(menu, /app:record-shortcut/);
  assert.equal((menu.match(/type: 'separator'/g) || []).length, 1);
});

// P2-4：把 1024 的 png 缩到 16×16 在 125%/150% 下发糊，改为交给系统从 .ico 挑帧。
test('the Windows tray and installer use a committed multi-size icon', () => {
  const icoPath = path.join(__dirname, '..', 'build', 'pome-panel-icon.ico');
  assert.ok(fs.existsSync(icoPath), 'build/pome-panel-icon.ico 必须随仓库提交，CI 不跑生成脚本');
  const ico = fs.readFileSync(icoPath);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, 'type 必须是 1（图标）');
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const at = 6 + index * 16;
    sizes.push(ico[at] === 0 ? 256 : ico[at]);
    assert.equal(ico.readUInt16LE(at + 6), 32, '每一帧都要是 32 位带 alpha');
    const offset = ico.readUInt32LE(at + 12);
    const length = ico.readUInt32LE(at + 8);
    assert.ok(offset + length <= ico.length, '条目偏移越界');
  }
  assert.deepEqual(sizes, [16, 20, 24, 32, 40, 48, 64, 256]);

  assert.equal(pkg.build.win.icon, 'build/pome-panel-icon.ico');
  assert.ok(pkg.build.files.includes('build/pome-panel-icon.ico'), '白名单漏掉 ico，打包后托盘会退回 png');
  assert.match(mainJs, /pome-panel-icon\.ico/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'make-ico.js')), '改了源 png 要能重新生成');
});

test('about dialog names Pome Panel and Lando and opens the current GitHub repo', () => {
  const menu = trayMenuSource();
  assert.match(menu, /title: '关于 Pome Panel'/);
  assert.match(menu, /message: 'Pome Panel'/);
  assert.match(menu, /开发者 Lando/);
  assert.match(menu, /app\.getVersion\(\)/);
  assert.match(menu, /shell\.openExternal\('https:\/\/github\.com\/Sunanang\/Pome-Panel'\)/);
  assert.doesNotMatch(menu, /to-do-panel|todo-panel|Todo Panel/);
  assert.equal(pkg.version, '0.11.0');
  assert.equal(pkg.author, 'Lando');
  assert.equal(pkg.homepage, 'https://github.com/Sunanang/Pome-Panel');
  assert.equal(pkg.repository.url, 'https://github.com/Sunanang/Pome-Panel.git');
  assert.equal(pkg.build.productName, 'Pome Panel');
  assert.equal(pkg.build.appId, 'com.dynamicpanel.app');
});
