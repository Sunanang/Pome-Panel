'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { tokenFromAuth, readLocalCodexToken } = require('../codex-auth');
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pome-codex-auth-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}
test('Codex imports access tokens without exporting refresh tokens, ID tokens or account metadata', () => {
  const auth = { tokens: { access_token: ' fixture-access-token ', refresh_token: 'private-refresh', id_token: 'private-id', account_id: 'private-account' } };
  assert.equal(tokenFromAuth(auth), 'fixture-access-token');
  assert.equal(tokenFromAuth({ tokens: { refresh_token: 'private-refresh', id_token: 'private-id' } }), '');
  assert.equal(tokenFromAuth({ tokens: { access_token: { unsafe: 'value' } } }), '');
});
test('only access tokens are imported; API keys and other credential types are ignored', () => {
  for (const value of [null, [], {}, { tokens: { access_token: '' } },
    { OPENAI_API_KEY: 'fixture-api-key' }, { personal_access_token: 'fixture-pat' }]) assert.equal(tokenFromAuth(value), '');
});
test('auth reader is read-only and returns only the selected credential', async (t) => {
  const home = await fixture(t);
  const file = path.join(home, 'auth.json');
  const contents = JSON.stringify({ tokens: { access_token: 'fixture-access-token', refresh_token: 'must-not-export', account_id: 'must-not-export' } });
  await fs.writeFile(file, contents);
  assert.deepEqual(await readLocalCodexToken({ homes: [home] }), { ok: true, token: 'fixture-access-token' });
  assert.equal(await fs.readFile(file, 'utf8'), contents);
});
test('auth reader supports Windows BOM and searches the next home if the first lacks usable credentials', async (t) => {
  const first = await fixture(t); const second = await fixture(t);
  await fs.writeFile(path.join(first, 'auth.json'), JSON.stringify({ tokens: { refresh_token: 'not-imported' } }));
  await fs.writeFile(path.join(second, 'auth.json'), '\uFEFF' + JSON.stringify({ tokens: { access_token: 'fixture-desktop-token' } }));
  assert.deepEqual(await readLocalCodexToken({ homes: [first, second] }), { ok: true, token: 'fixture-desktop-token' });
});
test('missing files, signed-out auth and malformed auth have safe distinct errors', async (t) => {
  const home = await fixture(t);
  assert.deepEqual(await readLocalCodexToken({ homes: [home] }), { ok: false, error: 'codex_auth_missing' });
  await fs.writeFile(path.join(home, 'auth.json'), '{}');
  assert.deepEqual(await readLocalCodexToken({ homes: [home] }), { ok: false, error: 'codex_token_missing' });
  await fs.writeFile(path.join(home, 'auth.json'), '{secret must not be echoed');
  assert.deepEqual(await readLocalCodexToken({ homes: [home] }), { ok: false, error: 'codex_auth_read_failed' });
});
test('oversized auth files are rejected before loading their contents', async (t) => {
  const home = await fixture(t);
  await fs.writeFile(path.join(home, 'auth.json'), 'x'.repeat(1024 * 1024 + 1));
  assert.deepEqual(await readLocalCodexToken({ homes: [home] }), { ok: false, error: 'codex_auth_read_failed' });
});
