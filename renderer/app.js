const STORAGE_KEY = 'notch-todo-data';
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TODO_CATEGORY_KEY = 'notch-todo-category-names-v1';
const TODO_CATEGORY_DEFAULTS = {
  P0: '课程',
  P1: '自媒体&写作',
  P2: 'Vibe coding',
  P3: '日常',
};

const app = document.getElementById('app');
const notch = document.getElementById('notch');
const panel = document.getElementById('panel');
const statusToast = document.getElementById('status-toast');
const statusToastMessage = document.getElementById('status-toast-message');
const statusToastAction = document.getElementById('status-toast-action');

function collectLocalStorageSnapshot() {
  const result = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) result[key] = localStorage.getItem(key);
  }
  return result;
}

let workspaceReloadPending = false;
let applyingSyncTodosProjection = false;
let todosSyncBound = false;

function applyTodosSyncProjectionPayload(projection) {
  if (!projection) return false;
  const todosJson =
    typeof projection.todosJson === 'string'
      ? projection.todosJson
      : projection.todos
        ? JSON.stringify(projection.todos)
        : null;
  const categoryNamesJson =
    typeof projection.categoryNamesJson === 'string'
      ? projection.categoryNamesJson
      : projection.categoryNames
        ? JSON.stringify(projection.categoryNames)
        : null;
  if (!todosJson || !categoryNamesJson) return false;

  applyingSyncTodosProjection = true;
  try {
    localStorage.setItem(STORAGE_KEY, todosJson);
    localStorage.setItem(TODO_CATEGORY_KEY, categoryNamesJson);
    data = loadData();
    todoCategoryNames = loadTodoCategoryNames();
    PRIORITIES.forEach((priority) => {
      if (typeof renderList === 'function') renderList(priority);
      if (typeof updateCount === 'function') updateCount(priority);
    });
    if (typeof applyTodoCategoryNames === 'function') applyTodoCategoryNames();
  } finally {
    applyingSyncTodosProjection = false;
  }
  return true;
}

async function refreshTodosSyncBindingState() {
  if (!window.notchAPI || typeof window.notchAPI.syncGetStatus !== 'function') {
    todosSyncBound = false;
    return false;
  }
  try {
    const status = await window.notchAPI.syncGetStatus();
    todosSyncBound = Boolean(status && status.bound);
    return todosSyncBound;
  } catch (error) {
    todosSyncBound = false;
    return false;
  }
}

async function hydrateTodosSyncProjectionAfterWorkspace() {
  const bound = await refreshTodosSyncBindingState();
  if (!bound || typeof window.notchAPI.syncTodosGetProjection !== 'function') return;
  try {
    const result = await window.notchAPI.syncTodosGetProjection();
    if (result && result.ok && result.projection) {
      applyTodosSyncProjectionPayload(result.projection);
    }
  } catch (error) {
    // Unbound / store unavailable — keep LS as-is.
  }
}

function mirrorTodoToSync(payload) {
  if (applyingSyncTodosProjection) return;
  if (!window.notchAPI || typeof window.notchAPI.syncTodosLocalWrite !== 'function') return;
  // Main returns unbound when not paired; keep optimistic LS write either way.
  window.notchAPI
    .syncTodosLocalWrite(payload)
    .then((result) => {
      if (result && result.unbound) {
        todosSyncBound = false;
        return;
      }
      if (result && result.ok) {
        todosSyncBound = true;
      }
    })
    .catch(() => {});
}

async function hydratePortableWorkspace() {
  if (!window.notchAPI?.loadWorkspaceData) return;
  try {
    const snapshot = await window.notchAPI.loadWorkspaceData();
    let imported = false;
    if (sessionStorage.getItem('notch-workspace-hydrated') !== '1' && snapshot && typeof snapshot === 'object') {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
          imported = true;
        }
      });
      sessionStorage.setItem('notch-workspace-hydrated', '1');
    }
    if (imported) {
      // The current editors were initialized before the asynchronous import.
      // Their unload/visibility handlers must not overwrite recovered values.
      workspaceReloadPending = true;
      location.reload();
      return;
    }
    // Bound startup: hydratePortableWorkspace → SQLite projection overrides workspace.
    await hydrateTodosSyncProjectionAfterWorkspace();
    setInterval(() => window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).catch(() => {}), 2000);
  } catch (error) {}
}
// Do not interrupt parser-loaded workspace scripts with a recovery navigation.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydratePortableWorkspace, { once: true });
} else {
  hydratePortableWorkspace();
}
window.notchAPI?.onWorkspaceChanged?.(() => {
  sessionStorage.removeItem('notch-workspace-hydrated');
  window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).finally(() => location.reload());
});

let statusToastTimer = null;
let statusToastHideTimer = null;
let statusToastActionHandler = null;
let statusToastExpireHandler = null;

function dismissStatusToast(commitPending = true) {
  if (statusToastTimer) clearTimeout(statusToastTimer);
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastTimer = null;
  statusToastHideTimer = null;
  const onExpire = statusToastExpireHandler;
  statusToastExpireHandler = null;
  statusToastActionHandler = null;
  const actionHadFocus = statusToastAction === document.activeElement;
  if (actionHadFocus) {
    const activeTabButton = document.querySelector('.tab.active');
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  if (statusToast) {
    statusToast.classList.remove('visible');
    statusToast.setAttribute('aria-hidden', 'true');
  }
  if (statusToastAction) statusToastAction.hidden = true;
  statusToastHideTimer = setTimeout(() => {
    statusToastHideTimer = null;
    if (statusToast) statusToast.hidden = true;
    if (statusToastMessage) statusToastMessage.textContent = '';
  }, 180);
  if (commitPending && onExpire) onExpire();
}

function showStatusToast(message, options = {}) {
  dismissStatusToast(true);
  if (!statusToast || !statusToastMessage) return;
  const { actionLabel, onAction, onExpire, duration = 1800 } = options;
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastHideTimer = null;
  statusToast.hidden = false;
  statusToast.setAttribute('aria-hidden', 'false');
  statusToastMessage.textContent = message;
  statusToastActionHandler = typeof onAction === 'function' ? onAction : null;
  statusToastExpireHandler = typeof onExpire === 'function' ? onExpire : null;
  if (statusToastAction && statusToastActionHandler) {
    statusToastAction.textContent = actionLabel || '撤销';
    statusToastAction.hidden = false;
  }
  statusToast.classList.add('visible');
  statusToastTimer = setTimeout(() => dismissStatusToast(true), duration);
}

if (statusToastAction) {
  statusToastAction.addEventListener('click', () => {
    const handler = statusToastActionHandler;
    dismissStatusToast(false);
    if (handler) handler();
  });
}

window.addEventListener('beforeunload', () => dismissStatusToast(true));

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { P0: [], P1: [], P2: [], P3: [] };
    const parsed = JSON.parse(raw);
    return {
      P0: normalizeTodoItems(parsed && parsed.P0),
      P1: normalizeTodoItems(parsed && parsed.P1),
      P2: normalizeTodoItems(parsed && parsed.P2),
      P3: normalizeTodoItems(parsed && parsed.P3),
    };
  } catch (e) {
    return { P0: [], P1: [], P2: [], P3: [] };
  }
}

function normalizeTodoItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text
          ? { id: generateId(), text, done: false, createdAt: Date.now() }
          : null;
      }
      if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null;
      const text = item.text.trim();
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : generateId(),
        text,
        done: item.done === true,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        deadline: Number.isFinite(Date.parse(String(item.deadline || '')))
          ? new Date(Date.parse(String(item.deadline))).toISOString()
          : '',
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      };
    })
    .filter(Boolean);
}

function saveData(data) {
  if (window.NasSyncMigration && typeof window.NasSyncMigration.isReadonly === 'function') {
    // Prefer live UI state if workspace exposed it
  }
  if (window.__nasTodoReadonly === true) {
    if (typeof showStatusToast === 'function') {
      showStatusToast('迁移中，稍候', { kind: 'warning' });
    }
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore quota errors
  }
  if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
    const reminders = PRIORITIES.flatMap((priority) => data[priority] || []);
    window.notchAPI.scheduleTodoReminders(reminders).catch(() => {});
  }
  return true;
}

let data = loadData();
let todoCategoryNames = loadTodoCategoryNames();
const todoSelections = Object.fromEntries(PRIORITIES.map((priority) => [priority, new Set()]));
const todoSelectionAnchors = Object.fromEntries(PRIORITIES.map((priority) => [priority, null]));
let editingTodo = null;

function loadTodoCategoryNames() {
  try {
    return window.NotchDomain.normalizeTodoCategoryNames(
      JSON.parse(localStorage.getItem(TODO_CATEGORY_KEY) || 'null'),
      TODO_CATEGORY_DEFAULTS
    );
  } catch (error) {
    return { ...TODO_CATEGORY_DEFAULTS };
  }
}

function persistTodoCategoryNames() {
  if (window.__nasTodoReadonly === true) {
    if (typeof showStatusToast === 'function') {
      showStatusToast('迁移中，稍候', { kind: 'warning' });
    }
    return false;
  }
  try {
    localStorage.setItem(TODO_CATEGORY_KEY, JSON.stringify(todoCategoryNames));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话中的分类名。
  }
  return true;
}

function applyTodoCategoryNames() {
  PRIORITIES.forEach((categoryId) => {
    const name = todoCategoryNames[categoryId];
    const input = document.querySelector(`.todo-category-name[data-category="${categoryId}"]`);
    const addInput = document.querySelector(`.add-row input[data-priority="${categoryId}"]`);
    if (input) input.value = name;
    if (addInput) addInput.setAttribute('aria-label', `添加${name}待办`);
  });
}
if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
  window.notchAPI
    .scheduleTodoReminders(PRIORITIES.flatMap((priority) => data[priority] || []))
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onTodoReminder === 'function') {
  window.notchAPI.onTodoReminder((payload) => {
    if (!payload || !payload.id) return;
    let changed = false;
    PRIORITIES.forEach((priority) => {
      const item = (data[priority] || []).find((todo) => (
        todo.id === payload.id && String(todo.deadline || '') === String(payload.deadline || '')
      ));
      if (!item) return;
      item.remindedAt = Math.max(0, Number(payload.remindedAt) || Date.now());
      changed = true;
    });
    if (changed) saveData(data);
  });
}

if (window.notchAPI && typeof window.notchAPI.onSyncTodosProjection === 'function') {
  window.notchAPI.onSyncTodosProjection((projection) => {
    todosSyncBound = true;
    applyTodosSyncProjectionPayload(projection);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function checkSvg() {
  return '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todoItemHtml(priority, item) {
  const doneClass = item.done ? ' done' : '';
  const selectedClass = todoSelections[priority]?.has(item.id) ? ' multi-selected' : '';
  const safeId = escapeHtml(item.id);
  const safeText = escapeHtml(item.text);
  const deadline = Number.isFinite(Date.parse(String(item.deadline || '')))
    ? new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(item.deadline))
    : '';
  const toggleLabel = item.done ? `恢复未完成：${safeText}` : `标记完成：${safeText}`;
  const battery = window.NotchDomain.todoTimeBattery(item, Date.now());
  // 逾期项整条填满红色并只显示一个白色感叹号：剩余 0% 是「快到了」，
  // 逾期是「已经欠账」，两者不能长得一样。
  const batteryHtml = battery
    ? `<span class="todo-battery" data-tone="${battery.tone}"${battery.overdue ? ' data-overdue="true" role="img"' : ''} title="${battery.label}" aria-label="${battery.label}"><i style="--battery:${battery.overdue ? 100 : battery.percent}%"></i><b>${battery.overdue ? '!' : `${battery.percent}%`}</b></span>`
    : '';
  const isEditing = editingTodo?.priority === priority && editingTodo?.id === item.id;
  const contentHtml = isEditing
    ? `<div class="todo-inline-editor"><input class="todo-inline-name" value="${safeText}" maxlength="80" aria-label="修改待办名称" />${batteryHtml}<button class="todo-inline-deadline" type="button" data-action="edit-deadline">${deadline || '日期'}</button><button class="todo-inline-save" type="button" data-action="save-edit" aria-label="保存修改">✓</button></div>`
    : `<button class="todo-copy" type="button" data-action="edit" title="${safeText}" aria-label="修改：${safeText}"><span class="todo-text">${safeText}</span>${batteryHtml}${deadline ? `<time class="todo-ddl" datetime="${escapeHtml(item.deadline)}">${escapeHtml(deadline)}</time>` : ''}</button>`;
  return `
    <li class="todo-item${doneClass}${selectedClass}" data-id="${safeId}" data-priority="${priority}">
      <button class="checkbox" type="button" data-action="toggle" aria-label="${toggleLabel}" aria-pressed="${item.done}">${checkSvg()}</button>
      ${contentHtml}
      <button class="delete" type="button" data-action="delete" aria-label="删除：${safeText}">×</button>
    </li>
  `;
}

function captureTodoPositions(priority) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return new Map();
  return new Map(Array.from(list.querySelectorAll('.todo-item[data-id]')).map((item) => (
    [item.dataset.id, item.getBoundingClientRect()]
  )));
}

function animateTodoOrder(priority, previousPositions) {
  if (!previousPositions?.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  requestAnimationFrame(() => {
    list.querySelectorAll('.todo-item[data-id]').forEach((item) => {
      const previous = previousPositions.get(item.dataset.id);
      if (!previous || typeof item.animate !== 'function') return;
      const current = item.getBoundingClientRect();
      const offset = previous.top - current.top;
      if (Math.abs(offset) < 1) return;
      item.animate([
        { transform: `translateY(${offset}px)` },
        { transform: 'translateY(0)' },
      ], {
        duration: 360,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
      });
    });
  });
}

function renderList(priority, options = {}) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  const items = window.NotchDomain.sortTodosForDisplay(data[priority] || []);
  list.innerHTML = items.map((item) => todoItemHtml(priority, item)).join('');
  updateTodoBulkButton(priority);
  animateTodoOrder(priority, options.previousPositions);
  if (options.focusId) {
    requestAnimationFrame(() => list.querySelector(
      `.todo-item[data-id="${CSS.escape(options.focusId)}"] [data-action="${options.focusAction || 'toggle'}"]`
    )?.focus({ preventScroll: true }));
  }
}

function updateTodoBulkButton(priority) {
  const button = document.querySelector(`[data-bulk-priority="${priority}"]`);
  const count = todoSelections[priority]?.size || 0;
  if (!button) return;
  button.hidden = count === 0;
  button.textContent = '删除';
  button.setAttribute('aria-label', count ? `删除 ${count} 项` : '删除所选');
}

function updateCount(priority) {
  const countEl = document.querySelector(`.count[data-priority="${priority}"]`);
  if (!countEl) return;
  const items = data[priority] || [];
  const pending = items.filter((t) => !t.done).length;
  countEl.textContent = String(pending);
}

function renderAll() {
  PRIORITIES.forEach((p) => {
    renderList(p);
    updateCount(p);
  });
}

setInterval(() => PRIORITIES.forEach(renderList), 60_000);

// 渲染重建 innerHTML 后，给指定条目挂一次性动画类；动画结束即卸载，不污染后续渲染
function flashItemClass(priority, id, cls) {
  const el = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"]`
  );
  if (!el) return;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function flashCheckboxPop(priority, id) {
  const box = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"] .checkbox`
  );
  if (!box) return;
  box.classList.add('pop');
  box.addEventListener('animationend', () => box.classList.remove('pop'), { once: true });
}

function addTodo(priority, text, deadline) {
  if (window.__nasTodoReadonly === true) {
    if (typeof showStatusToast === 'function') showStatusToast('迁移中，稍候', { kind: 'warning' });
    return false;
  }
  const item = window.NotchDomain.createTodo(text, deadline, generateId(), Date.now());
  if (!item) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority].push(item);
  saveData(data);
  mirrorTodoToSync({ op: 'upsert-todo', categoryId: priority, item });
  renderList(priority, { previousPositions });
  updateCount(priority);
  flashItemClass(priority, item.id, 'enter');
  const added = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${item.id}"]`
  );
  if (added) {
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      added.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  return true;
}

function editTodo(priority, id, text, deadline) {
  const index = (data[priority] || []).findIndex((item) => item.id === id);
  if (index < 0) return false;
  const updated = window.NotchDomain.updateTodo(data[priority][index], text, deadline);
  if (!updated) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority][index] = updated;
  saveData(data);
  mirrorTodoToSync({ op: 'upsert-todo', categoryId: priority, item: updated });
  renderList(priority, { previousPositions, focusId: id, focusAction: 'edit' });
  return true;
}

function toggleTodo(priority, id) {
  const list = data[priority];
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const previousPositions = captureTodoPositions(priority);
  const restoreFocus = document.activeElement?.closest('.todo-item')?.dataset.id === id;
  list[idx].done = !list[idx].done;
  const nowDone = list[idx].done;
  saveData(data);
  mirrorTodoToSync({ op: 'upsert-todo', categoryId: priority, item: list[idx] });
  renderList(priority, {
    previousPositions,
    focusId: restoreFocus ? id : '',
    focusAction: 'toggle',
  });
  updateCount(priority);
  if (nowDone) requestAnimationFrame(() => flashCheckboxPop(priority, id)); // 勾选弹一下
}

function deleteTodo(priority, id) {
  const list = data[priority];
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = list.splice(index, 1);
  const itemEl = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"]`
  );
  const shouldRestoreFocus = !!(itemEl && itemEl.contains(document.activeElement));
  const nearbyItem = itemEl && (itemEl.nextElementSibling || itemEl.previousElementSibling);
  if (itemEl) itemEl.remove();
  saveData(data);
  mirrorTodoToSync({ op: 'delete-todo', entityId: id });
  updateCount(priority);
  if (shouldRestoreFocus) {
    const nextFocus =
      (nearbyItem && nearbyItem.querySelector('[data-action="toggle"]')) ||
      document.querySelector(`.add-row input[data-priority="${priority}"]`);
    if (nextFocus) nextFocus.focus({ preventScroll: true });
  }
  const summary = removed.text.length > 18 ? `${removed.text.slice(0, 18)}…` : removed.text;
  showStatusToast(`已删除“${summary}”`, {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (list.some((item) => item.id === removed.id)) return;
      list.splice(Math.min(index, list.length), 0, removed);
      saveData(data);
      mirrorTodoToSync({ op: 'upsert-todo', categoryId: priority, item: removed });
      renderList(priority);
      updateCount(priority);
      const restored = document.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"] [data-action="toggle"]`
      );
      if (restored) restored.focus({ preventScroll: true });
      showStatusToast('已撤销删除');
    },
  });
}

let isExpanded = false;
let modeBusy = false;
let pendingMode = null;
let restoreNotchFocusAfterCollapse = false;
// 从折叠态展开的瞬间置 true，岛体落定后自动清除；
// setActiveTab 读取此标志决定是否延后重活，已展开态切 Tab 不受影响。
let _justExpanded = false;

const PANEL_MOTION_FALLBACK_MS = 440;
const OPENING_SETTLE_MS = 360;
const HEAVY_LOAD_AFTER_OPEN_MS = 360;

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitForPanelMotion() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (
        event.target === panel &&
        event.propertyName === 'opacity' &&
        event.pseudoElement === '::before'
      ) {
        finish();
      }
    };
    const timer = setTimeout(finish, PANEL_MOTION_FALLBACK_MS);
    panel.addEventListener('transitionend', onEnd);
  });
}

async function ipcSetMode(mode) {
  if (!window.notchAPI || typeof window.notchAPI.setMode !== 'function') return;
  try {
    await window.notchAPI.setMode(mode);
  } catch (e) {
    // ignore
  }
}

async function ipcBeginCollapse() {
  if (!window.notchAPI || typeof window.notchAPI.beginCollapse !== 'function') return;
  try {
    await window.notchAPI.beginCollapse();
  } catch (e) {
    // ignore
  }
}

