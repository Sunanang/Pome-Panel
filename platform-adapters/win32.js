'use strict';

// Windows 适配层：媒体状态与隐私设置跳转（P0-2）+ 原生窗口枚举 / 自动粘贴（P4-1、P4-2）。
// 原生部分全部经 win32-user32.js 的 koffi 绑定，绑定加载失败（或 POME_DISABLE_WIN_NATIVE=1、
// 或用户没开设置里的实验开关）时 native.available=false，能力层把相关功能整体关掉，
// 这里对应返回 native_unavailable。汽水音乐永久缺席（D4）。

const { normalizeWindowRows, updateForegroundTracking, chooseForegroundPasteTarget, integrityPasteDecision } = require('../main-services');
const { loadWin32Native } = require('./win32-user32');

const PRIVACY_SETTINGS_PANES = {
  microphone: 'ms-settings:privacy-microphone',
  camera: 'ms-settings:privacy-webcam',
};

// 前台跟踪的轮询间隔：一次 GetForegroundWindow + GetWindowThreadProcessId 是微秒级调用。
const FOREGROUND_POLL_MS = 250;
// SetForegroundWindow 生效不是同步的，发送 Ctrl+V 前留一点时间再复核前台。
const FOREGROUND_SETTLE_MS = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 第一版 appName 就用 exe 名（FileDescription 以后再做）。
function exeDisplayName(appPath) {
  const base = String(appPath || '').split(/[\\/]/).pop() || '';
  return base.replace(/\.exe$/i, '').trim();
}

