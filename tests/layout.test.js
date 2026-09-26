const test = require('node:test');
const assert = require('node:assert/strict');
const { layout } = require('../platform');
const { appSettingsLayoutPreferences, windowsLayoutMigration } = require('../main-services');

// 布局基准（M0-1 护栏 / M0-2 基准）。
// 显示器矩阵覆盖刘海内屏、无刘海外接屏、菜单栏自动隐藏、负坐标副屏与 Dock 在三个侧边。
// 菜单栏高度随机型与系统版本变化，这里取常见实测值。
const DISPLAYS = {
  notch: { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } },
  external: { id: 2, bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 25, width: 2560, height: 1415 } },
  autoHiddenMenuBar: { id: 3, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 0, width: 1512, height: 982 } },
  secondaryLeftAbove: { id: 4, bounds: { x: -1920, y: -1080, width: 1920, height: 1080 }, workArea: { x: -1920, y: -1055, width: 1920, height: 1055 } },
  dockLeft: { id: 5, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 70, y: 37, width: 1442, height: 945 } },
  dockRight: { id: 6, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1442, height: 945 } },
  dockBottom: { id: 7, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 875 } },
};

function macContext(display, position) {
  return { platform: 'darwin', display, position: position || null, tab: 'home' };
}

test('Mac default collapsed capsule sits right below the menu bar on every display', () => {
  const collapsed = Object.fromEntries(
    Object.entries(DISPLAYS).map(([name, display]) => [name, layout.collapsedBounds(macContext(display))])
  );
  assert.deepEqual(collapsed, {
    notch: { x: 714, y: 37, width: 85, height: 9 },
    external: { x: 2750, y: 25, width: 85, height: 9 },
    // 菜单栏自动隐藏时 workArea.y 就是物理顶端。
    autoHiddenMenuBar: { x: 714, y: 0, width: 85, height: 9 },
    secondaryLeftAbove: { x: -1002, y: -1055, width: 85, height: 9 },
    // Dock 在侧边只改 workArea 的 x/width，胶囊水平位置仍按物理边界居中。
    dockLeft: { x: 714, y: 37, width: 85, height: 9 },
    dockRight: { x: 714, y: 37, width: 85, height: 9 },
    dockBottom: { x: 714, y: 37, width: 85, height: 9 },
  });
});

test('Mac default expanded panel keeps its x and uses the full 638 design height', () => {
  const expanded = Object.fromEntries(
    Object.entries(DISPLAYS).map(([name, display]) => [name, layout.expandedBounds(macContext(display))])
  );
  assert.deepEqual(expanded, {
    notch: { x: 136, y: 37, width: 1240, height: 638 },
    external: { x: 2172, y: 25, width: 1240, height: 638 },
    autoHiddenMenuBar: { x: 136, y: 0, width: 1240, height: 638 },
    secondaryLeftAbove: { x: -1580, y: -1055, width: 1240, height: 638 },
    dockLeft: { x: 136, y: 37, width: 1240, height: 638 },
    dockRight: { x: 136, y: 37, width: 1240, height: 638 },
    dockBottom: { x: 136, y: 37, width: 1240, height: 638 },
  });
});

test('the default position and dragging to the top centre resolve to the same geometry', () => {
  for (const display of Object.values(DISPLAYS)) {
    const context = macContext(display);
    const seed = { ...layout.defaultPosition(context), ...layout.collapsedSize('top') };
    const dragged = layout.snapCollapsed(context, seed, 'top');
    const draggedContext = macContext(display, {
      x: dragged.x,
      y: dragged.y,
      edge: dragged.edge,
      displayId: display.id,
    });
    assert.deepEqual(
      layout.collapsedBounds(draggedContext),
      layout.collapsedBounds(context),
      `${display.id} 的默认收起位置应与拖到顶部居中后完全一致`
    );
    const draggedExpanded = layout.expandedBounds(draggedContext);
    const defaultExpanded = layout.expandedBounds(context);
    assert.deepEqual(
      { y: draggedExpanded.y, width: draggedExpanded.width, height: draggedExpanded.height },
      { y: defaultExpanded.y, width: defaultExpanded.width, height: defaultExpanded.height }
    );
    // 自定义路径的 x 经过两次取整，偶数屏宽下会比区域居中偏 1px；默认路径故意绕开锚定逻辑。
    assert.ok(
      Math.abs(draggedExpanded.x - defaultExpanded.x) <= 1,
      `${display.id} 的展开 x 偏差 ${draggedExpanded.x - defaultExpanded.x}px`
    );
  }
});

