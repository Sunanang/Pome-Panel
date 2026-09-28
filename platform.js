(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotchPlatform = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ============ 能力层 v2（P0-1） ============
  // 纯数据，主进程与渲染层共享：能力层只声明"能不能做 / 用什么参数"，
  // "怎么做"在 platform-adapters/ 里。渲染层一律读 notchAPI.capabilities，
  // 不再自己判断 process.platform。
  function baseCapabilities(platform) {
    const mac = platform === 'darwin';
    const win = platform === 'win32';
    return {
      platform,
      layout: {
        areaKind: win ? 'workArea' : 'bounds', // 夹紧 / 侧边停靠的参考区域
        topInsetKind: mac ? 'menuBar' : 'none',
      },
      features: {
        windowSwitcher: mac, // 首页"当前窗口"
        windowFocus: mac, // 通知点击聚焦
        automaticPaste: mac,
        musicControl: mac, // D4：Windows 永久 false，不随运行时打开
        autoLaunch: mac || win,
        firstRunAutoLaunch: mac || win,
        permissionSelfCheck: mac, // 辅助功能 / 屏幕录制自检，Mac 专属
        mediaAccessStatus: mac || win,
        // P4 / D16：设置页「实验功能」里的 Windows 原生能力开关本身只在 Windows 上存在，
        // 与开关当前值无关（否则关掉之后就再也找不到它了）。
        winNativeSetting: win,
      },
      privacyPanes: win
        ? ['microphone', 'camera']
        : ['accessibility', 'screen-recording', 'microphone', 'camera'],
      ui: {
        modifierStyle: mac ? 'symbols' : 'words', // ⌘⌥⌃⇧ vs Ctrl/Alt/Shift/Win
        metaAccelerator: mac ? 'Command' : 'Super',
      },
    };
  }

  // Windows 的原生能力取决于运行时（原生模块能否加载 + 用户开关），只按平台字符串算不出来。
  function resolveCapabilities(platform, runtime = {}) {
    const caps = baseCapabilities(platform);
    if (platform === 'win32') {
      const native = runtime.nativeAvailable === true && runtime.winNativeEnabled === true;
      caps.features.windowSwitcher = native;
      caps.features.windowFocus = native;
      caps.features.automaticPaste = native;
      // musicControl 保持 false（D4）。
    }
    caps.unavailableHomeModules = [
      !caps.features.musicControl && 'music',
      !caps.features.windowSwitcher && 'windows',
    ].filter(Boolean);
    // 旧的扁平字段：留一个版本给尚未迁移到 features.* 的调用方。
    caps.automaticPaste = caps.features.automaticPaste;
    caps.autoLaunch = caps.features.autoLaunch;
    return caps;
  }

  // 旧签名的别名，保留一个版本。
  function capabilities(platform) {
    return resolveCapabilities(platform, {});
  }

  // ============ 快捷键显示（P2-3） ============
  // Electron 的 accelerator 字符串是两端共用的存储格式，只有显示要按平台分：
  // Mac 用 ⌘⌥⌃⇧ 拼在一起，Windows 用 Ctrl/Alt/Shift/Win 加号连接（Super 就是 Win 键）。
  const ACCELERATOR_SYMBOLS = {
    CommandOrControl: '⌘', Command: '⌘', Cmd: '⌘', Super: '⌘', Meta: '⌘',
    Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧',
  };
  const ACCELERATOR_WORDS = {
    CommandOrControl: 'Ctrl', Command: 'Ctrl', Cmd: 'Ctrl', Control: 'Ctrl', Ctrl: 'Ctrl',
    Super: 'Win', Meta: 'Win', Alt: 'Alt', Option: 'Alt', Shift: 'Shift',
  };
  // Apple 的修饰符固定按 ⌃⌥⇧⌘ 排列，录制顺序（⌘ 在先）不能直接显示。
  const MAC_MODIFIER_ORDER = ['⌃', '⌥', '⇧', '⌘'];
  const WINDOWS_MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win'];

  function usesWordModifiers(caps) {
    return Boolean(caps && caps.ui && caps.ui.modifierStyle === 'words');
  }

  // 提示文案里列出的修饰键，顺序与平台习惯一致。
  function modifierHints(caps) {
    return usesWordModifiers(caps) ? [...WINDOWS_MODIFIER_ORDER] : [...MAC_MODIFIER_ORDER];
  }

  function formatAccelerator(accel, caps) {
    const text = typeof accel === 'string' ? accel.trim() : '';
    if (!text) return '';
    const words = usesWordModifiers(caps);
    const table = words ? ACCELERATOR_WORDS : ACCELERATOR_SYMBOLS;
    const order = words ? WINDOWS_MODIFIER_ORDER : MAC_MODIFIER_ORDER;
    const tokens = text.split('+').map((token) => token.trim()).filter(Boolean);
    if (!tokens.length) return '';
    const key = tokens.pop();
    const seen = [];
    tokens.forEach((token) => {
      const label = table[token];
      // 表里没有的 token 说明不是修饰符，原样保留而不是丢掉。
      const value = label || token;
      if (!seen.includes(value)) seen.push(value);
    });
    seen.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
    });
    return words ? [...seen, key].join('+') : `${seen.join('')}${key}`;
  }

  // ============ 麦克风 / 摄像头提示（P3-2） ============
  // Mac 由系统弹授权框，Windows 没有可编程弹窗，只能把用户送到隐私设置；
  // 两端连"设置"的叫法都不一样，所以文案由能力层算，渲染层只负责显示。
  const MEDIA_KIND_LABELS = { microphone: '麦克风', camera: '摄像头' };

  function mediaAccessPrompt(kind, status, caps) {
    const pane = MEDIA_KIND_LABELS[kind] ? kind : 'microphone';
    const label = MEDIA_KIND_LABELS[pane];
    const windows = Boolean(caps && caps.platform === 'win32');
    const settingsName = windows ? 'Windows 设置' : '系统设置';
    const panes = (caps && caps.privacyPanes) || [];
    // not-determined / unknown 也要能给出入口：Windows 上总开关关着时
    // getMediaAccessStatus 未必如实返回 denied，getUserMedia 却已经失败了。
    const denied = status === 'denied' || status === 'restricted';
    return {
      pane,
      denied,
      message: denied
        ? `无法访问${label} · 请在${settingsName}中允许 Pome Panel`
        : `无法访问${label} · 请检查${settingsName}中的权限`,
      actionLabel: windows ? '打开 Windows 隐私设置' : '打开系统设置',
      canOpenSettings: panes.includes(pane),
    };
  }

  // globalShortcut.register 失败时不给原因。Windows 把绝大多数 Win 组合留给系统
  // （Win+L 锁屏、Win+D 显示桌面……），这类失败要和"被别的应用占用"分开说。
  // Alt+Tab / Alt+Esc / Alt+F4 / Ctrl+Esc 等由系统直接处理，同样不是"别的应用占用"。
  const WINDOWS_SYSTEM_COMBOS = new Set(['Alt+Tab', 'Alt+Escape', 'Alt+F4', 'Control+Escape', 'Alt+Space']);

  function shortcutFailureReason(accel, caps) {
    const tokens = String(accel || '').split('+').map((token) => token.trim());
    const reservesMetaKey = usesWordModifiers(caps);
    if (reservesMetaKey && tokens.some((token) => token === 'Super' || token === 'Meta')) {
      return 'system_reserved';
    }
    if (reservesMetaKey) {
      const key = tokens[tokens.length - 1];
      const modifiers = tokens.slice(0, -1)
        .filter((token) => token !== 'Shift')
        .map((token) => (token === 'CommandOrControl' || token === 'Ctrl' ? 'Control' : token));
      if (modifiers.length === 1 && WINDOWS_SYSTEM_COMBOS.has(`${modifiers[0]}+${key}`)) return 'system_reserved';
    }
    return 'occupied';
  }

  function effectiveHiddenModules(hidden, registry, unavailable) {
    const available = registry.filter((id) => !unavailable.includes(id));
    const result = registry.filter((id) => hidden.includes(id) || unavailable.includes(id));
    // A workspace moved from Mac may have only unavailable widgets visible.
    if (available.length && available.every((id) => result.includes(id))) {
      return result.filter((id) => id !== available[0]);
    }
    return result;
  }

  // ============ 布局单一来源（M0-1） ============
  // 所有几何计算都是纯函数：输入 ctx = { platform, display, position, tab, tabSizes }，
  // 输出 bounds / metrics。main.js 只做 IO（读设置、选屏、setBounds、发 IPC）。
  const COLLAPSED_SIDE_LENGTH = 85;
  const COLLAPSED_SIDE_THICKNESS = 9;
  const COLLAPSED_MIN_HEIGHT = 38;
  const EXPANDED_WIDTH = 1240;
  const EXPANDED_PANEL_HEIGHT = 540;
  // 与渲染层结构常量对应：panel padding-top(--s-2 8) + 顶栏(--topbar-h) + panels margin-top(--s-3 12)
  // + panel padding-bottom(--s-4 16)。
  const EXPANDED_CHROME_Y = 98;
  const SCREEN_MARGIN = 24; // 尺寸超屏时保留的安全边
  const PANEL_TOP_SIDE_ALIGN_PX = 120;
  const WINDOWS_LEGACY_EXPANDED_HEIGHT = 616; // P1-2 统一为 638 前的 Windows 旧值
  const WINDOWS_LEGACY_EXPANDED_MARGIN = 48; // P1-2 统一为 SCREEN_MARGIN 前的 Windows 旧值

  const LAYOUT_CONSTANTS = Object.freeze({
    COLLAPSED_SIDE_LENGTH,
    COLLAPSED_SIDE_THICKNESS,
    COLLAPSED_MIN_HEIGHT,
    EXPANDED_WIDTH,
    EXPANDED_PANEL_HEIGHT,
    EXPANDED_CHROME_Y,
    SCREEN_MARGIN,
    PANEL_TOP_SIDE_ALIGN_PX,
  });

  const DOCK_EDGES = ['top', 'bottom', 'left', 'right'];
  const LAYOUT_TAB_IDS = ['home', 'todo', 'notes', 'clip', 'links', 'recordings', 'credentials', 'settings'];

  // 所有 Tab 共用同一展开尺寸，切换内容时不改变原生窗口边界。
  function tabSizes() {
    const sizes = {};
    LAYOUT_TAB_IDS.forEach((id) => {
      sizes[id] = { width: EXPANDED_WIDTH, panelHeight: EXPANDED_PANEL_HEIGHT };
    });
    return sizes;
  }

  const DEFAULT_TAB_SIZES = tabSizes();

  function isDockEdge(value) {
    return DOCK_EDGES.includes(value);
  }

  function normalizeEdge(value) {
    return isDockEdge(value) ? value : 'top';
  }

  // 夹紧 / 停靠的参考区域：Windows 用工作区（避开任务栏），Mac 仍用物理边界。
  function layoutArea(ctx) {
    return ctx.platform === 'win32' ? ctx.display.workArea : ctx.display.bounds;
  }

  // macOS 菜单栏会拦截其高度带内的所有鼠标点击，刘海机型菜单栏高约 37pt。
  function menuBarHeight(ctx) {
    return Math.max(0, ctx.display.workArea.y - ctx.display.bounds.y);
  }

  // 顶部留给系统的高度：Mac 是菜单栏，Windows 恒 0（任务栏已由 workArea 排除）。
  function topInset(ctx) {
    return ctx.platform === 'darwin' ? menuBarHeight(ctx) : 0;
  }

  // 折叠黑条总高：等于菜单栏带（≈物理刘海高），异常取到 0 才回退兜底。
  function collapsedStripHeight(ctx) {
    if (ctx.platform === 'win32') return COLLAPSED_MIN_HEIGHT;
    const mb = menuBarHeight(ctx);
    return mb > 0 ? mb : COLLAPSED_MIN_HEIGHT;
  }

  // 四边同一颗胶囊：侧边竖着 厚×长，顶/底横着 长×厚（尺寸一致，只旋转）。
  function collapsedSize(edge) {
    const dock = normalizeEdge(edge);
    if (dock === 'left' || dock === 'right') {
      return { width: COLLAPSED_SIDE_THICKNESS, height: COLLAPSED_SIDE_LENGTH };
    }
    return { width: COLLAPSED_SIDE_LENGTH, height: COLLAPSED_SIDE_THICKNESS };
  }

  // M0-2（D10）：两端顶边都是 workArea.y。默认收起落点与拖到顶部后一致，
  // 收起动画终点不再和窗口落点差一个菜单栏高度。
  function topEdgeY(ctx) {
    return ctx.display.workArea.y;
  }

  function bottomEdgeY(ctx, height) {
    if (ctx.platform === 'darwin') {
      return ctx.display.workArea.y + ctx.display.workArea.height - height;
    }
    const area = layoutArea(ctx);
    return area.y + area.height - height;
  }

  function clampToArea(ctx, bounds) {
    const area = layoutArea(ctx);
    const maxX = area.x + area.width - bounds.width;
    const maxY = area.y + area.height - bounds.height;
    return {
      x: Math.round(Math.min(Math.max(bounds.x, area.x), Math.max(area.x, maxX))),
      y: Math.round(Math.min(Math.max(bounds.y, area.y), Math.max(area.y, maxY))),
      width: bounds.width,
      height: bounds.height,
    };
  }

  function pickNearestDockEdge(distLeft, distRight, distTop, distBottom) {
    const candidates = [
      { edge: 'top', d: distTop },
      { edge: 'bottom', d: distBottom },
      { edge: 'left', d: distLeft },
      { edge: 'right', d: distRight },
    ];
    candidates.sort((a, b) => a.d - b.d || DOCK_EDGES.indexOf(a.edge) - DOCK_EDGES.indexOf(b.edge));
    return candidates[0].edge;
  }

  function inferPanelEdge(ctx, bounds) {
    const area = layoutArea(ctx);
    return pickNearestDockEdge(
      bounds.x - area.x,
      area.x + area.width - (bounds.x + bounds.width),
      bounds.y - area.y,
      area.y + area.height - (bounds.y + bounds.height)
    );
  }

  // 拖动中按指针距四边远近判定，避免竖条贴左时中心永远更靠近侧边、拖到顶也判不成 top。
  function inferDockEdgeFromPoint(ctx, point) {
    const area = layoutArea(ctx);
    return pickNearestDockEdge(
      point.x - area.x,
      area.x + area.width - point.x,
      point.y - area.y,
      area.y + area.height - point.y
    );
  }

  function snapCollapsed(ctx, bounds, edge) {
    const dock = normalizeEdge(edge || inferPanelEdge(ctx, bounds));
    const size = collapsedSize(dock);
    const area = layoutArea(ctx);
    // 用传入 bounds 的尺寸做中心对齐；调用方必须传入真实折叠尺寸，
    // 否则侧边 9×85 会被 85×9 带偏，收起后跳一下。
    let x = bounds.x + (bounds.width - size.width) / 2;
    let y = bounds.y + (bounds.height - size.height) / 2;
    if (dock === 'top') y = topEdgeY(ctx);
    else if (dock === 'bottom') y = bottomEdgeY(ctx, size.height);
    else if (dock === 'left') x = area.x;
    else x = area.x + area.width - size.width;
    return {
      ...clampToArea(ctx, { x, y, width: size.width, height: size.height }),
      edge: dock,
    };
  }

  function resolveEdgeAlign(ctx, pos, edge) {
    const area = layoutArea(ctx);
    const dock = normalizeEdge(edge);
    const collapsed = collapsedSize(dock);
    if (dock === 'left' || dock === 'right') {
      const topGap = pos.y - area.y;
      const bottomGap = area.y + area.height - (pos.y + collapsed.height);
      if (topGap <= PANEL_TOP_SIDE_ALIGN_PX && topGap <= bottomGap) return 'start';
      if (bottomGap <= PANEL_TOP_SIDE_ALIGN_PX) return 'end';
      return 'center';
    }
    const leftGap = pos.x - area.x;
    const rightGap = area.x + area.width - (pos.x + collapsed.width);
    if (leftGap <= PANEL_TOP_SIDE_ALIGN_PX && leftGap <= rightGap) return 'start';
    if (rightGap <= PANEL_TOP_SIDE_ALIGN_PX) return 'end';
    return 'center';
  }

  function resolveHorizontalExpandX(ctx, pos, width, edge) {
    const collapsed = collapsedSize(edge);
    const align = resolveEdgeAlign(ctx, pos, edge);
    if (align === 'start') return pos.x;
    if (align === 'end') return pos.x + collapsed.width - width;
    return Math.round(pos.x + collapsed.width / 2 - width / 2);
  }

  function resolveSideExpandY(ctx, pos, height, edge) {
    const collapsed = collapsedSize(edge);
    const align = resolveEdgeAlign(ctx, pos, edge);
    if (align === 'start') return pos.y;
    if (align === 'end') return pos.y + collapsed.height - height;
    return Math.round(pos.y + collapsed.height / 2 - height / 2);
  }

  // 展开尺寸按当前 Tab 取值；超出屏幕时 clamp 到安全边内。
  // 高度的参考区域两端不同：Windows 按 workArea 夹紧（P1-2），否则会压到任务栏；
  // Mac 沿用物理边界，顶部停靠再由 expandedBounds 按 workArea 底边收一次。
  function expandedSize(ctx) {
    const sizes = ctx.tabSizes || DEFAULT_TAB_SIZES;
    const size = sizes[ctx.tab] || sizes.home || DEFAULT_TAB_SIZES.home;
    const areaHeight = ctx.platform === 'win32'
      ? ctx.display.workArea.height
      : ctx.display.bounds.height;
    return {
      width: Math.min(size.width, ctx.display.workArea.width - SCREEN_MARGIN),
      height: Math.min(
        EXPANDED_CHROME_Y + size.panelHeight,
        Math.max(collapsedStripHeight(ctx), areaHeight - SCREEN_MARGIN)
      ),
    };
  }

  // 未自定义位置时的"虚拟位置"：顶部居中。
  function defaultPosition(ctx) {
    const area = layoutArea(ctx);
    const size = collapsedSize('top');
    return {
      edge: 'top',
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: topEdgeY(ctx),
      displayId: ctx.display.id == null ? null : ctx.display.id,
    };
  }

  function collapsedBounds(ctx) {
    const pos = ctx.position || defaultPosition(ctx);
    const edge = normalizeEdge(pos.edge);
    const size = collapsedSize(edge);
    const snapped = snapCollapsed(ctx, { x: pos.x, y: pos.y, width: size.width, height: size.height }, edge);
    return { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height };
  }

  function anchoredBounds(ctx, pos, width, height) {
    const edge = normalizeEdge(pos.edge);
    const collapsed = collapsedSize(edge);
    let x;
    let y;
    if (edge === 'left') {
      x = pos.x;
      y = resolveSideExpandY(ctx, pos, height, 'left');
    } else if (edge === 'right') {
      x = pos.x + collapsed.width - width;
      y = resolveSideExpandY(ctx, pos, height, 'right');
    } else if (edge === 'bottom') {
      x = resolveHorizontalExpandX(ctx, pos, width, 'bottom');
      y = bottomEdgeY(ctx, height);
    } else {
      x = resolveHorizontalExpandX(ctx, pos, width, 'top');
      // 与折叠落点一致：顶部停靠贴 workArea，避免展开原点在菜单栏、收起动画却在其下。
      y = topEdgeY(ctx);
    }
    return clampToArea(ctx, { x, y, width, height });
  }

  function expandedBounds(ctx) {
    const { width, height } = expandedSize(ctx);
    const edge = ctx.position ? normalizeEdge(ctx.position.edge) : 'top';
    let bounds;
    if (ctx.position) {
      bounds = anchoredBounds(ctx, ctx.position, width, height);
    } else {
      // M0-2（D12）：无自定义位置时直接按区域居中，避免 defaultPosition.x 与
      // resolveHorizontalExpandX 双重取整导致宽度为偶数的屏幕恒偏 1px。
      const area = layoutArea(ctx);
      bounds = clampToArea(ctx, {
        x: Math.round(area.x + (area.width - width) / 2),
        y: topEdgeY(ctx),
        width,
        height,
      });
    }
    // 展开态不要钻进菜单栏：否则顶部圆角/描边会被菜单栏裁成一条直线。
    if (edge === 'top' && ctx.platform === 'darwin') {
      const minY = ctx.display.workArea.y;
      if (bounds.y < minY) {
        const grew = minY - bounds.y;
        bounds.y = minY;
        bounds.height = Math.max(collapsedStripHeight(ctx), bounds.height - grew);
      }
      const maxHeight = ctx.display.workArea.y + ctx.display.workArea.height - bounds.y - SCREEN_MARGIN;
      bounds.height = Math.min(bounds.height, Math.max(collapsedStripHeight(ctx), maxHeight));
    }
    return bounds;
  }

  // 缺失 / 非法 edge 时按坐标推断；无 ctx（取不到屏幕信息）时回退 top。
  function normalizePosition(ctx, raw) {
    if (!raw || typeof raw !== 'object') return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let edge = raw.edge;
    if (!isDockEdge(edge)) edge = ctx ? inferDockEdgeFromPoint(ctx, { x, y }) : 'top';
    return {
      x,
      y,
      displayId: raw.displayId == null ? null : raw.displayId,
      edge: normalizeEdge(edge),
    };
  }

  function resolvePositionDisplay(displays, position, preferred) {
    if (position && position.displayId != null) {
      const match = (displays || []).find((d) => d.id === position.displayId);
      if (match) return match;
    }
    return preferred || null;
  }

  // P1-1：Windows 已接入统一布局，护栏只在显式回退到旧布局时生效
  // （设置 legacyWinLayout 或 POME_LEGACY_WIN_LAYOUT=1）。旧布局的窗口是顶部居中的
  // 85×9，左/右停靠的竖胶囊只剩约一半可见，所以回退时必须同时禁用拖动。
  function isLegacyWinLayoutGuarded(platform, options) {
    return platform === 'win32' && Boolean(options && options.legacyWinLayout === true);
  }

  function layoutMetrics(ctx) {
    const guarded = isLegacyWinLayoutGuarded(ctx.platform, ctx);
    const position = guarded ? null : ctx.position;
    const edge = position ? normalizeEdge(position.edge) : 'top';
    const align = position ? resolveEdgeAlign(ctx, position, edge) : 'center';
    const collapsed = collapsedSize(edge);
    return {
      stripHeight: collapsedStripHeight(ctx), // 折叠黑条总高（= 菜单栏高 = 物理刘海高）
      menuBarHeight: topInset(ctx), // P1-3：Mac 为菜单栏高，Windows 恒 0
      chromeY: EXPANDED_CHROME_Y,
      tabSizes: ctx.tabSizes || DEFAULT_TAB_SIZES,
      dockEdge: edge,
      dockAlign: align,
      collapsedWidth: collapsed.width,
      collapsedHeight: collapsed.height,
      dragEnabled: !guarded,
    };
  }

  const layout = {
    constants: LAYOUT_CONSTANTS,
    tabSizes,
    tabIds: LAYOUT_TAB_IDS,
    isDockEdge,
    normalizeEdge,
    layoutArea,
    menuBarHeight,
    topInset,
    collapsedStripHeight,
    collapsedSize,
    topEdgeY,
    bottomEdgeY,
    clampToArea,
    inferPanelEdge,
    inferDockEdgeFromPoint,
    snapCollapsed,
    resolveEdgeAlign,
    expandedSize,
    defaultPosition,
    collapsedBounds,
    anchoredBounds,
    expandedBounds,
    normalizePosition,
    resolvePositionDisplay,
    isLegacyWinLayoutGuarded,
    layoutMetrics,
  };

  // Windows 专用的旧位置计算，P1 接入统一布局后整体替换为 layout.*。
  function panelBounds(platform, display, expanded) {
    const area = platform === 'win32' ? display.workArea : display.bounds;
    if (!expanded) {
      // W0-2：收起窗口等于胶囊本身（85×9），胶囊周围不再留下挡点击的透明区域。
      const width = Math.min(COLLAPSED_SIDE_LENGTH, area.width);
      return {
        x: Math.round(area.x + (area.width - width) / 2),
        y: area.y,
        width,
        height: COLLAPSED_SIDE_THICKNESS,
      };
    }
    const strip = platform === 'win32'
      ? COLLAPSED_MIN_HEIGHT
      : Math.max(0, display.workArea.y - display.bounds.y) || COLLAPSED_MIN_HEIGHT;
    const margin = platform === 'win32' ? WINDOWS_LEGACY_EXPANDED_MARGIN : SCREEN_MARGIN;
    const width = Math.max(1, Math.min(EXPANDED_WIDTH, display.workArea.width - margin));
    const height = Math.min(WINDOWS_LEGACY_EXPANDED_HEIGHT, Math.max(strip, area.height - SCREEN_MARGIN));
    return { x: Math.round(area.x + (area.width - width) / 2), y: area.y, width, height };
  }
  function portableMediaPath(directory, value) {
    return `${directory}/${String(value).replace(/\\/g, '/').split('/').pop()}`;
  }

  // 渲染层平台标识（P0-1 / §2.4）：CSP 是 script-src 'self'，不能用内联脚本提前设置，
  // 本文件是 index.html 里最先加载的脚本，所以在这里落地。主进程也 require 同一文件，
  // 必须守卫 document。CSS 只允许在 html[data-platform="win32"] 下覆盖 token（滚动条除外）。
  function applyPlatformDataset() {
    if (typeof document === 'undefined' || !document.documentElement) return null;
    const exposed = typeof window !== 'undefined' && window.notchAPI ? window.notchAPI : null;
    const name = String(
      (exposed && exposed.capabilities && exposed.capabilities.platform)
      || (exposed && exposed.platform)
      || ''
    );
    if (!/^[a-z0-9]+$/.test(name)) return null;
    document.documentElement.dataset.platform = name;
    document.documentElement.classList.add(`platform-${name}`);
    return name;
  }

  applyPlatformDataset();

  return {
    baseCapabilities,
    resolveCapabilities,
    capabilities,
    effectiveHiddenModules,
    formatAccelerator,
    modifierHints,
    shortcutFailureReason,
    mediaAccessPrompt,
    applyPlatformDataset,
    layout,
    panelBounds,
    portableMediaPath,
  };
});