function createWin32Adapter(options = {}) {
  const electron = options.electron || {};
  const { app, systemPreferences } = electron;
  const native = options.native || loadWin32Native({ platform: options.platform });
  const nativeAvailable = native.available === true;

  let foregroundTimer = null;
  let trackedForeground = { handle: null, pid: 0 };
  let previousPasteTarget = null;
  let windowScanCache = new Map();
  const iconCache = new Map();

  function sampleForeground() {
    const handle = native.foregroundWindow();
    const sample = handle
      ? { handle: String(handle), pid: native.windowProcessId(handle) }
      : null;
    trackedForeground = updateForegroundTracking(trackedForeground, sample, process.pid);
    return sample;
  }

  async function readAppIcon(appPath) {
    if (!appPath || !app || typeof app.getFileIcon !== 'function') return null;
    if (iconCache.has(appPath)) return iconCache.get(appPath);
    let dataUrl = null;
    try {
      const image = await app.getFileIcon(appPath, { size: 'normal' });
      dataUrl = image && !image.isEmpty() ? image.toDataURL() : null;
    } catch (error) {
      dataUrl = null;
    }
    iconCache.set(appPath, dataUrl);
    return dataUrl;
  }

  // 过滤条件对齐 Alt+Tab：可见、无 owner、非工具窗口、未被 cloak（其他虚拟桌面 / 挂起的
  // UWP）、标题非空、不是自己。EnumWindows 按 Z 序回调，所以 windowIndex 就是前后顺序。
  async function listWindows() {
    if (!nativeAvailable) {
      windowScanCache = new Map();
      return { items: [], error: 'native_unavailable' };
    }
    const appPaths = new Map();
    const rows = [];
    native.enumWindows().forEach((handle, order) => {
      if (!native.isWindowVisible(handle)) return;
      if (native.windowOwner(handle)) return;
      if (native.isToolWindow(handle)) return;
      if (native.isCloaked(handle)) return;
      const title = native.windowTitle(handle);
      if (!title.trim()) return;
      const pid = native.windowProcessId(handle);
      if (!pid || pid === process.pid) return;
      if (!appPaths.has(pid)) appPaths.set(pid, native.processImagePath(pid));
      const appPath = appPaths.get(pid);
      rows.push({
        pid,
        appName: exeDisplayName(appPath) || `PID ${pid}`,
        appPath,
        title,
        windowIndex: order,
        windowNumber: Number(handle),
        handle: String(handle),
      });
    });
    const items = normalizeWindowRows(rows, 'win32');
    const icons = new Map();
    await Promise.all([...new Set(items.map((item) => item.appPath).filter(Boolean))].map(
      async (appPath) => icons.set(appPath, await readAppIcon(appPath))
    ));
    items.forEach((item) => {
      item.icon = item.appPath ? icons.get(item.appPath) || null : null;
    });
    windowScanCache = new Map(items.map((item) => [item.id, item]));
    return { items, error: null };
  }

  // 按 HWND 聚焦比 Mac 的按标题匹配可靠：同标题的多个窗口也能分别点到。
  async function focusWindowRow(row) {
    if (!nativeAvailable || !row) return false;
    const handle = row.handle || row.windowNumber;
    if (!native.isWindow(handle)) return false;
    native.restoreWindow(handle);
    return native.setForeground(handle);
  }

  return {
    id: 'win32',
    native: nativeAvailable
      ? { available: true }
      : { available: false, reason: native.reason || 'not_available' },
    windows: {
      list: listWindows,
      focus(windowId) {
        return focusWindowRow(windowScanCache.get(windowId));
      },
      // 通知点击聚焦（P4-3）不经过渲染层的窗口 ID，直接拿扫描结果里的行。
      focusRow: focusWindowRow,
      appIcon: readAppIcon,
    },
    paste: {
      // 由 main.js 在"收起态 + 剪贴板功能开启 + automaticPaste 可用"时启动（P4-1）。
      startTracking() {
        if (!nativeAvailable || foregroundTimer) return;
        sampleForeground();
        foregroundTimer = setInterval(sampleForeground, FOREGROUND_POLL_MS);
      },
      stopTracking() {
        if (!foregroundTimer) return;
        clearInterval(foregroundTimer);
        foregroundTimer = null;
      },
      async captureTarget() {
        if (!nativeAvailable) return null;
        const foreground = sampleForeground();
        const chosen = chooseForegroundPasteTarget({
          foreground,
          tracked: trackedForeground,
          selfPid: process.pid,
        });
        if (!chosen || !native.isWindow(chosen.handle)) {
          previousPasteTarget = null;
          return null;
        }
        previousPasteTarget = {
          handle: chosen.handle,
          pid: chosen.pid,
          appPath: native.processImagePath(chosen.pid),
        };
        return previousPasteTarget;
      },
      rememberedTarget() {
        return previousPasteTarget;
      },
      // Windows 没有辅助功能授权这一层，SendInput 不需要任何权限。
      permissionRequired() {
        return false;
      },
      async pasteTo(target) {
        if (!nativeAvailable) return 'native_unavailable';
        const handle = target && (target.handle || null);
        if (!handle || !native.isWindow(handle)) return 'target_gone';
        const pid = native.windowProcessId(handle) || Math.round(Number(target.pid) || 0);
        if (integrityPasteDecision(native.processIntegrityRid(pid), native.selfIntegrityRid()) === 'elevated') {
          return 'elevated';
        }
        native.restoreWindow(handle);
        if (!native.setForeground(handle)) return 'focus_failed';
        await sleep(FOREGROUND_SETTLE_MS);
        // 发送前再确认一次前台：否则用户在这 60ms 里切走，Ctrl+V 会落到别的窗口。
        const current = native.foregroundWindow();
        if (!current || String(current) !== String(handle)) return 'focus_failed';
        native.releaseStuckModifiers();
        return native.sendCtrlV() ? 'pasted' : 'focus_failed';
      },
    },
    // music 故意缺席：Windows 不做汽水音乐控制（D4），main.js 对缺失的能力回 unsupported。
    media: {
      status(mediaType) {
        // Electron 在 Windows 上同样提供 getMediaAccessStatus（反映"允许应用访问"总开关）。
        if (!systemPreferences || typeof systemPreferences.getMediaAccessStatus !== 'function') return 'unknown';
        try {
          return systemPreferences.getMediaAccessStatus(mediaType);
        } catch (error) {
          return 'unknown';
        }
      },
      // Windows 没有可编程的授权弹窗：Chromium 自己会申请，被系统总开关拦住时
      // 由渲染层提示用户去隐私设置，所以这里不阻断流程。
      async request() {
        return true;
      },
    },
    // permissions 故意缺席：Mac 专属的辅助功能 / 屏幕录制自检在 Windows 没有等价项。
    privacyPaneUrl(pane) {
      return PRIVACY_SETTINGS_PANES[String(pane || '')] || null;
    },
  };
}

module.exports = { createWin32Adapter, PRIVACY_SETTINGS_PANES };