test('custom docks resolve alignment, collapsed capsule and expanded panel per edge', () => {
  const positions = {
    'top/start': { edge: 'top', x: 8, y: 37, displayId: 1 },
    'top/center': { edge: 'top', x: 714, y: 37, displayId: 1 },
    'top/end': { edge: 'top', x: 1419, y: 37, displayId: 1 },
    'bottom/start': { edge: 'bottom', x: 8, y: 973, displayId: 1 },
    'bottom/center': { edge: 'bottom', x: 714, y: 973, displayId: 1 },
    'bottom/end': { edge: 'bottom', x: 1419, y: 973, displayId: 1 },
    'left/start': { edge: 'left', x: 0, y: 60, displayId: 1 },
    'left/center': { edge: 'left', x: 0, y: 440, displayId: 1 },
    'left/end': { edge: 'left', x: 0, y: 860, displayId: 1 },
    'right/start': { edge: 'right', x: 1503, y: 60, displayId: 1 },
    'right/center': { edge: 'right', x: 1503, y: 440, displayId: 1 },
    'right/end': { edge: 'right', x: 1503, y: 860, displayId: 1 },
  };
  const resolved = Object.fromEntries(Object.entries(positions).map(([name, position]) => {
    const context = macContext(DISPLAYS.notch, position);
    return [name, {
      align: layout.resolveEdgeAlign(context, position, position.edge),
      collapsed: layout.collapsedBounds(context),
      expanded: layout.expandedBounds(context),
    }];
  }));
  assert.deepEqual(resolved, {
    'top/start': { align: 'start', collapsed: { x: 8, y: 37, width: 85, height: 9 }, expanded: { x: 8, y: 37, width: 1240, height: 638 } },
    'top/center': { align: 'center', collapsed: { x: 714, y: 37, width: 85, height: 9 }, expanded: { x: 137, y: 37, width: 1240, height: 638 } },
    'top/end': { align: 'end', collapsed: { x: 1419, y: 37, width: 85, height: 9 }, expanded: { x: 264, y: 37, width: 1240, height: 638 } },
    'bottom/start': { align: 'start', collapsed: { x: 8, y: 973, width: 85, height: 9 }, expanded: { x: 8, y: 344, width: 1240, height: 638 } },
    'bottom/center': { align: 'center', collapsed: { x: 714, y: 973, width: 85, height: 9 }, expanded: { x: 137, y: 344, width: 1240, height: 638 } },
    'bottom/end': { align: 'end', collapsed: { x: 1419, y: 973, width: 85, height: 9 }, expanded: { x: 264, y: 344, width: 1240, height: 638 } },
    'left/start': { align: 'start', collapsed: { x: 0, y: 60, width: 9, height: 85 }, expanded: { x: 0, y: 60, width: 1240, height: 638 } },
    'left/center': { align: 'center', collapsed: { x: 0, y: 440, width: 9, height: 85 }, expanded: { x: 0, y: 164, width: 1240, height: 638 } },
    'left/end': { align: 'end', collapsed: { x: 0, y: 860, width: 9, height: 85 }, expanded: { x: 0, y: 307, width: 1240, height: 638 } },
    'right/start': { align: 'start', collapsed: { x: 1503, y: 60, width: 9, height: 85 }, expanded: { x: 272, y: 60, width: 1240, height: 638 } },
    'right/center': { align: 'center', collapsed: { x: 1503, y: 440, width: 9, height: 85 }, expanded: { x: 272, y: 164, width: 1240, height: 638 } },
    'right/end': { align: 'end', collapsed: { x: 1503, y: 860, width: 9, height: 85 }, expanded: { x: 272, y: 307, width: 1240, height: 638 } },
  });
});

