'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Domain = require('../renderer/domain');
const workspace = fs.readFileSync(path.join(__dirname, '../renderer/workspace.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function linkHarness() {
  const requests = [], listeners = new Map();
  let renders = 0, persists = 0, editing = null;
  const context = { Domain, linkGroups: [], CSS: { escape: value => value },
    uid: () => 'link-fixture', setLinksStatus() {}, linkHostname: url => new URL(url).hostname.replace(/^www\./,''),
    allLinks: () => context.linkGroups.flatMap(group => group.links),
    persistLinks: () => { persists++; }, renderLinkGroups: () => { renders++; },
    pomeLocaleRendererWorkspace: { t: () => 'Untitled' }, queueMicrotask,
    document: { activeElement: null, addEventListener() {} },
    linkGroupsEl: { contains: value => value != null, classList: { contains: () => false },
      querySelector: selector => selector.includes('.link-title-edit') ? editing : null,
      addEventListener: (name, callback) => listeners.set(name, callback) },
    window: { notchAPI: { inspectLink: () => new Promise(resolve => requests.push(resolve)) } },
  };
  vm.createContext(context);
  vm.runInContext(workspace.slice(workspace.indexOf('  let linkMetadataRenderPending ='), workspace.indexOf('\n  if (linkInput)')), context);
  context.addLink('https://example.com/');
  return { context, requests, listeners, link: () => context.linkGroups.flatMap(group => group.links)[0],
    renders: () => renders, persists: () => persists,
    edit: () => { editing = { matches: () => true }; context.document.activeElement = editing; },
    blur: () => { editing = null; context.document.activeElement = null; listeners.get('focusout')(); } };
}

test('late link metadata cannot overwrite a manually renamed title or relocate it', async () => {
  const h = linkHarness(), originalGroup = h.context.linkGroups[0].id;
  h.link().title = 'My own title';
  h.requests[0]({ ok: true, title: 'Learn JavaScript', icon: 'fixture-icon' }); await settle();
  assert.equal(h.link().title, 'My own title');
  assert.equal(h.context.linkGroups[0].id, originalGroup);
  assert.equal(h.link().icon, 'fixture-icon', 'unrelated metadata can still complete');
});

test('late classification respects a manually moved link or renamed group', async () => {
  for (const moved of [false, true]) {
    const h = linkHarness();
    if (moved) {
      h.context.linkGroups.push({ id: 'manual', name: 'My collection', links: [] });
      h.context.linkGroups = Domain.moveLinkToGroup(h.context.linkGroups, h.link().id, 'manual');
    } else h.context.linkGroups[0].name = 'My collection';
    h.requests[0]({ ok: true, title: 'Learn JavaScript' }); await settle();
    const group = h.context.linkGroups.find(group => group.links.length);
    assert.equal(group.name, 'My collection');
    if (moved) assert.equal(group.id, 'manual');
  }
});

test('link metadata preserves an active rename draft and refreshes only after editing ends', async () => {
  const h = linkHarness(); h.edit();
  h.requests[0]({ ok: true, title: 'Learn JavaScript' }); await settle();
  assert.equal(h.link().title, 'example.com');
  assert.equal(h.renders(), 1, 'metadata must not replace the active input');
  h.blur(); await settle();
  assert.equal(h.renders(), 2);
});

test('metadata completes an untouched link, but is discarded after its URL changes', async () => {
  const h = linkHarness();
  h.requests[0]({ ok: true, title: 'Learn JavaScript' }); await settle();
  assert.equal(h.link().title, 'Learn JavaScript');
  const changed = linkHarness(); changed.link().url = 'https://example.org/';
  changed.requests[0]({ ok: true, title: 'Obsolete reply', url: 'https://example.net/' }); await settle();
  assert.equal(changed.link().url, 'https://example.org/');
  assert.equal(changed.link().title, 'example.com');
  assert.equal(changed.persists(), 1);
});

test('generated note title compares the saved pending draft and never rebuilds its editor', async () => {
  let resolve, archive = [{ id: 'a', content: 'Original', title: '', createdAt: 1, updatedAt: 1 }], flushes = 0, presentations = 0;
  const context = { noteTitleAttempts: new Set(), NOTE_ARCHIVE_KEY: 'notes',
    window: { NotchDomain: Domain, notchAPI: { organizeMaterial: () => new Promise(done => { resolve = done; }) } },
    loadNoteArchive: () => archive,
    flushNotesEditorSave: () => { flushes++; archive = Domain.updateNoteInArchive(archive, 'a', 'Newest unsaved text', 2); },
    localStorage: { setItem: (_key, value) => { archive = JSON.parse(value); } },
    updateSavedNotePresentation: () => { presentations++; },
    renderNotesLibrary: () => { throw new Error('must not rebuild the editor'); },
  };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('async function requestNoteTitle('), app.indexOf('\nfunction updateSavedNotePresentation(')), context);
  const job = context.requestNoteTitle(archive[0]);
  resolve({ ok: true, title: 'Outdated generated title' }); await job;
  assert.equal(flushes, 1);
  assert.equal(archive[0].content, 'Newest unsaved text');
  assert.equal(archive[0].title, '');
  assert.equal(presentations, 0);
});

test('an old note presentation cannot update another selected note detail', () => {
  const title = { dataset: { noteId: 'b' }, value: 'Note B' }, time = { textContent: 'B saved time' };
  const context = { document: { activeElement: null }, selectedNoteId: 'b',
    notesDetail: { querySelector: selector => selector.includes('title') ? title : time }, notesList: null,
    noteArchiveTitle: note => note.title, noteArchiveTime: value => value,
    pomeLocaleRendererApp: { bind: (node, key, read) => { node[key] = read(); }, t: () => 'Wrong time' } };
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function updateSavedNotePresentation('), app.indexOf('\nfunction persistNotesEditor(')), context);
  context.updateSavedNotePresentation({ id: 'a', title: 'Generated A', updatedAt: 2 });
  assert.equal(title.value, 'Note B'); assert.equal(time.textContent, 'B saved time');
});
