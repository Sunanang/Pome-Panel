'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../renderer/workspace.js'),'utf8');
test('one Escape masks the visible create password without its duplicate collapsing the panel',()=>{
 let now=1000;const c={credentialCreateEscapeAt:-Infinity,credentialPassword:{type:'text'},
  performance:{now:()=>now},maskCredentialCreate:()=>{c.credentialPassword.type='password';}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function closeCredentialCreateOnEscape()'),source.indexOf('  function invalidateCredentialEdit(')),c);
 assert.equal(c.closeCredentialCreateOnEscape(),true);assert.equal(c.credentialPassword.type,'password');
 now+=10;assert.equal(c.closeCredentialCreateOnEscape(),true);
 now+=200;assert.equal(c.closeCredentialCreateOnEscape(),false);
});
function harness(){
 let resolveSave,resolveLoad;const events=[];
 const field=value=>({value,type:'password',parentElement:{querySelector:()=>null}});
 const c={credentialSave:{disabled:false},credentialsReadFailed:false,credentialCreateGeneration:1,
  credentialService:field('old'),credentialAccount:field('account'),credentialPassword:field('secret'),
  credentialsNote:{textContent:'',classList:{add(){},remove(){}}},
  window:{notchAPI:{saveCredential:()=>new Promise(r=>{resolveSave=r})}},
  pomeLocaleRendererWorkspace:{t:k=>k,bind:(n,p,f)=>n[p]=f()},
  reportCredentialFailure:r=>events.push({error:r}),
  loadCredentials:()=>new Promise(r=>{resolveLoad=r}),closeCredentialCreate:()=>events.push({closed:true})};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  async function saveCredential()'),source.indexOf("  credentialSave?.addEventListener('click', saveCredential)")),c);
 return {c,events,save:r=>resolveSave(r),load:()=>resolveLoad()};
}
test('a fresh draft typed during post-save list refresh remains open and unchanged',async()=>{
 const h=harness(),job=h.c.saveCredential();h.save({ok:true});await new Promise(r=>setImmediate(r));h.c.credentialService.value='new draft';h.c.credentialPassword.value='new secret';h.load();await job;
 assert.equal(h.c.credentialPassword.value,'new secret');assert(!h.events.some(e=>e.closed));assert.equal(h.c.credentialsNote.textContent,'copy.pressEnterToSave.c1c0ad');
});
test('an old save failure cannot replace feedback in a reopened create dialog',async()=>{
 const h=harness(),job=h.c.saveCredential();h.c.credentialCreateGeneration++;h.c.credentialsNote.textContent='new session';h.save({ok:false,error:'save_failed'});await job;
 assert.equal(h.c.credentialsNote.textContent,'new session');
});
test('a current save failure uses the persistent error path',async()=>{
 const h=harness(),job=h.c.saveCredential();h.save({ok:false,error:'save_failed'});await job;assert.equal(h.events[0]?.error?.error,'save_failed');
});
function deletionHarness(){
 const D=require('../renderer/domain'),errors=[],calls=[];let bulk;
 const c={Domain:D,recordings:[{id:'a',title:'A',audioPath:'a.wav'},{id:'b',title:'B',audioPath:'b.wav'}],recordingSelection:new Set(['a','b']),selectedRecordingId:'a',recordingSelectionAnchor:'a',
  window:{PomeDeleteConfirm:{open:async()=>true},NotchUi:{showError:e=>errors.push(e)},notchAPI:{deleteRecording:async file=>{calls.push(file);return file==='a.wav';}}},
  pomeLocaleRendererWorkspace:{t:k=>k},persistRecordings(){},renderRecordings(){},
  recordingBulkDelete:{addEventListener:(_n,f)=>bulk=f}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  async function deleteSingleRecording('),source.indexOf('  function renderRecordingList()')),c);
 const a=source.indexOf("  recordingBulkDelete?.addEventListener('click'");vm.runInContext(source.slice(a,source.indexOf('  // ============ 当前窗口',a)),c);
 return {c,errors,calls,bulk:()=>bulk()};
}
test('failed audio deletion preserves its recording metadata and reports an error',async()=>{
 const h=deletionHarness();await h.c.deleteSingleRecording('b');assert.equal(h.c.recordings.length,2);assert.equal(h.errors.length,1);
});
test('partial bulk audio deletion keeps failed items selected and recoverable',async()=>{
 const h=deletionHarness();await h.bulk();assert.deepEqual(Array.from(h.c.recordings,r=>r.id),['b']);assert(h.c.recordingSelection.has('b'));assert.equal(h.errors.length,1);
});
test('audio deletion does not remove a recording updated during the IPC request',async()=>{
 const h=deletionHarness();h.c.window.notchAPI.deleteRecording=async()=>{h.c.recordings=[{id:'a',title:'New A',audioPath:'new.wav'},h.c.recordings[1]];return true;};await h.c.deleteSingleRecording('a');assert(h.c.recordings.some(r=>r.audioPath==='new.wav'));
});
test('missing audio is removable but unsafe paths and symlinks remain rejected',()=>{
 const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pome-audit-audio-')),recordings=path.join(dir,'recordings');fs.mkdirSync(recordings);
 const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),c={fs,path,getRecordingsDir:()=>recordings,workspaceRoot:()=>dir};vm.createContext(c);
 vm.runInContext(main.slice(main.indexOf('function getSafeRecordingPath('),main.indexOf("ipcMain.handle('recordings:save'")),c);
 try {
  assert.equal(c.getSafeRecordingPath('recordings/recording-missing.wav'),null);
  assert.equal(c.getSafeRecordingPath('recordings/recording-missing.wav',{allowMissing:true}),path.join(recordings,'recording-missing.wav'));
  assert.equal(c.getSafeRecordingPath('../recording-other.wav',{allowMissing:true}),null);
  fs.symlinkSync(path.join(dir,'missing-target'),path.join(recordings,'recording-link.wav'));
  assert.equal(c.getSafeRecordingPath('recordings/recording-link.wav',{allowMissing:true}),null);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
