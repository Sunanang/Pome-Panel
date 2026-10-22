const pomeLocaleRendererApp = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
const STORAGE_KEY = 'notch-todo-data';
const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const TODO_CATEGORY_KEY = 'notch-todo-category-names-v1';
const TODO_CATEGORY_ORDER_KEY = 'notch-todo-category-order-v1';
const TODO_CATEGORY_DEFAULT_ORDER = ['P0', 'P1', 'P2', 'P3'];
const TODO_CATEGORY_DEFAULTS = {
  get P0() { return pomeLocaleRendererApp.t("copy.courses.60db1a"); },
  get P1() { return pomeLocaleRendererApp.t("copy.mediaWriting.4672dc"); },
  P2: 'Vibe coding',
  get P3() { return pomeLocaleRendererApp.t("copy.dailyLife.f648d6"); },
  P4: '分类 5',
  P5: '分类 6',
  P6: '分类 7',
  P7: '分类 8',
};
const TODO_DOT_CLASS = {
  P0: 'dot-p0', P1: 'dot-p1', P2: 'dot-p2', P3: 'dot-p3',
  P4: 'dot-p4', P5: 'dot-p5', P6: 'dot-p6', P7: 'dot-p7',
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
    if (key && key !== 'notch-workspace-root') result[key] = localStorage.getItem(key);
  }
  return result;
}

let workspaceReloadPending = false;
let workspacePersistenceTimer = null;
let workspacePersistenceRoot = null;
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
    if (typeof reconcileTodoCategoryOrderFromData === 'function') {
      reconcileTodoCategoryOrderFromData();
    }
    if (typeof renderTodoBoard === 'function') renderTodoBoard();
    else {
      PRIORITIES.forEach((priority) => {
        if (typeof renderList === 'function') renderList(priority);
        if (typeof updateCount === 'function') updateCount(priority);
      });
      if (typeof applyTodoCategoryNames === 'function') applyTodoCategoryNames();
    }
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
  if (!bound || (await window.notchAPI.syncGetStatus())?.recovery?.paused || typeof window.notchAPI.syncTodosGetProjection !== 'function') return;
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
    const [snapshot, workspace] = await Promise.all([
      window.notchAPI.loadWorkspaceData(), window.notchAPI.getWorkspace(),
    ]);
    workspacePersistenceRoot = workspace.path;
    const previousRoot = localStorage.getItem('notch-workspace-root');
    if (previousRoot && previousRoot !== workspace.path) {
      sessionStorage.removeItem('notch-workspace-hydrated');
      sessionStorage.setItem('notch-workspace-replace', '1');
    }
    let imported = false;
    if (sessionStorage.getItem('notch-workspace-hydrated') !== '1' && snapshot && typeof snapshot === 'object') {
      const replace = sessionStorage.getItem('notch-workspace-replace') === '1';
      if (replace) {
        workspaceReloadPending = true;
        localStorage.clear();
      }
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && (replace || localStorage.getItem(key) === null)) {
          localStorage.setItem(key, value);
          imported = true;
        }
      });
      sessionStorage.setItem('notch-workspace-hydrated', '1');
      sessionStorage.removeItem('notch-workspace-replace');
      localStorage.setItem('notch-workspace-root', workspace.path);
      if (replace) imported = true;
    }
    if (imported) {
      // The current editors were initialized before the asynchronous import.
      // Their unload/visibility handlers must not overwrite recovered values.
      workspaceReloadPending = true;
      location.reload();
      return;
    }
    localStorage.setItem('notch-workspace-root', workspace.path);
    // Wait until workspace import has finished: writing empty history earlier
    // would mask persisted keys that hydration only imports when absent.
    pruneClipHistory();
    renderClipList();
    renderClipFavs();
    // Bound startup: hydratePortableWorkspace → SQLite projection overrides workspace.
    await hydrateTodosSyncProjectionAfterWorkspace();
    workspacePersistenceTimer = setInterval(() => {
      if (!workspaceReloadPending) window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot(), workspacePersistenceRoot).catch(() => {});
    }, 2000);
  } catch (error) {}
}
// Do not interrupt parser-loaded workspace scripts with a recovery navigation.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydratePortableWorkspace, { once: true });
} else {
  hydratePortableWorkspace();
}
window.notchAPI?.onWorkspaceChanged?.(() => {
  workspaceReloadPending = true;
  clearInterval(workspacePersistenceTimer);
  sessionStorage.removeItem('notch-workspace-hydrated');
  sessionStorage.setItem('notch-workspace-replace', '1');
  location.reload();
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
  // Callers choose persistent failures explicitly; wording and locale do not decide.
  if (options.kind === 'error' && !options.onAction && window.NotchUi?.showError) {
    dismissStatusToast(true);
    window.NotchUi.showError({ diagnostic: message, messageKey: options.messageKey, repairKey: options.repairKey, scope: options.scope, onRepair: options.onRepair });
    return;
  }
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
    pomeLocaleRendererApp.bind(statusToastAction, "textContent", () => (actionLabel || pomeLocaleRendererApp.t("copy.undo.926a50")));
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

function emptyTodoData() {
  return Object.fromEntries(PRIORITIES.map((priority) => [priority, []]));
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTodoData();
    const parsed = JSON.parse(raw);
    return Object.fromEntries(PRIORITIES.map((priority) => [
      priority,
      normalizeTodoItems(parsed && parsed[priority]),
    ]));
  } catch (e) {
    return emptyTodoData();
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

function getLocalTodosForSync() {
  const snapshot = emptyTodoData();
  PRIORITIES.forEach((priority) => {
    snapshot[priority] = (data[priority] || []).map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done === true,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      deadline: typeof item.deadline === 'string' ? item.deadline : '',
      remindedAt: Math.max(0, Number(item.remindedAt) || 0),
    }));
  });
  return JSON.stringify(snapshot);
}
window.getLocalTodosForSync = getLocalTodosForSync;

function saveData(data) {
  if (window.NasSyncMigration && typeof window.NasSyncMigration.isReadonly === 'function') {
    // Prefer live UI state if workspace exposed it
  }
  if (window.__nasTodoReadonly === true) {
    if (typeof showStatusToast === 'function') {
      showStatusToast(pomeLocaleRendererApp.t("copy.migratingPleaseWait.7aed12"), { kind: 'warning' });
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
let todoCategoryOrder = loadTodoCategoryOrder();
const todoSelections = Object.fromEntries(PRIORITIES.map((priority) => [priority, new Set()]));
const todoSelectionAnchors = Object.fromEntries(PRIORITIES.map((priority) => [priority, null]));
let editingTodo = null;
let todoBoardBound = false;

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

function loadTodoCategoryOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TODO_CATEGORY_ORDER_KEY) || 'null');
    const order = Array.isArray(parsed)
      ? parsed.filter((id, index, list) => PRIORITIES.includes(id) && list.indexOf(id) === index)
      : [];
    if (order.length) return order;
  } catch (error) {
    // Fall through to the default four columns.
  }
  return [...TODO_CATEGORY_DEFAULT_ORDER];
}

/**
 * Category order is local-only. After sync/hydration, surface any priority that
 * already has todos so remote P4–P7 items are not invisible on this device.
 */
function reconcileTodoCategoryOrderFromData() {
  const order = [...todoCategoryOrder];
  let changed = false;
  PRIORITIES.forEach((priority) => {
    if ((data[priority] || []).length > 0 && !order.includes(priority)) {
      order.push(priority);
      changed = true;
    }
  });
  if (!order.length) {
    todoCategoryOrder = [...TODO_CATEGORY_DEFAULT_ORDER];
    persistTodoCategoryOrder();
    return;
  }
  if (changed) {
    todoCategoryOrder = order;
    persistTodoCategoryOrder();
  }
}

function persistTodoCategoryOrder() {
  if (window.__nasTodoReadonly === true) return false;
  try {
    localStorage.setItem(TODO_CATEGORY_ORDER_KEY, JSON.stringify(todoCategoryOrder));
  } catch (error) {
    // Keep the in-memory order for this session.
  }
  return true;
}

