'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/workspace.js'), 'utf8');
const Domain = require('../renderer/domain');
function harness() {
  const reads = [], saves = [], reports = [], handlers = new Map(); let loads = 0;
  const context = { Domain, credentialSelection: new Set(), credentialsReadFailed: false,
    credentials: [{ id: 'a' }, { id: 'b' }], editingCredentialId: '', editingCredential: null,
    credentialEditGeneration: 0, pendingCredentialEditId: '', credentialSavesInFlight: new Set(),
    credentialList: { addEventListener: (name, callback) => handlers.set(name, callback), querySelector: () => null },
    credentialsNote: null, renderCredentials() {}, animateCredentialExpansion() {},
    loadCredentials: async () => { loads++; }, reportCredentialFailure: result => reports.push(result),
    window: { notchAPI: { getCredential: id => new Promise(resolve => reads.push({ id, resolve })),
      saveCredential: payload => new Promise(resolve => saves.push({ payload, resolve })),
      deleteCredentials: async () => ({ ok: true }) } },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function invalidateCredentialEdit('), source.indexOf('  function updateCredentialBulkAction(')), context);
  const start = source.indexOf("  credentialList?.addEventListener('click', async (event) => {");
  vm.runInContext(source.slice(start, source.indexOf('  credentialBulkDelete?.addEventListener(', start)), context);
  const event = (id, action = 'edit') => {
    const row = { dataset: { id }, classList: { contains: () => false }, getBoundingClientRect: () => ({}) };
    return { shiftKey: false, target: { closest: selector => selector.startsWith('.credential-item') ? row
      : selector === '[data-credential-cancel]' && action === 'cancel' ? {}
        : selector === '[data-credential-delete]' && action === 'delete' ? { disabled: false }
          : selector === '.credential-copy' && action === 'edit' ? {} : null } };
  };
  const submit = id => {
    const button = { disabled: false }, value = context.editingCredential;
    const form = { dataset: { id }, elements: Object.fromEntries(['service', 'account', 'password'].map(key => [key, { value: value[key] }])), querySelector: () => button };
    return { form, button, run: () => handlers.get('submit')({ preventDefault() {}, target: { closest: () => form } }) };
  };
  return { context, reads, saves, reports, handlers, event, submit, loads: () => loads,
    click: (id, action) => handlers.get('click')(event(id, action)),
    item: id => ({ id, service: `Service ${id}`, account: `Account ${id}`, password: `fixture-${id}` }) };
}

test('credential reads adopt only the latest requested editor and ignore an older failure', async () => {
  for (const oldFails of [false, true]) {
    const h = harness(), a = h.click('a'), b = h.click('b');
    h.reads[1].resolve({ ok: true, item: h.item('b') }); await b;
    h.context.editingCredential.service = 'New B draft';
    h.reads[0].resolve(oldFails ? { ok: false, error: 'credentials_unreadable' } : { ok: true, item: h.item('a') }); await a;
    assert.equal(h.context.editingCredentialId, 'b');
    assert.equal(h.context.editingCredential.service, 'New B draft');
    assert.deepEqual(h.reports, []);
  }
});

test('cancel, deletion and leaving the editor invalidate pending credential reads', async () => {
  for (const cancel of ['cancel', 'delete', 'leave']) {
    const h = harness(); h.context.editingCredentialId = 'b'; h.context.editingCredential = h.item('b');
    const job = h.click('a');
    if (cancel === 'cancel') await h.click('b', 'cancel');
    else if (cancel === 'delete') await h.click('a', 'delete');
    else h.context.invalidateCredentialEdit();
    h.reads[0].resolve({ ok: true, item: h.item('a') }); await job;
    assert.notEqual(h.context.editingCredentialId, 'a');
  }
});

test('current credential read failure still reports through the existing error handler', async () => {
  const h = harness(), job = h.click('a');
  h.reads[0].resolve({ ok: false, error: 'credentials_unreadable' }); await job;
  assert.equal(h.reports[0].error, 'credentials_unreadable');
  assert.equal(h.context.editingCredentialId, '');
});

test('old save success or failure cannot close or report over a newly opened credential draft', async () => {
  for (const ok of [false, true]) {
    const h = harness(); h.context.editingCredentialId = 'a'; h.context.editingCredential = h.item('a');
    const submit = h.submit('a'), job = submit.run(), opening = h.click('b');
    h.reads[0].resolve({ ok: true, item: h.item('b') }); await opening;
    h.context.editingCredential.service = 'B pending draft';
    h.saves[0].resolve({ ok, error: ok ? undefined : 'write_failed' }); await job;
    assert.equal(h.context.editingCredentialId, 'b');
    assert.equal(h.context.editingCredential.service, 'B pending draft');
    assert.deepEqual(h.reports, []); assert.equal(h.loads(), 0);
  }
});

test('saving twice is deduplicated and input typed during the save remains an unsaved draft', async () => {
  const h = harness(); h.context.editingCredentialId = 'a'; h.context.editingCredential = h.item('a');
  const submit = h.submit('a'), job = submit.run();
  await submit.run(); assert.equal(h.saves.length, 1);
  h.context.editingCredential.service = 'Typed after submission';
  h.saves[0].resolve({ ok: true }); await job;
  assert.equal(h.context.editingCredentialId, 'a');
  assert.equal(h.context.editingCredential.service, 'Typed after submission');
  assert.equal(h.loads(), 1); assert.equal(submit.button.disabled, false);
});

test('a save finishing after cancellation cannot reopen or clear another edit', async () => {
  const h = harness(); h.context.editingCredentialId = 'a'; h.context.editingCredential = h.item('a');
  const job = h.submit('a').run(); h.context.invalidateCredentialEdit({ clear: true });
  h.saves[0].resolve({ ok: true }); await job;
  assert.equal(h.context.editingCredentialId, ''); assert.equal(h.loads(), 0);
});
