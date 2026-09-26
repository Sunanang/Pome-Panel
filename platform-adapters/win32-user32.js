'use strict';

// Windows 原生绑定（P4-0，方案 §2.6）：只在 win32 上懒加载 koffi，任何一步失败都退回
// available:false，由能力层把「当前窗口 / 自动粘贴 / 通知点击聚焦」整体降级。
// 两条硬规则：
//   1. 绝不使用 koffi.view —— Electron 禁止 external buffer；读内存一律用 Node Buffer
//      或 koffi.decode（见 koffi doc/pointers.md）。
//   2. koffi 3.x 用 BigInt 表示指针，所以句柄在 JS 侧一路按 BigInt 传、按十进制字符串存
//      （WindowRow.handle / PasteTarget.handle）。
// 只打包 x64（D3 / §1），所以 LPARAM、LONG_PTR 直接按 8 字节声明；koffi 的 intptr 会随
// 寄存器宽度变化，用它表示"指针大小的整数"最稳。

const DISABLE_ENV = 'POME_DISABLE_WIN_NATIVE';

const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const DWMWA_CLOAKED = 14;
const SW_RESTORE = 9;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TOKEN_INTEGRITY_LEVEL = 25; // TOKEN_INFORMATION_CLASS::TokenIntegrityLevel
const SECURITY_MANDATORY_MEDIUM_RID = 0x2000;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;
const VK_V = 0x56;
const KEY_DOWN_STATE = 0x8000;
const MAX_TITLE_CHARS = 512;
const MAX_PATH_CHARS = 1024;
const TOKEN_LABEL_BYTES = 256;

const CONSTANTS = Object.freeze({
  GW_OWNER,
  GWL_EXSTYLE,
  WS_EX_TOOLWINDOW,
  DWMWA_CLOAKED,
  SW_RESTORE,
  SECURITY_MANDATORY_MEDIUM_RID,
});

// 句柄在适配层之间以十进制字符串流转（WindowRow / PasteTarget 都要能进 JSON）。
function toHandle(value) {
  if (typeof value === 'bigint') return value === 0n ? null : value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) return null;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const handle = BigInt(value);
    return handle === 0n ? null : handle;
  }
  return null;
}

// GetWindowTextW / QueryFullProcessImageNameW 写进来的是 UTF-16LE，自己按 NUL 截断，
// 不依赖 koffi 的字符串出参语义。
function decodeWideBuffer(buffer, maxChars) {
  const limit = Math.min(buffer.length, Math.max(0, maxChars) * 2);
  for (let offset = 0; offset + 1 < limit; offset += 2) {
    if (buffer.readUInt16LE(offset) === 0) return buffer.toString('utf16le', 0, offset);
  }
  return buffer.toString('utf16le', 0, limit);
}

function keyboardInput(virtualKey, keyUp) {
  return {
    type: INPUT_KEYBOARD,
    padding: 0,
    ki: {
      wVk: virtualKey,
      wScan: 0,
      dwFlags: keyUp ? KEYEVENTF_KEYUP : 0,
      time: 0,
      dwExtraInfo: 0n,
    },
    // MOUSEINPUT(32B) 比 KEYBDINPUT(24B) 大，union 的尾部必须补齐，否则 cbSize 不是 40。
    tail: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function declareBindings() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const advapi32 = koffi.load('advapi32.dll');

  const KEYBDINPUT = koffi.struct('PomeKeybdInput', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uint64_t',
  });
  const INPUT = koffi.struct('PomeInput', {
    type: 'uint32_t',
    padding: 'uint32_t',
    ki: KEYBDINPUT,
    tail: koffi.array('uint8_t', 8),
  });
  // Win32 的 BOOL 是 4 字节 int，不是 C 的 bool：全部按 int 声明再自己比 0，
  // 免得只读到返回值的低字节。
  const EnumWindowsProc = koffi.proto('int __stdcall PomeEnumWindowsProc(void *hwnd, intptr lParam)');

  return {
    koffi,
    INPUT,
    EnumWindowsProc,
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(void *hwnd)'),
    IsWindow: user32.func('int __stdcall IsWindow(void *hwnd)'),
    IsWindowVisible: user32.func('int __stdcall IsWindowVisible(void *hwnd)'),
    IsIconic: user32.func('int __stdcall IsIconic(void *hwnd)'),
    ShowWindow: user32.func('int __stdcall ShowWindow(void *hwnd, int nCmdShow)'),
    GetWindow: user32.func('void * __stdcall GetWindow(void *hwnd, uint32_t cmd)'),
    GetWindowLongPtrW: user32.func('intptr __stdcall GetWindowLongPtrW(void *hwnd, int index)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint8_t *text, int count)'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int key)'),
    SendInput: user32.func('__stdcall', 'SendInput', 'uint32_t', ['uint32_t', koffi.pointer(INPUT), 'int']),
    EnumWindows: user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(EnumWindowsProc), 'intptr']),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint8_t *name, _Inout_ uint32_t *size)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(void *handle)'),
    GetCurrentProcess: kernel32.func('void * __stdcall GetCurrentProcess()'),
    DwmGetWindowAttribute: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attribute, _Out_ uint8_t *value, uint32_t size)'),
    OpenProcessToken: advapi32.func('int __stdcall OpenProcessToken(void *process, uint32_t access, _Out_ uint8_t *token)'),
    GetTokenInformation: advapi32.func('int __stdcall GetTokenInformation(void *token, int infoClass, _Out_ uint8_t *info, uint32_t length, _Out_ uint32_t *returned)'),
    GetSidSubAuthorityCount: advapi32.func('uint8_t * __stdcall GetSidSubAuthorityCount(void *sid)'),
    GetSidSubAuthority: advapi32.func('uint32_t * __stdcall GetSidSubAuthority(void *sid, uint32_t index)'),
  };
}