function persistTodoCategoryNames() {
  if (window.__nasTodoReadonly === true) {
    if (typeof showStatusToast === 'function') {
      showStatusToast(pomeLocaleRendererApp.t("copy.migratingPleaseWait.7aed12"), { kind: 'warning' });
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
  todoCategoryOrder.forEach((categoryId) => {
    const name = todoCategoryNames[categoryId] || TODO_CATEGORY_DEFAULTS[categoryId] || categoryId;
    const input = document.querySelector(`.todo-category-name[data-category="${categoryId}"]`);
    const addInput = document.querySelector(`.add-row input[data-priority="${categoryId}"]`);
    if (input) input.value = name;
    if (addInput) addInput.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.addATaskTo.efb0ec", { arg1: (name) }));
  });
}

function quadrantHtml(priority) {
  const name = escapeHtml(todoCategoryNames[priority] || TODO_CATEGORY_DEFAULTS[priority] || priority);
  const dot = TODO_DOT_CLASS[priority] || 'dot-p3';
  const canRemove = todoCategoryOrder.length > 1;
  return (
    `<section class="quadrant tile" data-priority="${priority}">` +
    `<div class="quadrant-header">` +
    `<span class="dot ${dot}"></span>` +
    `<input class="todo-category-name" data-category="${priority}" value="${name}" maxlength="24" aria-label="修改待办分类名称" />` +
    `<button class="bulk-delete todo-bulk-delete" type="button" data-bulk-priority="${priority}" hidden>删除</button>` +
    (canRemove
      ? `<button class="todo-remove-category" type="button" data-remove-priority="${priority}" aria-label="删除分类" title="删除分类">×</button>`
      : '') +
    `<span class="count" data-priority="${priority}">0</span>` +
    `</div>` +
    `<ul class="todo-list" data-priority="${priority}"></ul>` +
    `<div class="add-row">` +
    `<input type="text" placeholder="添加待办，回车保存…" aria-label="添加待办" data-priority="${priority}" maxlength="80" />` +
    `<button class="todo-deadline-trigger" type="button" data-deadline-priority="${priority}" aria-label="选择截止时间"><span>日期</span></button>` +
    `</div>` +
    `</section>`
  );
}

function syncTodoAddCategoryButton() {
  const button = document.getElementById('todo-add-category');
  if (!button) return;
  const full = todoCategoryOrder.length >= PRIORITIES.length;
  const readonly = window.__nasTodoReadonly === true;
  // Hide at 8 categories; also hide while migration readonly so it never steals taps.
  button.hidden = full || readonly;
  button.disabled = readonly;
}

function parkTodoDatePopover() {
  const popover = document.getElementById('todo-date-popover');
  // Mount on body with position:fixed so .panel { overflow:hidden } and
  // .quadrant { overflow:hidden } cannot clip the calendar.
  if (popover && popover.parentElement !== document.body) document.body.appendChild(popover);
  return popover;
}

function positionTodoDatePopover(anchorEl) {
  const popover = parkTodoDatePopover();
  if (!popover || !anchorEl) return;
  popover.hidden = false;
  popover.classList.add('todo-date-popover--portal');
  popover.style.visibility = 'hidden';
  const anchorRect = anchorEl.getBoundingClientRect();
  const popW = Math.max(popover.offsetWidth || 224, 200);
  const popH = Math.max(popover.offsetHeight || 280, 220);
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchorRect.right - popW;
  let top = anchorRect.top - popH - gap;
  if (top < gap) top = anchorRect.bottom + gap;
  left = Math.max(gap, Math.min(left, vw - popW - gap));
  top = Math.max(gap, Math.min(top, vh - popH - gap));
  popover.style.position = 'fixed';
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.style.right = 'auto';
  popover.style.bottom = 'auto';
  popover.style.zIndex = '240';
  popover.style.visibility = '';
}

function renderTodoBoard() {
  const root = document.getElementById('todo-sections');
  if (!root) return;
  parkTodoDatePopover();
  root.dataset.count = String(todoCategoryOrder.length);
  root.innerHTML = todoCategoryOrder.map((priority) => quadrantHtml(priority)).join('');
  syncTodoAddCategoryButton();
  applyTodoCategoryNames();
  todoCategoryOrder.forEach((priority) => {
    renderList(priority);
    updateCount(priority);
    applyDefaultTodoDeadline(document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`));
  });
}

function addTodoCategory() {
  if (window.__nasTodoReadonly === true) return;
  const next = PRIORITIES.find((priority) => !todoCategoryOrder.includes(priority));
  if (!next) return;
  todoCategoryOrder = [...todoCategoryOrder, next];
  if (!Array.isArray(data[next])) data[next] = [];
  if (!todoCategoryNames[next]) {
    todoCategoryNames = window.NotchDomain.normalizeTodoCategoryNames(todoCategoryNames, TODO_CATEGORY_DEFAULTS);
  }
  persistTodoCategoryOrder();
  persistTodoCategoryNames();
  saveData(data);
  mirrorTodoToSync({
    op: 'upsert-category',
    priority: next,
    name: todoCategoryNames[next],
  });
  renderTodoBoard();
}

function removeTodoCategory(priority) {
  if (window.__nasTodoReadonly === true) return;
  if (!todoCategoryOrder.includes(priority) || todoCategoryOrder.length <= 1) return;
  const count = (data[priority] || []).length;
  if (count > 0) {
    const ok = window.confirm(`删除「${todoCategoryNames[priority] || priority}」将同时删除其中的 ${count} 条待办，确定吗？`);
    if (!ok) return;
  }
  const removedItems = [...(data[priority] || [])];
  data[priority] = [];
  todoCategoryOrder = todoCategoryOrder.filter((id) => id !== priority);
  todoSelections[priority] = new Set();
  todoSelectionAnchors[priority] = null;
  persistTodoCategoryOrder();
  saveData(data);
  // Main process delete-todo expects entityId (same as deleteTodo).
  removedItems.forEach((item) => {
    mirrorTodoToSync({ op: 'delete-todo', entityId: item.id });
  });
  renderTodoBoard();
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
    ? new Intl.DateTimeFormat(pomeLocaleRendererApp.getState().formatLocale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(item.deadline))
    : '';
  const toggleLabel = item.done ? pomeLocaleRendererApp.t("copy.markIncomplete.b29b66", { arg1: (safeText) }) : pomeLocaleRendererApp.t("copy.markComplete.56d5a3", { arg1: (safeText) });
  const battery = window.NotchDomain.todoTimeBattery(item, Date.now());
  // 逾期项整条填满红色并只显示一个白色感叹号：剩余 0% 是「快到了」，
  // 逾期是「已经欠账」，两者不能长得一样。
  const batteryHtml = battery
    ? `<span class="todo-battery" data-tone="${battery.tone}"${battery.overdue ? ' data-overdue="true" role="img"' : ''} title="${battery.label}" aria-label="${battery.label}"><i style="--battery:${battery.overdue ? 100 : battery.percent}%"></i><b>${battery.overdue ? '!' : `${battery.percent}%`}</b></span>`
    : '';
  const isEditing = editingTodo?.priority === priority && editingTodo?.id === item.id;
  const contentHtml = isEditing
    ? ("<div class=\"todo-inline-editor\"><input class=\"todo-inline-name\" value=\"" + (safeText) + "\" maxlength=\"80\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.editTaskName.44f8a7")) + "\" data-i18n-aria-label=\"copy.editTaskName.44f8a7\" />" + (batteryHtml) + "<button class=\"todo-inline-deadline\" type=\"button\" data-action=\"edit-deadline\">" + (deadline || pomeLocaleRendererApp.t("copy.date.70d0c1")) + "</button><button class=\"todo-inline-save\" type=\"button\" data-action=\"save-edit\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.saveChanges.991bb7")) + "\" data-i18n-aria-label=\"copy.saveChanges.991bb7\">✓</button></div>")
    : ("<button class=\"todo-copy\" type=\"button\" data-action=\"edit\" title=\"" + (safeText) + "\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.edit.fe62a2", { arg2: (safeText) })) + "\"><span class=\"todo-text\">" + (safeText) + "</span>" + (batteryHtml) + (deadline ? `<time class="todo-ddl" datetime="${escapeHtml(item.deadline)}">${escapeHtml(deadline)}</time>` : '') + "</button>");
  return ("\n    <li class=\"todo-item" + (doneClass) + (selectedClass) + "\" data-id=\"" + (safeId) + "\" data-priority=\"" + (priority) + "\">\n      <button class=\"checkbox\" type=\"button\" data-action=\"toggle\" aria-label=\"" + (toggleLabel) + "\" aria-pressed=\"" + (item.done) + "\">" + (checkSvg()) + "</button>\n      " + (contentHtml) + "\n      <button class=\"delete\" type=\"button\" data-action=\"delete\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.delete.322a6b", { arg9: (safeText) })) + "\">×</button>\n    </li>\n  ");
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
  pomeLocaleRendererApp.bind(button, "textContent", () => (pomeLocaleRendererApp.t("copy.delete.2f9daa")));
  button.setAttribute('aria-label', count ? pomeLocaleRendererApp.t("copy.deleteItems.0bfa6f", { arg1: (count) }) : pomeLocaleRendererApp.t("copy.deleteSelected.435bf8"));
}

function updateCount(priority) {
  const countEl = document.querySelector(`.count[data-priority="${priority}"]`);
  if (!countEl) return;
  const items = data[priority] || [];
  const pending = items.filter((t) => !t.done).length;
  countEl.textContent = String(pending);
}

function renderAll() {
  if (document.getElementById('todo-sections') && !document.querySelector('#todo-sections .quadrant')) {
    renderTodoBoard();
    return;
  }
  todoCategoryOrder.forEach((p) => {
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
    if (typeof showStatusToast === 'function') showStatusToast(pomeLocaleRendererApp.t("copy.migratingPleaseWait.7aed12"), { kind: 'warning' });
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
  showStatusToast(pomeLocaleRendererApp.t("copy.deleted.ada912", { arg1: (summary) }), {
    actionLabel: pomeLocaleRendererApp.t("copy.undo.926a50"),
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
      showStatusToast(pomeLocaleRendererApp.t("copy.deletionUndone.2e33cb"));
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
  notch.setAttribute('aria-label', expanded ? pomeLocaleRendererApp.t("copy.collapsePomePanel.b8359e") : pomeLocaleRendererApp.t("copy.expandPomePanel.07c85a"));
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
      await window.notchAPI?.beginOpenTiming?.();
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
    if (layoutMetrics?.dragEnabled === false) {
      // W0-3：护栏期只取消这次手势。主进程返回 false 是不够的——清掉指针状态后，
      // 随后的 click 会落进 setMode 分支，拖一下就误展开。
      notchToggleFromPointer = true;
      clearNotchPointerState();
      return;
    }
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
    if (window.closeWorkHubOverlay?.()) return;
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
    root.setAttribute('data-drag-enabled', metrics.dragEnabled === false ? 'false' : 'true');
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
  // All pages share one native canvas. Show the page immediately; background
  // sync must not leave the previous page intercepting a user's first click.
  applyTabDom(name);
  positionIndicator();
  await ipcSetTab(name);
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
  // metaKey 在 Mac 是 ⌘、在 Windows 是 Win 键，对应的 accelerator 名字不同（P2-3）。
  if (event.metaKey) parts.push(readPlatformCapabilities().ui?.metaAccelerator || 'Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

// 快捷键提示里的修饰符按平台写：Mac 是 ⌘ / ⌥ / ⌃ / ⇧，Windows 是 Ctrl / Alt / Shift / Win。
function renderShortcutRecorderHint() {
  const hint = document.getElementById('shortcut-recorder-hint');
  if (!hint) return;
  const modifiers = window.NotchPlatform.modifierHints(readPlatformCapabilities());
  pomeLocaleRendererApp.bind(hint, "textContent", () => (pomeLocaleRendererApp.t("copy.useSpaceAloneOrCombineOtherKeys.250962", { arg1: (modifiers.join(' / ')) })));
}

const SHORTCUT_ERROR_TEXT = {
  system_reserved: pomeLocaleRendererApp.t("copy.thisCombinationIsReservedByTheSystem.e04553"),
  occupied: pomeLocaleRendererApp.t("copy.thisShortcutIsAlreadyInUse.b4a985"),
};

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
    if (shortcutRecorderValue) pomeLocaleRendererApp.bind(shortcutRecorderValue, "textContent", () => (pomeLocaleRendererApp.t("copy.pressTheCompleteKeyCombination.2eeecd")));
    return;
  }
  if (accelerator !== 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (shortcutRecorderValue) pomeLocaleRendererApp.bind(shortcutRecorderValue, "textContent", () => (pomeLocaleRendererApp.t("copy.onlySpaceCanBeUsedAlone.9e1bc0")));
    return;
  }
  const display = window.NotchPlatform.formatAccelerator(accelerator, readPlatformCapabilities()) || accelerator;
  if (shortcutRecorderValue) shortcutRecorderValue.textContent = display;
  const result = await window.notchAPI?.setPanelShortcut?.(accelerator).catch(() => ({ ok: false }));
  if (!result?.ok) {
    if (shortcutRecorderValue) {
      pomeLocaleRendererApp.bind(shortcutRecorderValue, "textContent", () => (SHORTCUT_ERROR_TEXT[result?.error] || pomeLocaleRendererApp.t("copy.thisShortcutCannotBeUsed.711008")));
    }
    return;
  }
  showStatusToast(pomeLocaleRendererApp.t("copy.shortcutSetTo.3aeabe", { arg1: (display) }));
  setTimeout(closeShortcutRecorder, 420);
});

shortcutRecorderCancel?.addEventListener('click', closeShortcutRecorder);
function openShortcutRecorder() {
  if (!isExpanded) setMode(true);
  shortcutRecorderActive = true;
  shortcutRecorder.hidden = false;
  renderShortcutRecorderHint();
  pomeLocaleRendererApp.bind(shortcutRecorderValue, "textContent", () => (pomeLocaleRendererApp.t("copy.waitingForInput.3b286f")));
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

function finishTodoCategoryEdit(input) {
  if (!input) return;
  const categoryId = input.dataset.category;
  if (!PRIORITIES.includes(categoryId)) return;
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
}

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

function todoTimePickerValue(picker) {
  return picker?.querySelector('button[aria-selected="true"]')?.dataset.value || '';
}

function setTodoTimePickerValue(picker, value) {
  if (!picker) return;
  const want = String(value);
  let matched = null;
  picker.querySelectorAll('button[data-value]').forEach((button) => {
    const selected = button.dataset.value === want;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (selected) matched = button;
  });
  if (matched) {
    matched.scrollIntoView({ block: 'nearest' });
  }
}

function fillTodoTimeOptions() {
  const fill = (picker, values) => {
    if (!picker || picker.dataset.filled === '1') return;
    picker.replaceChildren();
    values.forEach((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'option';
      button.dataset.value = String(value);
      button.textContent = String(value).padStart(2, '0');
      button.setAttribute('aria-selected', 'false');
      picker.append(button);
    });
    picker.dataset.filled = '1';
  };
  fill(todoEditorHour, Array.from({ length: 24 }, (_, hour) => hour));
  fill(todoEditorMinute, Array.from({ length: 12 }, (_, index) => index * 5));
}

function renderTodoCalendar() {
  if (!todoCalendarGrid) return;
  const now = new Date();
  const days = new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(todoEditorYear, todoEditorMonthIndex, 1).getDay() + 6) % 7;
  if (todoEditorMonth) pomeLocaleRendererApp.bind(todoEditorMonth, "textContent", () => (pomeLocaleRendererApp.t("copy.message.23b25d", { arg1: (todoEditorYear), arg2: (todoEditorMonthIndex + 1) })));
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
    hour: todoTimePickerValue(todoEditorHour),
    minute: todoTimePickerValue(todoEditorMinute),
  });
}

function applyTodoEditorSelection(markManual = true) {
  if (!todoEditorContext) return false;
  const deadline = selectedTodoDeadline();
  if (!deadline || Date.parse(deadline) <= Date.now()) {
    if (todoEditorError) pomeLocaleRendererApp.bind(todoEditorError, "textContent", () => (pomeLocaleRendererApp.t("copy.chooseADeadlineLaterThanNow.c1cc99")));
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
    trigger.querySelector('span').textContent = new Intl.DateTimeFormat(pomeLocaleRendererApp.getState().formatLocale, {
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
  setTodoTimePickerValue(todoEditorHour, selectedDate.getHours());
  setTodoTimePickerValue(todoEditorMinute, Math.floor(selectedDate.getMinutes() / 5) * 5);
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
  if (todoEditorBackdrop) {
    const target = anchor || (item
      ? document.querySelector(`.todo-item[data-id="${CSS.escape(item.id)}"] .todo-inline-deadline`)
      : trigger);
    positionTodoDatePopover(target || trigger);
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
function onTodoTimePickerClick(event) {
  const button = event.target.closest('button[data-value]');
  const picker = event.currentTarget;
  if (!button || !picker) return;
  setTodoTimePickerValue(picker, button.dataset.value);
  applyTodoEditorSelection(true);
}
todoEditorHour?.addEventListener('click', onTodoTimePickerClick);
todoEditorMinute?.addEventListener('click', onTodoTimePickerClick);

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
  trigger.querySelector('span').textContent = new Intl.DateTimeFormat(pomeLocaleRendererApp.getState().formatLocale, {
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

function submitTodoFromInput(input) {
  const priority = input?.dataset?.priority;
  if (!PRIORITIES.includes(priority)) return;
  const deadlineInput = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  const value = input.value;
  if (!value.trim()) return;
  applyDefaultTodoDeadline(deadlineInput);
  if (!deadlineInput || !deadlineInput.dataset.deadline) {
    deadlineInput?.classList.add('invalid');
    openTodoEditor(priority);
    return;
  }
  if (!addTodo(priority, value, deadlineInput.dataset.deadline)) {
    deadlineInput.classList.add('invalid');
    showStatusToast(pomeLocaleRendererApp.t("copy.invalidDeadlineFormat.88c2cb"));
    return;
  }
  input.value = '';
  if (todoEditorContext?.mode === 'add' && todoEditorContext.priority === priority) closeTodoEditor();
  resetTodoDraftDeadline(deadlineInput);
  deadlineInput.classList.remove('invalid');
  input.focus({ preventScroll: true });
}

function bindTodoBoardOnce() {
  if (todoBoardBound) return;
  const root = document.getElementById('todo-sections');
  if (!root) return;
  todoBoardBound = true;

  document.getElementById('todo-add-category')?.addEventListener('click', () => addTodoCategory());

  root.addEventListener('change', (event) => {
    const input = event.target.closest('.todo-category-name[data-category]');
    if (input) finishTodoCategoryEdit(input);
  });

  root.addEventListener('keydown', (event) => {
    const categoryInput = event.target.closest('.todo-category-name[data-category]');
    if (categoryInput) {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        categoryInput.blur();
      }
      if (event.key === 'Escape') {
        categoryInput.value = todoCategoryNames[categoryInput.dataset.category] || '';
        categoryInput.blur();
      }
      return;
    }
    const inline = event.target.closest('.todo-inline-name');
    if (inline) {
      const item = event.target.closest('.todo-item');
      const priority = item?.dataset?.priority;
      if (!item || !priority) return;
      if (event.key === 'Escape') {
        editingTodo = null;
        renderList(priority);
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        item.querySelector('[data-action="save-edit"]')?.click();
      }
      return;
    }
    const addInput = event.target.closest('.add-row input[data-priority]');
    if (!addInput) return;
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat) return;
    submitTodoFromInput(addInput);
  });

  root.addEventListener('focusin', (event) => {
    const addInput = event.target.closest('.add-row input[data-priority]');
    if (!addInput) return;
    applyDefaultTodoDeadline(
      document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${addInput.dataset.priority}"]`)
    );
  });

  root.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-priority]');
    if (remove) {
      removeTodoCategory(remove.dataset.removePriority);
      return;
    }
    const bulk = event.target.closest('.todo-bulk-delete[data-bulk-priority]');
    if (bulk) {
      const priority = bulk.dataset.bulkPriority;
      const selected = todoSelections[priority];
      if (!selected || !selected.size) return;
      const removed = (data[priority] || []).filter((item) => selected.has(item.id));
      data[priority] = (data[priority] || []).filter((item) => !selected.has(item.id));
      selected.clear();
      todoSelectionAnchors[priority] = null;
      saveData(data);
      removed.forEach((item) => {
        mirrorTodoToSync({ op: 'delete-todo', entityId: item.id });
      });
      renderList(priority);
      updateCount(priority);
      showStatusToast(pomeLocaleRendererApp.t("copy.selectedTasksDeleted.8f28c4"));
      return;
    }
    const deadline = event.target.closest('.todo-deadline-trigger[data-deadline-priority]');
    if (deadline) {
      openTodoEditor(deadline.dataset.deadlinePriority);
      return;
    }
    const list = event.target.closest('.todo-list[data-priority]');
    if (!list) return;
    const priority = list.dataset.priority;
    const item = event.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    if (event.shiftKey) {
      event.preventDefault();
      const result = window.NotchDomain.updateRangeSelection(
        window.NotchDomain.sortTodosForDisplay(data[priority] || []).map((todo) => todo.id),
        [...(todoSelections[priority] || [])],
        id,
        todoSelectionAnchors[priority],
        true
      );
      todoSelections[priority] = new Set(result.selected);
      todoSelectionAnchors[priority] = result.anchor;
      renderList(priority);
      return;
    }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      toggleTodo(priority, id);
    } else if (action === 'edit') {
      const todo = (data[priority] || []).find((row) => row.id === id);
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
}

