const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  systemPreferences,
  clipboard,
  globalShortcut,
  safeStorage,
  dialog,
  desktopCapturer,
  ClipboardItem,
} = require('electron');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dns = require('dns');
const zlib = require('zlib');
const crypto = require('crypto');
const platformPolicy = require('./platform');
const { loadAdapter } = require('./platform-adapters');
const { fetchCursorUsage } = require('./cursor-usage');
// 能力层 v2（P0-1）：启动时按平台 + 运行时（原生模块是否可用、用户开关）解析一次，
// 通过 additionalArguments 下发给渲染层；运行期变化走 capabilities:changed。
// 这里的初值不读设置：模块加载早于 app.whenReady，不能碰 screen / 设置文件。
let platformCapabilities = platformPolicy.resolveCapabilities(process.platform, {
  nativeAvailable: false,
  winNativeEnabled: false,
});
const {
  isPrivateAddress,
  extractPageTitle,
  recordingExtension,
  todoReminderState,
  todoReminderTimerDelay,
  taskNotificationIdentity,
  normalizeCredentialInput,
  parseSmartLinkMetadata,
  extractFaviconHref,
  parseSmartMaterialMetadata,
  clipboardServicePolicy,
  createClipboardImageFingerprint,
  prepareClipboardImagePayload,
  installLocalWebContentsGuards,
  runOwnedOpenDialog,
  readClipboardObservation,
  taskNotificationWindowPolicy,
  appSettingsLayoutPreferences,
  pasteResultToIpc,
  windowsLayoutMigration,
  firstRunAutoLaunchPlan,
  updateFeaturePreference,
  selectTranscriptionSettings,
  createWorkspacePersistenceGate,
  hoverSpacePollingPolicy,
  reduceClipboardObservation,
  normalizeDefaultTabPreference,
  updateDefaultTabPreference,
  createForegroundMediaPermissionCoordinator,
  createSyncCredentialsStore,
  syncPairHttpPolicy,
  validatePairingCodeInput,
  PAIR_HTTP_CONFIRM_TEXT,
} = require('./main-services');
const {
  INSECURE_DEVICE_TOKEN_TTL_MS,
  SCHEMA_UI_STATE_INCOMPATIBLE,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
} = require('./packages/sync-protocol');
const { openSyncStore, resolveSyncDbPath } = require('./sync-store');
const {
  classifyFromLocalAndNas,
  resolveMigrationChoice,
  runMigrationAttempt,
  restoreLatestMigrationBackup,
  MIGRATION_BANNER_TEXT,
  isInsideSyncBackupDir,
  resolveSyncBackupsRoot,
  parseLocalTodosStrict,
  selectMigrationLocalTodos,
  classifyMigrationDecision,
} = require('./sync-migration');
const {
  ensureBoundAccount,
  writeTodoUpsert,
  writeTodoDelete,
  writeCategoryUpsert,
  runTodosSyncCycle,
  gateSchemaCompatibility,
} = require('./todos-sync');
const {
  countWorkspaceContent,
  buildWorkspaceEntities,
  partitionEntities,
  planWorkspaceSync,
  projectWorkspaceEntities,
  hashesForEntities,
  mutationFromEntity,
  splitMutationBatches,
  WORKSPACE_COLLECTIONS,
} = require('./workspace-sync');
const {
  createSyncSettingsStore,
  SYNC_SETTINGS_FILE,
} = require('./sync-settings');
const {
  canRequestEndpoint,
  selectEndpointsForAttempt,
  shouldFailover,
  classifyTransportError,
  describeTransportFailure,
  deriveSyncUiState,
  syncUiStateLabel,
  HTTP_INSECURE_CONFIRM_TEXT,
} = require('./packages/sync-protocol/endpoints');

// Keep the historical data directory so upgrading users retain notes, links,
// recordings and encrypted settings after the public product rename.
const LEGACY_USER_DATA_PATH = path.join(app.getPath('appData'), 'Dynamic Panel');
app.setName('Pome Panel');
// Honor Electron's standard profile switch for isolated automated tests.
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') || LEGACY_USER_DATA_PATH);

// ============ 托盘图标 PNG 生成 ============
// 直接在主进程编码 PNG，避免引入额外资源文件
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 4);
    scanlines[off] = 0;
    pixels.copy(scanlines, off + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(scanlines);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 生成刘海形状：扁平顶 + 圆角底，居中偏上
function makeNotchPng(scale) {
  const size = 16 * scale;
  const pixels = Buffer.alloc(size * size * 4);

  // 形状参数（pt 单位 × scale）
  const W = 10 * scale; // 刘海宽
  const H = 5 * scale; // 刘海高
  const R = 2 * scale; // 下方圆角半径
  const x0 = (size - W) / 2;
  const y0 = 3.5 * scale; // 距顶 padding

  function isInside(px, py) {
    if (px < x0 || px > x0 + W || py < y0 || py > y0 + H) return false;
    const bottomR = y0 + H - R;
    if (py < bottomR) return true;
    const leftR = x0 + R;
    const rightR = x0 + W - R;
    if (px >= leftR && px <= rightR) return true;
    if (px < leftR) {
      const dx = leftR - px;
      const dy = py - bottomR;
      return dx * dx + dy * dy <= R * R;
    }
    const dx = px - rightR;
    const dy = py - bottomR;
    return dx * dx + dy * dy <= R * R;
  }

  // 4×4 超采样抗锯齿
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let count = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (isInside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) count++;
        }
      }
      const alpha = Math.round((count / 16) * 255);
      const idx = (y * size + x) * 4;
      pixels[idx + 3] = alpha;
    }
  }

  return encodePng(size, size, pixels);
}

function createNotchTrayIcon() {
  // 菜单栏小图标：22pt Template（@2x=44px），与系统图标同量级，避免撑满被裁切
  if (process.platform === 'win32') {
    // Windows 托盘要交给系统按 DPI 从 .ico 里挑帧；先前把 1024 的 png 缩到 16×16，
    // 125%/150% 缩放下发糊（P2-4）。ico 缺失时仍退回 png。
    const ico = path.join(__dirname, 'build', 'pome-panel-icon.ico');
    if (fs.existsSync(ico)) {
      const icon = nativeImage.createFromPath(ico);
      if (!icon.isEmpty()) return icon;
    }
    return nativeImage.createFromPath(path.join(__dirname, 'build', 'pome-panel-icon.png')).resize({ width: 16, height: 16 });
  }
  const trayPng = path.join(__dirname, 'build', 'pome-trayTemplate.png');
  const trayPng2x = path.join(__dirname, 'build', 'pome-trayTemplate@2x.png');
  let icon;
  if (fs.existsSync(trayPng2x)) {
    const hi = nativeImage.createFromPath(trayPng2x);
    icon = nativeImage.createFromBuffer(hi.toPNG(), { scaleFactor: 2 });
  } else {
    icon = nativeImage.createFromPath(trayPng);
  }
  if (icon.isEmpty()) {
    const png2x = makeNotchPng(2);
    icon = nativeImage.createFromBuffer(png2x, { scaleFactor: 2 });
  }
  icon.setTemplateImage(true);
  return icon;
}

const COLLAPSED_WIDTH = 200;
// 折叠尺寸、展开尺寸与安全边等几何常量的单一来源是 platform.js（M0-1），
// 主进程不再保留第二份字面量；需要取值时读 platformPolicy.layout.constants。
//
// NOTCH_LIP（原 6px 唇边）已移除：折叠条高度现在恰好等于菜单栏高（≈物理刘海高），
// 一个像素都不超出物理刘海。虽然折叠条完全在菜单栏拦截带内，
// 但本项目窗口使用 setAlwaysOnTop(true,'floating') 级别（不压截图/输入法），
// 实测菜单栏不拦截该级别窗口的点击，折叠条仍可点击展开。
// （见项目记忆 notch-top-geometry-constraint / commit f12aea1）

// 所有 Tab 共用同一展开尺寸，切换内容时不再改变原生窗口边界。
// 原生窗口只在折叠/展开两个模式间切换，避免 Tab 切换产生明显的宽高跳变。
const TAB_SIZES = platformPolicy.layout.tabSizes();
const COLLAPSE_WATCHDOG_MS = 650;

const CLIP_MAX_ITEMS = 100;
const CLIP_POLL_INTERVAL_MS = 500;
// 大图从系统 ClipboardItem 复制到进程仍有固定成本；图片探测降到 3 秒一次，
// 文本继续保持 500ms 响应，不影响日常文字剪贴体验。
const CLIP_IMAGE_POLL_INTERVAL_MS = 3000;
const CLIP_IMAGES_DIR_NAME = 'clipboard-images';

const RECORDINGS_DIR_NAME = 'recordings';
const TRANSCRIPTION_SETTINGS_FILE = 'transcription-settings.json';
const CREDENTIALS_VAULT_FILE = 'credentials.vault.json';
const APP_SETTINGS_FILE = 'app-settings.json';
const WORKSPACE_SETTINGS_FILE = 'workspace-settings.json';
const WORKSPACE_DATA_FILE = 'workspace.json';
const MIRROR_IMAGE_FILE = 'mirror-cover.jpg';
const SYNC_CREDENTIALS_FILE_NAME = 'sync-credentials.json';
const workspacePersistenceGate = createWorkspacePersistenceGate();
const TRANSCRIPTION_MODEL = 'qwen3-asr-flash-realtime';
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const TRANSCRIPTION_FINISH_TIMEOUT_MS = 7000;
const RECORDING_MAX_BYTES = 200 * 1024 * 1024;
const LINK_FETCH_TIMEOUT_MS = 8000;
const LINK_FETCH_MAX_BYTES = 512 * 1024;
const LINK_FETCH_MAX_REDIRECTS = 3;

const TASK_NOTIFICATION_WIDTH = 400;
const TASK_NOTIFICATION_HEIGHT = 96;
const TASK_NOTIFICATION_SCREEN_MARGIN = 12;
const TASK_NOTIFICATION_VISIBLE_MS = 6000;
const TASK_NOTIFICATION_LEAVE_MS = 360;
const TASK_NOTIFICATION_DEDUPE_MS = 2000;
const TASK_NOTIFICATION_MAX_QUEUE = 5;
const TASK_NOTIFICATION_BODY_LIMIT = 64 * 1024;
const TASK_NOTIFICATION_HOST = '127.0.0.1';
const TASK_NOTIFICATION_PORT = 43821;
// /notify/<source> 的来源白名单：只放行已知 Agent，其余一律 404。
const TASK_NOTIFICATION_SOURCES = new Set(['codex', 'gpt', 'claude']);
const TODO_REMINDER_LEAD_MS = 60 * 60 * 1000;

let mainWindow = null;
let tray = null;
let currentMode = 'collapsed';
let panelDragOffset = null;
let typingFocusActive = false;
let currentTab = 'home';
let collapseWatchdog = null;
let collapseGeneration = 0;
let hideWhenCollapsed = false;
let isQuitting = false;
let mediaPermissionRequests = 0;
let mediaPermissionBatchHadCamera = false;
let transientSystemInteractionRequests = 0;
let cameraBlurDeferred = false;
const mediaPermissionCoordinator = createForegroundMediaPermissionCoordinator();

// 适配层（P0-2）：JXA / osascript 等"怎么做"的实现都在 platform-adapters/ 下，
// main.js 只做 IPC 与生命周期。Electron 依赖与窗口相关的钩子由这里注入。
const platformAdapter = loadAdapter(process.platform, {
  electron: { app, systemPreferences, shell, dialog, desktopCapturer },
  mediaPermissionCoordinator,
  hooks: {
    getOwnerWindow: () => mainWindow,
    trackMediaPermission: (delta, mediaType) => trackMediaPermissionRequest(delta, mediaType),
  },
});

let notificationWindow = null;
let notificationWindowReady = false;
let notificationServer = null;
let notificationServerAvailable = false;
let activeTaskNotification = null;
let taskNotificationLeaving = false;
let taskNotificationTimer = null;
let taskNotificationFallbackTimer = null;
let taskNotificationTimerStartedAt = 0;
let taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
let taskNotificationPaused = false;
const taskNotificationQueue = [];
const recentTaskNotifications = new Map();
const taskCompletionHistory = [];
let todoReminderTimer = null;
let scheduledTodoReminders = [];

let clipPollTimer = null;
let clipBaselineTimer = null;
let clipPollingEnabled = false;
let clipPolling = false; // 互斥锁：大图 toPNG 同步耗时，防止上一轮未完成又进入
let clipObservationState = { textFingerprint: null, imageFingerprint: null };
let lastClipImageProbeAt = 0;
let clipPollingGeneration = 0;
let spaceShortcutTimer = null;
let spaceShortcutRegistered = false;
let configuredShortcut = '';
const transcriptionSessions = new Map();

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      hideWhenCollapsed = false;
      repositionWindow(getTargetDisplay());
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 多屏适配：定位到"鼠标当前所在屏"的物理顶端居中
// 这样接上外接屏后，无论副屏在主屏的左/右/上/下，刘海都跟着用户视线走
function getTargetDisplay() {
  try {
    const cursor = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursor);
  } catch (e) {
    return screen.getPrimaryDisplay();
  }
}

// 窗口当前所在屏：模式切换 / Tab 变形必须锚定在这块屏上。
// 若跟随光标（getTargetDisplay），失焦收起瞬间会把刘海"瞬移"到光标所在的另一块屏。
function getWindowDisplay() {
  try {
    if (mainWindow) return screen.getDisplayMatching(mainWindow.getBounds());
  } catch (e) {
    // fallthrough
  }
  return getTargetDisplay();
}

// 沙箱 preload 不能 require 本地模块，能力层只能随 additionalArguments 下发。
// 只在创建窗口时生效，运行期变化必须走 capabilities:changed。
function capabilitiesArgument() {
  return `--pome-caps=${Buffer.from(JSON.stringify(platformCapabilities), 'utf8').toString('base64')}`;
}

function broadcastCapabilities() {
  for (const target of [mainWindow, notificationWindow]) {
    if (!target || target.isDestroyed()) continue;
    try { target.webContents.send('capabilities:changed', platformCapabilities); } catch (error) {}
  }
}

// 运行期重新解析：原生模块加载失败或用户关掉 Windows 原生开关时能力要降级。
function refreshRuntimeCapabilities(settings = readAppSettings()) {
  const winNativeEnabled = settings.winNative === true;
  if (winNativeEnabled && typeof platformAdapter.activateNative === 'function') platformAdapter.activateNative();
  const next = platformPolicy.resolveCapabilities(process.platform, {
    nativeAvailable: platformAdapter.native.available === true,
    winNativeEnabled,
  });
  if (JSON.stringify(next) === JSON.stringify(platformCapabilities)) return platformCapabilities;
  platformCapabilities = next;
  broadcastCapabilities();
  return platformCapabilities;
}

// 提醒窗口专用：贴在 Mac 物理顶端（类似灵动岛），Windows 上贴工作区顶端。
// M0-2 起只服务通知窗口，面板几何一律走 platformPolicy.layout.*。
function notificationBounds(width, height, display) {
  const d = display || getTargetDisplay();
  const area = process.platform === 'win32' ? d.workArea : d.bounds;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y,
    width,
    height,
  };
}

// 布局纯函数的输入：只含屏幕几何与当前 Tab，不读设置（供 readAppSettings 内部安全调用）。
function layoutDisplayContext(display) {
  return {
    platform: process.platform,
    display: display || getWindowDisplay(),
    position: null,
    tab: currentTab,
    tabSizes: TAB_SIZES,
    legacyWinLayout: false,
  };
}

function layoutContext(display) {
  const ctx = layoutDisplayContext(display);
  const settings = readAppSettings();
  ctx.position = settings.panelPosition;
  ctx.legacyWinLayout = process.platform === 'win32'
    && (LEGACY_WIN_LAYOUT_ENV || settings.legacyWinLayout === true);
  return ctx;
}

// display 不传时锚定窗口当前所在屏；只有"召唤"类动作（启动/重新居中/显示）才传光标屏。
// 一律瞬时 setBounds：系统动画 resize 会持续重绘 web 内容（卡顿）。
// 原生窗口只提供透明画布，用户可见的岛体形变交给渲染层 CSS。
function getBoundsForMode(mode, display) {
  const hasCustom = Boolean(readAppSettings().panelPosition);
  const d = hasCustom
    ? resolvePositionDisplay(display)
    : (display || getWindowDisplay());
  // P1-1：Windows 与 Mac 共用同一套几何；只有显式回退开关才走旧的顶部居中计算。
  if (isLegacyWinLayout()) return platformPolicy.panelBounds(process.platform, d, mode === 'expanded');
  const ctx = layoutContext(d);
  return mode === 'expanded'
    ? platformPolicy.layout.expandedBounds(ctx)
    : platformPolicy.layout.collapsedBounds(ctx);
}

function cancelCollapseWatchdog() {
  collapseGeneration++;
  if (collapseWatchdog) {
    clearTimeout(collapseWatchdog);
    collapseWatchdog = null;
  }
}

function applyMode(mode, display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  cancelCollapseWatchdog();
  const nextBounds = getBoundsForMode(mode, display);
  mainWindow.setBounds(nextBounds);
  mainWindow.setIgnoreMouseEvents(false);
  currentMode = mode;
  if (mode === 'expanded') hideWhenCollapsed = false;
  if (mode === 'collapsed') {
    // 把纠正后的落点写回，避免下次仍用旧坐标算出错位动画种子。
    // 回退到旧 Windows 布局时不写回：那条路径的坐标恒为顶部居中，会把旧 edge 一起腌坏。
    const pos = isLegacyWinLayout() ? null : readAppSettings().panelPosition;
    if (pos) {
      const d = resolvePositionDisplay(display);
      writePanelPosition({
        x: nextBounds.x,
        y: nextBounds.y,
        displayId: d.id,
        edge: normalizePanelEdge(pos.edge),
      });
    }
    if (hideWhenCollapsed) {
      hideWhenCollapsed = false;
      mainWindow.hide();
      refreshTrayMenu();
    }
  }
  syncHoverSpacePolling();
  syncPasteTracking();
  syncDockMetrics();
}

// P4-1：Windows 的粘贴目标只能在收起态跟踪前台窗口——点击胶囊会先激活 Pome 自己，
// 展开后再问前台就只剩自己了。展开态、剪贴板关闭、原生能力不可用时一律停掉轮询。
// Mac 的 startTracking/stopTracking 是空实现（前台应用由 JXA 现场读取）。
function syncPasteTracking() {
  const shouldTrack = !isQuitting
    && currentMode !== 'expanded'
    && platformCapabilities.features.automaticPaste === true
    && readAppSettings().features.clip === true;
  if (shouldTrack) platformAdapter.paste.startTracking();
  else platformAdapter.paste.stopTracking();
}

// 纯重新定位不能改变收起事务，否则屏幕变化会取消 watchdog 并重新吞掉鼠标。
function repositionWindow(display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(getBoundsForMode(currentMode, display));
}

function beginNativeCollapse() {
  if (!mainWindow || currentMode !== 'expanded') return;
  const targetWindow = mainWindow;
  const generation = ++collapseGeneration;
  targetWindow.setIgnoreMouseEvents(true);
  if (collapseWatchdog) clearTimeout(collapseWatchdog);
  collapseWatchdog = setTimeout(() => {
    if (generation !== collapseGeneration) return;
    collapseWatchdog = null;
    if (mainWindow === targetWindow && currentMode === 'expanded') {
      applyMode('collapsed');
    }
  }, COLLAPSE_WATCHDOG_MS);
}

function requestRendererCollapse() {
  if (!mainWindow || currentMode !== 'expanded') return;
  beginNativeCollapse();
  mainWindow.webContents.send('window:request-collapse');
}

function hideWindowAfterCollapse() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (currentMode === 'expanded') {
    hideWhenCollapsed = true;
    requestRendererCollapse();
    return;
  }
  hideWhenCollapsed = false;
  mainWindow.hide();
  refreshTrayMenu();
}

