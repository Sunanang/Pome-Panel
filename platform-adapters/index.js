'use strict';

// 适配层入口（P0-2）：能力层说"能不能做"，适配层说"怎么做"。
// 只在主进程使用；darwin / win32 各一份实现同一接口，见方案 §2.5。

const { createDarwinAdapter } = require('./darwin');
const { createWin32Adapter } = require('./win32');

// 未支持的平台（Linux 等）仍要拿到一个可调用的对象，让 IPC 统一回 unsupported。
function createUnsupportedAdapter(platform) {
  return {
    id: platform,
    native: { available: false, reason: 'unsupported_platform' },
    windows: {
      async list() { return { items: [], error: 'unsupported' }; },
      async focus() { return false; },
      async focusRow() { return false; },
      async appIcon() { return null; },
    },
    paste: {
      startTracking() {},
      stopTracking() {},
      async captureTarget() { return null; },
      rememberedTarget() { return null; },
      permissionRequired() { return false; },
      async pasteTo() { return 'unsupported'; },
    },
    media: {
      status() { return 'unknown'; },
      async request() { return true; },
    },
    privacyPaneUrl() { return null; },
  };
}

function loadAdapter(platform, options = {}) {
  if (platform === 'darwin') return createDarwinAdapter(options);
  if (platform === 'win32') return createWin32Adapter(options);
  return createUnsupportedAdapter(platform);
}

module.exports = { loadAdapter, createUnsupportedAdapter };