bindTodoBoardOnce();
reconcileTodoCategoryOrderFromData();
renderTodoBoard();

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
    pomodoroToggle.setAttribute('aria-label', pomodoroRunning ? pomeLocaleRendererApp.t("copy.pauseFocusTimer.c8fdd3") : pomeLocaleRendererApp.t("copy.startFocusTimer.b3da88"));
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
      showStatusToast(pomeLocaleRendererApp.t("copy.setADurationFirst.ca86b2"));
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
        showStatusToast(pomeLocaleRendererApp.t("copy.minuteFocusSessionComplete.4a8c00", { arg1: (completedMinutes) }));
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
      type === 'heading' ? pomeLocaleRendererApp.t("copy.heading.c3405f") :
      type === 'task' ? pomeLocaleRendererApp.t("copy.tasks.52fdbb") :
      type === 'quote' ? pomeLocaleRendererApp.t("copy.quote.e0ec65") : pomeLocaleRendererApp.t("copy.item.79f326")
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
  const label = selected || pomeLocaleRendererApp.t("copy.linkText.6f64e4");
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
  if (type === 'bold') return wrapNoteSelection('**', '**', pomeLocaleRendererApp.t("copy.boldText.eb4d95"));
  if (type === 'italic') return wrapNoteSelection('*', '*', pomeLocaleRendererApp.t("copy.italicText.1ebce6"));
  if (type === 'code') return wrapNoteSelection('`', '`', pomeLocaleRendererApp.t("copy.code.e6f04f"));
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
    pomeLocaleRendererApp.bind(noteEditButton, "textContent", () => (isPreview ? pomeLocaleRendererApp.t("copy.edit.051836") : pomeLocaleRendererApp.t("copy.done.c0b3fb")));
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
  return pomeLocaleRendererApp.noteTitle(note).trim() || pomeLocaleRendererApp.t("copy.untitledNote.b0b0ce");
}