function syncPanelAccessibility(expanded) {
  const focusWasInPanel = !!(panel && panel.contains(document.activeElement));
  if (!expanded) {
    restoreNotchFocusAfterCollapse = document.hasFocus();
    if (focusWasInPanel) document.activeElement.blur();
  } else {
    restoreNotchFocusAfterCollapse = false;
  }
  if (panel) {
    panel.inert = !expanded;
    panel.setAttribute('aria-hidden', String(!expanded));
  }
  if (!notch) return;
  notch.setAttribute('aria-expanded', String(expanded));
  notch.setAttribute('aria-label', expanded ? '收起 Pome Panel' : '展开 Pome Panel');
  if (expanded && document.activeElement === notch) {
    const activeTabButton = document.querySelector(`.tab[data-tab="${activeTab}"]`);
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  notch.setAttribute('aria-hidden', String(expanded));
  notch.tabIndex = expanded ? -1 : 0;
}

// 原生窗口只提供动画需要的透明画布；用户看到的黑色岛体由 CSS 连续形变。
// 收起必须等岛体退场完成后再缩原生窗口，避免最后一帧被裁掉。
async function setMode(expanded) {
  if (modeBusy) {
    pendingMode = expanded;
    return;
  }
  if (expanded === isExpanded) return;
  modeBusy = true;
  isExpanded = expanded;
  try {
    if (expanded) {
      // 每次召回使用设置中的默认页，不沿用上次收起时的停留页。
      _justExpanded = true;
      setTimeout(() => {
        _justExpanded = false;
      }, OPENING_SETTLE_MS);
      const openingTab = window.NotchDomain.resolveDefaultPanelTab(defaultOpenTab, TABS);
      if (activeTab !== openingTab) await setActiveTab(openingTab);
      else applyTabDom(openingTab);
      syncPanelAccessibility(true);
      if (window.notchAPI?.getMetrics) {
        applyLayoutMetrics(await window.notchAPI.getMetrics().catch(() => null));
      }
      app.classList.remove('collapsed', 'closing');
      app.classList.add('opening');
      void panel.offsetWidth;
      // offsetWidth 只强制布局，不强制绘制；而 rAF 回调发生在绘制之前。
      // 必须等两帧、确认 .opening 的透明折叠条真的进了合成器，再让主进程放大窗口，
      // 否则放大时被钉在新原点上的仍是那条黑色折叠条（菜单栏黑块闪烁的成因）。
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('expanded');
      // 同一帧切到 expanded，让玻璃壳从岛体种子开始长，而不是先露出整窗大框
      await nextAnimationFrame();
      app.classList.remove('opening');
      app.classList.add('expanded');
      void panel.offsetWidth;
      // 展开后面板从隐藏变为可见，tab 尺寸此时才可量，校准激活胶囊位置
      requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
      setTimeout(() => {
        if (!isExpanded) return;
        if (activeTab === 'clip') renderClipList();
      }, HEAVY_LOAD_AFTER_OPEN_MS);
    } else {
      document.dispatchEvent(new CustomEvent('notch:will-collapse'));
      const motion = waitForPanelMotion();
      syncPanelAccessibility(false);
      // 隐私优先：不要把摄像头释放放在 rAF 之后，隐藏窗口可能暂停动画帧。
      stopMirror();
      if (window.notchAPI?.getMetrics) {
        applyLayoutMetrics(await window.notchAPI.getMetrics().catch(() => null));
      }
      await ipcBeginCollapse();
      app.classList.add('closing');
      await nextAnimationFrame();
      await motion;
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('collapsed');
      app.classList.remove('expanded', 'closing', 'opening');
      app.classList.add('collapsed');
      if (restoreNotchFocusAfterCollapse && document.hasFocus() && notch) {
        notch.focus({ preventScroll: true });
      }
      restoreNotchFocusAfterCollapse = false;
    }
    document.dispatchEvent(new CustomEvent('notch:modechange', {
      detail: { expanded: isExpanded },
    }));
  } finally {
    modeBusy = false;
    if (pendingMode !== null) {
      const nextMode = pendingMode;
      pendingMode = null;
      if (nextMode !== isExpanded) setMode(nextMode);
    }
  }
}

const PANEL_DRAG_THRESHOLD_PX = 5;
let notchPointerState = null;

function clearNotchPointerState() {
  if (!notchPointerState) return;
  const { pointerId } = notchPointerState;
  notchPointerState = null;
  try {
    if (notch.hasPointerCapture(pointerId)) notch.releasePointerCapture(pointerId);
  } catch (error) {}
}

notch.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (isExpanded) return;
  if (!window.notchAPI?.startPanelDrag) return;
  event.stopPropagation();
  notchPointerState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
  };
  try { notch.setPointerCapture(event.pointerId); } catch (error) {}
});

notch.addEventListener('pointermove', async (event) => {
  if (!notchPointerState || notchPointerState.pointerId !== event.pointerId) return;
  const dx = event.clientX - notchPointerState.startX;
  const dy = event.clientY - notchPointerState.startY;
  if (!notchPointerState.dragging) {
    if (Math.hypot(dx, dy) < PANEL_DRAG_THRESHOLD_PX) return;
    notchPointerState.dragging = true;
    document.body.classList.add('panel-dragging');
    const started = await window.notchAPI.startPanelDrag().catch(() => false);
    if (!started) {
      clearNotchPointerState();
      document.body.classList.remove('panel-dragging');
      return;
    }
  }
  await window.notchAPI.movePanelDrag().catch(() => null);
});

async function finishNotchPointer(event) {
  if (!notchPointerState || notchPointerState.pointerId !== event.pointerId) return;
  const wasDragging = notchPointerState.dragging;
  clearNotchPointerState();
  document.body.classList.remove('panel-dragging');
  if (wasDragging) {
    await window.notchAPI?.endPanelDrag?.().catch(() => null);
    return;
  }
  notchToggleFromPointer = true;
  setMode(!isExpanded);
}

notch.addEventListener('pointerup', (event) => {
  finishNotchPointer(event);
});

notch.addEventListener('pointercancel', (event) => {
  finishNotchPointer(event);
});

let notchToggleFromPointer = false;
notch.addEventListener('click', (e) => {
  e.stopPropagation();
  if (notchToggleFromPointer) {
    notchToggleFromPointer = false;
    e.preventDefault();
    return;
  }
  setMode(!isExpanded);
});

notch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  setMode(!isExpanded);
});

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const editable = Boolean(target && target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), audio, video'
  ));
  if (!window.NotchDomain.shouldTogglePanelForSpace({
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    isComposing: event.isComposing,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    editable,
  })) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setMode(!isExpanded);
}, true);

syncPanelAccessibility(false);

panel.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Esc 收起面板（菜单栏会拦截顶部刘海条的点击，给收起多一条可靠路径）；
// 焦点在输入框/速记里时，第一次 Esc 只退出输入。
// Escape 不会原生到达页面（被浏览器层吞掉），由主进程 before-input-event 转发

function isEditableField(el) {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest(
    'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"])'
  ));
}

let imeTypingFocus = false;
function syncTypingFocus(next) {
  if (imeTypingFocus === next) return;
  imeTypingFocus = next;
  window.notchAPI?.setTypingFocus?.(next);
}

document.addEventListener('focusin', (event) => {
  if (isEditableField(event.target)) syncTypingFocus(true);
});

document.addEventListener('focusout', () => {
  requestAnimationFrame(() => {
    syncTypingFocus(isEditableField(document.activeElement));
  });
});

document.addEventListener('compositionstart', (event) => {
  if (isEditableField(event.target)) syncTypingFocus(true);
});

document.addEventListener('compositionend', () => {
  requestAnimationFrame(() => {
    syncTypingFocus(isEditableField(document.activeElement));
  });
});

if (window.notchAPI && typeof window.notchAPI.onEscape === 'function') {
  window.notchAPI.onEscape(() => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur();
      return;
    }
    if (document.querySelector('.multi-selected')) {
      PRIORITIES.forEach((priority) => {
        todoSelections[priority].clear();
        todoSelectionAnchors[priority] = null;
        renderList(priority);
      });
      document.dispatchEvent(new CustomEvent('notch:clear-selection'));
      return;
    }
    if (isExpanded) setMode(false);
  });
}

if (window.notchAPI && typeof window.notchAPI.onToggleShortcut === 'function') {
  window.notchAPI.onToggleShortcut(() => setMode(!isExpanded));
}

// 失焦与点击收起共用同一个状态机，保证退场节奏一致。
if (window.notchAPI && typeof window.notchAPI.onCollapseRequest === 'function') {
  window.notchAPI.onCollapseRequest(() => {
    if (isExpanded) setMode(false);
  });
}

// 全局快捷键召唤也走同一套 Tab 与展开状态机，避免出现另一种突兀的入场路径。
if (window.notchAPI && typeof window.notchAPI.onOpenClip === 'function') {
  window.notchAPI.onOpenClip(async () => {
    await setActiveTab('clip');
    if (!isExpanded) await setMode(true);
  });
}

// 布局度量（主进程按屏计算下发）：折叠条高 / 菜单栏占位高 / 各 Tab 目标尺寸
let layoutMetrics = null;

function applyIslandClipVars(edge, align) {
  const root = document.documentElement;
  const side = edge === 'left' || edge === 'right';
  const collapsedW = layoutMetrics?.collapsedWidth;
  const collapsedH = layoutMetrics?.collapsedHeight;
  const strip = side
    ? `${collapsedW || 9}px`
    : `${collapsedH || 9}px`;
  const len = side
    ? `${collapsedH || 85}px`
    : `${collapsedW || 85}px`;
  const halfPx = side
    ? `${Math.round((collapsedH || 85) / 2)}px`
    : `${Math.round((collapsedW || 85) / 2)}px`;
  const half = halfPx;
  const halfLen = halfPx;
  const set = (openT, openR, openB, openL, closeT, closeR, closeB, closeL, round) => {
    root.style.setProperty('--island-t', openT);
    root.style.setProperty('--island-r', openR);
    root.style.setProperty('--island-b', openB);
    root.style.setProperty('--island-l', openL);
    root.style.setProperty('--island-round', round);
    root.style.setProperty('--island-close-t', closeT);
    root.style.setProperty('--island-close-r', closeR);
    root.style.setProperty('--island-close-b', closeB);
    root.style.setProperty('--island-close-l', closeL);
    root.style.setProperty('--island-close-round', round);
  };

  const horizontalSeed = () => {
    if (align === 'start') return { l: '0', r: `calc(100% - ${len})` };
    if (align === 'end') return { l: `calc(100% - ${len})`, r: '0' };
    return { l: `calc(50% - ${half})`, r: `calc(50% - ${half})` };
  };
  const verticalSeed = () => {
    if (align === 'start') return { t: '0', b: `calc(100% - ${len})` };
    if (align === 'end') return { t: `calc(100% - ${len})`, b: '0' };
    return { t: `calc(50% - ${halfLen})`, b: `calc(50% - ${halfLen})` };
  };

  if (edge === 'left') {
    const v = verticalSeed();
    set(v.t, `calc(100% - ${strip})`, v.b, '0', v.t, `calc(100% - ${strip})`, v.b, '0', '0 var(--r-notch) var(--r-notch) 0');
    return;
  }
  if (edge === 'right') {
    const v = verticalSeed();
    set(v.t, '0', v.b, `calc(100% - ${strip})`, v.t, '0', v.b, `calc(100% - ${strip})`, 'var(--r-notch) 0 0 var(--r-notch)');
    return;
  }
  if (edge === 'bottom') {
    const h = horizontalSeed();
    set('0', h.r, '0', h.l, `calc(100% - ${strip})`, h.r, '0', h.l, 'var(--r-notch) var(--r-notch) 0 0');
    return;
  }
  // top
  const h = horizontalSeed();
  set('0', h.r, '0', h.l, '0', h.r, `calc(100% - ${strip})`, h.l, '0 0 var(--r-notch) var(--r-notch)');
}

function applyLayoutMetrics(metrics) {
  if (!metrics) return;
  layoutMetrics = metrics;
  if (metrics.stripHeight) {
    document.documentElement.style.setProperty('--notch-h', `${metrics.stripHeight}px`);
  }
  if (metrics.menuBarHeight) {
    document.documentElement.style.setProperty('--mb-h', `${metrics.menuBarHeight}px`);
  }
  const edge = ['left', 'right', 'top', 'bottom'].includes(metrics.dockEdge)
    ? metrics.dockEdge
    : 'top';
  const align = ['start', 'center', 'end'].includes(metrics.dockAlign)
    ? metrics.dockAlign
    : 'center';
  const root = document.getElementById('app');
  if (root) {
    root.setAttribute('data-dock', edge);
    root.setAttribute('data-dock-align', align);
  }
  applyIslandClipVars(edge, align);
  if (metrics.collapsedWidth) {
    document.documentElement.style.setProperty('--collapsed-w', `${metrics.collapsedWidth}px`);
  }
  if (metrics.collapsedHeight) {
    document.documentElement.style.setProperty('--collapsed-h', `${metrics.collapsedHeight}px`);
  }
}

if (window.notchAPI && typeof window.notchAPI.getMetrics === 'function') {
  window.notchAPI
    .getMetrics()
    .then(applyLayoutMetrics)
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onMetricsChanged === 'function') {
  window.notchAPI.onMetricsChanged(applyLayoutMetrics);
}

// ============ Tab 切换 ============
const TAB_KEY = 'notch-active-tab';
const ALL_TABS = ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'];
let TABS = ALL_TABS.filter((name) => name !== 'clip');
let tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const tabIndicator = document.getElementById('tab-indicator');
const collapseBtn = document.getElementById('collapse-btn');

let activeTab = 'home';
let defaultOpenTab = 'home';

function applyFeatureSettings(settings) {
  const features = { ...(settings && settings.features || {}), home: true, settings: true };
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    const enabled = button.dataset.tab === 'home'
      || button.dataset.tab === 'settings'
      || features[button.dataset.tab] !== false;
    button.hidden = !enabled;
    button.setAttribute('aria-hidden', String(!enabled));
  });
  TABS = window.NotchDomain.visiblePanelTabs(ALL_TABS, features);
  defaultOpenTab = window.NotchDomain.resolveDefaultPanelTab(settings?.defaultTab, TABS);
  tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
  tabButtons.forEach((button) => button.classList.remove('tab-split-start'));
  document.getElementById('tabs')?.classList.toggle('is-split', tabButtons.length > 4);
  if (tabButtons.length > 4) {
    tabButtons[Math.ceil(tabButtons.length / 2)]?.classList.add('tab-split-start');
  }
  if (!TABS.includes(activeTab)) setActiveTab('home');
  requestAnimationFrame(positionIndicator);
}

if (window.notchAPI?.getAppSettings) {
  window.notchAPI.getAppSettings().then(applyFeatureSettings).catch(() => {});
  window.notchAPI.onAppSettingsChanged?.(applyFeatureSettings);
}

function positionIndicator() {
  const btn = tabButtons.find((b) => b.dataset.tab === activeTab);
  if (!btn || !tabIndicator) return;
  tabIndicator.style.width = `${btn.offsetWidth}px`;
  tabIndicator.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function applyTabDom(name) {
  tabButtons.forEach((b) => {
    const selected = b.dataset.tab === name;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  tabPanels.forEach((p) => {
    const selected = p.id === `tab-${name}`;
    p.classList.toggle('active', selected);
    p.inert = !selected;
    p.setAttribute('aria-hidden', String(!selected));
  });
  positionIndicator();
  requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
  document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: name } }));
}

async function ipcSetTab(name) {
  if (!window.notchAPI || typeof window.notchAPI.setTab !== 'function') return;
  try {
    await window.notchAPI.setTab(name);
  } catch (e) {
    // ignore
  }
}

// 固定展开尺寸下，Tab 只切换内容与指示器，不再改变原生窗口边界。
async function morphToTab(name) {
  await ipcSetTab(name);
  applyTabDom(name);
  positionIndicator();
}

let tabBusy = false;
let pendingTab = null;

async function setActiveTab(name) {
  if (!TABS.includes(name)) name = 'home';
  if (tabBusy) {
    pendingTab = name; // 补间中连点：记住最后目标，结束后追赶
    return;
  }
  if (name === activeTab) {
    applyTabDom(name);
    return;
  }
  tabBusy = true;
  activeTab = name;
  if (name !== 'home') stopMirror();
  try {
    // 图片预加载等重活的调度策略：
    //   - 已展开态切 Tab：_justExpanded=false → 立即执行，保持即时响应
    //   - 从折叠态展开（_justExpanded=true）：延后到展开动画基本落定后再跑，
    //     避免与面板 scale 手势争首帧 CPU/GPU，消除展开卡顿
    // renderClipList 延后只是缩略图晚一点出现，可接受。
    const _tabNameForDeferred = name; // 闭包捕获当前目标 Tab
    const runHeavyLoads = () => {
      if (_tabNameForDeferred === 'clip') renderClipList();
      if (_tabNameForDeferred === 'notes') renderNotesLibrary();
    };
    if (_justExpanded) {
      // 双帧后再延迟重活，让岛体形变先完成，避免抢首帧 CPU/GPU。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(runHeavyLoads, HEAVY_LOAD_AFTER_OPEN_MS))
      );
    } else {
      // 已展开态切 Tab：立即执行，无感知延迟
      runHeavyLoads();
    }
    if (isExpanded) {
      await morphToTab(name);
    } else {
      // 折叠态只记录目标尺寸（主进程不变形），展开时一步到位
      await ipcSetTab(name);
      applyTabDom(name);
    }
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch (e) {
      // ignore quota errors
    }
  } finally {
    tabBusy = false;
    if (pendingTab && pendingTab !== activeTab) {
      const next = pendingTab;
      pendingTab = null;
      setActiveTab(next);
    } else {
      pendingTab = null;
    }
  }
}

// 胶囊滑动结束后兜底再校准一次（窗口变形期间布局可能回流）
if (tabIndicator) {
  tabIndicator.addEventListener('transitionend', positionIndicator);
}

Array.from(document.querySelectorAll('.tab[data-tab]')).forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveTab(btn.dataset.tab);
  });
  btn.addEventListener('keydown', (e) => {
    const currentIndex = tabButtons.indexOf(btn);
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    }
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextButton = tabButtons[nextIndex];
    nextButton.focus({ preventScroll: true });
    setActiveTab(nextButton.dataset.tab);
  });
});

// 托盘里的“设置快捷键…”会把设置入口以内联浮层放到面板中。
// 这里绑定所有 Tab（包括启动时隐藏的剪贴板），避免功能启用后按钮仍没有事件。
const shortcutRecorder = document.getElementById('shortcut-recorder');
const shortcutRecorderValue = document.getElementById('shortcut-recorder-value');
const shortcutRecorderCancel = document.getElementById('shortcut-recorder-cancel');
let shortcutRecorderActive = false;

function closeShortcutRecorder() {
  shortcutRecorderActive = false;
  if (shortcutRecorder) shortcutRecorder.hidden = true;
}

function keyEventToAccelerator(event) {
  const keyAliases = {
    ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  };
  let key = keyAliases[event.key] || event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key)) return '';
  const parts = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

shortcutRecorder?.addEventListener('keydown', async (event) => {
  if (!shortcutRecorderActive) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    closeShortcutRecorder();
    return;
  }
  const accelerator = keyEventToAccelerator(event);
  if (!accelerator) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = '请按下完整按键组合';
    return;
  }
  if (accelerator !== 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = '单键仅支持空格';
    return;
  }
  if (shortcutRecorderValue) shortcutRecorderValue.textContent = accelerator;
  const result = await window.notchAPI?.setPanelShortcut?.(accelerator).catch(() => ({ ok: false }));
  if (!result?.ok) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = result?.error === 'occupied' ? '该快捷键已被占用' : '无法使用该快捷键';
    return;
  }
  showStatusToast(`快捷键已设为 ${accelerator}`);
  setTimeout(closeShortcutRecorder, 420);
});

shortcutRecorderCancel?.addEventListener('click', closeShortcutRecorder);
function openShortcutRecorder() {
  if (!isExpanded) setMode(true);
  shortcutRecorderActive = true;
  shortcutRecorder.hidden = false;
  shortcutRecorderValue.textContent = '等待输入…';
  requestAnimationFrame(() => shortcutRecorder.focus({ preventScroll: true }));
}
window.notchAPI?.onRecordShortcut?.(openShortcutRecorder);
document.addEventListener('notch:record-shortcut', openShortcutRecorder);

if (collapseBtn) {
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(false);
  });
}

// 顶栏空白处点按收起——黑条在展开态已退场，由顶栏接替这一角色。
// 排除交互区（Tab / 按钮 / 输入 / 搜索框），品牌区与空白处都可收起（明确的收起热区）。
// 注意：home/todo 下搜索框隐藏会让 .topbar-mid 高度塌成 0，点击其实落在 .topbar 上，
// 所以必须挂在 .topbar 上并用 closest 排除，不能只认 .topbar-mid 本体。
const topbarEl = document.querySelector('.topbar');
if (topbarEl) {
  topbarEl.addEventListener('click', (e) => {
    if (e.target.closest('.tabs, button, input')) return;
    e.stopPropagation();
    setMode(false);
  });
}

function initTab() {
  setActiveTab('home');
}

