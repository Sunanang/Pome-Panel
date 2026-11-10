/* Settings IA only: keep the original controls and their listeners mounted. */
(() => {
  'use strict';
  const page = document.getElementById('settings-page');
  const content = document.getElementById('settings-content');
  const nav = page.querySelector('.settings-sidebar');
  const buttons = [...nav.querySelectorAll('[data-settings-group-target]')];
  const groups = [...content.querySelectorAll('[data-settings-group]')];
  const aliases = {
    'settings-device-anchor': 'common', 'settings-api-anchor': 'ai',
    'settings-display-anchor': 'display', 'experience-backup': 'data',
  };
  let selected = 'common';
  let pendingReveal = null;
  function select(group, { focus = false } = {}) {
    if (!groups.some(node => node.dataset.settingsGroup === group)) return false;
    const changed = selected !== group;
    selected = group;
    for (const pane of groups) pane.hidden = pane.dataset.settingsGroup !== group;
    for (const button of buttons) {
      const active = button.dataset.settingsGroupTarget === group;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus({ preventScroll: true });
    }
    if (changed) {
      content.scrollTop = 0;
      document.dispatchEvent(new CustomEvent('notch:settings-navigate', { detail: { group } }));
    }
    return true;
  }
  function reveal(target, { block = 'start' } = {}) {
    const node = typeof target === 'string' ? document.getElementById(target.replace(/^#/, '')) : target;
    const group = node?.closest('[data-settings-group]')?.dataset.settingsGroup
      || aliases[typeof target === 'string' ? target.replace(/^#/, '') : node?.id];
    if (!group || !select(group)) return false;
    // A caller can arrive during another tab transition; setActiveTab queues
    // that entry. Preserve this explicit target until Settings becomes visible.
    if (document.getElementById('tab-settings').getAttribute('aria-hidden') !== 'false') pendingReveal = { node, block };
    for (let parent = node?.parentElement; parent && parent !== content; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    node?.scrollIntoView({ block, behavior: 'instant' });
    return true;
  }
  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-settings-group-target]');
    if (button) select(button.dataset.settingsGroupTarget);
  });
  nav.addEventListener('keydown', event => {
    const current = buttons.indexOf(event.target.closest('[data-settings-group-target]'));
    if (current < 0 || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    select(buttons[next].dataset.settingsGroupTarget, { focus: true });
  });
  // Each entry from another workspace page starts at Common; no storage writes.
  // Explicit deep links reveal their target after setActiveTab('settings').
  let previousTab = typeof activeTab === 'string' ? activeTab : null;
  document.addEventListener('notch:tabchange', event => {
    const tab = event.detail?.tab;
    if (tab === 'settings') {
      const target = pendingReveal; pendingReveal = null;
      if (target) reveal(target.node, { block: target.block });
      else if (previousTab !== 'settings') select('common');
    }
    previousTab = tab;
  });
  window.NotchSettings = Object.freeze({ select, reveal, getGroup: () => selected });
  select('common');
})();