function noteArchiveExcerpt(note) {
  const lines = String(note && note.content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.join(' ').replace(/[#*_~`>\[\]]/g, '').slice(0, 86);
}

function noteArchiveTime(timestamp) {
  return new Intl.DateTimeFormat(pomeLocaleRendererApp.getState().formatLocale, {
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
      ? ("<span class=\"notes-empty-mark\" aria-hidden=\"true\">⌕</span><strong><span data-i18n=\"copy.noMatchingNotes.a187a5\">" + (pomeLocaleRendererApp.t("copy.noMatchingNotes.a187a5")) + "</span></strong><p><span data-i18n=\"copy.tryAnotherSearchTerm.6f0405\">" + (pomeLocaleRendererApp.t("copy.tryAnotherSearchTerm.6f0405")) + "</span></p>")
      : ("<span class=\"notes-empty-mark\" aria-hidden=\"true\">✎</span><strong><span data-i18n=\"copy.noSavedNotesYet.ddc489\">" + (pomeLocaleRendererApp.t("copy.noSavedNotesYet.ddc489")) + "</span></strong><p><span data-i18n=\"copy.selectNewToStartWriting.a84fff\">" + (pomeLocaleRendererApp.t("copy.selectNewToStartWriting.a84fff")) + "</span></p>");
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
  pomeLocaleRendererApp.bind(title, "placeholder", () => (pomeLocaleRendererApp.t("copy.untitledNote.b0b0ce")));
  title.maxLength = 80;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.noteTitleEditDirectly.abb0d0"));
  const time = document.createElement('time');
  time.className = 'notes-detail-time';
  pomeLocaleRendererApp.bind(time, "textContent", () => (pomeLocaleRendererApp.t("copy.updated.7114c0", { arg1: (noteArchiveTime(note.updatedAt)) })));
  heading.append(title, time);
  const actions = document.createElement('div');
  actions.className = 'notes-detail-actions';

  const modeSwitch = document.createElement('div');
  modeSwitch.className = 'note-mode-switch notes-detail-mode-switch';
  modeSwitch.setAttribute('role', 'group');
  modeSwitch.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.previewOrEdit.566766"));
  ;[
    ['preview', pomeLocaleRendererApp.t("copy.preview.13d61f")],
    ['edit', pomeLocaleRendererApp.t("copy.edit.051836")],
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
  remove.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.deleteNote.07a619"));
  pomeLocaleRendererApp.bind(remove, "title", () => (pomeLocaleRendererApp.t("copy.deleteNote.07a619")));
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
  pomeLocaleRendererApp.bind(editor, "placeholder", () => (pomeLocaleRendererApp.t("copy.writeANoteInMarkdown.6e340b")));
  editor.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.editNote.097174", { arg1: (noteArchiveTitle(note)) }));
  editor.spellcheck = false;

  const preview = document.createElement('div');
  preview.id = 'notes-preview';
  preview.className = 'note-preview notes-preview';
  preview.tabIndex = 0;
  preview.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.previewNote.aa5b1d", { arg1: (noteArchiveTitle(note)) }));
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
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next));
  renderNotesLibrary();
}

function updateSavedNotePresentation(note) {
  if (!note) return;
  const title = noteArchiveTitle(note);
  const detailTitle = notesDetail?.querySelector('.notes-detail-title');
  const detailTime = notesDetail?.querySelector('.notes-detail-time');
  if (detailTitle && document.activeElement !== detailTitle) detailTitle.value = note.title || '';
  if (detailTime) pomeLocaleRendererApp.bind(detailTime, "textContent", () => (pomeLocaleRendererApp.t("copy.saved.983d08", { arg1: (noteArchiveTime(note.updatedAt)) })));
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
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
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
  if (time) pomeLocaleRendererApp.bind(time, "textContent", () => (pomeLocaleRendererApp.t("copy.saving.6bdb44")));
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    const pending = pendingNotesEditor;
    pendingNotesEditor = null;
    if (pending) persistNotesEditor(pending);
  }, 220);
}

let notesVisibleLimit = 80;
function renderNotesLibrary() {
  if (!notesList) return;
  const archive = loadNoteArchive();
  const notes = window.NotchDomain.filterNotes(archive, notesSearch?.value || '');
  if (notesCount) pomeLocaleRendererApp.bind(notesCount, "textContent", () => (pomeLocaleRendererApp.t("copy.notes.0b8a21", { arg1: (archive.length) })));
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0]?.id || '';
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    pomeLocaleRendererApp.bind(empty, "textContent", () => (archive.length ? pomeLocaleRendererApp.t("copy.noMatchingNotes.3b7e97") : pomeLocaleRendererApp.t("copy.savedNotesWillAppearHere.d4a4be")));
    notesList.append(empty);
    renderNotesDetail(notes);
    return;
  }
  notes.slice(0, notesVisibleLimit).forEach((note) => {
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
  if (notes.length > notesVisibleLimit) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'workspace-button compact';
    pomeLocaleRendererApp.bind(more, "textContent", () => (pomeLocaleRendererApp.t("copy.showMore.8e8b5f", { arg1: (notesVisibleLimit), arg2: (notes.length) })));
    more.addEventListener('click', () => { notesVisibleLimit += 80; renderNotesLibrary(); });
    notesList.append(more);
  }
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
  const notes = [note, ...loadNoteArchive()];
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
  selectedNoteId = note.id;
  notesDetailMode = 'edit';
  if (notesSearch) notesSearch.value = '';
  renderNotesLibrary();
  requestAnimationFrame(() => {
    notesDetail?.querySelector('#notes-editor')?.focus({ preventScroll: true });
  });
  showStatusToast(pomeLocaleRendererApp.t("copy.noteCreated.246d61"));
});

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast(pomeLocaleRendererApp.t("copy.writeSomethingBeforeArchiving.9a3119"));
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
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
  localStorage.setItem(NOTE_KEY, noteInput.value);
  selectedNoteId = activeId;
  renderNotesLibrary();
  showStatusToast(pomeLocaleRendererApp.t("copy.noteSaved.6d1bf9"));
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
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes));
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
    showStatusToast(pomeLocaleRendererApp.t("copy.noteDeleted.381e47"));
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


// ============ 首页 · 自适应 Bento 布局（长按换位 + 迷你/小/中/大组件） ============
const HOME_ORDER_KEY = 'notch-home-order-v3';
const HOME_SIZES_KEY = 'notch-home-widget-sizes-v2';
const HOME_PLACEMENTS_KEY = 'notch-home-placements-v1';
const HOME_HIDDEN_MODULES_KEY = 'notch-home-hidden-modules-v1';
const HOME_MODULE_REGISTRY = ['music', 'pomodoro', 'cursor', 'recorder', 'inbox', 'windows', 'mirror', 'note', 'commands', 'sun'];
// 渲染层只读能力层（P0-1），不再自己判断平台。主进程通过 preload 下发 capabilities；
// 拿不到时（例如没有 preload 的测试窗口）才用本地能力层按平台名补齐。
function readPlatformCapabilities() {
  const exposed = window.notchAPI?.capabilities;
  if (exposed && Array.isArray(exposed.unavailableHomeModules)) return exposed;
  return window.NotchPlatform.resolveCapabilities(exposed?.platform || window.notchAPI?.platform || 'darwin');
}
const unavailableHomeModules = [...readPlatformCapabilities().unavailableHomeModules];
let homeCapabilities = readPlatformCapabilities();
let windowsInlineRequested = false;
try { windowsInlineRequested = localStorage.getItem('pome-windows-inline-v1') === '1'; } catch {}
const effectiveHomeHidden = (hidden) => window.NotchPlatform.effectiveHiddenModules(hidden, HOME_MODULE_REGISTRY,
  !windowsInlineRequested && homeCapabilities.features.winNativeSetting && !homeCapabilities.features.windowSwitcher
    ? [...unavailableHomeModules, 'windows'] : unavailableHomeModules);
// 运行期能力降级（Windows 原生模块加载失败 / 用户关闭开关）时重算首页可见模块。
window.notchAPI?.onCapabilitiesChanged?.((capabilities) => {
  if (!Array.isArray(capabilities?.unavailableHomeModules)) return;
  homeCapabilities = capabilities;
  unavailableHomeModules.splice(0, unavailableHomeModules.length, ...capabilities.unavailableHomeModules);
  document.dispatchEvent(new CustomEvent('notch:home-modules-changed', { detail: visibilitySnapshot() }));
});
const HOME_ORDER_DEFAULTS = ['music', 'pomodoro', 'cursor', 'recorder', 'inbox', 'commands', 'mirror', 'note', 'windows', 'sun'];
const HOME_SIZE_DEFAULTS = {
  music: 'small',
  windows: 'medium',
  inbox: 'medium',
  recorder: 'small',
  mirror: 'medium',
  note: 'medium',
  commands: 'mini',
  pomodoro: 'mini',
  cursor: 'small',
  sun: 'medium',
};
const HOME_SIZE_LABELS = { get mini() { return pomeLocaleRendererApp.t("copy.mini.43d4ba"); }, get small() { return pomeLocaleRendererApp.t("copy.small.6a7339"); }, get medium() { return pomeLocaleRendererApp.t("copy.medium.a567bd"); }, get large() { return pomeLocaleRendererApp.t("copy.large.7d4ca7"); } };
const homeBento = document.getElementById('home-bento');
const homeContextMenu = document.getElementById('home-context-menu');
const homeTabPanel = document.getElementById('tab-home');
// New profiles and an exact old Windows default get platform defaults.
// Customized visibility, sizes and deliberate gaps remain the user's choices.
let freshWindowsHome = false;
try {
  freshWindowsHome = readPlatformCapabilities().homeDefaults?.showSun === true
    && [HOME_ORDER_KEY, HOME_SIZES_KEY, HOME_PLACEMENTS_KEY, HOME_HIDDEN_MODULES_KEY, 'notch-home-layout-v2']
      .every((key) => localStorage.getItem(key) === null);
} catch {}

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

