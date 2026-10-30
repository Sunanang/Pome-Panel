const pomeLocaleRendererWorkspace = typeof module === 'object' && module.exports ? require("../localization/runtime") : globalThis.PomeI18n;
(function initWorkspace() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const COMMANDS_KEY = 'notch-home-commands';
  const LINKS_KEY = 'notch-link-groups';
  const RECORDINGS_KEY = 'notch-recordings';
  const HIDDEN_WINDOWS_KEY = 'notch-hidden-windows';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat(pomeLocaleRendererWorkspace.getState().formatLocale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // ============ 常用指令 ============
  const commandInput = document.getElementById('command-add');
  const commandList = document.getElementById('command-list');
  const commandBulkDelete = document.getElementById('command-bulk-delete');
  let commands = loadJson(COMMANDS_KEY, [])
    .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
    .filter(Boolean);
  let commandSelection = new Set();
  let commandSelectionAnchor = null;

  function persistCommands() {
    saveJson(COMMANDS_KEY, commands);
  }

  function renderCommands() {
    if (!commandList) return;
    commandList.replaceChildren();
    if (commandBulkDelete) {
      commandBulkDelete.hidden = commandSelection.size === 0;
      pomeLocaleRendererWorkspace.bind(commandBulkDelete, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.delete.2f9daa")));
      commandBulkDelete.setAttribute('aria-label', commandSelection.size
        ? pomeLocaleRendererWorkspace.t("copy.deleteItems.0bfa6f", { arg1: (commandSelection.size) })
        : pomeLocaleRendererWorkspace.t("copy.deleteSelected.435bf8"));
    }
    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'command-empty';
      pomeLocaleRendererWorkspace.bind(empty, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.keepCommandsPromptsOrReplyTemplatesHere.578abb")));
      commandList.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const row = document.createElement('div');
      row.className = `command-item${commandSelection.has(command.id) ? ' multi-selected' : ''}`;
      row.dataset.id = command.id;

      const textButton = document.createElement('button');
      textButton.className = 'command-text';
      textButton.type = 'button';
      textButton.dataset.action = 'edit-command';
      textButton.title = command.text;
      textButton.textContent = command.text;

      const actions = document.createElement('div');
      actions.className = 'command-actions';
      const copy = document.createElement('button');
      copy.className = 'icon-button';
      copy.type = 'button';
      copy.dataset.action = 'copy-command';
      copy.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.copyCommand.4888b5"));
      copy.innerHTML = COPY_ICON;
      const remove = document.createElement('button');
      remove.className = 'icon-button danger';
      remove.type = 'button';
      remove.dataset.action = 'delete-command';
      remove.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.deleteCommand.ebd35b"));
      remove.innerHTML = DELETE_ICON;
      actions.append(copy, remove);
      row.append(textButton, actions);
      commandList.appendChild(row);
    });
  }

  function editCommand(row) {
    const command = commands.find((item) => item.id === row.dataset.id);
    if (!command || row.querySelector('input')) return;
    const button = row.querySelector('.command-text');
    const input = document.createElement('input');
    input.className = 'command-edit';
    input.value = command.text;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value) command.text = value;
      persistCommands();
      renderCommands();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
  }

  if (commandInput) {
    commandInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const command = Domain.createCommand(commandInput.value, uid('command'), Date.now());
      if (!command) return;
      commandInput.value = '';
      if (commands.some((item) => item.text === command.text)) return;
      commands.unshift(command);
      persistCommands();
      renderCommands();
      window.PomeExperience?.highlight(commandList.querySelector(`[data-id="${CSS.escape(command.id)}"]`));
    });
  }

  if (commandList) {
    commandList.addEventListener('click', async (event) => {
      const row = event.target.closest('.command-item');
      if (!row) return;
      const command = commands.find((item) => item.id === row.dataset.id);
      if (!command) return;
      if (event.shiftKey) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          commands.map((item) => item.id),
          [...commandSelection],
          command.id,
          commandSelectionAnchor,
          true
        );
        commandSelection = new Set(result.selected);
        commandSelectionAnchor = result.anchor;
        renderCommands();
        return;
      }
      commandSelectionAnchor = command.id;
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'edit-command') editCommand(row);
      if (action.dataset.action === 'delete-command') {
        if (!await window.PomeDeleteConfirm.open({titleKey:'copy.deleteCommand.ebd35b',items:[command.text]})) return;
        commands = commands.filter((item) => item.id !== command.id);
        commandSelection.delete(command.id);
        persistCommands();
        renderCommands();
      }
      if (action.dataset.action === 'copy-command' && window.notchAPI) {
        const copied = await window.notchAPI.writeClipboard({ type: 'text', text: command.text });
        if (copied) {
          document.dispatchEvent(new CustomEvent('notch:copied',{detail:{target:action}}));
          row.classList.add('copied');
          setTimeout(() => row.classList.remove('copied'), 700);
        }
      }
    });
  }
  commandBulkDelete?.addEventListener('click', async () => {
    if (!commandSelection.size) return;
    const targets = commands.filter(command => commandSelection.has(command.id));
    if (!await window.PomeDeleteConfirm.open({items:targets.map(command => command.text)})) return;
    const ids = new Set(targets.map(command => command.id));
    commands = commands.filter((command) => !ids.has(command.id));
    commandSelection.clear();
    commandSelectionAnchor = null;
    persistCommands();
    renderCommands();
  });

  // ============ 链接收藏夹 ============
  const linkInput = document.getElementById('link-add');
  const linkBulkDelete = document.getElementById('link-bulk-delete');
  const linkGroupsEl = document.getElementById('link-groups');
  const linksStatus = document.getElementById('links-status');
  let linkGroups = loadJson(LINKS_KEY, []);
  if (!Array.isArray(linkGroups)) linkGroups = [];
  let linkSelection = new Set();
  let linkSelectionAnchor = null;
  let addingLinkGroupId = '';
  let linkQuery = '';
  document.addEventListener('notch:link-search', event => { linkQuery = String(event.detail || '').toLocaleLowerCase(); renderLinkGroups(); });

  function persistLinks() {
    saveJson(LINKS_KEY, linkGroups);
  }

  function setLinksStatus(message, tone = '') {
    if (linksStatus) {
      linksStatus.textContent = '';
      linksStatus.dataset.tone = tone;
    }
    if (linksStatus) { linksStatus.textContent = message; linksStatus.hidden = !message; }
    if (tone === 'error') { linkInput?.setAttribute('aria-invalid', 'true'); linkInput?.focus(); }
    else linkInput?.removeAttribute('aria-invalid');
    if (message && tone !== 'error' && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function allLinks() {
    return linkGroups.flatMap((group) => Array.isArray(group.links) ? group.links : []);
  }

  function updateLinkBulkAction() {
    if (!linkBulkDelete) return;
    linkBulkDelete.hidden = linkSelection.size === 0;
    pomeLocaleRendererWorkspace.bind(linkBulkDelete, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.delete.2f9daa")));
    linkBulkDelete.setAttribute('aria-label', linkSelection.size
      ? pomeLocaleRendererWorkspace.t("copy.deleteItems.0bfa6f", { arg1: (linkSelection.size) })
      : pomeLocaleRendererWorkspace.t("copy.deleteSelected.435bf8"));
  }

  function linkHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function renderLinkGroups() {
    if (!linkGroupsEl) return;
    linkGroupsEl.replaceChildren();
    updateLinkBulkAction();
    if (!linkGroups.length) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.innerHTML = ("<strong><span data-i18n=\"copy.noLinksYet.ca8a0b\">" + (pomeLocaleRendererWorkspace.t("copy.noLinksYet.ca8a0b")) + "</span></strong><span><span data-i18n=\"copy.pasteAUrlPomePanelWillFetch.fd0731\">" + (pomeLocaleRendererWorkspace.t("copy.pasteAUrlPomePanelWillFetch.fd0731")) + "</span></span>");
      linkGroupsEl.appendChild(empty);
      return;
    }

    if(linkQuery && !linkGroups.some(group=>(group.links||[]).some(link=>`${link.title} ${link.url} ${group.name}`.toLocaleLowerCase().includes(linkQuery)))){
      const empty=document.createElement('p');empty.className='links-empty';empty.textContent=pomeLocaleRendererWorkspace.t('ux.search.empty');linkGroupsEl.append(empty);return;
    }
    linkGroups.map(group => ({...group, links:(group.links || []).filter(link => !linkQuery || `${link.title} ${link.url} ${group.name}`.toLocaleLowerCase().includes(linkQuery))})).filter(group => !linkQuery || group.links.length).forEach((group) => {
      const section = document.createElement('section');
      section.className = `link-group${group.collapsed ? ' collapsed' : ''}`;
      section.dataset.groupId = group.id;

      const header = document.createElement('header');
      header.className = 'link-group-head';
      const toggle = document.createElement('button');
      toggle.className = 'group-toggle';
      toggle.type = 'button';
      toggle.dataset.action = 'toggle-group';
      toggle.setAttribute('aria-label', group.collapsed ? pomeLocaleRendererWorkspace.t("copy.expandGroup.c105f6") : pomeLocaleRendererWorkspace.t("copy.collapseGroup.7115c1"));
      toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const name = document.createElement('input');
      name.className = 'group-name-input';
      name.value = String(group.name || pomeLocaleRendererWorkspace.t("copy.untitledGroup.a6a35a"));
      name.dataset.action = 'rename-group';
      name.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.groupName.d7e266"));
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = `${Array.isArray(group.links) ? group.links.length : 0}`;
      header.append(toggle, name, count);
      header.appendChild(createIconButton('add-link-to-group', pomeLocaleRendererWorkspace.t("copy.addALinkTo.da80a1", { arg1: (group.name || pomeLocaleRendererWorkspace.t("copy.currentGroup.0d64fa")) }), ADD_ICON));
      header.appendChild(createIconButton('delete-group', pomeLocaleRendererWorkspace.t("copy.deleteThisGroupAndAllItsLinks.ac63b1"), DELETE_ICON, true));

      const body = document.createElement('div');
      body.className = 'link-group-body';
      if (addingLinkGroupId === group.id) {
        const addRow = document.createElement('div');
        addRow.className = 'group-link-add';
        addRow.innerHTML = ("<input data-group-link-input type=\"text\" placeholder=\"" + (pomeLocaleRendererWorkspace.attribute("copy.pasteAUrlAndPressEnterTo.ca1a76")) + "\" data-i18n-placeholder=\"copy.pasteAUrlAndPressEnterTo.ca1a76\" aria-label=\"" + (pomeLocaleRendererWorkspace.attribute("copy.addALinkTo.2ab212", { arg1: (String(group.name || pomeLocaleRendererWorkspace.t("copy.currentGroup.0d64fa")).replace(/[<>"&]/g, '')) })) + "\" autocomplete=\"off\" spellcheck=\"false\"><button type=\"button\" data-action=\"cancel-group-link-add\" aria-label=\"" + (pomeLocaleRendererWorkspace.attribute("copy.cancel.2cd0f3")) + "\" data-i18n-aria-label=\"copy.cancel.2cd0f3\">×</button>");
        body.appendChild(addRow);
      }
      const list = document.createElement('div');
      list.className = 'link-list';
      (group.links || []).forEach((link) => {
        const row = document.createElement('article');
        row.className = `link-item${linkSelection.has(link.id) ? ' multi-selected' : ''}`;
        row.dataset.linkId = link.id;
        row.dataset.groupId = group.id;
        const mark = document.createElement('span');
        mark.className = 'link-favicon';
        if (link.icon && String(link.icon).startsWith('data:image/')) {
          const image = document.createElement('img');
          image.src = link.icon;
          image.alt = '';
          mark.appendChild(image);
        } else {
          mark.textContent = (linkHostname(link.url).charAt(0) || '·').toUpperCase();
        }
        const open = document.createElement('button');
        open.className = 'link-open';
        open.type = 'button';
        open.dataset.action = 'open-link';
        const title = document.createElement('strong');
        title.textContent = link.title || linkHostname(link.url);
        const domain = document.createElement('span');
        domain.textContent = linkHostname(link.url) + (pendingLinkMetadata.has(link.id) ? ` · ${pomeLocaleRendererWorkspace.t('copy.reading.146da2')}` : '');
        open.setAttribute('aria-busy',String(pendingLinkMetadata.has(link.id)));
        open.append(title, domain);
        const actions = document.createElement('div');
        actions.className = 'link-actions';
        actions.append(
          createIconButton('open-link', pomeLocaleRendererWorkspace.t("copy.openLink.a26394"), OPEN_ICON),
          createIconButton('edit-link', pomeLocaleRendererWorkspace.t("copy.rename.88f462"), EDIT_ICON),
          createIconButton('delete-link', pomeLocaleRendererWorkspace.t("copy.deleteLink.e8feb9"), DELETE_ICON, true)
        );
        if (linkGroups.length > 1) {
          const move = document.createElement('select'); move.className='link-move';
          pomeLocaleRendererWorkspace.bind(move, 'ariaLabel', () => pomeLocaleRendererWorkspace.t('ux.links.move'));
          for (const target of linkGroups) { const option=document.createElement('option'); option.value=target.id; option.textContent=target.name; move.append(option); }
          move.value=group.id;
          move.addEventListener('change', () => { linkGroups=Domain.moveLinkToGroup(linkGroups,link.id,move.value); persistLinks(); renderLinkGroups(); });
          actions.prepend(move);
        }
        row.append(mark, open, actions);
        list.appendChild(row);
      });

      body.append(list);
      section.append(header, body);
      linkGroupsEl.appendChild(section);
    });
  }

  let linkMetadataRenderPending = false;
  const pendingLinkMetadata = new Set();
  function renderLinkMetadataWhenIdle() {
    if (!linkGroupsEl) return;
    const focused = document.activeElement;
    if ((linkGroupsEl.contains(focused) && focused?.matches('.link-title-edit, .group-name-input, [data-group-link-input]'))
      || linkGroupsEl.classList.contains('link-dragging')) {
      linkMetadataRenderPending = true;
      return;
    }
    linkMetadataRenderPending = false;
    renderLinkGroups();
  }
  linkGroupsEl?.addEventListener('focusout', () => {
    if (linkMetadataRenderPending) queueMicrotask(renderLinkMetadataWhenIdle);
  });
  for (const eventName of ['pointerup', 'pointercancel']) {
    document.addEventListener(eventName, () => {
      if (linkMetadataRenderPending) queueMicrotask(renderLinkMetadataWhenIdle);
    });
  }

  function addLink(rawValue, requestedGroupId = '') {
    const normalized = Domain.normalizeHttpUrl(rawValue);
    if (!normalized) {
      setLinksStatus(pomeLocaleRendererWorkspace.t("copy.enterAValidPublicUrl.d6921d"), 'error');
      return false;
    }
    if (allLinks().some((link) => link.url === normalized)) {
      setLinksStatus(pomeLocaleRendererWorkspace.t("copy.thisLinkIsAlreadySaved.6e1239"), 'error');
      return false;
    }
    const link = { id: uid('link'), url: normalized, title: linkHostname(normalized), icon: '', createdAt: Date.now() };
    const preferredGroupId = requestedGroupId || Domain.preferredLinkGroupId(linkGroups, normalized);
    const preferredGroup = linkGroups.find((group) => group.id === preferredGroupId);
    if (preferredGroup) {
      linkGroups = linkGroups.map((group) => group.id === preferredGroup.id
        ? { ...group, collapsed: false, links: [...(group.links || []), link] }
        : group);
    } else {
      linkGroups = Domain.addLinkToGroups(linkGroups, link, Domain.classifyLink(normalized, ''));
    }
    pendingLinkMetadata.add(link.id);
    const initialTitle = link.title;
    const initialGroup = linkGroups.find((group) => (group.links || []).some((item) => item.id === link.id));
    const initialGroupId = initialGroup?.id;
    const initialGroupName = initialGroup?.name;
    persistLinks();
    renderLinkGroups();
    setLinksStatus(pomeLocaleRendererWorkspace.t("copy.linkSaved.d25676"));

    // 保存动作不等待网络或大模型。标题、图标和分组在后台静默补全。
    Promise.resolve(window.notchAPI?.inspectLink?.(normalized)).then((inspected) => {
      if (!inspected?.ok) return;
      let sourceGroup = null;
      let savedLink = null;
      linkGroups.some((group) => {
        const found = (group.links || []).find((item) => item.id === link.id);
        if (!found) return false;
        sourceGroup = group;
        savedLink = found;
        return true;
      });
      if (!savedLink || !sourceGroup || savedLink.url !== normalized) return;
      const editingRow = linkGroupsEl?.querySelector(`[data-link-id="${CSS.escape(savedLink.id)}"] .link-title-edit`);
      const titleUntouched = savedLink.title === initialTitle && !editingRow;
      const groupNameInput = linkGroupsEl?.querySelector(`[data-group-id="${CSS.escape(sourceGroup.id)}"] .group-name-input`);
      const groupUntouched = sourceGroup.id === initialGroupId && sourceGroup.name === initialGroupName
        && (!groupNameInput || groupNameInput.value === initialGroupName)
        && !linkGroupsEl?.classList.contains('link-dragging');
      savedLink.url = inspected.url || savedLink.url;
      // Metadata is a best-effort completion of the original save. A later
      // rename, move or in-progress editor belongs to the user and wins.
      if (titleUntouched) savedLink.title = inspected.title || savedLink.title;
      savedLink.icon = inspected.icon || savedLink.icon || '';
      // 手动定向或同站点复用后锁定分组；自动分类只使用可预测的本地规则，
      // 避免模型自由命名生成多个近义分组。
      const lockedGroupId = preferredGroup?.id || Domain.preferredLinkGroupId(
        linkGroups.map((group) => ({
          ...group,
          links: (group.links || []).filter((item) => item.id !== savedLink.id),
        })),
        savedLink.url
      );
      const nextCategory = Domain.classifyLink(savedLink.url, savedLink.title);
      if (titleUntouched && groupUntouched && !lockedGroupId && nextCategory && nextCategory !== sourceGroup.name) {
        const target = linkGroups.find((group) => group.name === nextCategory);
        if (target) {
          linkGroups = Domain.moveLinkToGroup(linkGroups, savedLink.id, target.id);
        } else {
          sourceGroup.links = sourceGroup.links.filter((item) => item.id !== savedLink.id);
          linkGroups = Domain.addLinkToGroups(linkGroups, savedLink, nextCategory);
        }
      }
      persistLinks();
    }).catch(() => {}).finally(() => { pendingLinkMetadata.delete(link.id); renderLinkMetadataWhenIdle(); });
    return true;
  }

  if (linkInput) {
    linkInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const value = linkInput.value;
      if (addLink(value)) linkInput.value = '';
      linkInput.focus();
    });
  }

  function findLink(group, linkId) {
    return group && (group.links || []).find((link) => link.id === linkId);
  }

  if (linkGroupsEl) {
    linkGroupsEl.addEventListener('change', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('.group-name-input')) {
        linkGroups = Domain.renameGroup(linkGroups, groupSection.dataset.groupId, event.target.value);
        persistLinks();
        renderLinkGroups();
      }
      if (event.target.matches('.link-title-edit')) {
        const row = event.target.closest('[data-link-id]');
        const group = linkGroups.find((item) => item.id === groupSection.dataset.groupId);
        const link = findLink(group, row && row.dataset.linkId);
        const value = event.target.value.trim();
        if (link && value) link.title = value;
        persistLinks();
        renderLinkGroups();
      }
    });

    linkGroupsEl.addEventListener('keydown', async (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('[data-group-link-input]')) {
        if (event.key === 'Escape') {
          addingLinkGroupId = '';
          renderLinkGroups();
        } else if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
          event.preventDefault();
          if (addLink(event.target.value, groupSection.dataset.groupId)) {
            addingLinkGroupId = '';
            renderLinkGroups();
          }
        }
        return;
      }
      if (event.target.matches('.group-name-input') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      if (event.target.matches('.link-title-edit') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    linkGroupsEl.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groupId = groupSection.dataset.groupId;
      const group = linkGroups.find((item) => item.id === groupId);
      const row = event.target.closest('[data-link-id]');
      const link = findLink(group, row && row.dataset.linkId);
      if (event.shiftKey && link) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          allLinks().map((item) => item.id),
          [...linkSelection],
          link.id,
          linkSelectionAnchor,
          true
        );
        linkSelection = new Set(result.selected);
        linkSelectionAnchor = result.anchor;
        renderLinkGroups();
        return;
      }
      if (link) linkSelectionAnchor = link.id;
      if (!action) return;
      if (action.dataset.action === 'add-link-to-group') {
        addingLinkGroupId = groupId;
        group.collapsed = false;
        persistLinks();
        renderLinkGroups();
        requestAnimationFrame(() => linkGroupsEl.querySelector(
          `[data-group-id="${CSS.escape(groupId)}"] [data-group-link-input]`
        )?.focus());
      }
      if (action.dataset.action === 'cancel-group-link-add') {
        addingLinkGroupId = '';
        renderLinkGroups();
      }
      if (action.dataset.action === 'toggle-group') {
        group.collapsed = !group.collapsed;
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'delete-group') {
        const ids = new Set((group.links || []).map(item => item.id));
        if (!await window.PomeDeleteConfirm.open({titleKey:'ui.delete.groupTitle',items:[group.name],messageKey:'ui.delete.groupHint',args:{count:ids.size}})) return;
        const current = linkGroups.find(item => item.id === groupId);
        if (!current || (current.links || []).some(item => !ids.has(item.id))) return;
        ids.forEach(id => linkSelection.delete(id));
        linkGroups = linkGroups.filter((item) => item.id !== groupId);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'open-link' && link && window.notchAPI) {
        window.notchAPI.openExternal(link.url);
      }
      if (action.dataset.action === 'delete-link' && link) {
        if (!await window.PomeDeleteConfirm.open({titleKey:'copy.deleteLink.e8feb9',items:[link.title || link.url]})) return;
        const current = linkGroups.find(item => item.id === groupId);
        if (!current) return;
        current.links = current.links.filter((item) => item.id !== link.id);
        linkSelection.delete(link.id);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'edit-link' && link && row) {
        const openButton = row.querySelector('.link-open');
        const input = document.createElement('input');
        input.className = 'link-title-edit';
        input.value = link.title;
        openButton.replaceWith(input);
        input.focus();
        input.select();
      }
    });

    // ============ 链接长按拖拽：组内排序 + 跨组搬运 ============
    // 不用 HTML5 拖拽有两个原因：一是行中间那一大块是 <button class="link-open">，
    // Chromium 里从 button 上按下不会触发祖先的 dragstart，标题区域整块拖不动；
    // 二是原生拖拽一按就走，没法和「点击打开链接」区分。改成指针事件 + 长按门槛。
    const LINK_DRAG_HOLD_MS = 340;
    const LINK_DRAG_MOVE_CANCEL = 8;
    let linkDrag = null;
    let suppressLinkClick = false;

    function clearLinkDropMarks() {
      linkGroupsEl.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((item) => {
        item.classList.remove('drop-before', 'drop-after', 'drop-target');
      });
    }

    function cancelLinkDrag() {
      if (!linkDrag) return;
      clearTimeout(linkDrag.holdTimer);
      if (linkDrag.active) {
        linkDrag.row.classList.remove('dragging');
        linkGroupsEl.classList.remove('link-dragging');
        clearLinkDropMarks();
      }
      try { linkDrag.row.releasePointerCapture(linkDrag.pointerId); } catch (error) {}
      linkDrag = null;
    }

    // 落点有两种：压在某一行上就按该行中线决定插到它前面还是后面；
    // 压在分组的空白或标题上就追加到该组末尾（index 为 null）。
    function updateLinkDropTarget(clientX, clientY) {
      clearLinkDropMarks();
      linkDrag.target = null;
      const under = document.elementFromPoint(clientX, clientY);
      if (!under || !linkGroupsEl.contains(under)) return;
      const overRow = under.closest('.link-item[data-link-id]');
      // 压在被拖那一行自己身上 = 放回原处，目标留空，松手什么都不做。
      // 少了这一步，长按后原地松手会落到「自己所在的分组」上，被当成追加到组末尾。
      if (overRow === linkDrag.row) return;
      if (overRow) {
        const rect = overRow.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        overRow.classList.add(after ? 'drop-after' : 'drop-before');
        const rows = Array.from(overRow.parentElement.children)
          .filter((item) => item.dataset && item.dataset.linkId);
        linkDrag.target = {
          groupId: overRow.dataset.groupId,
          index: rows.indexOf(overRow) + (after ? 1 : 0),
        };
        return;
      }
      const overGroup = under.closest('.link-group[data-group-id]');
      if (!overGroup) return;
      overGroup.classList.add('drop-target');
      linkDrag.target = { groupId: overGroup.dataset.groupId, index: null };
    }

    function linkOrderFingerprint() {
      return linkGroups
        .map((group) => `${group.id}:${(group.links || []).map((link) => link.id).join(',')}`)
        .join('|');
    }

    linkGroupsEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const row = event.target.closest('.link-item[data-link-id]');
      // 编辑 / 删除按钮和标题输入框保持原有点击语义，不参与拖拽。
      if (!row || event.target.closest('input, .link-actions')) return;
      // 上一次拖拽后若没有等到那个补发的 click（比如在列表外松手），标志会留着，
      // 否则它会把下一次正常点击吞掉，链接就打不开了。
      suppressLinkClick = false;
      cancelLinkDrag();
      linkDrag = {
        row,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        holdTimer: setTimeout(() => {
          if (!linkDrag) return;
          linkDrag.active = true;
          row.classList.add('dragging');
          linkGroupsEl.classList.add('link-dragging');
          try { row.setPointerCapture(linkDrag.pointerId); } catch (error) {}
          updateLinkDropTarget(linkDrag.startX, linkDrag.startY);
          setLinksStatus(pomeLocaleRendererWorkspace.t("copy.releaseAtTheTargetPosition.cb8842"));
        }, LINK_DRAG_HOLD_MS),
      };
    });

    // 这三个挂在 document 上（与窗口拖拽同一套写法）：长按还没满就快速划出列表时，
    // 挂在 linkGroupsEl 上收不到 move / up，计时器随后仍会启动一次拖拽。
    document.addEventListener('pointermove', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      if (!linkDrag.active) {
        // 长按还没满就移动，说明用户在滚动或只是手抖，放弃这次拖拽。
        const moved = Math.abs(event.clientX - linkDrag.startX) > LINK_DRAG_MOVE_CANCEL
          || Math.abs(event.clientY - linkDrag.startY) > LINK_DRAG_MOVE_CANCEL;
        if (moved) cancelLinkDrag();
        return;
      }
      event.preventDefault();
      updateLinkDropTarget(event.clientX, event.clientY);
    });

    document.addEventListener('pointerup', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      const wasActive = linkDrag.active;
      const target = linkDrag.target;
      const linkId = linkDrag.row.dataset.linkId;
      cancelLinkDrag();
      if (!wasActive) return;
      // 拖拽结束后浏览器仍会补一个 click，必须拦掉，否则松手即打开链接。
      suppressLinkClick = true;
      if (!target) {
        setLinksStatus('');
        return;
      }
      const before = linkOrderFingerprint();
      linkGroups = Domain.moveLinkToPosition(linkGroups, linkId, target.groupId, target.index);
      if (linkOrderFingerprint() === before) {
        setLinksStatus('');
        return;
      }
      persistLinks();
      renderLinkGroups();
      setLinksStatus(pomeLocaleRendererWorkspace.t("copy.linkOrderUpdated.840904"));
    });

    document.addEventListener('pointercancel', () => cancelLinkDrag());

    linkGroupsEl.addEventListener('click', (event) => {
      if (!suppressLinkClick) return;
      suppressLinkClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  linkBulkDelete?.addEventListener('click', async () => {
    if (!linkSelection.size) return;
    const targets = allLinks().filter(link => linkSelection.has(link.id));
    if (!await window.PomeDeleteConfirm.open({items:targets.map(link => link.title || link.url)})) return;
    const ids = new Set(targets.map(link => link.id));
    linkGroups = linkGroups.map((group) => ({
      ...group,
      links: (group.links || []).filter((link) => !ids.has(link.id)),
    }));
    linkSelection.clear();
    linkSelectionAnchor = null;
    persistLinks();
    renderLinkGroups();
    setLinksStatus(pomeLocaleRendererWorkspace.t("copy.selectedLinksDeleted.eaa3ee"));
  });

  // ============ 录音与转写 ============
  const homeRecorder = document.getElementById('home-recorder');
  const recordingDot = document.getElementById('home-recording-dot');
  const recordingStateLabel = document.getElementById('home-recording-state');
  const recordingTime = document.getElementById('home-recording-time');
  const recordingStrands = document.getElementById('recording-strands');
  const liveTranscript = document.getElementById('home-live-transcript');
  const recordStart = document.getElementById('record-start');
  const recordPause = document.getElementById('record-pause');
  const recordStop = document.getElementById('record-stop');
  const recordingNew = document.getElementById('recording-new');
  const recordingConfigure = document.getElementById('recording-configure');
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
  const transcriptionSettingsBackdrop = document.getElementById('transcription-settings-backdrop');
  const transcriptionSettingsClose = document.getElementById('transcription-settings-close');
  const transcriptionSettingsCancel = document.getElementById('transcription-settings-cancel');
  const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
  const transcriptionApiKey = document.getElementById('transcription-api-key');
  const transcriptionApiStatus = document.getElementById('transcription-api-status');
  const transcriptionApiHelp = document.getElementById('transcription-api-help');
  const transcriptionRegion = document.getElementById('transcription-region');
  const transcriptionLanguage = document.getElementById('transcription-language');
  let activeRecognitionLanguage = 'zh-CN';
  const transcriptionWorkspace = document.getElementById('transcription-workspace');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmApiStatus = document.getElementById('llm-api-status');
  const llmApiHelp = document.getElementById('llm-api-help');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmModel = document.getElementById('llm-model');
  const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
  const settingsApiConfigure = document.getElementById('settings-api-configure');
  const settingsTranscriptionStatus = document.getElementById('settings-transcription-status');
  const settingsLlmStatus = document.getElementById('settings-llm-status');
  const settingsCursorToken = document.getElementById('settings-cursor-token');
  const settingsCursorTokenStatus = document.getElementById('settings-cursor-token-status');
  const settingsCursorTokenSave = document.getElementById('settings-cursor-token-save');
  const settingsCursorTokenFetch = document.getElementById('settings-cursor-token-fetch');
  const settingsCursorTokenClear = document.getElementById('settings-cursor-token-clear');
  const settingsCursorTokenHint = document.getElementById('settings-cursor-token-hint');
  let settingsCursorTokenMeta = { configured: false, state: 'empty', label: pomeLocaleRendererWorkspace.t("copy.notConfiguredUsingLocalSignIn.3004c2") };
  const settingsNasSyncStatus = document.getElementById('settings-nas-sync-status');
  const settingsNasSyncBaseUrl = document.getElementById('settings-nas-sync-base-url');
  const settingsNasPairCode = document.getElementById('settings-nas-pair-code');
  const settingsNasPairSubmit = document.getElementById('settings-nas-pair-submit');
  const settingsNasPairReauth = document.getElementById('settings-nas-pair-reauth');
  const settingsNasSyncHint = document.getElementById('settings-nas-sync-hint');
  const settingsNasStatusHint = document.getElementById('settings-nas-status-hint');
  const settingsNasEndpointHint = document.getElementById('settings-nas-endpoint-hint');
  const settingsNasDialogRoot = document.getElementById('settings-nas-dialog-root');
  const settingsNasDialogTitle = document.getElementById('settings-nas-dialog-title');
  const settingsNasDialogBody = document.getElementById('settings-nas-dialog-body');
  const settingsNasDialogCancel = document.getElementById('settings-nas-dialog-cancel');
  const settingsNasDialogAlt = document.getElementById('settings-nas-dialog-alt');
  const settingsNasDialogConfirm = document.getElementById('settings-nas-dialog-confirm');
  const settingsNasDialog = document.getElementById('settings-nas-dialog');
  const settingsNasMigrationActions = document.getElementById('settings-nas-migration-actions');
  const settingsNasMigrationStart = document.getElementById('settings-nas-migration-start');
  const settingsNasMigrationRetry = document.getElementById('settings-nas-migration-retry');
  const settingsNasMigrationRestore = document.getElementById('settings-nas-migration-restore');
  const todoMigrationBanner = document.getElementById('todo-migration-banner');
  const tabTodo = document.getElementById('tab-todo');
  const settingsNasStatusMeta = document.getElementById('settings-nas-status-meta');
  const settingsNasOutboxCount = document.getElementById('settings-nas-outbox-count');
  const settingsNasLastSync = document.getElementById('settings-nas-last-sync');
  const settingsNasHttpWarning = document.getElementById('settings-nas-http-warning');
  const settingsNasDevicePortGuide = document.getElementById('settings-nas-device-port-guide');
  const settingsNasSyncOpen = document.getElementById('settings-nas-sync-open');
  const settingsNasSyncOptions = document.getElementById('settings-nas-sync-options');
  const settingsNasSyncOptionsCancel = document.getElementById('settings-nas-sync-options-cancel');
  const settingsNasSyncOptionsStart = document.getElementById('settings-nas-sync-options-start');
  const settingsNasSyncRetry = document.getElementById('settings-nas-sync-retry');
  const settingsNasExportBackup = document.getElementById('settings-nas-export-backup');
  const settingsNasRestoreBackup = document.getElementById('settings-nas-restore-backup');
  const settingsNasEndpointList = document.getElementById('settings-nas-connection-policies');
  const settingsNasEndpointUrl = document.getElementById('settings-nas-endpoint-url');
  const settingsNasEndpointAdd = document.getElementById('settings-nas-endpoint-add');
  let nasPairUi = (window.NasSyncPair && window.NasSyncPair.initialPairUiState)
    ? window.NasSyncPair.initialPairUiState()
    : { code: '', baseUrl: '', bound: false, status: null, devices: [], dialog: null };
  let nasMigrationUi = (window.NasSyncMigration && window.NasSyncMigration.initialMigrationUiState)
    ? window.NasSyncMigration.initialMigrationUiState()
    : { readonly: false, bannerVisible: false, phase: 'idle', dialog: null };
  let nasSettingsUi = (window.NasSyncSettings && window.NasSyncSettings.initialSettingsUiState)
    ? window.NasSyncSettings.initialSettingsUiState()
    : { view: null, outboxCount: 0, uiState: 'unbound' };
  let nasDialogResolver = null;
  let nasBackupDraftDirty = false;
  const settingsFeatureList = document.getElementById('settings-feature-list');
  const settingsHomeModuleList = document.getElementById('settings-home-module-list');
  const settingsMirrorPreview = document.getElementById('settings-mirror-preview');
  const settingsMirrorChoose = document.getElementById('settings-mirror-choose');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsResetPanelPosition = document.getElementById('settings-reset-panel-position');
  const settingsDefaultTab = document.getElementById('settings-default-tab');
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsTaskNotifications = document.getElementById('settings-task-notifications');
  const settingsWeatherEffects = document.getElementById('settings-weather-effects');
  const settingsWinNativeRow = document.getElementById('settings-win-native-row');
  const settingsWinNative = document.getElementById('settings-win-native');
  const settingsInlineNote = document.getElementById('settings-inline-note');

  let recordings = loadJson(RECORDINGS_KEY, []).map(Domain.createRecording).filter(Boolean);
  let selectedRecordingId = recordings[0] && recordings[0].id;
  let recordingSelection = new Set();
  let recordingSelectionAnchor = selectedRecordingId || null;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let speechRecognition = null;
  let speechRecognitionBlocked = false;
  let speechRecognitionError = '';
  let recordingStatus = 'idle';
  let recordingStartedAt = 0;
  let pausedAt = 0;
  let pausedTotalMs = 0;
  let recordingTranscript = '';
  let interimTranscript = '';
  let recordingTimer = null;
  let recordingStopDurationMs = 0;
  let recordingCaptureIssue = '';
  let recordingDraftId = '';
  let currentAudioUrl = '';
  let currentAudioElement = null;
  let recordingAudioGeneration = 0;
  let transcriptionConfig = {
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    llmConfigured: false,
    llmNeedsReentry: false,
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-v4-flash',
  };
  let settingsAppSettings = null;
  let settingsAppSettingsRevision = 0;
  let settingsRefreshGeneration = 0;
  let settingsWorkspace = null;
  let transcriptionStatus = 'idle';
  let transcriptionAudioGap = false;
  let transcriptionStartPromise = null;
  let transcriptionAudioContext = null;
  let transcriptionAudioSource = null;
  let transcriptionAudioProcessor = null;
  let transcriptionAudioMute = null;
  let transcriptionFinishPromise = null;
  let strandsAudioContext = null;
  let strandsAudioSource = null;
  let strandsAnalyser = null;
  let strandsFrame = null;
  let strandsSamples = null;
  let strandsLevel = 0;
  const recordingStartTask = Domain.createExclusiveAsyncTask(() => updateRecordingUi());

  function isRecordingActive() {
    return ['recording', 'paused', 'saving'].includes(recordingStatus);
  }

  function isRecordingBusy() {
    return recordingStartTask.isPending() || isRecordingActive();
  }

  function stopRecordingStrands() {
    if (strandsFrame) cancelAnimationFrame(strandsFrame);
    strandsFrame = null;
    try { strandsAudioSource?.disconnect(); } catch (error) {}
    if (strandsAudioContext) strandsAudioContext.close().catch(() => {});
    strandsAudioContext = null;
    strandsAudioSource = null;
    strandsAnalyser = null;
    strandsSamples = null;
    strandsLevel = 0;
    const context = recordingStrands?.getContext('2d');
    context?.clearRect(0, 0, recordingStrands.width, recordingStrands.height);
  }

  function drawRecordingStrands(now) {
    if (!recordingStrands || !strandsAnalyser || !strandsSamples) {
      strandsFrame = null;
      return;
    }
    const bounds = recordingStrands.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (recordingStrands.width !== width || recordingStrands.height !== height) {
      recordingStrands.width = width;
      recordingStrands.height = height;
    }
    strandsAnalyser.getFloatTimeDomainData(strandsSamples);
    const measured = recordingStatus === 'recording' ? Domain.calculateAudioLevel(strandsSamples) : 0;
    strandsLevel += (measured - strandsLevel) * (measured > strandsLevel ? 0.34 : 0.08);
    const context = recordingStrands.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    context.globalCompositeOperation = 'lighter';
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    const activeLevel = Math.min(1, strandsLevel * 6);
    const centerY = cssHeight * 0.55;
    const phase = now * 0.00115;
    const colors = [
      ['rgba(82, 224, 255, 0)', `rgba(82, 224, 255, ${0.2 + activeLevel * 0.44})`, 'rgba(82, 224, 255, 0)'],
      ['rgba(111, 128, 255, 0)', `rgba(111, 128, 255, ${0.22 + activeLevel * 0.5})`, 'rgba(111, 128, 255, 0)'],
      ['rgba(209, 96, 255, 0)', `rgba(209, 96, 255, ${0.19 + activeLevel * 0.46})`, 'rgba(209, 96, 255, 0)'],
      ['rgba(255, 102, 184, 0)', `rgba(255, 102, 184, ${0.17 + activeLevel * 0.4})`, 'rgba(255, 102, 184, 0)'],
      ['rgba(255, 210, 91, 0)', `rgba(255, 210, 91, ${0.14 + activeLevel * 0.34})`, 'rgba(255, 210, 91, 0)'],
    ];
    context.filter = `blur(${8 + activeLevel * 10}px)`;
    colors.forEach((palette, layer) => {
      const gradient = context.createLinearGradient(cssWidth * 0.08, 0, cssWidth * 0.92, 0);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.36 + layer * 0.025, palette[1]);
      gradient.addColorStop(0.72 - layer * 0.02, palette[1]);
      gradient.addColorStop(1, palette[2]);
      const heightScale = cssHeight * (0.06 + layer * 0.012 + activeLevel * (0.18 + layer * 0.014));
      const drift = Math.sin(phase + layer * 0.92) * cssHeight * 0.025;
      context.beginPath();
      context.moveTo(cssWidth * 0.04, centerY);
      for (let x = cssWidth * 0.04; x <= cssWidth * 0.96; x += 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.sin(progress * Math.PI * (2.2 + layer * 0.18) + phase + layer) * heightScale * 0.16;
        context.lineTo(x, centerY - envelope * heightScale - ripple + drift);
      }
      for (let x = cssWidth * 0.96; x >= cssWidth * 0.04; x -= 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.cos(progress * Math.PI * (2 + layer * 0.14) - phase - layer) * heightScale * 0.14;
        context.lineTo(x, centerY + envelope * heightScale + ripple + drift);
      }
      context.closePath();
      context.fillStyle = gradient;
      context.globalAlpha = 0.58 - layer * 0.055;
      context.fill();
    });
    context.filter = 'blur(2px)';
    const core = context.createLinearGradient(cssWidth * 0.16, 0, cssWidth * 0.84, 0);
    core.addColorStop(0, 'rgba(66, 191, 255, 0)');
    core.addColorStop(0.34, `rgba(172, 238, 255, ${0.3 + activeLevel * 0.55})`);
    core.addColorStop(0.58, `rgba(255, 209, 255, ${0.38 + activeLevel * 0.58})`);
    core.addColorStop(0.78, `rgba(255, 213, 117, ${0.24 + activeLevel * 0.5})`);
    core.addColorStop(1, 'rgba(255, 130, 196, 0)');
    context.globalAlpha = 1;
    context.fillStyle = core;
    context.fillRect(cssWidth * 0.08, centerY - 1.3 - activeLevel, cssWidth * 0.84, 2.6 + activeLevel * 2);
    context.restore();
    homeRecorder?.style.setProperty('--recording-level', strandsLevel.toFixed(3));
    strandsFrame = requestAnimationFrame(drawRecordingStrands);
  }

  function startRecordingStrands(stream) {
    stopRecordingStrands();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream || !recordingStrands) return;
    try {
      strandsAudioContext = new AudioContext();
      strandsAudioSource = strandsAudioContext.createMediaStreamSource(stream);
      strandsAnalyser = strandsAudioContext.createAnalyser();
      strandsAnalyser.fftSize = 512;
      strandsAnalyser.smoothingTimeConstant = 0.72;
      strandsSamples = new Float32Array(strandsAnalyser.fftSize);
      strandsAudioSource.connect(strandsAnalyser);
      strandsFrame = requestAnimationFrame(drawRecordingStrands);
    } catch (error) {
      stopRecordingStrands();
    }
  }

  function updateTranscriptionConfigUi() {
    const statuses = Domain.apiCredentialStatuses(transcriptionConfig);
    if (transcriptionApiStatus) {
      transcriptionApiStatus.textContent = statuses.transcription.label;
      transcriptionApiStatus.dataset.state = statuses.transcription.state;
    }
    if (llmApiStatus) {
      llmApiStatus.textContent = statuses.llm.label;
      llmApiStatus.dataset.state = statuses.llm.state;
    }
    if (transcriptionRegion) transcriptionRegion.value = transcriptionConfig.region || 'beijing';
    if (transcriptionLanguage) transcriptionLanguage.value = transcriptionConfig.transcriptionLanguage || 'zh';
    if (transcriptionWorkspace) transcriptionWorkspace.value = transcriptionConfig.workspaceId || '';
    if (llmBaseUrl) llmBaseUrl.value = transcriptionConfig.llmBaseUrl || 'https://api.deepseek.com';
    if (llmModel) llmModel.value = transcriptionConfig.llmModel || 'deepseek-v4-flash';
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  function applySettingsMirrorCover(dataUrl) {
    if (settingsMirrorPreview && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      settingsMirrorPreview.src = dataUrl;
    }
  }

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: transcriptionConfig,
    });
    if (settingsTranscriptionStatus) {
      settingsTranscriptionStatus.textContent = summary.transcription.label;
      settingsTranscriptionStatus.dataset.state = summary.transcription.state;
    }
    if (settingsLlmStatus) {
      settingsLlmStatus.textContent = summary.llm.label;
      settingsLlmStatus.dataset.state = summary.llm.state;
    }
    if (settingsCursorTokenStatus) {
      pomeLocaleRendererWorkspace.bind(settingsCursorTokenStatus, "textContent", () => (pomeLocaleRendererWorkspace.systemText(settingsCursorTokenMeta.label) || pomeLocaleRendererWorkspace.t("copy.notConfiguredUsingLocalSignIn.3004c2")));
      settingsCursorTokenStatus.dataset.state = settingsCursorTokenMeta.state || 'empty';
    }
    renderNasSyncPanel();
    if (settingsShortcutValue) {
      // 存的是 Electron accelerator，显示要按平台换成 ⌘⌥⌃⇧ 或 Ctrl/Alt/Shift/Win（P2-3）。
      settingsShortcutValue.textContent = window.NotchPlatform?.formatAccelerator(summary.shortcut, window.notchAPI?.capabilities) || summary.shortcut;
    }
    if (settingsDefaultTab) {
      const visibleTabs = new Set(Domain.visiblePanelTabs(
        ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'],
        settingsAppSettings?.features
      ));
      Array.from(settingsDefaultTab.options).forEach((option) => {
        const visible = visibleTabs.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });
      settingsDefaultTab.value = visibleTabs.has(summary.defaultTab) ? summary.defaultTab : 'home';
    }
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      pomeLocaleRendererWorkspace.bind(settingsWorkspacePath, "textContent", () => (summary.workspacePath || pomeLocaleRendererWorkspace.t("copy.defaultDataFolder.39ab2a")));
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    if (settingsTaskNotifications) settingsTaskNotifications.checked = settingsAppSettings?.taskNotifications !== false;
    if (settingsWeatherEffects) settingsWeatherEffects.checked = settingsAppSettings?.weatherEffects !== false;
    // Windows 原生能力（P4 / D16）：杀软首轮测试没跑，默认关，只在 Windows 上露出这一行。
    if (settingsWinNativeRow) {
      settingsWinNativeRow.hidden = window.notchAPI?.capabilities?.features?.winNativeSetting !== true;
    }
    if (settingsWinNative) settingsWinNative.checked = settingsAppSettings?.winNative === true;
    settingsFeatureList?.querySelectorAll('input[data-settings-feature]').forEach((input) => {
      input.checked = settingsAppSettings?.features?.[input.dataset.settingsFeature] !== false;
    });
    renderHomeModuleSettings();
    window.NotchUi?.renderTokenSources();
  }

  function renderHomeModuleSettings() {
    const state = window.NotchHome?.getVisibility?.();
    const hidden = new Set(state?.hiddenIds || []);
    const recordingActive = window.NotchWorkspace?.isRecordingActive?.() ?? isRecordingActive();
    settingsHomeModuleList?.querySelectorAll('input[data-settings-home-module]').forEach((input) => {
      const moduleId = input.dataset.settingsHomeModule;
      const unavailable = state?.unavailableIds?.includes(moduleId) === true;
      input.closest('label').hidden = unavailable;
      input.checked = !hidden.has(moduleId);
      input.disabled = unavailable || state?.readOnly === true
        || (moduleId === 'recorder' && recordingActive && input.checked);
    });
    const recorderNote = settingsHomeModuleList?.querySelector('[data-home-module-setting-note="recorder"]');
    if (recorderNote) pomeLocaleRendererWorkspace.bind(recorderNote, "textContent", () => (recordingActive ? pomeLocaleRendererWorkspace.t("copy.recordingInProgress.d548e4") : pomeLocaleRendererWorkspace.t("copy.recordingTranscription.376486")));
    const status = document.getElementById('settings-home-module-status');
    if (status) {
      pomeLocaleRendererWorkspace.bind(status, "textContent", () => (state?.readOnly
        ? pomeLocaleRendererWorkspace.t("copy.safeModeChangesUnavailable.d3e9bc")
        : state?.persisted === false
          ? pomeLocaleRendererWorkspace.t("copy.thisSessionOnlyCouldnTSave.379370")
          : pomeLocaleRendererWorkspace.t("copy.hiddenSpacesRefillAutomaticallyKeepAtLeast.be4674")));
      status.dataset.state = state?.readOnly || state?.persisted === false ? 'warning' : 'saved';
    }
  }

  function renderCodexSettings(data, status) {
    const D = window.NotchAiUsageDomain;
    const local = document.getElementById('settings-codex-local-status');
    const percent = document.getElementById('settings-codex-percent');
    const meta = document.getElementById('settings-codex-token-status');
    const guide = document.getElementById('settings-codex-token-guide');
    const invalid = data?.manualTokenInvalid ?? status?.manualTokenInvalid;
    if (status && meta) { meta.textContent = status.label; meta.dataset.state = status.state; }
    if (invalid !== undefined) {
      guide.hidden = !invalid;
      if (invalid) { pomeLocaleRendererWorkspace.bind(meta, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.tokenExpired.22c3fe"))); meta.dataset.state = 'error'; }
      else if (data) {
        pomeLocaleRendererWorkspace.bind(meta, "textContent", () => (data.configured ? pomeLocaleRendererWorkspace.t("copy.manualTokenConfigured.4bb854") : pomeLocaleRendererWorkspace.t("copy.noManualTokenConfigured.a2ebce")));
        meta.dataset.state = data.configured ? 'saved' : 'empty';
      }
    }
    if (!data || !D || !local) return;
    const updated = data.updatedAt && new Date(data.updatedAt);
    const today = updated && updated.toDateString() === new Date().toDateString();
    const recent = updated ? `${today ? pomeLocaleRendererWorkspace.t("copy.today.d5f5a7") : updated.toLocaleDateString(pomeLocaleRendererWorkspace.getState().formatLocale)} ${D.clock(data.updatedAt)}` : pomeLocaleRendererWorkspace.t("copy.noUsageRecordsYet.bd8649");
    const remote = data.authSource === 'manual';
    pomeLocaleRendererWorkspace.bind(local, "textContent", () => (remote ? [pomeLocaleRendererWorkspace.t("copy.manualToken.bf90e7"), D.planLabel(data.plan), pomeLocaleRendererWorkspace.t("copy.updated.7114c0", { arg1: (D.clock(data.updatedAt)) })].filter(Boolean).join(' · ')
      : data.detected ? [pomeLocaleRendererWorkspace.t("copy.localCodex.bbc04a"), D.planLabel(data.plan), pomeLocaleRendererWorkspace.t("copy.lastUsed.03d4d8", { arg1: (recent) })].filter(Boolean).join(' · ') : pomeLocaleRendererWorkspace.t("copy.localCodexNotDetected.89ad92")));
    pomeLocaleRendererWorkspace.bind(percent, "textContent", () => (data.updatedAt ? D.quotaRows(data, 'codex').map(({ name, windowUsage }) => `${name.replace(/额度$/, '')} ${D.formatPercent(D.remaining(windowUsage?.percent))}`).join(' · ')
      + (D.quotaRows(data, 'codex').some(row => D.expired(row.windowUsage)) ? pomeLocaleRendererWorkspace.t("copy.resetTimePassedRefreshNeeded.975faa") : '') : ''));
    if (data.remoteError && !invalid) percent.textContent += pomeLocaleRendererWorkspace.t("copy.onlineUsageIsTemporarilyUnavailable.aa2a7b", { arg1: (percent.textContent ? ' · ' : '') });
    else if (!data.ok && data.error && !invalid) pomeLocaleRendererWorkspace.bind(percent, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.couldnTReadLocalRecordsRefreshOn.c598b7")));
  }
  document.addEventListener('notch:ai-usage-updated', (event) => renderCodexSettings(event.detail?.codex));
  window.notchAPI?.onCodexTokenChanged?.((status) => {
    renderCodexSettings(null, status);
    document.dispatchEvent(new CustomEvent('notch:codex-token-changed', { detail: status }));
  });
  function reportCodexTokenFailure(hint, messageKey, code) {
    if (window.NotchUi?.showError) {
      window.NotchUi.showError({ diagnostic: `Codex: ${code || 'operation_failed'}`, messageKey, scope: 'token:codex', inlineHint: hint, onRepair: () => window.NotchAiSources?.openSettings('codex') });
    } else {
      pomeLocaleRendererWorkspace.bind(hint, 'textContent', () => pomeLocaleRendererWorkspace.t(messageKey));
      hint?.classList.add('error');
    }
  }
  function setCodexTokenBusy(busy) {
    ['settings-codex-token', 'settings-codex-token-fetch', 'settings-codex-token-save', 'settings-codex-token-clear']
      .forEach((id) => { const control = document.getElementById(id); if (control) control.disabled = busy; });
  }
  document.getElementById('settings-codex-token-fetch')?.addEventListener('click', async () => {
    if (!window.notchAPI?.readLocalCodexToken) return;
    const input = document.getElementById('settings-codex-token');
    const button = document.getElementById('settings-codex-token-fetch');
    const hint = document.getElementById('settings-codex-token-hint');
    hint.className = 'settings-cursor-token-hint';
    pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.readingLocalCodexSignIn.a06abf")));
    pomeLocaleRendererWorkspace.bind(button, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.reading.146da2")));
    setCodexTokenBusy(true);
    let readingLocal = true;
    try {
      const result = await window.notchAPI.readLocalCodexToken();
      if (!result?.ok || !result.token) {
        const messages = {
          codex_auth_missing: "copy.noReadableCodexSignInFoundSign.d77b80",
          codex_token_missing: "copy.noUsableTokenFoundInLocalCodex.fab797",
          codex_auth_read_failed: "copy.couldnTReadCodexSignInRetry.5e8c59",
        };
        reportCodexTokenFailure(hint, messages[result?.error] || "copy.couldnTGetATokenRetryOr.129397", result?.error || 'codex_token_missing');
        return;
      }
      readingLocal = false;
      const saved = await window.notchAPI.setCodexToken(result.token);
      if (!saved?.ok) throw new Error(saved?.error || "save_failed");
      input.value = ""; renderCodexSettings(null, saved);
      window.NotchUi?.clearError('token:codex');
      pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (pomeLocaleRendererWorkspace.t("ui.token.savedPending")));
      hint.classList.add('success');
    } catch (error) {
      reportCodexTokenFailure(hint, error.message === "secure_storage_unavailable" ? "copy.systemSecureStorageIsUnavailableCanT.3a9217" : readingLocal ? "copy.couldnTReadCodexSignInRetry.5e8c59" : "copy.operationFailedTryAgain.825cfa", error.message);
    } finally {
      setCodexTokenBusy(false);
      pomeLocaleRendererWorkspace.bind(button, "textContent", () => (pomeLocaleRendererWorkspace.t("ui.token.acquire")));
    }
  });
  for (const action of ['save', 'clear']) {
    document.getElementById(`settings-codex-token-${action}`)?.addEventListener('click', async () => {
      const input = document.getElementById('settings-codex-token');
      const hint = document.getElementById('settings-codex-token-hint');
      hint.className = 'settings-cursor-token-hint';
      if (action === 'save' && !input.value.trim()) { hint.classList.add('error'); pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.enterATokenFirstOrClearThe.1b3ee0"))); return; }
      setCodexTokenBusy(true);
      try {
        const result = action === 'save' ? await window.notchAPI.setCodexToken(input.value) : await window.notchAPI.clearCodexToken();
        if (!result?.ok) throw new Error(result?.error);
        input.value = ''; renderCodexSettings(null, result);
        window.NotchUi?.clearError('token:codex');
        pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (action === 'save' ? pomeLocaleRendererWorkspace.t("copy.savedSecurelyQueryingLiveQuota.f4cf88") : pomeLocaleRendererWorkspace.t("copy.manualTokenCleared.03619f")));
        hint.classList.add('success');
      } catch (error) {
        reportCodexTokenFailure(hint, error.message === 'secure_storage_unavailable' ? "copy.systemSecureStorageIsUnavailableCanT.3a9217" : "copy.operationFailedTryAgain.825cfa", error.message || `${action}_failed`);
      } finally { setCodexTokenBusy(false); }
    });
  }

  async function refreshSettingsPanel() {
    if (!window.notchAPI) return;
    const generation = ++settingsRefreshGeneration;
    const revision = settingsAppSettingsRevision;
    const [appSettings, workspace, config, mirrorImage, cursorToken, codexUsage, codexToken] = await Promise.all([
      window.notchAPI.getAppSettings?.().catch(() => null),
      window.notchAPI.getWorkspace?.().catch(() => null),
      window.notchAPI.getTranscriptionConfig?.().catch(() => null),
      window.notchAPI.getMirrorImage?.().catch(() => null),
      window.notchAPI.getCursorTokenStatus?.().catch(() => null),
      window.notchAPI.getCodexUsage?.().catch(() => null),
      window.notchAPI.getCodexTokenStatus?.().catch(() => null),
    ]);
    if (generation !== settingsRefreshGeneration) return;
    // A settings broadcast is newer than reads already in flight.
    if (appSettings && revision === settingsAppSettingsRevision) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (config) {
      transcriptionConfig = config;
      updateTranscriptionConfigUi();
      updateRecordingUi();
    }
    if (cursorToken) settingsCursorTokenMeta = cursorToken;
    renderCodexSettings(codexUsage, codexToken);
    applySettingsMirrorCover(mirrorImage);
    renderSettingsPanel();
  }

  async function loadTranscriptionConfig() {
    if (!window.notchAPI || typeof window.notchAPI.getTranscriptionConfig !== 'function') return;
    try {
      const config = await window.notchAPI.getTranscriptionConfig();
      if (config) transcriptionConfig = config;
    } catch (error) {}
    updateTranscriptionConfigUi();
    updateRecordingUi();
    renderSettingsPanel();
  }

  let transcriptionSettingsTrigger = null;
  function openTranscriptionSettings() {
    transcriptionSettingsTrigger = document.activeElement;
    if (!transcriptionSettingsBackdrop) return;
    transcriptionSettingsBackdrop.hidden = false;
    transcriptionSettingsNote.classList.remove('error', 'success');
    pomeLocaleRendererWorkspace.bind(transcriptionSettingsNote, "textContent", () => (transcriptionConfig.asrNeedsReentry || transcriptionConfig.llmNeedsReentry
      ? pomeLocaleRendererWorkspace.t("copy.keysFromAnOlderVersionCouldNot.d775b1")
      : transcriptionConfig.configured || transcriptionConfig.llmConfigured
        ? pomeLocaleRendererWorkspace.t("copy.leaveConfiguredApiKeysBlankToKeep.fc984e")
        : pomeLocaleRendererWorkspace.t("ux.record.configHint")));
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    setTimeout(() => transcriptionApiKey?.focus(), 0);
  }

  function closeTranscriptionSettings() {
    if (transcriptionSettingsBackdrop) transcriptionSettingsBackdrop.hidden = true;
    transcriptionSettingsTrigger?.isConnected && transcriptionSettingsTrigger.focus({preventScroll:true});
  }

  async function saveTranscriptionSettings() {
    if (!window.notchAPI || !transcriptionSettingsSave) return;
    if (
      !transcriptionConfig.configured
      && !transcriptionApiKey.value.trim()
      && !transcriptionConfig.llmConfigured
      && !llmApiKey.value.trim()
    ) {
      transcriptionSettingsNote.classList.add('error');
      pomeLocaleRendererWorkspace.bind(transcriptionSettingsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.configureAtLeastOneApiKey.7b9f3f")));
      return;
    }
    transcriptionSettingsSave.disabled = true;
    transcriptionSettingsNote.classList.remove('error');
    pomeLocaleRendererWorkspace.bind(transcriptionSettingsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.savingSecurely.1af0c5")));
    let result;
    try {
      result = await window.notchAPI.setTranscriptionConfig({
        apiKey: transcriptionApiKey.value,
        region: transcriptionRegion.value,
        transcriptionLanguage: transcriptionLanguage.value,
        workspaceId: transcriptionWorkspace.value,
        llmApiKey: llmApiKey.value,
        llmBaseUrl: llmBaseUrl.value,
        llmModel: llmModel.value,
      });
    } catch (error) {
      result = { ok: false, error: 'save_failed' };
    }
    transcriptionSettingsSave.disabled = false;
    if (!result || !result.ok) {
      transcriptionSettingsNote.classList.add('error');
      pomeLocaleRendererWorkspace.bind(transcriptionSettingsNote, "textContent", () => (result && result.error === 'invalid_workspace'
        ? pomeLocaleRendererWorkspace.t("copy.invalidWorkspaceIdFormat.bdcbed")
        : result && result.error === 'invalid_llm_url'
          ? pomeLocaleRendererWorkspace.t("copy.theLanguageModelBaseUrlMustBe.ec5f24")
        : result && result.error === 'secure_storage_unavailable'
          ? pomeLocaleRendererWorkspace.t("copy.systemSecureStorageIsUnavailableYouCan.5d0cf1")
          : pomeLocaleRendererWorkspace.t("copy.couldnTSaveConfigurationTryAgain.4b6c65")));
      return;
    }
    transcriptionConfig = result;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.classList.add('success');
    pomeLocaleRendererWorkspace.bind(transcriptionSettingsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.savedSecurelyKeysAreNotDisplayedAs.345983")));
    pomeLocaleRendererWorkspace.bind(transcriptionSettingsSave, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.saved.1bd91a")));
    setTimeout(() => {
      if (transcriptionSettingsSave) pomeLocaleRendererWorkspace.bind(transcriptionSettingsSave, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.save.a3030b")));
    }, 1200);
    if (
      transcriptionConfig.configured
      && ['recording', 'paused'].includes(recordingStatus)
      && !transcriptionStartPromise
    ) {
      stopSpeechRecognition();
      transcriptionStatus = 'idle';
      transcriptionStartPromise = startCloudTranscription();
    }
    updateRecordingUi();
    renderSettingsPanel();
  }

  function persistRecordings() {
    saveJson(RECORDINGS_KEY, recordings.filter((recording) => !recording.isDraft));
  }

  function currentDuration() {
    return Domain.calculateRecordingDuration({
      startedAt: recordingStartedAt,
      status: recordingStatus,
      pausedAt,
      pausedTotalMs,
      now: Date.now(),
    });
  }

  function activeRecordingDraft() {
    return recordingDraftId && recordings.find((recording) => recording.id === recordingDraftId) || null;
  }

  function currentRecordingText() {
    return `${recordingTranscript} ${interimTranscript}`.trim();
  }

  function currentRecordingFeedback() {
    if (recordingStartTask.isPending()) return pomeLocaleRendererWorkspace.t("copy.waitingForMicrophonePermission.a87426");
    if (recordingCaptureIssue) return recordingCaptureIssue;
    if (recordingStatus === 'saving') return pomeLocaleRendererWorkspace.t("copy.savingRecording.f571d6");
    if (recordingStatus === 'paused') return pomeLocaleRendererWorkspace.t('ux.record.paused');
    if (transcriptionConfig.asrNeedsReentry) return pomeLocaleRendererWorkspace.t("copy.transcriptionKeyUnavailableConfigureTheApiKey.855d7e");
    if (transcriptionStatus === 'browser-error') return pomeLocaleRendererWorkspace.t("copy.transcriptionApiNotConfiguredAudioIsStill.52b6ff");
    if (transcriptionStatus === 'error') return pomeLocaleRendererWorkspace.t("copy.transcriptionConnectionFailedAudioIsStillRecording.7631f4");
    if (transcriptionStatus === 'reconnecting') return pomeLocaleRendererWorkspace.t("copy.transcriptionInterruptedReconnectingAudioIsStillRecording.1340ab");
    if (transcriptionStatus === 'connecting') return pomeLocaleRendererWorkspace.t("copy.connectingToTranscription.3dd686");
    if (transcriptionAudioGap) return pomeLocaleRendererWorkspace.t("copy.someTranscriptionMayBeMissingDuringDisconnection.6bc0df");
    if (recordingStatus === 'paused') return pomeLocaleRendererWorkspace.t("copy.recordingPaused.598133");
    if (!transcriptionConfig.configured && !currentRecordingText()) return pomeLocaleRendererWorkspace.t("copy.transcriptionApiNotConfiguredAudioWillStill.9992d7");
    return pomeLocaleRendererWorkspace.t("copy.recording.5254d3");
  }

  function beginRecordingDraft() {
    recordingDraftId = uid('recording');
    const draft = {
      ...Domain.createRecording({
        id: recordingDraftId,
        createdAt: recordingStartedAt,
        durationMs: 0,
        transcript: '',
      }),
      isDraft: true,
    };
    recordings.unshift(draft);
    selectedRecordingId = draft.id;
    recordingSelectionAnchor = draft.id;
    renderRecordings();
  }

  function discardRecordingDraft() {
    if (!recordingDraftId) return;
    recordings = recordings.filter((recording) => recording.id !== recordingDraftId);
    recordingSelection.delete(recordingDraftId);
    selectedRecordingId = recordings[0]?.id || '';
    recordingSelectionAnchor = selectedRecordingId || null;
    recordingDraftId = '';
    renderRecordings();
  }

  function syncRecordingDraftUi() {
    const draft = activeRecordingDraft();
    if (!draft) return;
    const durationMs = recordingStopDurationMs || currentDuration();
    const text = currentRecordingText();
    draft.durationMs = durationMs;
    draft.transcript = recordingTranscript;
    const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
    const preview = row?.querySelector('[data-recording-preview]');
    const meta = row?.querySelector('[data-recording-meta]');
    if (preview) preview.textContent = text || currentRecordingFeedback();
    if (meta) pomeLocaleRendererWorkspace.bind(meta, "textContent", () => (`${recordingStatus === 'saving' ? pomeLocaleRendererWorkspace.t("copy.saving.a1a172") : recordingStatus === 'paused' ? pomeLocaleRendererWorkspace.t("copy.paused.eb0c32") : pomeLocaleRendererWorkspace.t("copy.recording.e35a14")} · ${formatClock(durationMs)}`));
    if (selectedRecordingId !== draft.id) return;
    const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
    const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
    const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
    const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
    const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
    const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
    const detailPause = recordingDetail?.querySelector('.recording-live-pause');
    const detailStop = recordingDetail?.querySelector('.recording-live-stop');
    if (detailState) pomeLocaleRendererWorkspace.bind(detailState, "textContent", () => (recordingStatus === 'saving' ? pomeLocaleRendererWorkspace.t("copy.saving.570d60") : recordingStatus === 'paused' ? pomeLocaleRendererWorkspace.t("copy.paused.eb0c32") : pomeLocaleRendererWorkspace.t("copy.recording.5254d3")));
    if (detailDot) detailDot.dataset.state = recordingStatus;
    if (detailTime) detailTime.textContent = formatClock(durationMs);
    if (detailTranscript && detailTranscript.value !== text) detailTranscript.value = text;
    if (detailFeedback) detailFeedback.textContent = currentRecordingFeedback();
    const audioTitle = recordingDetail?.querySelector('[data-live-audio-title]');
    if (audioTitle) pomeLocaleRendererWorkspace.bind(audioTitle, 'textContent', () => pomeLocaleRendererWorkspace.t(recordingStatus === 'paused' ? 'ux.record.paused' : recordingStatus === 'saving' ? 'copy.saving.a1a172' : 'copy.audioIsRecordingLocally.ff0874'));
    if (detailTranscript) pomeLocaleRendererWorkspace.bind(detailTranscript, 'placeholder', () => pomeLocaleRendererWorkspace.t(transcriptionConfig.configured ? 'copy.startSpeakingToSeeTheTranscriptHere.833551' : 'ux.record.audioOnly'));
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      pomeLocaleRendererWorkspace.bind(detailPause, "textContent", () => (recordingStatus === 'paused' ? pomeLocaleRendererWorkspace.t("copy.resume.7c9691") : pomeLocaleRendererWorkspace.t("copy.pause.8d12fc")));
      detailPause.disabled = recordingStatus === 'saving';
    }
    if (detailStop) detailStop.disabled = recordingStatus === 'saving';
  }

  function stopTranscriptionAudioPipeline() {
    if (transcriptionAudioProcessor) {
      transcriptionAudioProcessor.onaudioprocess = null;
      try { transcriptionAudioProcessor.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioSource) {
      try { transcriptionAudioSource.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioMute) {
      try { transcriptionAudioMute.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioContext) transcriptionAudioContext.close().catch(() => {});
    transcriptionAudioContext = null;
    transcriptionAudioSource = null;
    transcriptionAudioProcessor = null;
    transcriptionAudioMute = null;
  }

  function sendTranscriptionPcm(buffer) {
    if (!buffer || !buffer.byteLength || !window.notchAPI) return;
    if (['connecting', 'connected', 'reconnecting'].includes(transcriptionStatus)) {
      window.notchAPI.sendTranscriptionAudio(buffer);
    }
  }

  function startTranscriptionAudioPipeline(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream) return false;
    try {
      transcriptionAudioContext = new AudioContext({ sampleRate: 16000 });
      transcriptionAudioSource = transcriptionAudioContext.createMediaStreamSource(stream);
      transcriptionAudioProcessor = transcriptionAudioContext.createScriptProcessor(4096, 1, 1);
      transcriptionAudioMute = transcriptionAudioContext.createGain();
      transcriptionAudioMute.gain.value = 0;
      transcriptionAudioProcessor.onaudioprocess = (event) => {
        if (recordingStatus !== 'recording') return;
        const source = event.inputBuffer.getChannelData(0);
        const pcm = Domain.resampleFloat32ToPcm16(source, transcriptionAudioContext.sampleRate, 16000);
        sendTranscriptionPcm(pcm.buffer);
      };
      transcriptionAudioSource.connect(transcriptionAudioProcessor);
      transcriptionAudioProcessor.connect(transcriptionAudioMute);
      transcriptionAudioMute.connect(transcriptionAudioContext.destination);
      return true;
    } catch (error) {
      stopTranscriptionAudioPipeline();
      return false;
    }
  }

  async function startCloudTranscription() {
    if (!transcriptionConfig.configured || !window.notchAPI || !mediaStream) return { ok: false, error: 'not_configured' };
    transcriptionStatus = 'connecting';
    startTranscriptionAudioPipeline(mediaStream);
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.startTranscription(activeRecognitionLanguage === 'en-US' ? 'en' : 'zh');
    } catch (error) {
      result = { ok: false, error: 'connection_failed' };
    }
    if (recordingStatus !== 'recording' && recordingStatus !== 'paused') return result;
    if (!result || !result.ok) {
      transcriptionStatus = 'error';
      stopTranscriptionAudioPipeline();
      updateRecordingUi();
      return result || { ok: false };
    }
    if (transcriptionStatus === 'connecting') transcriptionStatus = 'connected';
    updateRecordingUi();
    return result;
  }

  async function finishCloudTranscription() {
    if (!transcriptionStartPromise) return { ok: false, error: 'not_active', transcript: recordingTranscript };
    stopTranscriptionAudioPipeline();
    // Send finish immediately: waiting for a reconnect here could block saving for a minute.
    transcriptionStartPromise = null;
    transcriptionStatus = 'finishing';
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.finishTranscription();
    } catch (error) {
      result = { ok: false, error: 'finish_failed', transcript: currentRecordingText() };
    }
    recordingTranscript = result?.transcript || currentRecordingText();
    transcriptionStatus = result && result.ok ? 'idle' : 'error';
    interimTranscript = '';
    updateRecordingUi();
    return result;
  }

  if (window.notchAPI && typeof window.notchAPI.onTranscriptionEvent === 'function') {
    window.notchAPI.onTranscriptionEvent((event) => {
      if (!event || !['recording', 'paused', 'saving'].includes(recordingStatus)) return;
      if (event.type === 'transcript') {
        recordingTranscript = String(event.final || '').trim();
        interimTranscript = String(event.interim || '').trim();
      } else if (event.type === 'error') {
        transcriptionStatus = 'error';
      } else if (event.type === 'status' && ['connected', 'reconnecting'].includes(event.status)) {
        if (transcriptionStatus !== 'finishing') transcriptionStatus = event.status;
      } else if (event.type === 'warning' && event.code === 'audio_gap') {
        transcriptionAudioGap = true;
      }
      updateRecordingUi();
    });
  }

  function updateRecordingUi() {
    const recordingActive = isRecordingActive();
    const recordingBusy = isRecordingBusy();
    const visualState = recordingStartTask.isPending() ? 'requesting' : recordingStatus;
    if (homeRecorder) homeRecorder.dataset.state = visualState;
    if (recordingDot) recordingDot.dataset.state = visualState;
    if (recordingStateLabel) {
      pomeLocaleRendererWorkspace.bind(recordingStateLabel, "textContent", () => (recordingStartTask.isPending()
        ? pomeLocaleRendererWorkspace.t("copy.waitingForRecordingPermission.c1cf11")
        : recordingStatus === 'recording'
        ? pomeLocaleRendererWorkspace.t("copy.recording.5254d3")
        : recordingStatus === 'paused'
          ? pomeLocaleRendererWorkspace.t("copy.paused.eb0c32")
          : recordingStatus === 'saving'
            ? pomeLocaleRendererWorkspace.t("copy.saving.570d60")
            : pomeLocaleRendererWorkspace.t("copy.quickRecording.bd31b8")));
    }
    if (recordingTime) recordingTime.textContent = formatClock(recordingActive ? currentDuration() : 0);
    if (recordStart) recordStart.disabled = recordingBusy;
    if (recordPause) {
      recordPause.disabled = !['recording', 'paused'].includes(recordingStatus);
      recordPause.setAttribute('aria-label', recordingStatus === 'paused' ? pomeLocaleRendererWorkspace.t("copy.resumeRecording.dc6dd7") : pomeLocaleRendererWorkspace.t("copy.pauseRecording.5912e7"));
      recordPause.classList.toggle('resume', recordingStatus === 'paused');
    }
    if (recordStop) recordStop.disabled = !['recording', 'paused'].includes(recordingStatus);
    if (recordingNew) {
      recordingNew.disabled = recordingBusy;
      pomeLocaleRendererWorkspace.bind(recordingNew, "textContent", () => (recordingBusy ? pomeLocaleRendererWorkspace.t("copy.recordings.4b6ef7") : pomeLocaleRendererWorkspace.t("copy.recording.ef2821")));
      recordingNew.setAttribute('aria-label', recordingStartTask.isPending()
        ? pomeLocaleRendererWorkspace.t("copy.requestingMicrophonePermission.e88281")
        : recordingActive ? pomeLocaleRendererWorkspace.t("copy.recordingInProgress.d548e4") : pomeLocaleRendererWorkspace.t("copy.startRecording.ee9247"));
    }
    if (liveTranscript && recordingBusy) {
      const text = currentRecordingText();
      // asrNeedsReentry = 密文还在但当前应用解不开它。safeStorage 的密钥存在钥匙串里、
      // ACL 绑代码签名，所以开发版存的 Key 装成 DMG 后就读不出来（ad-hoc 签名每次打包
      // 都会换 cdhash，也是同样的结果）。这种情况下录音正常、只有转写不工作，
      // 原来只在设置面板里提示一行，录音的人看不到，表现就是「能录但不转写」。
      const fallback = currentRecordingFeedback();
      const needsAttention = recordingCaptureIssue || transcriptionAudioGap
        || ['error', 'reconnecting', 'connecting', 'browser-error'].includes(transcriptionStatus);
      liveTranscript.textContent = needsAttention && text ? `${fallback}\n${text}` : text || fallback;
      liveTranscript.hidden = !(text || fallback);
    }
    syncRecordingDraftUi();
    renderHomeModuleSettings();
    document.dispatchEvent(new CustomEvent('notch:recording-state-changed', {
      detail: { active: recordingBusy },
    }));
  }

  function stopSpeechRecognition() {
    const recognition = speechRecognition;
    speechRecognition = null;
    if (recognition) {
      try { recognition.stop(); } catch (error) {}
    }
    interimTranscript = '';
  }

  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      transcriptionStatus = 'browser-error';
      updateRecordingUi();
      return;
    }
    if (speechRecognitionBlocked || recordingStatus !== 'recording') return;
    const recognition = new SpeechRecognition();
    recognition.lang = activeRecognitionLanguage;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      interimTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0] && event.results[index][0].transcript || '').trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          recordingTranscript = `${recordingTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }
      updateRecordingUi();
    };
    recognition.onerror = (event) => {
      interimTranscript = '';
      speechRecognitionError = String(event && event.error || 'unknown');
      if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(speechRecognitionError)) {
        speechRecognitionBlocked = true;
        transcriptionStatus = 'browser-error';
      }
      updateRecordingUi();
    };
    recognition.onend = () => {
      if (speechRecognition !== recognition) return;
      speechRecognition = null;
      if (recordingStatus === 'recording' && !speechRecognitionBlocked) setTimeout(startSpeechRecognition, 180);
    };
    speechRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      speechRecognition = null;
    }
  }

  function stopMediaTracks() {
    stopRecordingStrands();
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function chooseRecordingMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }

  async function finalizeRecording(blob, durationMs) {
    recordingStatus = 'saving';
    updateRecordingUi();
    if (!blob || blob.size === 0) {
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      if (liveTranscript) {
        pomeLocaleRendererWorkspace.bind(liveTranscript, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.recordingIsEmptyCheckMicrophoneInput.07d37a")));
        liveTranscript.hidden = false;
      }
      updateRecordingUi();
      return;
    }
    let saved;
    try {
      saved = window.notchAPI && await window.notchAPI.saveRecording({
        bytes: await blob.arrayBuffer(),
        mimeType: blob.type || 'audio/webm',
      });
    } catch (error) {
      saved = null;
    }
    if (saved && saved.ok) {
      const draft = activeRecordingDraft();
      const recording = Domain.createRecording({
        id: draft?.id || uid('recording'),
        createdAt: draft?.createdAt || Date.now(),
        durationMs,
        transcript: recordingTranscript,
        audioPath: saved.audioPath,
        mimeType: saved.mimeType || blob.type,
      });
      const draftIndex = recordings.findIndex((item) => item.id === recording.id);
      if (draftIndex >= 0) recordings.splice(draftIndex, 1, recording);
      else recordings.unshift(recording);
      recordingDraftId = '';
      selectedRecordingId = recording.id;
      persistRecordings();
      renderRecordings();
      if (recording.transcript && window.notchAPI?.organizeMaterial) {
        window.notchAPI.organizeMaterial({ kind: 'recording', text: recording.transcript }).then((metadata) => {
          const target = recordings.find((item) => item.id === recording.id);
          if (!target || !metadata || !metadata.ok) return;
          target.title = metadata.title || target.title;
          target.category = metadata.category || target.category;
          persistRecordings();
          renderRecordings();
        }).catch(() => {});
      }
      if (liveTranscript) {
        pomeLocaleRendererWorkspace.bind(liveTranscript, "textContent", () => (recording.transcript || (transcriptionConfig.configured
          ? pomeLocaleRendererWorkspace.t("copy.recordingSavedNoTranscriptYet.3c475e")
          : pomeLocaleRendererWorkspace.t("copy.recordingSavedConfigureTheTranscriptionApi.cd1e4e"))));
        liveTranscript.hidden = false;
      }
      if (typeof showStatusToast === 'function') {
        showStatusToast(pomeLocaleRendererWorkspace.t('copy.recordingSaved.7e91c2'), {
          messageKey: 'copy.recordingSaved.7e91c2',
          actionLabelKey: 'ux.recordings.view',
          onAction: () => {
            if (recordings.some(item => item.id === recording.id)) {
              selectedRecordingId = recording.id;
              renderRecordings();
            }
            void setActiveTab('recordings');
          },
          duration: 4200,
        });
      }
    } else {
      discardRecordingDraft();
      if (liveTranscript) {
        pomeLocaleRendererWorkspace.bind(liveTranscript, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.couldnTSaveRecordingCheckLocalStorage.5dffb3")));
        liveTranscript.hidden = false;
      }
    }
    recordingStatus = 'idle';
    recordingStartedAt = 0;
    pausedAt = 0;
    pausedTotalMs = 0;
    audioChunks = [];
    recordingTranscript = '';
    interimTranscript = '';
    recordingCaptureIssue = '';
    updateRecordingUi();
  }

  // 麦克风被系统挡住时给出可点的出路（P3-2）：Windows 没有授权弹窗，
  // 用户必须自己去「隐私和安全性 → 麦克风」把「允许应用访问麦克风」打开。
  // 这段文案与按钮标题由能力层给，渲染层不判断平台。
  async function showMicrophonePermissionHint() {
    const prompt = (await window.notchAPI?.getMediaAccessStatus?.('microphone')?.catch(() => null))
      || { message: pomeLocaleRendererWorkspace.t("copy.canTAccessTheMicrophoneAllowAccess.9be108"), canOpenSettings: false };
    window.NotchUi?.showError?.({ message: prompt.message, messageKey: 'copy.canTAccessTheMicrophoneAllowAccess.9be108',
      diagnostic: `Recording: microphone_${prompt.status || 'denied'}`, scope: 'recording:capture',
      ...(prompt.canOpenSettings ? { repairActionKey: 'copy.openSettings.93112c', onRepair: () => window.notchAPI?.openPrivacySettings?.(prompt.pane) } : { onRepair: startRecording }) });
    if (!liveTranscript) return;
    liveTranscript.replaceChildren();
    liveTranscript.append(prompt.message);
    if (prompt.canOpenSettings) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'transcript-permission-open';
      action.textContent = prompt.actionLabel;
      action.addEventListener('click', () => window.notchAPI?.openPrivacySettings?.(prompt.pane));
      liveTranscript.append(action);
    }
    liveTranscript.hidden = false;
  }

  async function requestRecordingStream() {
    const preferred = {
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      // Some devices reject processing constraints as NotFound/Overconstrained.
      // Retry once with a plain audio track before treating it as a missing mic.
      if (!['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) throw error;
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  function recordingCaptureFailure(error) {
    const name = String(error?.name || error?.message || 'capture_failed');
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'audio_track_unavailable') {
      return {
        messageKey: 'copy.noMicrophoneDeviceFound.a4c8e1',
        diagnostic: 'Recording: no_microphone_device',
        openSettings: true,
      };
    }
    if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
      return {
        messageKey: 'copy.noMicrophoneInputCheckTheSystemAudio.ef1c9a',
        diagnostic: `Recording: microphone_busy (${name})`,
        openSettings: true,
      };
    }
    return {
      messageKey: 'copy.couldnTStartRecordingCheckTheMicrophone.8c52b6',
      diagnostic: `Recording: ${name}`,
      openSettings: false,
    };
  }

  async function reportRecordingCaptureFailure(error) {
    const failure = recordingCaptureFailure(error);
    const prompt = failure.openSettings
      ? (await window.notchAPI?.getMediaAccessStatus?.('microphone')?.catch(() => null))
      : null;
    window.NotchUi?.showError?.({
      messageKey: failure.messageKey,
      diagnostic: failure.diagnostic,
      scope: 'recording:capture',
      ...(prompt?.canOpenSettings
        ? { repairActionKey: 'copy.openSettings.93112c', onRepair: () => window.notchAPI?.openPrivacySettings?.(prompt.pane || 'microphone') }
        : { onRepair: startRecording }),
    });
    if (liveTranscript) {
      pomeLocaleRendererWorkspace.bind(liveTranscript, 'textContent', () => pomeLocaleRendererWorkspace.t(failure.messageKey));
      liveTranscript.hidden = false;
    }
  }

  async function startRecordingAttempt() {
    if (recordingStatus !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      await reportRecordingCaptureFailure({ name: 'media_capture_unavailable' });
      return;
    }
    activeRecognitionLanguage = transcriptionConfig.transcriptionLanguage === 'en' ? 'en-US' : 'zh-CN';
    try {
      if (window.notchAPI?.ensureMicrophone && !(await window.notchAPI.ensureMicrophone())) {
        await showMicrophonePermissionHint();
        return;
      }
      mediaStream = await requestRecordingStream();
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') throw Object.assign(new Error('audio_track_unavailable'), { name: 'audio_track_unavailable' });
      recordingCaptureIssue = '';
      audioTrack.addEventListener('mute', () => {
        if (!['recording', 'paused'].includes(recordingStatus)) return;
        recordingCaptureIssue = pomeLocaleRendererWorkspace.t("copy.noMicrophoneInputCheckTheSystemAudio.ef1c9a");
        updateRecordingUi();
      });
      audioTrack.addEventListener('unmute', () => {
        recordingCaptureIssue = '';
        updateRecordingUi();
      });
      startRecordingStrands(mediaStream);
      const mimeType = chooseRecordingMimeType();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      audioChunks = [];
      recordingTranscript = '';
      interimTranscript = '';
      speechRecognitionBlocked = false;
      speechRecognitionError = '';
      recordingStartedAt = Date.now();
      recordingStopDurationMs = 0;
      pausedTotalMs = 0;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) audioChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        recordingCaptureIssue = pomeLocaleRendererWorkspace.t("copy.recordingInterruptedStartAgain.64de84");
        updateRecordingUi();
      };
      mediaRecorder.onstop = async () => {
        const durationMs = recordingStopDurationMs || currentDuration();
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
        stopMediaTracks();
        if (transcriptionFinishPromise) {
          await transcriptionFinishPromise;
          transcriptionFinishPromise = null;
        }
        finalizeRecording(blob, durationMs);
      };
      mediaRecorder.start(1000);
      window.NotchUi?.clearError?.('recording:capture');
      recordingStatus = 'recording';
      transcriptionStatus = 'idle';
      transcriptionAudioGap = false;
      transcriptionStartPromise = null;
      transcriptionFinishPromise = null;
      beginRecordingDraft();
      if (transcriptionConfig.configured) {
        transcriptionStartPromise = startCloudTranscription();
      } else {
        startSpeechRecognition();
      }
      clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingUi, 500);
      updateRecordingUi();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      if (denied) await showMicrophonePermissionHint();
      else await reportRecordingCaptureFailure(error);
      // The exclusive task refreshes controls after clearing its pending flag.
      // Refreshing here would overwrite this error with "waiting for permission".
    }
  }

  function startRecording() {
    return recordingStartTask.run(startRecordingAttempt);
  }

  function togglePauseRecording() {
    if (!mediaRecorder) return;
    if (recordingStatus === 'recording') {
      mediaRecorder.pause();
      pausedAt = Date.now();
      recordingStatus = 'paused';
      if (!transcriptionConfig.configured) stopSpeechRecognition();
    } else if (recordingStatus === 'paused') {
      pausedTotalMs += Date.now() - pausedAt;
      pausedAt = 0;
      mediaRecorder.resume();
      recordingStatus = 'recording';
      if (!transcriptionConfig.configured) startSpeechRecognition();
    }
    updateRecordingUi();
  }

  function stopRecording() {
    if (!mediaRecorder || !['recording', 'paused'].includes(recordingStatus)) return;
    recordingStopDurationMs = currentDuration();
    recordingStatus = 'saving';
    if (!transcriptionConfig.configured) stopSpeechRecognition();
    transcriptionFinishPromise = transcriptionStartPromise
      ? finishCloudTranscription()
      : Promise.resolve({ ok: false, error: 'not_active', transcript: recordingTranscript });
    clearInterval(recordingTimer);
    recordingTimer = null;
    updateRecordingUi();
    try {
      mediaRecorder.stop();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      discardRecordingDraft();
      updateRecordingUi();
    }
  }

  if (recordStart) recordStart.addEventListener('click', startRecording);
  if (recordPause) recordPause.addEventListener('click', togglePauseRecording);
  if (recordStop) recordStop.addEventListener('click', stopRecording);
  if (recordingNew) recordingNew.addEventListener('click', startRecording);
  if (recordingConfigure) recordingConfigure.addEventListener('click', openTranscriptionSettings);

  function setCursorTokenHint(messageKey, kind = '', { code = 'operation_failed', inline = false } = {}) {
    if (!settingsCursorTokenHint) return;
    pomeLocaleRendererWorkspace.bind(settingsCursorTokenHint, 'textContent', () => messageKey ? pomeLocaleRendererWorkspace.t(messageKey) : '');
    settingsCursorTokenHint.classList.toggle('error', kind === 'error');
    settingsCursorTokenHint.classList.toggle('success', kind === 'success');
    settingsCursorTokenHint.classList.toggle('warning', kind === 'warning');
    if (kind === 'error' && !inline) window.NotchUi?.showError({ messageKey, diagnostic: `Cursor: ${code}`, scope: 'token:cursor', inlineHint: settingsCursorTokenHint, onRepair: () => window.NotchAiSources?.openSettings('cursor') });
    else if (kind === 'success') window.NotchUi?.clearError('token:cursor');
  }

  function paintNasHint(el, message, kind = '') {
    if (!el) return;
    pomeLocaleRendererWorkspace.bind(el, 'textContent', () => pomeLocaleRendererWorkspace.systemText(message || ''));
    el.dataset.kind = kind || '';
  }

  // Failures use the shared error surface; inline hints remain for progress,
  // success and as a fallback when that surface is unavailable.
  function setNasSyncHint(message, kind = '', { messageKey = 'ui.error.nas', code = 'operation_failed' } = {}) {
    paintNasHint(settingsNasSyncHint, message, kind);
    if (kind === 'error') window.NotchUi?.showError({ messageKey, repairKey: 'ui.error.nasRepair', diagnostic: `NAS: ${code}\n${message}`, scope: 'nas', inlineHint: settingsNasSyncHint, onRepair: () => { document.getElementById('ui-nas-troubleshoot').open = true; settingsNasSyncBaseUrl?.focus(); } });
    else if (kind === 'success') window.NotchUi?.clearError('nas');
  }

  function setNasStatusHint(message, kind = '') {
    paintNasHint(settingsNasStatusHint, message, kind);
  }

  function setNasEndpointHint(message, kind = '') {
    paintNasHint(settingsNasEndpointHint, message, kind);
  }

  function describeNasSyncError(result, fallback) {
    if (window.NasSyncSettings && typeof window.NasSyncSettings.humanizeSyncError === 'function') {
      return window.NasSyncSettings.humanizeSyncError(result, fallback);
    }
    return fallback;
  }

  function applyNasPairUi(action) {
    if (!window.NasSyncPair || typeof window.NasSyncPair.reducePairUi !== 'function') return;
    const previousSchemaError = nasPairUi.status?.schemaIncompatible ? nasPairUi.error : '';
    nasPairUi = window.NasSyncPair.reducePairUi(nasPairUi, action);
    if (action.type === 'set_status' && !action.status?.schemaIncompatible && previousSchemaError) {
      if (nasPairUi.error === previousSchemaError) nasPairUi = { ...nasPairUi, error: '' };
      if (settingsNasStatusHint?.textContent === previousSchemaError) setNasStatusHint('');
      if (settingsNasSyncHint?.textContent === previousSchemaError) setNasSyncHint('');
    }
    renderNasSyncPanel();
  }

  function applyNasSettingsUi(action) {
    if (!window.NasSyncSettings || typeof window.NasSyncSettings.reduceSettingsUi !== 'function') return;
    nasSettingsUi = window.NasSyncSettings.reduceSettingsUi(nasSettingsUi, action);
    renderNasSyncPanel();
  }

  function renderNasBoundChrome() {
    const bound = Boolean(nasPairUi.bound);
    const paused = Boolean(nasSettingsUi.recovery?.paused || nasPairUi.status?.recovery?.paused);
    const migrating = Boolean(nasMigrationUi.readonly || nasSettingsUi.uiState === 'migrating');
    const busy = nasSettingsUi.busy || nasPairUi.submitting || migrating;
    if (settingsNasStatusMeta) settingsNasStatusMeta.hidden = !bound;
    if (settingsNasSyncOpen) {
      settingsNasSyncOpen.hidden = false;
      settingsNasSyncOpen.disabled = !bound || busy || paused || nasSettingsUi.schemaIncompatible;
      pomeLocaleRendererWorkspace.bind(settingsNasSyncOpen, "title", () => (!bound ? pomeLocaleRendererWorkspace.t("copy.pairThisDeviceBeforeSyncing.5b7d9c") : paused ? pomeLocaleRendererWorkspace.t("copy.syncPaused.b6b537") : ''));
    }
    if (settingsNasSyncRetry) {
      settingsNasSyncRetry.hidden = !bound;
      settingsNasSyncRetry.disabled = !bound || paused || migrating || nasSettingsUi.retryEnabled === false || busy;
    }
    if (settingsNasOutboxCount) settingsNasOutboxCount.textContent = bound ? String(nasSettingsUi.outboxCount || 0) : '0';
    document.getElementById('settings-nas-pending-wrap').hidden = !bound || !nasSettingsUi.outboxCount;
    const lastAt = nasSettingsUi.view?.lastSuccessAt || nasPairUi.status?.lastSuccessAt;
    const lastTime = lastAt ? new Date(lastAt) : null;
    const hasLastTime = bound && lastTime && Number.isFinite(lastTime.getTime());
    if (settingsNasLastSync) {
      settingsNasLastSync.textContent = hasLastTime ? lastTime.toLocaleTimeString(pomeLocaleRendererWorkspace.getState().formatLocale, { hour:'2-digit', minute:'2-digit' }) : '—';
      settingsNasLastSync.title = hasLastTime ? lastTime.toLocaleString(pomeLocaleRendererWorkspace.getState().formatLocale) : '';
    }
    document.getElementById('settings-nas-last-sync-wrap').hidden = !hasLastTime;
    document.getElementById('settings-nas-recovery').hidden = !paused;
    document.getElementById('settings-nas-recovery').disabled = !bound || busy;
    document.getElementById('settings-nas-rollback').hidden = !nasSettingsUi.recovery?.completedAt;
    document.getElementById('settings-nas-rollback').disabled = !bound || busy;
    document.getElementById('settings-nas-secret-hint').hidden = !paused;
    document.getElementById('settings-nas-migration-banner').hidden = !(nasMigrationUi.bannerVisible || migrating);
    pomeLocaleRendererWorkspace.bind(document.getElementById('settings-nas-migration-banner'), "textContent", () => (nasMigrationUi.bannerText || pomeLocaleRendererWorkspace.t("copy.migratingPleaseWait.7aed12")));
    const failed = nasMigrationUi.phase === 'failed' || nasSettingsUi.uiState === 'migration_failed';
    if (settingsNasMigrationActions) settingsNasMigrationActions.hidden = !bound || !(failed || nasMigrationUi.lastMigrationId);
    if (settingsNasMigrationRetry) settingsNasMigrationRetry.hidden = !failed;
    if (settingsNasMigrationRestore) settingsNasMigrationRestore.hidden = !(failed || nasMigrationUi.lastMigrationId);
  }

  function renderNasEndpoints() {
    const view = nasSettingsUi.view;
    const endpoints = view?.endpoints || [];
    const connection = window.NasSyncSettings.connectionEndpoints(view, nasPairUi.status);
    renderNasBoundChrome();
    if (settingsNasSyncBaseUrl) {
      settingsNasSyncBaseUrl.readOnly = Boolean(nasPairUi.bound);
      if (nasPairUi.bound || !settingsNasSyncBaseUrl.value) settingsNasSyncBaseUrl.value = connection.baseUrl;
    }
    if (settingsNasEndpointUrl && !nasBackupDraftDirty && document.activeElement !== settingsNasEndpointUrl) {
      settingsNasEndpointUrl.value = connection.backup?.baseUrl || '';
    }
    if (settingsNasEndpointAdd) settingsNasEndpointAdd.disabled = !nasPairUi.bound || nasSettingsUi.busy;
    if (settingsNasHttpWarning) settingsNasHttpWarning.hidden = !nasSettingsUi.insecureWarningVisible;
    if (settingsNasDevicePortGuide) settingsNasDevicePortGuide.hidden = !nasSettingsUi.devicePortGuidanceVisible;
    if (!settingsNasEndpointList) return;
    settingsNasEndpointList.replaceChildren();
    // Keep HTTP permission controls for every saved address, including legacy
    // endpoints. The address editor itself presents only one optional backup.
    for (const ep of endpoints) {
      let url; try { url = new URL(ep.baseUrl); } catch { continue; }
      if (url.protocol !== 'http:' || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) continue;
      const label = document.createElement('label'); label.className = 'settings-nas-http-toggle settings-feature-grid';
      label.dataset.controlId = 'endpoint.allowInsecureHttp';
      const copy = document.createElement('span');
      const title = document.createElement('b'); pomeLocaleRendererWorkspace.bind(title, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.allowUnencryptedHttpInsecure.324adf")));
      const address = document.createElement('small'); address.textContent = ep.baseUrl;
      copy.append(title, address);
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.nasHttpToggle = ep.endpointId;
      input.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.allowUnencryptedHttp.2a5751")); input.checked = Boolean(ep.allowInsecureHttp); input.disabled = nasSettingsUi.busy;
      const decoration = document.createElement('i'); decoration.setAttribute('aria-hidden', 'true');
      label.append(copy, input, decoration); settingsNasEndpointList.append(label);
    }
  }

  function renderNasContentResults() {
    const root = document.getElementById('settings-nas-content-results'); root.replaceChildren();
    for (const row of window.NasSyncSettings.contentResultRows(nasSettingsUi.contentResults, nasPairUi.bound)) {
      const item = document.createElement('div'); item.className = 'settings-nas-content-row'; item.dataset.contentType = row.name;
      const name = document.createElement('strong'); name.textContent = row.name;
      const message = document.createElement('span'); message.textContent = row.message;
      const time = document.createElement('time'); time.textContent = `· ${row.time}`;
      if (row.at) { time.dateTime = new Date(row.at).toISOString(); time.title = new Date(row.at).toLocaleString(pomeLocaleRendererWorkspace.getState().formatLocale); }
      item.append(name, message, time); root.append(item);
    }
  }

  function renderNasSyncPanel() {
    const status = nasPairUi.status;
    const bound = Boolean(status && status.bound);
    const uiState = nasSettingsUi.uiState;
    const schemaIncompatible = Boolean(
      (status && status.schemaIncompatible)
      || uiState === 'schema_incompatible'
      || nasSettingsUi.schemaIncompatible,
    );
    const hardError = schemaIncompatible
      || uiState === 'certificate_error'
      || uiState === 'migration_failed'
      || uiState === 'endpoint_disabled';
    const lostToken = window.NasSyncSettings
      && typeof window.NasSyncSettings.shouldPromptLostDeviceToken === 'function'
      && window.NasSyncSettings.shouldPromptLostDeviceToken({
        bound,
        schemaIncompatible,
        endpoints: nasSettingsUi.view && nasSettingsUi.view.endpoints,
      });
    const lostTokenCopy = pomeLocaleRendererWorkspace.systemText((window.NasSyncSettings && window.NasSyncSettings.LOST_DEVICE_TOKEN_HINT)
      || pomeLocaleRendererWorkspace.t("copy.thisDeviceHasASavedSyncAddress.fc3a23"));
    if (settingsNasSyncStatus) {
      const paused = Boolean(nasSettingsUi.recovery?.paused || status?.recovery?.paused);
      if (nasPairUi.submitting) {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.pairing.f55f93")));
        settingsNasSyncStatus.dataset.state = 'syncing';
      } else if (paused) {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.syncPaused.b6b537")));
        settingsNasSyncStatus.dataset.state = 'warning';
      } else if (nasMigrationUi.readonly || uiState === 'migrating') {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.migratingPleaseWait.7aed12")));
        settingsNasSyncStatus.dataset.state = 'syncing';
      } else if (hardError || uiState === 'needs_reauth') {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (pomeLocaleRendererWorkspace.systemText(nasSettingsUi.uiLabel) || pomeLocaleRendererWorkspace.t("copy.failed.01ad2b")));
        settingsNasSyncStatus.dataset.state = hardError ? 'error' : 'warning';
      } else if (lostToken) {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.failed.01ad2b")));
        settingsNasSyncStatus.dataset.state = 'error';
      } else if (!bound) {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.notPaired.af18b2")));
        settingsNasSyncStatus.dataset.state = 'empty';
      } else {
        pomeLocaleRendererWorkspace.bind(settingsNasSyncStatus, "textContent", () => (nasSettingsUi.uiState === 'unbound' ? pomeLocaleRendererWorkspace.t("copy.paired.841d07") : pomeLocaleRendererWorkspace.systemText(nasSettingsUi.uiLabel) || pomeLocaleRendererWorkspace.t("copy.paired.841d07")));
        settingsNasSyncStatus.dataset.state = uiState === 'offline_pending' ? 'warning' : uiState === 'syncing' ? 'syncing' : status?.insecureBound ? 'insecure' : 'bound';
      }
      if (schemaIncompatible) {
        const schemaMessage = status?.schemaMessage || nasSettingsUi.schemaMessage;
        if (schemaMessage) {
          setNasStatusHint(schemaMessage, 'error');
          settingsNasStatusHint.dataset.schemaHint = schemaMessage;
        }
      } else {
        if (settingsNasStatusHint?.dataset.schemaHint) {
          if (settingsNasStatusHint.textContent === settingsNasStatusHint.dataset.schemaHint) setNasStatusHint('');
          delete settingsNasStatusHint.dataset.schemaHint;
        }
        if (nasSettingsUi.view?.lastError && settingsNasStatusHint?.dataset.kind !== 'error') {
          setNasStatusHint(describeNasSyncError({ error: nasSettingsUi.view.lastError.code, message: nasSettingsUi.view.lastError.message }, pomeLocaleRendererWorkspace.t("copy.operationFailed.0c3b4c")), 'error');
        }
      }
    }
    const statusHint = settingsNasStatusHint ? settingsNasStatusHint.textContent : '';
    if (lostToken) {
      setNasStatusHint(lostTokenCopy, 'warning');
    } else if (statusHint === lostTokenCopy) {
      setNasStatusHint('', '');
    }
    // Submit reports failures once. A status repaint must not reopen a dismissed
    // error or replace a newer error from a different operation.
    document.getElementById('settings-nas-pair-fields').hidden = bound;
    if (settingsNasPairReauth) settingsNasPairReauth.hidden = !bound;
    if (settingsNasPairSubmit) {
      settingsNasPairSubmit.disabled = Boolean(nasPairUi.submitting) || bound;
      pomeLocaleRendererWorkspace.bind(settingsNasPairSubmit, "textContent", () => (nasPairUi.submitting ? pomeLocaleRendererWorkspace.t("copy.pairing.f55f93") : lostToken ? pomeLocaleRendererWorkspace.t("copy.pairAgain.206b73") : pomeLocaleRendererWorkspace.t("copy.pair.7c5cc4")));
    }
    if (settingsNasPairCode) {
      settingsNasPairCode.disabled = Boolean(nasPairUi.submitting) || bound;
      if (document.activeElement !== settingsNasPairCode) {
        settingsNasPairCode.value = nasPairUi.code || settingsNasPairCode.value;
      }
    }
    renderNasEndpoints();
    renderNasContentResults();
    const errorCode = (nasPairUi.error && nasPairUi.errorCode) || nasSettingsUi.view?.lastError?.code || '';
    const connectionError = uiState === 'offline_pending' || /timeout|network|fetch_failed|econn|offline/i.test(errorCode);
    const brief = { bound, paused: Boolean(nasSettingsUi.recovery?.paused || status?.recovery?.paused),
      busy: Boolean(nasSettingsUi.busy || nasPairUi.submitting || nasMigrationUi.readonly),
      needsAttention: Boolean(hardError || lostToken || uiState === 'needs_reauth' || !connectionError && (nasPairUi.error || nasSettingsUi.view?.lastError)),
      offline: connectionError, code: errorCode || uiState };
    window.__pomeNasUi = brief; window.NotchUi?.renderNas(brief);
  }

  function openNasSyncOptions() {
    if (!settingsNasSyncOptions) return;
    settingsNasSyncOptions.hidden = false;
  }

  function closeNasSyncOptions() {
    if (settingsNasSyncOptions) settingsNasSyncOptions.hidden = true;
  }

  function openNasDialog(dialog) {
    if (!settingsNasDialogRoot || !dialog) return Promise.resolve({ confirmed: false });
    window.NotchUi?.prepareConfirmation(dialog);
    if (settingsNasDialogTitle) pomeLocaleRendererWorkspace.bind(settingsNasDialogTitle, "textContent", () => (dialog.title || pomeLocaleRendererWorkspace.t("copy.confirm.36f33a")));
    if (settingsNasDialogBody) {
      settingsNasDialogBody.textContent = dialog.body || '';
      settingsNasDialogBody.style.whiteSpace = 'pre-line';
    }
    if (settingsNasDialogConfirm) pomeLocaleRendererWorkspace.bind(settingsNasDialogConfirm, "textContent", () => (dialog.confirmLabel || pomeLocaleRendererWorkspace.t("copy.confirm.36f33a")));
    if (settingsNasDialogCancel) pomeLocaleRendererWorkspace.bind(settingsNasDialogCancel, "textContent", () => (dialog.cancelLabel || pomeLocaleRendererWorkspace.t("copy.cancel.2cd0f3")));
    if (settingsNasDialogAlt) {
      if (dialog.altLabel) {
        settingsNasDialogAlt.hidden = false;
        settingsNasDialogAlt.textContent = dialog.altLabel;
      } else {
        settingsNasDialogAlt.hidden = true;
      }
    }
    if (settingsNasDialog) {
      settingsNasDialog.dataset.controlId = dialog.controlId
        || (dialog.id === 'pair-reauth-confirm'
          ? 'pair.reauth'
          : dialog.id === 'migration-both-live'
            ? 'migration.both-live.confirm'
            : dialog.id === 'migration-history-empty'
              ? 'migration.history-empty.choice'
              : dialog.id === 'migration-restore-confirm'
                ? 'migration.failed.restore'
                : 'pair.http-extra-confirm');
    }
    settingsNasDialogRoot.hidden = false;
    return new Promise((resolve) => {
      nasDialogResolver = resolve;
    });
  }

  function closeNasDialog(confirmed, choice) {
    if (settingsNasDialogRoot) settingsNasDialogRoot.hidden = true;
    if (settingsNasDialogAlt) settingsNasDialogAlt.hidden = true;
    const resolver = nasDialogResolver;
    nasDialogResolver = null;
    if (resolver) resolver({ confirmed: confirmed === true, choice: choice || null });
  }

  function applyNasMigrationUi(action) {
    if (!window.NasSyncMigration) return;
    nasMigrationUi = window.NasSyncMigration.reduceMigrationUi(nasMigrationUi, action);
    window.__nasTodoReadonly = window.NasSyncMigration.isReadonly(nasMigrationUi);
    if (todoMigrationBanner) {
      todoMigrationBanner.hidden = !nasMigrationUi.bannerVisible;
      pomeLocaleRendererWorkspace.bind(todoMigrationBanner, "textContent", () => (nasMigrationUi.bannerText || pomeLocaleRendererWorkspace.t("copy.migratingPleaseWait.7aed12")));
    }
    if (tabTodo) {
      tabTodo.classList.toggle('is-migration-readonly', Boolean(nasMigrationUi.readonly));
    }
    renderNasSyncPanel();
    if (nasMigrationUi.phase === 'failed') setNasSyncHint(nasMigrationUi.error || pomeLocaleRendererWorkspace.t("copy.migrationFailed.35cda8"), 'error', { messageKey: 'copy.migrationFailed.35cda8', code: nasMigrationUi.error || 'migration_failed' });
    if (nasMigrationUi.toast && typeof showStatusToast === 'function') {
      showStatusToast(nasMigrationUi.toast);
    }
  }

  function applyMigrationProjection(projectionJson) {
    if (typeof projectionJson !== 'string') return;
    try {
      localStorage.setItem('notch-todo-data', projectionJson);
      document.dispatchEvent(new CustomEvent('nas-sync:todos-projection', {
        detail: { todosJson: projectionJson },
      }));
    } catch (error) {
      /* ignore */
    }
  }

  async function startNasMigration({ choice = null, isRetry = false } = {}) {
    if (!window.NasSyncMigration || !window.notchAPI || typeof window.notchAPI.syncRunMigration !== 'function') {
      return;
    }
    if (!nasPairUi.bound) {
      setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.completePairingFirst.f1ab55"), 'warning');
      return;
    }
    const localTodosJson = typeof window.getLocalTodosForSync === 'function'
      ? window.getLocalTodosForSync()
      : localStorage.getItem('notch-todo-data');
    const workspace = typeof window.getWorkspaceSnapshotForSync === 'function'
      ? window.getWorkspaceSnapshotForSync()
      : null;
    applyNasMigrationUi({ type: 'classifying' });

    const classified = await window.notchAPI.syncClassifyMigration({ localTodosJson, workspace });
    if (!classified || !classified.ok) {
      applyNasMigrationUi({
        type: 'failed',
        message: (classified && classified.error) || pomeLocaleRendererWorkspace.t("copy.couldnTDetermineMigrationState.4d2f3f"),
      });
      setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.couldnTDetermineMigrationState.0c1a8f"), 'error', { messageKey: 'copy.couldnTDetermineMigrationState.0c1a8f', code: classified?.error || 'migration_classify_failed' });
      return;
    }

    const decision = classified.decision;
    let resolvedChoice = choice;
    if (decision.needsUserChoice && !resolvedChoice) {
      applyNasMigrationUi({ type: 'await_choice', decision });
      const dialog = nasMigrationUi.dialog;
      const picked = await openNasDialog(dialog);
      if (dialog.allowDismiss !== false && !picked.confirmed && !picked.choice) {
        // cancel abort for both-live
        if (!picked.choice && dialog.choiceCancel == null) {
          applyNasMigrationUi({ type: 'close_dialog' });
          applyNasMigrationUi({ type: 'reset' });
          setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.migrationCanceled.faddad"), 'warning');
          return;
        }
      }
      if (picked.confirmed && dialog.choiceConfirm) {
        resolvedChoice = dialog.choiceConfirm;
      } else if (picked.choice) {
        resolvedChoice = picked.choice;
      } else if (!picked.confirmed && dialog.choiceCancel) {
        // history-empty: cancel button means keep_nas_deletes
        resolvedChoice = dialog.choiceCancel;
      } else {
        applyNasMigrationUi({ type: 'close_dialog' });
        applyNasMigrationUi({ type: 'reset' });
        setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.migrationCanceled.faddad"), 'warning');
        return;
      }
      closeNasDialog(true, resolvedChoice);
      applyNasMigrationUi({ type: 'close_dialog' });
    }

    applyNasMigrationUi({ type: 'migrating' });
    const result = await window.notchAPI.syncRunMigration({
      localTodosJson,
      workspace,
      choice: resolvedChoice,
    });

    if (!result || !result.ok) {
      applyNasMigrationUi({
        type: 'failed',
        error: result && result.error,
        message: (result && result.message) || (result && result.error) || pomeLocaleRendererWorkspace.t("copy.migrationFailed.35cda8"),
        migrationId: result && result.migrationId,
      });
      setNasSyncHint(
        result && result.error === 'cas_conflict' ? pomeLocaleRendererWorkspace.t("copy.theRemoteSideChangedCheckAgain.0f1ab5") : pomeLocaleRendererWorkspace.t("copy.migrationFailed.35cda8"),
        'error',
        { messageKey: result?.error === 'cas_conflict' ? 'copy.theRemoteSideChangedCheckAgain.0f1ab5' : 'copy.migrationFailed.35cda8', code: result?.error || 'migration_failed' },
      );
      return;
    }

    if (result.projectionJson) {
      applyMigrationProjection(result.projectionJson);
      if (typeof window.notchAPI.syncAckMigrationProjection === 'function') {
        await window.notchAPI.syncAckMigrationProjection();
      }
    }

    if (result.workspaceProjection) {
      document.dispatchEvent(new CustomEvent('nas-sync:workspace-projection', {
        detail: result.workspaceProjection,
      }));
    }

    if (result.skipped) {
      applyNasMigrationUi({ type: 'skipped' });
      setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.bothSidesHaveNoNotesClipboardEntries.a2654b"), 'warning');
    } else {
      applyNasMigrationUi({ type: 'done', migrationId: result.migrationId });
      setNasSyncHint(isRetry ? pomeLocaleRendererWorkspace.t("copy.migrationRetrySuccessful.96c9a0") : pomeLocaleRendererWorkspace.t("copy.migrationComplete.920d63"), 'success');
    }
  }

  async function refreshNasSyncStatus() {
    if (!window.notchAPI || typeof window.notchAPI.syncGetStatus !== 'function') return;
    try {
      const status = await window.notchAPI.syncGetStatus();
      applyNasPairUi({ type: 'set_status', status });
      const hint = document.getElementById('credentials-sync-hint');
      if (hint) pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (status.bound ? (status.recovery?.paused ? pomeLocaleRendererWorkspace.t("copy.encryptedOnThisDeviceNasSyncPaused.386405") : pomeLocaleRendererWorkspace.t("copy.encryptedOnThisDeviceCredentialsSyncEncrypted.5db69f")) : pomeLocaleRendererWorkspace.t("copy.encryptedOnThisDeviceNasNotPaired.53018e")));
      if (status && status.bound && status.baseUrl && settingsNasSyncBaseUrl && !settingsNasSyncBaseUrl.value) {
        settingsNasSyncBaseUrl.value = status.baseUrl;
      }
      if (typeof window.notchAPI.syncGetDashboard === 'function') {
        const dash = await window.notchAPI.syncGetDashboard();
        if (dash && dash.ok) {
          applyNasSettingsUi({
            type: 'hydrate',
            view: dash.settings,
            syncStatus: dash.credentials,
            outboxCount: dash.outboxCount,
            uiState: dash.uiState,
            uiLabel: dash.uiLabel,
            channelLabel: dash.channelLabel,
            error: '',
            contentResults: dash.contentResults,
            recovery: dash.recovery,
            schemaIncompatible: dash.schemaIncompatible,
            schemaUpgradeTarget: dash.schemaUpgradeTarget,
            schemaMessage: dash.schemaMessage,
          });
          renderNasSyncPanel();

        }
      }
    } catch (error) {
      setNasStatusHint(describeNasSyncError(error, pomeLocaleRendererWorkspace.t("copy.operationFailed.0c3b4c")), 'error');
    }
  }

  async function submitNasPair({
    httpConfirmAccepted = false,
    trustCertificateAccepted = false,
    certificateFingerprint = null,
  } = {}) {
    if (!window.NasSyncPair || !window.notchAPI || typeof window.notchAPI.syncPairClaim !== 'function') return;
    const code = settingsNasPairCode?.value || '';
    let address; try { address = new URL(window.NotchUiDomain.normalizeAddress(settingsNasSyncBaseUrl?.value || '')); } catch {}
    if (!address || !['https:', 'http:'].includes(address.protocol) || !/^\d{6}$/.test(code.trim())) {
      const field = !address || !['https:', 'http:'].includes(address.protocol) ? settingsNasSyncBaseUrl : settingsNasPairCode;
      if (settingsNasSyncHint) pomeLocaleRendererWorkspace.bind(settingsNasSyncHint,'textContent',()=>pomeLocaleRendererWorkspace.t('ux.nas.fields'));
      field?.setAttribute('aria-invalid', 'true'); field?.focus(); return;
    }
    settingsNasSyncBaseUrl?.removeAttribute('aria-invalid'); settingsNasPairCode?.removeAttribute('aria-invalid');
    const baseUrl = window.NotchUiDomain.normalizeAddress(settingsNasSyncBaseUrl?.value || '');
    if (settingsNasSyncBaseUrl) settingsNasSyncBaseUrl.value = baseUrl;
    applyNasPairUi({ type: 'submit_start' });
    setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.pairing.f55f93"));

    const policy = await window.notchAPI.syncPairHttpPolicy(baseUrl);
    if (window.NasSyncPair.shouldPromptHttpConfirm(policy) && !httpConfirmAccepted) {
      applyNasPairUi({
        type: 'open_http_confirm',
        confirmText: policy.confirmText,
      });
      const decision = await openNasDialog(nasPairUi.dialog);
      if (!decision.confirmed) {
        applyNasPairUi({ type: 'close_dialog' });
        setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.insecureHttpPairingCanceled.2925b0"), 'warning');
        return;
      }
      closeNasDialog(true);
      return submitNasPair({ httpConfirmAccepted: true });
    }

    const result = await window.NasSyncPair.runPairSubmit({
      code,
      baseUrl,
      api: window.notchAPI,
      httpConfirmAccepted,
      allowInsecureHttp: Boolean(policy && policy.insecureBound),
      trustCertificateAccepted,
      certificateFingerprint,
    });
    applyNasPairUi({ type: 'submit_end' });
    if (!result.ok) {
      const askTrust = window.NasSyncPair.shouldOpenCertificateTrustDialog(result) === true;
      if (askTrust && trustCertificateAccepted !== true) {
        applyNasPairUi({
          type: 'open_cert_trust_confirm',
          confirmText: result.confirmText,
          fingerprint256: result.fingerprint256,
          subjectCN: result.subjectCN,
          issuerCN: result.issuerCN,
          validFrom: result.validFrom,
          validTo: result.validTo,
          hostKey: result.hostKey,
        });
        const decision = await openNasDialog(nasPairUi.dialog);
        if (!decision.confirmed) {
          applyNasPairUi({ type: 'close_dialog' });
          applyNasPairUi({
            type: 'failure',
            message: pomeLocaleRendererWorkspace.t("copy.certificateTrustCanceled.0276e8"),
            needsTrustConfirm: false,
          });
          setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.certificateTrustCanceled.0276e8"), 'warning');
          return;
        }
        closeNasDialog(true);
        return submitNasPair({
          httpConfirmAccepted,
          trustCertificateAccepted: true,
          certificateFingerprint: result.fingerprint256,
        });
      }
      applyNasPairUi({
        type: 'failure',
        error: result.error,
        message: result.message,
        needsTrustConfirm: askTrust,
      });
      if (result.error === 'https_on_http' && settingsNasSyncBaseUrl) {
        settingsNasSyncBaseUrl.value = baseUrl.replace(/^https:/, 'http:');
        nasPairUi = { ...nasPairUi, baseUrl: settingsNasSyncBaseUrl.value };
      }
      setNasSyncHint(result.message || pomeLocaleRendererWorkspace.t("copy.pairingFailed.aea73b"), 'error', { messageKey: 'copy.pairingFailed.aea73b', code: result.error || 'pair_failed' });
      return;
    }
    applyNasPairUi({ type: 'success', status: result.status });
    if (settingsNasPairCode) settingsNasPairCode.value = '';
    setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.pairingSuccessful.b1e2f7"), 'success');
    await refreshNasSyncStatus();
    // One shot per successful pair. Launch and later syncs do not reopen this.
    openNasSyncOptions();
  }

  function setCursorTokenBusy(busy) {
    [settingsCursorTokenFetch, settingsCursorTokenSave, settingsCursorTokenClear, settingsCursorToken]
      .forEach((control) => { if (control) control.disabled = busy; });
  }

  window.notchAPI?.onCursorTokenChanged?.((status) => {
    settingsCursorTokenMeta = status;
    renderSettingsPanel();
    document.dispatchEvent(new CustomEvent('notch:cursor-token-changed'));
  });

  if (settingsCursorTokenFetch) settingsCursorTokenFetch.addEventListener('click', async () => {
    if (!window.notchAPI?.readLocalCursorToken || !settingsCursorToken) return;
    setCursorTokenBusy(true);
    pomeLocaleRendererWorkspace.bind(settingsCursorTokenFetch, 'textContent', () => pomeLocaleRendererWorkspace.t('copy.reading.146da2'));
    setCursorTokenHint('copy.readingLocalCursorSignIn.153fb0');
    let stage = 'read';
    try {
      const result = await window.notchAPI.readLocalCursorToken();
      if (!result?.ok || !result.token) {
        const messages = {
          cursor_db_missing: 'copy.noLocalCursorDataFoundInstallCursor.f5b341',
          cursor_token_missing: 'copy.cursorIsnTSignedInLocallySign.45a8a8',
          cursor_db_read_failed: 'copy.couldnTReadCursorSignInRetry.6bf381',
          cursor_token_decrypt_failed: 'providers.cursorEncryptedLogin',
          cursor_token_encrypted_unsupported: 'providers.cursorEncryptedLogin',
        };
        const code = result?.error || 'cursor_token_missing';
        setCursorTokenHint(messages[code] || 'copy.couldnTGetATokenRetryOr.8c7624', 'error', { code });
        return;
      }
      stage = 'save';
      const saved = await window.notchAPI.setCursorToken(result.token);
      if (!saved?.ok) throw new Error(saved?.error || 'save_failed');
      settingsCursorToken.value = ''; settingsCursorTokenMeta = saved; renderSettingsPanel();
      setCursorTokenHint('ui.token.savedPending', 'success');
    } catch (error) {
      const secure = error?.message === 'secure_storage_unavailable';
      const messageKey = stage === 'read' ? 'copy.couldnTReadCursorSignInRetry.6bf381'
        : secure ? 'copy.systemSecureStorageIsUnavailableCanT.3a9217' : 'copy.couldnTSaveTheTokenRetry.69484f';
      setCursorTokenHint(messageKey, 'error', { code: stage === 'read' ? 'cursor_db_read_failed' : secure ? 'secure_storage_unavailable' : 'save_failed' });
    } finally {
      setCursorTokenBusy(false);
      pomeLocaleRendererWorkspace.bind(settingsCursorTokenFetch, 'textContent', () => pomeLocaleRendererWorkspace.t('ui.token.acquire'));
    }
  });

  if (settingsCursorTokenSave) settingsCursorTokenSave.addEventListener('click', async () => {
    if (!window.notchAPI || typeof window.notchAPI.setCursorToken !== 'function') return;
    const token = settingsCursorToken?.value || '';
    if (!String(token).trim()) {
      setCursorTokenHint('copy.getOrPasteATokenFirstOr.f2f57e', 'error', { inline: true, code: 'token_required' });
      return;
    }
    setCursorTokenBusy(true);
    setCursorTokenHint('copy.savingSecurely.1af0c5');
    let result;
    try { result = await window.notchAPI.setCursorToken(token); }
    catch { result = { ok: false, error: 'save_failed' }; }
    setCursorTokenBusy(false);
    if (!result?.ok) {
      const validation = result?.error === 'token_required';
      const messageKey = validation ? 'copy.getOrPasteATokenFirstOr.f2f57e' : result?.error === 'secure_storage_unavailable'
        ? 'copy.systemSecureStorageIsUnavailableCanT.3a9217' : 'copy.couldnTSaveTheTokenRetry.69484f';
      setCursorTokenHint(messageKey, 'error', { code: result?.error || 'save_failed', inline: validation });
      return;
    }
    settingsCursorTokenMeta = result;
    if (settingsCursorToken) settingsCursorToken.value = '';
    renderSettingsPanel();
    setCursorTokenHint('copy.savedSecurelyAndSyncedEncryptedWhenPaired.ec564d', 'success');
  });

  if (settingsCursorTokenClear) settingsCursorTokenClear.addEventListener('click', async () => {
    if (!window.notchAPI || typeof window.notchAPI.clearCursorToken !== 'function') return;
    setCursorTokenBusy(true);
    let result;
    try { result = await window.notchAPI.clearCursorToken(); }
    catch { result = { ok: false, error: 'clear_failed' }; }
    setCursorTokenBusy(false);
    if (!result?.ok) {
      setCursorTokenHint('copy.couldnTClearTheTokenRetry.3cb9ef', 'error', { code: result?.error || 'clear_failed' });
      return;
    }
    settingsCursorTokenMeta = result;
    if (settingsCursorToken) settingsCursorToken.value = '';
    renderSettingsPanel();
    setCursorTokenHint('copy.savedTokenClearedLocalSignInWill.da9bd9', 'success');
  });

  if (settingsNasPairCode) {
    settingsNasPairCode.addEventListener('input', () => {
      applyNasPairUi({ type: 'input', value: settingsNasPairCode.value });
      setNasSyncHint('');
    });
    settingsNasPairCode.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submitNasPair();
      }
    });
  }
  if (settingsNasPairSubmit) {
    settingsNasPairSubmit.addEventListener('click', () => { void submitNasPair(); });
  }
  if (settingsNasPairReauth) {
    settingsNasPairReauth.addEventListener('click', async () => {
      applyNasPairUi({ type: 'open_reauth_confirm' });
      const decision = await openNasDialog(nasPairUi.dialog);
      if (!decision.confirmed) {
        applyNasPairUi({ type: 'close_dialog' });
        return;
      }
      closeNasDialog(true);
      if (!window.notchAPI || typeof window.notchAPI.syncClearBinding !== 'function') return;
      const cleared = await window.notchAPI.syncClearBinding();
      if (cleared && cleared.ok) {
        applyNasPairUi({ type: 'cleared' });
        setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.bindingClearedYouCanPairAgain.9814e6"), 'success');
        await refreshNasSyncStatus();
      } else {
        setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.couldnTClearBinding.2952f4"), 'error', { messageKey: 'copy.couldnTClearBinding.2952f4', code: cleared?.error || 'clear_binding_failed' });
      }
    });
  }

  async function addNasEndpoint() {
    if (!window.NasSyncSettings || !window.notchAPI || !nasPairUi.bound) return;
    const baseUrl = (settingsNasEndpointUrl?.value || '').trim();
    const { primary, backup } = window.NasSyncSettings.connectionEndpoints(nasSettingsUi.view, nasPairUi.status);
    if (!baseUrl) {
      if (!backup) return;
      const decision = await openNasDialog(window.NasSyncSettings.buildDeleteConfirmDialog(backup));
      if (!decision.confirmed) return;
      closeNasDialog(true);
      const removed = await window.notchAPI.syncDeleteEndpoint({ endpointId: backup.endpointId });
      if (!removed?.ok) { setNasEndpointHint(describeNasSyncError(removed, pomeLocaleRendererWorkspace.t("copy.operationFailed.0c3b4c")), 'error'); return; }
      nasBackupDraftDirty = false;
      await refreshNasSyncStatus();
      return;
    }
    const check = window.NasSyncSettings.validateBaseUrlDraft(baseUrl);
    if (!check.ok) { setNasEndpointHint(check.message || pomeLocaleRendererWorkspace.t("copy.invalidUrl.d92df2"), 'error'); return; }
    const duplicate = (nasSettingsUi.view?.endpoints || []).some(ep => ep.endpointId !== backup?.endpointId
      && window.NasSyncSettings.connectionEndpoints({ endpoints: [ep] }, { baseUrl: check.baseUrl }).primary);
    if (duplicate) { setNasEndpointHint(describeNasSyncError({ error: 'duplicate_endpoint' }, pomeLocaleRendererWorkspace.t("copy.operationFailed.0c3b4c")), 'error'); return; }
    const url = new URL(check.baseUrl);
    const needsHttp = url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)
      && !(backup?.baseUrl === check.baseUrl && backup.allowInsecureHttp);
    if (needsHttp) {
      const decision = await openNasDialog(window.NasSyncSettings.buildHttpConfirmDialog());
      if (!decision.confirmed) { closeNasDialog(false); return; }
      closeNasDialog(true);
    }
    applyNasSettingsUi({ type: 'busy' });
    try {
      const result = backup ? await window.notchAPI.syncUpdateEndpoint({ endpointId: backup.endpointId, baseUrl: check.baseUrl })
        : await window.NasSyncSettings.runAddEndpoint({ api: window.notchAPI, baseUrl: check.baseUrl, kind: 'custom', priority: (Number(primary?.priority) || 0) + 1 });
      if (!result?.ok) { setNasEndpointHint(describeNasSyncError(result, pomeLocaleRendererWorkspace.t("copy.operationFailed.0c3b4c")), 'error'); return; }
      if (needsHttp) {
        const http = await window.NasSyncSettings.runToggleHttp({ api: window.notchAPI, endpointId: result.endpoint.endpointId, enable: true, httpConfirmAccepted: true });
        if (!http?.ok) { setNasEndpointHint(describeNasSyncError(http, pomeLocaleRendererWorkspace.t("copy.couldnTUpdateTheHttpSetting.dbb1de")), 'error'); return; }
      }
      nasBackupDraftDirty = false;
      setNasEndpointHint(needsHttp ? pomeLocaleRendererWorkspace.t("copy.unencryptedHttpAllowedWarningRemains.a047a3") : pomeLocaleRendererWorkspace.t("copy.saved.1bd91a"), needsHttp ? 'warning' : 'success');
    } catch (error) { setNasEndpointHint(describeNasSyncError(error, pomeLocaleRendererWorkspace.t("copy.operationFailed.0c3b4c")), 'error'); }
    finally { applyNasSettingsUi({ type: 'idle' }); await refreshNasSyncStatus(); }
  }

  if (settingsNasEndpointAdd) {
    settingsNasEndpointAdd.addEventListener('click', () => { void addNasEndpoint(); });
  }
  if (settingsNasEndpointUrl) {
    settingsNasEndpointUrl.addEventListener('input', () => { nasBackupDraftDirty = true; });
    settingsNasEndpointUrl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void addNasEndpoint();
      }
    });
  }
  if (settingsNasSyncOpen) {
    settingsNasSyncOpen.addEventListener('click', () => {
      if (!nasPairUi.bound) return;
      openNasSyncOptions();
    });
  }
  if (settingsNasSyncOptionsCancel) {
    settingsNasSyncOptionsCancel.addEventListener('click', () => {
      closeNasSyncOptions();
    });
  }
  if (settingsNasSyncOptionsStart) {
    settingsNasSyncOptionsStart.addEventListener('click', () => {
      closeNasSyncOptions();
      void startNasMigration();
    });
  }
  if (settingsNasSyncRetry) {
    settingsNasSyncRetry.addEventListener('click', async () => {
      if (!nasPairUi.bound) return;
      if (!window.notchAPI || typeof window.notchAPI.syncRetry !== 'function') return;
      applyNasSettingsUi({ type: 'busy' });
      const result = await window.notchAPI.syncRetry();
      applyNasSettingsUi({ type: 'idle' });
      if (!result || !result.ok) {
        const httpsOnHttp = result && (
          result.error === 'https_on_http'
          || (window.NasSyncPair && window.NasSyncPair.isHttpsOnHttpFailure(result))
        );
        const unbound = result && (result.error === 'not_bound' || result.error === 'binding_incomplete');
        setNasStatusHint(
          httpsOnHttp
            ? (result.message || window.NasSyncPair.HTTPS_ON_HTTP_MESSAGE)
            : describeNasSyncError(result, pomeLocaleRendererWorkspace.t("copy.retryFailed.26a643")),
          unbound ? 'warning' : 'error',
        );
      } else {
        setNasStatusHint(pomeLocaleRendererWorkspace.t("copy.syncRetried.d5c1fd"), 'success');
      }
      await refreshNasSyncStatus();
    });
  }
  document.getElementById('settings-nas-recovery').addEventListener('click', async () => {
    const preview = await window.notchAPI.recoveryPreview();
    if (!preview.ok) { setNasStatusHint(preview.message || pomeLocaleRendererWorkspace.t("copy.previewUnavailable.b825cc"), 'error'); return; }
    const confirmed = await (window.NotchUi?.confirm || window.notchAPI.confirm)({ title: pomeLocaleRendererWorkspace.t("copy.replaceNasDataWithLocalData.2a31fb"), message: pomeLocaleRendererWorkspace.t("ui.confirm.impact", { adds: preview.adds.length, updates: preview.updates.length, deletes: preview.deletes.length }), detail: pomeLocaleRendererWorkspace.t("copy.addChangeDeleteDeletedItemsIncludesTasks.ca3b5f", { arg1: (preview.adds.length), arg2: (preview.updates.length), arg3: (preview.deletes.length), arg4: ((preview.deleteLabels || preview.deletes).join('、') || pomeLocaleRendererWorkspace.t("copy.none.484d55")) }) });
    if (!confirmed) return;
    const result = await window.notchAPI.recoveryExecute(preview.previewId);
    setNasStatusHint(result.ok ? pomeLocaleRendererWorkspace.t("copy.overwriteVerifiedSyncResumed.da48e7") : result.message || pomeLocaleRendererWorkspace.t("copy.operationFailedSyncRemainsPaused.aff63e"), result.ok ? 'success' : 'error');
    await refreshNasSyncStatus();
  });
  document.getElementById('settings-nas-rollback').addEventListener('click', async () => {
    const status = await window.notchAPI.syncGetStatus();
    const confirmed = await (window.NotchUi?.confirm || window.notchAPI.confirm)({ title: pomeLocaleRendererWorkspace.t("copy.restoreNasSnapshot.1ce868"), message: pomeLocaleRendererWorkspace.t("copy.restoreOrdinaryDataFromBeforeTheLast.252e58"), detail: pomeLocaleRendererWorkspace.t("copy.rollbackIsAvailableOnlyIfTheNas.a5665f") });
    if (!confirmed) return;
    const result = await window.notchAPI.recoveryRollback(status.recovery.operationId);
    setNasStatusHint(result.ok ? pomeLocaleRendererWorkspace.t("copy.nasRolledBackSyncRemainsPaused.7e5880") : result.message || pomeLocaleRendererWorkspace.t("copy.rollbackFailed.577da4"), result.ok ? 'success' : 'error');
    await refreshNasSyncStatus();
  });
  function describeBackupCounts(counts) {
    return pomeLocaleRendererWorkspace.t("copy.tasksCategoryNamesNotesPlusHomeNote.e0512a", { arg1: (Object.values(counts.todos || {}).reduce((n, v) => n + v, 0)), arg2: (counts.categoryNames || 0), arg3: (counts.notes?.archive || 0), arg4: (counts.links?.items || 0), arg5: (counts.links?.groups || 0), arg6: (counts.commands || 0), arg7: (counts.clipboard?.history || 0), arg8: (counts.clipboard?.favorites || 0), arg9: (counts.recordings || 0) });
  }
  if (settingsNasExportBackup) {
    settingsNasExportBackup.addEventListener('click', async () => {
      if (!window.notchAPI || typeof window.notchAPI.syncExportTodosBackup !== 'function') return;
      const result = await window.notchAPI.syncExportTodosBackup();
      if (!result || !result.ok) {
        if (result && result.error === 'cancelled') return;
        setNasStatusHint(result?.message || pomeLocaleRendererWorkspace.t("copy.exportFailed.6e4445"), 'error');
        return;
      }
      setNasStatusHint(pomeLocaleRendererWorkspace.t("copy.backupExported.ad4578"), 'success');
      if (typeof showStatusToast === 'function') showStatusToast(pomeLocaleRendererWorkspace.t("copy.localBackupExportedCredentialsAndAiKeys.27df18"));
    });
  }
  if (settingsNasRestoreBackup) {
    settingsNasRestoreBackup.addEventListener('click', async () => {
      const preview = await window.notchAPI.backupPreview();
      if (!preview.ok) { if (preview.error !== 'cancelled') setNasStatusHint(preview.message || pomeLocaleRendererWorkspace.t("copy.verificationFailed.a096c1"), 'error'); return; }
      const detail = pomeLocaleRendererWorkspace.t("copy.currentDataBackupDataOrdinaryDataAnd.847c9a", { arg1: (describeBackupCounts(preview.currentCounts)), arg2: (describeBackupCounts(preview.manifest.collections)), arg3: (preview.paired ? pomeLocaleRendererWorkspace.t("copy.nasSyncWillPauseAfterRestoringReview.3d4ccd") : '') });
      const confirmed = await window.notchAPI.confirm({ title: pomeLocaleRendererWorkspace.t("copy.restoreData.07c6e3"), message: pomeLocaleRendererWorkspace.t("copy.backupVerifiedReplaceTheCurrentOrdinaryData.814111"), detail });
      if (!confirmed) return;
      const result = await window.notchAPI.backupRestore(preview.previewId);
      if (!result.ok) setNasStatusHint(result.message || pomeLocaleRendererWorkspace.t("copy.restoreFailed.89281a"), 'error');
    });
  }
  if (settingsNasEndpointList) {
    settingsNasEndpointList.addEventListener('change', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const endpointId = target.getAttribute('data-nas-http-toggle');
      if (!endpointId) return;
      const enable = target.checked === true;
      if (enable) {
        const dialog = window.NasSyncSettings.buildHttpConfirmDialog();
        const decision = await openNasDialog(dialog);
        if (!decision.confirmed) {
          target.checked = false;
          closeNasDialog(false);
          return;
        }
        closeNasDialog(true);
      }
      const result = await window.NasSyncSettings.runToggleHttp({
        api: window.notchAPI,
        endpointId,
        enable,
        httpConfirmAccepted: enable,
      });
      if (!result || !result.ok) {
        target.checked = !enable;
        setNasEndpointHint(describeNasSyncError(result, pomeLocaleRendererWorkspace.t("copy.couldnTUpdateTheHttpSetting.dbb1de")), 'error');
        return;
      }
      if (result.policyMessage) setNasEndpointHint(result.policyMessage, 'warning');
      else if (!enable) setNasEndpointHint(pomeLocaleRendererWorkspace.t("copy.disabledUseHttpsOrAllowHttpAgain.a88ecf"), 'warning');
      else setNasEndpointHint(pomeLocaleRendererWorkspace.t("copy.unencryptedHttpAllowedWarningRemains.a047a3"), 'warning');
      await refreshNasSyncStatus();
    });
  }
  if (settingsNasDialogCancel) {
    settingsNasDialogCancel.addEventListener('click', () => {
      const dialog = nasMigrationUi.dialog || nasPairUi.dialog;
      if (dialog && dialog.choiceCancel) {
        closeNasDialog(false, dialog.choiceCancel);
        return;
      }
      closeNasDialog(false);
      applyNasPairUi({ type: 'close_dialog' });
      applyNasMigrationUi({ type: 'close_dialog' });
    });
  }
  if (settingsNasDialogAlt) {
    settingsNasDialogAlt.addEventListener('click', () => {
      const dialog = nasMigrationUi.dialog;
      if (dialog && dialog.choiceAlt) {
        closeNasDialog(true, dialog.choiceAlt);
        return;
      }
      closeNasDialog(false);
    });
  }
  if (settingsNasDialogConfirm) {
    settingsNasDialogConfirm.addEventListener('click', () => {
      const dialog = nasMigrationUi.dialog || nasPairUi.dialog;
      if (dialog && dialog.choiceConfirm) {
        closeNasDialog(true, dialog.choiceConfirm);
        return;
      }
      closeNasDialog(true);
    });
  }
  if (settingsNasMigrationStart) {
    settingsNasMigrationStart.addEventListener('click', () => {
      void startNasMigration();
    });
  }
  if (settingsNasMigrationRetry) {
    settingsNasMigrationRetry.addEventListener('click', () => {
      void startNasMigration({ isRetry: true });
    });
  }
  if (settingsNasMigrationRestore) {
    settingsNasMigrationRestore.addEventListener('click', async () => {
      applyNasMigrationUi({ type: 'open_restore_confirm' });
      const decision = await openNasDialog(nasMigrationUi.dialog);
      if (!decision.confirmed) {
        applyNasMigrationUi({ type: 'close_dialog' });
        return;
      }
      closeNasDialog(true);
      if (!window.notchAPI || typeof window.notchAPI.syncRestoreMigrationBackup !== 'function') return;
      const restored = await window.notchAPI.syncRestoreMigrationBackup({ confirmed: true });
      if (!restored || !restored.ok) {
        setNasSyncHint(describeNasSyncError(restored, pomeLocaleRendererWorkspace.t("copy.restoreFailed.89281a")), 'error', { messageKey: 'copy.restoreFailed.89281a', code: restored?.error || 'restore_failed' });
        return;
      }
      if (restored.projectionJson) applyMigrationProjection(restored.projectionJson);
      applyNasMigrationUi({ type: 'reset' });
      setNasSyncHint(pomeLocaleRendererWorkspace.t("copy.migrationBackupRestored.752850"), 'success');
    });
  }
  if (window.notchAPI && typeof window.notchAPI.onSyncMigrationSession === 'function') {
    window.notchAPI.onSyncMigrationSession((session) => {
      if (!session) return;
      applyNasMigrationUi({
        type: 'set_readonly',
        readonly: Boolean(session.readonly),
      });
      if (session.phase === 'failed') {
        applyNasMigrationUi({
          type: 'failed',
          message: session.lastError || pomeLocaleRendererWorkspace.t("copy.migrationFailed.35cda8"),
          migrationId: session.migrationId,
        });
      }
    });
  }
  void refreshNasSyncStatus();
  if (window.notchAPI && typeof window.notchAPI.onSyncStatus === 'function') {
    window.notchAPI.onSyncStatus((status) => {
      applyNasPairUi({ type: 'set_status', status });
      const hint = document.getElementById('credentials-sync-hint');
      if (hint) pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (status.bound ? (status.recovery?.paused ? pomeLocaleRendererWorkspace.t("copy.encryptedOnThisDeviceNasSyncPaused.386405") : pomeLocaleRendererWorkspace.t("copy.encryptedOnThisDeviceCredentialsSyncEncrypted.5db69f")) : pomeLocaleRendererWorkspace.t("copy.encryptedOnThisDeviceNasNotPaired.53018e")));
      if (status && status.schemaIncompatible && status.schemaMessage) {
        setNasStatusHint(status.schemaMessage, 'error');
      }
      void refreshNasSyncStatus();
    });
  }

  if (settingsApiConfigure) settingsApiConfigure.addEventListener('click', openTranscriptionSettings);
  if (transcriptionSettingsClose) transcriptionSettingsClose.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsCancel) transcriptionSettingsCancel.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsSave) transcriptionSettingsSave.addEventListener('click', saveTranscriptionSettings);
  if (transcriptionApiHelp) {
    transcriptionApiHelp.addEventListener('click', () => {
      const singapore = document.getElementById('transcription-region')?.value === 'singapore';
      window.notchAPI?.openExternal(singapore ? 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/model/settings/api-key' : 'https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
  }
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://platform.deepseek.com/api_keys');
    });
  }
  if (transcriptionSettingsBackdrop) {
    transcriptionSettingsBackdrop.addEventListener('click', (event) => {
      if (event.target === transcriptionSettingsBackdrop) closeTranscriptionSettings();
    });
  }
  if (window.notchAPI && typeof window.notchAPI.onOpenApiSettings === 'function') {
    window.notchAPI.onOpenApiSettings(async () => {
      if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
      openTranscriptionSettings();
    });
  }
  settingsFeatureList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-feature]');
    if (!input || !window.notchAPI?.setFeature) return;
    input.disabled = true;
    const result = await window.notchAPI.setFeature(input.dataset.settingsFeature, input.checked)
      .catch(() => ({ ok: false }));
    input.disabled = false;
    if (!result?.ok) {
      input.checked = !input.checked;
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTSaveFeatureVisibilityRetry.73f979"), true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(pomeLocaleRendererWorkspace.t("copy.featureVisibilityUpdated.ae777d"));
  });
  settingsHomeModuleList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-home-module]');
    if (!input || !window.NotchHome?.setModuleVisible) return;
    input.disabled = true;
    const result = await window.NotchHome.setModuleVisible(
      input.dataset.settingsHomeModule,
      input.checked
    );
    renderHomeModuleSettings();
    if (!result?.ok) {
      const message = result?.error === 'at_least_one_required'
        ? pomeLocaleRendererWorkspace.t("copy.keepAtLeastOneHomeWidget.fddd04")
        : result?.error === 'recording_active'
          ? pomeLocaleRendererWorkspace.t("copy.recordingInProgressQuickRecordingCannotBe.ce9c08")
          : result?.error === 'layout_read_only'
            ? pomeLocaleRendererWorkspace.t("copy.homeLayoutIsInSafeModeWidgets.8dcefc")
            : result?.error === 'layout_invalid'
              ? pomeLocaleRendererWorkspace.t("copy.newLayoutVerificationFailedOriginalLayoutPreserved.dedc5e")
              : result?.error === 'dom_apply_failed'
                ? pomeLocaleRendererWorkspace.t("copy.couldnTApplyLayoutOriginalLayoutRestored.ec29ab")
                : pomeLocaleRendererWorkspace.t("copy.homeWidgetSettingsWereNotUpdated.080c41");
      const messageKey = {
        layout_read_only: 'copy.homeLayoutIsInSafeModeWidgets.8dcefc',
        layout_invalid: 'copy.newLayoutVerificationFailedOriginalLayoutPreserved.dedc5e',
        dom_apply_failed: 'copy.couldnTApplyLayoutOriginalLayoutRestored.ec29ab',
      }[result?.error];
      if (typeof showStatusToast === 'function') showStatusToast(message, {
        messageKey,
        kind: ['layout_read_only', 'layout_invalid', 'dom_apply_failed'].includes(result?.error) ? 'error' : 'warning',
        scope: 'home:layout',
      });
      return;
    }
    if (result.changed === false) return;
    const message = result.persisted === false
      ? pomeLocaleRendererWorkspace.t("copy.layoutUpdatedForThisSessionOnlySettings.5c6c52")
      : input.checked ? pomeLocaleRendererWorkspace.t("copy.homeWidgetRestored.3f535c") : pomeLocaleRendererWorkspace.t("copy.homeWidgetHidden.9f7a16");
    if (typeof showStatusToast === 'function') showStatusToast(message);
  });
  settingsMirrorChoose?.addEventListener('click', async () => {
    if (!window.notchAPI?.chooseMirrorImage) return;
    settingsMirrorChoose.disabled = true;
    const result = await window.notchAPI.chooseMirrorImage().catch(() => ({ ok: false }));
    settingsMirrorChoose.disabled = false;
    if (result?.canceled) return;
    if (!result?.ok) {
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTReplaceTheMirrorCover.12da67"), true);
      return;
    }
    applySettingsMirrorCover(result.dataUrl);
    setSettingsNote(pomeLocaleRendererWorkspace.t("copy.homeMirrorCoverUpdated.483fa0"));
  });
  settingsShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut'));
  });
  settingsResetPanelPosition?.addEventListener('click', async () => {
    if (!window.notchAPI?.resetPanelPosition) return;
    settingsResetPanelPosition.disabled = true;
    const ok = await window.notchAPI.resetPanelPosition().catch(() => false);
    settingsResetPanelPosition.disabled = false;
    if (!ok) {
      if (window.NotchUi?.showError) {
        window.NotchUi.showError({ messageKey: 'copy.couldnTResetThePanelPositionRetry.894379',
          repairKey: 'ui.error.layoutSaveRepair', diagnostic: 'Panel position: save_failed', scope: 'settings:panel-position', inlineHint: settingsInlineNote,
          onRepair: () => settingsResetPanelPosition.click() });
      } else setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTResetThePanelPositionRetry.894379"), true);
      return;
    }
    window.NotchUi?.clearError?.('settings:panel-position');
    setSettingsNote(pomeLocaleRendererWorkspace.t("copy.panelReturnedToTopCenterDragIt.2fe79c"));
  });
  settingsDefaultTab?.addEventListener('change', async () => {
    if (!window.notchAPI?.setDefaultTab) return;
    const previous = settingsAppSettings?.defaultTab || 'home';
    settingsDefaultTab.disabled = true;
    const result = await window.notchAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
    settingsDefaultTab.disabled = false;
    if (!result?.ok) {
      settingsDefaultTab.value = previous;
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTSaveTheDefaultPageRetry.41033a"), true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(pomeLocaleRendererWorkspace.t("copy.willOpenByDefaultNextTime.c23641", { arg1: (settingsDefaultTab.selectedOptions[0]?.textContent || pomeLocaleRendererWorkspace.t("copy.selectedPage.8b9214")) }));
  });
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.notchAPI?.openWorkspace?.().catch(() => setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTOpenTheDataFolder.62ebad"), true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.notchAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote(pomeLocaleRendererWorkspace.t("copy.dataFolderUpdated.d34906"));
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.notchAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTChangeLaunchAtLoginSettings.6452b6"), true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? pomeLocaleRendererWorkspace.t("copy.launchAtLoginEnabled.61caec") : pomeLocaleRendererWorkspace.t("copy.launchAtLoginDisabled.ced994"));
  });
  settingsWeatherEffects?.addEventListener('change', async () => {
    if (!window.notchAPI?.setWeatherEffects) return;
    const previous = settingsAppSettings?.weatherEffects !== false;
    settingsWeatherEffects.disabled = true;
    const result = await window.notchAPI.setWeatherEffects(settingsWeatherEffects.checked).catch(() => ({ ok: false }));
    settingsWeatherEffects.disabled = false;
    settingsWeatherEffects.checked = result?.ok ? result.weatherEffects === true : previous;
    if (result?.ok && settingsAppSettings) settingsAppSettings.weatherEffects = result.weatherEffects === true;
    if (!result?.ok) setSettingsNote(pomeLocaleRendererWorkspace.t('settings.weather.saveFailed'), true);
    else setSettingsNote('');
  });
  settingsTaskNotifications?.addEventListener('change', async () => {
    if (!window.notchAPI?.setTaskNotifications) return;
    settingsTaskNotifications.disabled = true;
    const result = await window.notchAPI.setTaskNotifications(settingsTaskNotifications.checked).catch(() => ({ ok: false }));
    settingsTaskNotifications.disabled = false;
    if (!result?.ok) {
      settingsTaskNotifications.checked = !settingsTaskNotifications.checked;
      setSettingsNote(pomeLocaleRendererWorkspace.t('settings.notifications.topBubbleFailed'), true);
      return;
    }
    settingsTaskNotifications.checked = result.taskNotifications === true;
    if (settingsAppSettings) settingsAppSettings.taskNotifications = result.taskNotifications === true;
    setSettingsNote(result.taskNotifications
      ? pomeLocaleRendererWorkspace.t('settings.notifications.topBubbleEnabled')
      : pomeLocaleRendererWorkspace.t('settings.notifications.topBubbleDisabled'));
  });
  settingsWinNative?.addEventListener('change', async () => {
    if (!window.notchAPI?.setWinNative) return;
    settingsWinNative.disabled = true;
    const result = await window.notchAPI.setWinNative(settingsWinNative.checked).catch(() => ({ ok: false }));
    settingsWinNative.disabled = false;
    if (!result?.ok) {
      settingsWinNative.checked = !settingsWinNative.checked;
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.couldnTSaveNativeCapabilitySettings.795324"), true);
      return;
    }
    settingsWinNative.checked = result.winNative === true;
    if (settingsAppSettings) settingsAppSettings.winNative = result.winNative === true;
    if (!result.winNative) {
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.windowsNativeCapabilitiesDisabled.a1c03b"));
    } else if (result.nativeAvailable === true) {
      setSettingsNote(pomeLocaleRendererWorkspace.t("copy.windowsNativeCapabilitiesEnabledCurrentWindowsAnd.f8de73"));
    } else {
      setSettingsNote(result.nativeReason === 'disabled_by_env'
        ? pomeLocaleRendererWorkspace.t("copy.preferenceSavedButPomeDisableWinNative.875d44")
        : pomeLocaleRendererWorkspace.t("copy.preferenceSavedButNativeModulesFailedTo.66be3f"), true);
    }
  });
  window.notchAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettingsRevision += 1;
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.notchAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());
  window.notchAPI?.onMirrorImageChanged?.(applySettingsMirrorCover);

  function pauseRecordingAudio() {
    currentAudioElement?.pause();
  }

  function releaseRecordingAudio() {
    recordingAudioGeneration += 1;
    pauseRecordingAudio();
    if (currentAudioElement) {
      currentAudioElement.removeAttribute('src');
      currentAudioElement.load();
      currentAudioElement = null;
    }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = '';
  }

  async function loadRecordingAudio(recording, container) {
    const generation = recordingAudioGeneration;
    let result = null;
    try {
      if (recording.audioPath && window.notchAPI?.readRecording) {
        result = await window.notchAPI.readRecording(recording.audioPath);
      }
    } catch { /* A failed read uses the same unavailable state as a missing file. */ }
    // Re-rendering even the same recording invalidates the old read. Never let
    // a late IPC completion replace/revoke the current player's Blob URL.
    if (generation !== recordingAudioGeneration || selectedRecordingId !== recording.id || !container.isConnected) return;
    if (!result?.bytes?.byteLength) {
      pomeLocaleRendererWorkspace.bind(container, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.audioFileUnavailable.d7ce80")));
      return;
    }
    currentAudioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
    const audio = document.createElement('audio');
    audio.controls = false;
    audio.preload = 'metadata';
    audio.addEventListener('error', () => {
      if (generation !== recordingAudioGeneration || currentAudioElement !== audio || !container.isConnected) return;
      releaseRecordingAudio();
      pomeLocaleRendererWorkspace.bind(container, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.audioFileUnavailable.d7ce80")));
    }, { once: true });
    audio.src = currentAudioUrl;
    currentAudioElement = audio;
    container.replaceChildren(createRecordingPlayer(audio, generation, recording.id, container, recording.durationMs));
  }

  function createRecordingPlayer(audio, generation, recordingId, container, durationMs) {
    const player = document.createElement('div');
    player.className = 'recording-player';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'recording-player-toggle';
    toggle.dataset.playerAction = 'toggle';
    const current = document.createElement('time');
    current.className = 'recording-player-current';
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'recording-player-seek';
    seek.min = '0'; seek.max = '0'; seek.step = '.1'; seek.value = '0'; seek.disabled = true;
    pomeLocaleRendererWorkspace.bind(seek, 'ariaLabel', () => pomeLocaleRendererWorkspace.t('workbench.recordings.seek'));
    const duration = document.createElement('time');
    duration.className = 'recording-player-duration';
    const rate = document.createElement('select');
    rate.className = 'recording-player-rate';
    pomeLocaleRendererWorkspace.bind(rate, 'ariaLabel', () => pomeLocaleRendererWorkspace.t('workbench.recordings.speed'));
    for (const value of [.75, 1, 1.25, 1.5, 2]) {
      const option = document.createElement('option');
      option.value = String(value); option.textContent = `${value}×`;
      rate.append(option);
    }
    rate.value = String(audio.playbackRate);
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'recording-player-mute';
    mute.dataset.playerAction = 'mute';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.className = 'recording-player-volume';
    volume.min = '0'; volume.max = '1'; volume.step = '.05'; volume.value = String(audio.volume);
    pomeLocaleRendererWorkspace.bind(volume, 'ariaLabel', () => pomeLocaleRendererWorkspace.t('workbench.recordings.volume'));
    const feedback = document.createElement('span');
    feedback.className = 'recording-player-feedback';
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    // Keep the real media element for decoding and the existing pause/release
    // lifecycle. The controls are a view of its state, never a second clock.
    audio.hidden = true;
    player.append(toggle, current, seek, duration, rate, mute, volume, feedback, audio);
    player.addEventListener('keydown', event => {
      // Native buttons activate on Space keyup. Keep that default while
      // preventing the panel's Space-to-collapse shortcut from intercepting it.
      if ((event.key === ' ' || event.code === 'Space') && event.target.closest('button')) event.stopPropagation();
    });
    let scrubbing = false;
    let renderedPlaying;
    let renderedMuted;
    const isCurrent = () => generation === recordingAudioGeneration && currentAudioElement === audio
      && selectedRecordingId === recordingId && container.isConnected;
    const mediaClock = seconds => formatClock((Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * 1000);
    const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m9 6 9 6-9 6z"/></svg>';
    const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 6h4v12H7zM14 6h4v12h-4z"/></svg>';
    const playableSeconds = () => Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration : (Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0);
    function update() {
      const playableDuration = playableSeconds();
      current.textContent = mediaClock(audio.currentTime);
      duration.textContent = playableDuration ? mediaClock(playableDuration) : '—:—';
      seek.disabled = !playableDuration || audio.readyState < 1;
      seek.max = String(playableDuration);
      if (!scrubbing) seek.value = String(Math.min(playableDuration, audio.currentTime || 0));
      seek.style.setProperty('--player-progress', `${playableDuration ? Math.min(100, (Number(seek.value) / playableDuration) * 100) : 0}%`);
      seek.setAttribute('aria-valuetext', `${mediaClock(Number(seek.value))} / ${duration.textContent}`);
      const playing = !audio.paused && !audio.ended;
      if (renderedPlaying !== playing) {
        toggle.innerHTML = playing ? pauseIcon : playIcon;
        renderedPlaying = playing;
      }
      toggle.setAttribute('aria-pressed', String(playing));
      pomeLocaleRendererWorkspace.bind(toggle, 'ariaLabel', () => pomeLocaleRendererWorkspace.t(playing ? 'copy.pause.8d12fc' : 'copy.play.c33961'));
      const muted = audio.muted || audio.volume === 0;
      // Preserve pointer targets when a media event lands between down/up.
      if (renderedMuted !== muted) {
        mute.innerHTML = muted
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
        renderedMuted = muted;
      }
      mute.setAttribute('aria-pressed', String(muted));
      pomeLocaleRendererWorkspace.bind(mute, 'ariaLabel', () => pomeLocaleRendererWorkspace.t(muted ? 'workbench.recordings.unmute' : 'workbench.recordings.mute'));
      volume.value = String(audio.muted ? 0 : audio.volume);
      volume.style.setProperty('--player-progress', `${Number(volume.value) * 100}%`);
      rate.value = String(audio.playbackRate);
    }
    toggle.addEventListener('click', async () => {
      if (!isCurrent()) return;
      if (!audio.paused) { audio.pause(); return; }
      feedback.hidden = true;
      try { await audio.play(); }
      catch (error) {
        if (!isCurrent() || error?.name === 'AbortError') return;
        pomeLocaleRendererWorkspace.bind(feedback, 'textContent', () => pomeLocaleRendererWorkspace.t('copy.audioFileUnavailable.d7ce80'));
        feedback.hidden = false;
      }
      if (isCurrent()) update();
    });
    seek.addEventListener('pointerdown', () => { scrubbing = true; });
    seek.addEventListener('pointerup', () => { scrubbing = false; update(); });
    seek.addEventListener('pointercancel', () => { scrubbing = false; update(); });
    seek.addEventListener('blur', () => { scrubbing = false; update(); });
    seek.addEventListener('input', () => {
      if (!isCurrent() || audio.readyState < 1 || !playableSeconds()) return;
      audio.currentTime = Math.min(playableSeconds(), Math.max(0, Number(seek.value) || 0));
      update();
    });
    mute.addEventListener('click', () => {
      if (!isCurrent()) return;
      if (audio.volume === 0) { audio.volume = 1; audio.muted = false; }
      else audio.muted = !audio.muted;
      update();
    });
    volume.addEventListener('input', () => {
      if (!isCurrent()) return;
      audio.volume = Math.min(1, Math.max(0, Number(volume.value) || 0));
      audio.muted = audio.volume === 0;
      update();
    });
    rate.addEventListener('change', () => {
      if (isCurrent() && [.75, 1, 1.25, 1.5, 2].includes(Number(rate.value))) audio.playbackRate = Number(rate.value);
    });
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'ratechange']) audio.addEventListener(event, update);
    update();
    return player;
  }

  function renderRecordingDetail() {
    if (!recordingDetail) return;
    releaseRecordingAudio();
    const recording = recordings.find((item) => item.id === selectedRecordingId);
    recordingDetail.replaceChildren();
    if (!recording) {
      const empty = document.createElement('div');
      empty.className = 'recording-detail-empty';
      pomeLocaleRendererWorkspace.bind(empty, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.recordAudioToSaveItAndIts.ace3b5")));
      recordingDetail.appendChild(empty);
      return;
    }
    if (recording.isDraft) {
      const liveHeader = document.createElement('header');
      liveHeader.className = 'recording-live-head';
      const liveState = document.createElement('div');
      liveState.className = 'recording-live-state';
      const liveDot = document.createElement('span');
      liveDot.className = 'recording-state-dot';
      liveDot.dataset.recordingLiveDot = '';
      liveDot.dataset.state = recordingStatus;
      const liveLabel = document.createElement('strong');
      liveLabel.dataset.recordingLiveState = '';
      const liveTime = document.createElement('time');
      liveTime.dataset.recordingLiveTime = '';
      liveState.append(liveDot, liveLabel);
      liveHeader.append(liveState, liveTime);

      const liveAudio = document.createElement('div');
      liveAudio.className = 'recording-live-audio';
      const liveAudioTitle = document.createElement('strong'); liveAudioTitle.dataset.liveAudioTitle='';
      pomeLocaleRendererWorkspace.bind(liveAudioTitle, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.audioIsRecordingLocally.ff0874")));
      const liveAudioHint = document.createElement('span');
      pomeLocaleRendererWorkspace.bind(liveAudioHint, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.aPlayerWillAppearAfterFinishingAnd.c0bdd1")));
      const liveControls = document.createElement('div');
      liveControls.className = 'recording-live-controls';
      const pause = document.createElement('button');
      pause.type = 'button';
      pause.className = 'workspace-button compact recording-live-pause';
      pomeLocaleRendererWorkspace.bind(pause, "textContent", () => (recordingStatus === 'paused' ? pomeLocaleRendererWorkspace.t("copy.resume.7c9691") : pomeLocaleRendererWorkspace.t("copy.pause.8d12fc")));
      pause.addEventListener('click', togglePauseRecording);
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'workspace-button compact primary recording-live-stop';
      pomeLocaleRendererWorkspace.bind(stop, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.finishAndSave.b8c8a0")));
      stop.addEventListener('click', stopRecording);
      liveControls.append(pause, stop);
      liveAudio.append(liveAudioTitle, liveAudioHint, liveControls);

      const transcriptHead = document.createElement('div');
      transcriptHead.className = 'recording-transcript-head';
      const transcriptLabel = document.createElement('span');
      transcriptLabel.className = 'tile-label';
      pomeLocaleRendererWorkspace.bind(transcriptLabel, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.liveTranscription.2b6904")));
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'workspace-button compact recording-live-configure';
      configure.dataset.action = 'configure-transcription';
      pomeLocaleRendererWorkspace.bind(configure, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.configureApi.9bfe1b")));
      configure.addEventListener('click', openTranscriptionSettings);
      transcriptHead.append(transcriptLabel, configure);

      const transcript = document.createElement('textarea');
      transcript.className = 'recording-transcript-editor recording-live-transcript';
      transcript.readOnly = true;
      transcript.dataset.recordingLiveTranscript = '';
      pomeLocaleRendererWorkspace.bind(transcript, "placeholder", () => (pomeLocaleRendererWorkspace.t("copy.startSpeakingToSeeTheTranscriptHere.833551")));
      transcript.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.liveTranscript.792bc7"));
      const feedback = document.createElement('p');
      feedback.className = 'recording-live-feedback';
      feedback.dataset.recordingLiveFeedback = '';
      feedback.setAttribute('aria-live', 'polite');
      recordingDetail.append(liveHeader, liveAudio, transcriptHead, transcript, feedback);
      syncRecordingDraftUi();
      return;
    }
    const header = document.createElement('header');
    header.className = 'recording-detail-head';
    const title = document.createElement('input');
    title.className = 'recording-title-input';
    title.value = recording.title;
    title.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.recordingName.90bfdb"));
    const meta = document.createElement('span');
    pomeLocaleRendererWorkspace.bind(meta, "textContent", () => (`${recording.category || pomeLocaleRendererWorkspace.t("copy.uncategorized.54b89f")} · ${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`));
    header.append(title, meta);
    const syncHint = document.createElement('p');
    syncHint.className = 'settings-nas-sync-hint';
    pomeLocaleRendererWorkspace.bind(syncHint, "textContent", () => (recording.audioSyncReason === 'audio_too_large' ? pomeLocaleRendererWorkspace.t("copy.transcriptAndMetadataCanSyncAudioExceeds.d804a0") : recording.audioOmitted ? pomeLocaleRendererWorkspace.t("copy.transcriptAndMetadataCanSyncAudioIs.9eca76") : pomeLocaleRendererWorkspace.t("copy.audioIsSavedLocallyCheckSettingsNas.a1edd9")));

    const audioWrap = document.createElement('div');
    audioWrap.className = 'recording-audio';
    pomeLocaleRendererWorkspace.bind(audioWrap, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.loadingAudio.fb0408")));

    const transcriptHead = document.createElement('div');
    transcriptHead.className = 'recording-transcript-head';
    const label = document.createElement('span');
    label.className = 'tile-label';
    pomeLocaleRendererWorkspace.bind(label, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.transcript.50c1cf")));
    const actions = document.createElement('div');
    actions.append(
      createIconButton('copy-recording', pomeLocaleRendererWorkspace.t("copy.copyTranscript.75548a"), COPY_ICON),
      createIconButton('reveal-recording', pomeLocaleRendererWorkspace.t("copy.showInFolder.037c31"), OPEN_ICON),
      createIconButton('delete-recording', pomeLocaleRendererWorkspace.t("copy.deleteRecording.56133d"), DELETE_ICON, true)
    );
    transcriptHead.append(label, actions);

    const transcript = document.createElement('textarea');
    transcript.className = 'recording-transcript-editor';
    transcript.value = recording.transcript;
    pomeLocaleRendererWorkspace.bind(transcript, "placeholder", () => (pomeLocaleRendererWorkspace.t("copy.noLiveTranscriptWasGeneratedYouCan.5e3a1b")));
    transcript.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.recordingTranscript.0ad282"));
    recordingDetail.append(header, syncHint, audioWrap, transcriptHead, transcript);

    title.addEventListener('change', () => {
      if (title.value.trim()) recording.title = title.value.trim();
      title.value = recording.title;
      persistRecordings();
      renderRecordingList();
    });
    transcript.addEventListener('input', () => {
      recording.transcript = transcript.value;
      persistRecordings();
    });
    actions.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'copy-recording' && window.notchAPI && recording.transcript) {
        await window.notchAPI.writeClipboard({ type: 'text', text: recording.transcript });
      }
      if (action.dataset.action === 'reveal-recording' && window.notchAPI && recording.audioPath) {
        await window.notchAPI.revealRecording(recording.audioPath);
      }
      if (action.dataset.action === 'delete-recording') {
        await deleteSingleRecording(recording.id);
      }
    });
    loadRecordingAudio(recording, audioWrap);
  }

  async function deleteSingleRecording(recordingId) {
    let recording = recordings.find((item) => item.id === recordingId);
    if (!recording || recording.isDraft) return;
    const expectedPath = recording.audioPath;
    if (!await window.PomeDeleteConfirm.open({titleKey:'copy.deleteRecording.56133d',items:[recording.title],messageKey:'ui.delete.recordingHint'})) return;
    recording = recordings.find(item => item.id === recordingId);
    if (!recording || recording.isDraft || recording.audioPath !== expectedPath) return;
    if (recording.audioPath) {
      const deleted = await window.notchAPI?.deleteRecording?.(recording.audioPath)?.catch(() => false);
      if (deleted !== true) { reportRecordingDeleteFailure(() => deleteSingleRecording(recordingId)); return; }
    }
    if (!recordings.some(item => item.id === recordingId && item.audioPath === expectedPath && !item.isDraft)) return;
    const next = Domain.removeRecordingState(
      recordings,
      recording.id,
      [...recordingSelection],
      selectedRecordingId
    );
    recordings = next.recordings;
    recordingSelection = new Set(next.selection);
    selectedRecordingId = next.selectedId;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
    window.NotchUi?.clearError?.('recordings:delete');
  }

  function reportRecordingDeleteFailure(onRepair = renderRecordings) {
    window.NotchUi?.showError?.({ messageKey: 'copy.deleteFailedTryAgainLater.782a6b', repairKey: 'workbench.recordings.deleteRepair',
      diagnostic: 'Recordings: delete_failed', scope: 'recordings:delete', onRepair });
  }

  function renderRecordingList() {
    if (!recordingList) return;
    recordingList.replaceChildren();
    if (recordingBulkDelete) {
      recordingBulkDelete.hidden = recordingSelection.size === 0;
      pomeLocaleRendererWorkspace.bind(recordingBulkDelete, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.delete.2f9daa")));
      recordingBulkDelete.setAttribute('aria-label', recordingSelection.size
        ? pomeLocaleRendererWorkspace.t("copy.deleteItems.0bfa6f", { arg1: (recordingSelection.size) })
        : pomeLocaleRendererWorkspace.t("copy.deleteSelected.435bf8"));
    }
    if (!recordings.length) {
      const empty = document.createElement('div');
      empty.className = 'recording-list-empty';
      pomeLocaleRendererWorkspace.bind(empty, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.noRecordingsYet.d8f480")));
      recordingList.appendChild(empty);
      return;
    }
    recordings.forEach((recording) => {
      const row = document.createElement('div');
      row.className = `recording-item${recording.id === selectedRecordingId ? ' active' : ''}${recordingSelection.has(recording.id) ? ' multi-selected' : ''}${recording.isDraft ? ' is-live' : ''}`;
      row.dataset.id = recording.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recording-item-main';
      button.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.openRecording.537c31", { arg1: (recording.title) }));
      const title = document.createElement('strong');
      title.textContent = recording.title;
      const preview = document.createElement('span');
      preview.dataset.recordingPreview = '';
      pomeLocaleRendererWorkspace.bind(preview, "textContent", () => (recording.isDraft ? (currentRecordingText() || currentRecordingFeedback()) : (recording.transcript || pomeLocaleRendererWorkspace.t("copy.audioOnlyNoTranscriptYet.a03d79"))));
      const meta = document.createElement('time');
      meta.dataset.recordingMeta = '';
      pomeLocaleRendererWorkspace.bind(meta, "textContent", () => (recording.isDraft
        ? `${recordingStatus === 'saving' ? pomeLocaleRendererWorkspace.t("copy.saving.a1a172") : recordingStatus === 'paused' ? pomeLocaleRendererWorkspace.t("copy.paused.eb0c32") : pomeLocaleRendererWorkspace.t("copy.recording.e35a14")} · ${formatClock(recording.durationMs)}`
        : `${formatShortDate(recording.createdAt)} · ${formatClock(recording.durationMs)}`));
      button.append(title, preview, meta);
      row.append(button);
      if (!recording.isDraft) {
        const remove = createIconButton('delete-recording-item', pomeLocaleRendererWorkspace.t("copy.deleteRecording.611aa8", { arg1: (recording.title) }), DELETE_ICON, true);
        remove.classList.add('recording-item-delete');
        row.append(remove);
      }
      recordingList.appendChild(row);
    });
  }

  function renderRecordings() {
    if (recordingCount) pomeLocaleRendererWorkspace.bind(recordingCount, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.items.1d26a0", { arg1: (recordings.length) })));
    renderRecordingList();
    renderRecordingDetail();
  }

  if (recordingList) {
    recordingList.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-action="delete-recording-item"]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('.recording-item[data-id]');
        if (row) await deleteSingleRecording(row.dataset.id);
        return;
      }
      const item = event.target.closest('.recording-item[data-id]');
      if (!item) return;
      const targetRecording = recordings.find((recording) => recording.id === item.dataset.id);
      if (event.shiftKey && targetRecording && !targetRecording.isDraft) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          recordings.filter((recording) => !recording.isDraft).map((recording) => recording.id),
          [...recordingSelection],
          item.dataset.id,
          recordingSelectionAnchor,
          true
        );
        recordingSelection = new Set(result.selected);
        recordingSelectionAnchor = result.anchor;
        renderRecordingList();
        return;
      }
      selectedRecordingId = item.dataset.id;
      recordingSelectionAnchor = selectedRecordingId;
      renderRecordings();
    });
  }

  recordingBulkDelete?.addEventListener('click', async () => {
    if (!recordingSelection.size) return;
    const targets = recordings.filter((recording) => !recording.isDraft && recordingSelection.has(recording.id));
    if (!targets.length) return;
    if (!await window.PomeDeleteConfirm.open({items:targets.map(recording => recording.title),messageKey:'ui.delete.recordingHint'})) return;
    if (targets.some(target => {
      const current = recordings.find(item => item.id === target.id);
      return current && (current.isDraft || current.audioPath !== target.audioPath);
    })) return;
    const results = await Promise.all(targets.map(async recording => ({
      id: recording.id, path: recording.audioPath,
      ok: !recording.audioPath || (await window.notchAPI?.deleteRecording?.(recording.audioPath)?.catch(() => false)) === true,
    })));
    const deleted = new Map(results.filter(result => result.ok).map(result => [result.id, result.path]));
    const removed = new Set(recordings.filter(recording => deleted.has(recording.id)
      && deleted.get(recording.id) === recording.audioPath && !recording.isDraft).map(recording => recording.id));
    recordings = recordings.filter(recording => !removed.has(recording.id));
    removed.forEach(id => recordingSelection.delete(id));
    if (removed.has(selectedRecordingId)) selectedRecordingId = recordings[0]?.id || '';
    if (results.some(result => !result.ok)) reportRecordingDeleteFailure(() => recordingBulkDelete?.click());
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
    if (results.every(result => result.ok)) window.NotchUi?.clearError?.('recordings:delete');
  });

  // ============ 当前窗口 ============
  const windowsRefresh = document.getElementById('windows-refresh');
  const windowsHidden = document.getElementById('windows-hidden');
  const windowList = document.getElementById('window-list');
  const windowsCount=document.createElement('span');windowsCount.className='windows-count';windowsCount.hidden=true;
  document.querySelector('.home-windows .tile-label')?.after(windowsCount);
  let windows = [];
  let hiddenWindows = new Set(loadJson(HIDDEN_WINDOWS_KEY, []).filter((item) => typeof item === 'string'));
  let windowsLoading = false;
  let focusingWindowId = null;
  let workspaceTab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  let workspaceExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  let homeWindowsVisible = window.NotchHome?.isVisible?.('windows') !== false;
  let windowDrag = null;
  let suppressWindowClickUntil = 0;

  function windowHideKey(windowInfo) {
    if(windowInfo.axWindowId||windowInfo.handle||windowInfo.windowNumber)return 'id:'+windowInfo.id;
    return legacyWindowHideKey(windowInfo);
  }

  function legacyWindowHideKey(item){return `${String(item.appName||'').trim()}\u0000${String(item.title||'').trim()}`;}

  function persistHiddenWindows() {
    saveJson(HIDDEN_WINDOWS_KEY, [...hiddenWindows]);
  }

  function clearWindowDragVisuals() {
    const drag = windowDrag;
    windowDrag = null;
    if (drag) {
      clearTimeout(drag.timer);
      try {
        if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
      } catch (error) {}
      drag.item.classList.remove('dragging', 'remove-ready');
      drag.item.style.removeProperty('--window-drag-x');
      drag.item.style.removeProperty('--window-drag-y');
    }
    document.querySelectorAll('.home-windows.drag-active').forEach((card) => {
      card.classList.remove('drag-active');
    });
    return drag;
  }

  function renderWindows(error = '') {
    if (!windowList) return;
    windowsCount.hidden=true;
    // 轮询可能在长按过程中重建列表；先清理捕获与卡片移除态，避免红色区域残留。
    clearWindowDragVisuals();
    const scrollTop=windowList.scrollTop,focusId=windowList.contains(document.activeElement)?document.activeElement.closest('[data-id]')?.dataset.id:null;
    windowList.replaceChildren();
    if(error==='window_scan_failed'){
      const empty=document.createElement('div');empty.className='window-empty';empty.textContent=pomeLocaleRendererWorkspace.t('windows.scanFailed');windowList.append(empty);return;
    }
    if (error === 'native_unavailable' || error === 'unsupported') {
      // Windows：原生绑定没加载（实验开关关着、POME_DISABLE_WIN_NATIVE=1 或 koffi 加载失败）。
      // 这里不是权限问题，也没有系统设置可开，只说清状态。
      const empty = document.createElement('div');
      empty.className = 'window-empty permission';
      const heading = document.createElement('strong');
      pomeLocaleRendererWorkspace.bind(heading, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.currentWindowsUnavailable.d6a9a7")));
      const hint = document.createElement('span');
      pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (pomeLocaleRendererWorkspace.t('ui.windows.hint')));
      const repairNative = () => { void setActiveTab('settings').then(() => settingsWinNativeRow?.scrollIntoView({ block: 'center' })); };
      const enable = document.createElement('button'); enable.type = 'button'; enable.className = 'workspace-button compact primary'; enable.id = 'ui-enable-win-native';
      pomeLocaleRendererWorkspace.bind(enable, 'textContent', () => pomeLocaleRendererWorkspace.t('ui.windows.enable'));
      enable.addEventListener('click', async () => {
        enable.disabled = true;
        try {
          const result = await window.notchAPI.setWinNative(true);
          if (!result?.ok || !result.nativeAvailable) { window.NotchUi?.showError({ diagnostic: result?.nativeReason || result?.error || 'native_unavailable', repairKey: 'ui.windows.unavailable', onRepair: repairNative }); return; }
          await refreshWindows(true);
        } catch { window.NotchUi?.showError({ diagnostic: 'native_unavailable', repairKey: 'ui.windows.unavailable', onRepair: repairNative }); }
        finally { if (enable.isConnected) enable.disabled = false; }
      });
      empty.append(heading, hint);
      if (window.notchAPI?.capabilities?.features?.winNativeSetting) empty.append(enable);
      windowList.appendChild(empty);
      return;
    }
    if (error) {
      const empty = document.createElement('div');
      empty.className = 'window-empty permission';
      // 两种权限的现象完全一样（列表空），但要开的开关不同，必须分开说：
      // 「屏幕录制」决定能不能读到窗口标题，「辅助功能」决定能不能枚举和聚焦窗口。
      // 缺屏幕录制时系统既不报错也不弹提示，所以只能由这里告诉用户。
      const screenRecording = error === 'screen_recording_permission_required';
      const title = screenRecording ? pomeLocaleRendererWorkspace.t("copy.screenRecordingPermissionRequired.039981") : pomeLocaleRendererWorkspace.t("copy.accessibilityPermissionRequired.d0e69c");
      const pane = screenRecording ? pomeLocaleRendererWorkspace.t("copy.screenSystemAudioRecording.83f384") : pomeLocaleRendererWorkspace.t("copy.accessibility.b8f88a");
      const heading = document.createElement('strong');
      heading.textContent = title;
      const hint = document.createElement('span');
      pomeLocaleRendererWorkspace.bind(hint, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.systemSettingsPrivacySecurityAllowPomePanel.fe568f", { arg1: (pane) })));
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'window-permission-open';
      pomeLocaleRendererWorkspace.bind(action, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.openSystemSettings.0407db")));
      action.addEventListener('click', () => {
        if (window.notchAPI && typeof window.notchAPI.openPrivacySettings === 'function') {
          window.notchAPI.openPrivacySettings(screenRecording ? 'screen-recording' : 'accessibility');
        }
      });
      empty.append(heading, hint, action);
      windowList.appendChild(empty);
      return;
    }
    const visibleWindows = Domain.numberWindowLabels(
      windows.filter(item=>!hiddenWindows.has(windowHideKey(item))&&!hiddenWindows.has(legacyWindowHideKey(item)))
        .sort((a,b)=>String(a.appName).localeCompare(String(b.appName))||String(a.id).localeCompare(String(b.id),undefined,{numeric:true}))
    );
    windowsCount.hidden=visibleWindows.length===0;windowsCount.textContent=String(visibleWindows.length);
    pomeLocaleRendererWorkspace.bind(windowsCount,'title',()=>pomeLocaleRendererWorkspace.t('windows.count',{count:visibleWindows.length}));
    if (windowsHidden) {
      windowsHidden.hidden = hiddenWindows.size === 0;
      pomeLocaleRendererWorkspace.bind(windowsHidden, "textContent", () => (pomeLocaleRendererWorkspace.t('windows.restoreHidden',{count:hiddenWindows.size})));
      windowsHidden.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.restoreHiddenWindows.3bacb0", { arg1: (hiddenWindows.size) }));
    }
    if (!visibleWindows.length) {
      const empty = document.createElement('div');
      empty.className = 'window-empty';
      pomeLocaleRendererWorkspace.bind(empty, "textContent", () => (windowsLoading
        ? pomeLocaleRendererWorkspace.t("copy.readingCurrentWindows.7a1554")
        : hiddenWindows.size
          ? pomeLocaleRendererWorkspace.t("copy.allWindowsHiddenRestoreThemAbove.5d9517")
          : pomeLocaleRendererWorkspace.t("ux.windows.empty")));
      windowList.appendChild(empty);
      return;
    }
    visibleWindows.forEach((windowInfo) => {
      const button = document.createElement('button');
      button.className = 'window-item';
      button.type = 'button';
      button.dataset.id = windowInfo.id;
      button.setAttribute('aria-label',`${windowInfo.title} · ${windowInfo.appName}`);
      pomeLocaleRendererWorkspace.bind(button, "title", () => (pomeLocaleRendererWorkspace.t("copy.pressAndHoldThenDragOutsideThe.8d9a71", { arg1: (windowInfo.displayName), arg2: (windowInfo.title) })));
      const mark = document.createElement('span');
      mark.className = 'window-app-mark';
      if (windowInfo.icon) {
        const icon = document.createElement('img');
        icon.src = windowInfo.icon;
        icon.alt = '';
        icon.draggable = false;
        mark.appendChild(icon);
      } else {
        mark.textContent = (windowInfo.appName.charAt(0) || '·').toUpperCase();
      }
      const appName = document.createElement('strong');
      appName.textContent = windowInfo.displayName;
      const copy=document.createElement('span');copy.className='window-copy';
      const application=document.createElement('span');application.className='window-application';
      pomeLocaleRendererWorkspace.bind(application,'textContent',()=>windowInfo.appName+(windowInfo.minimized?' · '+pomeLocaleRendererWorkspace.t('windows.minimized'):''));
      copy.append(appName,application);button.append(mark,copy);
      windowList.appendChild(button);
    });
    windowList.scrollTop=scrollTop;
    if(focusId){const row=[...windowList.querySelectorAll('[data-id]')].find(e=>e.dataset.id===focusId);row?.focus({preventScroll:true});}
  }

  async function refreshWindows(force = false) {
    if (!window.NotchHome?.isVisible?.('windows')) return;
    if (windowsLoading || focusingWindowId || !window.notchAPI || (!force && (!workspaceExpanded || workspaceTab !== 'home'))) return;
    windowsLoading = true;
    renderWindows();
    let result;
    try {
      result = await window.notchAPI.listWindows(force);
    } catch (error) {
      result = { items: [], error: 'window_scan_failed' };
    }
    windowsLoading = false;
    windows = result && Array.isArray(result.items) ? result.items : [];
    if(result?.error==='window_scan_failed')window.NotchUi?.showError({messageKey:'windows.scanFailed',scope:'windows:list',onRepair:()=>refreshWindows(true)});
    else if(!result?.error)window.NotchUi?.clearError('windows:list');
    renderWindows(result && result.error);
  }

  if (windowsRefresh) windowsRefresh.addEventListener('click', () => refreshWindows(true));
  if (windowsHidden) {
    windowsHidden.addEventListener('click', () => {
      hiddenWindows.clear();
      persistHiddenWindows();
      renderWindows();
    });
  }
  if (windowList) {
    windowList.addEventListener('click', async (event) => {
      if (Date.now() < suppressWindowClickUntil || focusingWindowId) return;
      const item = event.target.closest('.window-item[data-id]');
      if(!item||!window.notchAPI)return;
      focusingWindowId=item.dataset.id;item.setAttribute('aria-disabled','true');item.setAttribute('aria-busy','true');
      try{
        const focused=await window.notchAPI.focusWindow(focusingWindowId);
        if(!focused)throw new Error('window_focus_failed');
        window.NotchUi?.clearError('windows:focus');
      }catch{
        window.NotchUi?.showError({messageKey:'windows.focusFailed',scope:'windows:focus',onRepair:()=>refreshWindows(true)});
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(!item.isConnected||document.activeElement!==item)return;
          const row=item.getBoundingClientRect(),list=windowList.getBoundingClientRect();
          const home=windowList.closest('.home-bento')?.getBoundingClientRect()||list;
          const top=Math.max(list.top,home.top),bottom=Math.min(list.bottom,home.bottom);
          // Keep the failed target visible inside this list; do not scroll the
          // whole Home page when the error bar reduces the available height.
          if(row.top<top)windowList.scrollTop-=top-row.top;
          else if(row.bottom>bottom)windowList.scrollTop+=row.bottom-bottom;
        }));
      }finally{focusingWindowId=null;item.removeAttribute('aria-disabled');item.removeAttribute('aria-busy');}

    });
    windowList.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || windowDrag) return;
      const item = event.target.closest('.window-item[data-id]');
      if (!item) return;
      windowDrag = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        removeReady: false,
        timer: setTimeout(() => {
          if (!windowDrag || windowDrag.item !== item) return;
          windowDrag.active = true;
          item.classList.add('dragging');
          try { item.setPointerCapture(event.pointerId); } catch (error) {}
          item.closest('.home-windows')?.classList.add('drag-active');
        }, 460),
      };
    });
    document.addEventListener('pointermove', (event) => {
      if (!windowDrag || windowDrag.pointerId !== event.pointerId) return;
      const dx = event.clientX - windowDrag.startX;
      const dy = event.clientY - windowDrag.startY;
      if (!windowDrag.active) {
        if (Math.hypot(dx, dy) > 8) {
          clearTimeout(windowDrag.timer);
          windowDrag = null;
        }
        return;
      }
      event.preventDefault();
      windowDrag.item.style.setProperty('--window-drag-x', `${dx}px`);
      windowDrag.item.style.setProperty('--window-drag-y', `${dy}px`);
      const bounds = windowList.closest('.home-windows').getBoundingClientRect();
      windowDrag.removeReady = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      windowDrag.item.classList.toggle('remove-ready', windowDrag.removeReady);
    });
    const finishWindowDrag = (event) => {
      if (!windowDrag || (event.pointerId != null && windowDrag.pointerId !== event.pointerId)) return;
      const drag = clearWindowDragVisuals();
      if (!drag) return;
      if (!drag.active) return;
      suppressWindowClickUntil = Date.now() + 450;
      if (drag.removeReady) {
        const windowInfo = windows.find((item) => item.id === drag.item.dataset.id);
        if (windowInfo) {
          hiddenWindows.add(windowHideKey(windowInfo));
          persistHiddenWindows();
          renderWindows();
        }
      }
    };
    document.addEventListener('pointerup', finishWindowDrag);
    // Cancellation (OS gesture, capture loss, etc.) is not a drop. In
    // particular it must not persist a window hidden in the removal zone.
    document.addEventListener('pointercancel', (event) => {
      if (windowDrag && (event.pointerId == null || windowDrag.pointerId === event.pointerId)) clearWindowDragVisuals();
    });
    windowList.addEventListener('lostpointercapture', () => clearWindowDragVisuals(), true);
    window.addEventListener('blur', clearWindowDragVisuals);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearWindowDragVisuals();
    });
  }

  document.addEventListener('notch:tabchange', (event) => {
    clearWindowDragVisuals();
    workspaceTab = event.detail && event.detail.tab || 'home';
    if (workspaceTab !== 'recordings') pauseRecordingAudio();
    if (workspaceTab === 'home') refreshWindows();
    if (workspaceTab === 'settings') refreshSettingsPanel();
  });
  document.addEventListener('notch:modechange', (event) => {
    clearWindowDragVisuals();
    workspaceExpanded = !!(event.detail && event.detail.expanded);
    if (!workspaceExpanded) pauseRecordingAudio();
    if (workspaceExpanded && workspaceTab === 'home') refreshWindows();
  });
  document.addEventListener('notch:home-modules-changed', (event) => {
    const nextVisible = Array.isArray(event.detail?.visibleIds)
      ? event.detail.visibleIds.includes('windows')
      : window.NotchHome?.isVisible?.('windows') !== false;
    const restored = !homeWindowsVisible && nextVisible;
    homeWindowsVisible = nextVisible;
    renderHomeModuleSettings();
    if (restored && workspaceExpanded && workspaceTab === 'home') refreshWindows(true);
  });
  document.addEventListener('notch:recording-state-changed', renderHomeModuleSettings);
  document.addEventListener('notch:will-collapse', clearWindowDragVisuals);
  document.addEventListener('notch:will-collapse', pauseRecordingAudio);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseRecordingAudio();
  });
  document.addEventListener('notch:window-visibility', event => {
    if (!event.detail?.visible) { clearWindowDragVisuals(); pauseRecordingAudio(); }
  });

  // ============ 本地汽水音乐 ============
  const homeMusic = document.getElementById('home-music');
  const musicArtwork = document.getElementById('music-artwork');
  const musicTitle = document.getElementById('music-title');
  const musicStatus = document.getElementById('music-status');
  const musicPlayToggle = document.getElementById('music-play-toggle');
  let musicPlaying = false;

  function renderMusicPlaybackState() {
    if (!homeMusic || !musicPlayToggle) return;
    homeMusic.classList.toggle('music-playing', musicPlaying);
    musicPlayToggle.dataset.musicAction = musicPlaying ? 'pause' : 'play';
    musicPlayToggle.setAttribute('aria-label', musicPlaying ? pomeLocaleRendererWorkspace.t("copy.pause.8d12fc") : pomeLocaleRendererWorkspace.t("copy.play.c33961"));
    musicPlayToggle.innerHTML = musicPlaying
      ? '<svg viewBox="0 0 24 24"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
      : '<svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5z" /></svg>';
  }

  async function refreshMusicStatus() {
    if (!homeMusic || !window.notchAPI || typeof window.notchAPI.getMusicStatus !== 'function') return;
    let status;
    try { status = await window.notchAPI.getMusicStatus(); } catch (error) { status = null; }
    homeMusic.classList.toggle('music-running', Boolean(status && status.running));
    homeMusic.dataset.installed = String(status?.installed === true);
    homeMusic.querySelectorAll('[data-music-action]').forEach(button => { button.disabled = status?.installed !== true; });
    if (status && typeof status.playing === 'boolean') {
      musicPlaying = status.playing;
      renderMusicPlaybackState();
    }
    if (status && status.icon && musicArtwork) {
      musicArtwork.replaceChildren();
      const image = document.createElement('img');
      image.src = status.icon;
      image.alt = '';
      musicArtwork.appendChild(image);
    }
    if (musicTitle) pomeLocaleRendererWorkspace.bind(musicTitle, "textContent", () => (status && status.installed ? pomeLocaleRendererWorkspace.t("copy.sodaMusic.f8cff8") : pomeLocaleRendererWorkspace.t("copy.sodaMusicIsnTInstalled.874f9a")));
    if (musicStatus) pomeLocaleRendererWorkspace.bind(musicStatus, "textContent", () => (status && status.running ? (musicPlaying ? pomeLocaleRendererWorkspace.t("copy.playing.e6666b") : pomeLocaleRendererWorkspace.t("copy.connected.5be032")) : status && status.installed ? pomeLocaleRendererWorkspace.t("copy.tapToPlay.48ee2b") : pomeLocaleRendererWorkspace.t("copy.localAppRequired.06b808")));
  }

  homeMusic?.addEventListener('click', async (event) => {
    if (event.target.closest('.widget-layout-control') || !window.notchAPI || homeMusic.dataset.installed === 'false') return;
    const control = event.target.closest('[data-music-action]') || musicPlayToggle;
    if (!control) return;
    event.stopPropagation();
    control.disabled = true;
    const action = control.dataset.musicAction;
    let result;
    try { result = await window.notchAPI.controlMusic(action); } catch (error) { result = { ok: false }; }
    control.disabled = false;
    if (!result || !result.ok) {
      const needsSession = result && ['no_active_session', 'soda_session_inactive'].includes(result.error);
      const needsPermission = result && result.error === 'accessibility_permission_required';
      if (musicStatus) pomeLocaleRendererWorkspace.bind(musicStatus, "textContent", () => (result && result.error === 'not_installed'
        ? pomeLocaleRendererWorkspace.t("copy.localAppRequired.06b808")
        : needsPermission ? pomeLocaleRendererWorkspace.t("copy.accessibilityPermissionRequired.914807")
          : needsSession ? pomeLocaleRendererWorkspace.t("copy.pressPlayFirst.7194f0") : pomeLocaleRendererWorkspace.t("copy.controlsUnavailable.1279c0")));
      if (typeof showStatusToast === 'function') {
        showStatusToast(result && result.error === 'not_installed'
          ? pomeLocaleRendererWorkspace.t("copy.sodaMusicIsnTInstalled.874f9a")
          : needsPermission ? pomeLocaleRendererWorkspace.t("copy.allowPomePanelInSystemSettingsAccessibility.a9647f")
            : needsSession ? pomeLocaleRendererWorkspace.t("copy.pressPlayBeforeUsingTrackControls.b5e463") : pomeLocaleRendererWorkspace.t("copy.sodaMusicControlsUnavailable.6b9043"));
      }
    } else {
      if (typeof result.playing === 'boolean') musicPlaying = result.playing;
      else if (action === 'play') musicPlaying = true;
      else if (action === 'pause') musicPlaying = false;
      renderMusicPlaybackState();
      if (musicStatus) pomeLocaleRendererWorkspace.bind(musicStatus, "textContent", () => (action === 'next' ? pomeLocaleRendererWorkspace.t("copy.nextTrack.486e42") : action === 'previous' ? pomeLocaleRendererWorkspace.t("copy.previousTrack.8c7479") : musicPlaying ? pomeLocaleRendererWorkspace.t("copy.playing.e6666b") : pomeLocaleRendererWorkspace.t("copy.paused.eb0c32")));
    }
    setTimeout(refreshMusicStatus, 500);
  });

  renderMusicPlaybackState();

  // ============ 本机加密密钥库 ============
  const credentialService = document.getElementById('credential-service');
  const credentialAccount = document.getElementById('credential-account');
  const credentialPassword = document.getElementById('credential-password');
  const credentialSave = document.getElementById('credential-save');
  const credentialList = document.getElementById('credential-list');
  const credentialCount = document.getElementById('credential-count');
  const credentialSearch = document.getElementById('credential-search');
  const credentialBulkDelete = document.getElementById('credential-bulk-delete');
  const credentialsNote = document.getElementById('credentials-note');
  let credentials = [];
  let credentialsReadFailed = false;
  let credentialSelection = new Set();
  let credentialAnchor = null;
  let editingCredentialId = '';
  let editingCredential = null;
  let credentialEditGeneration = 0;
  let pendingCredentialEditId = '';
  let credentialsLoadGeneration = 0;
  const credentialSavesInFlight = new Set();
  let credentialCreateGeneration = 0;
  let credentialCreateEscapeAt = -Infinity;

  function maskCredentialCreate() {
    if (!credentialPassword) return;
    credentialPassword.type = 'password';
    const reveal = credentialPassword.parentElement?.querySelector('[data-credential-reveal]');
    if (reveal) {
      pomeLocaleRendererWorkspace.bind(reveal, 'textContent', () => pomeLocaleRendererWorkspace.t('copy.show.4e1449'));
      reveal.setAttribute('aria-pressed', 'false');
    }
  }

  function closeCredentialCreate() {
    credentialCreateGeneration += 1;
    maskCredentialCreate();
  }

  function closeCredentialCreateOnEscape() {
    // Chromium and main-process IPC can deliver the same physical Escape twice.
    if (performance.now() - credentialCreateEscapeAt < 150) return true;
    if (credentialPassword?.type !== 'text') return false;
    credentialCreateEscapeAt = performance.now();
    maskCredentialCreate();
    return true;
  }

  function invalidateCredentialEdit({ clear = false } = {}) {
    credentialEditGeneration += 1;
    pendingCredentialEditId = '';
    if (clear) {
      editingCredentialId = '';
      editingCredential = null;
    }
  }

  function updateCredentialBulkAction() {
    if (!credentialBulkDelete) return;
    credentialBulkDelete.hidden = credentialSelection.size === 0;
    credentialBulkDelete.disabled = credentialsReadFailed;
    pomeLocaleRendererWorkspace.bind(credentialBulkDelete, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.delete.2f9daa")));
    credentialBulkDelete.setAttribute('aria-label', credentialSelection.size
      ? pomeLocaleRendererWorkspace.t("copy.deleteItems.0bfa6f", { arg1: (credentialSelection.size) })
      : pomeLocaleRendererWorkspace.t("copy.deleteSelected.435bf8"));
  }

  function animateCredentialExpansion(originRect) {
    const row = credentialList?.querySelector(`.credential-item.editing[data-id="${CSS.escape(editingCredentialId)}"]`);
    if (!row || !originRect || typeof row.animate !== 'function') return;
    requestAnimationFrame(() => {
      const targetRect = row.getBoundingClientRect();
      const scaleX = Math.max(0.2, originRect.width / Math.max(1, targetRect.width));
      const scaleY = Math.max(0.2, originRect.height / Math.max(1, targetRect.height));
      row.animate([
        {
          opacity: .72,
          transform: `translate(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });
    });
  }

  function renderCredentials() {
    const visibleCredentials = Domain.filterCredentials(credentials, credentialSearch?.value || '');
    if (credentialCount) pomeLocaleRendererWorkspace.bind(credentialCount, "textContent", () => (credentialSearch?.value.trim()
      ? pomeLocaleRendererWorkspace.t("copy.items.ab715f", { arg1: (visibleCredentials.length), arg2: (credentials.length) })
      : pomeLocaleRendererWorkspace.t("copy.items.5b6b44", { arg1: (credentials.length) })));
    if (!credentialList) return;
    const activeInput = credentialList.contains(document.activeElement)
      && document.activeElement.closest('.credential-item.editing')?.dataset.id === editingCredentialId
      ? document.activeElement : null;
    const focusedField = activeInput?.name;
    const selection = activeInput ? [activeInput.selectionStart, activeInput.selectionEnd] : null;
    credentialList.replaceChildren();
    if (!visibleCredentials.length) {
      const empty = document.createElement('div');
      empty.className = 'credential-empty';
      if (credentialsReadFailed) {
        const title = document.createElement('strong'), detail = document.createElement('span');
        pomeLocaleRendererWorkspace.bind(title, 'textContent', () => pomeLocaleRendererWorkspace.t('credentials.readFailed'));
        pomeLocaleRendererWorkspace.bind(detail, 'textContent', () => pomeLocaleRendererWorkspace.t('credentials.readRepair'));
        empty.append(title, detail); credentialList.appendChild(empty); updateCredentialBulkAction(); return;
      }
      empty.innerHTML = credentials.length
        ? ("<strong><span data-i18n=\"copy.noMatchingCredentials.071998\">" + (pomeLocaleRendererWorkspace.t("copy.noMatchingCredentials.071998")) + "</span></strong><span><span data-i18n=\"copy.searchByNameOrAccount.a5bd89\">" + (pomeLocaleRendererWorkspace.t("copy.searchByNameOrAccount.a5bd89")) + "</span></span>")
        : ("<strong><span data-i18n=\"copy.noSavedCredentialsYet.8bcc78\">" + (pomeLocaleRendererWorkspace.t("copy.noSavedCredentialsYet.8bcc78")) + "</span></strong><span><span data-i18n=\"copy.accountsAndPasswordsAreEncryptedOnThis.60f62e\">" + (pomeLocaleRendererWorkspace.t("copy.accountsAndPasswordsAreEncryptedOnThis.60f62e")) + "</span></span>");
      credentialList.appendChild(empty);
      updateCredentialBulkAction();
      return;
    }
    visibleCredentials.forEach((credential) => {
      if (editingCredentialId === credential.id && editingCredential) {
        const form = document.createElement('form');
        form.className = 'credential-item editing';
        form.dataset.id = credential.id;
        form.innerHTML = ("\n          <div class=\"credential-edit-head\"><strong><span data-i18n=\"copy.editCredential.3c8db5\">" + (pomeLocaleRendererWorkspace.t("copy.editCredential.3c8db5")) + "</span></strong><span><span data-i18n=\"copy.pressEnterToSave.c1c0ad\">" + (pomeLocaleRendererWorkspace.t("copy.pressEnterToSave.c1c0ad")) + "</span></span></div>\n          <label><span><span data-i18n=\"copy.service.ec309a\">" + (pomeLocaleRendererWorkspace.t("copy.service.ec309a")) + "</span></span><input name=\"service\" maxlength=\"80\" autocomplete=\"off\" /></label>\n          <label><span><span data-i18n=\"copy.account.311bb3\">" + (pomeLocaleRendererWorkspace.t("copy.account.311bb3")) + "</span></span><input name=\"account\" maxlength=\"320\" autocomplete=\"off\" /></label>\n          <label><span><span data-i18n=\"copy.password.a621ab\">" + (pomeLocaleRendererWorkspace.t("copy.password.a621ab")) + "</span></span><span class=\"credential-password-field\"><input name=\"password\" type=\"password\" maxlength=\"4096\" autocomplete=\"off\" spellcheck=\"false\" /><button type=\"button\" data-credential-reveal aria-pressed=\"false\"><span data-i18n=\"copy.show.4e1449\">" + (pomeLocaleRendererWorkspace.t("copy.show.4e1449")) + "</span></button></span></label>\n          <div class=\"credential-edit-actions\"><button type=\"button\" data-credential-cancel><span data-i18n=\"copy.cancel.2cd0f3\">" + (pomeLocaleRendererWorkspace.t("copy.cancel.2cd0f3")) + "</span></button><button type=\"submit\"><span data-i18n=\"copy.save.a3030b\">" + (pomeLocaleRendererWorkspace.t("copy.save.a3030b")) + "</span></button></div>\n        ");
        form.elements.service.value = editingCredential.service || '';
        form.elements.account.value = editingCredential.account || '';
        form.elements.password.value = editingCredential.password || '';
        form.querySelector('button[type="submit"]').disabled = credentialsReadFailed || credentialSavesInFlight.has(credentialEditGeneration);
        credentialList.appendChild(form);
        return;
      }
      const row = document.createElement('article');
      row.className = `credential-item${credentialSelection.has(credential.id) ? ' multi-selected' : ''}`;
      row.dataset.id = credential.id;
      row.tabIndex = 0;
      const copy = document.createElement('div');
      copy.className = 'credential-copy';
      const service = document.createElement('strong');
      service.textContent = credential.service;
      const account = document.createElement('span');
      account.textContent = credential.account;
      const password = document.createElement('code');
      password.textContent = credential.passwordMask || '**********';
      copy.append(service, account, password);
      const actions = document.createElement('div');
      actions.className = 'credential-actions';
      const accountCopy = document.createElement('button');
      accountCopy.type = 'button';
      accountCopy.dataset.credentialCopy = 'account';
      pomeLocaleRendererWorkspace.bind(accountCopy, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.copyAccount.800564")));
      accountCopy.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.copyAccount.800564"));
      const passwordCopy = document.createElement('button');
      passwordCopy.type = 'button';
      passwordCopy.dataset.credentialCopy = 'password';
      pomeLocaleRendererWorkspace.bind(passwordCopy, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.copyPassword.c49aca")));
      passwordCopy.setAttribute('aria-label', pomeLocaleRendererWorkspace.t("copy.copyPassword.c49aca"));
      const deleteAction = Domain.credentialRowAction({ requestedAction: 'delete' });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.credentialDelete = 'true';
      pomeLocaleRendererWorkspace.bind(remove, 'textContent', () => Domain.credentialRowAction({requestedAction:'delete'}).label);
      pomeLocaleRendererWorkspace.bind(remove, 'ariaLabel', () => Domain.credentialRowAction({requestedAction:'delete'}).ariaLabel);
      const editButton = document.createElement('button'); editButton.type='button'; editButton.dataset.credentialEdit='true';
      pomeLocaleRendererWorkspace.bind(editButton, 'textContent', () => pomeLocaleRendererWorkspace.t('ux.edit'));
      actions.append(editButton);
      actions.append(accountCopy, passwordCopy, remove);
      if (credentialsReadFailed) actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      row.append(copy, actions);
      credentialList.appendChild(row);
    });
    if (focusedField) {
      const nextInput = credentialList.querySelector(`.credential-item.editing input[name="${focusedField}"]`);
      nextInput?.focus({ preventScroll: true });
      if (nextInput && selection?.every(Number.isInteger)) nextInput.setSelectionRange(...selection);
    }
    updateCredentialBulkAction();
  }

  async function loadCredentials() {
    if (!window.notchAPI || typeof window.notchAPI.listCredentials !== 'function') return;
    const generation = ++credentialsLoadGeneration;
    let result;
    try { result = await window.notchAPI.listCredentials(); } catch (error) { result = null; }
    if (generation !== credentialsLoadGeneration) return;
    const wasFailed = credentialsReadFailed;
    credentialsReadFailed = !result || result.ok === false || !Array.isArray(result.items);
    if (credentialsReadFailed) {
      invalidateCredentialEdit();
      if (credentialSave) credentialSave.disabled = true;
      reportCredentialFailure(result, true);
    } else {
      credentials = result.items;
      if (pendingCredentialEditId && !credentials.some(item => item.id === pendingCredentialEditId)) invalidateCredentialEdit();
      if (editingCredentialId && !credentials.some(item => item.id === editingCredentialId)) invalidateCredentialEdit({ clear: true });
      if (wasFailed) {
        if (credentialSave) credentialSave.disabled = false;
        window.NotchUi?.clearError?.('credentials');
        if (credentialsNote) {
          pomeLocaleRendererWorkspace.bind(credentialsNote, 'textContent', () => '');
          credentialsNote.classList.remove('error');
        }
      }
    }
    renderCredentials();
  }

  function reportCredentialFailure(result, reading = false) {
    const readFailure = reading || ['credentials_unreadable', 'secure_storage_unavailable'].includes(result?.error);
    const messageKey = result?.secureStorage === false || result?.error === 'secure_storage_unavailable'
      ? 'copy.systemSecureStorageIsUnavailableCanT.b21216' : readFailure ? 'credentials.readFailed' : 'ui.error.storage';
    if (window.NotchUi?.showError) {
      window.NotchUi.showError({ messageKey, repairKey: 'credentials.readRepair',
        diagnostic: `Credentials: ${result?.error || 'read_failed'}`, scope: 'credentials',
        inlineHint: credentialsNote, onRepair: loadCredentials });
    } else if (credentialsNote) {
      pomeLocaleRendererWorkspace.bind(credentialsNote, 'textContent', () => pomeLocaleRendererWorkspace.t(messageKey));
      credentialsNote.classList.add('error');
    }
  }

  async function saveCredential() {
    if (!credentialSave || !window.notchAPI || credentialsReadFailed || credentialSave.disabled) return;
    const payload = {
      service: credentialService?.value || '',
      account: credentialAccount?.value || '',
      password: credentialPassword?.value || '',
    };
    const createGeneration = credentialCreateGeneration;
    if (!payload.service.trim() || !payload.account.trim() || !payload.password) {
      if (credentialsNote) {
        pomeLocaleRendererWorkspace.bind(credentialsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.enterTheServiceAccountAndPassword.7e80f6")));
        credentialsNote.classList.add('error');
      }
      return;
    }
    credentialSave.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSave.disabled = false;
    if (!result || !result.ok) {
      if (['credentials_unreadable', 'secure_storage_unavailable'].includes(result?.error)) { await loadCredentials(); return; }
      if (createGeneration === credentialCreateGeneration) reportCredentialFailure(result);
      else window.NotchUi?.showError?.({ messageKey: 'ui.error.storage',
        diagnostic: `Credentials: ${result?.error || 'save_failed'}`, scope: 'credentials' });
      return;
    }
    const unchangedDraft = createGeneration === credentialCreateGeneration && credentialService?.value === payload.service
      && credentialAccount?.value === payload.account && credentialPassword?.value === payload.password;
    if (unchangedDraft && credentialService) credentialService.value = '';
    if (unchangedDraft && credentialAccount) credentialAccount.value = '';
    if (unchangedDraft && credentialPassword) {
      credentialPassword.value = '';
      credentialPassword.type = 'password';
      const reveal = credentialPassword.parentElement?.querySelector('[data-credential-reveal]'); if (reveal) { pomeLocaleRendererWorkspace.bind(reveal, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.show.4e1449"))); reveal.setAttribute('aria-pressed','false'); }
      pomeLocaleRendererWorkspace.bind(credentialPassword, "placeholder", () => (pomeLocaleRendererWorkspace.t("copy.encryptedAfterSaving.61e9e1")));
    }
    if (credentialsNote && createGeneration === credentialCreateGeneration) {
      pomeLocaleRendererWorkspace.bind(credentialsNote, "textContent", () => (pomeLocaleRendererWorkspace.t(unchangedDraft
        ? "copy.encryptedAndSavedUsingSystemSecureStorage.2208fb" : "copy.pressEnterToSave.c1c0ad")));
      credentialsNote.classList.remove('error');
    }
    await loadCredentials();
    if (createGeneration === credentialCreateGeneration && unchangedDraft) {
      if (!credentialService?.value && !credentialAccount?.value && !credentialPassword?.value) closeCredentialCreate();
      else if (credentialsNote) pomeLocaleRendererWorkspace.bind(credentialsNote, 'textContent',
        () => pomeLocaleRendererWorkspace.t('copy.pressEnterToSave.c1c0ad'));
    }
  }

  credentialSave?.addEventListener('click', saveCredential);
  document.addEventListener('click', (event) => {
    const reveal = event.target.closest('[data-credential-reveal]');
    if (!reveal) return;
    const input = reveal.closest('.credential-password-field')?.querySelector('input');
    if (!input) return;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    pomeLocaleRendererWorkspace.bind(reveal, "textContent", () => (visible ? pomeLocaleRendererWorkspace.t("copy.hide.145219") : pomeLocaleRendererWorkspace.t("copy.show.4e1449")));
    reveal.setAttribute('aria-pressed', String(visible));
  }, true);
  credentialSearch?.addEventListener('input', renderCredentials);
  function pauseCredentialEditing() {
    // Keep an established draft, but late reads/saves may no longer open or
    // clear its editor after the user leaves this page or collapses the panel.
    invalidateCredentialEdit();
    closeCredentialCreate({ restoreFocus: false });
    document.querySelectorAll('.credential-password-field input').forEach((input) => { input.type = 'password'; });
    document.querySelectorAll('[data-credential-reveal]').forEach((button) => {
      pomeLocaleRendererWorkspace.bind(button, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.show.4e1449")));
      button.setAttribute('aria-pressed', 'false');
    });
  }
  document.addEventListener('notch:will-collapse', pauseCredentialEditing);
  document.addEventListener('notch:tabchange', event => { if (event.detail?.tab !== 'credentials') pauseCredentialEditing(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseCredentialEditing(); });
  document.addEventListener('notch:window-visibility', event => { if (!event.detail?.visible) pauseCredentialEditing(); });
  credentialList?.addEventListener('input', event => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (form?.dataset.id !== editingCredentialId || !editingCredential) return;
    if (['service', 'account', 'password'].includes(event.target.name)) editingCredential[event.target.name] = event.target.value;
  });
  [credentialService, credentialAccount, credentialPassword].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveCredential();
      }
    });
  });
  credentialList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.credential-item[data-id]');
    if (!row) return;
    if (event.target.closest('[data-credential-cancel]')) {
      invalidateCredentialEdit({ clear: true });
      renderCredentials();
      void loadCredentials();
      return;
    }
    if (credentialsReadFailed) return;
    if (row.classList.contains('editing')) return;
    const copyField = event.target.closest('[data-credential-copy]')?.dataset.credentialCopy;
    const action = Domain.credentialRowAction({
      requestedAction: event.target.closest('[data-credential-delete]') ? 'delete' : '',
      copyField,
      rowBody: Boolean(event.target.closest('.credential-copy') || event.target.closest('[data-credential-edit]')),
      shiftKey: event.shiftKey,
      selected: credentialSelection.has(row.dataset.id),
    });
    if (action.type === 'delete') {
      const credential = credentials.find(item => item.id === row.dataset.id);
      if (!credential || !await window.PomeDeleteConfirm.open({titleKey:'ui.delete.credentialTitle',items:[`${credential.service} · ${credential.account}`]})) return;
      if (credentialsReadFailed || !credentials.some(item => item.id === credential.id)) return;
      if ([pendingCredentialEditId, editingCredentialId].includes(row.dataset.id)) invalidateCredentialEdit();
      const deleteButton = event.target.closest('[data-credential-delete]');
      if (deleteButton) deleteButton.disabled = true;
      const result = await window.notchAPI.deleteCredentials([row.dataset.id]).catch(() => ({ ok: false }));
      if (!result?.ok) {
        if (deleteButton) deleteButton.disabled = false;
        if (['credentials_unreadable', 'secure_storage_unavailable'].includes(result?.error)) { await loadCredentials(); return; }
        if (credentialsNote) {
          pomeLocaleRendererWorkspace.bind(credentialsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.deleteFailedTryAgainLater.782a6b")));
          credentialsNote.classList.add('error');
        }
        return;
      }
      credentialSelection.delete(row.dataset.id);
      if (editingCredentialId === row.dataset.id) {
        invalidateCredentialEdit({ clear: true });
      }
      await loadCredentials();
      if (credentialsNote) {
        pomeLocaleRendererWorkspace.bind(credentialsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.credentialDeleted.84abf3")));
        credentialsNote.classList.remove('error');
      }
      return;
    }
    if (action.type === 'copy') {
      const copied = await window.notchAPI.copyCredential(row.dataset.id, action.field).catch(() => false);
      if(copied)document.dispatchEvent(new CustomEvent('notch:copied',{detail:{target:event.target.closest('[data-credential-copy]')}}));
      if (credentialsNote) pomeLocaleRendererWorkspace.bind(credentialsNote, "textContent", () => (copied ? pomeLocaleRendererWorkspace.t("copy.copied.f39f6e", { arg1: (copyField === 'password' ? pomeLocaleRendererWorkspace.t("copy.password.a621ab") : pomeLocaleRendererWorkspace.t("copy.account.311bb3")) }) : pomeLocaleRendererWorkspace.t("copy.copyFailed.753d8b")));
      return;
    }
    if (action.type === 'edit') {
      const generation = ++credentialEditGeneration;
      const requestedId = row.dataset.id;
      pendingCredentialEditId = requestedId;
      const originRect = row.getBoundingClientRect();
      const result = await window.notchAPI.getCredential(requestedId).catch(() => ({ ok: false }));
      if (generation !== credentialEditGeneration || pendingCredentialEditId !== requestedId || credentialsReadFailed) return;
      pendingCredentialEditId = '';
      if (!credentials.some(item => item.id === requestedId)) return;
      if (!result || !result.ok || !result.item) { reportCredentialFailure(result); return; }
      if (result.item.id !== requestedId) { reportCredentialFailure({ error: 'credential_identity_mismatch' }); return; }
      editingCredentialId = result.item.id;
      editingCredential = { ...result.item };
      renderCredentials();
      animateCredentialExpansion(originRect);
      if (credentialsNote) {
        pomeLocaleRendererWorkspace.bind(credentialsNote, "textContent", () => (pomeLocaleRendererWorkspace.t("copy.credentialOpenedForEditingPressEnterTo.d012cd")));
        credentialsNote.classList.remove('error');
      }
      credentialList.querySelector('.credential-item.editing input[name="service"]')?.focus();
      return;
    }
    const result = window.NotchDomain.updateRangeSelection(
      Domain.filterCredentials(credentials, credentialSearch?.value || '').map((item) => item.id),
      [...credentialSelection],
      row.dataset.id,
      credentialAnchor,
      event.shiftKey,
      true
    );
    credentialSelection = new Set(result.selected);
    credentialAnchor = result.anchor;
    renderCredentials();
  });
  credentialList?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (!form) return;
    event.preventDefault();
    if (!editingCredentialId || form.dataset.id !== editingCredentialId || !window.notchAPI || credentialsReadFailed
      || pendingCredentialEditId || credentialSavesInFlight.has(credentialEditGeneration)) return;
    const generation = credentialEditGeneration;
    const payload = {
      id: editingCredentialId,
      service: form.elements.service?.value || '',
      account: form.elements.account?.value || '',
      password: form.elements.password?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    credentialSavesInFlight.add(generation);
    if (saveButton) saveButton.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSavesInFlight.delete(generation);
    if (saveButton) saveButton.disabled = false;
    if (generation !== credentialEditGeneration || editingCredentialId !== payload.id) return;
    if (!result?.ok) { reportCredentialFailure(result); return; }
    const draftChanged = ['service', 'account', 'password'].some(key => editingCredential?.[key] !== payload[key]);
    if (!draftChanged) invalidateCredentialEdit({ clear: true });
    await loadCredentials();
  });
  credentialBulkDelete?.addEventListener('click', async () => {
    if (!credentialSelection.size || !window.notchAPI || credentialsReadFailed) return;
    const targets = credentials.filter(item => credentialSelection.has(item.id));
    if (!await window.PomeDeleteConfirm.open({items:targets.map(item => `${item.service} · ${item.account}`)})) return;
    if (credentialsReadFailed) return;
    const ids = targets.map(item => item.id);
    if ([pendingCredentialEditId, editingCredentialId].some(id => ids.includes(id))) invalidateCredentialEdit();
    const result = await window.notchAPI.deleteCredentials(ids).catch(() => ({ ok: false }));
    if (!result || !result.ok) { reportCredentialFailure(result); return; }
    credentialSelection.clear();
    credentialAnchor = null;
    await loadCredentials();
  });

  document.addEventListener('notch:clear-selection', () => {
    commandSelection.clear();
    commandSelectionAnchor = null;
    linkSelection.clear();
    linkSelectionAnchor = null;
    recordingSelection.clear();
    recordingSelectionAnchor = selectedRecordingId || null;
    credentialSelection.clear();
    credentialAnchor = null;
    renderCommands();
    renderLinkGroups();
    renderRecordingList();
    renderCredentials();
  });

  setInterval(() => refreshWindows(), 6000);

  window.addEventListener('beforeunload', () => {
    stopSpeechRecognition();
    stopTranscriptionAudioPipeline();
    if (transcriptionStartPromise && window.notchAPI) window.notchAPI.finishTranscription().catch(() => {});
    stopMediaTracks();
    releaseRecordingAudio();
  });

  window.getCommandsForSync = () => commands.map((command) => ({
    id: command.id,
    text: command.text,
    createdAt: command.createdAt,
  }));
  window.getLinkGroupsForSync = () => linkGroups.map((group) => ({
    id: group.id,
    name: group.name || '',
    collapsed: group.collapsed === true,
    links: Array.isArray(group.links) ? group.links.map((link) => ({
      id: link.id,
      url: link.url,
      title: link.title || '',
      description: link.description || '',
      icon: link.icon || '',
      createdAt: link.createdAt || 0,
    })) : [],
  }));
  window.notchAPI?.onRecordingSyncState?.((states) => {
    for (const state of states || []) { const row = recordings.find((r) => r.id === state.id); if (row) { row.audioOmitted = state.audioOmitted; row.audioSyncReason = state.audioSyncReason; } }
    persistRecordings(); renderRecordingDetail();
  });
  window.getRecordingsForSync = () => recordings
    .filter((recording) => recording && !recording.isDraft)
    .map((recording) => ({
      id: recording.id,
      createdAt: recording.createdAt,
      durationMs: recording.durationMs,
      transcript: recording.transcript || '',
      audioPath: recording.audioPath || '',
      audioOmitted: recording.audioOmitted === true,
      audioSyncReason: recording.audioSyncReason || '',
      mimeType: recording.mimeType || '',
      title: recording.title || '',
      category: recording.category || '',
    }));

  document.addEventListener('nas-sync:workspace-projection', (event) => {
    const detail = event && event.detail ? event.detail : {};
    if (Array.isArray(detail.links)) {
      linkGroups = detail.links;
      persistLinks();
      renderLinkGroups();
    }
    if (Array.isArray(detail.commands)) {
      commands = detail.commands
        .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
        .filter(Boolean);
      commandSelection = new Set();
      commandSelectionAnchor = null;
      persistCommands();
      renderCommands();
    }
    if (Array.isArray(detail.recordings)) {
      const incoming = detail.recordings.map((row) => {
        if (row && row.audioOmitted && !row.audioPath) {
          const existing = recordings.find((item) => item.id === row.id);
          if (existing && existing.audioPath) return { ...row, audioPath: existing.audioPath };
        }
        return row;
      });
      recordings = incoming.map(Domain.createRecording).filter(Boolean);
      selectedRecordingId = recordings.some((recording) => recording.id === selectedRecordingId)
        ? selectedRecordingId
        : (recordings[0] && recordings[0].id) || '';
      persistRecordings();
      renderRecordings();
    }
    if (detail.notes || detail.clipboard || detail.links || detail.recordings) {
      loadCredentials().catch(() => {});
    }
  });

  renderCommands();
  renderLinkGroups();
  renderRecordings();
  renderWindows();
  updateRecordingUi();
  loadTranscriptionConfig();
  refreshSettingsPanel();
  refreshMusicStatus();
  loadCredentials();

  window.addEventListener('pome:language-changed', () => {
    // These renderers do not repopulate the API form or recreate recordings.
    renderSettingsPanel();
    renderHomeModuleSettings();
    const status = Domain.apiCredentialStatuses(transcriptionConfig);
    if (transcriptionApiStatus) transcriptionApiStatus.textContent = status.transcription.label;
    if (llmApiStatus) llmApiStatus.textContent = status.llm.label;
  });
  window.NotchWorkspace = {
    refreshWindows,
    startRecording,
    isRecordingActive: isRecordingBusy,
    closeCredentialCreateOnEscape,
    closeTranscriptionOnEscape() { if (transcriptionSettingsBackdrop.hidden) return false; closeTranscriptionSettings(); return true; },
  };
})();