// ============ Codex / Claude / GPT 任务完成提醒 ============
// 使用独立的非激活窗口，避免打断主刘海窗口的展开、收起和焦点状态机。

function pickTaskNotificationValue(payload, keys) {
  for (const key of keys) {
    const value = payload[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value);
    }
  }
  return '';
}

function cleanTaskNotificationText(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const firstLine = String(value)
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  const cleaned = firstLine
    .replace(/^[#>*`_~\-\s]+/, '')
    .replace(/[`*_~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(cleaned);
  return characters.length > maxLength ? characters.slice(0, maxLength).join('') : cleaned;
}

function isSubagentNotification(payload) {
  const agentType = pickTaskNotificationValue(payload, [
    'agent_type',
    'agent-type',
    'agentType',
  ]).toLowerCase();
  const hookEvent = pickTaskNotificationValue(payload, [
    'hook_event_name',
    'hook-event-name',
    'hookEventName',
  ]).toLowerCase();
  // Claude Code 的 agent_type 存的是子代理名（Explore / security-reviewer 等），
  // 不含 subagent 字样，只有身处子代理时才带 agent_id，故以该字段存在为准。
  const agentId = pickTaskNotificationValue(payload, ['agent_id', 'agent-id', 'agentId']);
  return Boolean(agentId)
    || hookEvent.includes('subagent')
    || agentType.includes('subagent')
    || payload.is_subagent === true
    || payload.isSubagent === true;
}

function normalizeTaskNotification(payload, source) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (isSubagentNotification(payload)) return null;
  const identity = taskNotificationIdentity(payload, source);

  const taskId = cleanTaskNotificationText(
    pickTaskNotificationValue(payload, [
      'turn_id',
      'turn-id',
      'turnId',
      'thread_id',
      'thread-id',
      'threadId',
      'session_id',
      'session-id',
      'sessionId',
      'task_id',
      'task-id',
      'taskId',
      'id',
    ]),
    160
  );

  const completedAtValue = Number(
    pickTaskNotificationValue(payload, ['completed_at', 'completed-at', 'completedAt'])
  );
  const completedAt = Number.isFinite(completedAtValue) && completedAtValue > 0
    ? completedAtValue
    : Date.now();

  return {
    eventId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    source,
    taskId,
    title: identity.title,
    project: identity.project,
    completedAt,
  };
}

function getPendingTaskNotificationCount() {
  return taskNotificationQueue.reduce(
    (total, item) => total + (item.summaryCount || 1),
    0
  );
}

function sendTaskNotificationQueueCount() {
  if (
    !notificationWindow ||
    notificationWindow.isDestroyed() ||
    !notificationWindowReady ||
    !activeTaskNotification
  ) {
    return;
  }
  notificationWindow.webContents.send(
    'task-notification:queue',
    getPendingTaskNotificationCount()
  );
}

function enqueueTaskNotification(notification) {
  if (!notification) return 'ignored';
  const now = Date.now();
  for (const [key, seenAt] of recentTaskNotifications) {
    if (now - seenAt > TASK_NOTIFICATION_DEDUPE_MS) recentTaskNotifications.delete(key);
  }

  const identity = notification.taskId || `${notification.title}:${notification.project}`;
  const dedupeKey = `${notification.source}:${identity}`;
  const lastSeenAt = recentTaskNotifications.get(dedupeKey);
  if (lastSeenAt && now - lastSeenAt <= TASK_NOTIFICATION_DEDUPE_MS) return 'duplicate';
  recentTaskNotifications.set(dedupeKey, now);

  if (notification.source !== 'todo') {
    taskCompletionHistory.unshift(notification);
    if (taskCompletionHistory.length > 20) taskCompletionHistory.length = 20;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completion:new', notification);
    }
  }

  if (taskNotificationQueue.length < TASK_NOTIFICATION_MAX_QUEUE) {
    taskNotificationQueue.push(notification);
  } else {
    const lastIndex = taskNotificationQueue.length - 1;
    const previous = taskNotificationQueue[lastIndex];
    const summaryCount = previous.isSummary ? previous.summaryCount + 1 : 2;
    taskNotificationQueue[lastIndex] = {
      ...notification,
      source: 'task',
      taskId: '',
      title: `另有 ${summaryCount} 个任务已完成`,
      project: '',
      isSummary: true,
      summaryCount,
    };
  }

  if (activeTaskNotification) {
    sendTaskNotificationQueueCount();
  } else {
    showNextTaskNotification();
  }
  return 'queued';
}

function clearTodoReminderTimer() {
  if (todoReminderTimer) clearTimeout(todoReminderTimer);
  todoReminderTimer = null;
}

function fireTodoReminder(todo) {
  const deadline = Date.parse(String(todo.deadline || ''));
  const notification = {
    eventId: `todo-${todo.id}-${deadline}`,
    source: 'todo',
    taskId: String(todo.id || ''),
    title: String(todo.text || '').trim() || '待办即将截止',
    project: '',
    detail: '将在 1 小时内截止',
    deadline,
    completedAt: Date.now(),
  };
  enqueueTaskNotification(notification);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('todo:reminded', {
      id: notification.taskId,
      deadline: String(todo.deadline || ''),
      remindedAt: notification.completedAt,
    });
  }
}

function scheduleNextTodoReminder() {
  clearTodoReminderTimer();
  const now = Date.now();
  let nextDelay = Infinity;
  for (const todo of scheduledTodoReminders) {
    const status = todoReminderState(todo, now, TODO_REMINDER_LEAD_MS);
    if (status.state === 'due') {
      todo.remindedAt = now;
      fireTodoReminder(todo);
      continue;
    }
    if (status.state === 'scheduled') nextDelay = Math.min(nextDelay, status.delayMs);
  }
  if (Number.isFinite(nextDelay)) {
    todoReminderTimer = setTimeout(scheduleNextTodoReminder, todoReminderTimerDelay(nextDelay));
  }
}

ipcMain.handle('todos:schedule-reminders', (event, items) => {
  scheduledTodoReminders = Array.isArray(items)
    ? items
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || '').slice(0, 160),
        text: String(item.text || '').trim().slice(0, 160),
        deadline: String(item.deadline || ''),
        done: item.done === true,
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      }))
      .filter((item) => item.id && item.text)
    : [];
  scheduleNextTodoReminder();
  return { ok: true, count: scheduledTodoReminders.length };
});

ipcMain.handle('pomodoro:notify', (event, minutes) => {
  const safeMinutes = Math.max(1, Math.min(120, Math.round(Number(minutes) || 25)));
  const completedAt = Date.now();
  const notification = {
    eventId: `pomodoro-${completedAt}`,
    taskId: `pomodoro-${completedAt}`,
    source: 'pomodoro',
    project: '番茄钟',
    title: '专注完成',
    body: `${safeMinutes} 分钟专注计时已结束`,
    completedAt,
  };
  return { ok: true, result: enqueueTaskNotification(notification) };
});

function getTaskNotificationBounds(display) {
  const d = display || getTargetDisplay();
  const width = Math.min(
    TASK_NOTIFICATION_WIDTH,
    Math.max(280, d.bounds.width - TASK_NOTIFICATION_SCREEN_MARGIN * 2)
  );
  return notificationBounds(width, TASK_NOTIFICATION_HEIGHT, d);
}

function recoverClosedTaskNotificationWindow(targetWindow) {
  if (notificationWindow !== targetWindow) return;
  const interruptedNotification = activeTaskNotification;
  clearTaskNotificationTimers();
  notificationWindow = null;
  notificationWindowReady = false;
  activeTaskNotification = null;
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  if (!isQuitting && interruptedNotification) {
    taskNotificationQueue.unshift(interruptedNotification);
  }
  if (!isQuitting) setTimeout(showNextTaskNotification, 80);
}

function createTaskNotificationWindow() {
  if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow;
  const bounds = getTaskNotificationBounds();
  notificationWindowReady = false;
  notificationWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    hiddenInMissionControl: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      additionalArguments: [capabilitiesArgument()],
    },
  });

  installLocalWebContentsGuards(notificationWindow.webContents);

  const targetWindow = notificationWindow;
  notificationWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  if (process.platform === 'darwin') notificationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notificationWindow.setIgnoreMouseEvents(false);
  notificationWindow.loadFile(path.join(__dirname, 'renderer', 'notification.html'));

  targetWindow.webContents.once('did-finish-load', () => {
    if (notificationWindow !== targetWindow || targetWindow.isDestroyed()) return;
    notificationWindowReady = true;
    showNextTaskNotification();
  });

  targetWindow.webContents.on('render-process-gone', () => {
    if (!targetWindow.isDestroyed()) targetWindow.destroy();
  });
  targetWindow.on('closed', () => {
    recoverClosedTaskNotificationWindow(targetWindow);
  });
  return notificationWindow;
}

function clearTaskNotificationTimers() {
  if (taskNotificationTimer) {
    clearTimeout(taskNotificationTimer);
    taskNotificationTimer = null;
  }
  if (taskNotificationFallbackTimer) {
    clearTimeout(taskNotificationFallbackTimer);
    taskNotificationFallbackTimer = null;
  }
}

function scheduleTaskNotificationDismiss() {
  if (!activeTaskNotification || taskNotificationLeaving || taskNotificationPaused) return;
  if (taskNotificationTimer) clearTimeout(taskNotificationTimer);
  taskNotificationTimerStartedAt = Date.now();
  taskNotificationTimer = setTimeout(
    beginTaskNotificationDismiss,
    Math.max(0, taskNotificationRemainingMs)
  );
}

function setTaskNotificationPaused(paused) {
  if (!activeTaskNotification || taskNotificationLeaving || taskNotificationPaused === paused) return;
  taskNotificationPaused = paused;
  if (paused) {
    if (taskNotificationTimer) {
      taskNotificationRemainingMs = Math.max(
        0,
        taskNotificationRemainingMs - (Date.now() - taskNotificationTimerStartedAt)
      );
      clearTimeout(taskNotificationTimer);
      taskNotificationTimer = null;
    }
  } else {
    scheduleTaskNotificationDismiss();
  }
}

function showNextTaskNotification() {
  if (activeTaskNotification || taskNotificationQueue.length === 0 || isQuitting) return;
  const targetWindow = createTaskNotificationWindow();
  if (!notificationWindowReady || !targetWindow || targetWindow.isDestroyed()) return;

  activeTaskNotification = taskNotificationQueue.shift();
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  targetWindow.setBounds(getTaskNotificationBounds(getTargetDisplay()));
  targetWindow.showInactive();
  targetWindow.webContents.send('task-notification:show', {
    ...activeTaskNotification,
    pendingCount: getPendingTaskNotificationCount(),
    visibleMs: TASK_NOTIFICATION_VISIBLE_MS,
  });
  scheduleTaskNotificationDismiss();
}

function beginTaskNotificationDismiss() {
  if (!activeTaskNotification || taskNotificationLeaving) return;
  taskNotificationLeaving = true;
  clearTaskNotificationTimers();
  const eventId = activeTaskNotification.eventId;
  if (notificationWindow && !notificationWindow.isDestroyed() && notificationWindowReady) {
    notificationWindow.webContents.send('task-notification:hide', eventId);
  }
  taskNotificationFallbackTimer = setTimeout(
    () => finishTaskNotification(eventId),
    TASK_NOTIFICATION_LEAVE_MS + 120
  );
}

function finishTaskNotification(eventId) {
  if (!activeTaskNotification || activeTaskNotification.eventId !== eventId) return;
  clearTaskNotificationTimers();
  const completedWindow = notificationWindow;
  if (completedWindow && !completedWindow.isDestroyed()) completedWindow.hide();
  activeTaskNotification = null;
  taskNotificationLeaving = false;
  taskNotificationPaused = false;
  taskNotificationRemainingMs = TASK_NOTIFICATION_VISIBLE_MS;
  setTimeout(() => {
    showNextTaskNotification();
    const policy = taskNotificationWindowPolicy({
      active: Boolean(activeTaskNotification),
      queueLength: taskNotificationQueue.length,
    });
    if (
      policy === 'dispose'
      && notificationWindow === completedWindow
      && completedWindow
      && !completedWindow.isDestroyed()
    ) {
      completedWindow.destroy();
    }
  }, 80);
}

function sendTaskNotificationResponse(response, statusCode, body) {
  if (response.headersSent) return;
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  response.end(json);
}

function startTaskNotificationServer() {
  if (notificationServer) return;
  const server = http.createServer((request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url || '/', `http://${TASK_NOTIFICATION_HOST}`);
    } catch (error) {
      sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_url' });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendTaskNotificationResponse(response, 200, { ok: true });
      return;
    }

    const sourceMatch = /^\/notify\/([a-z0-9-]{1,32})$/i.exec(requestUrl.pathname);
    const requestedSource = sourceMatch ? sourceMatch[1].toLowerCase() : '';
    const source = TASK_NOTIFICATION_SOURCES.has(requestedSource) ? requestedSource : null;
    if (request.method !== 'POST' || !source) {
      sendTaskNotificationResponse(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    const contentType = String(request.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      sendTaskNotificationResponse(response, 415, {
        ok: false,
        error: 'application_json_required',
      });
      return;
    }

    const chunks = [];
    let bodyLength = 0;
    let bodyTooLarge = false;
    request.on('data', (chunk) => {
      bodyLength += chunk.length;
      if (bodyLength > TASK_NOTIFICATION_BODY_LIMIT) {
        bodyTooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!bodyTooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (bodyTooLarge) {
        sendTaskNotificationResponse(response, 413, { ok: false, error: 'body_too_large' });
        return;
      }
      let payload;
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        payload = rawBody ? JSON.parse(rawBody) : {};
      } catch (error) {
        sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_json' });
        return;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendTaskNotificationResponse(response, 400, { ok: false, error: 'invalid_payload' });
        return;
      }
      const result = enqueueTaskNotification(normalizeTaskNotification(payload, source));
      sendTaskNotificationResponse(response, 202, { ok: true, result });
    });
    request.on('error', () => {
      if (!response.headersSent) sendTaskNotificationResponse(response, 400, { ok: false });
    });
  });
  notificationServer = server;

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.once('listening', () => {
    if (notificationServer !== server) return;
    notificationServerAvailable = true;
    refreshTrayMenu();
  });
  server.on('error', (error) => {
    if (notificationServer === server) notificationServer = null;
    notificationServerAvailable = false;
    refreshTrayMenu();
    console.warn(`Task notification server unavailable: ${error.message}`);
  });
  server.listen(TASK_NOTIFICATION_PORT, TASK_NOTIFICATION_HOST);
}

function stopTaskNotificationServer() {
  const server = notificationServer;
  notificationServer = null;
  notificationServerAvailable = false;
  if (server) server.close();
}

ipcMain.on('task-notification:hover', (event, paused) => {
  if (
    notificationWindow &&
    !notificationWindow.isDestroyed() &&
    event.sender === notificationWindow.webContents
  ) {
    setTaskNotificationPaused(paused === true);
  }
});

ipcMain.on('task-notification:dismissed', (event, eventId) => {
  if (
    notificationWindow &&
    !notificationWindow.isDestroyed() &&
    event.sender === notificationWindow.webContents &&
    typeof eventId === 'string'
  ) {
    finishTaskNotification(eventId);
  }
});

function createWindow() {
  const initial = getBoundsForMode('collapsed', getTargetDisplay());

  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    frame: false,
    transparent: true,
    // 必须显式给透明底色：只写 transparent 时 BrowserWindow 仍保留不透明的默认底色，
    // 展开瞬间 setBounds 放大后，新暴露的区域会先用它画一两帧，
    // 在菜单栏带上表现为一次黑块闪烁（通知窗口一直是这么写的）。
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    show: false,
    // 不用窗口 vibrancy：放大窗口瞬间会先铺满一整块毛玻璃，破坏岛体展开动画。
    // 玻璃只做在 panel::before 的 clip-path 里，跟动画一起长出来。
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [capabilitiesArgument()],
    },
  });

  installLocalWebContentsGuards(mainWindow.webContents);

  // floating：仍在普通窗口之上，但不压住截图选区 / 输入法候选框（screen-saver 太高）。
  mainWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    try { mainWindow.setVibrancy(null); } catch (e) {}
  }
  if (process.platform === 'darwin') mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === 'win32') mainWindow.setMenu(null);

  // Escape 在到达页面前会被 Chromium 浏览器层吞掉（实测 document keydown 收不到），
  // 用 before-input-event 在分发前拦截并转发给渲染层处理（退出输入 / 收起面板）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow.webContents.send('key:escape');
    }
  });

  // 失焦时让渲染层走完整退场动画，再由渲染层请求缩小原生窗口。
  mainWindow.on('blur', () => {
    if (
      mediaPermissionRequests > 0 ||
      transientSystemInteractionRequests > 0 ||
      typingFocusActive
    ) {
      cameraBlurDeferred = true;
      return;
    }
    requestRendererCollapse();
  });

  mainWindow.on('focus', () => {
    cameraBlurDeferred = false;
  });
  mainWindow.on('show', syncHoverSpacePolling);
  mainWindow.on('hide', syncHoverSpacePolling);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    applyMode('collapsed');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    cancelCollapseWatchdog();
    hideWhenCollapsed = false;
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideWindowAfterCollapse();
  });
}

function toggleVisibility() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    hideWindowAfterCollapse();
  } else {
    hideWhenCollapsed = false;
    repositionWindow(getTargetDisplay()); // 显示前先回到鼠标所在屏顶部
    mainWindow.show();
    refreshTrayMenu();
  }
}

function isAutoLaunchEnabled() {
  if (!platformCapabilities.features.autoLaunch) return false;
  try {
    const settings = app.getLoginItemSettings();
    // Windows：openAtLogin 只看 Run 键还在不在，用户在任务管理器里禁用后它仍为 true，
    // 界面会显示"开"但实际不启动。executableWillLaunchAtLogin 同时考虑 StartupApproved。
    if (process.platform === 'win32' && typeof settings.executableWillLaunchAtLogin === 'boolean') {
      return settings.executableWillLaunchAtLogin;
    }
    return settings.openAtLogin;
  } catch (e) {
    return false;
  }
}

function setAutoLaunch(enabled) {
  if (!platformCapabilities.features.autoLaunch) return false;
  try {
    // openAsHidden 已被 Electron 移除，不再传。
    app.setLoginItemSettings({ openAtLogin: enabled });
    return isAutoLaunchEnabled() === enabled;
  } catch (e) {
    return false;
  }
}

const DEFAULT_FEATURES = {
  home: true,
  todo: true,
  notes: true,
  links: true,
  recordings: true,
  credentials: true,
  clip: false,
};

function getJsonSettingsPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJsonFile(filePath, fallback = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
    return false;
  }
}

// 展开 / 收起 / 拖动一次要读好几遍设置，同步读盘会卡在主线程上；
// 应用设置只由本进程经 saveAppSettings 写入，所以按路径缓存、写入时更新即可。
let appSettingsCache = null;

function readStoredAppSettings() {
  const file = getJsonSettingsPath(APP_SETTINGS_FILE);
  if (!appSettingsCache || appSettingsCache.file !== file) {
    appSettingsCache = { file, stored: readJsonFile(file) };
  }
  return structuredClone(appSettingsCache.stored);
}

function readAppSettings() {
  const stored = readStoredAppSettings();
  const features = { ...DEFAULT_FEATURES, ...(stored.features || {}), home: true };
  const panelPosition = normalizePanelPosition(stored.panelPosition);
  return {
    features,
    shortcut: isValidPanelShortcut(stored.shortcut) ? stored.shortcut : 'Space',
    defaultTab: normalizeDefaultTabPreference(stored.defaultTab, features),
    panelPosition,
    // 白名单必须带上布局键：writePanelPosition 是 read-modify-write，漏一个就会被丢掉。
    ...appSettingsLayoutPreferences(stored),
    encryptedCursorToken: typeof stored.encryptedCursorToken === 'string' ? stored.encryptedCursorToken : '',
  };
}

