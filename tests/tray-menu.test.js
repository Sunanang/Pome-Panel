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

test('about dialog names Pome Panel and Lando and opens the current GitHub repo', () => {
  const menu = trayMenuSource();
  assert.match(menu, /title: '关于 Pome Panel'/);
  assert.match(menu, /message: 'Pome Panel'/);
  assert.match(menu, /开发者 Lando/);
  assert.match(menu, /app\.getVersion\(\)/);
  assert.match(menu, /shell\.openExternal\('https:\/\/github\.com\/Sunanang\/Pome-Panel'\)/);
  assert.doesNotMatch(menu, /to-do-panel|todo-panel|Todo Panel/);
  assert.equal(pkg.version, '0.9.1');
  assert.equal(pkg.author, 'Lando');
  assert.equal(pkg.homepage, 'https://github.com/Sunanang/Pome-Panel');
  assert.equal(pkg.repository.url, 'https://github.com/Sunanang/Pome-Panel.git');
  assert.equal(pkg.build.productName, 'Pome Panel');
  assert.equal(pkg.build.appId, 'com.dynamicpanel.app');
});