test('dragging infers the dock edge from the pointer, not from the capsule centre', () => {
  const context = macContext(DISPLAYS.notch);
  const edgeAt = (x, y) => layout.inferDockEdgeFromPoint(context, { x, y });
  assert.equal(edgeAt(756, 4), 'top');
  assert.equal(edgeAt(756, 978), 'bottom');
  assert.equal(edgeAt(3, 491), 'left');
  assert.equal(edgeAt(1509, 491), 'right');
  // 竖条贴左时拖到顶部：指针距顶更近，必须判成 top。
  assert.equal(edgeAt(300, 120), 'top');
  assert.equal(edgeAt(120, 300), 'left');
});

test('a saved position without an edge is inferred, and broken input is discarded', () => {
  const context = macContext(DISPLAYS.notch);
  assert.deepEqual(
    layout.normalizePosition(context, { x: 0, y: 440, displayId: 1 }),
    { x: 0, y: 440, displayId: 1, edge: 'left' }
  );
  assert.deepEqual(
    layout.normalizePosition(context, { x: 714, y: 6 }),
    { x: 714, y: 6, displayId: null, edge: 'top' }
  );
  // 取不到屏幕信息时回退 top，而不是抛错。
  assert.deepEqual(
    layout.normalizePosition(null, { x: 714, y: 6, edge: 'nonsense' }),
    { x: 714, y: 6, displayId: null, edge: 'top' }
  );
  assert.equal(layout.normalizePosition(context, null), null);
  assert.equal(layout.normalizePosition(context, { x: 'left', y: 12 }), null);
});

test('a saved display id wins over the preferred display, and unplugging falls back', () => {
  const displays = [DISPLAYS.notch, DISPLAYS.external];
  assert.equal(
    layout.resolvePositionDisplay(displays, { x: 0, y: 0, edge: 'top', displayId: 2 }, DISPLAYS.notch),
    DISPLAYS.external
  );
  assert.equal(
    layout.resolvePositionDisplay(displays, { x: 0, y: 0, edge: 'top', displayId: 99 }, DISPLAYS.notch),
    DISPLAYS.notch
  );
  assert.equal(layout.resolvePositionDisplay(displays, null, DISPLAYS.notch), DISPLAYS.notch);
  assert.equal(layout.resolvePositionDisplay(displays, null, null), null);
});

test('short desktops clamp the expanded panel to the work area bottom margin', () => {
  const display = { id: 8, bounds: { x: 0, y: 0, width: 1440, height: 640 }, workArea: { x: 0, y: 25, width: 1440, height: 615 } };
  const bounds = layout.expandedBounds(macContext(display));
  assert.deepEqual(bounds, { x: 100, y: 25, width: 1240, height: 591 });
  assert.equal(bounds.y + bounds.height, display.workArea.y + display.workArea.height - 24);
});

test('narrow desktops keep the expanded panel inside the horizontal safety margin', () => {
  const display = { id: 9, bounds: { x: 0, y: 0, width: 1100, height: 900 }, workArea: { x: 0, y: 25, width: 1100, height: 875 } };
  assert.deepEqual(layout.expandedBounds(macContext(display)), { x: 12, y: 25, width: 1076, height: 638 });
});

test('Mac metrics describe the saved dock, the menu bar inset and a draggable capsule', () => {
  const mac = layout.layoutMetrics(macContext(DISPLAYS.notch, { edge: 'left', x: 0, y: 300, displayId: 1 }));
  assert.equal(mac.dockEdge, 'left');
  assert.equal(mac.collapsedWidth, 9);
  assert.equal(mac.collapsedHeight, 85);
  assert.equal(mac.dragEnabled, true);
  assert.equal(mac.stripHeight, 37);
  assert.equal(mac.menuBarHeight, 37);
  assert.equal(mac.chromeY, 98);
});

