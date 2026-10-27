'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../renderer/ui-simplify-domain');
test('diagnostics remove secrets and URL authentication without discarding error codes',()=>{
 const value=D.diagnostic('ECONNREFUSED https://user:pass@nas.local/pome?token=abc#secret Bearer private-value api_key=sk-secret-value token="private" password=hidden');
 assert(value.includes('ECONNREFUSED'));assert(value.includes('https://nas.local/pome'));
 for(const secret of ['user:pass','private-value','sk-secret-value','private"','hidden','?token='])assert(!value.includes(secret),value);
});
test('connection corrections only add HTTPS; explicit HTTP and HTTPS stay unchanged',()=>{
 assert.equal(D.normalizeAddress(' nas.local/pome '),'https://nas.local/pome');
 assert.equal(D.normalizeAddress('http://nas.local/pome'),'http://nas.local/pome');
 assert.equal(D.normalizeAddress('https://nas.local/pome'),'https://nas.local/pome');
 assert.equal(D.normalizeAddress(''),'');
});
test('raw errors map to understandable problems',()=>{
 assert.equal(D.errorKey('ECONNREFUSED 127.0.0.1'),'ui.error.connection');
 assert.equal(D.errorKey('401 Unauthorized'),'ui.error.signIn');
 assert.equal(D.errorKey('Claude Stop hook failed'),'ui.error.hook');
 assert.equal(D.errorKey('ENOSPC'),'ui.error.storage');
});

test('missing or unreadable local Codex auth is distinct from expired sign-in',()=>{
 assert.equal(D.errorKey('Codex: codex_auth_missing'),'copy.noReadableCodexSignInFoundSign.d77b80');
 assert.equal(D.errorKey('Codex: codex_token_missing'),'copy.noUsableTokenFoundInLocalCodex.fab797');
 assert.equal(D.errorKey('Codex: codex_auth_read_failed'),'copy.couldnTReadCodexSignInRetry.5e8c59');
 assert.equal(D.errorKey('401 Unauthorized'),'ui.error.signIn');
});


test('local Cursor failures map by stable codes rather than translated token copy',()=>{
 assert.equal(D.errorKey('Cursor: cursor_db_missing'),'copy.noLocalCursorDataFoundInstallCursor.f5b341');
 assert.equal(D.errorKey('Cursor: cursor_token_missing'),'copy.cursorIsnTSignedInLocallySign.45a8a8');
 assert.equal(D.errorKey('Cursor: cursor_db_read_failed'),'copy.couldnTReadCursorSignInRetry.6bf381');
 assert.equal(D.errorKey('401 Unauthorized'),'ui.error.signIn');
});