// POME_LEGACY_WIN_LAYOUT=1 或设置 legacyWinLayout 时回到旧的 Windows 顶部居中布局，
// 保留一个版本作为回滚开关（旧布局下胶囊不能拖动）。
const LEGACY_WIN_LAYOUT_ENV = process.env.POME_LEGACY_WIN_LAYOUT === '1';

function isLegacyWinLayout() {
  if (process.platform !== 'win32') return false;
  return LEGACY_WIN_LAYOUT_ENV || readAppSettings().legacyWinLayout === true;
}

// Windows 接入统一布局时清空一次旧的、此前被忽略的 panelPosition。
function migrateWindowsLayoutSettings() {
  const migrated = windowsLayoutMigration(process.platform, readAppSettings());
  if (!migrated) return false;
  return saveAppSettings(migrated);
}

function normalizePanelEdge(value) {
  return platformPolicy.layout.normalizeEdge(value);
}

function normalizePanelPosition(value) {
  // edge 合法时不必碰 screen：readAppSettings 每次调用都会走到这里。
  let ctx = null;
  if (value && typeof value === 'object' && !platformPolicy.layout.isDockEdge(value.edge)) {
    try {
      const display = (value.displayId != null
        ? screen.getAllDisplays().find((d) => d.id === value.displayId)
        : null) || screen.getDisplayNearestPoint({ x: Number(value.x), y: Number(value.y) });
      if (display) ctx = layoutDisplayContext(display);
    } catch (e) {
      ctx = null;
    }
  }
  return platformPolicy.layout.normalizePosition(ctx, value);
}

function writePanelPosition(pos) {
  const current = readAppSettings();
  current.panelPosition = pos ? normalizePanelPosition(pos) : null;
  saveAppSettings(current);
  syncDockMetrics();
}

function resolvePositionDisplay(preferredDisplay) {
  const pos = readAppSettings().panelPosition;
  let displays = [];
  try {
    displays = screen.getAllDisplays();
  } catch (e) {}
  const match = platformPolicy.layout.resolvePositionDisplay(displays, pos, null);
  return match || preferredDisplay || getWindowDisplay();
}

function clampBoundsToDisplay(bounds, display) {
  return platformPolicy.layout.clampToArea(layoutDisplayContext(display), bounds);
}

function getCollapsedSizeForEdge(edge) {
  return platformPolicy.layout.collapsedSize(edge);
}

function inferDockEdgeFromPoint(point, display) {
  return platformPolicy.layout.inferDockEdgeFromPoint(layoutDisplayContext(display), point);
}

function snapCollapsedBounds(bounds, display, edge) {
  return platformPolicy.layout.snapCollapsed(layoutDisplayContext(display), bounds, edge);
}

function resolveEdgeAlign(pos, edge, display) {
  return platformPolicy.layout.resolveEdgeAlign(layoutDisplayContext(display), pos, edge);
}

function syncDockMetrics() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const metrics = getLayoutMetrics();
  try {
    mainWindow.webContents.send('window:metrics-changed', metrics);
  } catch (e) {}
}

function publicAppSettings() {
  const settings = readAppSettings();
  const { encryptedCursorToken, ...publicSettings } = settings;
  return { ...publicSettings, autoLaunch: isAutoLaunchEnabled() };
}

function saveAppSettings(settings) {
  const file = getJsonSettingsPath(APP_SETTINGS_FILE);
  const saved = writeJsonFile(file, settings);
  appSettingsCache = saved ? { file, stored: JSON.parse(JSON.stringify(settings)) } : null;
  return saved;
}

function workspaceRoot() {
  const settings = readJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE));
  const configured = String(settings.path || '').trim();
  return configured && path.isAbsolute(configured) ? configured : app.getPath('userData');
}

function workspacePath(name) {
  return path.join(workspaceRoot(), name);
}

function showOwnedOpenDialog(options) {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (owner) {
    if (!owner.isVisible()) owner.show();
    owner.focus();
  }
  return runOwnedOpenDialog(
    dialog.showOpenDialog.bind(dialog),
    owner,
    options,
    (delta) => {
      transientSystemInteractionRequests = Math.max(0, transientSystemInteractionRequests + delta);
      if (delta < 0 && transientSystemInteractionRequests === 0 && mediaPermissionRequests === 0) {
        cameraBlurDeferred = false;
      }
    }
  );
}

function copyWorkspaceAssets(sourceRoot, targetRoot) {
  if (!sourceRoot || !targetRoot || path.resolve(sourceRoot) === path.resolve(targetRoot)) return;
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME]) {
    const source = path.join(sourceRoot, directory);
    const target = path.join(targetRoot, directory);
    try {
      if (!fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) continue;
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
    } catch (error) {}
  }
  for (const filename of [WORKSPACE_DATA_FILE, MIRROR_IMAGE_FILE]) {
    const source = path.join(sourceRoot, filename);
    const target = path.join(targetRoot, filename);
    try {
      if (fs.existsSync(source) && fs.lstatSync(source).isFile() && !fs.existsSync(target)) {
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      }
    } catch (error) {}
  }
}

async function chooseWorkspaceFolder() {
  const result = await showOwnedOpenDialog({
    title: '选择 Pome Panel 数据文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  const selected = !result.canceled && result.filePaths && result.filePaths[0];
  if (!selected) return false;
  const previousRoot = workspaceRoot();
  copyWorkspaceAssets(previousRoot, selected);
  if (!writeJsonFile(getJsonSettingsPath(WORKSPACE_SETTINGS_FILE), { path: selected })) return false;
  for (const directory of [RECORDINGS_DIR_NAME, CLIP_IMAGES_DIR_NAME]) {
    try { fs.mkdirSync(path.join(selected, directory), { recursive: true }); } catch (error) {}
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:changed', { path: selected });
  refreshTrayMenu();
  return true;
}

function applyFeatureServices(features) {
  const policy = clipboardServicePolicy(features);
  if (policy.recordHistory) startClipboardPolling();
  else stopClipboardPolling();
  syncPasteTracking();
}

function isValidPanelShortcut(shortcut) {
  if (shortcut === 'Space') return true;
  if (typeof shortcut !== 'string' || shortcut.length > 80) return false;
  const tokens = shortcut.split('+');
  if (tokens.length < 2) return false;
  const key = tokens.pop();
  // Super 就是 Windows 键（Mac 上等价于 Command），P2-3 起允许作为修饰符录入。
  const modifiers = new Set(['CommandOrControl', 'Command', 'Control', 'Alt', 'Option', 'Shift', 'Super']);
  return tokens.length > 0
    && tokens.every((token) => modifiers.has(token))
    && /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key);
}

function setPanelShortcut(shortcut) {
  if (!isValidPanelShortcut(shortcut)) return false;
  const previousShortcut = configuredShortcut || 'Space';
  stopHoverSpaceShortcut();
  if (configuredShortcut && configuredShortcut !== 'Space' && globalShortcut.isRegistered(configuredShortcut)) {
    globalShortcut.unregister(configuredShortcut);
  }
  if (shortcut === 'Space') {
    configuredShortcut = shortcut;
    startHoverSpaceShortcut();
    return true;
  }
  let registered = false;
  try {
    registered = globalShortcut.register(shortcut, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      hideWhenCollapsed = false;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('shortcut:toggle-panel');
    });
  } catch (error) {}
  if (registered) {
    configuredShortcut = shortcut;
    return true;
  }
  configuredShortcut = previousShortcut;
  startHoverSpaceShortcut();
  return false;
}

function applyAppSettings() {
  const settings = readAppSettings();
  refreshRuntimeCapabilities(settings);
  applyFeatureServices(settings.features);
  if (!setPanelShortcut(settings.shortcut)) {
    settings.shortcut = 'Space';
    saveAppSettings(settings);
    setPanelShortcut('Space');
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
}

function openRendererPanel(channel) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hideWhenCollapsed = false;
  repositionWindow(getTargetDisplay());
  mainWindow.show();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
  };
  if (mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

function mirrorImagePath() {
  return workspacePath(MIRROR_IMAGE_FILE);
}

function mirrorImageDataUrl() {
  try {
    const image = nativeImage.createFromPath(mirrorImagePath());
    if (image.isEmpty()) return null;
    return image.toDataURL();
  } catch (error) {
    return null;
  }
}

async function chooseMirrorImage() {
  const result = await showOwnedOpenDialog({
    title: '替换镜子配图',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }],
  });
  const selected = !result.canceled && result.filePaths && result.filePaths[0];
  if (!selected) return { ok: true, canceled: true };
  try {
    const image = nativeImage.createFromPath(selected);
    if (image.isEmpty()) throw new Error('invalid_image');
    const size = image.getSize();
    if (!size.width || !size.height || size.width * size.height > 60_000_000) throw new Error('image_too_large');
    fs.writeFileSync(mirrorImagePath(), image.toJPEG(92), { mode: 0o600 });
    const dataUrl = mirrorImageDataUrl();
    if (dataUrl && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mirror:image-changed', dataUrl);
    }
    return { ok: true, canceled: false, dataUrl };
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', title: '无法替换配图', message: '请选择一张有效且尺寸适中的图片。' });
    return { ok: false, error: 'invalid_image' };
  }
}

function showMainPanelFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hideWhenCollapsed = false;
  if (!mainWindow.isVisible()) mainWindow.show();
  repositionWindow(getTargetDisplay());
  mainWindow.show();
  if (currentMode !== 'expanded') {
    mainWindow.webContents.send('shortcut:toggle-panel');
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const autoLaunch = isAutoLaunchEnabled();
  const menu = Menu.buildFromTemplate([
    {
      label: '显示功能',
      click: showMainPanelFromTray,
    },
    {
      label: '设置快捷键',
      click: () => openRendererPanel('app:record-shortcut'),
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        setAutoLaunch(item.checked);
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '关于',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: '关于 Pome Panel',
          message: 'Pome Panel',
          detail:
            `版本 ${app.getVersion()}\n开发者 Lando\n\n贴在屏幕顶部的个人工作台。可以记笔记、管剪贴板、录音、放常用指令，并和飞牛 NAS 同步。`,
          buttons: ['查看 GitHub', '好'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }).then(({ response }) => {
          if (response === 0) shell.openExternal('https://github.com/Sunanang/Pome-Panel');
        });
      },
    },
    {
      label: '退出',
      accelerator: 'CommandOrControl+Q',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(createNotchTrayIcon());
  tray.setToolTip('Pome Panel');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) {
      hideWhenCollapsed = false;
      repositionWindow(getTargetDisplay());
      mainWindow.show();
      refreshTrayMenu();
    }
  });
  refreshTrayMenu();
}

ipcMain.handle('window:set-mode', async (event, mode) => {
  if (mode === 'expanded') await rememberPasteTarget();
  applyMode(mode === 'expanded' ? 'expanded' : 'collapsed');
});

ipcMain.handle('window:begin-collapse', () => {
  beginNativeCollapse();
});

ipcMain.handle('window:panel-drag-start', () => {
  if (isLegacyWinLayout()) return false;
  if (!mainWindow || mainWindow.isDestroyed() || currentMode !== 'collapsed') return false;
  const cursor = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  panelDragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  return true;
});

ipcMain.handle('window:panel-drag-move', () => {
  if (!mainWindow || mainWindow.isDestroyed() || !panelDragOffset) return null;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const tentative = {
    x: cursor.x - panelDragOffset.x,
    y: cursor.y - panelDragOffset.y,
    width: mainWindow.getBounds().width,
    height: mainWindow.getBounds().height,
  };
  const edge = inferDockEdgeFromPoint(cursor, display);
  const size = getCollapsedSizeForEdge(edge, display);
  // Keep grabbing the same relative point after orientation flips.
  const next = clampBoundsToDisplay({
    x: cursor.x - Math.min(panelDragOffset.x, size.width - 2),
    y: cursor.y - Math.min(panelDragOffset.y, size.height - 2),
    width: size.width,
    height: size.height,
  }, display);
  mainWindow.setBounds(next);
  const metrics = {
    ...getLayoutMetrics(display),
    dockEdge: edge,
    dockAlign: resolveEdgeAlign(
      { x: next.x, y: next.y, edge },
      edge,
      display
    ),
    collapsedWidth: size.width,
    collapsedHeight: size.height,
  };
  try { mainWindow.webContents.send('window:metrics-changed', metrics); } catch (e) {}
  return { ...next, edge };
});

ipcMain.handle('window:panel-drag-end', () => {
  panelDragOffset = null;
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor) || screen.getDisplayMatching(bounds);
  const edge = inferDockEdgeFromPoint(cursor, display);
  const snapped = snapCollapsedBounds(bounds, display, edge);
  mainWindow.setBounds({
    x: snapped.x,
    y: snapped.y,
    width: snapped.width,
    height: snapped.height,
  });
  writePanelPosition({
    x: snapped.x,
    y: snapped.y,
    displayId: display.id,
    edge: snapped.edge,
  });
  return snapped;
});

ipcMain.handle('window:reset-panel-position', () => {
  panelDragOffset = null;
  writePanelPosition(null);
  if (mainWindow && !mainWindow.isDestroyed()) {
    repositionWindow(getTargetDisplay());
  }
  return true;
});

// 默认用 floating，避免压住系统截图选区与输入法候选框。
function applyMainWindowLayer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mediaPermissionRequests > 0) return;
  mainWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    try { mainWindow.setVibrancy(null); } catch (e) {}
  }
}

ipcMain.handle('window:set-typing-focus', (event, focused) => {
  const next = focused === true;
  if (typingFocusActive === next) return typingFocusActive;
  typingFocusActive = next;
  applyMainWindowLayer();
  if (!next && cameraBlurDeferred && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    cameraBlurDeferred = false;
    requestRendererCollapse();
  }
  return typingFocusActive;
});

ipcMain.handle('settings:get', () => publicAppSettings());
ipcMain.handle('settings:set-feature', (event, payload) => {
  const current = readAppSettings();
  const features = updateFeaturePreference(current.features, payload && payload.featureId, payload && payload.enabled);
  if (!features) return { ok: false, error: 'invalid_feature' };
  const next = { ...current, features };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  refreshTrayMenu();
  return { ok: true, settings: publicAppSettings() };
});
// Windows 原生能力开关（P4-1 / D16）：默认关（WIN_NATIVE_DEFAULT），用户在设置页
// 「实验功能」里打开后才解析出 windowSwitcher / windowFocus / automaticPaste。
ipcMain.handle('settings:set-win-native', (event, enabled) => {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported' };
  const next = { ...readAppSettings(), winNative: enabled };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  // 开关保存成功不代表原生层可用（koffi 加载失败 / POME_DISABLE_WIN_NATIVE=1），界面按实际能力提示。
  return {
    ok: true,
    winNative: readAppSettings().winNative,
    nativeAvailable: platformAdapter.native.available === true,
    nativeReason: platformAdapter.native.reason || null,
    capabilities: platformCapabilities,
  };
});
ipcMain.handle('settings:set-default-tab', (event, defaultTab) => {
  const next = updateDefaultTabPreference(readAppSettings(), defaultTab);
  if (!next) return { ok: false, error: 'invalid_default_tab' };
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  applyAppSettings();
  return { ok: true, settings: publicAppSettings() };
});
ipcMain.handle('settings:set-auto-launch', (event, enabled) => {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'invalid' };
  if (!setAutoLaunch(enabled)) return { ok: false, error: 'save_failed', autoLaunch: isAutoLaunchEnabled() };
  const settings = publicAppSettings();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  return { ok: true, autoLaunch: settings.autoLaunch };
});
ipcMain.handle('settings:set-shortcut', (event, accelerator) => {
  if (!isValidPanelShortcut(accelerator)) return { ok: false, error: 'invalid' };
  if (!setPanelShortcut(accelerator)) {
    // 注册失败没有原因码：Win 组合基本都被系统留着，要和"被别的应用占用"分开提示。
    return { ok: false, error: platformPolicy.shortcutFailureReason(accelerator, platformCapabilities) };
  }
  const next = readAppSettings();
  next.shortcut = accelerator;
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('settings:changed', publicAppSettings());
  refreshTrayMenu();
  return { ok: true, shortcut: accelerator };
});
ipcMain.handle('workspace:get', () => ({ path: workspaceRoot(), portable: workspaceRoot() !== app.getPath('userData') }));
ipcMain.handle('workspace:load-data', () => {
  const payload = readJsonFile(workspacePath(WORKSPACE_DATA_FILE), {});
  return payload && payload.localStorage && typeof payload.localStorage === 'object'
    ? payload.localStorage
    : {};
});

function normalizePortableStorage(storage) {
  const portable = { ...storage };
  const normalizers = [
    ['notch-recordings', 'audioPath', RECORDINGS_DIR_NAME],
    ['notch-clip-history', 'imagePath', CLIP_IMAGES_DIR_NAME],
  ];
  for (const [storageKey, property, directory] of normalizers) {
    try {
      const rows = JSON.parse(portable[storageKey]);
      if (!Array.isArray(rows)) continue;
      portable[storageKey] = JSON.stringify(rows.map((row) => {
        if (!row || typeof row !== 'object' || !row[property]) return row;
        return { ...row, [property]: platformPolicy.portableMediaPath(directory, row[property]) };
      }));
    } catch (error) {}
  }
  return portable;
}

ipcMain.handle('workspace:save-data', (event, storage) => {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return false;
  const portableStorage = normalizePortableStorage(storage);
  const serialized = JSON.stringify(portableStorage);
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) return false;
  const destination = workspacePath(WORKSPACE_DATA_FILE);
  if (!workspacePersistenceGate.shouldWrite(portableStorage, destination)) return true;
  const written = writeJsonFile(destination, {
    version: 1,
    updatedAt: Date.now(),
    localStorage: portableStorage,
  });
  if (written) workspacePersistenceGate.markWritten(portableStorage, destination);
  return written;
});
ipcMain.handle('workspace:open', () => shell.openPath(workspaceRoot()));
ipcMain.handle('workspace:choose', () => chooseWorkspaceFolder());

function getLayoutMetrics(display) {
  return platformPolicy.layout.layoutMetrics(layoutContext(display));
}

ipcMain.handle('window:metrics', () => {
  return getLayoutMetrics();
});

// Tab 仅改变内容；固定展开尺寸下不再触发原生窗口 resize。
ipcMain.handle('window:set-tab', (event, tab) => {
  currentTab = Object.prototype.hasOwnProperty.call(TAB_SIZES, tab) ? tab : 'home';
});

// 授权期间的窗口层级与失焦收起协调留在主进程（和 mainWindow 状态机强耦合），
// 真正的授权动作在适配层：Mac 走 TCC 弹窗，Windows 只读系统总开关。
function trackMediaPermissionRequest(delta, mediaType) {
  if (delta > 0 && mediaType === 'camera') mediaPermissionBatchHadCamera = true;
  mediaPermissionRequests = Math.max(0, mediaPermissionRequests + delta);
  if (delta >= 0 || mediaPermissionRequests > 0) return;
  const shouldCollapse = cameraBlurDeferred && mediaPermissionBatchHadCamera;
  mediaPermissionBatchHadCamera = false;
  cameraBlurDeferred = false;
  if (!shouldCollapse) return;
  const targetWindow = mainWindow;
  setTimeout(() => {
    if (
      mainWindow === targetWindow &&
      targetWindow &&
      !targetWindow.isDestroyed() &&
      !targetWindow.isFocused()
    ) {
      requestRendererCollapse();
    }
  }, 200);
}

function requestMediaAccess(mediaType) {
  if (!platformCapabilities.features.mediaAccessStatus) return Promise.resolve(true);
  return Promise.resolve(platformAdapter.media.request(mediaType));
}