// ============ P1：Windows 接入统一布局 ============
// 任务栏四个位置、负坐标副屏与 125%/150% 的 DIP 尺寸。workArea 已排除任务栏，
// 所以几何与 Mac 唯一的差别是参考区域（workArea）与顶部 inset（0）。
const WINDOWS_DISPLAYS = {
  taskbarBottom: { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
  taskbarTop: { id: 12, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 48, width: 1920, height: 1032 } },
  taskbarLeft: { id: 13, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 62, y: 0, width: 1858, height: 1080 } },
  taskbarRight: { id: 14, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1858, height: 1080 } },
  secondaryLeftAbove: { id: 15, bounds: { x: -1920, y: -1080, width: 1920, height: 1080 }, workArea: { x: -1920, y: -1080, width: 1920, height: 1040 } },
  // 1920×1080@150% → 1280×720 DIP，任务栏 32 DIP。
  scaled150: { id: 16, bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 688 } },
  // 1366×768@125% → 1093×614 DIP，任务栏 38 DIP。
  smallScaled125: { id: 17, bounds: { x: 0, y: 0, width: 1093, height: 614 }, workArea: { x: 0, y: 0, width: 1093, height: 576 } },
};

function winContext(display, position) {
  return { platform: 'win32', display, position: position || null, tab: 'home' };
}

test('Windows collapses to the capsule at the top of the work area, clear of the taskbar', () => {
  const collapsed = Object.fromEntries(
    Object.entries(WINDOWS_DISPLAYS).map(([name, display]) => [name, layout.collapsedBounds(winContext(display))])
  );
  assert.deepEqual(collapsed, {
    taskbarBottom: { x: 918, y: 0, width: 85, height: 9 },
    // 任务栏在顶部时胶囊落在它下面，不再压住任务栏。
    taskbarTop: { x: 918, y: 48, width: 85, height: 9 },
    taskbarLeft: { x: 949, y: 0, width: 85, height: 9 },
    taskbarRight: { x: 887, y: 0, width: 85, height: 9 },
    secondaryLeftAbove: { x: -1002, y: -1080, width: 85, height: 9 },
    scaled150: { x: 598, y: 0, width: 85, height: 9 },
    smallScaled125: { x: 504, y: 0, width: 85, height: 9 },
  });
});

test('Windows expands to the shared 1240 × 638 design size, clamped to the work area', () => {
  const expanded = Object.fromEntries(
    Object.entries(WINDOWS_DISPLAYS).map(([name, display]) => [name, layout.expandedBounds(winContext(display))])
  );
  assert.deepEqual(expanded, {
    taskbarBottom: { x: 340, y: 0, width: 1240, height: 638 },
    taskbarTop: { x: 340, y: 48, width: 1240, height: 638 },
    taskbarLeft: { x: 371, y: 0, width: 1240, height: 638 },
    taskbarRight: { x: 309, y: 0, width: 1240, height: 638 },
    secondaryLeftAbove: { x: -1580, y: -1080, width: 1240, height: 638 },
    scaled150: { x: 20, y: 0, width: 1240, height: 638 },
    // 矮屏按 workArea 夹紧：高度 = 576 − 24，宽度 = 1093 − 24。
    smallScaled125: { x: 12, y: 0, width: 1069, height: 552 },
  });
  for (const [name, display] of Object.entries(WINDOWS_DISPLAYS)) {
    const bounds = expanded[name];
    const area = display.workArea;
    assert.ok(bounds.y + bounds.height <= area.y + area.height - 24, `${name} 展开压到了任务栏`);
    assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width, `${name} 展开越过了工作区左右边`);
  }
});

