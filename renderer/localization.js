(function () {
  'use strict';
  const L = window.PomeI18n;
  if (!L) return;
  const bindings = new WeakMap();
  const boundNodes = new Set();
  const allowed = new Set(['title', 'placeholder', 'aria-label', 'alt']);
  function render(root = document) {
    document.documentElement.lang = L.getState().effectiveLocale;
    for (const node of root.querySelectorAll('[data-i18n]')) {
      const value = L.t(node.dataset.i18n);
      if (node.textContent !== value) node.textContent = value;
    }
    for (const attr of allowed) for (const node of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      const value = L.t(node.getAttribute(`data-i18n-${attr}`));
      if (node.getAttribute(attr) !== value) node.setAttribute(attr, value);
    }
    for (const reference of boundNodes) {
      const node = reference.deref();
      if (!node?.isConnected) { boundNodes.delete(reference); continue; }
      const properties = bindings.get(node);
      for (const [name, binding] of properties) {
        // A later plain assignment owns the current message. Do not revive an
        // old success/error label when the language changes.
        if (node[name] !== binding.lastValue) { properties.delete(name); continue; }
        try { binding.lastValue = node[name] = binding.read(); } catch { properties.delete(name); }
      }
    }
    for (const control of document.querySelectorAll('[data-language-preference]')) {
      if (control.options && control.replaceChildren) {
        const choices = [{ id: 'system', name: L.t('settings.system') }, ...L.languages];
        if ([...control.options].map(row => row.value).join('/') !== choices.map(row => row.id).join('/')) {
          control.replaceChildren(...choices.map(({ id, name }) => {
            const option = document.createElement('option'); option.value = id; option.textContent = name;
            if (id === 'system') option.dataset.i18n = 'settings.system';
            return option;
          }));
        }
      }
      control.value = L.getState().preference;
    }
    window.dispatchEvent(new CustomEvent('pome:language-changed', { detail: L.getState() }));
  }
  L.bind = (node, property, read) => {
    if (!node) return '';
    if (node.nodeType !== 1) return (node[property] = read());
    if (!bindings.has(node)) { bindings.set(node, new Map()); boundNodes.add(new WeakRef(node)); }
    const value = read();
    bindings.get(node).set(property, { read, lastValue: String(value ?? '') });
    node[property] = value;
    if (boundNodes.size > 512) for (const ref of boundNodes) if (!ref.deref()?.isConnected) boundNodes.delete(ref);
    return value;
  };
  const api = window.notchAPI;
  if (api?.localization) L.setState(api.localization);
  else {
    let stored = 'system';
    try { stored = localStorage.getItem('pome-ui-language') || 'system'; } catch {}
    const languages = window.PomeNasHostLanguage ? [window.PomeNasHostLanguage] : (navigator.languages || [navigator.language]);
    L.setState(L.snapshot(stored, languages));
  }
  // NAS host events affect System only, never a manual choice or another browser.
  window.addEventListener('pome:host-language', event => {
    const value = event.detail;
    if (typeof value !== 'string' || !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(value)) return;
    window.PomeNasHostLanguage = value;
    if (!api && L.getState().preference === 'system') L.setState(L.snapshot('system', [value]));
  });
  L.onChange(() => render());
  window.PomeLocalize = render;
  document.addEventListener('DOMContentLoaded', () => {
    render();
    for (const control of document.querySelectorAll('[data-language-preference]')) control.addEventListener('change', async () => {
      if (api?.setLanguage) {
        const result = await api.setLanguage(control.value);
        if (result?.ok) L.setState(result.localization);
        else control.value = L.getState().preference;
      } else {
        const value = L.preference(control.value);
        try { localStorage.setItem('pome-ui-language', value); } catch {}
        L.setState(L.snapshot(value, window.PomeNasHostLanguage ? [window.PomeNasHostLanguage] : (navigator.languages || [navigator.language])));
      }
    });
  });
  if (api?.onLocalizationChanged) {
    api.onLocalizationChanged(next => L.setState(next));
    api.getAppSettings?.().then(value => { if (value?.localization) L.setState(value.localization); }).catch(() => {});
  }
})();
