'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../renderer/ui-simplify-domain');
test('home presets filter unavailable modules and retain at least one',()=>{
 assert.deepEqual(D.presetIds('simple',['note','pomodoro','cursor','inbox','sun']),['note','pomodoro','cursor','inbox']);
 assert.deepEqual(D.presetIds('all',['note','sun']),['note','sun']);
 assert.deepEqual(D.presetIds('simple',['sun'],[]),['sun']);
 assert.deepEqual(D.presetIds('simple',['note','sun'],['sun','sun','unknown']),['sun']);
});
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
