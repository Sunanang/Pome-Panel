const { contextBridge, ipcRenderer } = require('electron');

// 所有 on* 订阅统一经此注册，并回传退订函数：渲染层若重新初始化，
// 不退订就会叠加监听器，同一条通知被回调多次。
function subscribe(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// 能力层下发（P0-1 / §2.3）：主窗口与通知窗口共用本文件，主进程用
// webPreferences.additionalArguments 传 --pome-caps=<base64 JSON>。
// 沙箱 preload 不能 require 本地模块，所以这里只解析、不重新计算。
const CAPABILITIES_ARGUMENT_PREFIX = '--pome-caps=';

function decodeBase64Json(value) {
  let json;
  if (typeof Buffer !== 'undefined') {
    json = Buffer.from(value, 'base64').toString('utf8');
  } else {
    const binary = atob(value);
    json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  const parsed = JSON.parse(json);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function readCapabilities() {
  const argument = (process.argv || []).find(
    (item) => typeof item === 'string' && item.startsWith(CAPABILITIES_ARGUMENT_PREFIX)
  );
  if (argument) {
    try {
      const parsed = decodeBase64Json(argument.slice(CAPABILITIES_ARGUMENT_PREFIX.length));
      if (parsed && typeof parsed.platform === 'string') return deepFreeze(parsed);
    } catch (error) {
      // 解析失败时退到只带平台名的兜底，渲染层自己用 NotchPlatform 补齐。
    }
  }
  return deepFreeze({ platform: process.platform });
}

// The renderer's shared localization runtime owns the supported-language
// catalog. Type-check main-process snapshots here without a second, stale
// bilingual allowlist that drops the other eight languages' broadcasts.
function isLocalizationState(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.effectiveLocale === 'string' && typeof value.preference === 'string'
    && typeof value.formatLocale === 'string' && Number.isInteger(value.revision);
}
function readLocalization() {
  const argument = process.argv.find(value => value.startsWith('--pome-locale='));
  try {
    const value = argument && decodeBase64Json(argument.slice('--pome-locale='.length));
    if (isLocalizationState(value)) return deepFreeze(value);
  } catch {}
  return deepFreeze({ preference: 'system', effectiveLocale: 'en-US', formatLocale: 'en-US', revision: 0 });
}
contextBridge.exposeInMainWorld('notchAPI', {
  localization: readLocalization(),
  setLanguage: value => ipcRenderer.invoke('settings:set-language', value),
  onLocalizationChanged: cb => subscribe('localization:changed', (_event, value) => {
    if (isLocalizationState(value)) cb(deepFreeze(value));
  }),
  // platform 保留一个版本给尚未迁移到 capabilities 的调用方。
  platform: process.platform,
  // additionalArguments 只在创建窗口时生效，运行期的能力变化走 capabilities:changed。
  capabilities: readCapabilities(),
  onCapabilitiesChanged: (cb) =>
    subscribe('capabilities:changed', (event, next) => {
      if (!next || typeof next !== 'object' || typeof next.platform !== 'string') return;
      cb(deepFreeze(next));
    }),
  beginOpenTiming: () => ipcRenderer.invoke('window:begin-open'),
  finishOpenTiming: (id) => ipcRenderer.invoke('window:open-interactive', id),
  setMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  beginCollapse: () => ipcRenderer.invoke('window:begin-collapse'),
  startPanelDrag: () => ipcRenderer.invoke('window:panel-drag-start'),
  movePanelDrag: () => ipcRenderer.invoke('window:panel-drag-move'),
  endPanelDrag: () => ipcRenderer.invoke('window:panel-drag-end'),
  resetPanelPosition: () => ipcRenderer.invoke('window:reset-panel-position'),
  setTypingFocus: (focused) => ipcRenderer.invoke('window:set-typing-focus', focused === true),
  setTab: (tab) => ipcRenderer.invoke('window:set-tab', tab),
  captureNoteModule: (rect) => ipcRenderer.invoke('notes:capture-module', rect),
  ensureCamera: () => ipcRenderer.invoke('media:camera'),
  ensureMicrophone: () => ipcRenderer.invoke('media:microphone'),
  // 只读状态 + 按平台算好的提示文案；ensure* 仍返回布尔，契约不变（P3-2）。
  getMediaAccessStatus: (mediaType) => ipcRenderer.invoke('media:access-status', mediaType),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openPrivacySettings: (pane) => ipcRenderer.invoke('shell:open-privacy-settings', pane),
  getMusicStatus: () => ipcRenderer.invoke('music:status'),
  getCodexUsage: (options) => ipcRenderer.invoke('codex:usage', options || {}),
  readLocalCodexToken: () => ipcRenderer.invoke('codex:read-local-token'),
  getCodexTokenStatus: () => ipcRenderer.invoke('codex:token-status'),
  setCodexToken: (token) => ipcRenderer.invoke('codex:set-token', token),
  clearCodexToken: () => ipcRenderer.invoke('codex:clear-token'),
  onCodexTokenChanged: (cb) => subscribe('codex:token-changed', (event, status) => cb(status)),
  getCursorUsage: (options) => ipcRenderer.invoke('cursor:usage', options || {}),
  getCursorTokenStatus: () => ipcRenderer.invoke('cursor:token-status'),
  readLocalCursorToken: () => ipcRenderer.invoke('cursor:read-local-token'),
  onCursorTokenChanged: (cb) => subscribe('cursor:token-changed', (event, status) => cb(status)),
  setCursorToken: (token) => ipcRenderer.invoke('cursor:set-token', token),
  clearCursorToken: () => ipcRenderer.invoke('cursor:clear-token'),
  getGrokbotUsage: (options) => ipcRenderer.invoke('grokbot:usage', options || {}),
  getClaudeUsage: (options) => ipcRenderer.invoke('claude:usage', options || {}),
  getCopilotUsage: (options) => ipcRenderer.invoke('copilot:usage', options || {}),
  getGrokUsage: (options) => ipcRenderer.invoke('grok:usage', options || {}),
  getAntigravityUsage: (options) => ipcRenderer.invoke('antigravity:usage', options || {}),
  getManusUsage: (options) => ipcRenderer.invoke('manus:usage', options || {}),
  getManusCompletionStatus: () => ipcRenderer.invoke('manus:completion-status'),
  setManusCompletionEnabled: (enabled) => ipcRenderer.invoke('manus:completion-set-enabled', enabled === true),
  checkManusCompletion: () => ipcRenderer.invoke('manus:completion-check'),
  previewManusCompletion: () => ipcRenderer.invoke('manus:completion-preview'),
  onManusCompletionStatus: (cb) => subscribe('manus:completion-changed', (_event, status) => cb(status)),
  getAiProviderTokenStatus: (providerId) => ipcRenderer.invoke('ai-provider:token-status', providerId),
  setAiProviderToken: (providerId, token, options) => ipcRenderer.invoke('ai-provider:set-token', providerId, token, options),
  clearAiProviderToken: (providerId) => ipcRenderer.invoke('ai-provider:clear-token', providerId),
  onAiProviderTokenChanged: (cb) => subscribe('ai-provider:token-changed', (event, status) => cb(status)),
  controlMusic: (action) => ipcRenderer.invoke('music:control', action),
  inspectLink: (url) => ipcRenderer.invoke('links:inspect', url),
  listWindows: (force = false) => ipcRenderer.invoke('windows:list', force === true),
  focusWindow: (windowId) => ipcRenderer.invoke('windows:focus', windowId),
  saveRecording: (payload) => ipcRenderer.invoke('recordings:save', payload),
  readRecording: (audioPath) => ipcRenderer.invoke('recordings:read', audioPath),
  deleteRecording: (audioPath) => ipcRenderer.invoke('recordings:delete', audioPath),
  revealRecording: (audioPath) => ipcRenderer.invoke('recordings:reveal', audioPath),
  organizeMaterial: (payload) => ipcRenderer.invoke('smart:organize-material', payload),
  listCredentials: () => ipcRenderer.invoke('credentials:list'),
  getCredential: (id) => ipcRenderer.invoke('credentials:get', id),
  saveCredential: (payload) => ipcRenderer.invoke('credentials:save', payload),
  deleteCredentials: (ids) => ipcRenderer.invoke('credentials:delete-many', ids),
  copyCredential: (id, field) => ipcRenderer.invoke('credentials:copy', { id, field }),
  getTranscriptionConfig: () => ipcRenderer.invoke('transcription:get-config'),
  setTranscriptionConfig: (config) => ipcRenderer.invoke('transcription:set-config', config),
  startTranscription: language => ipcRenderer.invoke('transcription:start', { language }),
  sendTranscriptionAudio: (bytes) => ipcRenderer.send('transcription:audio', bytes),
  finishTranscription: () => ipcRenderer.invoke('transcription:finish'),
  onTranscriptionEvent: (cb) => subscribe('transcription:event', (event, payload) => cb(payload)),
  listTaskCompletions: () => ipcRenderer.invoke('tasks:recent'),
  onRecordingSyncState: (cb) => subscribe('recordings:sync-state', (_event, rows) => cb(rows)),
  onTaskInboxError: (cb) => subscribe('tasks:inbox-error', (_event, error) => cb(error)),
  rebuildTaskInbox: () => ipcRenderer.invoke('tasks:rebuild'),
  getTaskInbox: (options) => ipcRenderer.invoke('tasks:inbox', options || {}),
  getAiAttention: () => ipcRenderer.invoke('ai-attention:list'),
  showAiAttention: key => ipcRenderer.invoke('ai-attention:show', key),
  openAiAttention: key => ipcRenderer.invoke('ai-attention:open', key),
  rebuildAiAttention: () => ipcRenderer.invoke('ai-attention:rebuild'),
  onAiAttentionChanged: cb => subscribe('ai-attention:changed', () => cb()),
  markTaskRead: (id) => ipcRenderer.invoke('tasks:read', id),
  openTaskSource: (id) => ipcRenderer.invoke('tasks:open-source', id),
  getAiSources: () => ipcRenderer.invoke('tasks:sources'),
  previewAiSource: (source, action) => ipcRenderer.invoke('tasks:sources-preview', source, action),
  applyAiSource: (token) => ipcRenderer.invoke('tasks:sources-apply', token),
  testAiSource: (source) => ipcRenderer.invoke('tasks:sources-test', source),
  scheduleTodoReminders: (items, expectedRoot) => ipcRenderer.invoke('todos:schedule-reminders', items, expectedRoot),
  notifyPomodoro: (minutes) => ipcRenderer.invoke('pomodoro:notify', minutes),
  onTodoReminderError: (cb) => subscribe('todo:reminder-error', (event, payload) => cb(payload)),
  onTodoReminder: (cb) => subscribe('todo:reminded', (event, payload) => cb(payload)),
  onEscape: (cb) => subscribe('key:escape', () => cb()),
  onToggleShortcut: (cb) => subscribe('shortcut:toggle-panel', () => cb()),
  getHoverSpaceStatus: () => ipcRenderer.invoke('shortcut:hover-space-status'),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  completeWelcome: () => ipcRenderer.invoke('settings:complete-welcome'),
  setFeature: (featureId, enabled) => ipcRenderer.invoke('settings:set-feature', { featureId, enabled }),
  setDefaultTab: (tab) => ipcRenderer.invoke('settings:set-default-tab', tab),
  setWinNative: (enabled) => ipcRenderer.invoke('settings:set-win-native', enabled === true),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:set-auto-launch', enabled === true),
  setTaskNotifications: (enabled) => ipcRenderer.invoke('settings:set-task-notifications', enabled === true),
  setWeatherEffects: (enabled) => ipcRenderer.invoke('settings:set-weather-effects', enabled === true),
  getSunWeather: (location) => ipcRenderer.invoke('sun:weather', location),
  setPanelShortcut: (accelerator) => ipcRenderer.invoke('settings:set-shortcut', accelerator),
  onAppSettingsChanged: (cb) => subscribe('settings:changed', (event, settings) => cb(settings)),
  onRecordShortcut: (cb) => subscribe('app:record-shortcut', () => cb()),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  confirm: (payload) => ipcRenderer.invoke('workspace:confirm', payload),
  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupPreview: () => ipcRenderer.invoke('backup:preview'),
  backupRestore: (previewId) => ipcRenderer.invoke('backup:restore', previewId),
  recoveryPreview: () => ipcRenderer.invoke('recovery:preview'),
  recoveryExecute: (previewId) => ipcRenderer.invoke('recovery:execute', previewId),
  recoveryRollback: (operationId) => ipcRenderer.invoke('recovery:rollback', operationId),
  loadWorkspaceData: () => ipcRenderer.invoke('workspace:load-data'),
  saveWorkspaceData: (storage, expectedRoot) => ipcRenderer.invoke('workspace:save-data', storage, expectedRoot),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  onWorkspaceChanged: (cb) => subscribe('workspace:changed', (event, info) => cb(info)),
  onCollapseRequest: (cb) => subscribe('window:request-collapse', () => cb()),
  onWindowVisibilityChanged: cb => subscribe('window:visibility-changed', (_event, visible) => {
    if (typeof visible === 'boolean') cb(visible);
  }),
  getMetrics: () => ipcRenderer.invoke('window:metrics'),
  onMetricsChanged: (cb) =>
    subscribe('window:metrics-changed', (event, metrics) => cb(metrics)),
  writeClipboard: (entry) => ipcRenderer.invoke('clipboard:write', entry),
  pasteClipboard: (entry) => ipcRenderer.invoke('clipboard:paste', entry),
  readClipImage: (imagePath) => ipcRenderer.invoke('clipboard:readImage', imagePath),
  deleteClipImages: (paths) => ipcRenderer.invoke('clipboard:deleteImages', paths),
  onNewClipEntry: (cb) => subscribe('clipboard:new-entry', (evt, entry) => cb(entry)),
  onOpenClip: (cb) => subscribe('app:open-clip', () => cb()),
  onOpenTodo: (cb) => subscribe('app:open-todo', (event, payload) => cb(payload || {})),
  onOpenApiSettings: (cb) => subscribe('app:open-api-settings', () => cb()),
  getMirrorImage: () => ipcRenderer.invoke('mirror:get-image'),
  chooseMirrorImage: () => ipcRenderer.invoke('mirror:choose-image'),
  onMirrorImageChanged: (cb) => subscribe('mirror:image-changed', (event, dataUrl) => cb(dataUrl)),
  onTaskNotification: (cb) =>
    subscribe('task-notification:show', (event, notification) => cb(notification)),
  onTaskNotificationQueue: (cb) =>
    subscribe('task-notification:queue', (event, count) => cb(count)),
  onTaskNotificationTiming: (cb) =>
    subscribe('task-notification:timing', (event, timing) => cb(timing)),
  taskNotificationShown: (eventId) => ipcRenderer.send('task-notification:shown', eventId),
  taskNotificationResize: (size) => ipcRenderer.send('task-notification:resize', size),
  dismissTaskNotification: (eventId) => ipcRenderer.send('task-notification:close', eventId),
  onTaskNotificationHide: (cb) =>
    subscribe('task-notification:hide', (event, payload) => cb(payload)),
  onTaskCompletion: (cb) =>
    subscribe('task-completion:new', (event, notification) => cb(notification)),
  onTaskInboxChanged: (cb) => subscribe('tasks:inbox-changed', () => cb()),
  taskNotificationDismissed: (eventId) =>
    ipcRenderer.send('task-notification:dismissed', eventId),
  activateTaskNotification: (eventId) =>
    ipcRenderer.invoke('task-notification:activate', eventId),
  taskNotificationHover: (paused, eventId) =>
    ipcRenderer.send('task-notification:hover', { paused: paused === true, eventId }),
  syncGetStatus: () => ipcRenderer.invoke('sync:get-status'),
  syncGetDashboard: () => ipcRenderer.invoke('sync:get-dashboard'),
  syncListEndpoints: () => ipcRenderer.invoke('sync:list-endpoints'),
  syncAddEndpoint: (payload) => ipcRenderer.invoke('sync:add-endpoint', payload || {}),
  syncUpdateEndpoint: (payload) => ipcRenderer.invoke('sync:update-endpoint', payload || {}),
  syncDeleteEndpoint: (payload) => ipcRenderer.invoke('sync:delete-endpoint', payload || {}),
  syncReorderEndpoint: (payload) => ipcRenderer.invoke('sync:reorder-endpoint', payload || {}),
  syncSetCurrentEndpoint: (payload) => ipcRenderer.invoke('sync:set-current-endpoint', payload || {}),
  syncSetGatewayBearerBlocked: (payload) =>
    ipcRenderer.invoke('sync:set-gateway-bearer-blocked', payload || {}),
  syncTestEndpoint: (payload) => ipcRenderer.invoke('sync:test-endpoint', payload || {}),
  syncRetry: () => ipcRenderer.invoke('sync:retry'),
  syncExportTodosBackup: () => ipcRenderer.invoke('sync:export-todos-backup'),
  syncPairHttpPolicy: (baseUrl) => ipcRenderer.invoke('sync:pair-http-policy', baseUrl),
  syncPairClaim: (payload) => ipcRenderer.invoke('sync:pair-claim', payload || {}),
  syncClearBinding: () => ipcRenderer.invoke('sync:clear-binding'),
  syncListDevices: (payload) => ipcRenderer.invoke('sync:list-devices', payload || {}),
  syncRevokeDevice: (payload) => ipcRenderer.invoke('sync:revoke-device', payload || {}),
  syncGetMigrationSession: () => ipcRenderer.invoke('sync:get-migration-session'),
  syncClassifyMigration: (payload) => ipcRenderer.invoke('sync:classify-migration', payload || {}),
  syncRunMigration: (payload) => ipcRenderer.invoke('sync:run-migration', payload || {}),
  syncAckMigrationProjection: () => ipcRenderer.invoke('sync:ack-migration-projection'),
  syncRestoreMigrationBackup: (payload) =>
    ipcRenderer.invoke('sync:restore-migration-backup', payload || {}),
  onSyncMigrationSession: (cb) =>
    subscribe('sync:migration-session', (event, payload) => cb(payload)),
  syncTodosLocalWrite: (payload) => ipcRenderer.invoke('sync:todos-local-write', payload || {}),
  syncTodosRunCycle: () => ipcRenderer.invoke('sync:todos-run-cycle'),
  syncTodosGetProjection: () => ipcRenderer.invoke('sync:todos-get-projection'),
  onSyncTodosProjection: (cb) =>
    subscribe('sync:todos-projection', (event, projection) => cb(projection)),
  onSyncWorkspaceProjection: (cb) =>
    subscribe('sync:workspace-projection', (event, projection) => cb(projection)),
  onSyncStatus: (cb) =>
    subscribe('sync:status', (event, status) => cb(status)),
});