document.querySelectorAll('.todo-category-name[data-category]').forEach((input) => {
  const finishCategoryEdit = () => {
    const categoryId = input.dataset.category;
    todoCategoryNames = window.NotchDomain.normalizeTodoCategoryNames({
      ...todoCategoryNames,
      [categoryId]: input.value,
    }, TODO_CATEGORY_DEFAULTS);
    persistTodoCategoryNames();
    applyTodoCategoryNames();
    mirrorTodoToSync({
      op: 'upsert-category',
      priority: categoryId,
      name: todoCategoryNames[categoryId],
    });
  };
  input.addEventListener('change', finishCategoryEdit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      input.value = todoCategoryNames[input.dataset.category];
      input.blur();
    }
  });
});

applyTodoCategoryNames();

const todoEditorBackdrop = document.getElementById('todo-date-popover');
const todoEditorMonth = document.getElementById('todo-editor-month');
const todoCalendarPrevious = document.getElementById('todo-calendar-previous');
const todoCalendarNext = document.getElementById('todo-calendar-next');
const todoCalendarGrid = document.getElementById('todo-calendar-grid');
const todoEditorHour = document.getElementById('todo-editor-hour');
const todoEditorMinute = document.getElementById('todo-editor-minute');
const todoEditorError = document.getElementById('todo-editor-error');
let todoEditorContext = null;
let todoEditorYear = new Date().getFullYear();
let todoEditorMonthIndex = new Date().getMonth();
let todoEditorDay = new Date().getDate();

function fillTodoTimeOptions() {
  if (todoEditorHour && !todoEditorHour.options.length) {
    for (let hour = 0; hour < 24; hour += 1) todoEditorHour.add(new Option(String(hour).padStart(2, '0'), String(hour)));
  }
  if (todoEditorMinute && !todoEditorMinute.options.length) {
    for (let minute = 0; minute < 60; minute += 5) todoEditorMinute.add(new Option(String(minute).padStart(2, '0'), String(minute)));
  }
}

function renderTodoCalendar() {
  if (!todoCalendarGrid) return;
  const now = new Date();
  const days = new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(todoEditorYear, todoEditorMonthIndex, 1).getDay() + 6) % 7;
  if (todoEditorMonth) todoEditorMonth.textContent = `${todoEditorYear}年 ${todoEditorMonthIndex + 1}月`;
  todoCalendarGrid.replaceChildren();
  for (let index = 0; index < firstWeekday; index += 1) todoCalendarGrid.append(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.dataset.day = String(day);
    button.className = day === todoEditorDay ? 'selected' : '';
    if (todoEditorYear === now.getFullYear() && todoEditorMonthIndex === now.getMonth() && day === now.getDate()) {
      button.classList.add('today');
    }
    todoCalendarGrid.append(button);
  }
}

function closeTodoEditor() {
  if (todoEditorBackdrop) todoEditorBackdrop.hidden = true;
  if (todoEditorContext?.mode === 'edit') {
    const { priority } = todoEditorContext;
    renderList(priority);
  }
  todoEditorContext = null;
}

function selectedTodoDeadline() {
  return window.NotchDomain.calendarDeadline({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
    day: todoEditorDay,
    hour: todoEditorHour?.value,
    minute: todoEditorMinute?.value,
  });
}

function applyTodoEditorSelection(markManual = true) {
  if (!todoEditorContext) return false;
  const deadline = selectedTodoDeadline();
  if (!deadline || Date.parse(deadline) <= Date.now()) {
    if (todoEditorError) todoEditorError.textContent = '请选择晚于当前时间的截止点';
    return false;
  }
  if (todoEditorError) todoEditorError.textContent = '';
  const { priority, id, mode } = todoEditorContext;
  if (mode === 'edit') {
    const todo = (data[priority] || []).find((item) => item.id === id);
    if (!todo) return false;
    todo.deadline = deadline;
    saveData(data);
  } else {
    const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
    if (!trigger) return false;
    trigger.dataset.deadline = deadline;
    trigger.dataset.deadlineSource = markManual ? 'manual' : (trigger.dataset.deadlineSource || 'default');
    trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(deadline));
    trigger.classList.add('selected');
    trigger.classList.remove('invalid');
  }
  return true;
}

function openTodoEditor(priority, item = null, anchor = null) {
  const now = new Date();
  const addInput = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  if (!item) applyDefaultTodoDeadline(trigger, now);
  const candidate = item && item.deadline ? new Date(item.deadline) : trigger?.dataset.deadline ? new Date(trigger.dataset.deadline) : null;
  const selectedDate = candidate && Number.isFinite(candidate.getTime())
    ? candidate
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
  todoEditorContext = { priority, id: item && item.id || '', mode: item ? 'edit' : 'add' };
  todoEditorYear = selectedDate.getFullYear();
  todoEditorMonthIndex = selectedDate.getMonth();
  todoEditorDay = selectedDate.getDate();
  fillTodoTimeOptions();
  if (todoEditorHour) todoEditorHour.value = String(selectedDate.getHours());
  if (todoEditorMinute) todoEditorMinute.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5);
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
  if (todoEditorBackdrop) {
    const target = anchor || (item
      ? document.querySelector(`.todo-item[data-id="${CSS.escape(item.id)}"] .todo-inline-deadline`)
      : trigger);
    const quadrant = target?.closest('.quadrant') || document.querySelector(`.quadrant[data-priority="${priority}"]`);
    quadrant?.appendChild(todoEditorBackdrop);
    todoEditorBackdrop.hidden = false;
    todoEditorBackdrop.style.removeProperty('left');
    todoEditorBackdrop.style.removeProperty('top');
    todoEditorBackdrop.style.right = '12px';
    todoEditorBackdrop.style.bottom = '58px';
  }
  applyTodoEditorSelection(false);
}

todoCalendarGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  todoEditorDay = Number(button.dataset.day);
  renderTodoCalendar();
  applyTodoEditorSelection(true);
});
function moveTodoCalendar(offset) {
  const shifted = window.NotchDomain.shiftCalendarMonth({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
  }, offset);
  if (!shifted) return;
  todoEditorYear = shifted.year;
  todoEditorMonthIndex = shifted.month;
  todoEditorDay = Math.min(todoEditorDay, new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate());
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
}

todoCalendarPrevious?.addEventListener('click', () => moveTodoCalendar(-1));
todoCalendarNext?.addEventListener('click', () => moveTodoCalendar(1));
todoEditorHour?.addEventListener('change', () => applyTodoEditorSelection(true));
todoEditorMinute?.addEventListener('change', () => applyTodoEditorSelection(true));

document.addEventListener('pointerdown', (event) => {
  if (todoEditorBackdrop?.hidden) return;
  if (todoEditorBackdrop.contains(event.target) || event.target.closest('.todo-deadline-trigger, .todo-inline-deadline')) return;
  closeTodoEditor();
}, true);

function applyDefaultTodoDeadline(trigger, now = new Date()) {
  if (!trigger || (trigger.dataset.deadline && trigger.dataset.deadlineSource !== 'default')) return;
  const deadline = window.NotchDomain.defaultTodoDeadline(now);
  if (!deadline) return;
  if (trigger.dataset.deadline === deadline && trigger.dataset.deadlineSource === 'default') return;
  trigger.dataset.deadline = deadline;
  trigger.dataset.deadlineSource = 'default';
  trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(deadline));
  trigger.classList.add('selected');
}

function resetTodoDraftDeadline(trigger, now = new Date()) {
  if (!trigger) return;
  delete trigger.dataset.deadline;
  delete trigger.dataset.deadlineSource;
  applyDefaultTodoDeadline(trigger, now);
}

function refreshDefaultTodoDeadlines(now = new Date()) {
  document.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
    if (trigger.dataset.deadlineSource === 'manual') return;
    applyDefaultTodoDeadline(trigger, now);
  });
}

PRIORITIES.forEach((priority) => {
  const input = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const deadlineInput = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  if (!input) return;
  applyDefaultTodoDeadline(deadlineInput);

  const submitTodo = () => {
    const value = input.value;
    if (!value.trim()) return;
    // Sleep or midnight may have passed since the form was rendered.
    applyDefaultTodoDeadline(deadlineInput);
    if (!deadlineInput || !deadlineInput.dataset.deadline) {
      deadlineInput?.classList.add('invalid');
      openTodoEditor(priority);
      return;
    }
    if (!addTodo(priority, value, deadlineInput.dataset.deadline)) {
      deadlineInput.classList.add('invalid');
      showStatusToast('截止时间格式不正确');
      return;
    }
    input.value = '';
    if (todoEditorContext?.mode === 'add' && todoEditorContext.priority === priority) closeTodoEditor();
    resetTodoDraftDeadline(deadlineInput);
    deadlineInput.classList.remove('invalid');
    input.focus({ preventScroll: true });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (e.repeat) return;
    submitTodo();
  });
  input.addEventListener('focus', () => applyDefaultTodoDeadline(deadlineInput));
  deadlineInput?.addEventListener('click', () => openTodoEditor(priority));
});

PRIORITIES.forEach((priority) => {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.shiftKey) {
      e.preventDefault();
      const result = window.NotchDomain.updateRangeSelection(
        window.NotchDomain.sortTodosForDisplay(data[priority] || []).map((todo) => todo.id),
        [...todoSelections[priority]],
        id,
        todoSelectionAnchors[priority],
        true
      );
      todoSelections[priority] = new Set(result.selected);
      todoSelectionAnchors[priority] = result.anchor;
      renderList(priority);
      return;
    }
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      toggleTodo(priority, id);
    } else if (action === 'edit') {
      const todo = (data[priority] || []).find((item) => item.id === id);
      if (todo) {
        editingTodo = { priority, id };
        renderList(priority);
        requestAnimationFrame(() => document.querySelector(`.todo-item[data-id="${CSS.escape(id)}"] .todo-inline-name`)?.focus({ preventScroll: true }));
      }
    } else if (action === 'edit-deadline') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      if (todo) openTodoEditor(priority, todo, target);
    } else if (action === 'save-edit') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      const name = item.querySelector('.todo-inline-name')?.value.trim() || '';
      if (!todo || !name || !todo.deadline) return;
      editingTodo = null;
      editTodo(priority, id, name, todo.deadline);
    } else if (action === 'delete') {
      deleteTodo(priority, id);
    }
  });
  list.addEventListener('keydown', (event) => {
    const item = event.target.closest('.todo-item');
    if (!item || !event.target.matches('.todo-inline-name')) return;
    if (event.key === 'Escape') {
      editingTodo = null;
      renderList(priority);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      item.querySelector('[data-action="save-edit"]')?.click();
    }
  });
});

document.querySelectorAll('.todo-bulk-delete[data-bulk-priority]').forEach((button) => {
  button.addEventListener('click', () => {
    const priority = button.dataset.bulkPriority;
    const selected = todoSelections[priority];
    if (!selected || !selected.size) return;
    data[priority] = (data[priority] || []).filter((item) => !selected.has(item.id));
    selected.clear();
    todoSelectionAnchors[priority] = null;
    saveData(data);
    renderList(priority);
    updateCount(priority);
    showStatusToast('已删除所选待办');
  });
});

// ============ 待办 · 常驻跨天刷新 ============
// Draft dates must not depend on a home clock widget being present or visible.
let todoDefaultRefreshKey = '';

function tickTodoDefaultDeadlines() {
  const now = new Date();
  const refreshKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getTimezoneOffset()}`;
  if (refreshKey !== todoDefaultRefreshKey) {
    todoDefaultRefreshKey = refreshKey;
    refreshDefaultTodoDeadlines(now);
  }
}

tickTodoDefaultDeadlines();
setInterval(tickTodoDefaultDeadlines, 1000);
window.addEventListener('focus', () => refreshDefaultTodoDeadlines());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDefaultTodoDeadlines();
});
document.addEventListener('notch:modechange', (event) => {
  if (event.detail?.expanded) refreshDefaultTodoDeadlines();
});
document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab === 'todo') refreshDefaultTodoDeadlines();
});

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// ============ 首页 · 番茄钟 ============
const pomodoroToggle = document.getElementById('pomodoro-toggle');
const pomodoroReset = document.getElementById('pomodoro-reset');
const homePomodoro = document.getElementById('home-pomodoro');
const pomodoroEndTime = document.getElementById('pomodoro-end-time');
const pomodoroInputs = [
  document.getElementById('pomodoro-minutes'),
  document.getElementById('pomodoro-seconds'),
];
const POMODORO_DURATION_KEY = 'dynamic-panel-pomodoro-duration-v3';
let savedPomodoroParts = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(POMODORO_DURATION_KEY) || 'null');
    if (Array.isArray(value) && value.length === 3) {
      return [
        Math.max(0, Math.min(60, (Number(value[0]) || 0) * 60 + (Number(value[1]) || 0))),
        Math.max(0, Math.min(60, Number(value[2]) || 0)),
      ];
    }
    if (Array.isArray(value) && value.length === 2) {
      return value.map((part) => Math.max(0, Math.min(60, Number(part) || 0)));
    }
  } catch (error) {}
  return [5, 0];
})();
let pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
let pomodoroRemaining = pomodoroConfiguredSeconds;
let pomodoroRunning = false;
let pomodoroStarted = false;
let pomodoroTimer = null;

function secondsToParts(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.min(60, Math.floor(safe / 60)), safe % 60];
}

function setPomodoroInputs(parts) {
  pomodoroInputs.forEach((input, index) => {
    if (!input) return;
    input.value = String(parts[index]).padStart(2, '0');
    input.readOnly = pomodoroRunning;
  });
}

function formatPomodoroEndTime(seconds) {
  const target = new Date(Date.now() + Math.max(0, seconds) * 1000);
  return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
}

function renderPomodoro() {
  setPomodoroInputs(pomodoroStarted ? secondsToParts(pomodoroRemaining) : savedPomodoroParts);
  if (pomodoroEndTime) {
    pomodoroEndTime.textContent = formatPomodoroEndTime(pomodoroStarted ? pomodoroRemaining : pomodoroConfiguredSeconds);
  }
  const remainingRatio = pomodoroStarted
    ? pomodoroRemaining / Math.max(1, pomodoroConfiguredSeconds)
    : 1;
  homePomodoro?.style.setProperty('--pomodoro-progress', String(Math.max(0, Math.min(1, remainingRatio))));
  if (pomodoroToggle) {
    pomodoroToggle.innerHTML = pomodoroRunning
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5z" /></svg>';
    pomodoroToggle.setAttribute('aria-label', pomodoroRunning ? '暂停番茄钟' : '开始番茄钟');
  }
  if (pomodoroReset) pomodoroReset.hidden = !pomodoroStarted;
  homePomodoro?.setAttribute('data-state', pomodoroRunning ? 'running' : (pomodoroStarted ? 'paused' : 'idle'));
}

function commitPomodoroInputs() {
  if (pomodoroRunning) return;
  savedPomodoroParts = pomodoroInputs.map((input) => Math.max(0, Math.min(60, Number.parseInt(input?.value || '0', 10) || 0)));
  pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
  pomodoroRemaining = pomodoroConfiguredSeconds;
  pomodoroStarted = false;
  localStorage.setItem(POMODORO_DURATION_KEY, JSON.stringify(savedPomodoroParts));
  renderPomodoro();
}

pomodoroInputs.forEach((input) => {
  if (!input) return;
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 2);
  });
  input.addEventListener('blur', commitPomodoroInputs);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPomodoroInputs();
      input.blur();
    }
  });
  input.addEventListener('wheel', (event) => {
    if (pomodoroRunning) return;
    event.preventDefault();
    const current = Number.parseInt(input.value || '0', 10) || 0;
    input.value = String(Math.max(0, Math.min(60, current + (event.deltaY < 0 ? 1 : -1)))).padStart(2, '0');
    commitPomodoroInputs();
    input.focus({ preventScroll: true });
    input.select();
  }, { passive: false });
});

pomodoroToggle?.addEventListener('click', () => {
  if (!pomodoroStarted) {
    commitPomodoroInputs();
    if (pomodoroConfiguredSeconds <= 0) {
      showStatusToast('请先设置倒计时时间');
      return;
    }
    pomodoroStarted = true;
    pomodoroRemaining = pomodoroConfiguredSeconds;
  }
  pomodoroRunning = !pomodoroRunning;
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  if (pomodoroRunning) {
    pomodoroTimer = setInterval(() => {
      pomodoroRemaining -= 1;
      if (pomodoroRemaining <= 0) {
        const completedMinutes = Math.max(1, Math.round(pomodoroConfiguredSeconds / 60));
        pomodoroRemaining = pomodoroConfiguredSeconds;
        pomodoroRunning = false;
        pomodoroStarted = false;
        clearInterval(pomodoroTimer);
        pomodoroTimer = null;
        showStatusToast(`${completedMinutes} 分钟专注完成`);
        window.notchAPI?.notifyPomodoro?.(completedMinutes).catch(() => {});
      }
      renderPomodoro();
    }, 1000);
  }
  renderPomodoro();
});

pomodoroReset?.addEventListener('click', () => {
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
  pomodoroRunning = false;
  pomodoroStarted = false;
  pomodoroRemaining = pomodoroConfiguredSeconds;
  renderPomodoro();
});
renderPomodoro();

// ============ 首页 · Markdown 速记 ============
// textarea 中的原始 Markdown 始终是唯一数据源；预览只用 DOM API + textContent 构建，
// 不执行用户输入的 HTML，也不自动加载远程图片。
const NOTE_KEY = 'notch-home-note';
const NOTE_ARCHIVE_KEY = 'notch-note-archive-v1';
const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
const noteInput = document.getElementById('home-note');
const notePreview = document.getElementById('home-note-preview');
const noteSaveButton = document.getElementById('note-save-btn');
const notesList = document.getElementById('notes-list');
const notesSearch = document.getElementById('notes-search');
const notesDetail = document.getElementById('notes-detail');
const notesCount = document.getElementById('notes-count');
const notesNewButton = document.getElementById('notes-new');
const noteFormatActions = document.getElementById('note-format-actions');
const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
const noteEditButton = document.getElementById('note-edit-btn');
const homeNote = document.querySelector('.home-note');

const NOTE_INLINE_PATTERNS = [
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
  { type: 'strong', regex: /__([^_\n]+)__/g },
  { type: 'delete', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
  { type: 'emphasis', regex: /_([^_\n]+)_/g },
];

const NOTE_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const NOTE_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NOTE_ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const NOTE_QUOTE_RE = /^\s*>\s?(.*)$/;
const NOTE_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+)$/;
const NOTE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
const NOTE_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function findNextInlineToken(text, fromIndex) {
  let next = null;
  NOTE_INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = fromIndex;
    const match = pattern.regex.exec(text);
    if (
      match &&
      (!next || match.index < next.match.index ||
        (match.index === next.match.index && priority < next.priority))
    ) {
      next = { type: pattern.type, match, priority };
    }
  });
  return next;
}

function safeMarkdownUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function appendInlineMarkdown(parent, source, depth = 0) {
  const text = String(source || '');
  if (!text || depth > 6) {
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      parent.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    const { type, match } = token;
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (type === 'code') {
      const code = document.createElement('code');
      code.textContent = match[1];
      parent.append(code);
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (!href) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const link = document.createElement('a');
        link.dataset.noteHref = href;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.rel = 'noreferrer';
        appendInlineMarkdown(link, match[1], depth + 1);
        parent.append(link);
      }
    } else {
      const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
      const formatted = document.createElement(tagName);
      appendInlineMarkdown(formatted, match[1], depth + 1);
      parent.append(formatted);
    }

    cursor = match.index + match[0].length;
  }
}

function appendMarkdownLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index > 0) parent.append(document.createElement('br'));
    appendInlineMarkdown(parent, line);
  });
}

function isMarkdownBlockStart(line) {
  if (!line.trim()) return true;
  return (
    NOTE_FENCE_RE.test(line) ||
    NOTE_HEADING_RE.test(line) ||
    NOTE_QUOTE_RE.test(line) ||
    NOTE_TASK_RE.test(line) ||
    NOTE_ORDERED_RE.test(line) ||
    NOTE_BULLET_RE.test(line) ||
    NOTE_RULE_RE.test(line)
  );
}

function buildMarkdownPreview(source) {
  const fragment = document.createDocumentFragment();
  const normalized = String(source || '').replace(/\r\n?/g, '\n');

  if (!normalized.trim()) {
    return fragment;
  }

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(NOTE_FENCE_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closeFence.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(NOTE_HEADING_RE);
    if (headingMatch) {
      const heading = document.createElement('h' + headingMatch[1].length);
      appendInlineMarkdown(heading, headingMatch[2]);
      fragment.append(heading);
      index += 1;
      continue;
    }

    if (NOTE_RULE_RE.test(line)) {
      fragment.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(NOTE_QUOTE_RE);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(NOTE_QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      const quote = document.createElement('blockquote');
      appendMarkdownLines(quote, quoteLines);
      fragment.append(quote);
      continue;
    }

    const taskMatch = line.match(NOTE_TASK_RE);
    if (taskMatch) {
      const list = document.createElement('ul');
      list.className = 'note-task-list';
      while (index < lines.length) {
        const match = lines[index].match(NOTE_TASK_RE);
        if (!match) break;
        const done = match[1].toLowerCase() === 'x';
        const item = document.createElement('li');
        item.className = 'note-task-item' + (done ? ' done' : '');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(done));
        const box = document.createElement('span');
        box.className = 'note-task-box';
        box.setAttribute('aria-hidden', 'true');
        box.textContent = done ? '✓' : '';
        const content = document.createElement('span');
        appendInlineMarkdown(content, match[2]);
        item.append(box, content);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const orderedMatch = line.match(NOTE_ORDERED_RE);
    if (orderedMatch) {
      const list = document.createElement('ol');
      const start = Number.parseInt(orderedMatch[1], 10);
      if (Number.isFinite(start) && start !== 1) list.start = start;
      while (index < lines.length) {
        const match = lines[index].match(NOTE_ORDERED_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const bulletMatch = line.match(NOTE_BULLET_RE);
    if (bulletMatch) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        if (NOTE_TASK_RE.test(lines[index])) break;
        const match = lines[index].match(NOTE_BULLET_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[1]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendMarkdownLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}

function renderNotePreview() {
  if (!noteInput || !notePreview) return;
  notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
}

function replaceNoteText(
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd,
  selectionDirection = 'none'
) {
  if (!noteInput) return;
  noteInput.setRangeText(replacement, start, end, 'end');
  noteInput.focus({ preventScroll: true });
  noteInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapNoteSelection(open, close, placeholder) {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);

  const hasOuterMarkers =
    selected &&
    start >= open.length &&
    noteInput.value.slice(start - open.length, start) === open &&
    noteInput.value.slice(end, end + close.length) === close;
  if (hasOuterMarkers) {
    replaceNoteText(
      start - open.length,
      end + close.length,
      selected,
      start - open.length,
      end - open.length,
      direction
    );
    return;
  }

  if (selected && selected.startsWith(open) && selected.endsWith(close)) {
    const unwrapped = selected.slice(open.length, selected.length - close.length);
    replaceNoteText(start, end, unwrapped, start, start + unwrapped.length, direction);
    return;
  }

  const content = selected || placeholder;
  const replacement = open + content + close;
  replaceNoteText(
    start,
    end,
    replacement,
    start + open.length,
    start + open.length + content.length,
    direction
  );
}

function stripNoteBlockPrefix(line) {
  return line.replace(
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/,
    ''
  );
}

function applyNoteLineFormat(type) {
  if (!noteInput) return;
  const value = noteInput.value;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd;
  if (end > start && value[end - 1] === '\n') {
    lineEnd = end - 1;
  } else {
    const nextBreak = value.indexOf('\n', end);
    lineEnd = nextBreak === -1 ? value.length : nextBreak;
  }

  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const matchers = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
    ordered: /^\d+[.)]\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };
  const matcher = matchers[type];
  if (!matcher) return;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => matcher.test(line.trimStart()));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    if (shouldRemove) return indentation + body.replace(matcher, '');
    const content = stripNoteBlockPrefix(body) || (
      type === 'heading' ? '标题' :
      type === 'task' ? '待办' :
      type === 'quote' ? '引用' : '项目'
    );
    if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
    if (type === 'heading') return indentation + '# ' + content;
    if (type === 'task') return indentation + '- [ ] ' + content;
    if (type === 'quote') return indentation + '> ' + content;
    return indentation + '- ' + content;
  }).join('\n');

  const emptySingleLine = lines.length === 1 && !original.trim() && !shouldRemove;
  let nextStart = lineStart;
  let nextEnd = lineStart + transformed.length;
  if (emptySingleLine) {
    const indentationLength = original.match(/^\s*/)[0].length;
    const prefixLength =
      type === 'heading' ? 2 :
      type === 'task' ? 6 :
      type === 'ordered' ? 3 : 2;
    nextStart += indentationLength + prefixLength;
  }
  replaceNoteText(lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
}

function applyNoteLink() {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);
  const label = selected || '链接文字';
  const url = 'https://';
  const replacement = '[' + label + '](' + url + ')';
  if (selected) {
    const urlStart = start + label.length + 3;
    replaceNoteText(start, end, replacement, urlStart, urlStart + url.length, direction);
  } else {
    replaceNoteText(start, end, replacement, start + 1, start + 1 + label.length, direction);
  }
}

let noteComposing = false;

function applyNoteFormat(type) {
  if (!noteInput || noteComposing) return;
  if (type === 'bold') return wrapNoteSelection('**', '**', '加粗文字');
  if (type === 'italic') return wrapNoteSelection('*', '*', '斜体文字');
  if (type === 'code') return wrapNoteSelection('`', '`', '代码');
  if (type === 'link') return applyNoteLink();
  applyNoteLineFormat(type);
}

let noteMode = 'edit';
let noteSelection = { start: 0, end: 0, direction: 'none', scrollTop: 0 };

function setNoteMode(mode, focusTarget = true) {
  if (!noteInput || !notePreview) return;
  const previousMode = noteMode;
  noteMode = mode === 'preview' ? 'preview' : 'edit';
  const isPreview = noteMode === 'preview';

  if (isPreview) {
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
    renderNotePreview();
  } else if (previousMode === 'edit') {
    // 重复点击已选中的“编辑”时保留用户当下光标，而不是恢复旧选区。
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
  }

  noteInput.hidden = isPreview;
  notePreview.hidden = !isPreview;
  if (noteFormatActions) noteFormatActions.hidden = isPreview;
  if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
  noteModeButtons.forEach((button) => {
    const active = button.dataset.noteMode === noteMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (noteEditButton) {
    noteEditButton.classList.toggle('active', !isPreview);
    noteEditButton.textContent = isPreview ? '编辑' : '完成';
    noteEditButton.setAttribute('aria-pressed', String(!isPreview));
  }

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) {
      notePreview.focus({ preventScroll: true });
    } else {
      noteInput.focus({ preventScroll: true });
      noteInput.setSelectionRange(
        noteSelection.start,
        noteSelection.end,
        noteSelection.direction
      );
      noteInput.scrollTop = noteSelection.scrollTop;
    }
  });
}

function continueNoteList(event) {
  if (
    !noteInput ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing ||
    noteInput.selectionStart !== noteInput.selectionEnd
  ) {
    return false;
  }

  const value = noteInput.value;
  const cursor = noteInput.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const patterns = [
    {
      regex: /^(\s*)[-*+]\s+\[[ xX]\]\s*(.*)$/,
      prefix: () => '- [ ] ',
    },
    {
      regex: /^(\s*)(\d+)[.)]\s+(.*)$/,
      prefix: (match) => String(Number.parseInt(match[2], 10) + 1) + '. ',
    },
    {
      regex: /^(\s*)[-*+]\s+(.*)$/,
      prefix: () => '- ',
    },
    {
      regex: /^(\s*)>\s?(.*)$/,
      prefix: () => '> ',
    },
  ];

  const definition = patterns.find((candidate) => candidate.regex.test(line));
  if (!definition) return false;
  const match = line.match(definition.regex);
  const content = match[match.length - 1];
  const indentation = match[1];
  event.preventDefault();

  if (!content.trim()) {
    replaceNoteText(
      lineStart,
      lineEnd,
      indentation,
      lineStart + indentation.length,
      lineStart + indentation.length
    );
    return true;
  }

  const prefix = indentation + definition.prefix(match);
  const insertion = '\n' + prefix;
  replaceNoteText(cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

if (noteInput) {
  try {
    noteInput.value = localStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    // ignore
  }

  let noteTimer = null;
  const saveNote = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    if (workspaceReloadPending) return;
    try {
      localStorage.setItem(NOTE_KEY, noteInput.value);
    } catch (e) {
      // ignore quota errors
    }
  };

  noteInput.addEventListener('input', () => {
    if (!noteInput.value.trim()) localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    renderNotePreview();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 300);
  });
  noteInput.addEventListener('blur', saveNote);
  noteInput.addEventListener('compositionstart', () => {
    noteComposing = true;
  });
  noteInput.addEventListener('compositionend', () => {
    noteComposing = false;
  });
  noteInput.addEventListener('keydown', (event) => {
    if (continueNoteList(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    applyNoteFormat(key === 'b' ? 'bold' : 'italic');
  });

  window.addEventListener('beforeunload', saveNote);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNote();
  });

  noteInput.hidden = false;
}

function loadNoteArchive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTE_ARCHIVE_KEY) || '[]');
    return window.NotchDomain.normalizeNoteArchive(parsed);
  } catch (error) {
    return [];
  }
}

let selectedNoteId = '';

function noteArchiveTitle(note) {
  return String(note && note.title || '').trim() || '未命名笔记';
}

function noteArchiveExcerpt(note) {
  const lines = String(note && note.content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.join(' ').replace(/[#*_~`>\[\]]/g, '').slice(0, 86);
}

function noteArchiveTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

let notesDetailMode = 'edit';

function syncNotesDetailModeButtons() {
  if (!notesDetail) return;
  notesDetail.querySelectorAll('[data-notes-mode]').forEach((button) => {
    const active = button.dataset.notesMode === notesDetailMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setNotesDetailMode(mode, focusTarget = true) {
  if (!notesDetail) return;
  const next = mode === 'preview' ? 'preview' : 'edit';
  const editor = notesDetail.querySelector('#notes-editor');
  const preview = notesDetail.querySelector('#notes-preview');
  if (!editor || !preview) {
    notesDetailMode = next;
    return;
  }

  if (next === 'preview') {
    flushNotesEditorSave();
    preview.replaceChildren(buildMarkdownPreview(editor.value));
  }

  notesDetailMode = next;
  const isPreview = notesDetailMode === 'preview';
  editor.hidden = isPreview;
  preview.hidden = !isPreview;
  notesDetail.classList.toggle('is-preview', isPreview);
  syncNotesDetailModeButtons();

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) preview.focus({ preventScroll: true });
    else editor.focus({ preventScroll: true });
  });
}

let notesDetailOpenedId = '';

function defaultNotesDetailMode(note) {
  return String(note?.content || '').trim() ? 'preview' : 'edit';
}

function renderNotesDetail(notes = loadNoteArchive()) {
  if (!notesDetail) return;
  notesDetail.replaceChildren();
  notesDetail.classList.remove('is-preview');
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) {
    notesDetailOpenedId = '';
    const empty = document.createElement('div');
    empty.className = 'notes-detail-empty';
    const hasArchive = loadNoteArchive().length > 0;
    empty.innerHTML = hasArchive
      ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的笔记</strong><p>试试搜索其他关键词。</p>'
      : '<span class="notes-empty-mark" aria-hidden="true">✎</span><strong>还没有保存的笔记</strong><p>点击「新建」即可开始记录。</p>';
    notesDetail.append(empty);
    return;
  }

  if (notesDetailOpenedId !== note.id) {
    notesDetailOpenedId = note.id;
    notesDetailMode = defaultNotesDetailMode(note);
  }

  const header = document.createElement('header');
  header.className = 'notes-detail-head';
  const heading = document.createElement('div');
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'notes-detail-title';
  title.dataset.noteId = note.id;
  title.value = String(note.title || '');
  title.placeholder = '未命名笔记';
  title.maxLength = 80;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.setAttribute('aria-label', '笔记标题，可直接修改');
  const time = document.createElement('time');
  time.className = 'notes-detail-time';
  time.textContent = `更新于 ${noteArchiveTime(note.updatedAt)}`;
  heading.append(title, time);
  const actions = document.createElement('div');
  actions.className = 'notes-detail-actions';

  const modeSwitch = document.createElement('div');
  modeSwitch.className = 'note-mode-switch notes-detail-mode-switch';
  modeSwitch.setAttribute('role', 'group');
  modeSwitch.setAttribute('aria-label', '预览或编辑');
  ;[
    ['preview', '预览'],
    ['edit', '编辑'],
  ].forEach(([mode, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-mode' + (notesDetailMode === mode ? ' active' : '');
    button.dataset.notesMode = mode;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(notesDetailMode === mode));
    modeSwitch.append(button);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'notes-delete';
  remove.dataset.action = 'delete-note';
  remove.setAttribute('aria-label', '删除笔记');
  remove.title = '删除笔记';
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h10l1-12"/></svg>';
  actions.append(modeSwitch, remove);
  header.append(heading, actions);

  const body = document.createElement('div');
  body.className = 'notes-detail-body';

  const editor = document.createElement('textarea');
  editor.id = 'notes-editor';
  editor.className = 'notes-editor';
  editor.dataset.noteId = note.id;
  editor.value = note.content;
  editor.placeholder = '用 Markdown 写笔记…';
  editor.setAttribute('aria-label', `编辑笔记：${noteArchiveTitle(note)}`);
  editor.spellcheck = false;

  const preview = document.createElement('div');
  preview.id = 'notes-preview';
  preview.className = 'note-preview notes-preview';
  preview.tabIndex = 0;
  preview.setAttribute('aria-label', `预览笔记：${noteArchiveTitle(note)}`);
  preview.replaceChildren(buildMarkdownPreview(note.content));

  const isPreview = notesDetailMode === 'preview';
  editor.hidden = isPreview;
  preview.hidden = !isPreview;
  notesDetail.classList.toggle('is-preview', isPreview);

  body.append(editor, preview);
  notesDetail.append(header, body);
  requestNoteTitle(note);
}

let notesSaveTimer = null;
let pendingNotesEditor = null;
const noteTitleAttempts = new Set();

async function requestNoteTitle(note) {
  if (
    !note
    || note.title
    || note.titleSource === 'user'
    || !String(note.content || '').trim()
    || noteTitleAttempts.has(note.id)
    || !window.notchAPI?.organizeMaterial
  ) return;
  noteTitleAttempts.add(note.id);
  const expectedContent = note.content;
  const result = await window.notchAPI.organizeMaterial({ kind: 'note', text: expectedContent }).catch(() => null);
  if (!result?.ok || !result.title) {
    noteTitleAttempts.delete(note.id);
    return;
  }
  const next = window.NotchDomain.applyGeneratedNoteTitle(
    loadNoteArchive(),
    note.id,
    result.title,
    expectedContent
  );
  const updated = next.find((item) => item.id === note.id);
  if (!updated?.title || updated.titleSource !== 'model') {
    noteTitleAttempts.delete(note.id);
    return;
  }
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next.slice(0, 200)));
  renderNotesLibrary();
}

function updateSavedNotePresentation(note) {
  if (!note) return;
  const title = noteArchiveTitle(note);
  const detailTitle = notesDetail?.querySelector('.notes-detail-title');
  const detailTime = notesDetail?.querySelector('.notes-detail-time');
  if (detailTitle && document.activeElement !== detailTitle) detailTitle.value = note.title || '';
  if (detailTime) detailTime.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  const row = notesList?.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!row) return;
  const rowTitle = row.querySelector('strong');
  const rowExcerpt = row.querySelector('span');
  const rowTime = row.querySelector('time');
  if (rowTitle) rowTitle.textContent = title;
  if (rowExcerpt) rowExcerpt.textContent = noteArchiveExcerpt(note);
  if (rowTime) rowTime.textContent = noteArchiveTime(note.updatedAt);
}

function persistNotesEditor(editor) {
  if (!editor || !editor.dataset.noteId) return;
  const notes = window.NotchDomain.updateNoteInArchive(
    loadNoteArchive(),
    editor.dataset.noteId,
    editor.value,
    Date.now()
  );
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  const updated = notes.find((note) => note.id === editor.dataset.noteId);
  if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === editor.dataset.noteId && noteInput) {
    noteInput.value = editor.value;
    localStorage.setItem(NOTE_KEY, editor.value);
    renderNotePreview();
  }
  updateSavedNotePresentation(updated);
  if (pendingNotesEditor === editor) pendingNotesEditor = null;
}

function flushNotesEditorSave() {
  if (workspaceReloadPending) return;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  const editor = pendingNotesEditor;
  pendingNotesEditor = null;
  if (editor) persistNotesEditor(editor);
}

function scheduleNotesEditorSave(editor) {
  pendingNotesEditor = editor;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在保存…';
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    const pending = pendingNotesEditor;
    pendingNotesEditor = null;
    if (pending) persistNotesEditor(pending);
  }, 220);
}

function renderNotesLibrary() {
  if (!notesList) return;
  const archive = loadNoteArchive();
  const notes = window.NotchDomain.filterNotes(archive, notesSearch?.value || '');
  if (notesCount) notesCount.textContent = `${archive.length} 篇`;
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0]?.id || '';
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    empty.textContent = archive.length ? '没有找到相关笔记' : '保存的笔记会出现在这里';
    notesList.append(empty);
    renderNotesDetail(notes);
    return;
  }
  notes.forEach((note) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notes-list-item${note.id === selectedNoteId ? ' active' : ''}`;
    button.dataset.noteId = note.id;
    button.dataset.lineSidebarItem = '';
    button.setAttribute('aria-pressed', String(note.id === selectedNoteId));
    const title = document.createElement('strong');
    title.textContent = noteArchiveTitle(note);
    const excerpt = document.createElement('span');
    excerpt.textContent = noteArchiveExcerpt(note);
    const time = document.createElement('time');
    time.textContent = noteArchiveTime(note.updatedAt);
    button.append(title, excerpt, time);
    notesList.append(button);
  });
  renderNotesDetail(notes);
}

notesNewButton?.addEventListener('click', () => {
  flushNotesEditorSave();
  const now = Date.now();
  const note = {
    id: generateId(),
    title: '',
    titleSource: '',
    content: '',
    createdAt: now,
    updatedAt: now,
  };
  const notes = [note, ...loadNoteArchive()].slice(0, 200);
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
  selectedNoteId = note.id;
  notesDetailMode = 'edit';
  if (notesSearch) notesSearch.value = '';
  renderNotesLibrary();
  requestAnimationFrame(() => {
    notesDetail?.querySelector('#notes-editor')?.focus({ preventScroll: true });
  });
  showStatusToast('已新建笔记');
});

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast('先写点内容再存档');
    return;
  }
  const notes = loadNoteArchive();
  let activeId = localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) || '';
  const existing = notes.find((item) => item.id === activeId);
  if (existing) {
    existing.content = content;
    existing.updatedAt = Date.now();
  } else {
    activeId = generateId();
    notes.unshift({ id: activeId, content, createdAt: Date.now(), updatedAt: Date.now() });
  }
  localStorage.setItem(NOTE_ACTIVE_ARCHIVE_KEY, activeId);
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  localStorage.setItem(NOTE_KEY, noteInput.value);
  selectedNoteId = activeId;
  renderNotesLibrary();
  showStatusToast('笔记已保存');
});

notesList?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-note-id]');
  if (!row) return;
  flushNotesEditorSave();
  selectedNoteId = row.dataset.noteId;
  renderNotesLibrary();
});

notesSearch?.addEventListener('input', () => {
  flushNotesEditorSave();
  renderNotesLibrary();
});

notesDetail?.addEventListener('input', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const notes = window.NotchDomain.updateNoteTitle(
      loadNoteArchive(),
      title.dataset.noteId,
      title.value,
      Date.now()
    );
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
    updateSavedNotePresentation(notes.find((note) => note.id === title.dataset.noteId));
    return;
  }
  const editor = event.target.closest('#notes-editor');
  if (editor) scheduleNotesEditorSave(editor);
});

notesDetail?.addEventListener('focusout', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const note = loadNoteArchive().find((item) => item.id === title.dataset.noteId);
    if (note) title.value = note.title;
  }
  if (event.target.closest('#notes-editor')) flushNotesEditorSave();
});

notesDetail?.addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-notes-mode]');
  if (modeButton) {
    setNotesDetailMode(modeButton.dataset.notesMode);
    return;
  }

  const link = event.target.closest('#notes-preview [data-note-href]');
  if (link) {
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  flushNotesEditorSave();
  const notes = loadNoteArchive();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) return;
  if (action === 'delete-note') {
    const next = notes.filter((item) => item.id !== note.id);
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next));
    if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === note.id) {
      localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    }
    selectedNoteId = next[0]?.id || '';
    renderNotesLibrary();
    showStatusToast('笔记已删除');
    return;
  }
});

document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab !== 'notes') flushNotesEditorSave();
});
window.addEventListener('beforeunload', flushNotesEditorSave);

if (noteFormatActions) {
  noteFormatActions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-note-format]')) event.preventDefault();
  });
  noteFormatActions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-format]');
    if (!button) return;
    applyNoteFormat(button.dataset.noteFormat);
  });
}

noteModeButtons.forEach((button) => {
  button.addEventListener('click', () => setNoteMode(button.dataset.noteMode));
});
noteEditButton?.addEventListener('click', () => setNoteMode(noteMode === 'preview' ? 'edit' : 'preview'));

// 已有内容默认预览，空白速记默认编辑
if (noteInput && notePreview) {
  setNoteMode(noteInput.value.trim() ? 'preview' : 'edit', false);
}

if (notePreview) {
  notePreview.addEventListener('click', (event) => {
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
  notePreview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
}


// ============ 首页 · Cursor 用量 ============
const cursorUsageRefresh = document.getElementById('cursor-usage-refresh');
const cursorUsageFootnote = document.getElementById('cursor-usage-footnote');
let cursorUsageTimer = null;
let cursorUsageInFlight = false;

function formatCursorPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--%';
  return `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
}

function formatCursorDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function cursorUsageLevel(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return 'ok';
  if (n >= 95) return 'critical';
  if (n >= 80) return 'warn';
  return 'ok';
}

function paintCursorUsagePool(pool, percent) {
  const row = document.querySelector(`.cursor-usage-row[data-pool="${pool}"]`);
  const pctEl = document.getElementById(`cursor-usage-${pool === 'grok' ? 'grok' : pool}-pct`);
  const fillEl = document.getElementById(`cursor-usage-${pool === 'grok' ? 'grok' : pool}-fill`);
  const n = Number(percent);
  if (pctEl) pctEl.textContent = formatCursorPercent(n);
  if (fillEl) fillEl.style.width = Number.isFinite(n) ? `${Math.max(0, Math.min(100, n))}%` : '0%';
  if (row) row.dataset.level = cursorUsageLevel(n);
}

async function refreshCursorUsage({ force = false } = {}) {
  if (!window.notchAPI || typeof window.notchAPI.getCursorUsage !== 'function') {
    if (cursorUsageFootnote) cursorUsageFootnote.textContent = '当前环境不支持读取 Cursor 用量';
    return;
  }
  if (cursorUsageInFlight) return;
  cursorUsageInFlight = true;
  cursorUsageRefresh?.classList.add('is-loading');
  try {
    const data = await window.notchAPI.getCursorUsage({ force });
    if (!data || data.ok !== true) {
      paintCursorUsagePool('auto', null);
      paintCursorUsagePool('other', null);
      paintCursorUsagePool('grok', null);
      let reason = '暂时读不到用量，点刷新重试';
      if (data && data.error === 'cursor_manual_token_invalid') {
        reason = '手动 Token 已失效，且本机登录态也不可用';
      } else if (data && data.error === 'cursor_db_missing') {
        reason = data.manualTokenInvalid
          ? '手动 Token 已失效，且未找到本机 Cursor 登录数据'
          : '未找到本机 Cursor 登录数据';
      } else if (data && data.error === 'cursor_token_missing') {
        reason = data.manualTokenInvalid
          ? '手动 Token 已失效，请先在 Cursor 里登录账号'
          : '请先在 Cursor 里登录账号';
      } else if (data && data.manualTokenInvalid) {
        reason = '手动 Token 已失效，本机回退也失败';
      }
      if (cursorUsageFootnote) cursorUsageFootnote.textContent = reason;
      return;
    }
    paintCursorUsagePool('auto', data.auto && data.auto.percent);
    paintCursorUsagePool('other', data.other && data.other.percent);
    paintCursorUsagePool('grok', data.grokBot && data.grokBot.percent);
    const cycleEnd = formatCursorDate(data.billing && data.billing.cycleEnd);
    const grokReset = formatCursorDate(data.grokBot && data.grokBot.resetAt);
    const bits = [];
    if (data.manualTokenInvalid) bits.push('手动 Token 已失效，已改用本机');
    else if (data.warning) bits.push(data.warning);
    else if (data.authSource === 'manual') bits.push('手动 Token');
    if (cycleEnd) bits.push(`账期至 ${cycleEnd}`);
    if (grokReset) bits.push(`Grok 周重置 ${grokReset}`);
    if (data.cached) bits.push('缓存');
    if (cursorUsageFootnote) cursorUsageFootnote.textContent = bits.join(' · ') || '已更新';
  } catch (error) {
    if (cursorUsageFootnote) cursorUsageFootnote.textContent = '读取失败，点刷新重试';
  } finally {
    cursorUsageInFlight = false;
    cursorUsageRefresh?.classList.remove('is-loading');
  }
}

function startCursorUsagePolling() {
  refreshCursorUsage({ force: false });
  if (cursorUsageTimer) clearInterval(cursorUsageTimer);
  cursorUsageTimer = setInterval(() => refreshCursorUsage({ force: false }), 5 * 60 * 1000);
}

cursorUsageRefresh?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  refreshCursorUsage({ force: true });
});

if (document.getElementById('home-cursor')) {
  startCursorUsagePolling();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshCursorUsage({ force: false });
  });
  document.addEventListener('notch:cursor-token-changed', () => {
    refreshCursorUsage({ force: true });
  });
}

// ============ 首页 · 自适应 Bento 布局（长按换位 + 迷你/小/中/大组件） ============
const HOME_ORDER_KEY = 'notch-home-order-v3';
const HOME_SIZES_KEY = 'notch-home-widget-sizes-v2';
const HOME_PLACEMENTS_KEY = 'notch-home-placements-v1';
const HOME_HIDDEN_MODULES_KEY = 'notch-home-hidden-modules-v1';
const HOME_MODULE_REGISTRY = ['music', 'pomodoro', 'cursor', 'recorder', 'windows', 'mirror', 'note', 'commands'];
const unavailableHomeModules = window.NotchPlatform.capabilities(window.notchAPI?.platform || 'darwin').unavailableHomeModules;
const effectiveHomeHidden = (hidden) => window.NotchPlatform.effectiveHiddenModules(hidden, HOME_MODULE_REGISTRY, unavailableHomeModules);
const HOME_ORDER_DEFAULTS = ['music', 'pomodoro', 'cursor', 'windows', 'recorder', 'mirror', 'note', 'commands'];
const HOME_SIZE_DEFAULTS = {
  music: 'small',
  windows: 'large',
  recorder: 'small',
  mirror: 'medium',
  note: 'medium',
  commands: 'mini',
  pomodoro: 'mini',
  cursor: 'small',
};
const HOME_SIZE_LABELS = { mini: '迷你', small: '小', medium: '中', large: '大' };
const homeBento = document.getElementById('home-bento');
const homeContextMenu = document.getElementById('home-context-menu');
const homeTabPanel = document.getElementById('tab-home');

function bindHomeTilePointerGlow(bento) {
  if (!bento || bento.dataset.tileGlowBound === 'true') return;
  bento.dataset.tileGlowBound = 'true';
  bento.addEventListener('pointermove', (event) => {
    const tile = event.target.closest?.('.home-bento > .tile');
    if (!tile || !bento.contains(tile)) return;
    const rect = tile.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * 100;
    tile.style.setProperty('--tile-x', `${x.toFixed(2)}%`);
    tile.style.setProperty('--tile-y', `${y.toFixed(2)}%`);
  });
}
bindHomeTilePointerGlow(homeBento);

const homeTiles = homeBento
  ? Array.from(homeBento.querySelectorAll('[data-home-module]'))
  : [];

function loadHomeOrder() {
  try {
    const rawSaved = JSON.parse(localStorage.getItem(HOME_ORDER_KEY) || 'null');
    const saved = Array.isArray(rawSaved)
      ? rawSaved.map((id) => id === 'character' ? 'music' : id)
      : rawSaved;
    if (Array.isArray(saved) && saved.length) {
      const normalized = [];
      saved.forEach((id) => {
        if (HOME_ORDER_DEFAULTS.includes(id) && !normalized.includes(id)) normalized.push(id);
      });
      HOME_ORDER_DEFAULTS.forEach((id) => {
        if (!normalized.includes(id)) normalized.push(id);
      });
      if (normalized.length === HOME_ORDER_DEFAULTS.length) return normalized;
    }

    // 从旧固定槽位布局平滑迁移；原时钟 / 人物位置由音乐组件接管。
    const legacy = JSON.parse(localStorage.getItem('notch-home-layout-v2') || 'null');
    const legacySlots = ['tall-left', 'small-top', 'medium-top', 'square-top', 'tall-right', 'wide-bottom'];
    if (legacy && typeof legacy === 'object') {
      const migrated = Object.entries(legacy)
        .sort((a, b) => legacySlots.indexOf(a[1]) - legacySlots.indexOf(b[1]))
        .map(([id]) => id === 'clock' || id === 'character' ? 'music' : id)
        .filter((id) => HOME_ORDER_DEFAULTS.includes(id));
      const normalized = [];
      migrated.forEach((id) => {
        if (!normalized.includes(id)) normalized.push(id);
      });
      HOME_ORDER_DEFAULTS.forEach((id) => {
        if (!normalized.includes(id)) normalized.push(id);
      });
      if (normalized.length === HOME_ORDER_DEFAULTS.length) return normalized;
    }
  } catch (error) {
    // 使用默认顺序。
  }
  return [...HOME_ORDER_DEFAULTS];
}

function loadHomeSizes() {
  try {
    return window.NotchDomain.normalizeHomeWidgetSizes(
      JSON.parse(localStorage.getItem(HOME_SIZES_KEY) || 'null'),
      HOME_SIZE_DEFAULTS,
      ''
    );
  } catch (error) {
    return { ...HOME_SIZE_DEFAULTS };
  }
}

function loadHiddenHomeModules() {
  try {
    const rawText = localStorage.getItem(HOME_HIDDEN_MODULES_KEY);
    if (rawText === null) return { hiddenIds: [], needsRepair: false };
    const parsed = JSON.parse(rawText);
    const hiddenIds = window.NotchDomain.normalizeHiddenHomeModules(parsed, HOME_MODULE_REGISTRY);
    return {
      hiddenIds,
      needsRepair: JSON.stringify(parsed) !== JSON.stringify(hiddenIds),
    };
  } catch (error) {
    return { hiddenIds: [], needsRepair: true };
  }
}

function cloneHomeLayout(layout) {
  if (!layout || !layout.placements) return null;
  return {
    allowGaps: layout.allowGaps !== false,
    placements: Object.fromEntries(
      Object.entries(layout.placements).map(([id, item]) => [id, { ...item }])
    ),
    variants: { ...(layout.variants || {}) },
  };
}

function sizeFromPlacement(placement) {
  const width = Number(placement?.width) || 0;
  const height = Number(placement?.height) || 0;
  if (width <= 2 && height <= 1) return 'mini';
  if (width <= 2 && height <= 2) return 'small';
  if (width <= 4 && height <= 2) return 'medium';
  return 'large';
}