// macOS 渲染层 getUserMedia 不会自动弹 TCC 授权，必须由主进程申请摄像头/麦克风权限。
ipcMain.handle('media:camera', () => requestMediaAccess('camera'));
ipcMain.handle('media:microphone', () => requestMediaAccess('microphone'));

// P3-2：只读状态 + 提示文案，刻意和上面两个通道分开——ensureCamera/ensureMicrophone
// 的布尔返回值是渲染层的既有契约（`!(await ensureMicrophone())`），不能改成对象。
ipcMain.handle('media:access-status', (event, mediaType) => {
  const type = mediaType === 'camera' ? 'camera' : 'microphone';
  const status = platformCapabilities.features.mediaAccessStatus
    ? platformAdapter.media.status(type)
    : 'unknown';
  return { type, status, ...platformPolicy.mediaAccessPrompt(type, status, platformCapabilities) };
});

ipcMain.handle('tasks:recent', () => taskCompletionHistory);

// 快捷链接：URL 走外部浏览器（仅 http/https），本地路径走系统打开（仅绝对路径）
ipcMain.handle('shell:openExternal', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url);
  }
});

ipcMain.handle('shell:openPath', (event, p) => {
  if (typeof p === 'string' && path.isAbsolute(p)) {
    return shell.openPath(p);
  }
});

// 只放行固定的几个隐私面板：面板表在适配层，渲染层传来的值只能当作枚举的键来查，
// 绝不能拼进 URL（x-apple.systempreferences: 能打开任意设置面板）。
ipcMain.handle('shell:open-privacy-settings', (event, pane) => {
  const target = platformAdapter.privacyPaneUrl(pane);
  if (!target) return false;
  shell.openExternal(target);
  return true;
});

// 启动时的权限自检是 Mac 专属能力（缺失时的表现都是「静默失效」，系统不弹提示），
// 实现在 platform-adapters/darwin.js。
async function promptForMissingPermissions() {
  if (!platformCapabilities.features.permissionSelfCheck || !platformAdapter.permissions) return;
  await platformAdapter.permissions.selfCheck();
}

async function validatePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return null;
  }
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) return null;
  return url;
}

async function readResponseText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LINK_FETCH_MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchFaviconDataUrl(pageUrl, html) {
  let candidate;
  try {
    const href = extractFaviconHref(html) || '/favicon.ico';
    candidate = await validatePublicHttpUrl(new URL(href, pageUrl).toString());
  } catch (error) {
    candidate = null;
  }
  if (!candidate) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(candidate, { signal: controller.signal, redirect: 'error' });
    const type = String(response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
    if (!response.ok || !type.startsWith('image/')) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 160 * 1024) return '';
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch (error) {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichLinkMetadata(url, title) {
  const config = resolveLlmConfig();
  if (!config.apiKey || !config.model) return { title, category: '' };
  const endpoint = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const safeEndpoint = await validatePublicHttpUrl(endpoint);
  if (!safeEndpoint) return { title, category: '' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DynamicPanel/0.3 (+local bookmark organizer)',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        ...(config.baseUrl.includes('deepseek.com') ? { thinking: { type: 'disabled' } } : {}),
        messages: [
          {
            role: 'system',
            content: '你是网址收藏夹整理器。只返回 JSON：{"title":"简洁中文名称","category":"短分类"}。分类应稳定、可复用，不超过 14 个字。',
          },
          { role: 'user', content: `URL: ${url}\n网页标题: ${title}` },
        ],
      }),
    });
    if (!response.ok) return { title, category: '' };
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
    const parsed = parseSmartLinkMetadata(content);
    if (!parsed) return { title, category: '' };
    return { title: parsed.title || title, category: parsed.category };
  } catch (error) {
    return { title, category: '' };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectLink(rawUrl) {
  let current = await validatePublicHttpUrl(rawUrl);
  if (!current) return { ok: false, error: 'invalid_or_private_url' };
  for (let redirectCount = 0; redirectCount <= LINK_FETCH_MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
          'User-Agent': 'DynamicPanel/0.3 (+local bookmark metadata)',
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      // URL 已经过公网与协议校验；正文不可读不应阻止收藏，仍尝试抓站点根图标。
      const icon = await fetchFaviconDataUrl(current.toString(), '');
      return {
        ok: true,
        url: current.toString(),
        title: '未命名',
        category: '',
        icon,
        warning: error && error.name === 'AbortError' ? 'timeout' : 'fetch_failed',
      };
    }
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount >= LINK_FETCH_MAX_REDIRECTS) {
        return { ok: false, error: 'too_many_redirects' };
      }
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      if (!current) return { ok: false, error: 'unsafe_redirect' };
      continue;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const fallback = current.hostname.replace(/^www\./, '');
    if (!response.ok || (!contentType.includes('text/html') && !contentType.includes('xhtml'))) {
      const [smart, icon] = await Promise.all([
        enrichLinkMetadata(current.toString(), fallback),
        fetchFaviconDataUrl(current.toString(), ''),
      ]);
      return { ok: true, url: current.toString(), title: smart.title || '未命名', category: smart.category, icon };
    }
    const html = await readResponseText(response);
    const pageTitle = extractPageTitle(html, fallback);
    const [smart, icon] = await Promise.all([
      enrichLinkMetadata(current.toString(), pageTitle),
      fetchFaviconDataUrl(current.toString(), html),
    ]);
    return { ok: true, url: current.toString(), title: smart.title, category: smart.category, icon };
  }
  return { ok: false, error: 'too_many_redirects' };
}

ipcMain.handle('links:inspect', (event, url) => inspectLink(url));

ipcMain.handle('smart:organize-material', async (event, payload) => {
  const config = resolveLlmConfig();
  const kind = payload && payload.kind === 'note' ? 'note' : 'material';
  const transcript = String(payload && payload.text || '').trim().slice(0, 8000);
  if (!transcript) return { ok: false, error: 'empty_text' };
  if (!config.apiKey || !config.model) return { ok: false, error: 'not_configured' };
  const endpoint = config.baseUrl.endsWith('/chat/completions')
    ? config.baseUrl
    : `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const safeEndpoint = await validatePublicHttpUrl(endpoint);
  if (!safeEndpoint) return { ok: false, error: 'invalid_endpoint' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(safeEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        ...(config.baseUrl.includes('deepseek.com') ? { thinking: { type: 'disabled' } } : {}),
        messages: [
          {
            role: 'system',
            content: kind === 'note'
              ? '你是中文笔记命名助手。理解整篇笔记后概括主题，禁止把正文首句直接当标题。只返回 JSON：{"title":"8到18字的具体标题","category":"2到8字的稳定分类"}。'
              : '你是中文个人资料库整理器。根据内容概括，不要照抄首句。只返回 JSON：{"title":"8到18字的具体名称","category":"2到8字的稳定分类"}。',
          },
          { role: 'user', content: kind === 'note' ? `请为以下笔记命名：\n\n${transcript}` : transcript },
        ],
      }),
    });
    if (!response.ok) return { ok: false, error: `http_${response.status}` };
    const result = await response.json();
    const content = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    const metadata = parseSmartMaterialMetadata(content);
    return metadata && metadata.title ? { ok: true, ...metadata } : { ok: false, error: 'invalid_response' };
  } catch (error) {
    return { ok: false, error: error && error.name === 'AbortError' ? 'timeout' : 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
});

// 窗口枚举与聚焦在适配层实现（Mac 走 JXA，Windows 暂时 unsupported）。
// 聚焦只接受最近一次扫描缓存里的窗口 ID，缓存也留在适配层实例里。
ipcMain.handle('windows:list', async () => {
  if (!platformCapabilities.features.windowSwitcher) return { items: [], error: 'unsupported' };
  return platformAdapter.windows.list();
});

ipcMain.handle('windows:focus', async (event, windowId) => {
  if (!platformCapabilities.features.windowSwitcher) return false;
  return platformAdapter.windows.focus(windowId);
});

function taskWindowMatchScore(notification, target) {
  const project = String(notification && notification.project || '').trim().toLocaleLowerCase();
  const title = String(target && target.title || '').trim().toLocaleLowerCase();
  const appName = String(target && target.appName || '').trim().toLocaleLowerCase();
  if (!project || !title) return 0;
  if (title === project) return 100;
  if (title.startsWith(`${project} `) || title.startsWith(`${project} —`) || title.startsWith(`${project} -`)) return 90;
  if (title.includes(project)) return 75;
  if (project.includes(appName) && appName) return 25;
  return 0;
}

async function activateActiveTaskNotification(eventId = null) {
  const notification = activeTaskNotification;
  if (!notification || (eventId && notification.eventId !== eventId) || notification.source === 'todo') return false;
  if (!platformCapabilities.features.windowFocus) return false;
  const result = await platformAdapter.windows.list();
  const target = (result.items || [])
    .map((item) => ({ item, score: taskWindowMatchScore(notification, item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
  if (!target) return false;
  const focused = await platformAdapter.windows.focusRow(target);
  if (focused) beginTaskNotificationDismiss();
  return focused;
}

ipcMain.handle('task-notification:activate', async (event, eventId) => {
  if (!notificationWindow || notificationWindow.isDestroyed() || event.sender !== notificationWindow.webContents) return false;
  return activateActiveTaskNotification(eventId);
});

// 展开面板前记住当前前台应用，收起后才能把内容粘回去（实现在适配层）。
function rememberPasteTarget() {
  if (!platformCapabilities.features.automaticPaste) return Promise.resolve(null);
  return platformAdapter.paste.captureTarget();
}

ipcMain.handle('mirror:get-image', () => mirrorImageDataUrl());
ipcMain.handle('mirror:choose-image', () => chooseMirrorImage());

function getCredentialsVaultPath() {
  return path.join(app.getPath('userData'), CREDENTIALS_VAULT_FILE);
}

function readCredentialsVault() {
  if (!safeStorage.isEncryptionAvailable()) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(getCredentialsVaultPath(), 'utf8'));
    const decoded = safeStorage.decryptString(Buffer.from(String(envelope.payload || ''), 'base64'));
    const rows = JSON.parse(decoded);
    return Array.isArray(rows) ? rows.map((item) => normalizeCredentialInput(item, item && item.id, item && item.createdAt)).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function writeCredentialsVault(rows) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const payload = safeStorage.encryptString(JSON.stringify(rows)).toString('base64');
  const vaultPath = getCredentialsVaultPath();
  const temporaryPath = `${vaultPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, payload }), { mode: 0o600 });
    fs.renameSync(temporaryPath, vaultPath);
    return true;
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch (unlinkError) {}
    return false;
  }
}

function publicCredential(item) {
  return {
    id: item.id,
    service: item.service,
    account: item.account,
    passwordMask: '**********',
    createdAt: item.createdAt,
  };
}

ipcMain.handle('credentials:list', () => ({
  ok: safeStorage.isEncryptionAvailable(),
  secureStorage: safeStorage.isEncryptionAvailable(),
  items: readCredentialsVault().map(publicCredential),
}));

ipcMain.handle('credentials:get', (event, id) => {
  const item = readCredentialsVault().find((row) => row.id === String(id || ''));
  return item ? { ok: true, item: { ...item } } : { ok: false, error: 'not_found' };
});

ipcMain.handle('credentials:save', (event, payload) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'secure_storage_unavailable' };
  const rows = readCredentialsVault();
  const existing = payload && payload.id ? rows.find((item) => item.id === payload.id) : null;
  const normalized = normalizeCredentialInput(
    existing && !String(payload && payload.password || '') ? { ...payload, password: existing.password } : payload,
    existing ? existing.id : crypto.randomUUID(),
    existing ? existing.createdAt : Date.now()
  );
  if (!normalized) return { ok: false, error: 'invalid_credential' };
  const next = existing
    ? rows.map((item) => item.id === existing.id ? normalized : item)
    : [normalized, ...rows];
  return writeCredentialsVault(next)
    ? { ok: true, item: publicCredential(normalized) }
    : { ok: false, error: 'save_failed' };
});

ipcMain.handle('credentials:delete-many', (event, ids) => {
  const targets = new Set(Array.isArray(ids) ? ids.map(String) : []);
  if (!targets.size) return { ok: true, deleted: 0 };
  const rows = readCredentialsVault();
  const next = rows.filter((item) => !targets.has(item.id));
  if (!writeCredentialsVault(next)) return { ok: false, error: 'save_failed' };
  return { ok: true, deleted: rows.length - next.length };
});

ipcMain.handle('credentials:copy', async (event, payload) => {
  const id = String(payload && payload.id || '');
  const field = payload && payload.field === 'password' ? 'password' : payload && payload.field === 'account' ? 'account' : '';
  if (!id || !field) return false;
  const item = readCredentialsVault().find((row) => row.id === id);
  if (!item) return false;
  const value = item[field];
  await clipboard.writeText(value);
  if (field === 'password') {
    setTimeout(() => {
      void clipboard.readText()
        .then((currentValue) => {
          if (currentValue === value) return clipboard.clear();
          return undefined;
        })
        .catch(() => {});
    }, 60_000).unref?.();
  }
  return true;
});

const syncCredentialsStore = createSyncCredentialsStore({
  getUserDataPath: () => app.getPath('userData'),
  getAppDataPath: () => app.getPath('appData'),
  safeStorage,
  fs,
  path,
  fileName: SYNC_CREDENTIALS_FILE_NAME,
});

const syncSettingsStore = createSyncSettingsStore({
  getUserDataPath: () => app.getPath('userData'),
  fs,
  path,
  fileName: SYNC_SETTINGS_FILE,
});

/** @type {ReturnType<typeof openSyncStore> | null} */
let todosSyncStore = null;
let todosSyncCycleTimer = null;
const TODOS_SYNC_CYCLE_INTERVAL_MS = 15_000;

/**
 * In-memory schema negotiation outcome for the bound session (T7).
 * Cleared on rebind / clear; not persisted (revalidated on next sync).
 * @type {null | {
 *   incompatible: boolean,
 *   uiState: string | null,
 *   upgradeTarget: string | null,
 *   message: string | null,
 *   reason: string | null,
 *   schemaVersion?: number,
 *   minSupported?: number,
 *   maxSupported?: number,
 *   checkedAt: number,
 * }}
 */
let syncSchemaRuntime = null;

function clearSyncSchemaRuntime() {
  syncSchemaRuntime = null;
}

function setSyncSchemaRuntimeFromEvaluation(evaluation) {
  if (!evaluation) {
    clearSyncSchemaRuntime();
    return null;
  }
  if (evaluation.ok) {
    syncSchemaRuntime = {
      incompatible: false,
      uiState: null,
      upgradeTarget: null,
      message: null,
      reason: null,
      schemaVersion: evaluation.schemaVersion,
      minSupported: evaluation.minSupported,
      maxSupported: evaluation.maxSupported,
      checkedAt: Date.now(),
    };
    return syncSchemaRuntime;
  }
  syncSchemaRuntime = {
    incompatible: true,
    uiState: evaluation.uiState || SCHEMA_UI_STATE_INCOMPATIBLE,
    upgradeTarget: evaluation.upgradeTarget || 'unknown',
    message: evaluation.message || null,
    reason: evaluation.reason || 'schema_incompatible',
    schemaVersion: evaluation.schemaVersion,
    minSupported: evaluation.minSupported,
    maxSupported: evaluation.maxSupported,
    checkedAt: Date.now(),
  };
  return syncSchemaRuntime;
}

function buildSyncPublicStatus() {
  const base = syncCredentialsStore.getStatus();
  if (!syncSchemaRuntime || !syncSchemaRuntime.incompatible) {
    return {
      ...base,
      schemaIncompatible: false,
      schemaUiState: null,
      schemaUpgradeTarget: null,
      schemaMessage: null,
    };
  }
  return {
    ...base,
    schemaIncompatible: true,
    schemaUiState: syncSchemaRuntime.uiState,
    schemaUpgradeTarget: syncSchemaRuntime.upgradeTarget,
    schemaMessage: syncSchemaRuntime.message,
    schemaReason: syncSchemaRuntime.reason,
    schemaVersion: syncSchemaRuntime.schemaVersion,
    schemaMinSupported: syncSchemaRuntime.minSupported,
    schemaMaxSupported: syncSchemaRuntime.maxSupported,
  };
}

function broadcastSyncStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('sync:status', buildSyncPublicStatus());
}

function getTodosSyncStore() {
  if (todosSyncStore) return todosSyncStore;
  const dbPath = resolveSyncDbPath(app.getPath('userData'));
  todosSyncStore = openSyncStore(dbPath);
  return todosSyncStore;
}

function closeTodosSyncStore() {
  if (todosSyncCycleTimer) {
    clearInterval(todosSyncCycleTimer);
    todosSyncCycleTimer = null;
  }
  if (todosSyncStore) {
    try {
      todosSyncStore.close();
    } catch {
      // ignore close races on quit
    }
    todosSyncStore = null;
  }
}

function readBoundSyncContext() {
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) {
    return { ok: false, error: 'not_bound' };
  }
  const record = syncCredentialsStore.read().record;
  if (!record || !record.deviceToken || !record.deviceId || !record.uid || !record.serverId) {
    return { ok: false, error: 'binding_incomplete' };
  }
  const store = getTodosSyncStore();
  const bound = ensureBoundAccount(store, record);
  return {
    ok: true,
    store,
    accountId: bound.accountId,
    deviceId: bound.deviceId,
    record,
    status,
  };
}

function broadcastTodosProjection(projection) {
  if (!projection || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('sync:todos-projection', {
    todosJson: projection.todosJson,
    categoryNamesJson: projection.categoryNamesJson,
    todos: projection.todos,
    categoryNames: projection.categoryNames,
  });
}

function createTodosSyncTransport(record) {
  const token = record.deviceToken;
  const fallbackBaseUrl = record.baseUrl;
  return {
    async pullPage({ cursor, collection } = {}) {
      const params = new URLSearchParams();
      if (cursor != null && cursor !== '') params.set('cursor', String(cursor));
      params.set('collection', collection || 'todos');
      const query = `?${params.toString()}`;
      return withEndpointFailover(async (endpoint) => {
        const response = await fetchSyncJson(
          joinSyncApiUrl(endpoint.baseUrl || fallbackBaseUrl, `api/v1/sync/pull${query}`),
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok) {
          return {
            ok: false,
            error: (response.body && response.body.error) || response.error || 'pull_failed',
            message: response.message || null,
            status: response.status,
            certificateError: response.certificateError,
            needsTrustConfirm: response.needsTrustConfirm === true,
            code: response.code,
            body: response.body,
          };
        }
        return { ok: true, body: response.body };
      }, { token });
    },
    async pushMutations(mutations) {
      return withEndpointFailover(async (endpoint) => {
        const response = await fetchSyncJson(
          joinSyncApiUrl(endpoint.baseUrl || fallbackBaseUrl, 'api/v1/sync/push'),
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: { mutations },
            timeoutMs: 60000,
          },
        );
        if (!response.ok) {
          return {
            ok: false,
            error: (response.body && response.body.error) || response.error || 'push_failed',
            message: response.message || null,
            status: response.status,
            applied: response.body && response.body.applied,
            certificateError: response.certificateError,
            needsTrustConfirm: response.needsTrustConfirm === true,
            code: response.code,
            body: response.body,
          };
        }
        return {
          ok: true,
          applied: response.body && response.body.applied,
          serverRev: response.body && response.body.serverRev,
          body: response.body,
        };
      }, { token });
    },
  };
}