test('Windows honours a saved dock on every edge, exactly like Mac', () => {
  const display = WINDOWS_DISPLAYS.taskbarBottom;
  const resolved = Object.fromEntries(Object.entries({
    top: { edge: 'top', x: 8, y: 0, displayId: 11 },
    bottom: { edge: 'bottom', x: 918, y: 1023, displayId: 11 },
    left: { edge: 'left', x: 0, y: 480, displayId: 11 },
    right: { edge: 'right', x: 1911, y: 480, displayId: 11 },
  }).map(([name, position]) => {
    const context = winContext(display, position);
    return [name, {
      align: layout.resolveEdgeAlign(context, position, position.edge),
      collapsed: layout.collapsedBounds(context),
      expanded: layout.expandedBounds(context),
      metrics: layout.layoutMetrics(context),
    }];
  }));
  assert.deepEqual(resolved.top.collapsed, { x: 8, y: 0, width: 85, height: 9 });
  assert.equal(resolved.top.align, 'start');
  assert.deepEqual(resolved.bottom.collapsed, { x: 918, y: 1023, width: 85, height: 9 });
  assert.deepEqual(resolved.left.collapsed, { x: 0, y: 480, width: 9, height: 85 });
  assert.deepEqual(resolved.right.collapsed, { x: 1911, y: 480, width: 9, height: 85 });
  assert.equal(resolved.left.metrics.dockEdge, 'left');
  assert.equal(resolved.left.metrics.collapsedWidth, 9);
  assert.equal(resolved.left.metrics.collapsedHeight, 85);
  assert.equal(resolved.right.metrics.dockEdge, 'right');
  for (const entry of Object.values(resolved)) {
    assert.equal(entry.metrics.dragEnabled, true);
    // P1-3：Windows 没有菜单栏，度量里的 inset 恒为 0。
    assert.equal(entry.metrics.menuBarHeight, 0);
    assert.equal(entry.metrics.stripHeight, 38);
    assert.ok(entry.expanded.y >= display.workArea.y);
    assert.ok(entry.expanded.y + entry.expanded.height <= display.workArea.y + display.workArea.height);
  }
});

test('the legacy Windows layout guard only applies when it is explicitly switched on', () => {
  assert.equal(layout.isLegacyWinLayoutGuarded('win32', {}), false);
  assert.equal(layout.isLegacyWinLayoutGuarded('win32', { legacyWinLayout: true }), true);
  assert.equal(layout.isLegacyWinLayoutGuarded('darwin', { legacyWinLayout: true }), false);
  const savedSideDock = { edge: 'left', x: 0, y: 300, displayId: 11 };
  const guarded = layout.layoutMetrics({
    ...winContext(WINDOWS_DISPLAYS.taskbarBottom, savedSideDock),
    legacyWinLayout: true,
  });
  assert.equal(guarded.dockEdge, 'top');
  assert.equal(guarded.dockAlign, 'center');
  assert.equal(guarded.collapsedWidth, 85);
  assert.equal(guarded.collapsedHeight, 9);
  assert.equal(guarded.dragEnabled, false);

  const unified = layout.layoutMetrics(winContext(WINDOWS_DISPLAYS.taskbarBottom, savedSideDock));
  assert.equal(unified.dockEdge, 'left');
  assert.equal(unified.dragEnabled, true);
});

// ============ P1-1：设置白名单与一次性迁移 ============
test('the layout settings survive the read-modify-write path of writePanelPosition', () => {
  const stored = {
    layoutVersion: 2,
    legacyWinLayout: true,
    winNative: true,
    features: { clip: true },
  };
  const whitelisted = appSettingsLayoutPreferences(stored);
  assert.deepEqual(whitelisted, { layoutVersion: 2, legacyWinLayout: true, winNative: true });
  // writePanelPosition 读回白名单字段、改 panelPosition 再整体写回，键必须还在。
  const rewritten = { ...whitelisted, panelPosition: { x: 0, y: 0, edge: 'top', displayId: null } };
  assert.deepEqual(appSettingsLayoutPreferences(rewritten), whitelisted);
  // 缺失或脏值退到"未迁移 / 开关关闭"。
  assert.deepEqual(appSettingsLayoutPreferences({}), { layoutVersion: 0, legacyWinLayout: false, winNative: false });
  assert.deepEqual(
    appSettingsLayoutPreferences({ layoutVersion: '2', legacyWinLayout: 'yes', winNative: 1 }),
    { layoutVersion: 0, legacyWinLayout: false, winNative: false }
  );
});

test('Windows clears a saved position once, then never migrates again', () => {
  const saved = { panelPosition: { x: 0, y: 300, edge: 'left', displayId: 1 }, shortcut: 'Space' };
  const migrated = windowsLayoutMigration('win32', saved);
  assert.deepEqual(migrated, { panelPosition: null, layoutVersion: 2, shortcut: 'Space' });
  assert.equal(windowsLayoutMigration('win32', migrated), null);
  // Mac 从不迁移：它的保存位置一直是生效的。
  assert.equal(windowsLayoutMigration('darwin', saved), null);
});
