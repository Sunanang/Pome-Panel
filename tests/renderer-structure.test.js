const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

function cssRules(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim().replace(/\s+/g, ' '),
    body: match[2],
  }));
}

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
  assert.match(html, /id="notes-new"/);
});

test('homepage exposes an explicit layout editor with all four card sizes', () => {
  assert.match(html, /id="home-layout-edit"/);
  assert.match(html, /data-home-ctx-size="mini"/);
  assert.match(html, /data-home-ctx-size="small"/);
  assert.match(html, /data-home-ctx-size="medium"/);
  assert.match(html, /data-home-ctx-size="large"/);
  assert.match(appJs, /HOME_SIZE_LABELS\s*=\s*\{\s*mini:\s*'迷你',\s*small:\s*'小',\s*medium:\s*'中',\s*large:\s*'大'\s*\}/);
  assert.match(appJs, /\[data-widget-drag-handle\]/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /notch-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.NotchHome\s*=/);
  assert.match(appJs, /notch:home-modules-changed/);
  assert.match(appJs, /notch:home-layout-error/);
  assert.match(appJs, /stopMirror\(\)/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'music', 'pomodoro', 'cursor', 'recorder', 'windows', 'mirror', 'note', 'commands',
  ]);
  assert.match(workspaceJs, /isRecordingActive/);
  assert.match(workspaceJs, /recording_active/);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

// M0-3（D11）：弹层铺满面板并居中卡片，菜单栏高度的顶部留白没有意义。
test('the transcription settings overlay centres its card without a menu-bar inset', () => {
  const rules = cssRules(css).filter((rule) => rule.selector.includes('.transcription-settings-backdrop'));
  assert.ok(rules.length > 0);
  rules.forEach((rule) => {
    assert.doesNotMatch(rule.body, /padding-top/, `${rule.selector} 不得再带顶部留白`);
  });
});

// W0-1：0.22 的液态玻璃描边规则实际只在收起态生效，胶囊周围会出现半透明框。
test('the rainbow panel outline only lights up while the panel is expanded', () => {
  const offending = cssRules(css)
    .filter((rule) => /\.panel::after/.test(rule.selector) && !rule.selector.includes('#app.expanded'))
    .filter((rule) => [...rule.body.matchAll(/opacity:\s*([\d.]+)/g)].some((match) => Number(match[1]) > 0))
    .map((rule) => rule.selector);
  assert.deepEqual(offending, [], `非展开态不得给 .panel::after 非零 opacity：${offending.join('; ')}`);
  assert.match(css, /#app\.collapsed \.panel::before,\s*#app\.collapsed \.panel::after \{[^}]*opacity: 0;/);
});

// P1-3：--mb-h 的唯一使用者（转写弹层留白）已删除，度量与兜底值一并清掉。
test('the renderer no longer carries a menu-bar height variable', () => {
  assert.doesNotMatch(css, /--mb-h/);
  assert.doesNotMatch(appJs, /--mb-h/);
});

// P0-1：渲染层只读能力层，不再自己判断 process.platform 或比对平台名。
test('the renderer reads capabilities instead of branching on the platform name', () => {
  const notificationJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notification.js'), 'utf8');
  for (const [name, source] of Object.entries({ 'app.js': appJs, 'workspace.js': workspaceJs, 'notification.js': notificationJs })) {
    assert.doesNotMatch(source, /process\.platform/, `${name} 不得读 process.platform`);
    // 只允许把平台名当作兜底默认值，不允许用它分支。
    assert.doesNotMatch(source, /[=!]==\s*['"](?:win32|darwin)['"]/, `${name} 不得比对平台名`);
    assert.doesNotMatch(source, /['"](?:win32|darwin)['"]\s*[=!]==/, `${name} 不得比对平台名`);
  }
  assert.match(appJs, /notchAPI\?\.capabilities/);
  assert.match(appJs, /onCapabilitiesChanged/);
  assert.match(notificationJs, /capabilities\?\.features\?\.windowFocus === true/);
  assert.match(notificationJs, /dataset\.platform/);
});

// 护栏期已过，但回滚开关仍会下发 dragEnabled:false；
// 主进程返回 false 不够，渲染层必须自己拦住拖动手势，否则会误展开。
test('the collapsed capsule honours the drag guard sent with the layout metrics', () => {
  assert.match(appJs, /data-drag-enabled/);
  assert.match(appJs, /layoutMetrics\?\.dragEnabled === false/);
  assert.match(css, /\[data-drag-enabled="false"\] \.notch \{\s*cursor: pointer;/);
});

// P2-1：字体名收敛到 token，组件规则一律 var()，否则 Windows 会回退到 Arial。
test('font stacks live in tokens only, with a Windows fallback after the Apple faces', () => {
  const tokenBlock = css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(tokenBlock.includes('--font-display:'));
  assert.ok(tokenBlock.includes('--font-text:'));
  assert.ok(tokenBlock.includes('--digits-tracking:'));
  for (const name of ['SF Pro', 'Segoe UI Variable', 'Microsoft YaHei', 'Cascadia Mono', 'Consolas']) {
    assert.ok(tokenBlock.includes(name), `token 里必须声明 ${name}`);
  }
  const outsideTokens = css.replace(tokenBlock, '');
  assert.doesNotMatch(outsideTokens, /SF Pro/, 'token 之外不得再写死 SF Pro');
  // 栈首必须还是 -apple-system，否则 Mac 的解析结果会变。
  for (const match of tokenBlock.matchAll(/--font-(?:display|text):\s*([^;]+);/g)) {
    assert.match(match[1].trim(), /^-apple-system/);
  }
  const notificationCss = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'notification.css'), 'utf8');
  assert.match(notificationCss, /--font-family:\s*-apple-system[\s\S]*?'Segoe UI'[\s\S]*?'Microsoft YaHei'/);
});

// P2-2（D14）：Mac 一旦定义 ::-webkit-scrollbar 就会失去系统浮层滚动条，
// 所以新增的全局细轨规则只能挂在 win32 选择器下。
test('the global thin scrollbar rules only exist under the Windows platform selector', () => {
  const globalRules = cssRules(css).filter((rule) => /\*::-webkit-scrollbar/.test(rule.selector));
  assert.ok(globalRules.length > 0, '必须存在 Windows 的全局细滚动条规则');
  globalRules.forEach((rule) => {
    assert.match(rule.selector, /html\[data-platform="win32"\]/, `${rule.selector} 必须限定在 win32 下`);
  });
  // 设过标准属性的列表要在 Windows 上还原，否则 webkit 规则会被整体忽略。
  assert.match(css, /html\[data-platform="win32"\] :is\([\s\S]*?\.window-list[\s\S]*?\)\s*\{[^}]*scrollbar-width: auto;/);
  // Mac 侧原有的 scrollbar-width/color 声明保持不变。
  assert.match(css, /\.window-list,\s*\.command-list \{[\s\S]*?scrollbar-width: thin;/);
  assert.match(css, /\.note-format-actions \{[\s\S]*?scrollbar-width: none;/);
});

// P2-5：Windows 的小字号只允许通过 token 覆盖，且必须比 Mac 大半级（微软雅黑在
// 100%–125% 缩放下 9px / 10.5px 会糊掉）。
test('Windows raises the smallest font tokens without forking components', () => {
  const winTokens = css.match(/html\[data-platform="win32"\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(winTokens, /--fs-micro:\s*10px;/);
  assert.match(winTokens, /--fs-caption:\s*11px;/);
  const macTokens = css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(macTokens, /--fs-micro:\s*9px;/);
  // 覆盖只许出现在 token 块里：组件规则不得按平台分叉（§2.4）。
  assert.doesNotMatch(winTokens, /[a-z-]+\s*\{/);
});

test('hidden visual widgets stop presentation-only background work', () => {
  assert.match(effectsJs, /setEnabled/);
  assert.match(effectsJs, /notch:home-modules-changed/);
  assert.match(workspaceJs, /NotchHome\?\.isVisible/);
});
