const pomeLocaleRendererDomain = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function exposeNotchDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createNotchDomain() {
  const CATEGORY_RULES = [
    ['开发', /github|gitlab|gitee|stackoverflow|developer|docs\.|npmjs|vercel|cloudflare|code|openai|anthropic/i],
    ['工作', /feishu|larksuite|notion|slack|trello|asana|figma|miro|office|docs\.google/i],
    ['学习', /wikipedia|coursera|udemy|edx|medium|juejin|zhihu|yuque|book|learn/i],
    ['影音', /bilibili|youtube|youku|iqiyi|netflix|spotify|music|video/i],
    ['社交', /weibo|twitter|x\.com|facebook|instagram|reddit|discord|wechat/i],
    ['购物', /taobao|tmall|jd\.com|amazon|shop|mall/i],
  ];
  const NESTED_PUBLIC_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'com.cn', 'net.cn', 'org.cn', 'com.au', 'net.au',
    'co.jp', 'co.kr', 'co.nz', 'github.io', 'gitlab.io', 'vercel.app', 'pages.dev',
    'netlify.app', 'notion.site',
  ]);

  function isLocalHostname(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      return true;
    }
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }

  function normalizeHttpUrl(value) {
    const input = String(value || '').trim();
    if (!input || /[\u0000-\u001f\u007f]/u.test(input)) return null;
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || isLocalHostname(url.hostname)) return null;
      const host = url.hostname.replace(/\.$/, '');
      if ((!host.includes('.') && !host.includes(':')) || /[%\s]/u.test(host)) return null;
      url.username = '';
      url.password = '';
      return url.toString();
    } catch (error) {
      return null;
    }
  }

  function classifyLink(url, title) {
    const haystack = `${url || ''} ${title || ''}`;
    const matched = CATEGORY_RULES.find(([, pattern]) => pattern.test(haystack));
    return matched ? pomeLocaleRendererDomain.systemText(matched[0]) : pomeLocaleRendererDomain.t("copy.other.d2909f");
  }

  function addLinkToGroups(groups, link, category) {
    const source = Array.isArray(groups) ? groups : [];
    const groupName = String(category || '').trim() || pomeLocaleRendererDomain.t("copy.other.d2909f");
    const index = source.findIndex((group) => group && group.name === groupName);
    if (index >= 0) {
      return source.map((group, groupIndex) => groupIndex === index
        ? { ...group, links: [...(Array.isArray(group.links) ? group.links : []), link] }
        : group);
    }
    return [...source, {
      id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: groupName,
      collapsed: false,
      links: [link],
    }];
  }

  function linkHostname(value) {
    try {
      return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (error) {
      return '';
    }
  }

  function relatedHostnames(left, right) {
    const siteRoot = (hostname) => {
      const parts = String(hostname || '').split('.').filter(Boolean);
      if (parts.length < 2) return parts[0] || '';
      const suffix = parts.slice(-2).join('.');
      return NESTED_PUBLIC_SUFFIXES.has(suffix) && parts.length > 2
        ? parts.slice(-3).join('.')
        : suffix;
    };
    return Boolean(left && right && (
      left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
      || siteRoot(left) === siteRoot(right)
    ));
  }

  function preferredLinkGroupId(groups, url) {
    const hostname = linkHostname(url);
    if (!hostname) return '';
    const group = (Array.isArray(groups) ? groups : []).find((item) => (
      item && Array.isArray(item.links) && item.links.some((link) => (
        relatedHostnames(hostname, linkHostname(link && link.url))
      ))
    ));
    return group ? String(group.id || '') : '';
  }

  function cloneLinkGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map((group) => ({
      ...group,
      links: [...(Array.isArray(group.links) ? group.links : [])],
    }));
  }

  // 把链接放到目标分组的指定位置。targetIndex 为 null 时追加到末尾。
  // 组内调顺序和跨组搬运走的是同一条路径，区别只在 targetGroupId 是否等于原分组。
  // targetIndex 按「移动前」目标分组的下标来算，调用方直接用界面上看到的行序即可。
  function moveLinkToPosition(groups, linkId, targetGroupId, targetIndex = null) {
    const source = Array.isArray(groups) ? groups : [];
    const id = String(linkId || '');
    const targetId = String(targetGroupId || '');
    let sourceGroupId = '';
    source.some((group) => {
      const found = group && Array.isArray(group.links)
        ? group.links.find((link) => link && String(link.id) === id)
        : null;
      if (!found) return false;
      sourceGroupId = String(group.id || '');
      return true;
    });
    if (!sourceGroupId || !targetId
      || !source.some((group) => group && String(group.id) === targetId)) {
      return cloneLinkGroups(source);
    }

    const next = cloneLinkGroups(source);
    const from = next.find((group) => String(group.id) === sourceGroupId);
    const fromIndex = from.links.findIndex((link) => String(link && link.id) === id);
    const [movingLink] = from.links.splice(fromIndex, 1);
    const target = next.find((group) => String(group.id) === targetId);

    let insertAt = target.links.length;
    if (targetIndex !== null && Number.isFinite(Number(targetIndex))) {
      insertAt = Number(targetIndex);
      // 同组内先摘后插，落点在原位置之后时下标要减一，否则会多跳一格。
      if (sourceGroupId === targetId && insertAt > fromIndex) insertAt -= 1;
      insertAt = Math.max(0, Math.min(target.links.length, insertAt));
    }
    target.links.splice(insertAt, 0, movingLink);
    return next;
  }

  // 只负责「整条丢到目标分组末尾」，同组视为无操作（拖到折叠分组的标题上就是这个语义）。
  function moveLinkToGroup(groups, linkId, targetGroupId) {
    const source = Array.isArray(groups) ? groups : [];
    const id = String(linkId || '');
    const sourceGroup = source.find((group) => group && Array.isArray(group.links)
      && group.links.some((link) => link && String(link.id) === id));
    if (sourceGroup && String(sourceGroup.id) === String(targetGroupId || '')) {
      return cloneLinkGroups(source);
    }
    return moveLinkToPosition(groups, linkId, targetGroupId, null);
  }

  function renameGroup(groups, groupId, name) {
    const nextName = String(name || '').trim();
    return (Array.isArray(groups) ? groups : []).map((group) => (
      group && group.id === groupId && nextName ? { ...group, name: nextName } : group
    ));
  }

  function trimClipboardHistory(history, favorites = [], maxEntries = 100) {
    const limit = Math.max(1, Math.floor(Number(maxEntries) || 100));
    const favoriteIds = new Set(Array.isArray(favorites) ? favorites : []);
    const rows = (Array.isArray(history) ? history : []).filter(row => row && typeof row === 'object').sort((left, right) =>
      (Number(right.timestamp) || 0) - (Number(left.timestamp) || 0)
      || (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0));
    const kept = [], evicted = [];
    let ordinary = 0;
    for (const row of rows) {
      if (favoriteIds.has(row.id) || ordinary++ < limit) kept.push(row);
      else evicted.push(row);
    }
    return { history: kept, evicted };
  }

  function prependClipboardHistory(history, entry, maxEntries = 100, favorites = []) {
    return trimClipboardHistory([entry, ...(Array.isArray(history) ? history : [])], favorites, maxEntries);
  }

  function createCommand(text, id, createdAt) {
    const normalized = String(text || '').trim();
    if (!normalized) return null;
    return {
      id: String(id || `command-${Date.now().toString(36)}`),
      text: normalized,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    };
  }

  function createExclusiveAsyncTask(onPendingChange) {
    const notify = typeof onPendingChange === 'function' ? onPendingChange : () => {};
    let pending = null;
    return {
      run(task) {
        if (pending) return pending;
        if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'));
        let resolveWork;
        let rejectWork;
        const work = new Promise((resolve, reject) => {
          resolveWork = resolve;
          rejectWork = reject;
        });
        const tracked = work.finally(() => {
          if (pending !== tracked) return;
          pending = null;
          notify(false);
        });
        pending = tracked;
        notify(true);
        try {
          Promise.resolve(task()).then(resolveWork, rejectWork);
        } catch (error) {
          rejectWork(error);
        }
        return tracked;
      },
      isPending() {
        return pending !== null;
      },
    };
  }

  function createRecording(value) {
    if (!value || typeof value !== 'object') return null;
    const transcript = String(value.transcript || '').trim();
    const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    const fallbackTitle = new Date(createdAt).toLocaleString(pomeLocaleRendererDomain.getState().formatLocale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      id: String(value.id || `recording-${Date.now().toString(36)}`),
      createdAt,
      durationMs: Math.max(0, Math.round(Number(value.durationMs) || 0)),
      transcript,
      audioPath: typeof value.audioPath === 'string' ? value.audioPath : '',
      ...(value.audioOmitted !== undefined ? { audioOmitted: value.audioOmitted === true } : {}),
      ...(value.audioSyncReason ? { audioSyncReason: String(value.audioSyncReason) } : {}),
      mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'audio/webm',
      title: String(value.title || fallbackTitle).trim(),
      category: String(value.category || pomeLocaleRendererDomain.t("copy.uncategorized.54b89f")).replace(/\s+/g, ' ').trim().slice(0, 24),
    };
  }

  function removeRecordingState(recordings, recordingId, selection, selectedId) {
    const rows = Array.isArray(recordings) ? recordings : [];
    const id = String(recordingId || '');
    const index = rows.findIndex((recording) => recording && String(recording.id) === id);
    if (index < 0) {
      return {
        recordings: rows.slice(),
        selection: Array.isArray(selection) ? selection.slice() : [],
        selectedId: String(selectedId || ''),
      };
    }
    const nextRows = rows.filter((recording) => String(recording && recording.id) !== id);
    const currentSelectedId = String(selectedId || '');
    const nextSelectedId = currentSelectedId !== id && nextRows.some((recording) => String(recording.id) === currentSelectedId)
      ? currentSelectedId
      : String(nextRows[Math.min(index, nextRows.length - 1)]?.id || '');
    return {
      recordings: nextRows,
      selection: (Array.isArray(selection) ? selection : []).filter((selected) => String(selected) !== id),
      selectedId: nextSelectedId,
    };
  }

  function calculateRecordingDuration(value) {
    const startedAt = Number(value && value.startedAt) || 0;
    if (!startedAt) return 0;
    const pausedAt = Number(value && value.pausedAt) || 0;
    const now = Number(value && value.now) || Date.now();
    const end = value && value.status === 'paused' && pausedAt ? pausedAt : now;
    const pausedTotalMs = Math.max(0, Number(value && value.pausedTotalMs) || 0);
    return Math.max(0, Math.round(end - startedAt - pausedTotalMs));
  }

  function completionMatchesWindow(completion, windowInfo) {
    const project = String(completion && completion.project || '').trim().toLocaleLowerCase();
    const title = String(windowInfo && windowInfo.title || '').trim().toLocaleLowerCase();
    if (!project || !title) return false;
    return title.includes(project);
  }

  function deriveWindowDisplayName(item) {
    const appName = String(item && item.appName || '').replace(/\s+/g, ' ').trim() || pomeLocaleRendererDomain.t("copy.app.63c73c");
    const title = String(item && item.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return appName;

    const editorPattern = /(?:visual studio code|\bcode\b|cursor|vscodium|windsurf)/i;
    const titleLooksLikeEditor = /(?:—|-|\|)\s*(?:visual studio code|cursor|vscodium|windsurf)\s*$/i.test(title);
    const pieces = title
      .split(/\s+(?:—|–|\|)\s+/)
      .map((piece) => piece.trim())
      .filter(Boolean);

    if (editorPattern.test(appName) || titleLooksLikeEditor) {
      const editorPieces = pieces.filter((piece) => !/^(?:visual studio code|cursor|vscodium|windsurf)$/i.test(piece));
      if (!editorPieces.length) return appName;
      if (editorPieces.length === 1) return editorPieces[0].slice(0, 44);
      return editorPieces[editorPieces.length - 1].slice(0, 44);
    }

    const appKey = appName.toLocaleLowerCase();
    if (pieces.length > 1 && pieces[pieces.length - 1].toLocaleLowerCase() === appKey) {
      return pieces.slice(0, -1).join(' — ').slice(0, 44) || appName;
    }
    return title.toLocaleLowerCase() === appKey ? appName : title.slice(0, 44);
  }

  function numberWindowLabels(items) {
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    const totals = new Map();
    rows.forEach((item) => {
      const key = deriveWindowDisplayName(item).toLocaleLowerCase();
      if (key) totals.set(key, (totals.get(key) || 0) + 1);
    });
    const indexes = new Map();
    return rows.map((item) => {
      const label = deriveWindowDisplayName(item);
      const key = label.toLocaleLowerCase();
      const index = (indexes.get(key) || 0) + 1;
      indexes.set(key, index);
      return {
        ...item,
        displayName: (totals.get(key) || 0) > 1 ? `${label} · ${index}` : label,
      };
    });
  }

  function createTodo(text, deadline, id, createdAt) {
    const normalizedText = String(text || '').trim();
    const deadlineMs = Date.parse(String(deadline || '').trim());
    if (!normalizedText || !Number.isFinite(deadlineMs)) return null;
    return {
      id: String(id || `todo-${Date.now().toString(36)}`),
      text: normalizedText,
      done: false,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      deadline: new Date(deadlineMs).toISOString(),
      remindedAt: 0,
    };
  }

  function updateTodo(todo, text, deadline) {
    if (!todo || typeof todo !== 'object') return null;
    const normalized = createTodo(text, deadline, todo.id, todo.createdAt);
    if (!normalized) return null;
    return {
      ...todo,
      ...normalized,
      done: todo.done === true,
      remindedAt: Date.parse(String(todo.deadline || '')) === Date.parse(normalized.deadline)
        ? Math.max(0, Number(todo.remindedAt) || 0)
        : 0,
    };
  }

  function sortTodosForDisplay(items) {
    return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
      const doneDifference = Number(left && left.done === true) - Number(right && right.done === true);
      if (doneDifference) return doneDifference;
      const leftDeadline = Date.parse(String(left && left.deadline || ''));
      const rightDeadline = Date.parse(String(right && right.deadline || ''));
      const safeLeftDeadline = Number.isFinite(leftDeadline) ? leftDeadline : Number.POSITIVE_INFINITY;
      const safeRightDeadline = Number.isFinite(rightDeadline) ? rightDeadline : Number.POSITIVE_INFINITY;
      if (safeLeftDeadline !== safeRightDeadline) return safeLeftDeadline - safeRightDeadline;
      const leftCreatedAt = Number(left && left.createdAt);
      const rightCreatedAt = Number(right && right.createdAt);
      const safeLeftCreatedAt = Number.isFinite(leftCreatedAt) ? leftCreatedAt : Number.POSITIVE_INFINITY;
      const safeRightCreatedAt = Number.isFinite(rightCreatedAt) ? rightCreatedAt : Number.POSITIVE_INFINITY;
      if (safeLeftCreatedAt !== safeRightCreatedAt) return safeLeftCreatedAt - safeRightCreatedAt;
      return String(left && left.id || '').localeCompare(String(right && right.id || ''));
    });
  }

  function filterCredentials(items, query) {
    const rows = Array.isArray(items) ? items : [];
    const keyword = String(query || '').trim().toLocaleLowerCase();
    if (!keyword) return [...rows];
    return rows.filter((item) => (
      `${String(item && item.service || '')}\n${String(item && item.account || '')}`
        .toLocaleLowerCase()
        .includes(keyword)
    ));
  }

  function credentialRowAction(options = {}) {
    if (options.requestedAction === 'delete') {
      return { type: 'delete', label: pomeLocaleRendererDomain.t("copy.delete.2f9daa"), ariaLabel: pomeLocaleRendererDomain.t("copy.deleteCredential.311d71") };
    }
    if (options.copyField === 'account' || options.copyField === 'password') {
      return { type: 'copy', field: options.copyField };
    }
    if (options.rowBody && !options.shiftKey && !options.selected) return { type: 'edit' };
    return { type: 'select' };
  }

  function visiblePanelTabs(allTabs, features) {
    const tabs = Array.isArray(allTabs) ? allTabs : [];
    const state = features && typeof features === 'object' && !Array.isArray(features) ? features : {};
    const visible = tabs.filter((name) => (
      name !== 'settings' && (name === 'home' || state[name] !== false)
    ));
    if (tabs.includes('settings')) visible.push('settings');
    return visible;
  }

  function resolveDefaultPanelTab(preferredTab, visibleTabs) {
    const tabs = Array.isArray(visibleTabs) ? visibleTabs : [];
    if (typeof preferredTab === 'string' && tabs.includes(preferredTab)) return preferredTab;
    if (tabs.includes('home')) return 'home';
    return tabs[0] || 'home';
  }

  function normalizeNoteArchive(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const id = String(item.id || '').trim();
        const content = item.content == null ? '' : String(item.content);
        if (!id) return null;
        const title = Array.from(String(item.title || '').replace(/\s+/g, ' ').trim()).slice(0, item.conflict ? 220 : 80).join('');
        const titleSource = ['model', 'user'].includes(item.titleSource) ? item.titleSource : '';
        const createdAt = Math.max(0, Number(item.createdAt) || Date.now());
        const updatedAt = Math.max(createdAt, Number(item.updatedAt) || createdAt);
        return { id, title, titleSource, content, createdAt, updatedAt, ...(item.conflict && typeof item.conflict === "object" ? { conflict: item.conflict } : {}) };
      })
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function updateNoteInArchive(notes, noteId, content, updatedAt = Date.now()) {
    const id = String(noteId || '').trim();
    const timestamp = Math.max(0, Number(updatedAt) || Date.now());
    let found = false;
    const next = normalizeNoteArchive(notes).map((note) => {
      if (note.id !== id) return note;
      found = true;
      return {
        ...note,
        content: content == null ? '' : String(content),
        updatedAt: Math.max(note.createdAt, timestamp),
      };
    });
    return found ? normalizeNoteArchive(next) : next;
  }

  function filterNotes(notes, query) {
    const rows = Array.isArray(notes) ? notes : [];
    const keyword = String(query || '').trim().toLocaleLowerCase();
    if (!keyword) return rows.slice();
    return rows.filter((note) => (
      `${String(note && note.title || '')}\n${String(note && note.content || '')}`
        .toLocaleLowerCase()
        .includes(keyword)
    ));
  }

  function updateNoteTitle(notes, noteId, title, updatedAt = Date.now()) {
    const id = String(noteId || '').trim();
    const nextTitle = Array.from(String(title || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
    const timestamp = Math.max(0, Number(updatedAt) || Date.now());
    let found = false;
    const next = normalizeNoteArchive(notes).map((note) => {
      if (note.id !== id) return note;
      found = true;
      return {
        ...note,
        title: nextTitle,
        titleSource: 'user',
        updatedAt: Math.max(note.createdAt, timestamp),
      };
    });
    return found ? normalizeNoteArchive(next) : next;
  }

  function applyGeneratedNoteTitle(notes, noteId, title, expectedContent) {
    const id = String(noteId || '').trim();
    const nextTitle = Array.from(String(title || '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('');
    if (!id || !nextTitle) return normalizeNoteArchive(notes);
    return normalizeNoteArchive(notes).map((note) => {
      if (
        note.id !== id
        || note.titleSource === 'user'
        || note.title
        || note.content !== String(expectedContent == null ? '' : expectedContent)
      ) return note;
      return { ...note, title: nextTitle, titleSource: 'model' };
    });
  }

  function apiCredentialStatuses(config) {
    const value = config && typeof config === 'object' ? config : {};
    const status = (configured, needsReentry) => {
      if (configured) return { label: pomeLocaleRendererDomain.t("copy.savedSecurely.6e643d"), state: 'saved' };
      if (needsReentry) return { label: pomeLocaleRendererDomain.t("copy.enterAgain.029503"), state: 'warning' };
      return { label: pomeLocaleRendererDomain.t("copy.notConfigured.80a57e"), state: 'empty' };
    };
    return {
      transcription: status(Boolean(value.configured), Boolean(value.asrNeedsReentry)),
      llm: status(Boolean(value.llmConfigured), Boolean(value.llmNeedsReentry)),
    };
  }

  function settingsSummary(input = {}) {
    const appSettings = input.appSettings && typeof input.appSettings === 'object' ? input.appSettings : {};
    const workspace = input.workspace && typeof input.workspace === 'object' ? input.workspace : {};
    const statuses = apiCredentialStatuses(input.transcription);
    return {
      shortcut: String(appSettings.shortcut || 'Space'),
      defaultTab: String(appSettings.defaultTab || 'home'),
      autoLaunch: appSettings.autoLaunch === true,
      workspacePath: String(workspace.path || ''),
      workspaceLabel: workspace.portable ? pomeLocaleRendererDomain.t("copy.customFolder.f76b26") : pomeLocaleRendererDomain.t("copy.defaultFolder.dc3290"),
      transcription: statuses.transcription,
      llm: statuses.llm,
    };
  }

  function calendarDeadline(parts) {
    const year = Math.round(Number(parts && parts.year));
    const month = Math.round(Number(parts && parts.month));
    const day = Math.round(Number(parts && parts.day));
    const hour = Math.round(Number(parts && parts.hour));
    const minute = Math.round(Number(parts && parts.minute));
    if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 0 || month > 11
      || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const deadline = new Date(year, month, day, hour, minute, 0, 0);
    if (deadline.getFullYear() !== year || deadline.getMonth() !== month || deadline.getDate() !== day) return null;
    return deadline.toISOString();
  }

  function shiftCalendarMonth(value, offset) {
    const year = Math.round(Number(value && value.year));
    const month = Math.round(Number(value && value.month));
    const step = Math.round(Number(offset));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(step)) return null;
    const shifted = new Date(year, month + step, 1, 12, 0, 0, 0);
    return { year: shifted.getFullYear(), month: shifted.getMonth() };
  }

  function currentMonthDeadline(parts, now = new Date()) {
    const base = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(base.getTime())) return null;
    return calendarDeadline({
      ...parts,
      year: base.getFullYear(),
      month: base.getMonth(),
    });
  }

  function defaultTodoDeadline(now = new Date()) {
    const base = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (!Number.isFinite(base.getTime())) return null;
    const deadline = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 30, 0, 0);
    return deadline.toISOString();
  }

  function todoTimeBattery(todo, now = Date.now()) {
    if (!todo || todo.done === true) return null;
    const createdAt = Number(todo.createdAt);
    const deadline = Date.parse(String(todo.deadline || ''));
    const current = Number(now);
    const total = deadline - createdAt;
    if (!Number.isFinite(current)) return null;
    if (!Number.isFinite(deadline) || !Number.isFinite(createdAt) || total <= 0) {
      return { percent: 0, tone: 'red', overdue: false, label: pomeLocaleRendererDomain.t("copy.setAValidDeadline.0cf240") };
    }
    // 逾期必须与「剩余 0%」分开：后者只是取整落到 0，前者已经欠账。
    // 逾期项的电量条改为整条填满 + 白色感叹号，不能再显示成一条空槽。
    const overdue = current >= deadline;
    const percent = Math.round(Math.max(0, Math.min(1, (deadline - current) / total)) * 100);
    const tone = percent >= 80 ? 'green' : percent >= 50 ? 'yellow' : percent > 30 ? 'orange' : 'red';
    return {
      percent,
      tone,
      overdue,
      label: overdue ? pomeLocaleRendererDomain.t("copy.overdue.13c68d") : pomeLocaleRendererDomain.t("copy.remaining.c83bf4", { arg1: (percent) }),
    };
  }

  function updateRangeSelection(ids, selectedIds, clickedId, anchorId, shiftKey, toggleSelected = false) {
    const ordered = Array.isArray(ids) ? ids.map(String) : [];
    const clicked = String(clickedId || '');
    const anchor = String(anchorId || '');
    if (!clicked || !ordered.includes(clicked)) {
      return { selected: [...new Set((selectedIds || []).map(String))], anchor: anchor || null };
    }
    const existing = new Set((selectedIds || []).map(String));
    if (!shiftKey || !anchor || !ordered.includes(anchor)) {
      if (toggleSelected && existing.size === 1 && existing.has(clicked)) {
        return { selected: [], anchor: null };
      }
      return { selected: [clicked], anchor: clicked };
    }
    const start = ordered.indexOf(anchor);
    const end = ordered.indexOf(clicked);
    const range = ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
    range.forEach((id) => existing.add(id));
    return { selected: ordered.filter((id) => existing.has(id)), anchor };
  }

  function normalizeHomeLayout(layout, defaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const keys = Object.keys(fallback);
    if (!layout || typeof layout !== 'object') return fallback;
    const slots = keys.map((key) => layout[key]);
    const validSlots = new Set(Object.values(fallback));
    if (
      slots.length !== validSlots.size ||
      new Set(slots).size !== validSlots.size ||
      slots.some((slot) => !validSlots.has(slot))
    ) {
      return fallback;
    }
    return Object.fromEntries(keys.map((key) => [key, layout[key]]));
  }

  function swapHomeLayoutSlots(layout, sourceId, targetId) {
    if (!layout || typeof layout !== 'object' || sourceId === targetId) return { ...(layout || {}) };
    if (!Object.prototype.hasOwnProperty.call(layout, sourceId) || !Object.prototype.hasOwnProperty.call(layout, targetId)) {
      return { ...layout };
    }
    return {
      ...layout,
      [sourceId]: layout[targetId],
      [targetId]: layout[sourceId],
    };
  }

  function normalizeTodoCategoryNames(value, defaults) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(fallback).map(([key, defaultName]) => {
      const candidate = String(source[key] || '').replace(/\s+/g, ' ').trim();
      return [key, candidate ? candidate.slice(0, 24) : defaultName];
    }));
  }

  function normalizeHomeWidgetSizes(value, defaults, preferredId, capacity = Infinity) {
    const fallback = defaults && typeof defaults === 'object' ? { ...defaults } : {};
    const allowed = new Set(['mini', 'small', 'medium', 'large']);
    const source = value && typeof value === 'object' ? value : {};
    if (Object.keys(source).some((key) => key in fallback && !allowed.has(source[key]))) {
      return fallback;
    }
    const sizes = Object.fromEntries(Object.entries(fallback).map(([key, defaultSize]) => (
      [key, allowed.has(source[key]) ? source[key] : defaultSize]
    )));
    const area = { mini: 2, small: 4, medium: 8, large: 16 };
    const totalArea = () => Object.values(sizes).reduce((total, size) => total + area[size], 0);
    const siblings = Object.keys(sizes).filter((key) => key !== preferredId);

    while (totalArea() > capacity) {
      const excess = totalArea() - capacity;
      const candidate = siblings
        .map((key) => ({ key, reduction: sizes[key] === 'large' ? 8 : sizes[key] === 'medium' ? 4 : sizes[key] === 'small' ? 2 : 0 }))
        .filter((item) => item.reduction > 0 && item.reduction <= excess)
        .sort((a, b) => b.reduction - a.reduction)[0];
      if (!candidate) break;
      sizes[candidate.key] = sizes[candidate.key] === 'large' ? 'medium' : sizes[candidate.key] === 'medium' ? 'small' : 'mini';
    }

    while (Number.isFinite(capacity) && totalArea() < capacity) {
      const remaining = capacity - totalArea();
      const candidate = siblings
        .map((key) => ({ key, increase: sizes[key] === 'mini' ? 2 : sizes[key] === 'small' ? 4 : sizes[key] === 'medium' ? 8 : 0 }))
        .filter((item) => item.increase > 0 && item.increase <= remaining)
        .sort((a, b) => b.increase - a.increase)[0];
      if (!candidate) break;
      sizes[candidate.key] = sizes[candidate.key] === 'mini' ? 'small' : sizes[candidate.key] === 'small' ? 'medium' : 'large';
    }
    return sizes;
  }

  function packHomeWidgetLayout(order, sizes, columns = 12, rows = 4, requireFull = true, options = {}) {
    const ids = Array.isArray(order) ? order.filter((id) => Object.prototype.hasOwnProperty.call(sizes || {}, id)) : [];
    if (!ids.length || columns < 1 || rows < 1) return null;
    const dimensions = {
      mini: { width: 2, height: 1 },
      small: { width: 2, height: 2 },
      medium: { width: 4, height: 2 },
      large: { width: 4, height: 4 },
    };
    const occupied = Array.from({ length: rows }, () => Array(columns).fill(false));
    const placements = {};
    const fixed = new Set(options.fixedIds || []);
    const preferred = options.preferredPlacements || {};
    const footprints = Object.fromEntries(ids.map((id) => {
      const { width, height } = options.footprints?.[id] || dimensions[sizes[id]] || dimensions.small;
      return [id, { width, height }];
    }));
    if (ids.some((id) => ![footprints[id].width, footprints[id].height].every(Number.isInteger)
      || footprints[id].width < 1 || footprints[id].height < 1
      || footprints[id].width > columns || footprints[id].height > rows)) return null;
    const area = ids.reduce((sum, id) => sum + footprints[id].width * footprints[id].height, 0);
    if (area > columns * rows || requireFull && area !== columns * rows) return null;
    const failed = new Set();

    function fits(column, row, width, height) {
      if (column + width > columns || row + height > rows) return false;
      for (let y = row; y < row + height; y += 1) {
        for (let x = column; x < column + width; x += 1) {
          if (occupied[y][x]) return false;
        }
      }
      return true;
    }

    function mark(column, row, width, height, value) {
      for (let y = row; y < row + height; y += 1) {
        for (let x = column; x < column + width; x += 1) occupied[y][x] = value;
      }
    }

    // In a full grid, every odd free run needs an odd-sized remaining rectangle.
    // Prune impossible anchored swaps before exploring many equivalent packings.
    function parityFits(index) {
      if (!requireFull) return true;
      const remaining = ids.slice(index).map((id) => footprints[id]);
      const oddWidths = remaining.reduce((sum, item) => sum + (item.width % 2 ? item.height : 0), 0);
      const oddHeights = remaining.reduce((sum, item) => sum + (item.height % 2 ? item.width : 0), 0);
      const oddRuns = (lines) => lines.reduce((sum, line) => {
        let run = 0;
        for (const cell of [...line, true]) {
          if (!cell) run += 1;
          else { sum += run % 2; run = 0; }
        }
        return sum;
      }, 0);
      return oddRuns(occupied) <= oddWidths
        && oddRuns(Array.from({ length: columns }, (_, column) => occupied.map((line) => line[column]))) <= oddHeights;
    }

    function place(index) {
      if (index >= ids.length) {
        return !requireFull || occupied.every((row) => row.every(Boolean));
      }
      if (!parityFits(index)) return false;
      const id = ids[index];
      const dimension = footprints[id];
      const key = `${index}:${occupied.map((line) => line.map(Number).join('')).join('/')}`;
      if (failed.has(key)) return false;
      const candidates = [];
      if (preferred[id]) candidates.push({ column: preferred[id].column, row: preferred[id].row });
      for (let row = 0; row <= rows - dimension.height; row += 1) {
        for (let column = 0; column <= columns - dimension.width; column += 1) {
          if (!fixed.has(id) && (column !== preferred[id]?.column || row !== preferred[id]?.row)) candidates.push({ column, row });
        }
      }
      // Try the requested origin first, then move displaced cards forward before wrapping.
      if (preferred[id] && !fixed.has(id)) {
        const origin = preferred[id].row * columns + preferred[id].column;
        const rest = candidates.splice(1);
        candidates.push(...rest.filter((item) => item.row * columns + item.column >= origin),
          ...rest.filter((item) => item.row * columns + item.column < origin));
      }
      for (const { column, row } of candidates) {
        if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || !fits(column, row, dimension.width, dimension.height)) continue;
        mark(column, row, dimension.width, dimension.height, true);
        placements[id] = { column, row, ...dimension };
        if (place(index + 1)) return true;
        delete placements[id];
        mark(column, row, dimension.width, dimension.height, false);
      }
      failed.add(key);
      return false;
    }

    return place(0) ? placements : null;
  }

  function swapHomeWidgetPlacements(layout, sourceId, targetId, { order = [], columns = 12, rows = 4 } = {}) {
    const original = layout?.placements;
    const ids = Object.keys(original || {});
    if (sourceId === targetId || !original?.[sourceId] || !original?.[targetId]
      || !validateHomeWidgetLayout({ placements: original, allowGaps: true }, ids, columns, rows)) return null;
    const area = ids.reduce((sum, id) => sum + original[id].width * original[id].height, 0);
    if (area > columns * rows) return null;
    const next = Object.fromEntries(ids.map((id) => [id, { ...original[id] }]));
    for (const [id, other] of [[sourceId, targetId], [targetId, sourceId]]) {
      next[id].column = Math.min(original[other].column, columns - original[id].width);
      next[id].row = Math.min(original[other].row, rows - original[id].height);
    }
    let placements = next;
    if (!validateHomeWidgetLayout({ placements, allowGaps: true }, ids, columns, rows)) {
      const packingOrder = [...new Set([sourceId, targetId, ...order, ...ids])].filter((id) => ids.includes(id));
      const sizes = Object.fromEntries(ids.map((id) => [id, sizeNameFromPlacement(original[id]) || 'medium']));
      const options = { preferredPlacements: next, footprints: original, fixedIds: [sourceId, targetId] };
      placements = packHomeWidgetLayout(packingOrder, sizes, columns, rows, area === columns * rows, options)
        || packHomeWidgetLayout(packingOrder, sizes, columns, rows, area === columns * rows, { ...options, fixedIds: [sourceId] });
      if (!placements) return null;
    }
    // Gap filling may grow other cards, but the exchanged pair is always frozen.
    const filled = fillHomeLayoutGaps(placements, { columns, rows, frozenIds: [sourceId, targetId] });
    const result = {
      ...layout, allowGaps: filled.gapCount > 0, placements: filled.placements,
      variants: Object.fromEntries(ids.map((id) => [id, layoutVariantForPlacement(filled.placements[id])])),
    };
    return validateHomeWidgetLayout(result, ids, columns, rows) ? result : null;
  }

  const HOME_GAPLESS_TEMPLATES = {
    1: [{ column: 0, row: 0, width: 12, height: 4 }],
    2: [
      { column: 0, row: 0, width: 6, height: 4 },
      { column: 6, row: 0, width: 6, height: 4 },
    ],
    3: [
      { column: 0, row: 0, width: 4, height: 4 },
      { column: 4, row: 0, width: 4, height: 4 },
      { column: 8, row: 0, width: 4, height: 4 },
    ],
    4: [
      { column: 0, row: 0, width: 6, height: 2 },
      { column: 6, row: 0, width: 6, height: 2 },
      { column: 0, row: 2, width: 6, height: 2 },
      { column: 6, row: 2, width: 6, height: 2 },
    ],
    5: [
      { column: 0, row: 0, width: 4, height: 4 },
      { column: 4, row: 0, width: 4, height: 2 },
      { column: 8, row: 0, width: 4, height: 2 },
      { column: 4, row: 2, width: 4, height: 2 },
      { column: 8, row: 2, width: 4, height: 2 },
    ],
    6: [
      { column: 0, row: 0, width: 4, height: 2 },
      { column: 4, row: 0, width: 4, height: 2 },
      { column: 8, row: 0, width: 4, height: 2 },
      { column: 0, row: 2, width: 4, height: 2 },
      { column: 4, row: 2, width: 4, height: 2 },
      { column: 8, row: 2, width: 4, height: 2 },
    ],
  };

  function normalizeHiddenHomeModules(value, moduleIds) {
    const ids = Array.isArray(moduleIds)
      ? [...new Set(moduleIds.map((id) => String(id)))]
      : [];
    if (!ids.length || !Array.isArray(value)) return [];
    const requested = new Set(value.map((id) => String(id)));
    const hiddenIds = ids.filter((id) => requested.has(id));
    return hiddenIds.length === ids.length ? [] : hiddenIds;
  }

  function updateHomeModuleVisibility(hiddenIds, moduleIds, moduleId, visible) {
    const ids = Array.isArray(moduleIds)
      ? [...new Set(moduleIds.map((id) => String(id)))]
      : [];
    const current = normalizeHiddenHomeModules(hiddenIds, ids);
    const id = String(moduleId || '');
    if (!ids.includes(id) || typeof visible !== 'boolean') {
      return { ok: false, error: 'invalid_module', hiddenIds: current };
    }
    const next = new Set(current);
    if (visible) next.delete(id);
    else next.add(id);
    if (next.size >= ids.length) {
      return { ok: false, error: 'at_least_one_required', hiddenIds: current };
    }
    return { ok: true, hiddenIds: ids.filter((candidate) => next.has(candidate)) };
  }

  function layoutVariantForPlacement(placement) {
    const width = Number(placement?.width) || 0;
    const height = Number(placement?.height) || 0;
    if (width <= 2 && height <= 1) return 'mini';
    if (width <= 2 && height <= 2) return 'compact';
    if (height <= 2) return 'wide';
    if (width >= 6 && height >= 4) return 'full';
    return 'tall';
  }

  const HOME_SIZE_FOOTPRINTS = [
    { name: 'mini', width: 2, height: 1 },
    { name: 'small', width: 2, height: 2 },
    { name: 'medium', width: 4, height: 2 },
    { name: 'large', width: 4, height: 4 },
  ];

  function sizeNameFromPlacement(placement) {
    const width = Number(placement?.width);
    const height = Number(placement?.height);
    const match = HOME_SIZE_FOOTPRINTS.find((item) => item.width === width && item.height === height);
    return match ? match.name : null;
  }

  function compareGapFillScores(left, right) {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  }

  // Grow modules into empty cells without moving them. Prefer modules that were just
  // shrunk, then the neighbor above / to the left of a hole. Footprints stay in the
  // four allowed sizes so size controls and packing stay consistent.
  function fillHomeLayoutGaps(placements, options = {}) {
    const columns = Number.isInteger(options.columns) ? options.columns : 12;
    const rows = Number.isInteger(options.rows) ? options.rows : 4;
    const preferredIds = Array.isArray(options.preferredIds)
      ? options.preferredIds.map(String)
      : [];
    const frozenIds = new Set(
      Array.isArray(options.frozenIds) ? options.frozenIds.map(String) : []
    );
    if (!placements || typeof placements !== 'object' || columns < 1 || rows < 1) {
      return { placements: null, sizes: {}, changed: false, gapCount: 0 };
    }
    const next = {};
    Object.entries(placements).forEach(([id, item]) => {
      const column = Number(item?.column);
      const row = Number(item?.row);
      const width = Number(item?.width);
      const height = Number(item?.height);
      if (![column, row, width, height].every(Number.isInteger)) return;
      if (width < 1 || height < 1) return;
      if (column < 0 || row < 0 || column + width > columns || row + height > rows) return;
      next[id] = { column, row, width, height };
    });
    if (!Object.keys(next).length) {
      return { placements: null, sizes: {}, changed: false, gapCount: 0 };
    }

    function buildGrid() {
      const grid = Array.from({ length: rows }, () => Array(columns).fill(null));
      Object.entries(next).forEach(([id, item]) => {
        for (let y = item.row; y < item.row + item.height; y += 1) {
          for (let x = item.column; x < item.column + item.width; x += 1) {
            grid[y][x] = id;
          }
        }
      });
      return grid;
    }

    function emptyCells(grid) {
      const cells = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (grid[row][column] == null) cells.push({ column, row });
        }
      }
      return cells;
    }

    function coversCurrent(id, column, row, width, height) {
      const current = next[id];
      return column <= current.column
        && row <= current.row
        && column + width >= current.column + current.width
        && row + height >= current.row + current.height;
    }

    function canGrow(grid, id, column, row, width, height) {
      if (column < 0 || row < 0 || column + width > columns || row + height > rows) return false;
      if (!coversCurrent(id, column, row, width, height)) return false;
      let gainsEmpty = false;
      for (let y = row; y < row + height; y += 1) {
        for (let x = column; x < column + width; x += 1) {
          const owner = grid[y][x];
          if (owner != null && owner !== id) return false;
          if (owner == null) gainsEmpty = true;
        }
      }
      return gainsEmpty;
    }

    function neighborFlags(id, holes) {
      const item = next[id];
      let above = false;
      let left = false;
      holes.forEach((hole) => {
        if (item.row + item.height === hole.row
          && hole.column >= item.column
          && hole.column < item.column + item.width) {
          above = true;
        }
        if (item.column + item.width === hole.column
          && hole.row >= item.row
          && hole.row < item.row + item.height) {
          left = true;
        }
      });
      return { above, left };
    }

    let changed = false;
    for (let step = 0; step < columns * rows; step += 1) {
      const grid = buildGrid();
      const holes = emptyCells(grid);
      if (!holes.length) break;
      let best = null;
      let bestScore = null;
      Object.keys(next).forEach((id) => {
        if (frozenIds.has(id)) return;
        const current = next[id];
        const currentArea = current.width * current.height;
        const preferredIndex = preferredIds.indexOf(id);
        const flags = neighborFlags(id, holes);
        HOME_SIZE_FOOTPRINTS.forEach((size) => {
          if (size.width * size.height <= currentArea) return;
          const minColumn = current.column + current.width - size.width;
          const maxColumn = current.column;
          const minRow = current.row + current.height - size.height;
          const maxRow = current.row;
          for (let column = minColumn; column <= maxColumn; column += 1) {
            for (let row = minRow; row <= maxRow; row += 1) {
              if (!canGrow(grid, id, column, row, size.width, size.height)) continue;
              const score = [
                preferredIndex === -1 ? 1 : 0,
                preferredIndex === -1 ? 99 : preferredIndex,
                flags.above ? 0 : 1,
                flags.left ? 0 : 1,
                current.row,
                current.column,
                -(size.width * size.height),
                row,
                column,
              ];
              if (!bestScore || compareGapFillScores(score, bestScore) < 0) {
                best = {
                  id,
                  column,
                  row,
                  width: size.width,
                  height: size.height,
                  size: size.name,
                };
                bestScore = score;
              }
            }
          }
        });
      });
      if (!best) break;
      next[best.id] = {
        column: best.column,
        row: best.row,
        width: best.width,
        height: best.height,
      };
      changed = true;
    }

    const sizes = {};
    Object.entries(next).forEach(([id, item]) => {
      sizes[id] = sizeNameFromPlacement(item) || 'medium';
    });
    return {
      placements: next,
      sizes,
      changed,
      gapCount: emptyCells(buildGrid()).length,
    };
  }

  function validateHomeWidgetLayout(layout, visibleIds, columns = 12, rows = 4) {
    if (!layout || !layout.placements || columns < 1 || rows < 1) return false;
    const expected = [...new Set(Array.isArray(visibleIds) ? visibleIds.map(String) : [])].sort();
    const entries = Object.entries(layout.placements);
    if (!expected.length || entries.length !== expected.length) return false;
    if (JSON.stringify(entries.map(([id]) => id).sort()) !== JSON.stringify(expected)) return false;
    const cells = Array(columns * rows).fill(0);
    for (const [, item] of entries) {
      const values = [item?.column, item?.row, item?.width, item?.height];
      if (!values.every(Number.isInteger) || item.width < 1 || item.height < 1) return false;
      if (item.column < 0 || item.row < 0
        || item.column + item.width > columns || item.row + item.height > rows) return false;
      for (let row = item.row; row < item.row + item.height; row += 1) {
        for (let column = item.column; column < item.column + item.width; column += 1) {
          const index = row * columns + column;
          cells[index] += 1;
          if (cells[index] > 1) return false;
        }
      }
    }
    return layout.allowGaps === true
      ? cells.every((count) => count <= 1)
      : cells.every((count) => count === 1);
  }

  const HOME_WIDGET_DIMENSIONS = {
    mini: { width: 2, height: 1 },
    small: { width: 2, height: 2 },
    medium: { width: 4, height: 2 },
    large: { width: 4, height: 4 },
  };

  function introduceHomeModule(input) {
    const source = input && typeof input === 'object' ? input : {};
    const moduleId = String(source.moduleId || '');
    const registry = Array.isArray(source.registry) ? source.registry.map(String) : [];
    const defaultSize = ['mini', 'small', 'medium', 'large'].includes(source.defaultSize) ? source.defaultSize : 'medium';
    const columns = Number.isInteger(source.columns) ? source.columns : 12;
    const rows = Number.isInteger(source.rows) ? source.rows : 4;
    const area = { mini: 2, small: 4, medium: 8, large: 16 };
    const order = [];
    (Array.isArray(source.order) ? source.order : []).forEach((id) => {
      const key = String(id);
      if (registry.includes(key) && !order.includes(key)) order.push(key);
    });
    registry.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    const sizes = {};
    registry.forEach((id) => {
      const current = source.sizes && source.sizes[id];
      sizes[id] = ['mini', 'small', 'medium', 'large'].includes(current)
        ? current
        : id === moduleId
          ? defaultSize
          : (source.defaults && source.defaults[id]) || 'medium';
    });
    const hiddenIds = Array.isArray(source.hiddenIds)
      ? source.hiddenIds.map(String).filter((id) => registry.includes(id))
      : [];
    const placements = source.placements && typeof source.placements === 'object'
      ? Object.fromEntries(Object.entries(source.placements).map(([id, item]) => [id, { ...item }]))
      : null;

    function hideIntroduced() {
      if (moduleId && !hiddenIds.includes(moduleId)) hiddenIds.push(moduleId);
    }

    if (placements && moduleId && !hiddenIds.includes(moduleId) && !placements[moduleId]) {
      const dimension = HOME_WIDGET_DIMENSIONS[sizes[moduleId]] || HOME_WIDGET_DIMENSIONS.medium;
      const occupied = Array.from({ length: rows }, () => Array(columns).fill(false));
      let lastCell = -1;
      Object.values(placements).forEach((item) => {
        if (!item) return;
        const column = Number(item.column);
        const row = Number(item.row);
        const width = Number(item.width);
        const height = Number(item.height);
        if (![column, row, width, height].every(Number.isInteger)) return;
        for (let y = row; y < row + height && y < rows; y += 1) {
          for (let x = column; x < column + width && x < columns; x += 1) {
            if (y < 0 || x < 0) continue;
            occupied[y][x] = true;
            lastCell = Math.max(lastCell, y * columns + x);
          }
        }
      });
      let slot = null;
      for (let row = 0; row <= rows - dimension.height; row += 1) {
        for (let column = 0; column <= columns - dimension.width; column += 1) {
          if (row * columns + column <= lastCell) continue;
          let fits = true;
          for (let y = row; y < row + dimension.height && fits; y += 1) {
            for (let x = column; x < column + dimension.width; x += 1) {
              if (occupied[y][x]) fits = false;
            }
          }
          if (fits) slot = { column, row, width: dimension.width, height: dimension.height };
        }
      }
      if (slot) placements[moduleId] = slot;
      else hideIntroduced();
    } else if (!placements && moduleId && !hiddenIds.includes(moduleId)) {
      const visible = order.filter((id) => !hiddenIds.includes(id));
      const total = visible.reduce((sum, id) => sum + (area[sizes[id]] || 0), 0);
      if (total > columns * rows) hideIntroduced();
    }

    return {
      order,
      sizes,
      placements,
      hiddenIds: registry.filter((id) => hiddenIds.includes(id)),
    };
  }

  function isLegacyDefaultHomeLayout({ order, sizes, placements, hiddenIds = [] }) {
    const oldOrder = ['music','pomodoro','cursor','windows','recorder','mirror','note','commands','sun'];
    const oldSizes = {music:'small',pomodoro:'mini',cursor:'small',windows:'large',recorder:'small',mirror:'medium',note:'medium',commands:'mini',sun:'medium'};
    if (!sizes || Object.hasOwn(sizes,'inbox') || oldOrder.some(id => sizes[id] !== oldSizes[id])) return false;
    if (order && JSON.stringify(order) !== JSON.stringify(oldOrder)) return false;
    if (hiddenIds.some(id => id !== 'sun')) return false;
    const baseline = resolveHomeWidgetLayout(oldOrder,oldSizes,['sun']);
    if (placements && (Object.keys(placements).length !== Object.keys(baseline.placements).length
      || Object.entries(baseline.placements).some(([id,p]) => !placements[id] || ['column','row','width','height'].some(key => placements[id][key] !== p[key])))) return false;
    return true;
  }

  // The old Windows default saved the Mac slots minus unavailable modules,
  // leaving holes and automatically hiding sun. Match the entire known baseline;
  // a user's different order, size, visibility or placement must stay untouched.
  function isLegacyWindowsDefaultHomeLayout({ order, defaultOrder, sizes, defaults, placements, hiddenIds = [], unavailableIds = [], registry }) {
    if (!placements || !defaults || !Array.isArray(defaultOrder) || !Array.isArray(registry)) return false;
    if (!unavailableIds.includes('music') || !unavailableIds.includes('windows')) return false;
    if (hiddenIds.length !== 1 || hiddenIds[0] !== 'sun') return false;
    if (JSON.stringify(order) !== JSON.stringify(defaultOrder)) return false;
    if (registry.some(id => sizes?.[id] !== defaults[id])) return false;
    const baseline = normalizeHomeInboxLayout({ order: defaultOrder, sizes: defaults, registry, hiddenIds: [...unavailableIds, 'sun'] }).placements;
    return baseline && Object.keys(placements).length === Object.keys(baseline).length
      && Object.entries(baseline).every(([id, p]) => placements[id]
        && ['column', 'row', 'width', 'height'].every(key => placements[id][key] === p[key]));
  }

  // Insert a new inbox without rewriting user-selected footprints. Try its
  // preferred slot, any free/repacked slot, then only shrink the new module.
  function normalizeHomeInboxLayout({ order, sizes, placements, hiddenIds = [], registry = [], preservePositions = false, preferredInboxPlacement = null }) {
    const nextSizes = { ...sizes }, hidden = new Set(hiddenIds);
    const visible = order.filter(id => registry.includes(id) && !hidden.has(id));
    const existing = placements && Object.fromEntries(Object.entries(placements).filter(([id]) => visible.includes(id)));
    if (hidden.has('inbox') || existing?.inbox) return { sizes: nextSizes, placements: existing || placements, hiddenIds: [...hidden] };
    const defaults = { music: {column:0,row:0}, pomodoro: {column:2,row:0}, commands: {column:2,row:1},
      cursor: {column:4,row:0}, recorder: {column:6,row:0}, inbox: {column:8,row:0},
      mirror: {column:0,row:2}, note: {column:4,row:2}, windows: {column:8,row:2} };
    const options = existing ? { preferredPlacements: { ...existing, inbox: preferredInboxPlacement || defaults.inbox }, fixedIds: Object.keys(existing),
      footprints: Object.fromEntries(Object.entries(existing).map(([id, p]) => [id, {width:p.width,height:p.height}])) } : {preferredPlacements: defaults};
    const ranked = HOME_SIZE_FOOTPRINTS.filter(f => f.width * f.height <= (HOME_WIDGET_DIMENSIONS[nextSizes.inbox || 'medium'].width * HOME_WIDGET_DIMENSIONS[nextSizes.inbox || 'medium'].height)).reverse();
    for (const footprint of ranked) {
      nextSizes.inbox = footprint.name;
      let packed = packHomeWidgetLayout(visible, nextSizes, 12, 4, false, options);
      if (!packed && existing && !preservePositions) packed = packHomeWidgetLayout(visible, nextSizes, 12, 4, false, { ...options, fixedIds: [] });
      if (packed && validateHomeWidgetLayout({placements:packed,allowGaps:true}, visible)) return {sizes:nextSizes,placements:packed,hiddenIds:[...hidden]};
    }
    // A completely full customized grid has no capacity for even a mini tile.
    // Keep those choices, and retain a working badge/settings route.
    nextSizes.inbox = sizes.inbox || 'medium'; hidden.add('inbox');
    return { sizes: nextSizes, placements: existing || placements, hiddenIds: [...hidden] };
  }

  function resolveHomeWidgetLayout(order, sizes, hiddenIds, columns = 12, rows = 4) {
    if (columns !== 12 || rows !== 4 || !sizes || typeof sizes !== 'object') return null;
    const ids = Array.isArray(order)
      ? [...new Set(order.map(String))].filter((id) => Object.prototype.hasOwnProperty.call(sizes, id))
      : [];
    if (!ids.length) return null;
    const hidden = new Set(normalizeHiddenHomeModules(hiddenIds, ids));
    const visibleOrder = ids.filter((id) => !hidden.has(id));
    if (!visibleOrder.length) return null;

    // User-authored layouts preserve each card's selected footprint. Empty cells are
    // valid when the chosen sizes cannot cover the grid; when they can, pack gapless.
    const area = { mini: 2, small: 4, medium: 8, large: 16 };
    const visibleSizes = Object.fromEntries(visibleOrder.map((id) => [id, sizes[id] || 'medium']));
    const totalArea = visibleOrder.reduce((sum, id) => sum + (area[visibleSizes[id]] || 0), 0);
    const requireFull = totalArea >= columns * rows;
    const placements = packHomeWidgetLayout(
      visibleOrder,
      visibleSizes,
      columns,
      rows,
      requireFull
    );
    if (!placements) return null;
    const result = {
      allowGaps: !requireFull,
      visibleOrder: [...visibleOrder],
      placements: Object.fromEntries(Object.entries(placements).map(([id, item]) => [id, { ...item }])),
      variants: Object.fromEntries(Object.entries(placements).map(([id, item]) => (
        [id, layoutVariantForPlacement(item)]
      ))),
    };
    return validateHomeWidgetLayout(result, visibleOrder, columns, rows) ? result : null;
  }

  function calculateAudioLevel(samples) {
    const values = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    if (!values.length) return 0;
    let sumSquares = 0;
    for (const sample of values) {
      const clamped = Math.max(-1, Math.min(1, Number(sample) || 0));
      sumSquares += clamped * clamped;
    }
    return Math.round(Math.sqrt(sumSquares / values.length) * 1000) / 1000;
  }

  function resampleFloat32ToPcm16(samples, inputRate, outputRate = 16000) {
    const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    const fromRate = Math.max(1, Number(inputRate) || outputRate);
    const toRate = Math.max(1, Number(outputRate) || 16000);
    if (!source.length) return new Int16Array();
    const ratio = fromRate / toRate;
    const outputLength = Math.max(1, Math.round(source.length / ratio));
    const output = new Int16Array(outputLength);
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.max(start + 1, Math.min(source.length, Math.floor((outputIndex + 1) * ratio)));
      let sum = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex++) sum += source[sourceIndex];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      output[outputIndex] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
    return output;
  }

  function shouldTogglePanelForSpace(event) {
    if (!event || (event.key !== ' ' && event.key !== 'Spacebar' && event.code !== 'Space')) return false;
    return !event.repeat
      && !event.isComposing
      && !event.editable
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey;
  }

  function shouldHandleMirrorPinch(event) {
    return Boolean(event && event.live === true && event.ctrlKey === true);
  }

  function adjustMirrorZoom(currentZoom, deltaY, minZoom = 1, maxZoom = 2.6) {
    const min = Number.isFinite(minZoom) ? minZoom : 1;
    const max = Number.isFinite(maxZoom) && maxZoom >= min ? maxZoom : 2.6;
    const current = Number.isFinite(currentZoom) ? currentZoom : min;
    const delta = Number.isFinite(deltaY) ? deltaY : 0;
    const next = Math.max(min, Math.min(max, current - delta * 0.002));
    return Math.round(next * 100) / 100;
  }

  return {
    normalizeHttpUrl,
    classifyLink,
    addLinkToGroups,
    preferredLinkGroupId,
    moveLinkToGroup,
    moveLinkToPosition,
    renameGroup,
    prependClipboardHistory,
    trimClipboardHistory,
    createExclusiveAsyncTask,
    createCommand,
    createRecording,
    removeRecordingState,
    calculateRecordingDuration,
    completionMatchesWindow,
    deriveWindowDisplayName,
    numberWindowLabels,
    createTodo,
    updateTodo,
    sortTodosForDisplay,
    filterCredentials,
    credentialRowAction,
    visiblePanelTabs,
    resolveDefaultPanelTab,
    normalizeNoteArchive,
    filterNotes,
    updateNoteInArchive,
    updateNoteTitle,
    applyGeneratedNoteTitle,
    apiCredentialStatuses,
    settingsSummary,
    currentMonthDeadline,
    calendarDeadline,
    shiftCalendarMonth,
    defaultTodoDeadline,
    todoTimeBattery,
    updateRangeSelection,
    normalizeHomeLayout,
    normalizeHomeInboxLayout,
    isLegacyDefaultHomeLayout,
    isLegacyWindowsDefaultHomeLayout,
    swapHomeLayoutSlots,
    normalizeTodoCategoryNames,
    normalizeHomeWidgetSizes,
    packHomeWidgetLayout,
    swapHomeWidgetPlacements,
    normalizeHiddenHomeModules,
    updateHomeModuleVisibility,
    introduceHomeModule,
    fillHomeLayoutGaps,
    sizeNameFromPlacement,
    resolveHomeWidgetLayout,
    validateHomeWidgetLayout,
    layoutVariantForPlacement,
    calculateAudioLevel,
    resampleFloat32ToPcm16,
    shouldTogglePanelForSpace,
    shouldHandleMirrorPinch,
    adjustMirrorZoom,
  };
});