async function runBoundTodosSyncCycle({ broadcast = true } = {}) {
  const ctx = readBoundSyncContext();
  if (!ctx.ok) {
    return { ok: false, error: ctx.error };
  }
  const transport = createTodosSyncTransport(ctx.record);
  const result = await runTodosSyncCycle(ctx.store, {
    accountId: ctx.accountId,
    pullPage: transport.pullPage,
    pushMutations: transport.pushMutations,
    localSchema: {
      minSupported: MIN_SUPPORTED_SCHEMA_VERSION,
      maxSupported: MAX_SUPPORTED_SCHEMA_VERSION,
    },
  });
  if (result.error === SCHEMA_UI_STATE_INCOMPATIBLE || result.stopPull || result.stopPush) {
    setSyncSchemaRuntimeFromEvaluation(result);
    broadcastSyncStatus();
    return result;
  }
  if (result.ok) {
    // Compatible cycle clears any prior mismatch latch.
    setSyncSchemaRuntimeFromEvaluation({
      ok: true,
      schemaVersion: result.schemaVersion,
      minSupported: MIN_SUPPORTED_SCHEMA_VERSION,
      maxSupported: MAX_SUPPORTED_SCHEMA_VERSION,
    });
    broadcastSyncStatus();
  }
  if (result.ok && broadcast) {
    broadcastTodosProjection(result.projection);
  }
  if (result.ok) {
    try {
      await runBoundWorkspaceSyncCycle();
    } catch (error) {
      // 工作区同步失败时待办结果仍然有效，下一轮再试。
    }
  }
  return result;
}

function scheduleTodosSyncCycle() {
  if (todosSyncCycleTimer) return;
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) return;
  todosSyncCycleTimer = setInterval(() => {
    runBoundTodosSyncCycle().catch(() => {});
  }, TODOS_SYNC_CYCLE_INTERVAL_MS);
  if (typeof todosSyncCycleTimer.unref === 'function') {
    todosSyncCycleTimer.unref();
  }
}

function joinSyncApiUrl(baseUrl, apiPath) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(apiPath || '').replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