function createWin32Native(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  // 只有 win32 才 require('koffi')：Mac 上连加载都不发生（Mac 包也排除了这两个 npm 包）。
  if (platform !== 'win32') return { available: false, reason: 'not_win32' };
  if (String(env[DISABLE_ENV] || '') === '1') return { available: false, reason: 'disabled_by_env' };

  let api;
  try {
    api = declareBindings();
  } catch (error) {
    return {
      available: false,
      reason: 'load_failed',
      detail: String((error && error.message) || error),
    };
  }

  const { koffi } = api;
  const INPUT_SIZE = koffi.sizeof(api.INPUT);

  // 每个调用都吞掉异常：一次 FFI 抛错不能把主进程带走，最差就是当作"读不到"。
  function guard(fn, fallback) {
    try {
      return fn();
    } catch (error) {
      return fallback;
    }
  }

  function windowProcessId(handle) {
    const hwnd = toHandle(handle);
    if (!hwnd) return 0;
    return guard(() => {
      const out = [0];
      if (!api.GetWindowThreadProcessId(hwnd, out)) return 0;
      const pid = Number(out[0]) || 0;
      return pid > 0 ? pid : 0;
    }, 0);
  }

  function windowTitle(handle) {
    const hwnd = toHandle(handle);
    if (!hwnd) return '';
    return guard(() => {
      const buffer = Buffer.alloc(MAX_TITLE_CHARS * 2);
      const length = api.GetWindowTextW(hwnd, buffer, MAX_TITLE_CHARS);
      if (length <= 0) return '';
      return decodeWideBuffer(buffer, Math.min(length, MAX_TITLE_CHARS));
    }, '');
  }

  function processImagePath(pid) {
    const id = Math.round(Number(pid) || 0);
    if (id <= 0) return '';
    return guard(() => {
      const process_ = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id);
      if (!process_) return '';
      try {
        const buffer = Buffer.alloc(MAX_PATH_CHARS * 2);
        const size = [MAX_PATH_CHARS];
        if (!api.QueryFullProcessImageNameW(process_, 0, buffer, size)) return '';
        return decodeWideBuffer(buffer, Math.min(Number(size[0]) || 0, MAX_PATH_CHARS));
      } finally {
        guard(() => api.CloseHandle(process_), false);
      }
    }, '');
  }

  // 其他虚拟桌面上的窗口与挂起的 UWP 窗口都是 cloaked：它们仍然 IsWindowVisible，
  // 但对用户来说并不在当前桌面上，Alt+Tab 也不列。
  function isCloaked(handle) {
    const hwnd = toHandle(handle);
    if (!hwnd) return false;
    return guard(() => {
      const value = Buffer.alloc(4);
      if (api.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, value, 4) !== 0) return false;
      return value.readInt32LE(0) !== 0;
    }, false);
  }

  // 完整性级别（P4-1 的 UIPI 预检）：拿不到就返回 null，调用方按"提权"处理。
  function processIntegrityRid(pid) {
    const id = Math.round(Number(pid) || 0);
    if (id <= 0) return null;
    return guard(() => {
      const process_ = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id);
      if (!process_) return null;
      try {
        return readTokenIntegrityRid(process_);
      } finally {
        guard(() => api.CloseHandle(process_), false);
      }
    }, null);
  }

  function readTokenIntegrityRid(processHandle) {
    // OpenProcessToken 的出参是 HANDLE*，用 8 字节 Buffer 接住再读成 BigInt，
    // 避免依赖 koffi 对 opaque 指针出参的封送细节。
    const tokenBuffer = Buffer.alloc(8);
    if (!api.OpenProcessToken(processHandle, TOKEN_QUERY, tokenBuffer)) return null;
    const token = toHandle(tokenBuffer.readBigUInt64LE(0));
    if (!token) return null;
    try {
      const label = Buffer.alloc(TOKEN_LABEL_BYTES);
      const returned = [0];
      if (!api.GetTokenInformation(token, TOKEN_INTEGRITY_LEVEL, label, label.length, returned)) return null;
      // TOKEN_MANDATORY_LABEL = { SID_AND_ATTRIBUTES Label } = { PSID Sid; DWORD Attributes }
      const sid = toHandle(label.readBigUInt64LE(0));
      if (!sid) return null;
      const countPointer = api.GetSidSubAuthorityCount(sid);
      if (!countPointer) return null;
      const count = Number(koffi.decode(countPointer, 'uint8_t')) || 0;
      if (count <= 0) return null;
      const ridPointer = api.GetSidSubAuthority(sid, count - 1);
      if (!ridPointer) return null;
      const rid = Number(koffi.decode(ridPointer, 'uint32_t'));
      return Number.isFinite(rid) && rid > 0 ? rid : null;
    } finally {
      guard(() => api.CloseHandle(token), false);
    }
  }

  // v1 不用 AttachThreadInput（杀软启发式常见特征）：用户点击条目时 Pome 本身就是前台，
  // SetForegroundWindow 通常直接成功，失败时只用一次 ALT 抬键解除前台锁。
  function setForeground(handle) {
    const hwnd = toHandle(handle);
    if (!hwnd) return false;
    return guard(() => {
      if (api.SetForegroundWindow(hwnd) !== 0) return true;
      sendKeys([keyboardInput(VK_MENU, false), keyboardInput(VK_MENU, true)]);
      return api.SetForegroundWindow(hwnd) !== 0;
    }, false);
  }

  function sendKeys(inputs) {
    if (!inputs.length) return false;
    return guard(() => api.SendInput(inputs.length, inputs, INPUT_SIZE) === inputs.length, false);
  }

  return {
    available: true,
    constants: CONSTANTS,
    foregroundWindow() {
      return guard(() => toHandle(api.GetForegroundWindow()), null);
    },
    isWindow(handle) {
      const hwnd = toHandle(handle);
      if (!hwnd) return false;
      return guard(() => api.IsWindow(hwnd) !== 0, false);
    },
    isWindowVisible(handle) {
      const hwnd = toHandle(handle);
      if (!hwnd) return false;
      return guard(() => api.IsWindowVisible(hwnd) !== 0, false);
    },
    windowOwner(handle) {
      const hwnd = toHandle(handle);
      if (!hwnd) return null;
      return guard(() => toHandle(api.GetWindow(hwnd, GW_OWNER)), null);
    },
    isToolWindow(handle) {
      const hwnd = toHandle(handle);
      if (!hwnd) return false;
      return guard(() => (Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) !== 0, false);
    },
    isCloaked,
    windowTitle,
    windowProcessId,
    processImagePath,
    processIntegrityRid,
    selfIntegrityRid() {
      return guard(() => readTokenIntegrityRid(api.GetCurrentProcess()), null);
    },
    // Z 序枚举：EnumWindows 是同步的，回调只在调用期间被触发，所以用 koffi 的
    // transient callback（不占 registered 槽位，异常时也不会漏 unregister）。
    enumWindows() {
      return guard(() => {
        const handles = [];
        api.EnumWindows((hwnd) => {
          const handle = toHandle(hwnd);
          if (handle) handles.push(handle);
          return 1; // 非 0 = 继续枚举
        }, 0);
        return handles;
      }, []);
    },
    restoreWindow(handle) {
      const hwnd = toHandle(handle);
      if (!hwnd) return false;
      return guard(() => {
        if (api.IsIconic(hwnd) === 0) return false;
        api.ShowWindow(hwnd, SW_RESTORE);
        return true;
      }, false);
    },
    setForeground,
    // 用户可能还按着展开面板用的修饰键；不放掉的话 Ctrl+V 会变成 Ctrl+Shift+V 之类。
    releaseStuckModifiers() {
      const stuck = [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN].filter((key) => guard(
        () => (api.GetAsyncKeyState(key) & KEY_DOWN_STATE) !== 0,
        false
      ));
      if (!stuck.length) return false;
      return sendKeys(stuck.map((key) => keyboardInput(key, true)));
    },
    sendCtrlV() {
      return sendKeys([
        keyboardInput(VK_CONTROL, false),
        keyboardInput(VK_V, false),
        keyboardInput(VK_V, true),
        keyboardInput(VK_CONTROL, true),
      ]);
    },
  };
}

// 进程内只加载一次：koffi.load 与 koffi.struct 都有全局注册表，重复声明会报重名。
let cached = null;

function loadWin32Native(options = {}) {
  if (!cached) cached = createWin32Native(options);
  return cached;
}

function resetWin32NativeCache() {
  cached = null;
}

module.exports = {
  loadWin32Native,
  createWin32Native,
  resetWin32NativeCache,
  toHandle,
  decodeWideBuffer,
  DISABLE_ENV,
  CONSTANTS,
};