let legacyDefaultHome = false;
try {
  legacyDefaultHome = window.NotchDomain.isLegacyDefaultHomeLayout({
    order: JSON.parse(localStorage.getItem(HOME_ORDER_KEY) || 'null'),
    sizes: JSON.parse(localStorage.getItem(HOME_SIZES_KEY) || 'null'),
    placements: JSON.parse(localStorage.getItem(HOME_PLACEMENTS_KEY) || 'null'),
    hiddenIds: JSON.parse(localStorage.getItem(HOME_HIDDEN_MODULES_KEY) || '[]'),
  });
} catch {}
let homeOrder = loadHomeOrder();
let homeSizes = loadHomeSizes();
let homeWorkingLayout = loadHomePlacements();
// A hidden card's remembered slot is separate from the active grid: it may be
// occupied later, so it must never participate in layout validation or swaps.
let homeInboxSavedPlacement = homeWorkingLayout?.placements.inbox || null;
const HOME_INBOX_SLOT_KEY = 'notch-home-inbox-slot-v1';
if (!homeInboxSavedPlacement) {
  try {
    const slot = JSON.parse(localStorage.getItem(HOME_INBOX_SLOT_KEY) || 'null');
    if (slot && window.NotchDomain.validateHomeWidgetLayout({ allowGaps: true, placements: { inbox: slot } }, ['inbox'], 12, 4)) homeInboxSavedPlacement = slot;
  } catch {}
}
if (legacyDefaultHome) { homeOrder = [...HOME_ORDER_DEFAULTS]; homeSizes = {...HOME_SIZE_DEFAULTS}; homeWorkingLayout = null; }
const loadedHomeVisibility = loadHiddenHomeModules();
let hiddenHomeModules = loadedHomeVisibility.hiddenIds;
const repairWindowsDefaultHome = readPlatformCapabilities().homeDefaults?.showSun === true
  && window.NotchDomain.isLegacyWindowsDefaultHomeLayout({
    order: homeOrder, defaultOrder: HOME_ORDER_DEFAULTS, sizes: homeSizes, defaults: HOME_SIZE_DEFAULTS,
    placements: homeWorkingLayout?.placements, hiddenIds: hiddenHomeModules,
    unavailableIds: effectiveHomeHidden([]), registry: HOME_MODULE_REGISTRY,
  });
const useWindowsHomeDefaults = freshWindowsHome || repairWindowsDefaultHome;
if (repairWindowsDefaultHome) {
  hiddenHomeModules = hiddenHomeModules.filter(id => id !== 'sun');
  homeWorkingLayout = null;
}
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
      if (homeWorkingLayout.placements.inbox) homeInboxSavedPlacement = { ...homeWorkingLayout.placements.inbox };
      localStorage.setItem(HOME_PLACEMENTS_KEY, JSON.stringify(homeWorkingLayout.placements));
      if (homeInboxSavedPlacement) localStorage.setItem(HOME_INBOX_SLOT_KEY, JSON.stringify(homeInboxSavedPlacement));
    }
    return true;
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话内的布局。
    return false;
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

function sealResolvedHomeLayout(layout, visibleIds, {
  preferredIds = [],
  frozenIds = [],
} = {}) {
  if (!layout?.placements) return { layout: null, changed: false };
  const filled = window.NotchDomain.fillHomeLayoutGaps(layout.placements, {
    preferredIds,
    frozenIds,
  });
  if (!filled.placements) return { layout: null, changed: false };
  const sealed = {
    allowGaps: filled.gapCount > 0,
    placements: filled.placements,
    variants: Object.fromEntries(visibleIds.map((id) => (
      [id, window.NotchDomain.layoutVariantForPlacement(filled.placements[id])]
    ))),
  };
  if (!window.NotchDomain.validateHomeWidgetLayout(sealed, visibleIds, 12, 4)) {
    return { layout: null, changed: false };
  }
  if (filled.changed) {
    visibleIds.forEach((id) => {
      if (filled.sizes[id]) homeSizes[id] = filled.sizes[id];
    });
  }
  return { layout: sealed, changed: filled.changed };
}

function resolveValidatedHomeLayout(hiddenIds, order = homeOrder, sizes = homeSizes, {
  forcePack = false,
  preferredIds = [],
  frozenIds = [],
  sealGaps = false,
  persistSeal = false,
} = {}) {
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
        const sealed = sealGaps
          ? sealResolvedHomeLayout(candidate, visibleIds, { preferredIds, frozenIds })
          : { layout: candidate, changed: false };
        const resolved = sealed.layout || candidate;
        homeWorkingLayout = cloneHomeLayout(resolved);
        if (persistSeal && sealed.changed) saveHomeLayout();
        return resolved;
      }
    }
  }

  const layout = window.NotchDomain.resolveHomeWidgetLayout(order, sizes, hiddenIds, 12, 4);
  if (window.NotchDomain.validateHomeWidgetLayout(layout, visibleIds, 12, 4)) {
    const sealed = sealGaps
      ? sealResolvedHomeLayout(layout, visibleIds, { preferredIds, frozenIds })
      : { layout, changed: false };
    const resolved = sealed.layout || layout;
    homeWorkingLayout = cloneHomeLayout(resolved);
    if (persistSeal && sealed.changed) saveHomeLayout();
    return resolved;
  }
  return null;
}