function loadHomePlacements() {
  try {
    const raw = JSON.parse(localStorage.getItem(HOME_PLACEMENTS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const placements = {};
    Object.entries(raw).forEach(([id, item]) => {
      if (!HOME_MODULE_REGISTRY.includes(id) || !item || typeof item !== 'object') return;
      const column = Number(item.column);
      const row = Number(item.row);
      const width = Number(item.width);
      const height = Number(item.height);
      if (![column, row, width, height].every(Number.isInteger)) return;
      if (width < 1 || height < 1) return;
      placements[id] = { column, row, width, height };
    });
    if (!Object.keys(placements).length) return null;
    return {
      allowGaps: true,
      placements,
      variants: Object.fromEntries(
        Object.entries(placements).map(([id, item]) => [id, window.NotchDomain.layoutVariantForPlacement(item)])
      ),
    };
  } catch (error) {
    return null;
  }
}

let homeOrder = loadHomeOrder();
let homeSizes = loadHomeSizes();
let homeWorkingLayout = loadHomePlacements();
const loadedHomeVisibility = loadHiddenHomeModules();
let hiddenHomeModules = loadedHomeVisibility.hiddenIds;
let homeVisibilityPersisted = true;
let homeLayoutReadOnly = false;
let homeLayoutMotionGeneration = 0;
let homeLayoutMotionAnimations = [];
const HOME_LAYOUT_MOTION_MS = 780;
const HOME_LAYOUT_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function saveHomeLayout() {
  try {
    localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(homeOrder));
    localStorage.setItem(HOME_SIZES_KEY, JSON.stringify(homeSizes));
    if (homeWorkingLayout?.placements) {
      localStorage.setItem(HOME_PLACEMENTS_KEY, JSON.stringify(homeWorkingLayout.placements));
    }
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话内的布局。
  }
}

function saveHiddenHomeModules() {
  try {
    localStorage.setItem(HOME_HIDDEN_MODULES_KEY, JSON.stringify(hiddenHomeModules));
    homeVisibilityPersisted = true;
    return true;
  } catch (error) {
    homeVisibilityPersisted = false;
    return false;
  }
}

if (loadedHomeVisibility.needsRepair) saveHiddenHomeModules();

function resolveValidatedHomeLayout(hiddenIds, order = homeOrder, sizes = homeSizes, { forcePack = false } = {}) {
  hiddenIds = effectiveHomeHidden(hiddenIds);
  const visibleIds = HOME_MODULE_REGISTRY.filter((id) => !hiddenIds.includes(id));

  if (!forcePack && homeWorkingLayout?.placements) {
    const candidate = cloneHomeLayout(homeWorkingLayout);
    Object.keys(candidate.placements).forEach((id) => {
      if (!visibleIds.includes(id)) delete candidate.placements[id];
    });
    const placementIds = Object.keys(candidate.placements);
    const complete = visibleIds.length === placementIds.length
      && visibleIds.every((id) => candidate.placements[id]);
    if (complete) {
      candidate.variants = Object.fromEntries(
        visibleIds.map((id) => [id, window.NotchDomain.layoutVariantForPlacement(candidate.placements[id])])
      );
      if (window.NotchDomain.validateHomeWidgetLayout(candidate, visibleIds, 12, 4)) {
        homeWorkingLayout = candidate;
        return candidate;
      }
    }
  }

  const layout = window.NotchDomain.resolveHomeWidgetLayout(order, sizes, hiddenIds, 12, 4);
  if (window.NotchDomain.validateHomeWidgetLayout(layout, visibleIds, 12, 4)) {
    homeWorkingLayout = cloneHomeLayout(layout);
    return layout;
  }
  return null;
}

function cancelHomeLayoutMotion() {
  homeLayoutMotionGeneration += 1;
  homeLayoutMotionAnimations.forEach((animation) => animation.cancel());
  homeLayoutMotionAnimations = [];
  homeBento?.classList.remove('layout-motion-active');
}

function captureHomeLayoutVisualState() {
  if (!homeBento) return null;
  const surface = homeBento.getBoundingClientRect();
  if (!surface.width || !surface.height) return null;
  const tiles = new Map();
  homeTiles.forEach((tile) => {
    if (tile.hidden) return;
    const rect = tile.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tiles.set(tile.dataset.homeModule, {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  });
  return { surface: { left: surface.left, top: surface.top }, tiles };
}

function animateCommittedHomeLayout(reason, beforeState) {
  if (!homeBento || !beforeState || reason === 'initial' || reason === 'rollback'
    || reason === 'size-preview' || reason === 'drag-commit'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const generation = homeLayoutMotionGeneration;
  const isPreview = reason === 'reorder-preview';
  const duration = isPreview
    ? 560
    : reason === 'reorder'
      ? Math.round(HOME_LAYOUT_MOTION_MS * 1.2)
      : HOME_LAYOUT_MOTION_MS;
  const easing = isPreview
    ? 'cubic-bezier(0.22, 1, 0.36, 1)'
    : reason === 'reorder'
      ? 'cubic-bezier(0.33, 1, 0.32, 1)'
      : HOME_LAYOUT_MOTION_EASING;
  const finalTiles = new Map();
  homeTiles.forEach((tile) => {
    if (tile.hidden) return;
    if (tile.classList.contains('is-dragging')) return;
    const rect = tile.getBoundingClientRect();
    if (rect.width && rect.height) finalTiles.set(tile.dataset.homeModule, { tile, rect });
  });
  homeBento.classList.add('layout-motion-active');

  finalTiles.forEach(({ tile, rect }, moduleId) => {
    const previous = beforeState.tiles.get(moduleId);
    const dx = previous ? previous.rect.left - rect.left : 0;
    const dy = previous ? previous.rect.top - rect.top : 0;
    const scaleX = previous ? previous.rect.width / Math.max(1, rect.width) : 1;
    const scaleY = previous ? previous.rect.height / Math.max(1, rect.height) : 1;
    const moved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5;
    const resized = Math.abs(scaleX - 1) >= 0.01 || Math.abs(scaleY - 1) >= 0.01;
    if (previous && !moved && !resized) return;
    // 预览让位只做平移，避免缩放造成顿挫；正式提交才允许轻微缩放
    const useScale = !isPreview && resized;
    const fromTransform = useScale
      ? `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`
      : `translate(${dx}px, ${dy}px)`;
    const toTransform = useScale ? 'translate(0, 0) scale(1, 1)' : 'translate(0, 0)';
    const animation = tile.animate(
      previous
        ? [
          { transform: fromTransform },
          { transform: toTransform },
        ]
        : [
          { opacity: 0.72, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
      { duration, easing, fill: 'none' }
    );
    homeLayoutMotionAnimations.push(animation);
  });

  Promise.allSettled(homeLayoutMotionAnimations.map((animation) => animation.finished))
    .then(() => {
      if (generation !== homeLayoutMotionGeneration) return;
      homeLayoutMotionAnimations = [];
      homeBento.classList.remove('layout-motion-active');
    });
}

function applyHomeLayout(layout, { reason = 'initial' } = {}) {
  if (!homeBento || !layout) throw new Error('A validated homepage layout is required.');
  // 先采样当前可见位置（含进行中的 FLIP），再取消旧动画，避免先闪回再起步。
  const beforeState = reason === 'initial' || reason === 'rollback'
    || reason === 'size-preview' || reason === 'drag-commit'
    ? null
    : captureHomeLayoutVisualState();
  cancelHomeLayoutMotion();
  const automaticLayout = !homeLayoutReadOnly && effectiveHomeHidden(hiddenHomeModules).length > 0;
  homeBento.dataset.layoutMode = homeLayoutReadOnly ? 'safe' : automaticLayout ? 'automatic' : 'preferred';
  homeTiles.forEach((tile) => {
    const moduleId = tile.dataset.homeModule;
    const orderIndex = Math.max(0, homeOrder.indexOf(moduleId));
    const size = homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    const placement = layout.placements[moduleId];
    tile.style.order = String(orderIndex);
    tile.dataset.widgetSize = size;
    tile.style.setProperty('--bento-index', String(orderIndex));
    tile.hidden = !placement;
    tile.setAttribute('aria-hidden', String(!placement));
    if (placement) {
      tile.dataset.layoutVariant = layout.variants[moduleId];
      tile.dataset.layoutColumn = String(placement.column);
      tile.dataset.layoutRow = String(placement.row);
      tile.dataset.layoutWidth = String(placement.width);
      tile.dataset.layoutHeight = String(placement.height);
      tile.style.gridColumn = `${placement.column + 1} / span ${placement.width}`;
      tile.style.gridRow = `${placement.row + 1} / span ${placement.height}`;
    } else {
      delete tile.dataset.layoutVariant;
      delete tile.dataset.layoutColumn;
      delete tile.dataset.layoutRow;
      delete tile.dataset.layoutWidth;
      delete tile.dataset.layoutHeight;
      tile.style.removeProperty('grid-column');
      tile.style.removeProperty('grid-row');
    }
    tile.querySelectorAll('[data-widget-size-value]').forEach((sizeButton) => {
      const requestedSize = sizeButton.dataset.widgetSizeValue;
      const selected = size === requestedSize;
      sizeButton.setAttribute('aria-pressed', String(selected));
      sizeButton.disabled = homeLayoutReadOnly || !placement;
      sizeButton.tabIndex = placement ? 0 : -1;
    });
    const dragHandle = tile.querySelector('[data-widget-drag-handle]');
    if (dragHandle) {
      dragHandle.disabled = homeLayoutReadOnly || !placement;
      dragHandle.tabIndex = placement ? 0 : -1;
    }
  });
  animateCommittedHomeLayout(reason, beforeState);
}

/* layout chrome removed: right-click menu + whole-tile drag in edit mode */


const homeModuleIds = new Set(homeTiles.map((tile) => tile.dataset.homeModule));
if (homeTiles.length !== HOME_MODULE_REGISTRY.length
  || homeModuleIds.size !== HOME_MODULE_REGISTRY.length
  || !HOME_MODULE_REGISTRY.every((id) => homeModuleIds.has(id))) {
  throw new Error('Homepage module registry does not match the rendered tiles.');
}

// Ensure newly added homepage modules (e.g. cursor) are present in saved sizes.
homeSizes = window.NotchDomain.normalizeHomeWidgetSizes(homeSizes, HOME_SIZE_DEFAULTS, '');
if (!HOME_ORDER_DEFAULTS.every((id) => homeOrder.includes(id))
  || homeOrder.length !== HOME_ORDER_DEFAULTS.length) {
  homeOrder = loadHomeOrder();
}
saveHomeLayout();

let initialHomeLayout = resolveValidatedHomeLayout(hiddenHomeModules);
if (!initialHomeLayout) {
  // Repair once without entering safe mode: keep visibility prefs, reset packable sizes.
  homeOrder = [...HOME_ORDER_DEFAULTS];
  homeSizes = window.NotchDomain.normalizeHomeWidgetSizes(
    { ...HOME_SIZE_DEFAULTS },
    HOME_SIZE_DEFAULTS,
    ''
  );
  saveHomeLayout();
  initialHomeLayout = resolveValidatedHomeLayout(hiddenHomeModules);
}
if (!initialHomeLayout) {
  initialHomeLayout = resolveValidatedHomeLayout([], HOME_ORDER_DEFAULTS, HOME_SIZE_DEFAULTS);
  homeLayoutReadOnly = true;
  console.error('Homepage layout validation failed; using read-only defaults.');
}
if (!initialHomeLayout) throw new Error('Default homepage layout validation failed.');
applyHomeLayout(initialHomeLayout, { reason: 'initial' });

function visibilitySnapshot() {
  const effectiveHiddenIds = effectiveHomeHidden(homeLayoutReadOnly ? [] : hiddenHomeModules);
  return {
    hiddenIds: [...effectiveHiddenIds],
    visibleIds: HOME_MODULE_REGISTRY.filter((id) => !effectiveHiddenIds.includes(id)),
    storedHiddenIds: [...hiddenHomeModules],
    automaticLayout: !homeLayoutReadOnly && effectiveHiddenIds.length > 0,
    unavailableIds: [...unavailableHomeModules],
    readOnly: homeLayoutReadOnly,
    persisted: homeVisibilityPersisted,
  };
}

function setHomeModuleVisible(moduleId, visible) {
  const current = [...hiddenHomeModules];
  if (unavailableHomeModules.includes(moduleId)) return { ok: false, changed: false, error: 'unsupported', hiddenIds: current, persisted: homeVisibilityPersisted };
  const currentlyVisible = visibilitySnapshot().visibleIds;
  if (!visible && currentlyVisible.includes(moduleId) && currentlyVisible.length === 1) {
    return { ok: false, changed: false, error: 'at_least_one_required', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (homeLayoutReadOnly) {
    return { ok: false, changed: false, error: 'layout_read_only', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const next = window.NotchDomain.updateHomeModuleVisibility(
    current,
    HOME_MODULE_REGISTRY,
    moduleId,
    visible
  );
  if (!next.ok) return { ...next, changed: false, persisted: homeVisibilityPersisted };
  const changed = JSON.stringify(next.hiddenIds) !== JSON.stringify(current);
  if (!changed) {
    return { ok: true, changed: false, hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (moduleId === 'recorder' && visible === false
    && window.NotchWorkspace?.isRecordingActive?.()) {
    return { ok: false, changed: false, error: 'recording_active', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const previousWorking = cloneHomeLayout(homeWorkingLayout);
  homeWorkingLayout = null;
  const layout = resolveValidatedHomeLayout(next.hiddenIds, homeOrder, homeSizes, { forcePack: true });
  const currentLayout = previousWorking
    || resolveValidatedHomeLayout(current, homeOrder, homeSizes, { forcePack: true });
  if (!layout || !currentLayout) {
    homeWorkingLayout = previousWorking;
    return { ok: false, changed: false, error: 'layout_invalid', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (moduleId === 'mirror' && visible === false) stopMirror();
  try {
    const activeElement = document.activeElement;
    const changingTile = homeTiles.find((tile) => tile.dataset.homeModule === moduleId);
    if (visible === false && changingTile?.contains(activeElement)) activeElement.blur();
    hiddenHomeModules = next.hiddenIds;
    applyHomeLayout(layout, { reason: 'visibility' });
  } catch (error) {
    hiddenHomeModules = current;
    try { applyHomeLayout(currentLayout, { reason: 'rollback' }); } catch (rollbackError) {}
    return { ok: false, changed: false, error: 'dom_apply_failed', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const persisted = saveHiddenHomeModules();
  const detail = visibilitySnapshot();
  document.dispatchEvent(new CustomEvent('notch:home-modules-changed', { detail }));
  return { ok: true, changed: true, hiddenIds: [...hiddenHomeModules], persisted };
}

window.NotchHome = Object.freeze({
  getVisibility: visibilitySnapshot,
  isVisible: (moduleId) => visibilitySnapshot().visibleIds.includes(String(moduleId || '')),
  setModuleVisible: setHomeModuleVisible,
});

document.dispatchEvent(new CustomEvent('notch:home-modules-changed', {
  detail: visibilitySnapshot(),
}));
if (homeLayoutReadOnly) document.dispatchEvent(new CustomEvent('notch:home-layout-error'));

if (homeBento) {
  let pendingLongPress = null;
  let dragState = null;
  let suppressHomeClickUntil = 0;
  let homeLayoutEditing = false;
  let contextModuleId = '';

  const hideHomeContextMenu = () => {
    if (!homeContextMenu || homeContextMenu.hidden) return;
    homeContextMenu.hidden = true;
  };

  const homeLayoutEditBar = document.getElementById('home-layout-edit-bar');
  const homeLayoutSaveBtn = document.getElementById('home-layout-save');
  const homeLayoutCancelBtn = document.getElementById('home-layout-cancel');
  let homeLayoutEditSnapshot = null;

  const syncHomeContextMenu = () => {
    if (!homeContextMenu) return;
    const editBtn = homeContextMenu.querySelector('[data-home-ctx="toggle-edit"]');
    if (editBtn) {
      // 编辑中：右键只调尺寸，不出现编辑项
      editBtn.hidden = homeLayoutEditing;
      editBtn.removeAttribute('aria-pressed');
      editBtn.textContent = '编辑布局';
    }
    const size = contextModuleId
      ? (homeSizes[contextModuleId] || HOME_SIZE_DEFAULTS[contextModuleId] || 'medium')
      : '';
    homeContextMenu.querySelectorAll('[data-home-ctx-size]').forEach((btn) => {
      const value = btn.dataset.homeCtxSize;
      const enabled = Boolean(contextModuleId) && !homeLayoutReadOnly;
      btn.disabled = !enabled;
      btn.setAttribute('aria-pressed', String(enabled && value === size));
      btn.hidden = !contextModuleId;
    });
    const showSizes = Boolean(contextModuleId);
    const sep = homeContextMenu.querySelector('.home-context-sep');
    const label = homeContextMenu.querySelector('.home-context-label');
    if (sep) sep.hidden = homeLayoutEditing || !showSizes;
    if (label) label.hidden = !showSizes;
  };

  const syncHomeLayoutEditBar = () => {
    if (!homeLayoutEditBar) return;
    homeLayoutEditBar.hidden = !homeLayoutEditing;
  };

  const showHomeContextMenu = (clientX, clientY, moduleId) => {
    if (!homeContextMenu || homeLayoutReadOnly) return;
    contextModuleId = moduleId || '';
    // 编辑中且未点到模块：没有可展示项
    if (homeLayoutEditing && !contextModuleId) return;
    syncHomeContextMenu();
    // Keep menu outside clipped panel ancestors (body portal in HTML).
    if (homeContextMenu.parentElement !== document.body) {
      document.body.appendChild(homeContextMenu);
    }
    homeContextMenu.hidden = false;
    homeContextMenu.style.left = '0px';
    homeContextMenu.style.top = '0px';
    homeContextMenu.style.visibility = 'hidden';
    const pad = 8;
    const rect = homeContextMenu.getBoundingClientRect();
    const panelEl = document.getElementById('panel') || homeBento || document.documentElement;
    const bounds = panelEl.getBoundingClientRect();
    const clipLeft = Math.max(pad, bounds.left + pad);
    const clipTop = Math.max(pad, bounds.top + pad);
    const clipRight = Math.min(window.innerWidth - pad, bounds.right - pad);
    const clipBottom = Math.min(window.innerHeight - pad, bounds.bottom - pad);
    const maxLeft = Math.max(clipLeft, clipRight - rect.width);
    const maxTop = Math.max(clipTop, clipBottom - rect.height);
    let left = clientX;
    let top = clientY;
    // Prefer opening to the right/below the cursor; flip when it would clip.
    if (left + rect.width > clipRight) left = clientX - rect.width;
    if (top + rect.height > clipBottom) top = clientY - rect.height;
    left = Math.min(Math.max(clipLeft, left), maxLeft);
    top = Math.min(Math.max(clipTop, top), maxTop);
    homeContextMenu.style.left = `${Math.round(left)}px`;
    homeContextMenu.style.top = `${Math.round(top)}px`;
    homeContextMenu.style.visibility = '';
  };

  const setHomeLayoutEditing = (editing, { silent = false, action = 'enter' } = {}) => {
    const next = Boolean(editing) && !homeLayoutReadOnly;
    const wasEditing = homeLayoutEditing;
    if (next && !wasEditing) {
      homeLayoutEditSnapshot = {
        order: [...homeOrder],
        sizes: { ...homeSizes },
        layout: cloneHomeLayout(homeWorkingLayout || resolveValidatedHomeLayout(hiddenHomeModules)),
      };
    }
    if (!next && wasEditing) {
      if (action === 'cancel' && homeLayoutEditSnapshot) {
        homeOrder = [...homeLayoutEditSnapshot.order];
        homeSizes = { ...homeLayoutEditSnapshot.sizes };
        homeWorkingLayout = cloneHomeLayout(homeLayoutEditSnapshot.layout);
        const layout = homeWorkingLayout || resolveValidatedHomeLayout(hiddenHomeModules, homeOrder, homeSizes, { forcePack: true });
        if (layout) applyHomeLayout(layout, { reason: 'rollback' });
        saveHomeLayout();
      } else if (action === 'save') {
        saveHomeLayout();
      }
      homeLayoutEditSnapshot = null;
    }
    homeLayoutEditing = next;
    homeBento.dataset.layoutEditing = String(homeLayoutEditing);
    homeTabPanel?.classList.toggle('layout-editing', homeLayoutEditing);
    syncHomeLayoutEditBar();
    syncHomeContextMenu();
    if (!silent && next && !wasEditing) {
      showStatusToast('已进入编辑：拖动卡片互换位置，完成后点保存');
    } else if (!silent && !next && wasEditing) {
      showStatusToast(action === 'cancel' ? '已取消布局修改' : '布局已保存');
    }
  };
  setHomeLayoutEditing(false, { silent: true });

  const clearDropTarget = () => {
    homeTiles.forEach((tile) => tile.classList.remove('layout-drop-target'));
  };

  const ordersEqual = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((id, index) => id === b[index]);

  const swappedOrderFrom = (baseOrder, sourceId, targetId) => {
    const next = [...baseOrder];
    const sourceIndex = next.indexOf(sourceId);
    const targetIndex = next.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    return next;
  };

  const applyHomeOrder = (nextOrder, reason, { forcePack = false } = {}) => {
    const previous = [...homeOrder];
    const previousLayout = cloneHomeLayout(homeWorkingLayout);
    homeOrder = [...nextOrder];
    if (forcePack) homeWorkingLayout = null;
    const layout = resolveValidatedHomeLayout(hiddenHomeModules, homeOrder, homeSizes, { forcePack });
    if (!layout) {
      homeOrder = previous;
      homeWorkingLayout = previousLayout;
      return false;
    }
    applyHomeLayout(layout, { reason });
    return true;
  };

  // 只交换两个模块的格子，绝不重新打包，避免第 3 个模块被挤动
  const commitSwap = (sourceId, targetId, { fromDrag = false } = {}) => {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const current = resolveValidatedHomeLayout(hiddenHomeModules);
    if (!current?.placements?.[sourceId] || !current?.placements?.[targetId]) return false;

    const next = cloneHomeLayout(current);
    const sourcePlacement = next.placements[sourceId];
    const targetPlacement = next.placements[targetId];
    next.placements[sourceId] = { ...targetPlacement };
    next.placements[targetId] = { ...sourcePlacement };
    next.variants[sourceId] = window.NotchDomain.layoutVariantForPlacement(next.placements[sourceId]);
    next.variants[targetId] = window.NotchDomain.layoutVariantForPlacement(next.placements[targetId]);

    const visibleIds = HOME_MODULE_REGISTRY.filter(
      (id) => !effectiveHomeHidden(hiddenHomeModules).includes(id)
    );
    if (!window.NotchDomain.validateHomeWidgetLayout(next, visibleIds, 12, 4)) return false;

    const previousSizes = { ...homeSizes };
    homeSizes = {
      ...homeSizes,
      [sourceId]: sizeFromPlacement(next.placements[sourceId]),
      [targetId]: sizeFromPlacement(next.placements[targetId]),
    };
    const nextOrder = swappedOrderFrom(homeOrder, sourceId, targetId);
    if (nextOrder) homeOrder = nextOrder;
    homeWorkingLayout = next;
    // 拖动预览已完成让位：松手只落格，不再播一次互换动画
    applyHomeLayout(next, { reason: fromDrag ? 'drag-commit' : 'reorder' });
    if (!homeLayoutEditing) saveHomeLayout();
    else {
      void previousSizes;
    }
    return true;
  };

  const captureOriginRects = () => {
    const rects = new Map();
    homeTiles.forEach((tile) => {
      if (tile.hidden) return;
      const rect = tile.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      rects.set(tile.dataset.homeModule, {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
    });
    return rects;
  };

  const clearDisplacePreview = () => {
    homeTiles.forEach((tile) => {
      tile.classList.remove('layout-displacing');
      tile.style.removeProperty('--home-displace-x');
      tile.style.removeProperty('--home-displace-y');
    });
  };

  // 拖动中不改 grid：只用 transform 把目标模块挪到被拖模块的原位，避免全场重排乱跑
  const previewDisplaceTarget = (sourceId, targetId) => {
    if (!dragState?.originRects) return;
    clearDisplacePreview();
    clearDropTarget();
    dragState.previewTargetId = targetId || null;
    dragState.target = null;
    if (!targetId) return;
    const sourceRect = dragState.originRects.get(sourceId);
    const targetRect = dragState.originRects.get(targetId);
    const targetTile = homeBento.querySelector(`[data-home-module="${targetId}"]`);
    if (!sourceRect || !targetRect || !targetTile) return;
    const dx = sourceRect.left - targetRect.left;
    const dy = sourceRect.top - targetRect.top;
    targetTile.style.setProperty('--home-displace-x', `${dx}px`);
    targetTile.style.setProperty('--home-displace-y', `${dy}px`);
    targetTile.classList.add('layout-displacing', 'layout-drop-target');
    dragState.target = targetTile;
  };

  const findDropTargetAt = (clientX, clientY, draggedTile) => {
    const rects = dragState?.originRects;
    if (!rects) return null;
    const draggedId = draggedTile?.dataset?.homeModule;
    const sourceRect = draggedId ? rects.get(draggedId) : null;
    let best = null;
    let bestScore = Infinity;
    rects.forEach((rect, id) => {
      if (!id || id === draggedId) return;
      // 不能用大模块的外扩命中：会把旁边大卡片（如 Cursor 用量）误当成落点
      const pad = 4;
      const inRange = clientX >= rect.left - pad
        && clientX <= rect.right + pad
        && clientY >= rect.top - pad
        && clientY <= rect.bottom + pad;
      if (!inRange) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let score = Math.hypot(clientX - cx, clientY - cy);
      // 与被拖模块原位相邻的优先，减少跨列误吸
      if (sourceRect) {
        const shareColumn = Math.min(rect.right, sourceRect.right) - Math.max(rect.left, sourceRect.left) > 8;
        const shareRow = Math.min(rect.bottom, sourceRect.bottom) - Math.max(rect.top, sourceRect.top) > 8;
        const touching = shareColumn || shareRow;
        if (!touching) score += 120;
      }
      if (score < bestScore) {
        bestScore = score;
        best = homeBento.querySelector(`[data-home-module="${id}"]`);
      }
    });
    return best && !best.hidden ? best : null;
  };

  const applyContextSize = (moduleId, requested) => {
    if (!moduleId || homeLayoutReadOnly) return;
    const previousSizes = homeSizes;
    const previousLayout = cloneHomeLayout(homeWorkingLayout);
    homeSizes = window.NotchDomain.normalizeHomeWidgetSizes({
      ...homeSizes,
      [moduleId]: requested,
    }, HOME_SIZE_DEFAULTS, moduleId);
    homeWorkingLayout = null;
    const layout = resolveValidatedHomeLayout(hiddenHomeModules, homeOrder, homeSizes, { forcePack: true });
    if (!layout) {
      homeSizes = previousSizes;
      homeWorkingLayout = previousLayout;
      showStatusToast('当前空间不足，请先缩小其他模块');
      return;
    }
    applyHomeLayout(layout, { reason: 'size' });
    if (!homeLayoutEditing) saveHomeLayout();
    showStatusToast(`已设为${HOME_SIZE_LABELS[homeSizes[moduleId]]}组件`);
  };

  homeContextMenu?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-home-ctx="toggle-edit"]');
    if (toggle) {
      if (!homeLayoutEditing) setHomeLayoutEditing(true);
      hideHomeContextMenu();
      return;
    }
    const sizeBtn = event.target.closest('[data-home-ctx-size]');
    if (sizeBtn) {
      applyContextSize(contextModuleId, sizeBtn.dataset.homeCtxSize);
      hideHomeContextMenu();
    }
  });

  homeLayoutSaveBtn?.addEventListener('click', () => {
    setHomeLayoutEditing(false, { action: 'save' });
  });
  homeLayoutCancelBtn?.addEventListener('click', () => {
    setHomeLayoutEditing(false, { action: 'cancel' });
  });

  document.addEventListener('pointerdown', (event) => {
    if (!homeContextMenu || homeContextMenu.hidden) return;
    if (homeContextMenu.contains(event.target)) return;
    hideHomeContextMenu();
  }, true);

  window.addEventListener('blur', hideHomeContextMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideHomeContextMenu();
      if (homeLayoutEditing) setHomeLayoutEditing(false, { action: 'cancel' });
    }
  });

  const dismissHomeLayoutChrome = ({ cancelEdit = false } = {}) => {
    hideHomeContextMenu();
    if (dragState) {
      clearDisplacePreview();
      clearDropTarget();
      const { tile, pointerId } = dragState;
      if (tile.hasPointerCapture?.(pointerId)) tile.releasePointerCapture(pointerId);
      tile.classList.remove('is-dragging', 'hit-test-off');
      tile.style.removeProperty('--home-drag-x');
      tile.style.removeProperty('--home-drag-y');
      homeBento.classList.remove('layout-dragging');
      dragState = null;
    } else {
      clearDisplacePreview();
    }
    if (cancelEdit && homeLayoutEditing) {
      setHomeLayoutEditing(false, { action: 'cancel', silent: true });
    }
  };

  // 收起一开始就关掉右键菜单；编辑中则取消本次修改
  document.addEventListener('notch:will-collapse', () => {
    dismissHomeLayoutChrome({ cancelEdit: true });
  });
  document.addEventListener('notch:modechange', (event) => {
    if (event.detail?.expanded) return;
    dismissHomeLayoutChrome({ cancelEdit: true });
  });

  homeBento.addEventListener('contextmenu', (event) => {
    if (homeLayoutReadOnly) return;
    event.preventDefault();
    const tile = event.target.closest('[data-home-module]');
    const moduleId = tile && !tile.hidden && homeBento.contains(tile) ? tile.dataset.homeModule : '';
    showHomeContextMenu(event.clientX, event.clientY, moduleId);
  });

  const finishHomeDrag = (event, cancelled = false) => {
    if (pendingLongPress) clearTimeout(pendingLongPress.timer);
    pendingLongPress = null;
    if (!dragState) return;
    const { tile, pointerId, previewTargetId } = dragState;
    if (tile.hasPointerCapture?.(pointerId)) tile.releasePointerCapture(pointerId);
    const sourceId = tile.dataset.homeModule;
    const finalTargetId = previewTargetId || null;

    // 先关掉位移过渡，避免清 transform 时又滑回去再播落格动画
    homeTiles.forEach((item) => {
      item.style.transition = 'none';
    });

    let swapped = false;
    if (!cancelled && finalTargetId) {
      swapped = commitSwap(sourceId, finalTargetId, { fromDrag: true });
    }

    clearDisplacePreview();
    clearDropTarget();
    tile.classList.remove('is-dragging', 'hit-test-off');
    tile.style.removeProperty('--home-drag-x');
    tile.style.removeProperty('--home-drag-y');
    homeBento.classList.remove('layout-dragging');
    dragState = null;
    suppressHomeClickUntil = Date.now() + 280;

    requestAnimationFrame(() => {
      homeTiles.forEach((item) => {
        item.style.removeProperty('transition');
      });
    });

    if (cancelled || !finalTargetId) return;
    if (swapped) showStatusToast('已互换位置');
    else showStatusToast('无法互换，请换一个位置试试');
  };

  homeBento.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    hideHomeContextMenu();
    if (!homeLayoutEditing || homeLayoutReadOnly) return;
    const tile = event.target.closest('[data-home-module]');
    if (!tile || tile.hidden || !homeBento.contains(tile)) return;
    // 编辑布局时整卡可拖（含随笔记 textarea、镜子 button、工具条）
    if (event.target.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startDrag = () => {
      if (!pendingLongPress) return;
      tile.setPointerCapture?.(event.pointerId);
      homeBento.classList.add('layout-dragging');
      tile.classList.add('is-dragging');
      dragState = {
        tile,
        target: null,
        pointerId: event.pointerId,
        startX,
        startY,
        originOrder: [...homeOrder],
        originRects: captureOriginRects(),
        previewTargetId: null,
      };
      pendingLongPress = null;
    };
    // Short delay so click/press still feels intentional, but whole-tile drag in edit mode
    pendingLongPress = {
      tile,
      startX,
      startY,
      pointerId: event.pointerId,
      timer: setTimeout(startDrag, 120),
    };
  });

  homeBento.addEventListener('pointermove', (event) => {
    if (pendingLongPress) {
      const moved = Math.hypot(
        event.clientX - pendingLongPress.startX,
        event.clientY - pendingLongPress.startY
      );
      if (moved > 6 && pendingLongPress.timer) {
        // start immediately once user clearly drags
        clearTimeout(pendingLongPress.timer);
        pendingLongPress.timer = null;
        const tile = pendingLongPress.tile;
        tile.setPointerCapture?.(event.pointerId);
        homeBento.classList.add('layout-dragging');
        tile.classList.add('is-dragging');
        dragState = {
          tile,
          target: null,
          pointerId: event.pointerId,
          startX: pendingLongPress.startX,
          startY: pendingLongPress.startY,
          originOrder: [...homeOrder],
          originRects: captureOriginRects(),
          previewTargetId: null,
        };
        pendingLongPress = null;
      } else if (moved > 6) {
        clearTimeout(pendingLongPress.timer);
        pendingLongPress = null;
      }
      if (!dragState) return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { tile } = dragState;
    const target = findDropTargetAt(event.clientX, event.clientY, tile);
    const nextTargetId = target ? target.dataset.homeModule : null;
    // 指针离开目标原位就取消让位，避免误吸到旁列大模块后一直粘着
    if (nextTargetId !== dragState.previewTargetId) {
      previewDisplaceTarget(tile.dataset.homeModule, nextTargetId);
    }
    tile.style.setProperty('--home-drag-x', `${event.clientX - dragState.startX}px`);
    tile.style.setProperty('--home-drag-y', `${event.clientY - dragState.startY}px`);
  });

  homeBento.addEventListener('pointerup', (event) => finishHomeDrag(event, false));
  homeBento.addEventListener('pointercancel', (event) => finishHomeDrag(event, true));
  homeBento.addEventListener('pointerleave', () => {
    if (!dragState && pendingLongPress) {
      clearTimeout(pendingLongPress.timer);
      pendingLongPress = null;
    }
  });
  homeBento.addEventListener('click', (event) => {
    if (Date.now() >= suppressHomeClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}


// ============ 距离感应 Dock 悬浮 ============
function bindDockSurface(surface, selector, maxScale = 1.14) {
  if (!surface) return;
  let frame = null;
  const reset = () => {
    surface.querySelectorAll(selector).forEach((item) => {
      item.style.removeProperty('--dock-scale');
      item.style.removeProperty('--dock-lift');
      item.style.removeProperty('--dock-glow');
    });
  };
  surface.addEventListener('pointermove', (event) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      surface.querySelectorAll(selector).forEach((item) => {
        const rect = item.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
        const radius = Math.max(72, Math.min(150, rect.width * 2.2));
        const strength = Math.max(0, 1 - distance / radius) ** 2;
        item.style.setProperty('--dock-scale', (1 + (maxScale - 1) * strength).toFixed(3));
        item.style.setProperty('--dock-lift', `${(-5 * strength).toFixed(2)}px`);
        item.style.setProperty('--dock-glow', strength.toFixed(3));
      });
    });
  });
  surface.addEventListener('pointerleave', reset);
}

[
  ['#window-list', '.window-item', 1.12],
].forEach(([surfaceSelector, itemSelector, scale]) => {
  document.querySelectorAll(surfaceSelector).forEach((surface) => {
    bindDockSurface(surface, itemSelector, scale);
  });
});


// ============ 首页模块通用水波折射（镜子 / 番茄钟除外） ============
function bindLiquidWaterFx(root, { displacement, canvas }) {
  if (!root || !displacement || !canvas) return;
  let liquidFrame = null;
  let liquidScale = 0;
  let lastPoint = null;
  let waterFrame = null;
  let lastTrailAt = 0;
  let waterRipples = [];

  function resizeWaterCanvas() {
    const bounds = root.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { bounds, dpr };
  }

  function animateWater(now) {
    const metrics = resizeWaterCanvas();
    const context = canvas.getContext('2d');
    if (!metrics || !context) {
      waterFrame = null;
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    waterRipples = waterRipples.filter((ripple) => now - ripple.startedAt < 1250);
    context.save();
    context.scale(metrics.dpr, metrics.dpr);
    context.globalCompositeOperation = 'screen';
    waterRipples.forEach((ripple) => {
      const progress = Math.min(1, (now - ripple.startedAt) / 1250);
      const eased = 1 - (1 - progress) ** 3;
      for (let ring = 0; ring < 3; ring++) {
        const radius = 6 + eased * (34 + ripple.speed * 1.8) + ring * 7;
        context.beginPath();
        context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        context.strokeStyle = `rgba(190, 222, 255, ${Math.max(0, (1 - progress) * (0.17 - ring * 0.035))})`;
        context.lineWidth = Math.max(0.65, 1.55 - progress);
        context.stroke();
      }
    });
    context.restore();
    if (waterRipples.length) waterFrame = requestAnimationFrame(animateWater);
    else waterFrame = null;
  }

  function addWaterRipple(x, y, speed) {
    waterRipples.push({ x, y, speed: Math.min(18, speed), startedAt: performance.now() });
    if (waterRipples.length > 18) waterRipples.shift();
    if (!waterFrame) waterFrame = requestAnimationFrame(animateWater);
  }

  function animateLiquid() {
    liquidScale += (0 - liquidScale) * 0.035;
    displacement.setAttribute('scale', liquidScale.toFixed(2));
    if (liquidScale > 0.35) liquidFrame = requestAnimationFrame(animateLiquid);
    else liquidFrame = null;
  }

  root.addEventListener('pointerenter', () => {
    root.classList.add('liquid-active');
  });
  root.addEventListener('pointermove', (event) => {
    const bounds = root.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const speed = lastPoint
      ? Math.hypot(event.clientX - lastPoint.x, event.clientY - lastPoint.y)
      : 0;
    lastPoint = { x: event.clientX, y: event.clientY };
    root.style.setProperty('--liquid-x', `${(x * 100).toFixed(2)}%`);
    root.style.setProperty('--liquid-y', `${(y * 100).toFixed(2)}%`);
    root.style.setProperty('--liquid-shift-x', `${((0.5 - x) * 10).toFixed(2)}px`);
    root.style.setProperty('--liquid-shift-y', `${((0.5 - y) * 10).toFixed(2)}px`);
    liquidScale = Math.min(38, Math.max(liquidScale, 14 + speed * 0.85));
    if (event.timeStamp - lastTrailAt > 42 && speed > 1.5) {
      lastTrailAt = event.timeStamp;
      addWaterRipple(event.clientX - bounds.left, event.clientY - bounds.top, speed);
    }
    if (!liquidFrame) liquidFrame = requestAnimationFrame(animateLiquid);
  });
  root.addEventListener('pointerleave', () => {
    lastPoint = null;
    root.classList.remove('liquid-active');
  });
}

const moduleLiquidTargets = [
  ['#home-music', 'music-displacement', 'music-water-canvas'],
  ['#home-cursor', 'cursor-displacement', 'cursor-water-canvas'],
  ['#home-recorder', 'recorder-displacement', 'recorder-water-canvas'],
  ['.home-windows', 'windows-displacement', 'windows-water-canvas'],
  ['.home-note', 'note-displacement', 'note-water-canvas'],
  ['.home-commands', 'commands-displacement', 'commands-water-canvas'],
];

moduleLiquidTargets.forEach(([sel, dispId, canvasId]) => {
  const root = document.querySelector(sel);
  bindLiquidWaterFx(root, {
    displacement: document.getElementById(dispId),
    canvas: document.getElementById(canvasId),
  });
});

(function syncMusicLiquidSrc() {
  const music = document.getElementById('home-music');
  const layer = music?.querySelector('.module-liquid-layer');
  if (!music || !layer) return;
  const map = {
    mini: 'assets/generated/music-bg-mini.png',
    small: 'assets/generated/music-bg-small.png',
    medium: 'assets/generated/music-bg-medium.png',
    large: 'assets/generated/music-bg-large.png',
  };
  const apply = () => {
    const size = music.getAttribute('data-widget-size') || 'medium';
    const next = map[size] || map.medium;
    if (layer.getAttribute('src') !== next) layer.setAttribute('src', next);
  };
  apply();
  new MutationObserver(apply).observe(music, { attributes: true, attributeFilter: ['data-widget-size'] });
})();


// ============ 首页 · 番茄钟（与镜子同款局部水波折射） ============
const pomodoroDisplacement = document.getElementById('pomodoro-displacement');
const pomodoroWaterCanvas = document.getElementById('pomodoro-water-canvas');
let pomodoroLiquidFrame = null;
let pomodoroLiquidScale = 0;
let pomodoroLastPoint = null;
let pomodoroWaterFrame = null;
let pomodoroLastTrailAt = 0;
let pomodoroWaterRipples = [];

function resizePomodoroWaterCanvas() {
  if (!pomodoroWaterCanvas || !homePomodoro) return null;
  const bounds = homePomodoro.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (pomodoroWaterCanvas.width !== width || pomodoroWaterCanvas.height !== height) {
    pomodoroWaterCanvas.width = width;
    pomodoroWaterCanvas.height = height;
  }
  return { bounds, dpr };
}

function animatePomodoroWater(now) {
  const metrics = resizePomodoroWaterCanvas();
  const context = pomodoroWaterCanvas?.getContext('2d');
  if (!metrics || !context) {
    pomodoroWaterFrame = null;
    return;
  }
  context.clearRect(0, 0, pomodoroWaterCanvas.width, pomodoroWaterCanvas.height);
  pomodoroWaterRipples = pomodoroWaterRipples.filter((ripple) => now - ripple.startedAt < 1250);
  context.save();
  context.scale(metrics.dpr, metrics.dpr);
  context.globalCompositeOperation = 'screen';
  pomodoroWaterRipples.forEach((ripple) => {
    const progress = Math.min(1, (now - ripple.startedAt) / 1250);
    const eased = 1 - (1 - progress) ** 3;
    for (let ring = 0; ring < 3; ring++) {
      const radius = 6 + eased * (34 + ripple.speed * 1.8) + ring * 7;
      context.beginPath();
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(190, 222, 255, ${Math.max(0, (1 - progress) * (0.17 - ring * 0.035))})`;
      context.lineWidth = Math.max(0.65, 1.55 - progress);
      context.stroke();
    }
  });
  context.restore();
  if (pomodoroWaterRipples.length) pomodoroWaterFrame = requestAnimationFrame(animatePomodoroWater);
  else pomodoroWaterFrame = null;
}

function addPomodoroWaterRipple(x, y, speed) {
  pomodoroWaterRipples.push({ x, y, speed: Math.min(18, speed), startedAt: performance.now() });
  if (pomodoroWaterRipples.length > 18) pomodoroWaterRipples.shift();
  if (!pomodoroWaterFrame) pomodoroWaterFrame = requestAnimationFrame(animatePomodoroWater);
}

function animatePomodoroLiquid() {
  pomodoroLiquidScale += (0 - pomodoroLiquidScale) * 0.035;
  pomodoroDisplacement?.setAttribute('scale', pomodoroLiquidScale.toFixed(2));
  if (pomodoroLiquidScale > 0.35) {
    pomodoroLiquidFrame = requestAnimationFrame(animatePomodoroLiquid);
  } else {
    pomodoroLiquidFrame = null;
  }
}

if (homePomodoro) {
  homePomodoro.addEventListener('pointerenter', () => {
    homePomodoro.classList.add('liquid-active');
  });
  homePomodoro.addEventListener('pointermove', (event) => {
    const bounds = homePomodoro.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const speed = pomodoroLastPoint
      ? Math.hypot(event.clientX - pomodoroLastPoint.x, event.clientY - pomodoroLastPoint.y)
      : 0;
    pomodoroLastPoint = { x: event.clientX, y: event.clientY };
    homePomodoro.style.setProperty('--liquid-x', `${(x * 100).toFixed(2)}%`);
    homePomodoro.style.setProperty('--liquid-y', `${(y * 100).toFixed(2)}%`);
    homePomodoro.style.setProperty('--liquid-shift-x', `${((0.5 - x) * 10).toFixed(2)}px`);
    homePomodoro.style.setProperty('--liquid-shift-y', `${((0.5 - y) * 10).toFixed(2)}px`);
    pomodoroLiquidScale = Math.min(38, Math.max(pomodoroLiquidScale, 14 + speed * 0.85));
    if (event.timeStamp - pomodoroLastTrailAt > 42 && speed > 1.5) {
      pomodoroLastTrailAt = event.timeStamp;
      addPomodoroWaterRipple(event.clientX - bounds.left, event.clientY - bounds.top, speed);
    }
    if (!pomodoroLiquidFrame) pomodoroLiquidFrame = requestAnimationFrame(animatePomodoroLiquid);
  });
  homePomodoro.addEventListener('pointerleave', () => {
    pomodoroLastPoint = null;
    homePomodoro.classList.remove('liquid-active');
  });
}

// ============ 首页 · 人像镜面（局部水波折射） ============
const homeMirror = document.querySelector('.home-mirror');
const mirrorStage = document.getElementById('mirror-stage');
const mirrorPhotos = Array.from(document.querySelectorAll('.mirror-photo'));

function applyMirrorCover(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
  mirrorPhotos.forEach((image) => { image.src = dataUrl; });
}

if (window.notchAPI && typeof window.notchAPI.getMirrorImage === 'function') {
  window.notchAPI.getMirrorImage().then(applyMirrorCover).catch(() => {});
}
if (window.notchAPI && typeof window.notchAPI.onMirrorImageChanged === 'function') {
  window.notchAPI.onMirrorImageChanged(applyMirrorCover);
}
const mirrorVideo = document.getElementById('mirror-video');
const mirrorDisplacement = document.getElementById('mirror-displacement');
const mirrorWaterCanvas = document.getElementById('mirror-water-canvas');
const mirrorPixelReveal = document.getElementById('mirror-pixel-reveal');
let mirrorLiquidFrame = null;
let mirrorLiquidScale = 0;
let mirrorLastPoint = null;
let mirrorWaterFrame = null;
let mirrorLastTrailAt = 0;
let mirrorWaterRipples = [];
let mirrorStream = null;
let mirrorStarting = false;
let mirrorZoom = 1;

function replayMirrorPixelReveal() {
  if (!mirrorPixelReveal || !homeMirror || activeTab !== 'home') return;
  if (!mirrorPixelReveal.childElementCount) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 80; index++) {
      const pixel = document.createElement('i');
      const row = Math.floor(index / 10);
      const column = index % 10;
      pixel.style.setProperty('--pixel-delay', `${(row * 24 + column * 13 + ((row + column) % 3) * 17)}ms`);
      fragment.appendChild(pixel);
    }
    mirrorPixelReveal.appendChild(fragment);
  }
  mirrorPixelReveal.classList.remove('revealing');
  void mirrorPixelReveal.offsetWidth;
  mirrorPixelReveal.classList.add('revealing');
  setTimeout(() => mirrorPixelReveal.classList.remove('revealing'), 1120);
}

function resizeMirrorWaterCanvas() {
  if (!mirrorWaterCanvas || !mirrorStage) return null;
  const bounds = mirrorStage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (mirrorWaterCanvas.width !== width || mirrorWaterCanvas.height !== height) {
    mirrorWaterCanvas.width = width;
    mirrorWaterCanvas.height = height;
  }
  return { bounds, dpr };
}

function animateMirrorWater(now) {
  const metrics = resizeMirrorWaterCanvas();
  const context = mirrorWaterCanvas?.getContext('2d');
  if (!metrics || !context) {
    mirrorWaterFrame = null;
    return;
  }
  context.clearRect(0, 0, mirrorWaterCanvas.width, mirrorWaterCanvas.height);
  mirrorWaterRipples = mirrorWaterRipples.filter((ripple) => now - ripple.startedAt < 1250);
  context.save();
  context.scale(metrics.dpr, metrics.dpr);
  context.globalCompositeOperation = 'screen';
  mirrorWaterRipples.forEach((ripple) => {
    const progress = Math.min(1, (now - ripple.startedAt) / 1250);
    const eased = 1 - (1 - progress) ** 3;
    for (let ring = 0; ring < 3; ring++) {
      const radius = 6 + eased * (34 + ripple.speed * 1.8) + ring * 7;
      context.beginPath();
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(190, 222, 255, ${Math.max(0, (1 - progress) * (0.17 - ring * 0.035))})`;
      context.lineWidth = Math.max(0.65, 1.55 - progress);
      context.stroke();
    }
  });
  context.restore();
  if (mirrorWaterRipples.length) mirrorWaterFrame = requestAnimationFrame(animateMirrorWater);
  else mirrorWaterFrame = null;
}

function addMirrorWaterRipple(x, y, speed) {
  mirrorWaterRipples.push({ x, y, speed: Math.min(18, speed), startedAt: performance.now() });
  if (mirrorWaterRipples.length > 18) mirrorWaterRipples.shift();
  if (!mirrorWaterFrame) mirrorWaterFrame = requestAnimationFrame(animateMirrorWater);
}

function setMirrorZoom(value) {
  mirrorZoom = value;
  mirrorStage?.style.setProperty('--mirror-zoom', String(mirrorZoom));
}

function stopMirror() {
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
  }
  if (mirrorVideo) {
    mirrorVideo.pause();
    mirrorVideo.srcObject = null;
  }
  mirrorStarting = false;
  setMirrorZoom(1);
  if (mirrorLiquidFrame) cancelAnimationFrame(mirrorLiquidFrame);
  mirrorLiquidFrame = null;
  mirrorLiquidScale = 0;
  mirrorLastPoint = null;
  mirrorWaterRipples = [];
  if (mirrorWaterFrame) cancelAnimationFrame(mirrorWaterFrame);
  mirrorWaterFrame = null;
  const waterContext = mirrorWaterCanvas?.getContext('2d');
  waterContext?.clearRect(0, 0, mirrorWaterCanvas.width, mirrorWaterCanvas.height);
  mirrorDisplacement?.setAttribute('scale', '0');
  homeMirror?.classList.remove('live', 'camera-starting', 'liquid-active', 'ripple-active');
  mirrorStage?.setAttribute('aria-label', '打开实时镜子');
  mirrorStage?.setAttribute('aria-pressed', 'false');
  mirrorStage?.removeAttribute('aria-busy');
}

async function startMirror() {
  if (mirrorStarting || mirrorStream || !mirrorVideo) return;
  mirrorStarting = true;
  homeMirror?.classList.add('camera-starting');
  mirrorStage?.setAttribute('aria-busy', 'true');
  try {
    const permitted = !window.notchAPI || typeof window.notchAPI.ensureCamera !== 'function'
      ? true
      : await window.notchAPI.ensureCamera();
    if (!permitted) throw new Error('camera_permission_denied');
    if (!mirrorStarting || !isExpanded || activeTab !== 'home') return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 1280 },
      },
    });
    if (!isExpanded || activeTab !== 'home' || !mirrorStarting) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    mirrorStream = stream;
    mirrorVideo.srcObject = stream;
    await mirrorVideo.play();
    setMirrorZoom(1);
    homeMirror?.classList.remove('liquid-active');
    homeMirror?.classList.add('live');
    mirrorStage?.setAttribute('aria-label', '关闭实时镜子');
    mirrorStage?.setAttribute('aria-pressed', 'true');
  } catch (error) {
    stopMirror();
    const denied = error && (
      error.name === 'NotAllowedError' || error.message === 'camera_permission_denied'
    );
    showStatusToast(denied ? '需要摄像头权限才能打开镜子' : '暂时无法打开摄像头');
  } finally {
    mirrorStarting = false;
    homeMirror?.classList.remove('camera-starting');
    mirrorStage?.removeAttribute('aria-busy');
  }
}

function animateMirrorLiquid() {
  // 慢衰减保留轨迹长尾，Canvas 同时绘制传播中的同心波。
  mirrorLiquidScale += (0 - mirrorLiquidScale) * 0.035;
  mirrorDisplacement?.setAttribute('scale', mirrorLiquidScale.toFixed(2));
  if (mirrorLiquidScale > 0.35) {
    mirrorLiquidFrame = requestAnimationFrame(animateMirrorLiquid);
  } else {
    mirrorLiquidFrame = null;
  }
}

if (mirrorStage) {
  mirrorStage.addEventListener('pointerenter', () => {
    if (!mirrorStream) homeMirror?.classList.add('liquid-active');
  });
  mirrorStage.addEventListener('pointermove', (event) => {
    if (mirrorStream) return;
    const bounds = mirrorStage.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const speed = mirrorLastPoint
      ? Math.hypot(event.clientX - mirrorLastPoint.x, event.clientY - mirrorLastPoint.y)
      : 0;
    mirrorLastPoint = { x: event.clientX, y: event.clientY };
    mirrorStage.style.setProperty('--liquid-x', `${(x * 100).toFixed(2)}%`);
    mirrorStage.style.setProperty('--liquid-y', `${(y * 100).toFixed(2)}%`);
    mirrorStage.style.setProperty('--liquid-shift-x', `${((0.5 - x) * 10).toFixed(2)}px`);
    mirrorStage.style.setProperty('--liquid-shift-y', `${((0.5 - y) * 10).toFixed(2)}px`);
    mirrorLiquidScale = Math.min(38, Math.max(mirrorLiquidScale, 14 + speed * 0.85));
    if (event.timeStamp - mirrorLastTrailAt > 42 && speed > 1.5) {
      mirrorLastTrailAt = event.timeStamp;
      addMirrorWaterRipple(event.clientX - bounds.left, event.clientY - bounds.top, speed);
    }
    if (!mirrorLiquidFrame) mirrorLiquidFrame = requestAnimationFrame(animateMirrorLiquid);
  });
  mirrorStage.addEventListener('pointerleave', () => {
    mirrorLastPoint = null;
    homeMirror?.classList.remove('liquid-active');
  });
  mirrorStage.addEventListener('wheel', (event) => {
    if (!window.NotchDomain.shouldHandleMirrorPinch({
      live: Boolean(mirrorStream),
      ctrlKey: event.ctrlKey,
    })) return;
    event.preventDefault();
    setMirrorZoom(window.NotchDomain.adjustMirrorZoom(mirrorZoom, event.deltaY));
  }, { passive: false });
  mirrorStage.addEventListener('click', async () => {
    if (homeBento?.classList.contains('layout-dragging')) return;
    if (homeBento?.dataset?.layoutEditing === 'true') return;
    if (mirrorStream || mirrorStarting) {
      stopMirror();
      return;
    }
    homeMirror?.classList.remove('ripple-active');
    void mirrorStage.offsetWidth;
    homeMirror?.classList.add('ripple-active');
    setTimeout(() => homeMirror?.classList.remove('ripple-active'), 720);
    await startMirror();
  });
}

// ============ 首页 · 收藏剪贴 ============
const clipfavListEl = document.getElementById('clipfav-list');

function renderClipFavs() {
  if (!clipfavListEl) return;
  // 脏标记：clipHistory / clipFavorites / clipImageCache 均未变则跳过重建
  if (clipDataVersion === lastRenderedFavsVersion) return;

  // 按 clipFavorites 顺序取条目（过滤掉已删的）
  const favEntries = clipFavorites
    .map((id) => clipHistory.find((e) => e.id === id))
    .filter(Boolean);

  if (!favEntries.length) {
    clipfavListEl.innerHTML =
      '<button class="clipfav-empty" type="button" data-action="goto-clip">' +
      '去"剪贴板"Tab 给常用记录加星 →' +
      '</button>';
    lastRenderedFavsVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  // 渲染每条收藏
  clipfavListEl.innerHTML = favEntries
    .map((entry) => {
      const safeId = escapeHtml(entry.id);

      if (entry.type === 'image') {
        const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
        const mediaHtml = dataUrl
          ? `<img class="clipfav-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
          : `<div class="clipfav-thumb-placeholder">图</div>`;
        return (
          `<div class="clipfav-item clip-type-image" data-id="${safeId}" role="button" tabindex="0" title="图片">` +
          mediaHtml +
          `<span class="clipfav-text">图片</span>` +
          `</div>`
        );
      }

      // text | url
      const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
      const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
      let preview = entry.text || '';
      if (isUrl) {
        try {
          preview = new URL(entry.text).hostname || entry.text;
        } catch (_) {
          preview = entry.text || '';
        }
      }
      const safePreview = escapeHtml(preview);
      const safeTitle = escapeHtml(entry.text || '');
      return (
        `<div class="clipfav-item ${typeClass}" data-id="${safeId}" role="button" tabindex="0" title="${safeTitle}">` +
        `<span class="clipfav-text">${safePreview}</span>` +
        `</div>`
      );
    })
    .join('');
  lastRenderedFavsVersion = clipDataVersion; // 标记本次渲染版本

  // 按需预加载图片缩略图（命中后二次渲染刷新）
  // preloadClipImage 会自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  const missingImageEntries = favEntries.filter(
    (e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath)
  );
  if (missingImageEntries.length > 0) {
    Promise.all(missingImageEntries.map((e) => preloadClipImage(e.imagePath))).then(() => {
      const anyLoaded = missingImageEntries.some((e) => clipImageCache.has(e.imagePath));
      if (anyLoaded) renderClipFavs();
    });
  }
}

if (clipfavListEl) {
  clipfavListEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 空态：跳转 clip Tab
    if (e.target.closest('[data-action="goto-clip"]')) {
      setActiveTab('clip');
      return;
    }
    // 条目点击：复制
    const item = e.target.closest('.clipfav-item[data-id]');
    if (item) {
      const id = item.dataset.id;
      if (await copyClipEntry(id)) {
        item.classList.add('copied');
        setTimeout(() => item.classList.remove('copied'), 800);
      }
    }
  });
  clipfavListEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    const item = e.target.closest('.clipfav-item[data-id]');
    if (!item) return;
    e.preventDefault();
    if (await copyClipEntry(item.dataset.id)) {
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 800);
    }
  });
}

// ============ 剪贴板历史 ============
const CLIP_HISTORY_KEY = 'notch-clip-history';
const CLIP_FAV_KEY = 'notch-clip-favorites';
const CLIP_MAX = 100;
const CLIP_URL_RE = /^https?:\/\//i;
const starOutlineSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const starFilledSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';

function loadClipHistory() {
  try {
    const raw = localStorage.getItem(CLIP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeClipEntry).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function normalizeClipEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = ['text', 'url', 'image'].includes(entry.type) ? entry.type : 'text';
  const text = typeof entry.text === 'string' ? entry.text : null;
  const imagePath = typeof entry.imagePath === 'string' ? entry.imagePath : null;
  if (type === 'image' ? !imagePath : text === null) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
    type,
    text,
    imagePath,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  };
}

function saveClipHistory(list) {
  try {
    localStorage.setItem(CLIP_HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

function loadClipFavorites() {
  try {
    const raw = localStorage.getItem(CLIP_FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === 'string');
  } catch (e) {
    return [];
  }
}

function saveClipFavorites(list) {
  try {
    localStorage.setItem(CLIP_FAV_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

let clipHistory = loadClipHistory();
let clipFavorites = loadClipFavorites();
let clipFilter = 'all'; // all | text | image | faved
const clipImageCache = new Map(); // imagePath -> dataUrl，仅内存

// 脏标记 —— 单调递增版本号：凡影响 renderClipList / renderClipFavs 输出的变更都自增。
// 宁可多自增（多一次重建）也不能漏（界面不更新）。
// 注意：preloadClipImage 在图片入缓存后也要自增，确保二次渲染不被脏标记挡掉。
let clipDataVersion = 0;
let lastRenderedClipVersion = -1; // renderClipList 上次渲染时的版本号
let lastRenderedFavsVersion = -1; // renderClipFavs 上次渲染时的版本号

const clipListEl = document.getElementById('clip-list');
const clipToolbarEl = document.getElementById('clip-toolbar');
const clipClearBtn = document.getElementById('clip-clear-btn');
let clipClearArmed = false;

// 防重入标志：renderClipList 内按需图片预加载完成后的二次渲染
let clipRenderPending = false;

async function preloadClipImage(imagePath) {
  if (!imagePath) return;
  if (clipImageCache.has(imagePath)) return;
  if (!window.notchAPI || typeof window.notchAPI.readClipImage !== 'function') return;
  try {
    const dataUrl = await window.notchAPI.readClipImage(imagePath);
    if (dataUrl) {
      clipImageCache.set(imagePath, dataUrl);
      clipDataVersion++; // 图片入缓存 → 版本自增，确保二次渲染不被脏标记挡掉（缩略图必须显示）
    }
  } catch (e) {
    // ignore read errors
  }
}

async function addClipEntry(raw) {
  const id = generateId();
  const entry = {
    id,
    type: raw.type || 'text',
    text: raw.text || null,
    imagePath: raw.imagePath || null,
    timestamp: Date.now(),
  };

  // 每一次系统复制都是独立历史事件；相同内容也必须保留为两条记录。
  const updated = window.NotchDomain.prependClipboardHistory(clipHistory, entry, CLIP_MAX);
  clipHistory = updated.history;
  const evicted = updated.evicted;
  if (evicted.length > 0) {
    const evictedPaths = evicted
      .filter((e) => e.type === 'image' && e.imagePath)
      .map((e) => e.imagePath);
    if (evictedPaths.length > 0) {
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages(evictedPaths).catch(() => {});
      }
      evictedPaths.forEach((p) => clipImageCache.delete(p));
    }
  }

  saveClipHistory(clipHistory);

  // 图片条目预加载缩略图
  if (entry.type === 'image' && entry.imagePath) {
    await preloadClipImage(entry.imagePath);
  }

  clipDataVersion++; // clipHistory 已变（含 FIFO 淘汰）
  renderClipList();
  renderClipFavs();
}

function formatClipTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? '取消收藏' : '收藏';
  const timeStr = escapeHtml(formatClipTime(entry.timestamp));
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? `<img class="clip-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
      : `<span class="clip-thumb-placeholder">图片加载中…</span>`;
    return `<div class="clip-item clip-item-image clip-type-image" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制图片">
    <span class="clip-thumb-wrap">${thumbHtml}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span></span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '空白内容'
  );
  return `<div class="clip-item clip-item-text ${typeClass}" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制：${accessiblePreview}">
    <span class="clip-text">${safeText}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span></span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
}

function getFilteredClipItems() {
  if (clipFilter === 'all') return clipHistory;
  if (clipFilter === 'text') return clipHistory.filter((e) => e.type === 'text' || e.type === 'url');
  if (clipFilter === 'image') return clipHistory.filter((e) => e.type === 'image');
  if (clipFilter === 'faved') {
    const favSet = new Set(clipFavorites);
    return clipHistory.filter((e) => favSet.has(e.id));
  }
  return clipHistory;
}

function renderClipList() {
  if (!clipListEl) return;
  // 脏标记：数据/过滤器/图片缓存均未变则跳过全量重建
  if (clipDataVersion === lastRenderedClipVersion) return;

  const items = getFilteredClipItems();
  const favSet = new Set(clipFavorites);

  if (items.length === 0) {
    clipListEl.innerHTML =
      '<div class="clip-empty">' +
      (clipHistory.length ? '没有符合条件的记录' : '复制点什么，历史会出现在这里') +
      '</div>';
    lastRenderedClipVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  clipListEl.innerHTML = items.map((e) => clipEntryHtml(e, favSet.has(e.id))).join('');
  lastRenderedClipVersion = clipDataVersion; // 标记本次渲染版本（在预加载之前）

  // 按需预加载图片：收集当前 items 里 cache 未命中的 image 条目
  // preloadClipImage 成功后自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  if (clipRenderPending) return; // 防重入：已有预加载任务在途
  const missingPaths = items
    .filter((e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath))
    .map((e) => e.imagePath);

  if (missingPaths.length === 0) return;

  clipRenderPending = true;
  Promise.all(missingPaths.map((p) => preloadClipImage(p)))
    .then(() => {
      clipRenderPending = false;
      // 只有至少有一条路径成功填入 cache 才重渲，避免无意义刷新
      const anyLoaded = missingPaths.some((p) => clipImageCache.has(p));
      if (anyLoaded) renderClipList();
    })
    .catch(() => {
      clipRenderPending = false;
    });
}

// ---- 工具栏事件委托 ----
if (clipToolbarEl) {
  clipToolbarEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const filterBtn = e.target.closest('.clip-filter');
    if (filterBtn) {
      clipFilter = filterBtn.dataset.filter || 'all';
      clipToolbarEl.querySelectorAll('.clip-filter').forEach((b) => {
        const selected = b === filterBtn;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      clipDataVersion++; // clipFilter 已变 → 输出变化
      renderClipList();
      return;
    }
    if (e.target.closest('#clip-clear-btn')) {
      requestClearClipHistory();
    }
  });
  clipToolbarEl.querySelectorAll('.clip-filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
}

// ---- 列表事件委托 ----
if (clipListEl) {
  clipListEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.clip-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    // 优先判断子按钮
    const favoriteButton = e.target.closest('.clip-fav-btn');
    if (favoriteButton) {
      toggleClipFavorite(id, {
        restoreFocus: document.activeElement === favoriteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    const deleteButton = e.target.closest('.clip-del-btn');
    if (deleteButton) {
      deleteClipEntry(id, {
        restoreFocus: document.activeElement === deleteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    if (e.target.closest('[data-action="copy"]')) copyClipEntry(id);
  });
}

function focusClipControl(ids, action = 'copy') {
  if (!clipListEl) return;
  for (const id of ids.filter(Boolean)) {
    const target = clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`
    );
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  const activeFilter = clipToolbarEl && clipToolbarEl.querySelector('.clip-filter.active');
  if (activeFilter) activeFilter.focus({ preventScroll: true });
}

function toggleClipFavorite(id, focusContext = null) {
  const idx = clipFavorites.indexOf(id);
  if (idx === -1) {
    clipFavorites.push(id);
  } else {
    clipFavorites.splice(idx, 1);
  }
  clipDataVersion++; // clipFavorites 已变
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    const sameItemButton = clipListEl && clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="fav"]`
    );
    if (sameItemButton) {
      sameItemButton.focus({ preventScroll: true });
    } else {
      focusClipControl([focusContext.nextId, focusContext.previousId]);
    }
  }
}

function deleteClipEntry(id, focusContext = null) {
  const idx = clipHistory.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const entry = clipHistory[idx];
  const favoriteIndex = clipFavorites.indexOf(id);
  clipHistory.splice(idx, 1);
  clipFavorites = clipFavorites.filter((fid) => fid !== id);
  clipDataVersion++; // clipHistory + clipFavorites 已变
  saveClipHistory(clipHistory);
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    focusClipControl([focusContext.nextId, focusContext.previousId]);
  }
  showStatusToast('已删除剪贴记录', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (clipHistory.some((item) => item.id === id)) return;
      clipHistory.splice(Math.min(idx, clipHistory.length), 0, entry);
      if (favoriteIndex !== -1) {
        clipFavorites.splice(Math.min(favoriteIndex, clipFavorites.length), 0, id);
      }
      clipDataVersion++;
      saveClipHistory(clipHistory);
      saveClipFavorites(clipFavorites);
      renderClipList();
      renderClipFavs();
      focusClipControl([id]);
      showStatusToast('已撤销删除');
    },
    onExpire: () => {
      if (entry.type !== 'image' || !entry.imagePath) return;
      clipImageCache.delete(entry.imagePath);
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages([entry.imagePath]).catch(() => {});
      }
    },
  });
}

function resetClipClearConfirmation() {
  clipClearArmed = false;
  if (clipClearBtn) {
    clipClearBtn.classList.remove('confirming');
    clipClearBtn.setAttribute('aria-label', '清空历史');
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast('剪贴板历史已是空的');
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', `再次点击确认清空 ${clipHistory.length} 条历史`);
    }
    showStatusToast(`再点一次垃圾桶，清空 ${clipHistory.length} 条记录`, {
      duration: 3000,
      onExpire: resetClipClearConfirmation,
    });
    return;
  }
  resetClipClearConfirmation();
  clearClipHistory();
}

if (clipClearBtn) {
  clipClearBtn.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  });
}

function clearClipHistory() {
  const removedCount = clipHistory.length;
  const imagePaths = clipHistory
    .filter((e) => e.type === 'image' && e.imagePath)
    .map((e) => e.imagePath);
  clipHistory = [];
  clipFavorites = [];
  clipImageCache.clear();
  clipDataVersion++; // 全部数据已清空
  saveClipHistory([]);
  saveClipFavorites([]);
  if (imagePaths.length > 0 && window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
    window.notchAPI.deleteClipImages(imagePaths).catch(() => {});
  }
  renderClipList();
  renderClipFavs();
  showStatusToast(`已清空 ${removedCount} 条剪贴记录`);
}

async function copyClipEntry(id) {
  const entry = clipHistory.find((e) => e.id === id);
  if (!entry) return false;
  if (!window.notchAPI) return false;
  try {
    const result = typeof window.notchAPI.pasteClipboard === 'function'
      ? await window.notchAPI.pasteClipboard(entry)
      : { ok: await window.notchAPI.writeClipboard(entry), pasted: false };
    if (!result?.ok) {
      showStatusToast('复制失败，请重试');
      return false;
    }
    showStatusToast(result.pasted
      ? '已填入刚才的输入框'
      : result.permissionRequired
        ? '请开启辅助功能权限；内容已复制'
        : entry.type === 'image' ? '图片已复制，可直接粘贴' : '已复制，可直接粘贴');
  } catch (e) {
    showStatusToast('复制失败，请重试');
    return false;
  }
  // 视觉反馈：800ms 后移除 copied 类
  const itemEl = clipListEl && clipListEl.querySelector(`.clip-item[data-id="${CSS.escape(id)}"]`);
  if (itemEl) {
    itemEl.classList.add('copied');
    setTimeout(() => itemEl.classList.remove('copied'), 800);
  }
  return true;
}

// ---- IPC 推送监听 ----
if (window.notchAPI && typeof window.notchAPI.onNewClipEntry === 'function') {
  window.notchAPI.onNewClipEntry((raw) => {
    addClipEntry(raw);
  });
}

renderAll();

document.addEventListener('nas-sync:todos-projection', (event) => {
  const todosJson = event && event.detail && event.detail.todosJson;
  if (typeof todosJson !== 'string') return;
  try {
    localStorage.setItem(STORAGE_KEY, todosJson);
  } catch (error) {
    /* ignore */
  }
  data = loadData();
  renderAll();
});
renderClipList(); // 首屏确保 clip-list DOM 就绪时渲染一次（幂等）
renderClipFavs(); // 首屏渲染收藏剪贴块
initTab();