function fetchSyncJson(targetUrl, { method = 'GET', headers = {}, body, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      resolve({ ok: false, error: 'invalid_url' });
      return;
    }
    const lib = parsed.protocol === 'https:' ? require('https') : require('http');
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': payload.length,
              }
            : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (error) {
            resolve({ ok: false, error: 'invalid_json', status: res.statusCode });
            return;
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: json });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', transferable: true });
    });
    req.on('error', (error) => {
      const message = (error && error.message) || 'network_error';
      const code = (error && error.code) || message;
      const described = describeTransportFailure({ code, message });
      if (described) {
        resolve({ ...described, code });
        return;
      }
      const classified = classifyTransportError({ code, message });
      resolve({
        ok: false,
        error: message,
        message,
        code,
        transferable: classified.transferable === true,
        certificateError: false,
        needsTrustConfirm: false,
        uiState: classified.uiState || null,
      });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function buildNasSyncDashboard() {
  const credStatus = syncCredentialsStore.getStatus();
  const view = syncSettingsStore.getPublicView();
  let outboxCount = 0;
  let accountId = null;
  if (credStatus.bound) {
    try {
      const ctx = readBoundSyncContext();
      if (ctx.ok) {
        accountId = ctx.accountId;
        outboxCount = ctx.store.listPendingOutbox(ctx.accountId).length;
      }
    } catch {
      outboxCount = 0;
    }
  }
  const publicStatus = buildSyncPublicStatus();
  const certificateError = Boolean(
    view.lastError &&
      (view.lastError.code === 'certificate_error' || view.lastUiState === 'certificate_error'),
  );
  const endpointDisabled = Boolean(
    view.currentEndpoint &&
      (view.currentEndpoint.disabledByPolicy || canRequestEndpoint(view.currentEndpoint).ok === false),
  );
  const migrating = Boolean(migrationSession && migrationSession.readonly);
  const migrationFailed = Boolean(migrationSession && migrationSession.phase === 'failed');
  const schemaIncompatible = Boolean(
    publicStatus.schemaIncompatible || view.lastUiState === 'schema_incompatible',
  );
  const uiState = deriveSyncUiState({
    bound: credStatus.bound,
    needsReauth: credStatus.needsReauth,
    migrating,
    migrationFailed,
    syncing: false,
    outboxCount,
    offline: Boolean(view.lastError) && !schemaIncompatible,
    lastSuccessAt: view.lastSuccessAt,
    lastError: view.lastError,
    certificateError,
    endpointDisabled,
    schemaIncompatible,
  });
  syncSettingsStore.recordSyncMeta({ lastUiState: uiState });
  return {
    ok: true,
    credentials: publicStatus,
    settings: view,
    outboxCount,
    accountId,
    uiState,
    uiLabel: syncUiStateLabel(uiState),
    channelLabel: (view.currentEndpoint && view.currentEndpoint.baseUrl) || '',
    lastSuccessAt: view.lastSuccessAt,
    insecureHttpWarning: view.insecureHttpWarning,
    devicePortGuidance: view.devicePortGuidance,
    httpConfirmText: HTTP_INSECURE_CONFIRM_TEXT,
    schemaIncompatible,
    schemaUpgradeTarget: publicStatus.schemaUpgradeTarget || null,
    schemaMessage: publicStatus.schemaMessage || null,
  };
}

async function probeEndpointHealth(endpoint, token) {
  const gate = canRequestEndpoint(endpoint);
  if (!gate.ok) {
    return { ok: false, error: gate.error, uiState: gate.uiState || null };
  }
  const response = await fetchSyncJson(joinSyncApiUrl(endpoint.baseUrl, 'api/v1/health'), {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeoutMs: 4000,
  });
  if (!response.ok) {
    const described = describeTransportFailure({
      code: response.code,
      error: response.error,
      message: response.message || response.error,
    });
    if (described && described.error === 'https_on_http') {
      return { ...described, status: response.status, code: response.code };
    }
    if (response.certificateError || (described && described.certificateError)) {
      return {
        ok: false,
        error: 'certificate_error',
        message: '证书错误',
        certificateError: true,
        needsTrustConfirm: true,
        transferable: false,
        uiState: 'certificate_error',
      };
    }
    const classified = classifyTransportError(response.status || response.error || response.code);
    return {
      ok: false,
      error: response.error || 'health_failed',
      status: response.status,
      transferable: classified.transferable,
      certificateError: classified.kind === 'certificate_error',
      uiState: classified.uiState || null,
    };
  }
  return {
    ok: true,
    serverId: response.body && response.body.serverId,
    schemaVersion: response.body && response.body.schemaVersion,
    body: response.body,
  };
}

async function withEndpointFailover(runFn) {
  const view = syncSettingsStore.getPublicView();
  const ordered = selectEndpointsForAttempt(view.endpoints, {
    currentEndpointId: view.currentEndpointId,
  });
  if (ordered.length === 0 && view.endpoints.length === 0) {
    // Fall back to credentials baseUrl as a transient single endpoint when settings empty.
    return runFn({
      endpointId: 'legacy',
      baseUrl: syncCredentialsStore.getStatus().baseUrl || '',
      enabled: true,
      allowInsecureHttp: true,
      disabledByPolicy: false,
      priority: 0,
    });
  }
  if (ordered.length === 0) {
    return { ok: false, error: 'no_endpoint', uiState: 'endpoint_disabled' };
  }
  let lastFailure = null;
  for (const endpoint of ordered) {
    const gate = canRequestEndpoint(endpoint);
    if (!gate.ok) {
      lastFailure = { ok: false, error: gate.error, endpointId: endpoint.endpointId };
      continue;
    }
    const result = await runFn(endpoint);
    if (result && result.ok) {
      syncSettingsStore.setCurrentEndpoint(endpoint.endpointId);
      syncSettingsStore.updateEndpointHealth(endpoint.endpointId, {
        ok: true,
        serverId: result.serverId || null,
      });
      syncSettingsStore.recordSyncMeta({
        lastSuccessAt: Date.now(),
        lastError: null,
        currentEndpointId: endpoint.endpointId,
        lastUiState: 'synced',
      });
      return { ...result, endpointId: endpoint.endpointId, endpoint };
    }
    lastFailure = { ...result, endpointId: endpoint.endpointId };
    if (result && result.certificateError) {
      syncSettingsStore.recordSyncMeta({
        lastError: { code: 'certificate_error', at: Date.now() },
        lastUiState: 'certificate_error',
      });
      return {
        ok: false,
        error: 'certificate_error',
        certificateError: true,
        transferable: false,
        uiState: 'certificate_error',
        endpointId: endpoint.endpointId,
      };
    }
    if (!shouldFailover(result && (result.status || result.error || result.code))) {
      syncSettingsStore.recordSyncMeta({
        lastError: { code: (result && result.error) || 'request_failed', at: Date.now() },
      });
      return lastFailure;
    }
  }
  return lastFailure || { ok: false, error: 'all_endpoints_failed' };
}

ipcMain.handle('sync:get-status', () => buildSyncPublicStatus());

ipcMain.handle('sync:get-dashboard', () => buildNasSyncDashboard());

ipcMain.handle('sync:list-endpoints', () => syncSettingsStore.getPublicView());

ipcMain.handle('sync:add-endpoint', (event, payload = {}) => {
  const result = syncSettingsStore.addEndpoint(payload);
  return result;
});

ipcMain.handle('sync:update-endpoint', (event, payload = {}) => {
  const endpointId = String(payload.endpointId || '');
  if (!endpointId) return { ok: false, error: 'endpoint_id_required' };
  return syncSettingsStore.updateEndpoint(endpointId, payload);
});

ipcMain.handle('sync:delete-endpoint', (event, payload = {}) => {
  const endpointId = String(payload.endpointId || '');
  if (!endpointId) return { ok: false, error: 'endpoint_id_required' };
  return syncSettingsStore.deleteEndpoint(endpointId);
});

ipcMain.handle('sync:reorder-endpoint', (event, payload = {}) => {
  const endpointId = String(payload.endpointId || '');
  if (!endpointId) return { ok: false, error: 'endpoint_id_required' };
  return syncSettingsStore.reorderEndpoint(endpointId, payload.direction === 'up' ? 'up' : 'down');
});

ipcMain.handle('sync:set-current-endpoint', (event, payload = {}) => {
  return syncSettingsStore.setCurrentEndpoint(String(payload.endpointId || ''));
});

ipcMain.handle('sync:set-gateway-bearer-blocked', (event, payload = {}) => {
  return syncSettingsStore.setGatewayBearerBlocked(payload && payload.blocked === true);
});

ipcMain.handle('sync:test-endpoint', async (event, payload = {}) => {
  const endpointId = String(payload.endpointId || '');
  const view = syncSettingsStore.getPublicView();
  const endpoint = (view.endpoints || []).find((ep) => ep.endpointId === endpointId);
  if (!endpoint) return { ok: false, error: 'not_found' };
  const token = syncCredentialsStore.getDeviceToken();
  const result = await probeEndpointHealth(endpoint, token);
  syncSettingsStore.updateEndpointHealth(endpointId, result);
  if (result.certificateError) {
    syncSettingsStore.recordSyncMeta({
      lastError: { code: 'certificate_error', at: Date.now() },
      lastUiState: 'certificate_error',
    });
  }
  return result;
});

ipcMain.handle('sync:retry', async () => {
  const result = await runBoundTodosSyncCycle({ broadcast: true });
  return { ...result, dashboard: buildNasSyncDashboard() };
});

ipcMain.handle('sync:export-todos-backup', async () => {
  const ctx = readBoundSyncContext();
  let todosJson = '{}';
  let categoryNamesJson = '{}';
  if (ctx.ok) {
    const projection = ctx.store.buildTodosLocalStorageProjection(ctx.accountId);
    todosJson = projection.todosJson;
    categoryNamesJson = projection.categoryNamesJson;
  } else {
    // Unbound: export current renderer-held data is not available in main;
    // fall back to empty shell so dialog still works for UX.
    todosJson = JSON.stringify({ P0: [], P1: [], P2: [], P3: [] });
  }
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const save = await dialog.showSaveDialog(win, {
    title: '导出待办备份',
    defaultPath: `pome-todos-backup-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (save.canceled || !save.filePath) {
    return { ok: false, error: 'cancelled' };
  }
  try {
    fs.writeFileSync(
      save.filePath,
      `${JSON.stringify({ todos: JSON.parse(todosJson), categoryNames: JSON.parse(categoryNamesJson), exportedAt: Date.now() }, null, 2)}\n`,
      'utf8',
    );
    return { ok: true, path: save.filePath };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: error && error.message };
  }
});

ipcMain.handle('sync:pair-http-policy', (event, baseUrl) => {
  const policy = syncPairHttpPolicy(baseUrl);
  return {
    ...policy,
    confirmText: PAIR_HTTP_CONFIRM_TEXT,
    insecureTtlDays: Math.round(INSECURE_DEVICE_TOKEN_TTL_MS / (24 * 60 * 60 * 1000)),
  };
});

ipcMain.handle('sync:pair-claim', async (event, payload = {}) => {
  const codeCheck = validatePairingCodeInput(payload.pairingCode || payload.code);
  if (!codeCheck.ok) return { ok: false, error: codeCheck.error };

  const baseUrl = String(payload.baseUrl || '').trim();
  const policy = syncPairHttpPolicy(baseUrl);
  if (!policy.ok) return { ok: false, error: policy.error || 'invalid_base_url' };

  const allowInsecureHttp = payload.allowInsecureHttp === true;
  if (policy.requiresExtraConfirm) {
    if (!allowInsecureHttp) {
      return { ok: false, error: 'insecure_http_not_allowed' };
    }
    if (payload.httpConfirmAccepted !== true) {
      return { ok: false, error: 'http_confirm_required', confirmText: PAIR_HTTP_CONFIRM_TEXT };
    }
  }

  if (!syncCredentialsStore.encryptionAvailable()) {
    return { ok: false, error: 'secure_storage_unavailable', refusedPlaintext: true, needsReauth: true };
  }

  const insecureBound = Boolean(policy.insecureBound);
  const claimUrl = joinSyncApiUrl(baseUrl, 'api/v1/pair/claim');
  const response = await fetchSyncJson(claimUrl, {
    method: 'POST',
    body: {
      pairingCode: codeCheck.code,
      deviceName: payload.deviceName || require('os').hostname(),
      insecureBound,
    },
  });

  if (!response.ok) {
    const described = describeTransportFailure({
      code: response.code,
      error: response.error,
      message: response.message || response.error,
    });
    if (described) {
      return { ...described, status: response.status, code: response.code || null };
    }
    return {
      ok: false,
      error: (response.body && response.body.error) || response.error || 'claim_failed',
      message: response.message || null,
      status: response.status,
      certificateError: false,
      needsTrustConfirm: false,
    };
  }

  const body = response.body || {};
  const schemaGate = gateSchemaCompatibility(body, {
    minSupported: MIN_SUPPORTED_SCHEMA_VERSION,
    maxSupported: MAX_SUPPORTED_SCHEMA_VERSION,
  });
  if (!schemaGate.ok) {
    setSyncSchemaRuntimeFromEvaluation(schemaGate);
    broadcastSyncStatus();
    return {
      ok: false,
      error: SCHEMA_UI_STATE_INCOMPATIBLE,
      reason: schemaGate.reason,
      stopPull: true,
      stopPush: true,
      uiState: schemaGate.uiState,
      upgradeTarget: schemaGate.upgradeTarget,
      message: schemaGate.message,
      schemaVersion: schemaGate.schemaVersion,
      minSupported: schemaGate.minSupported,
      maxSupported: schemaGate.maxSupported,
    };
  }

  if (!body.deviceToken) {
    return { ok: false, error: 'missing_device_token' };
  }

  const record = {
    deviceToken: body.deviceToken,
    deviceId: body.deviceId,
    uid: body.uid,
    serverId: body.serverId,
    expiresAt: body.expiresAt,
    insecureBound: Boolean(body.insecureBound),
    baseUrl,
    boundAt: Date.now(),
    ...(body.accountSyncKey ? { accountSyncKey: body.accountSyncKey } : {}),
  };
  const saved = syncCredentialsStore.save(record);
  if (!saved.ok) {
    return { ok: false, error: saved.error || 'save_failed', refusedPlaintext: saved.refusedPlaintext };
  }
  clearSyncSchemaRuntime();
  setSyncSchemaRuntimeFromEvaluation(schemaGate);
  try {
    syncSettingsStore.ensureEndpointFromPairing(baseUrl, {
      kind: 'gateway',
      allowInsecureHttp: allowInsecureHttp === true,
      serverId: body.serverId,
      uid: body.uid,
    });
    ensureBoundAccount(getTodosSyncStore(), record);
    scheduleTodosSyncCycle();
    // Kick an immediate cycle (pull→push). Migration four-state is T5b — not here.
    runBoundTodosSyncCycle().catch(() => {});
  } catch {
    // Binding still succeeds even if SyncStore open fails; next write will retry.
  }
  return { ok: true, status: { ...saved.status, ...buildSyncPublicStatus() } };
});

ipcMain.handle('sync:clear-binding', () => {
  const cleared = syncCredentialsStore.clear();
  clearSyncSchemaRuntime();
  closeTodosSyncStore();
  broadcastSyncStatus();
  return cleared.ok ? { ok: true, status: buildSyncPublicStatus() } : { ok: false, error: cleared.error };
});

ipcMain.handle('sync:todos-local-write', (event, payload = {}) => {
  const ctx = readBoundSyncContext();
  if (!ctx.ok) {
    return { ok: false, error: ctx.error, unbound: ctx.error === 'not_bound' };
  }

  const op = payload.op;
  const ctxWrite = { accountId: ctx.accountId, deviceId: ctx.deviceId };
  let result;
  if (op === 'upsert-todo') {
    result = writeTodoUpsert(ctx.store, ctxWrite, {
      item: payload.item,
      categoryId: payload.categoryId,
      clientMutationId: payload.clientMutationId,
      clientTime: payload.clientTime,
    });
  } else if (op === 'delete-todo') {
    result = writeTodoDelete(ctx.store, ctxWrite, {
      entityId: payload.entityId || (payload.item && payload.item.id),
      clientMutationId: payload.clientMutationId,
      clientTime: payload.clientTime,
    });
  } else if (op === 'upsert-category') {
    result = writeCategoryUpsert(ctx.store, ctxWrite, {
      priority: payload.priority || payload.categoryId,
      name: payload.name,
      clientMutationId: payload.clientMutationId,
      clientTime: payload.clientTime,
    });
  } else {
    return { ok: false, error: 'unsupported_op' };
  }

  if (!result.ok) {
    return { ok: false, error: result.reason || 'write_failed', field: result.field };
  }

  // Online push attempt; offline keeps outbox queued.
  runBoundTodosSyncCycle().catch(() => {});

  return {
    ok: true,
    deduped: result.deduped === true,
    pendingCount: result.pendingCount,
    projection: {
      todosJson: result.projection.todosJson,
      categoryNamesJson: result.projection.categoryNamesJson,
    },
  };
});

ipcMain.handle('sync:todos-run-cycle', async () => {
  const result = await runBoundTodosSyncCycle({ broadcast: true });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || result.reason || 'sync_failed',
      phase: result.phase,
      pendingCount: result.pendingCount,
      stopPull: result.stopPull === true,
      stopPush: result.stopPush === true,
      uiState: result.uiState || null,
      upgradeTarget: result.upgradeTarget || null,
      message: result.message || null,
      status: buildSyncPublicStatus(),
    };
  }
  return {
    ok: true,
    pendingCount: result.pendingCount,
    pushed: result.pushed,
    pulledChanges: result.pulledChanges,
    status: buildSyncPublicStatus(),
    projection: {
      todosJson: result.projection.todosJson,
      categoryNamesJson: result.projection.categoryNamesJson,
    },
  };
});

ipcMain.handle('sync:todos-get-projection', () => {
  const ctx = readBoundSyncContext();
  if (!ctx.ok) {
    return { ok: false, error: ctx.error, unbound: ctx.error === 'not_bound' };
  }
  const projection = ctx.store.buildTodosLocalStorageProjection(ctx.accountId);
  return {
    ok: true,
    bound: true,
    pendingCount: ctx.store.listPendingOutbox(ctx.accountId).length,
    projection: {
      todosJson: projection.todosJson,
      categoryNamesJson: projection.categoryNamesJson,
      todos: projection.todos,
      categoryNames: projection.categoryNames,
    },
  };
});

ipcMain.handle('sync:list-devices', async (event, payload = {}) => {
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) return { ok: false, error: 'not_bound' };
  const token = syncCredentialsStore.getDeviceToken();
  const baseUrl = String((payload && payload.baseUrl) || status.baseUrl || '').trim();
  if (!baseUrl || !token) return { ok: false, error: 'missing_endpoint' };
  const response = await fetchSyncJson(joinSyncApiUrl(baseUrl, 'api/v1/devices'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return {
      ok: false,
      error: (response.body && response.body.error) || response.error || 'list_failed',
      status: response.status,
    };
  }
  return { ok: true, devices: (response.body && response.body.devices) || [] };
});

ipcMain.handle('sync:revoke-device', async (event, payload = {}) => {
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) return { ok: false, error: 'not_bound' };
  const token = syncCredentialsStore.getDeviceToken();
  const baseUrl = String((payload && payload.baseUrl) || status.baseUrl || '').trim();
  const deviceId = String((payload && payload.deviceId) || '').trim();
  if (!baseUrl || !token || !deviceId) return { ok: false, error: 'invalid_revoke' };
  const response = await fetchSyncJson(
    joinSyncApiUrl(baseUrl, `api/v1/devices/${encodeURIComponent(deviceId)}/revoke`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    },
  );
  if (!response.ok) {
    return {
      ok: false,
      error: (response.body && response.body.error) || response.error || 'revoke_failed',
      status: response.status,
    };
  }
  if (deviceId === status.deviceId) {
    syncCredentialsStore.clear();
  }
  return { ok: true, device: response.body && response.body.device, clearedLocal: deviceId === status.deviceId };
});

/** In-memory migration UI session (read-only gate for todos). */
const migrationSession = {
  readonly: false,
  phase: 'idle',
  migrationId: null,
  lastError: null,
  pendingProjection: null,
};

let syncStoreInstance = null;

function getOrOpenSyncStore() {
  if (syncStoreInstance) return syncStoreInstance;
  const dbPath = resolveSyncDbPath(app.getPath('userData'));
  syncStoreInstance = openSyncStore(dbPath);
  return syncStoreInstance;
}

function broadcastMigrationSession() {
  const payload = {
    readonly: migrationSession.readonly,
    phase: migrationSession.phase,
    migrationId: migrationSession.migrationId,
    lastError: migrationSession.lastError,
    bannerText: MIGRATION_BANNER_TEXT,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('sync:migration-session', payload);
  }
  return payload;
}

function setMigrationSession(patch) {
  Object.assign(migrationSession, patch);
  return broadcastMigrationSession();
}

async function fetchBoundSyncJson(apiPath, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) return { ok: false, error: 'not_bound' };
  const token = syncCredentialsStore.getDeviceToken();
  const baseUrl = String(status.baseUrl || '').trim();
  if (!baseUrl || !token) return { ok: false, error: 'missing_endpoint' };
  const response = await fetchSyncJson(joinSyncApiUrl(baseUrl, apiPath), {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body,
    timeoutMs,
  });
  if (!response.ok) {
    return {
      ok: false,
      error: (response.body && response.body.error) || response.error || 'request_failed',
      status: response.status,
      body: response.body,
    };
  }
  return { ok: true, body: response.body, status: response.status };
}

ipcMain.handle('sync:get-migration-session', () => ({
  ok: true,
  ...broadcastMigrationSession(),
  pendingProjection: migrationSession.pendingProjection,
}));

const WORKSPACE_INDEX_FILE = 'sync-workspace-index.json';

function workspaceIndexPath() {
  return path.join(app.getPath('userData'), WORKSPACE_INDEX_FILE);
}

function readWorkspaceIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(workspaceIndexPath(), 'utf8'));
    return parsed && parsed.hashes && typeof parsed.hashes === 'object' ? parsed.hashes : {};
  } catch (error) {
    return {};
  }
}

function writeWorkspaceIndex(hashes) {
  const target = workspaceIndexPath();
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, hashes: hashes || {} }), { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (unlinkError) {}
  }
}

function readOptionalFileBase64(filePath, maxBytes) {
  if (!filePath) return '';
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return '';
    return fs.readFileSync(filePath).toString('base64');
  } catch (error) {
    return '';
  }
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function readWorkspaceBagValue(key) {
  const payload = readJsonFile(workspacePath(WORKSPACE_DATA_FILE), {});
  const stored = payload && payload.localStorage && payload.localStorage[key];
  return typeof stored === 'string' ? stored : null;
}

function assembleWorkspaceSnapshot(rendererSnapshot) {
  const snap = rendererSnapshot && typeof rendererSnapshot === 'object' ? rendererSnapshot : {};
  const notes = snap.notes && typeof snap.notes === 'object' ? snap.notes : {};
  const clipboard = snap.clipboard && typeof snap.clipboard === 'object' ? snap.clipboard : {};
  const history = Array.isArray(clipboard.history)
    ? clipboard.history
    : parseJsonArray(readWorkspaceBagValue('notch-clip-history'));
  const recordings = Array.isArray(snap.recordings)
    ? snap.recordings
    : parseJsonArray(readWorkspaceBagValue('notch-recordings'));
  const storedAi = readStoredTranscriptionSettings();
  return {
    notes: {
      home: typeof notes.home === 'string' ? notes.home : (readWorkspaceBagValue('notch-home-note') || ''),
      archive: Array.isArray(notes.archive) ? notes.archive : parseJsonArray(readWorkspaceBagValue('notch-note-archive-v1')),
      activeId: typeof notes.activeId === 'string'
        ? notes.activeId
        : (readWorkspaceBagValue('notch-note-active-archive-v1') || ''),
    },
    links: Array.isArray(snap.links) ? snap.links : parseJsonArray(readWorkspaceBagValue('notch-link-groups')),
    commands: Array.isArray(snap.commands)
      ? snap.commands
      : parseJsonArray(readWorkspaceBagValue('notch-home-commands')),
    clipboard: {
      history: history.map((item) => {
        if (!item || item.type !== 'image') return item;
        return {
          ...item,
          imageBase64: readOptionalFileBase64(getSafeClipImagePath(item.imagePath), 2 * 1024 * 1024),
        };
      }),
      favorites: Array.isArray(clipboard.favorites)
        ? clipboard.favorites
        : parseJsonArray(readWorkspaceBagValue('notch-clip-favorites')),
    },
    recordings: recordings.map((row) => {
      if (!row || row.isDraft) return row;
      return {
        ...row,
        audioBase64: readOptionalFileBase64(getSafeRecordingPath(row.audioPath), 8 * 1024 * 1024),
      };
    }),
    aiSettings: {
      apiKey: decryptStoredSecret(storedAi.encryptedApiKey),
      llmApiKey: decryptStoredSecret(storedAi.encryptedLlmApiKey),
      workspaceId: String(storedAi.workspaceId || ''),
      region: String(storedAi.region || ''),
      llmBaseUrl: String(storedAi.llmBaseUrl || ''),
      llmModel: String(storedAi.llmModel || ''),
      hasStoredSecret: Boolean(storedAi.encryptedApiKey || storedAi.encryptedLlmApiKey),
    },
    secrets: readCredentialsVault(),
  };
}

function writeSyncedBytes(directory, fileName, base64) {
  if (!base64) return '';
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return '';
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, fileName);
  fs.writeFileSync(target, buffer);
  return target;
}

function writeSyncedAiSettings(plain) {
  const previous = readStoredTranscriptionSettings();
  const next = { ...previous };
  if (plain.apiKey) {
    const encrypted = encryptStoredSecret(plain.apiKey);
    if (encrypted) next.encryptedApiKey = encrypted;
  } else if (plain.apiKey === '') {
    next.encryptedApiKey = '';
  }
  if (plain.llmApiKey) {
    const encrypted = encryptStoredSecret(plain.llmApiKey);
    if (encrypted) next.encryptedLlmApiKey = encrypted;
  } else if (plain.llmApiKey === '') {
    next.encryptedLlmApiKey = '';
  }
  if (plain.workspaceId != null) next.workspaceId = String(plain.workspaceId || '');
  if (plain.region) next.region = String(plain.region);
  if (plain.llmBaseUrl) next.llmBaseUrl = String(plain.llmBaseUrl);
  if (plain.llmModel) next.llmModel = String(plain.llmModel);
  try {
    const target = getTranscriptionSettingsPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(next), { mode: 0o600 });
  } catch (error) {
    // 磁盘写入失败时保留原来的转写配置。
  }
}

function materializeWorkspaceSnapshot(projected, previousSnapshot) {
  const snapshot = projected.snapshot;
  const previous = previousSnapshot && typeof previousSnapshot === 'object' ? previousSnapshot : {};
  const previousRecordings = Array.isArray(previous.recordings) ? previous.recordings : [];
  const previousClips = previous.clipboard && Array.isArray(previous.clipboard.history)
    ? previous.clipboard.history
    : [];
  const renderer = {
    notes: snapshot.notes,
    links: snapshot.links,
    commands: snapshot.commands,
    clipboard: { history: [], favorites: snapshot.clipboard.favorites },
    recordings: [],
  };
  for (const item of snapshot.clipboard.history) {
    const next = {
      id: item.id,
      type: item.type,
      text: item.text,
      timestamp: item.timestamp,
      imagePath: '',
    };
    if (item.type === 'image' && item.imageBase64) {
      const clean = String(item.id || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
      const absolute = writeSyncedBytes(getClipImagesDir(), `clip-${clean || 'sync'}.png`, item.imageBase64);
      if (absolute) next.imagePath = platformPolicy.portableMediaPath(CLIP_IMAGES_DIR_NAME, absolute);
    } else if (item.type === 'image') {
      const prior = previousClips.find((row) => row && row.id === item.id);
      if (prior && prior.imagePath) next.imagePath = prior.imagePath;
    }
    renderer.clipboard.history.push(next);
  }
  for (const recording of snapshot.recordings) {
    const next = { ...recording };
    delete next.audioBase64;
    if (recording.audioBase64) {
      const clean = String(recording.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
      const fileName = `recording-${clean || 'sync'}.${recordingExtension(recording.mimeType)}`;
      const absolute = writeSyncedBytes(getRecordingsDir(), fileName, recording.audioBase64);
      if (absolute) next.audioPath = platformPolicy.portableMediaPath(RECORDINGS_DIR_NAME, absolute);
    } else {
      const prior = previousRecordings.find((row) => row && row.id === recording.id);
      if (prior && prior.audioPath) next.audioPath = prior.audioPath;
    }
    renderer.recordings.push(next);
  }
  if (projected.secretsApplied) {
    const rows = snapshot.secrets
      .map((item) => normalizeCredentialInput(item, item && item.id, item && item.createdAt))
      .filter(Boolean);
    writeCredentialsVault(rows);
  }
  if (projected.aiApplied && snapshot.aiSettings) {
    writeSyncedAiSettings(snapshot.aiSettings);
  }
  return renderer;
}

function broadcastWorkspaceProjection(projection) {
  if (!projection || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('sync:workspace-projection', projection);
}

async function ensureAccountSyncKey(record) {
  if (record && typeof record.accountSyncKey === 'string' && record.accountSyncKey) {
    return record.accountSyncKey;
  }
  const res = await fetchBoundSyncJson('api/v1/account/sync-key');
  const key = res.ok && res.body ? res.body.accountSyncKey : '';
  if (!key || !record) return null;
  const saved = syncCredentialsStore.save({ ...record, accountSyncKey: key });
  if (!saved.ok) return null;
  record.accountSyncKey = key;
  return key;
}

async function readRendererWorkspaceSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const value = await mainWindow.webContents.executeJavaScript(
      'window.getWorkspaceSnapshotForSync ? window.getWorkspaceSnapshotForSync() : null',
      true,
    );
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

async function pushWorkspaceMutations(record, entities) {
  if (!entities || !entities.length) return { ok: true, pushed: 0 };
  const transport = createTodosSyncTransport(record);
  const mutations = entities.map((entity) => mutationFromEntity(entity, { deviceId: record.deviceId }));
  let pushed = 0;
  for (const batch of splitMutationBatches(mutations)) {
    const result = await transport.pushMutations(batch);
    if (!result || result.ok !== true) {
      return { ok: false, error: (result && result.error) || 'push_failed', pushed };
    }
    pushed += batch.length;
  }
  return { ok: true, pushed };
}

async function pullWorkspaceChanges(ctx) {
  const transport = createTodosSyncTransport(ctx.record);
  const remoteChanges = [];
  for (const collection of WORKSPACE_COLLECTIONS) {
    let cursor = ctx.store.getPullCursor(ctx.accountId, collection).cursor;
    for (let guard = 0; guard < 40; guard += 1) {
      const remote = await transport.pullPage({ cursor, collection });
      if (!remote || remote.ok !== true) {
        return { ok: false, error: (remote && remote.error) || 'pull_failed' };
      }
      const body = remote.body || {};
      const normalized = {
        changes: Array.isArray(body.changes) ? body.changes : [],
        nextCursor: Object.prototype.hasOwnProperty.call(body, 'nextCursor') ? body.nextCursor : null,
        hasMore: body.hasMore === true,
        serverRev: Number(body.serverRev) || 0,
      };
      const applied = ctx.store.applyPullPage({
        accountId: ctx.accountId,
        collection,
        pull: normalized,
      });
      if (!applied.ok) return { ok: false, error: applied.reason || 'apply_failed' };
      for (const change of normalized.changes) {
        if (!change) continue;
        if (change.collection && change.collection !== collection) continue;
        remoteChanges.push({ ...change, collection: change.collection || collection });
      }
      if (!normalized.hasMore) break;
      cursor = normalized.nextCursor;
    }
  }
  return { ok: true, remoteChanges };
}

async function runBoundWorkspaceSyncCycle() {
  if (!fs.existsSync(workspaceIndexPath())) {
    return { ok: true, skipped: true };
  }
  const ctx = readBoundSyncContext();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const accountKey = await ensureAccountSyncKey(ctx.record);
  const rendererSnapshot = await readRendererWorkspaceSnapshot();
  const snapshot = assembleWorkspaceSnapshot(rendererSnapshot);
  const built = buildWorkspaceEntities(snapshot, { accountKey });
  const pulled = await pullWorkspaceChanges(ctx);
  if (!pulled.ok) return pulled;
  const plan = planWorkspaceSync({
    index: readWorkspaceIndex(),
    localEntities: built.entities,
    remoteChanges: pulled.remoteChanges,
  });
  if (pulled.remoteChanges.length) {
    const projected = projectWorkspaceEntities(plan.mergedEntities, { accountKey });
    broadcastWorkspaceProjection(materializeWorkspaceSnapshot(projected, snapshot));
  }
  if (plan.toPush.length) {
    const pushed = await pushWorkspaceMutations(ctx.record, plan.toPush);
    if (!pushed.ok) return pushed;
  }
  writeWorkspaceIndex(plan.nextIndex);
  return { ok: true, pushed: plan.toPush.length, pulled: pulled.remoteChanges.length };
}

function readWorkspaceTodosRaw() {
  const payload = readJsonFile(workspacePath(WORKSPACE_DATA_FILE), {});
  const stored = payload && payload.localStorage && payload.localStorage['notch-todo-data'];
  return typeof stored === 'string' ? stored : null;
}

function resolveMigrationLocalTodos(fromRenderer) {
  return selectMigrationLocalTodos(fromRenderer, readWorkspaceTodosRaw());
}

function classifyBoundWorkspace(localTodosJson, rendererWorkspace, nasState) {
  const local = parseLocalTodosStrict(
    localTodosJson == null || localTodosJson === '' ? null : String(localTodosJson),
  );
  if (!local.ok) {
    return {
      local,
      snapshot: null,
      counts: null,
      decision: classifyFromLocalAndNas(String(localTodosJson || ''), nasState),
    };
  }
  const snapshot = assembleWorkspaceSnapshot(rendererWorkspace);
  const counts = countWorkspaceContent(snapshot, { todoLive: local.live });
  return {
    local,
    snapshot,
    counts,
    decision: classifyMigrationDecision({
      localOk: true,
      localCorrupt: false,
      localLive: counts.total,
      nas: nasState,
    }),
  };
}

function latestWorkspaceChanges(changes) {
  const map = new Map();
  for (const change of changes || []) {
    if (!change || !change.entityId) continue;
    map.set(change.entityId, change);
  }
  return [...map.values()].filter((change) => (
    change.collection
    && change.collection !== 'todos'
    && change.op !== 'delete'
    && change.payload
  )).map((change) => ({
    entityId: change.entityId,
    collection: change.collection,
    op: 'upsert',
    payload: change.payload,
  }));
}

ipcMain.handle('sync:classify-migration', async (event, payload = {}) => {
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) return { ok: false, error: 'not_bound' };
  const selected = resolveMigrationLocalTodos(payload.localTodosJson);
  const localTodosJson = selected.raw;
  const local = parseLocalTodosStrict(
    localTodosJson == null || localTodosJson === '' ? null : String(localTodosJson),
  );
  const stateRes = await fetchBoundSyncJson('api/v1/sync/state?collection=todos');
  if (!stateRes.ok) return stateRes;
  const classified = classifyBoundWorkspace(localTodosJson, payload.workspace, stateRes.body);
  if (!classified.decision.ok) return { ok: false, error: classified.decision.reason || 'classify_failed' };
  return {
    ok: true,
    decision: classified.decision,
    localLive: classified.counts ? classified.counts.total : (classified.local.ok ? classified.local.live : 0),
    localCorrupt: Boolean(classified.local.corrupt),
    nas: stateRes.body,
  };
});

ipcMain.handle('sync:run-migration', async (event, payload = {}) => {
  const status = syncCredentialsStore.getStatus();
  if (!status.bound) return { ok: false, error: 'not_bound' };

  const localTodosJson = resolveMigrationLocalTodos(payload.localTodosJson).raw;
  const classify = await fetchBoundSyncJson('api/v1/sync/state?collection=todos');
  if (!classify.ok) return classify;
  const classified = classifyBoundWorkspace(localTodosJson, payload.workspace, classify.body);
  const decision = classified.decision;
  if (!decision.ok) {
    return { ok: false, error: decision.reason || 'classify_failed' };
  }
  if (decision.decision === 'block_corrupt_local') {
    return { ok: false, error: 'local_corrupt', message: decision.message, decision };
  }

  let authority = decision.authority || null;
  if (decision.needsUserChoice) {
    const resolved = resolveMigrationChoice(decision.decision, payload.choice);
    if (!resolved.ok) {
      setMigrationSession({ readonly: true, phase: 'awaiting_choice', lastError: null });
      return { ok: false, error: 'choice_required', decision };
    }
    authority = resolved.authority;
  }

  setMigrationSession({ readonly: true, phase: 'migrating', lastError: null, pendingProjection: null });

  const accountId = String(status.uid || status.deviceId || 'local');
  const store = getOrOpenSyncStore();
  store.ensureAccount({
    accountId,
    uid: status.uid,
    serverId: status.serverId,
    deviceId: status.deviceId,
  });

  const api = {
    async startMigration(body) {
      const res = await fetchBoundSyncJson('api/v1/migration/start', {
        method: 'POST',
        body: body || {},
      });
      if (!res.ok) throw new Error(res.error || 'migration_start_failed');
      return res.body;
    },
    async commitMigration(body) {
      const res = await fetchBoundSyncJson('api/v1/migration/commit', {
        method: 'POST',
        body,
        timeoutMs: 60000,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: res.error,
          status: res.status,
          body: res.body,
        };
      }
      return { ok: true, body: res.body, status: res.status };
    },
    async getMigration(id) {
      const res = await fetchBoundSyncJson(`api/v1/migration/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(res.error || 'migration_get_failed');
      return res.body;
    },
    async pullAll() {
      let cursor = '';
      const changes = [];
      let serverRev = 0;
      for (let guard = 0; guard < 40; guard += 1) {
        const apiPath = cursor
          ? `api/v1/sync/pull?cursor=${encodeURIComponent(cursor)}`
          : 'api/v1/sync/pull?cursor=';
        const res = await fetchBoundSyncJson(apiPath, { timeoutMs: 60000 });
        if (!res.ok) throw new Error(res.error || 'pull_failed');
        const body = res.body || {};
        if (Array.isArray(body.changes)) changes.push(...body.changes);
        serverRev = Number(body.serverRev) || serverRev;
        if (body.hasMore !== true) {
          return { changes, serverRev, hasMore: false, nextCursor: body.nextCursor == null ? null : body.nextCursor };
        }
        cursor = body.nextCursor == null ? '' : String(body.nextCursor);
        if (!cursor) break;
      }
      return { changes, serverRev, hasMore: false };
    },
  };

  const credential = syncCredentialsStore.read();
  const record = credential && credential.record ? credential.record : null;
  const accountKey = record ? await ensureAccountSyncKey(record) : null;
  let builtEntities = [];
  let deferredEntities = [];
  let inlineEntities = [];
  if (authority === 'local' && classified.snapshot) {
    const built = buildWorkspaceEntities(classified.snapshot, { accountKey });
    const parts = partitionEntities(built.entities);
    builtEntities = built.entities;
    deferredEntities = parts.deferred;
    inlineEntities = parts.inline;
  }

  let appliedProjection = null;
  let result;
  try {
    result = await runMigrationAttempt({
      decision,
      authority,
      localRaw: localTodosJson,
      extraEntities: authority === 'local' ? inlineEntities : [],
      userDataPath: app.getPath('userData'),
      accountId,
      deviceId: status.deviceId,
      api,
      store,
      applyLocalProjection(todosJson) {
        appliedProjection = todosJson;
      },
    });
  } catch (error) {
    setMigrationSession({
      readonly: false,
      phase: 'failed',
      lastError: error && error.message ? error.message : 'migration_failed',
    });
    return { ok: false, error: error && error.message ? error.message : 'migration_failed' };
  }

  if (!result.ok) {
    setMigrationSession({
      readonly: false,
      phase: 'failed',
      migrationId: result.migrationId || null,
      lastError: result.error || 'migration_failed',
      pendingProjection: appliedProjection,
    });
    return result;
  }

  let workspaceProjection = null;
  if (result.skipped) {
    writeWorkspaceIndex(readWorkspaceIndex());
  } else if (authority === 'local') {
    if (record && deferredEntities.length) {
      const pushed = await pushWorkspaceMutations(record, deferredEntities);
      if (!pushed.ok) {
        setMigrationSession({
          readonly: false,
          phase: 'failed',
          migrationId: result.migrationId || null,
          lastError: pushed.error || 'workspace_push_failed',
          pendingProjection: appliedProjection,
        });
        return { ok: false, error: pushed.error || 'workspace_push_failed', migrationId: result.migrationId };
      }
    }
    writeWorkspaceIndex(hashesForEntities(builtEntities));
  } else if (!result.skipped && (authority === 'nas' || result.authority === 'nas')) {
    const workspaceEntities = latestWorkspaceChanges(result.remoteChanges);
    const projected = projectWorkspaceEntities(workspaceEntities, { accountKey });
    workspaceProjection = materializeWorkspaceSnapshot(projected, classified.snapshot);
    broadcastWorkspaceProjection(workspaceProjection);
    writeWorkspaceIndex(hashesForEntities(workspaceEntities));
  }

  setMigrationSession({
    readonly: false,
    phase: 'done',
    migrationId: result.migrationId || null,
    lastError: null,
    pendingProjection: appliedProjection,
  });
  return {
    ...result,
    projectionJson: appliedProjection,
    workspaceProjection,
    session: broadcastMigrationSession(),
  };
});

ipcMain.handle('sync:ack-migration-projection', () => {
  migrationSession.pendingProjection = null;
  return { ok: true };
});

ipcMain.handle('sync:restore-migration-backup', async (event, payload = {}) => {
  if (payload.confirmed !== true) {
    return { ok: false, error: 'confirm_required' };
  }
  const userDataPath = app.getPath('userData');
  const root = resolveSyncBackupsRoot(userDataPath);
  let applied = null;
  const result = restoreLatestMigrationBackup(userDataPath, {
    applyLocalProjection(todosJson) {
      applied = todosJson;
    },
  });
  if (!result.ok) return result;
  if (result.path && !isInsideSyncBackupDir(root, result.path)) {
    return { ok: false, error: 'backup_path_escape' };
  }
  setMigrationSession({
    readonly: false,
    phase: 'idle',
    lastError: null,
    pendingProjection: applied,
  });
  return { ...result, projectionJson: applied };
});

ipcMain.handle('cursor:usage', async (_event, options = {}) => {
  try {
    return await fetchCursorUsage({
      force: options && options.force === true,
      manualToken: readCursorManualToken(),
    });
  } catch (error) {
    return { ok: false, error: 'cursor_usage_failed', detail: String(error && error.message || error), fetchedAt: new Date().toISOString() };
  }
});

ipcMain.handle('cursor:token-status', () => cursorTokenStatus());

ipcMain.handle('cursor:set-token', (_event, token) => writeCursorManualToken(token));

ipcMain.handle('cursor:clear-token', () => writeCursorManualToken(''));

// 汽水音乐只有 Mac 适配层实现（D4）：Windows 上 adapter.music 缺席，一律回 unsupported。
function musicUnsupported() {
  return !platformCapabilities.features.musicControl || !platformAdapter.music;
}

ipcMain.handle('music:status', async () => {
  if (musicUnsupported()) {
    return { installed: false, running: false, sessionActive: false, playing: false, title: '', artist: '', icon: null };
  }
  return platformAdapter.music.status();
});

ipcMain.handle('music:control', async (event, action) => {
  if (musicUnsupported()) return { ok: false, error: 'unsupported' };
  const result = await platformAdapter.music.control(action);
  if (result && result.ok && mainWindow && !mainWindow.isDestroyed() && currentMode === 'expanded') {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  return result;
});

// ============ 百炼实时语音转写 ============
function getTranscriptionSettingsPath() {
  return path.join(app.getPath('userData'), TRANSCRIPTION_SETTINGS_FILE);
}

function readStoredTranscriptionSettings() {
  const currentPath = getTranscriptionSettingsPath();
  const legacyPath = path.join(app.getPath('appData'), 'notch-todo', TRANSCRIPTION_SETTINGS_FILE);
  const readSettings = (settingsPath) => {
    try {
      const value = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      return {};
    }
  };
  const current = readSettings(currentPath);
  const legacy = currentPath === legacyPath ? {} : readSettings(legacyPath);
  const selected = selectTranscriptionSettings(current, legacy);
  if (!Object.keys(current).length && Object.keys(selected).length && currentPath !== legacyPath) {
    try {
      fs.mkdirSync(path.dirname(currentPath), { recursive: true });
      fs.writeFileSync(currentPath, JSON.stringify(selected), { mode: 0o600 });
    } catch (error) {
      // 迁移失败时仍从旧目录读取，避免已有密钥突然失效。
    }
  }
  return selected;
}

function decryptStoredApiKey(settings) {
  const environmentKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (environmentKey) return environmentKey;
  return decryptStoredSecret(settings.encryptedApiKey).trim();
}

function decryptStoredSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
  } catch (error) {
    return '';
  }
}

function encryptStoredSecret(plain) {
  const value = String(plain || '');
  if (!value || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.encryptString(value).toString('base64');
  } catch (error) {
    return '';
  }
}

function readCursorManualToken() {
  const settings = readAppSettings();
  return decryptStoredSecret(settings.encryptedCursorToken).trim();
}

function cursorTokenStatus() {
  const configured = Boolean(readCursorManualToken());
  return {
    ok: true,
    configured,
    secureStorage: safeStorage.isEncryptionAvailable(),
    label: configured ? '已配置手动 Token' : '未配置 · 使用本机登录',
    state: configured ? 'saved' : 'empty',
  };
}

function writeCursorManualToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'secure_storage_unavailable' };
  }
  const next = readAppSettings();
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    next.encryptedCursorToken = '';
  } else {
    const encrypted = encryptStoredSecret(trimmed);
    if (!encrypted) return { ok: false, error: 'encrypt_failed' };
    next.encryptedCursorToken = encrypted;
  }
  if (!saveAppSettings(next)) return { ok: false, error: 'save_failed' };
  return { ...cursorTokenStatus() };
}