function cancelHomeLayoutMotion() {
  homeLayoutMotionGeneration += 1;
  homeLayoutMotionAnimations.forEach((animation) => {
    try { animation.cancel(); } catch (error) {}
  });
  homeLayoutMotionAnimations = [];
  // 清掉卡片上残留的 CSS transition（如 ::after 光晕），避免重排结束后 getAnimations() 仍非 0。
  homeTiles.forEach((tile) => {
    if (!tile || tile.hidden) return;
    tile.getAnimations().forEach((animation) => {
      try { animation.cancel(); } catch (error) {}
    });
  });
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
      homeTiles.forEach((tile) => {
        if (!tile || tile.hidden) return;
        tile.getAnimations().forEach((animation) => {
          try { animation.finish(); } catch (error) {
            try { animation.cancel(); } catch (cancelError) {}
          }
        });
      });
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
  const placeholder = document.getElementById('home-inbox-placeholder');
  if (placeholder) {
    const slot = homeInboxSavedPlacement;
    const overlaps = slot && Object.values(layout.placements).some(p => p.column < slot.column + slot.width && p.column + p.width > slot.column && p.row < slot.row + slot.height && p.row + p.height > slot.row);
    placeholder.hidden = !hiddenHomeModules.includes('inbox') || !slot || overlaps;
    if (!placeholder.hidden) placeholder.style.gridArea = `${slot.row + 1} / ${slot.column + 1} / span ${slot.height} / span ${slot.width}`;
  }
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
    if (moduleId === 'pomodoro') syncPomodoroBgSrc(tile);
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
  document.dispatchEvent(new CustomEvent('notch:home-layout-applied', { detail: { reason } }));
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
const introducedSunLayout = useWindowsHomeDefaults ? {
  order: homeOrder, sizes: homeSizes, hiddenIds: hiddenHomeModules, placements: null,
} : window.NotchDomain.introduceHomeModule({
  order: homeOrder,
  sizes: homeSizes,
  defaults: HOME_SIZE_DEFAULTS,
  placements: homeWorkingLayout?.placements || null,
  hiddenIds: hiddenHomeModules,
  moduleId: 'sun',
  defaultSize: HOME_SIZE_DEFAULTS.sun,
  registry: HOME_MODULE_REGISTRY,
});
const sunHiddenChanged = JSON.stringify(hiddenHomeModules) !== JSON.stringify(introducedSunLayout.hiddenIds);
homeOrder = introducedSunLayout.order;
homeSizes = introducedSunLayout.sizes;
hiddenHomeModules = introducedSunLayout.hiddenIds;
if (introducedSunLayout.placements) {
  homeWorkingLayout = {
    allowGaps: true,
    placements: introducedSunLayout.placements,
    variants: Object.fromEntries(Object.entries(introducedSunLayout.placements).map(([id, item]) => (
      [id, window.NotchDomain.layoutVariantForPlacement(item)]
    ))),
  };
}
let inboxAlreadyKnown = false;
try { inboxAlreadyKnown = Object.hasOwn(JSON.parse(localStorage.getItem(HOME_SIZES_KEY) || '{}'), 'inbox'); } catch {}
const introducedInboxLayout = inboxAlreadyKnown ? { sizes: homeSizes, placements: homeWorkingLayout?.placements, hiddenIds: effectiveHomeHidden(hiddenHomeModules) } : window.NotchDomain.normalizeHomeInboxLayout({
  order: homeOrder, sizes: homeSizes, placements: homeWorkingLayout?.placements,
  hiddenIds: effectiveHomeHidden(hiddenHomeModules), registry: HOME_MODULE_REGISTRY,
});
homeSizes = introducedInboxLayout.sizes;
const inboxHiddenChanged = !hiddenHomeModules.includes('inbox') && introducedInboxLayout.hiddenIds.includes('inbox');
if (inboxHiddenChanged) hiddenHomeModules.push('inbox');
if (introducedInboxLayout.placements) homeWorkingLayout = { allowGaps: true, placements: introducedInboxLayout.placements };
saveHomeLayout();
if (repairWindowsDefaultHome || sunHiddenChanged || inboxHiddenChanged) saveHiddenHomeModules();

let initialHomeLayout = resolveValidatedHomeLayout(hiddenHomeModules, homeOrder, homeSizes, {
  forcePack: useWindowsHomeDefaults && readPlatformCapabilities().homeDefaults.fillGrid,
  sealGaps: useWindowsHomeDefaults && readPlatformCapabilities().homeDefaults.fillGrid,
  persistSeal: useWindowsHomeDefaults && readPlatformCapabilities().homeDefaults.fillGrid,
});
if (!initialHomeLayout) {
  // Repair once without entering safe mode: keep visibility prefs, reset packable sizes.
  homeOrder = [...HOME_ORDER_DEFAULTS];
  homeSizes = window.NotchDomain.normalizeHomeWidgetSizes(
    { ...HOME_SIZE_DEFAULTS },
    HOME_SIZE_DEFAULTS,
    ''
  );
  saveHomeLayout();
  initialHomeLayout = resolveValidatedHomeLayout(hiddenHomeModules, homeOrder, homeSizes, {
    sealGaps: true,
    persistSeal: true,
  });
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
  const before = windowsInlineRequested;
  const requestInline = moduleId === 'windows' && visible === true && homeCapabilities.features.winNativeSetting && !before;
  if (requestInline) windowsInlineRequested = true;
  const result = setHomeModuleVisibleCore(moduleId, visible, requestInline);
  if (!result.ok) windowsInlineRequested = before;
  else if (requestInline) { try { localStorage.setItem('pome-windows-inline-v1', '1'); } catch {} }
  if (result.ok && result.changed && result.persisted) window.NotchUi?.clearError('home:layout');
  return result;
}
function setHomeModuleVisibleCore(moduleId, visible, force = false) {
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
  const changed = force || JSON.stringify(next.hiddenIds) !== JSON.stringify(current);
  if (!changed) {
    return { ok: true, changed: false, hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (moduleId === 'recorder' && visible === false
    && window.NotchWorkspace?.isRecordingActive?.()) {
    return { ok: false, changed: false, error: 'recording_active', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const previousWorking = cloneHomeLayout(homeWorkingLayout);
  const previousSizes = { ...homeSizes };
  if (moduleId === 'inbox') {
    const currentLayout = previousWorking || resolveValidatedHomeLayout(current);
    if (!currentLayout) return { ok: false, changed: false, error: 'layout_invalid', hiddenIds: current, persisted: homeVisibilityPersisted };
    const previousSlot = homeInboxSavedPlacement;
    if (currentLayout.placements.inbox) homeInboxSavedPlacement = { ...currentLayout.placements.inbox };
    const retained = Object.fromEntries(Object.entries(currentLayout.placements).filter(([id]) => id !== 'inbox'));
    const result = window.NotchDomain.normalizeHomeInboxLayout({
      order: homeOrder, sizes: homeSizes, placements: retained,
      hiddenIds: effectiveHomeHidden(next.hiddenIds), registry: HOME_MODULE_REGISTRY,
      preservePositions: true, preferredInboxPlacement: homeInboxSavedPlacement,
    });
    const visibleIds = HOME_MODULE_REGISTRY.filter(id => !effectiveHomeHidden(next.hiddenIds).includes(id));
    const layout = { allowGaps: true, placements: result.placements,
      variants: Object.fromEntries(Object.entries(result.placements || {}).map(([id, item]) => [id, window.NotchDomain.layoutVariantForPlacement(item)])) };
    if ((visible && result.hiddenIds.includes('inbox')) || !window.NotchDomain.validateHomeWidgetLayout(layout, visibleIds, 12, 4)) {
      homeInboxSavedPlacement = previousSlot;
      return { ok: false, changed: false, error: 'layout_invalid', hiddenIds: current, persisted: homeVisibilityPersisted };
    }
    try {
      if (!visible && document.getElementById('home-inbox')?.contains(document.activeElement)) document.activeElement.blur();
      hiddenHomeModules = next.hiddenIds;
      homeSizes = result.sizes;
      homeWorkingLayout = cloneHomeLayout(layout);
      applyHomeLayout(layout, { reason: 'visibility' });
    } catch {
      hiddenHomeModules = current; homeSizes = previousSizes;
      homeWorkingLayout = previousWorking; homeInboxSavedPlacement = previousSlot;
      try { applyHomeLayout(currentLayout, { reason: 'rollback' }); } catch {}
      return { ok: false, changed: false, error: 'dom_apply_failed', hiddenIds: current, persisted: homeVisibilityPersisted };
    }
    const visibilityPersisted = saveHiddenHomeModules();
    const layoutPersisted = saveHomeLayout();
    const persisted = visibilityPersisted && layoutPersisted;
    document.dispatchEvent(new CustomEvent('notch:home-modules-changed', { detail: visibilitySnapshot() }));
    return { ok: true, changed: true, hiddenIds: [...hiddenHomeModules], persisted };
  }
  const areaOf = { mini: 2, small: 4, medium: 8, large: 16 };
  homeWorkingLayout = null;
  let preferredIds = [];
  let layout = resolveValidatedHomeLayout(next.hiddenIds, homeOrder, homeSizes, {
    forcePack: true,
    sealGaps: true,
  });
  let fittedSizes = false;
  if (!layout && visible === true) {
    const visibleIds = HOME_MODULE_REGISTRY.filter((id) => !next.hiddenIds.includes(id));
    const visibleDefaults = Object.fromEntries(visibleIds.map((id) => [id, HOME_SIZE_DEFAULTS[id] || 'medium']));
    const visibleSizes = Object.fromEntries(visibleIds.map((id) => (
      [id, previousSizes[id] || HOME_SIZE_DEFAULTS[id] || 'medium']
    )));
    const fittedVisible = window.NotchDomain.normalizeHomeWidgetSizes(
      visibleSizes,
      visibleDefaults,
      moduleId,
      48
    );
    preferredIds = visibleIds.filter((id) => (
      id !== moduleId && (areaOf[fittedVisible[id]] || 0) < (areaOf[visibleSizes[id]] || 0)
    ));
    const fitted = { ...previousSizes, ...fittedVisible };
    homeWorkingLayout = null;
    homeSizes = fitted;
    layout = resolveValidatedHomeLayout(next.hiddenIds, homeOrder, fitted, {
      forcePack: true,
      preferredIds,
      sealGaps: true,
    });
    if (layout) {
      fittedSizes = JSON.stringify(homeSizes) !== JSON.stringify(previousSizes);
    } else {
      homeSizes = previousSizes;
    }
  }
  const currentLayout = previousWorking
    || resolveValidatedHomeLayout(current, homeOrder, previousSizes, { forcePack: true });
  if (!layout || !currentLayout) {
    homeSizes = previousSizes;
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
    homeSizes = previousSizes;
    homeWorkingLayout = previousWorking;
    try { applyHomeLayout(currentLayout, { reason: 'rollback' }); } catch (rollbackError) {}
    return { ok: false, changed: false, error: 'dom_apply_failed', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const visibilityPersisted = saveHiddenHomeModules();
  const layoutPersisted = fittedSizes || JSON.stringify(homeSizes) !== JSON.stringify(previousSizes) ? saveHomeLayout() : true;
  const persisted = visibilityPersisted && layoutPersisted;
  const detail = visibilitySnapshot();
  document.dispatchEvent(new CustomEvent('notch:home-modules-changed', { detail }));
  return { ok: true, changed: true, hiddenIds: [...hiddenHomeModules], persisted };
}

window.NotchHome = Object.freeze({
  getVisibility: visibilitySnapshot,
  isVisible: (moduleId) => visibilitySnapshot().visibleIds.includes(String(moduleId || '')),
  setModuleVisible: setHomeModuleVisible,
  saveLayout: () => {
    if (homeLayoutReadOnly) return { ok:false, error:'layout_read_only' };
    const visibilitySaved = saveHiddenHomeModules();
    const layoutSaved = saveHomeLayout();
    return { ok:visibilitySaved && layoutSaved, error:visibilitySaved && layoutSaved ? null : 'home_layout_storage_unavailable' };
  },
});
document.getElementById('home-inbox-placeholder')?.addEventListener('click', async () => {
  await setActiveTab('settings');
  const input = document.querySelector('[data-settings-home-module="inbox"]');
  input?.scrollIntoView({ block: 'center' }); input?.focus({ preventScroll: true });
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
  let homeLayoutSaveFailed = false;

  const syncHomeContextMenu = () => {
    if (!homeContextMenu) return;
    const editBtn = homeContextMenu.querySelector('[data-home-ctx="toggle-edit"]');
    if (editBtn) {
      // 编辑中：右键只调尺寸，不出现编辑项
      editBtn.hidden = homeLayoutEditing;
      editBtn.removeAttribute('aria-pressed');
      pomeLocaleRendererApp.bind(editBtn, "textContent", () => (pomeLocaleRendererApp.t("copy.editLayout.c427bd")));
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
      homeLayoutSaveFailed = false;
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
        if (saveHomeLayout() && homeLayoutSaveFailed) window.NotchUi?.clearError('home:layout');
      } else if (action === 'save') {
        const changed = JSON.stringify(homeLayoutEditSnapshot) !== JSON.stringify({
          order: [...homeOrder], sizes: { ...homeSizes }, layout: cloneHomeLayout(homeWorkingLayout),
        });
        if (!saveHomeLayout()) {
          homeLayoutSaveFailed = true;
          showStatusToast(pomeLocaleRendererApp.t('ui.error.layoutSave'), {
            kind:'error', messageKey:'ui.error.layoutSave', repairKey:'ui.error.layoutSaveRepair',
            scope:'home:layout', onRepair:() => { void setActiveTab('home').then(() => homeLayoutSaveBtn?.focus({ preventScroll:true })); },
          });
          return; // Keep the edit snapshot and save/cancel controls available for retry.
        }
        if (changed || homeLayoutSaveFailed) window.NotchUi?.clearError('home:layout');
      }
      homeLayoutSaveFailed = false;
      homeLayoutEditSnapshot = null;
    }
    homeLayoutEditing = next;
    homeBento.dataset.layoutEditing = String(homeLayoutEditing);
    homeTabPanel?.classList.toggle('layout-editing', homeLayoutEditing);
    syncHomeLayoutEditBar();
    syncHomeContextMenu();
    if (!silent && next && !wasEditing) {
      showStatusToast(pomeLocaleRendererApp.t("copy.dragCardsToSwapPositionsThenSave.adf3b9"));
    } else if (!silent && !next && wasEditing) {
      showStatusToast(action === 'cancel' ? pomeLocaleRendererApp.t("copy.layoutChangesCanceled.bd25dc") : pomeLocaleRendererApp.t("copy.layoutSaved.76afba"));
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

  // Exchange origins while preserving both footprints; only collisions require packing.
  const commitSwap = (sourceId, targetId, { fromDrag = false } = {}) => {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const current = cloneHomeLayout(homeWorkingLayout);
    if (!current?.placements?.[sourceId] || !current?.placements?.[targetId]) return false;

    const next = window.NotchDomain.swapHomeWidgetPlacements(current, sourceId, targetId, { order: homeOrder });
    if (!next) return false;

    const visibleIds = HOME_MODULE_REGISTRY.filter(
      (id) => !effectiveHomeHidden(hiddenHomeModules).includes(id)
    );
    if (!window.NotchDomain.validateHomeWidgetLayout(next, visibleIds, 12, 4)) return false;

    // The gap filler can resize siblings only; exchanged cards keep their saved sizes.
    visibleIds.forEach((id) => {
      if (id === sourceId || id === targetId) return;
      const before = current.placements[id]; const after = next.placements[id];
      if (before.width !== after.width || before.height !== after.height) homeSizes[id] = sizeFromPlacement(after);
    });
    const nextOrder = swappedOrderFrom(homeOrder, sourceId, targetId);
    if (nextOrder) homeOrder = nextOrder;
    homeWorkingLayout = next;
    // 拖动预览已完成让位：松手只落格，不再播一次互换动画
    applyHomeLayout(next, { reason: fromDrag ? 'drag-commit' : 'reorder' });
    if (!homeLayoutEditing && saveHomeLayout()) window.NotchUi?.clearError('home:layout');
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
    homeBento.querySelector('.home-swap-placeholder')?.remove();
    homeTiles.forEach((tile) => {
      tile.classList.remove('layout-displacing');
      tile.style.removeProperty('--home-displace-x');
      tile.style.removeProperty('--home-displace-y');
    });
  };

  // Preview the same placement plan used on drop, using translations without resizing.
  const previewDisplaceTarget = (sourceId, targetId) => {
    if (!dragState?.originRects) return;
    clearDisplacePreview();
    clearDropTarget();
    dragState.previewTargetId = targetId || null;
    dragState.target = null;
    if (!targetId) return;
    const original = dragState.originLayout;
    const preview = window.NotchDomain.swapHomeWidgetPlacements(original, sourceId, targetId, { order: dragState.originOrder });
    if (!preview) return;
    const targetTile = homeBento.querySelector(`[data-home-module="${targetId}"]`);
    if (!targetTile) return;
    const bounds = homeBento.getBoundingClientRect();
    const style = getComputedStyle(homeBento);
    const columnGap = parseFloat(style.columnGap) * bounds.width / homeBento.offsetWidth;
    const rowGap = parseFloat(style.rowGap) * bounds.height / homeBento.offsetHeight;
    const pitchX = (bounds.width + columnGap) / 12;
    const pitchY = (bounds.height + rowGap) / 4;
    homeTiles.forEach((item) => {
      const id = item.dataset.homeModule;
      if (id === sourceId || !original.placements[id] || !preview.placements[id]) return;
      const dx = (preview.placements[id].column - original.placements[id].column) * pitchX;
      const dy = (preview.placements[id].row - original.placements[id].row) * pitchY;
      if (!dx && !dy) return;
      item.style.setProperty('--home-displace-x', `${dx}px`);
      item.style.setProperty('--home-displace-y', `${dy}px`);
      item.classList.add('layout-displacing');
    });
    const placeholder = document.createElement('div');
    const destination = preview.placements[sourceId];
    placeholder.className = 'home-swap-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.gridColumn = `${destination.column + 1} / span ${destination.width}`;
    placeholder.style.gridRow = `${destination.row + 1} / span ${destination.height}`;
    homeBento.append(placeholder);
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
    const layout = resolveValidatedHomeLayout(hiddenHomeModules, homeOrder, homeSizes, {
      forcePack: true,
      sealGaps: true,
      frozenIds: [moduleId],
    });
    if (!layout) {
      homeSizes = previousSizes;
      homeWorkingLayout = previousLayout;
      showStatusToast(pomeLocaleRendererApp.t("copy.notEnoughSpaceMakeAnotherWidgetSmaller.cb3c70"));
      return;
    }
    applyHomeLayout(layout, { reason: 'size' });
    const persisted = homeLayoutEditing ? false : saveHomeLayout();
    if (persisted && JSON.stringify(homeSizes) !== JSON.stringify(previousSizes)) window.NotchUi?.clearError('home:layout');
    showStatusToast(pomeLocaleRendererApp.t("copy.widgetSizeSetTo.f1ae86", { arg1: (HOME_SIZE_LABELS[homeSizes[moduleId]]) }));
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
    if (swapped) showStatusToast(pomeLocaleRendererApp.t("copy.positionsSwapped.290b00"));
    else showStatusToast(pomeLocaleRendererApp.t("copy.notEnoughSpaceToSwap.94e606"));
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
        originLayout: cloneHomeLayout(homeWorkingLayout),
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
          originLayout: cloneHomeLayout(homeWorkingLayout),
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


function syncPomodoroBgSrc(tile) {
  const root = tile || document.getElementById('home-pomodoro');
  if (!root) return;
  const photos = root.querySelectorAll('img.pomodoro-bg-photo');
  if (!photos.length) return;
  const variant = root.dataset.layoutVariant || '';
  const sizeByVariant = {
    mini: 'mini',
    compact: 'small',
    wide: 'medium',
    tall: 'large',
    full: 'medium',
  };
  const size = sizeByVariant[variant] || 'medium';
  const next = `assets/pomodoro-bg-${size}.webp`;
  const position = variant === 'full' ? '100% 50%' : 'center';
  photos.forEach((img) => {
    if (img.getAttribute('src') !== next) img.setAttribute('src', next);
    img.style.objectPosition = position;
  });
}

// ============ 首页 · 人像镜面 ============
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
const mirrorPixelReveal = document.getElementById('mirror-pixel-reveal');
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
  homeMirror?.classList.remove('live', 'camera-starting');
  mirrorStage?.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.openLiveMirror.108daa"));
  mirrorStage?.setAttribute('aria-pressed', 'false');
  mirrorStage?.removeAttribute('aria-busy');
}

// 被系统挡住时，除了说清楚还要给一条出路：Windows 上没有授权弹窗，
// 用户必须自己去隐私设置里把「允许应用访问摄像头」打开（P3-2）。
async function showMediaPermissionToast(kind) {
  const prompt = await window.notchAPI?.getMediaAccessStatus?.(kind).catch(() => null);
  if (!prompt) {
    showStatusToast(kind === 'camera' ? pomeLocaleRendererApp.t("copy.cameraPermissionIsNeededToOpenThe.50c6ae") : pomeLocaleRendererApp.t("copy.microphonePermissionRequired.0d9923"));
    return;
  }
  showStatusToast(prompt.message, prompt.canOpenSettings ? {
    actionLabel: prompt.actionLabel,
    duration: 4200,
    onAction: () => window.notchAPI?.openPrivacySettings?.(prompt.pane),
  } : { duration: 4200 });
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
    homeMirror?.classList.add('live');
    mirrorStage?.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.closeLiveMirror.a64be7"));
    mirrorStage?.setAttribute('aria-pressed', 'true');
  } catch (error) {
    stopMirror();
    const denied = error && (
      error.name === 'NotAllowedError' || error.message === 'camera_permission_denied'
    );
    if (denied) await showMediaPermissionToast('camera');
    else showStatusToast(pomeLocaleRendererApp.t("copy.couldnTOpenTheCamera.7e9d5c"));
  } finally {
    mirrorStarting = false;
    homeMirror?.classList.remove('camera-starting');
    mirrorStage?.removeAttribute('aria-busy');
  }
}

if (mirrorStage) {
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
      pomeLocaleRendererApp.t("copy.starItemsInClipboardToKeepThem.f3311e") +
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
          ? ("<img class=\"clipfav-thumb\" src=\"" + (escapeHtml(dataUrl)) + "\" alt=\"" + (pomeLocaleRendererApp.attribute("copy.image.d24c10")) + "\" data-i18n-alt=\"copy.image.d24c10\" draggable=\"false\"/>")
          : ("<div class=\"clipfav-thumb-placeholder\"><span data-i18n=\"copy.image.801357\">" + (pomeLocaleRendererApp.t("copy.image.801357")) + "</span></div>");
        return (
          ("<div class=\"clipfav-item clip-type-image\" data-id=\"" + (safeId) + "\" role=\"button\" tabindex=\"0\" title=\"" + (pomeLocaleRendererApp.attribute("copy.image.d24c10")) + "\" data-i18n-title=\"copy.image.d24c10\">") +
          mediaHtml +
          ("<span class=\"clipfav-text\"><span data-i18n=\"copy.image.d24c10\">" + (pomeLocaleRendererApp.t("copy.image.d24c10")) + "</span></span>") +
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

function pruneClipHistory() {
  const trimmed = window.NotchDomain.trimClipboardHistory(clipHistory, clipFavorites);
  clipHistory = trimmed.history;
  // A synced or restored row may share an image with a surviving favorite.
  const imageKey = imagePath => window.NotchPlatform.portableMediaPath('clipboard-images', imagePath);
  const retainedPaths = new Set(clipHistory.map(row => row.imagePath).filter(Boolean).map(imageKey));
  const evictedPaths = [...new Set(trimmed.evicted.map(row => row.imagePath)
    .filter(imagePath => imagePath && !retainedPaths.has(imageKey(imagePath))))];
  saveClipHistory(clipHistory);
  saveClipFavorites(clipFavorites);
  clipDataVersion++;
  evictedPaths.forEach(imagePath => clipImageCache.delete(imagePath));
  if (evictedPaths.length && window.notchAPI?.deleteClipImages) {
    window.notchAPI.deleteClipImages(evictedPaths).catch(() => {});
  }
}

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
  clipHistory = [entry, ...clipHistory];
  pruneClipHistory();

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
  if (diff < 60 * 1000) return pomeLocaleRendererApp.t("copy.justNow.de6785");
  if (diff < 60 * 60 * 1000) return pomeLocaleRendererApp.t("copy.minutesAgo.5c5fd5", { arg1: (Math.floor(diff / 60000)) });
  if (diff < 24 * 60 * 60 * 1000) return pomeLocaleRendererApp.t("copy.hoursAgo.9112fb", { arg1: (Math.floor(diff / 3600000)) });
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? pomeLocaleRendererApp.t("copy.unstar.dca608") : pomeLocaleRendererApp.t("copy.star.60a535");
  const timeStr = escapeHtml(formatClipTime(entry.timestamp));
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? ("<img class=\"clip-thumb\" src=\"" + (escapeHtml(dataUrl)) + "\" alt=\"" + (pomeLocaleRendererApp.attribute("copy.image.d24c10")) + "\" data-i18n-alt=\"copy.image.d24c10\" draggable=\"false\"/>")
      : ("<span class=\"clip-thumb-placeholder\"><span data-i18n=\"copy.loadingImage.f304d7\">" + (pomeLocaleRendererApp.t("copy.loadingImage.f304d7")) + "</span></span>");
    return ("<div class=\"clip-item clip-item-image clip-type-image\" data-id=\"" + (safeId) + "\">\n  <button class=\"clip-copy-target\" type=\"button\" data-action=\"copy\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.copyImage.4c2b82")) + "\" data-i18n-aria-label=\"copy.copyImage.4c2b82\">\n    <span class=\"clip-thumb-wrap\">" + (thumbHtml) + "</span>\n    <span class=\"clip-meta\"><span class=\"clip-time\">" + (timeStr) + "</span></span>\n  </button>\n  <button class=\"clip-fav-btn" + (favClass) + "\" type=\"button\" data-action=\"fav\" aria-label=\"" + (favLabel) + "\">" + (star) + "</button>\n  <button class=\"clip-del-btn\" type=\"button\" data-action=\"delete\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.delete.2f9daa")) + "\" data-i18n-aria-label=\"copy.delete.2f9daa\">×</button>\n</div>");
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || pomeLocaleRendererApp.t("copy.blankContent.09d2d3")
  );
  return ("<div class=\"clip-item clip-item-text " + (typeClass) + "\" data-id=\"" + (safeId) + "\">\n  <button class=\"clip-copy-target\" type=\"button\" data-action=\"copy\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.copy.3f65f7", { arg3: (accessiblePreview) })) + "\">\n    <span class=\"clip-text\">" + (safeText) + "</span>\n    <span class=\"clip-meta\"><span class=\"clip-time\">" + (timeStr) + "</span></span>\n  </button>\n  <button class=\"clip-fav-btn" + (favClass) + "\" type=\"button\" data-action=\"fav\" aria-label=\"" + (favLabel) + "\">" + (star) + "</button>\n  <button class=\"clip-del-btn\" type=\"button\" data-action=\"delete\" aria-label=\"" + (pomeLocaleRendererApp.attribute("copy.delete.2f9daa")) + "\" data-i18n-aria-label=\"copy.delete.2f9daa\">×</button>\n</div>");
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
      (clipHistory.length ? pomeLocaleRendererApp.t("copy.noMatchingItems.4659ba") : pomeLocaleRendererApp.t("copy.copySomethingToSeeItsHistoryHere.f0571f")) +
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
  pruneClipHistory();
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
  showStatusToast(pomeLocaleRendererApp.t("copy.clipboardEntryDeleted.be12bb"), {
    actionLabel: pomeLocaleRendererApp.t("copy.undo.926a50"),
    duration: 5000,
    onAction: () => {
      if (clipHistory.some((item) => item.id === id)) return;
      clipHistory.splice(Math.min(idx, clipHistory.length), 0, entry);
      if (favoriteIndex !== -1) {
        clipFavorites.splice(Math.min(favoriteIndex, clipFavorites.length), 0, id);
      }
      pruneClipHistory();
      renderClipList();
      renderClipFavs();
      focusClipControl([id]);
      showStatusToast(pomeLocaleRendererApp.t("copy.deletionUndone.2e33cb"));
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
    clipClearBtn.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.clearHistory.17ac4a"));
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast(pomeLocaleRendererApp.t("copy.clipboardHistoryIsAlreadyEmpty.d4a211"));
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', pomeLocaleRendererApp.t("copy.clickAgainToClearHistoryEntries.04c46d", { arg1: (clipHistory.length) }));
    }
    showStatusToast(pomeLocaleRendererApp.t("copy.clickTheBinAgainToClearEntries.8ef455", { arg1: (clipHistory.length) }), {
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
  showStatusToast(pomeLocaleRendererApp.t("copy.clearedClipboardEntries.e98862", { arg1: (removedCount) }));
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
      showStatusToast(pomeLocaleRendererApp.t("copy.copyFailedTryAgain.86ee28"));
      return false;
    }
    showStatusToast(result.pasted
      ? pomeLocaleRendererApp.t("copy.pastedIntoThePreviousInput.dd7d6e")
      : result.permissionRequired
        ? pomeLocaleRendererApp.t("copy.enableAccessibilityPermissionContentHasBeenCopied.20d80d")
        // Windows：目标以管理员身份运行时 UIPI 会静默吞掉按键，只能请用户手动粘贴（P4-1）。
        : result.reason === 'elevated'
          ? pomeLocaleRendererApp.t("copy.copiedTheTargetAppIsRunningAs.e85a67")
          : entry.type === 'image' ? pomeLocaleRendererApp.t("copy.imageCopiedReadyToPaste.5abf25") : pomeLocaleRendererApp.t("copy.copiedReadyToPaste.afa9e1"));
  } catch (e) {
    showStatusToast(pomeLocaleRendererApp.t("copy.copyFailedTryAgain.86ee28"));
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

function getWorkspaceSnapshotForSync() {
  let links = [];
  let recordings = [];
  if (typeof window.getLinkGroupsForSync === 'function') {
    links = window.getLinkGroupsForSync() || [];
  } else {
    try { links = JSON.parse(localStorage.getItem('notch-link-groups') || '[]'); } catch (error) { links = []; }
  }
  if (typeof window.getRecordingsForSync === 'function') {
    recordings = window.getRecordingsForSync() || [];
  } else {
    try { recordings = JSON.parse(localStorage.getItem('notch-recordings') || '[]'); } catch (error) { recordings = []; }
  }
  let commands = [];
  if (typeof window.getCommandsForSync === 'function') {
    commands = window.getCommandsForSync() || [];
  } else {
    try { commands = JSON.parse(localStorage.getItem('notch-home-commands') || '[]'); } catch (error) { commands = []; }
  }
  let archive = [];
  try {
    archive = JSON.parse(localStorage.getItem(NOTE_ARCHIVE_KEY) || '[]');
  } catch (error) {
    archive = [];
  }
  return {
    notes: {
      home: noteInput ? noteInput.value : (localStorage.getItem(NOTE_KEY) || ''),
      archive: Array.isArray(archive) ? archive : [],
      activeId: localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) || '',
    },
    links: Array.isArray(links) ? links : [],
    commands: Array.isArray(commands) ? commands : [],
    clipboard: {
      history: Array.isArray(clipHistory) ? clipHistory.map((item) => ({
        id: item.id,
        type: item.type,
        text: item.text,
        imagePath: item.imagePath,
        timestamp: item.timestamp,
      })) : [],
      favorites: Array.isArray(clipFavorites) ? clipFavorites.slice() : [],
    },
    recordings: Array.isArray(recordings) ? recordings : [],
  };
}
window.getWorkspaceSnapshotForSync = getWorkspaceSnapshotForSync;

function applyWorkspaceNotes(notes) {
  if (!notes || typeof notes !== 'object') return;
  if (typeof notes.home === 'string') {
    if (notes.home) localStorage.setItem(NOTE_KEY, notes.home);
    else localStorage.removeItem(NOTE_KEY);
    if (noteInput) noteInput.value = notes.home;
  }
  if (Array.isArray(notes.archive)) {
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.archive));
  }
  if (notes.activeId) localStorage.setItem(NOTE_ACTIVE_ARCHIVE_KEY, String(notes.activeId));
  else localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
  if (typeof renderNotesLibrary === 'function') renderNotesLibrary();
  if (noteInput && typeof setNoteMode === 'function') {
    setNoteMode(noteInput.value.trim() ? 'preview' : 'edit', false);
  }
}

function applyWorkspaceClipboard(clipboard) {
  if (!clipboard || typeof clipboard !== 'object') return;
  if (Array.isArray(clipboard.history)) {
    clipHistory = clipboard.history.map(normalizeClipEntry).filter(Boolean);
  }
  if (Array.isArray(clipboard.favorites)) {
    clipFavorites = clipboard.favorites.filter((id) => typeof id === 'string');
  }
  pruneClipHistory();
  if (typeof renderClipList === 'function') renderClipList();
  if (typeof renderClipFavs === 'function') renderClipFavs();
}

document.addEventListener('nas-sync:workspace-projection', (event) => {
  const detail = event && event.detail ? event.detail : {};
  if (detail.notes) applyWorkspaceNotes(detail.notes);
  if (detail.clipboard) applyWorkspaceClipboard(detail.clipboard);
});

if (window.notchAPI && typeof window.notchAPI.onSyncWorkspaceProjection === 'function') {
  window.notchAPI.onSyncWorkspaceProjection((payload) => {
    document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection', { detail: payload }));
  });
}

document.addEventListener('nas-sync:todos-projection', (event) => {
  const todosJson = event && event.detail && event.detail.todosJson;
  if (typeof todosJson !== 'string') return;
  try {
    localStorage.setItem(STORAGE_KEY, todosJson);
  } catch (error) {
    /* ignore */
  }
  data = loadData();
  reconcileTodoCategoryOrderFromData();
  renderTodoBoard();
});
renderClipList(); // 首屏确保 clip-list DOM 就绪时渲染一次（幂等）
renderClipFavs(); // 首屏渲染收藏剪贴块
initTab();

window.prepareWorkspaceBackupSnapshot = () => {
  flushNotesEditorSave();
  localStorage.setItem('notch-home-note', noteInput.value);
  return collectLocalStorageSnapshot();
};

window.addEventListener('pome:language-changed', () => {
  let savedCategories = {};
  try { savedCategories = JSON.parse(localStorage.getItem(TODO_CATEGORY_KEY) || '{}') || {}; } catch {}
  for (const priority of PRIORITIES) {
    if (savedCategories[priority]) continue; // Saved names are user data, even if they equal an old default.
    const input = document.querySelector(`.todo-category-name[data-category="${priority}"]`);
    const previous = todoCategoryNames[priority];
    todoCategoryNames[priority] = TODO_CATEGORY_DEFAULTS[priority];
    if (input && input.value === previous) input.value = todoCategoryNames[priority];
    const addInput = document.querySelector(`.add-row input[data-priority="${priority}"]`);
    if (addInput) addInput.setAttribute('aria-label', pomeLocaleRendererApp.t('copy.addATaskTo.efb0ec', { arg1: todoCategoryNames[priority] }));
  }
  for (const trigger of document.querySelectorAll('.todo-deadline-trigger')) {
    const deadline = trigger.dataset.deadline;
    const label = trigger.querySelector('span');
    if (label && deadline) label.textContent = pomeLocaleRendererApp.date(deadline, { day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
});