function resolveLlmConfig() {
  const settings = readStoredTranscriptionSettings();
  return {
    apiKey: String(process.env.NOTCH_LLM_API_KEY || decryptStoredSecret(settings.encryptedLlmApiKey)).trim(),
    baseUrl: String(settings.llmBaseUrl || 'https://api.deepseek.com').trim(),
    model: String(settings.llmModel || 'deepseek-v4-flash').trim(),
  };
}

function resolveTranscriptionConfig() {
  const settings = readStoredTranscriptionSettings();
  const environmentWorkspace = String(process.env.DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE || '').trim();
  const environmentRegion = String(process.env.DASHSCOPE_REGION || '').trim().toLowerCase();
  const region = ['beijing', 'singapore'].includes(environmentRegion)
    ? environmentRegion
    : ['beijing', 'singapore'].includes(settings.region) ? settings.region : 'beijing';
  const workspaceId = (environmentWorkspace || String(settings.workspaceId || '').trim()).slice(0, 128);
  return {
    apiKey: decryptStoredApiKey(settings),
    workspaceId: /^[A-Za-z0-9_-]{0,128}$/.test(workspaceId) ? workspaceId : '',
    region,
  };
}

function publicTranscriptionConfig() {
  const config = resolveTranscriptionConfig();
  const llmConfig = resolveLlmConfig();
  const settings = readStoredTranscriptionSettings();
  return {
    configured: Boolean(config.apiKey),
    asrNeedsReentry: Boolean(settings.encryptedApiKey && !config.apiKey),
    workspaceId: config.workspaceId,
    region: config.region,
    provider: 'qwen3-asr-flash-realtime',
    secureStorage: safeStorage.isEncryptionAvailable(),
    llmConfigured: Boolean(llmConfig.apiKey),
    llmNeedsReentry: Boolean(settings.encryptedLlmApiKey && !llmConfig.apiKey),
    llmBaseUrl: String(settings.llmBaseUrl || 'https://api.deepseek.com'),
    llmModel: String(settings.llmModel || 'deepseek-v4-flash'),
  };
}

function transcriptionUrl(config) {
  const host = config.workspaceId
    ? config.region === 'singapore'
      ? `${config.workspaceId}.ap-southeast-1.maas.aliyuncs.com`
      : `${config.workspaceId}.cn-beijing.maas.aliyuncs.com`
    : config.region === 'singapore'
      ? 'dashscope-intl.aliyuncs.com'
      : 'dashscope.aliyuncs.com';
  return `wss://${host}/api-ws/v1/realtime?model=${TRANSCRIPTION_MODEL}&heartbeat=true`;
}

function transcriptionEventId() {
  return `event_${crypto.randomUUID().replace(/-/g, '')}`;
}

function emitTranscription(session, payload) {
  if (session.sender && !session.sender.isDestroyed()) {
    session.sender.send('transcription:event', payload);
  }
}

function sessionTranscript(session) {
  return [...session.finalSegments, session.interim].filter(Boolean).join(' ').trim();
}

function closeTranscriptionSession(session, result = {}) {
  if (!session || session.closed) return;
  session.closed = true;
  clearTimeout(session.connectTimer);
  clearTimeout(session.finishTimer);
  clearTimeout(session.retryTimer);
  clearTimeout(session.heartbeatTimer);
  if (transcriptionSessions.get(session.senderId) === session) transcriptionSessions.delete(session.senderId);
  session.settleStart?.({ ok: false, error: result.error || 'connection_closed' });
  session.audioQueue = [];
  try { session.socket?.terminate(); } catch (error) {}
  if (session.finishResolve) {
    session.finishResolve({
      ok: result.ok !== false,
      transcript: sessionTranscript(session),
      error: result.error || null,
    });
    session.finishResolve = null;
  }
}

function handleTranscriptionMessage(session, raw) {
  let message;
  try { message = JSON.parse(String(raw)); } catch (error) { return; }
  if (message.type === 'session.updated') {
    session.ready = true;
    session.retryCount = 0;
    session.lastError = '';
    clearTimeout(session.connectTimer);
    session.settleStart({ ok: true });
    emitTranscription(session, { type: 'status', status: 'connected' });
    flushTranscriptionAudio(session);
    return;
  }
  if (message.type === 'conversation.item.input_audio_transcription.text') {
    session.interim = `${String(message.text || '').trim()}${String(message.stash || '').trim()}`;
    emitTranscription(session, {
      type: 'transcript',
      final: session.finalSegments.join(' ').trim(),
      interim: session.interim,
    });
    return;
  }
  if (message.type === 'conversation.item.input_audio_transcription.completed') {
    const transcript = String(message.transcript || '').trim();
    if (transcript && (!message.item_id || !session.completedItems.has(message.item_id))) {
      session.finalSegments.push(transcript);
      if (message.item_id) session.completedItems.add(message.item_id);
    }
    session.interim = '';
    emitTranscription(session, {
      type: 'transcript',
      final: session.finalSegments.join(' ').trim(),
      interim: '',
    });
    return;
  }
  if (message.type === 'error' || message.type === 'conversation.item.input_audio_transcription.failed') {
    const details = message.error && message.error.message || '实时转写服务返回错误';
    reconnectTranscription(session, details);
    return;
  }
  if (message.type === 'session.finished') {
    if (session.finishResolve) closeTranscriptionSession(session, { ok: !session.audioGap, error: session.audioGap ? 'audio_gap' : null });
    else reconnectTranscription(session, 'session_finished');
  }
}

function reconnectTranscription(session, error) {
  if (session.closed || session.retryTimer) return;
  session.lastError = error;
  session.ready = false;
  clearTimeout(session.connectTimer);
  clearTimeout(session.heartbeatTimer);
  const socket = session.socket;
  session.socket = null; // Ignore late close/error/transcript events from the old connection.
  try { socket?.terminate(); } catch (ignored) {}
  if (session.finishResolve) {
    closeTranscriptionSession(session, { ok: false, error });
    return;
  }
  // Preserve the last partial sentence when the server can no longer finalize it.
  if (session.interim) session.finalSegments.push(session.interim);
  session.interim = '';
  emitTranscription(session, { type: 'transcript', final: sessionTranscript(session), interim: '' });
  if (session.retryCount >= 5) {
    emitTranscription(session, { type: 'error', message: error });
    closeTranscriptionSession(session, { ok: false, error });
    return;
  }
  emitTranscription(session, { type: 'status', status: 'reconnecting' });
  const delay = Math.min(1000 * 2 ** session.retryCount++, 15000);
  session.retryTimer = setTimeout(() => {
    session.retryTimer = null;
    connectTranscriptionSocket(session);
  }, delay);
}

function flushTranscriptionAudio(session) {
  while (session.ready && session.socket?.readyState === WebSocket.OPEN && session.audioQueue.length) {
    const buffer = session.audioQueue[0];
    // Bound ws's own outgoing queue as well as our reconnect buffer.
    if (session.socket.bufferedAmount > 16000 * 2 * 30) {
      reconnectTranscription(session, 'audio_backpressure');
      return;
    }
    try {
      session.socket.send(JSON.stringify({
        event_id: transcriptionEventId(), type: 'input_audio_buffer.append', audio: buffer.toString('base64'),
      }));
    } catch (error) {
      reconnectTranscription(session, 'audio_send_failed');
      return;
    }
    session.audioQueue.shift();
    session.queuedBytes -= buffer.length;
  }
}

function connectTranscriptionSocket(session) {
  if (session.closed) return;
  const socket = new WebSocket(transcriptionUrl(session.config), { headers: session.headers });
  session.socket = socket;
  session.completedItems = new Set();
  const active = () => !session.closed && session.socket === socket;
  session.connectTimer = setTimeout(() => {
    if (active()) reconnectTranscription(session, 'connect_timeout');
  }, 8000);
  socket.on('open', () => {
    if (!active()) return;
    try {
      socket.send(JSON.stringify({
        event_id: transcriptionEventId(), type: 'session.update',
        session: {
          input_audio_format: 'pcm', sample_rate: TRANSCRIPTION_SAMPLE_RATE,
          input_audio_transcription: { language: 'zh' },
          turn_detection: { type: 'server_vad', threshold: 0, silence_duration_ms: 400 },
        },
      }));
    } catch (error) { reconnectTranscription(session, 'configuration_send_failed'); return; }
    let awaitingPong = false;
    socket.on('pong', () => { awaitingPong = false; });
    const heartbeat = () => {
      if (!active()) return;
      if (awaitingPong) { reconnectTranscription(session, 'heartbeat_timeout'); return; }
      awaitingPong = true;
      try { socket.ping(); } catch (error) { reconnectTranscription(session, 'heartbeat_failed'); return; }
      session.heartbeatTimer = setTimeout(heartbeat, 15000);
    };
    session.heartbeatTimer = setTimeout(heartbeat, 15000);
  });
  socket.on('message', (data) => { if (active()) handleTranscriptionMessage(session, data); });
  socket.on('error', (error) => {
    if (active()) reconnectTranscription(session, String(error?.message || 'connection_failed'));
  });
  socket.on('close', (code) => {
    if (active()) reconnectTranscription(session, `connection_closed_${code}`);
  });
}

ipcMain.handle('transcription:get-config', () => publicTranscriptionConfig());

ipcMain.handle('transcription:set-config', (event, payload) => {
  const previous = readStoredTranscriptionSettings();
  const region = payload && payload.region === 'singapore' ? 'singapore' : 'beijing';
  const workspaceId = String(payload && payload.workspaceId || '').trim();
  const apiKey = String(payload && payload.apiKey || '').trim();
  const llmApiKey = String(payload && payload.llmApiKey || '').trim();
  const llmBaseUrl = String(payload && payload.llmBaseUrl || previous.llmBaseUrl || 'https://api.deepseek.com').trim();
  const llmModel = String(payload && payload.llmModel || previous.llmModel || 'deepseek-v4-flash').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (workspaceId && !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) {
    return { ok: false, error: 'invalid_workspace' };
  }
  let parsedLlmUrl;
  try { parsedLlmUrl = new URL(llmBaseUrl); } catch (error) { parsedLlmUrl = null; }
  if (!parsedLlmUrl || parsedLlmUrl.protocol !== 'https:' || parsedLlmUrl.username || parsedLlmUrl.password) {
    return { ok: false, error: 'invalid_llm_url' };
  }
  if ((apiKey || llmApiKey) && !safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'secure_storage_unavailable' };
  }
  const next = {
    region,
    workspaceId,
    encryptedApiKey: apiKey
      ? safeStorage.encryptString(apiKey).toString('base64')
      : String(previous.encryptedApiKey || ''),
    llmBaseUrl: parsedLlmUrl.toString().replace(/\/$/, ''),
    llmModel,
    encryptedLlmApiKey: llmApiKey
      ? safeStorage.encryptString(llmApiKey).toString('base64')
      : String(previous.encryptedLlmApiKey || ''),
  };
  try {
    fs.writeFileSync(getTranscriptionSettingsPath(), JSON.stringify(next), { mode: 0o600 });
    return { ok: true, ...publicTranscriptionConfig() };
  } catch (error) {
    return { ok: false, error: 'save_failed' };
  }
});

ipcMain.handle('transcription:start', (event) => {
  const config = resolveTranscriptionConfig();
  if (!config.apiKey) return { ok: false, error: 'not_configured' };
  const existing = transcriptionSessions.get(event.sender.id);
  if (existing) closeTranscriptionSession(existing, { ok: false, error: 'replaced' });
  return new Promise((resolve) => {
    const headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
      'User-Agent': 'DynamicPanel/0.3',
    };
    if (config.workspaceId) headers['X-DashScope-WorkSpace'] = config.workspaceId;
    const session = {
      sender: event.sender, senderId: event.sender.id, config, headers,
      socket: null, finalSegments: [], interim: '', ready: false, closed: false,
      startSettled: false, finishResolve: null, connectTimer: null, finishTimer: null,
      retryTimer: null, heartbeatTimer: null, retryCount: 0, lastError: '',
      audioQueue: [], queuedBytes: 0, audioGap: false, completedItems: new Set(),
    };
    transcriptionSessions.set(event.sender.id, session);
    session.settleStart = (result) => {
      if (session.startSettled) return;
      session.startSettled = true;
      resolve(result);
    };
    connectTranscriptionSocket(session);
  });
});

ipcMain.on('transcription:audio', (event, bytes) => {
  const session = transcriptionSessions.get(event.sender.id);
  if (!session || session.closed || session.finishResolve) return;
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
  if (!buffer.length || buffer.length > 512 * 1024) return;
  session.audioQueue.push(buffer);
  session.queuedBytes += buffer.length;
  // 30 seconds of 16 kHz mono PCM16; the full recording still stays on disk.
  while (session.queuedBytes > TRANSCRIPTION_SAMPLE_RATE * 2 * 30) {
    session.queuedBytes -= session.audioQueue.shift().length;
    if (!session.audioGap) {
      session.audioGap = true;
      emitTranscription(session, { type: 'warning', code: 'audio_gap' });
    }
  }
  flushTranscriptionAudio(session);
});

ipcMain.handle('transcription:finish', (event) => {
  const session = transcriptionSessions.get(event.sender.id);
  if (!session || session.closed) return { ok: false, error: 'not_active', transcript: '' };
  if (session.finishResolve) return { ok: false, error: 'already_finishing', transcript: sessionTranscript(session) };
  return new Promise((resolve) => {
    session.finishResolve = resolve;
    session.finishTimer = setTimeout(() => {
      closeTranscriptionSession(session, { ok: false, error: 'finish_timeout' });
    }, TRANSCRIPTION_FINISH_TIMEOUT_MS);
    if (session.ready && session.socket?.readyState === WebSocket.OPEN) {
      try {
        session.socket.send(JSON.stringify({ event_id: transcriptionEventId(), type: 'session.finish' }));
      } catch (error) {
        closeTranscriptionSession(session, { ok: false, error: 'finish_send_failed' });
      }
    } else {
      closeTranscriptionSession(session, { ok: false, error: 'connection_closed' });
    }
  });
});

function closeAllTranscriptionSessions() {
  for (const session of transcriptionSessions.values()) {
    closeTranscriptionSession(session, { ok: false, error: 'app_quit' });
  }
}

// ============ 录音资料库 ============
function getRecordingsDir() {
  return workspacePath(RECORDINGS_DIR_NAME);
}

function ensureRecordingsDir() {
  try {
    fs.mkdirSync(getRecordingsDir(), { recursive: true });
  } catch (error) {
    // 目录不可用时由保存 IPC 返回失败。
  }
}

function getSafeRecordingPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const directory = path.resolve(getRecordingsDir());
  const resolvedPath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceRoot(), value);
  if (path.dirname(resolvedPath) !== directory) return null;
  if (!/^recording-[a-z0-9-]+\.(webm|m4a|ogg|wav)$/i.test(path.basename(resolvedPath))) {
    return null;
  }
  try {
    const directoryStat = fs.lstatSync(directory);
    const fileStat = fs.lstatSync(resolvedPath);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolvedPath;
  } catch (error) {
    return null;
  }
}

ipcMain.handle('recordings:save', async (event, payload) => {
  if (!payload || !payload.bytes) return { ok: false, error: 'empty_audio' };
  let buffer;
  try {
    buffer = Buffer.from(payload.bytes);
  } catch (error) {
    return { ok: false, error: 'invalid_audio' };
  }
  if (!buffer.length || buffer.length > RECORDING_MAX_BYTES) {
    return { ok: false, error: buffer.length ? 'audio_too_large' : 'empty_audio' };
  }
  ensureRecordingsDir();
  const mimeType = String(payload.mimeType || 'audio/webm').slice(0, 80);
  const extension = recordingExtension(mimeType);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const audioPath = path.join(getRecordingsDir(), `recording-${id}.${extension}`);
  try {
    await fs.promises.writeFile(audioPath, buffer, { flag: 'wx' });
    return { ok: true, audioPath: platformPolicy.portableMediaPath(RECORDINGS_DIR_NAME, audioPath), mimeType };
  } catch (error) {
    return { ok: false, error: 'write_failed' };
  }
});

ipcMain.handle('recordings:read', async (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return null;
  try {
    const bytes = await fs.promises.readFile(safePath);
    const extension = path.extname(safePath).slice(1).toLowerCase();
    const mimeType = extension === 'm4a' ? 'audio/mp4' : `audio/${extension || 'webm'}`;
    return { bytes, mimeType };
  } catch (error) {
    return null;
  }
});

ipcMain.handle('recordings:delete', async (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  try {
    await fs.promises.unlink(safePath);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('recordings:reveal', (event, audioPath) => {
  const safePath = getSafeRecordingPath(audioPath);
  if (!safePath) return false;
  shell.showItemInFolder(safePath);
  return true;
});

// ============ 剪贴板历史 ============

function getClipImagesDir() {
  return workspacePath(CLIP_IMAGES_DIR_NAME);
}

// 图片记录使用扁平目录和固定文件名。拒绝子目录、符号链接和非普通文件，
// 避免 localStorage 被篡改后通过 ../ 或 symlink 读写目录外文件。
function getSafeClipImagePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  const dir = path.resolve(getClipImagesDir());
  const resolvedPath = path.isAbsolute(p)
    ? path.resolve(p)
    : path.resolve(workspaceRoot(), p);
  if (path.dirname(resolvedPath) !== dir) return null;
  if (!/^clip-[a-z0-9]+\.png$/i.test(path.basename(resolvedPath))) return null;
  try {
    const dirStat = fs.lstatSync(dir);
    const fileStat = fs.lstatSync(resolvedPath);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;
    return resolvedPath;
  } catch (e) {
    return null;
  }
}

function ensureClipImagesDir() {
  try {
    fs.mkdirSync(getClipImagesDir(), { recursive: true });
  } catch (e) {
    // 目录已存在或无权限，静默
  }
}

async function readSystemClipboard(includeImage = false) {
  try {
    const items = await clipboard.read();
    const observation = await readClipboardObservation(items, { includeImage });
    let image = null;
    if (observation.image?.buffer) {
      const native = nativeImage.createFromBuffer(observation.image.buffer);
      if (!native.isEmpty()) {
        const size = native.getSize();
        image = prepareClipboardImagePayload(
          observation.image.mimeType,
          observation.image.buffer,
          size
        );
      }
    }
    return { concealed: observation.concealed, text: observation.text, image };
  } catch (error) {
    return { concealed: false, text: '', image: null };
  }
}

async function baselineCurrentClipboard(generation) {
  try {
    const observation = await readSystemClipboard(true);
    if (!clipPollingEnabled || generation !== clipPollingGeneration) return;
    if (observation.concealed) {
      clipObservationState = reduceClipboardObservation(
        {},
        { concealed: true },
        { baseline: true }
      ).state;
      return;
    }
    clipObservationState = reduceClipboardObservation(
      {},
      { text: observation.text, imageFingerprint: observation.image?.fingerprint || null },
      { baseline: true }
    ).state;
    lastClipImageProbeAt = Date.now();
  } catch (error) {
    clipObservationState = { textFingerprint: null, imageFingerprint: null };
  }
}

async function pollClipboard() {
  if (!clipPollingEnabled || !mainWindow) return;
  if (clipPolling) return;
  clipPolling = true;
  try {
    const now = Date.now();
    const includeImage = now - lastClipImageProbeAt >= CLIP_IMAGE_POLL_INTERVAL_MS;
    const observation = await readSystemClipboard(includeImage);
    if (!clipPollingEnabled) return;
    // 密码管理器写入的敏感内容：跳过不记录、不更新指纹
    if (observation.concealed) return;

    // 优先读文字
    const text = observation.text;
    if (text) {
      const decision = reduceClipboardObservation(clipObservationState, { text });
      clipObservationState = decision.state;
      if (decision.record && clipPollingEnabled) {
        const type = /^https?:\/\//i.test(text.trim()) ? 'url' : 'text';
        mainWindow.webContents.send('clipboard:new-entry', { type, text, imagePath: null });
      }
      return;
    }

    // 文字为空再读图片
    if (!text && includeImage) {
      lastClipImageProbeAt = now;
      const result = observation.image;
      const decision = reduceClipboardObservation(clipObservationState, {
        text: '',
        imageFingerprint: result?.fingerprint || null,
      });
      clipObservationState = decision.state;
      if (result && decision.record && clipPollingEnabled) {
        const pngBuf = result.pngBuffer
          || nativeImage.createFromBuffer(result.sourceBuffer).toPNG();
        if (!pngBuf.length) return;
        ensureClipImagesDir();
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const fileName = 'clip-' + id + '.png';
        const imagePath = path.join(getClipImagesDir(), fileName);
        try {
          await fs.promises.writeFile(imagePath, pngBuf);
        } catch (e) {
          return; // 写盘失败不记录
        }
        if (!clipPollingEnabled) {
          try { await fs.promises.unlink(imagePath); } catch (error) {}
          return;
        }
        mainWindow.webContents.send('clipboard:new-entry', {
          type: 'image',
          text: null,
          imagePath: platformPolicy.portableMediaPath(CLIP_IMAGES_DIR_NAME, imagePath),
        });
      }
    }
  } catch (e) {
    // 轮询任何异常不能崩主进程，静默
  } finally {
    clipPolling = false;
  }
}

function startClipboardPolling() {
  // Electron 没有 NSPasteboard.changeCount，只能内容轮询：靠文本本身与
  // 图片 PNG 内容哈希指纹去重（见 pollClipboard）。
  if (clipPollingEnabled) return;
  clipPollingEnabled = true;
  const generation = ++clipPollingGeneration;
  // 首次开启只建立当前系统剪贴板基线，不把开启前的内容写入历史。
  clipBaselineTimer = setTimeout(() => {
    clipBaselineTimer = null;
    if (!clipPollingEnabled) return;
    void baselineCurrentClipboard(generation).finally(() => {
      if (clipPollingEnabled && generation === clipPollingGeneration && !clipPollTimer) {
        clipPollTimer = setInterval(pollClipboard, CLIP_POLL_INTERVAL_MS);
      }
    });
  }, 0);
}

function stopClipboardPolling() {
  clipPollingEnabled = false;
  clipPollingGeneration += 1;
  if (clipBaselineTimer) {
    clearTimeout(clipBaselineTimer);
    clipBaselineTimer = null;
  }
  if (clipPollTimer) {
    clearInterval(clipPollTimer);
    clipPollTimer = null;
  }
  clipObservationState = { textFingerprint: null, imageFingerprint: null };
  lastClipImageProbeAt = 0;
}

function setHoverSpaceShortcut(enabled) {
  if (enabled === spaceShortcutRegistered) return;
  if (!enabled) {
    if (globalShortcut.isRegistered('Space')) globalShortcut.unregister('Space');
    spaceShortcutRegistered = false;
    return;
  }
  try {
    const ok = globalShortcut.register('Space', async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // 展开动作后的极短窗口内，全局 Space 还未来得及注销；这时也要把第二次
      // Space 作为收起处理，避免快速连按被吞掉。
      if (currentMode === 'expanded') {
        mainWindow.webContents.send('shortcut:toggle-panel');
        return;
      }
      await rememberPasteTarget();
      hideWhenCollapsed = false;
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('shortcut:toggle-panel');
    });
    spaceShortcutRegistered = ok && globalShortcut.isRegistered('Space');
  } catch (error) {
    spaceShortcutRegistered = false;
  }
}

function startHoverSpaceShortcut() {
  const policy = hoverSpacePollingPolicy({
    shortcut: configuredShortcut,
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    mode: currentMode,
  });
  if (!policy.enabled) return;
  if (spaceShortcutTimer) return;
  spaceShortcutTimer = setInterval(() => {
    const currentPolicy = hoverSpacePollingPolicy({
      shortcut: configuredShortcut,
      visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
      mode: currentMode,
    });
    if (!currentPolicy.enabled) {
      stopHoverSpaceShortcut();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const hovering = point.x >= bounds.x && point.x < bounds.x + bounds.width
      && point.y >= bounds.y && point.y < bounds.y + bounds.height;
    setHoverSpaceShortcut(hovering);
  }, policy.intervalMs);
}

function stopHoverSpaceShortcut() {
  if (spaceShortcutTimer) clearInterval(spaceShortcutTimer);
  spaceShortcutTimer = null;
  setHoverSpaceShortcut(false);
}

function syncHoverSpacePolling() {
  const policy = hoverSpacePollingPolicy({
    shortcut: configuredShortcut,
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    mode: currentMode,
  });
  if (policy.enabled) startHoverSpaceShortcut();
  else stopHoverSpaceShortcut();
}

ipcMain.handle('shortcut:hover-space-status', () => ({
  registered: spaceShortcutRegistered && globalShortcut.isRegistered('Space'),
  mode: currentMode,
  cursor: screen.getCursorScreenPoint(),
  bounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
}));

// 渲染层请求把图片文件读成 dataURL 回显（contextIsolation 下 file:// 受限，走 IPC 读盘）
ipcMain.handle('clipboard:readImage', async (event, imagePath) => {
  const safePath = getSafeClipImagePath(imagePath);
  if (!safePath) return null; // 只允许读自己的图片目录
  try {
    const buf = await fs.promises.readFile(safePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

// FIFO 淘汰 / 删除 / 清空时，连带删除本地图片文件（文件 I/O 归主进程）
ipcMain.handle('clipboard:deleteImages', async (event, paths) => {
  if (!Array.isArray(paths)) return;
  for (const p of paths) {
    const safePath = getSafeClipImagePath(p);
    if (safePath) {
      try {
        await fs.promises.unlink(safePath);
      } catch (e) {
        // 文件已不存在等，静默
      }
    }
  }
});

async function writeClipboardEntry(entry) {
  if (!entry) return false;
  try {
    const safeImagePath =
      entry.type === 'image' ? getSafeClipImagePath(entry.imagePath) : null;
    if (safeImagePath) {
      const buf = fs.readFileSync(safeImagePath);
      const image = nativeImage.createFromBuffer(buf);
      if (image.isEmpty()) return false;
      const pngBuf = image.toPNG();
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([pngBuf], { type: 'image/png' }),
        }),
      ]);
      const size = image.getSize();
      const fingerprint = createClipboardImageFingerprint(size.width, size.height, pngBuf);
      if (fingerprint) {
        clipObservationState = reduceClipboardObservation(
          clipObservationState,
          { imageFingerprint: fingerprint },
          { baseline: true }
        ).state;
      }
    } else if (entry.text) {
      await clipboard.writeText(entry.text);
      clipObservationState = reduceClipboardObservation(
        clipObservationState,
        { text: entry.text },
        { baseline: true }
      ).state;
    } else {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function waitForCollapsedPanel(timeoutMs = 950) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (currentMode !== 'expanded' || Date.now() >= deadline) return resolve(currentMode !== 'expanded');
      setTimeout(check, 32);
    };
    check();
  });
}

ipcMain.handle('clipboard:write', (event, entry) => writeClipboardEntry(entry));

// 点击历史项后先收起灵动岛，再回到打开面板前的应用执行粘贴。
// 若系统尚未授予辅助功能权限，内容仍保留在系统剪贴板作为可靠降级。
ipcMain.handle('clipboard:paste', async (event, entry) => {
  if (!await writeClipboardEntry(entry)) return { ok: false, pasted: false };
  if (!platformCapabilities.features.automaticPaste) return { ok: true, pasted: false };
  if (platformAdapter.paste.permissionRequired()) {
    return { ok: true, pasted: false, permissionRequired: true };
  }
  const target = platformAdapter.paste.rememberedTarget();
  requestRendererCollapse();
  await waitForCollapsedPanel();
  // Windows 的失败原因要带给渲染层：elevated 得提示"管理员窗口请手动粘贴"，
  // target_gone / focus_failed 只说"已复制"（P4-1）。
  const result = await platformAdapter.paste.pasteTo(target);
  return pasteResultToIpc(result);
});

// 本应用自己写的数据文件：它们存在就说明这台机器上跑过旧版本。
// 必须在写入它们之前调用（见 whenReady 里的调用顺序）。
function hasExistingUserData() {
  const files = [
    getJsonSettingsPath(APP_SETTINGS_FILE),
    getJsonSettingsPath(WORKSPACE_SETTINGS_FILE),
    getJsonSettingsPath(CREDENTIALS_VAULT_FILE),
  ];
  try {
    files.push(workspacePath(WORKSPACE_DATA_FILE));
  } catch (e) {}
  return files.some((file) => {
    try {
      return fs.existsSync(file);
    } catch (e) {
      return false;
    }
  });
}

function ensureFirstRunAutoLaunch() {
  // 全新安装默认开启开机自启（D1）；升级用户只补写标记，保留他们在托盘里的选择（D13）。
  const marker = path.join(app.getPath('userData'), '.first-run-done');
  const plan = firstRunAutoLaunchPlan({
    supported: platformCapabilities.features.firstRunAutoLaunch === true,
    markerExists: fs.existsSync(marker),
    hasExistingUserData: hasExistingUserData(),
  });
  if (!plan.writeMarker) return plan;
  try {
    if (plan.enableAutoLaunch) setAutoLaunch(true);
    fs.writeFileSync(marker, String(Date.now()));
  } catch (e) {
    // ignore
  }
  return plan;
}

function watchDisplayChanges() {
  // 接/拔外接屏、改变屏幕排列、改分辨率 → 自动重新定位到当前活跃屏顶部居中
  // 加 100ms 防抖：插拔屏时系统会连续触发多次事件
  let timer = null;
  const reposition = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!mainWindow) return;
      repositionWindow();
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:metrics-changed', getLayoutMetrics());
      }
      if (notificationWindow && !notificationWindow.isDestroyed() && notificationWindow.isVisible()) {
        notificationWindow.setBounds(getTaskNotificationBounds());
      }
    }, 100);
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.dynamicpanel.app');
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // 必须排在第一位（P3-1 / D13）：它靠"本应用的数据文件是否已存在"区分全新安装与升级，
  // 下面的迁移就会写 app-settings.json，一旦调换顺序，升级用户会被当成全新安装。
  ensureFirstRunAutoLaunch();
  // 迁移与能力解析都要早于建窗：能力随 additionalArguments 一次性下发，
  // 迁移清掉的旧位置会决定第一帧胶囊落在哪里。
  migrateWindowsLayoutSettings();
  refreshRuntimeCapabilities();
  createWindow();
  createTray();
  watchDisplayChanges();
  ensureClipImagesDir();
  ensureRecordingsDir();
  applyAppSettings();
  startTaskNotificationServer();
  void promptForMissingPermissions();
  scheduleTodosSyncCycle();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 常驻菜单栏应用：所有窗口暂时关闭时仍保持后台运行。
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  isQuitting = true;
  hideWhenCollapsed = false;
});

app.on('will-quit', () => {
  cancelCollapseWatchdog();
  platformAdapter.paste.stopTracking();
  clearTodoReminderTimer();
  stopHoverSpaceShortcut();
  clearTaskNotificationTimers();
  stopTaskNotificationServer();
  closeAllTranscriptionSessions();
  closeTodosSyncStore();
  globalShortcut.unregisterAll();
  stopClipboardPolling();
});
