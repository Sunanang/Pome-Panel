'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yazl = require('yazl');
const { pipeline } = require('node:stream/promises');
const b = require('../workspaceBackup');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-backup-test-')); t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  fs.mkdirSync(path.join(root,'recordings')); fs.writeFileSync(path.join(root,'recordings/a.webm'),'audio-bytes');
  fs.mkdirSync(path.join(root,'clipboard-images')); fs.writeFileSync(path.join(root,'clipboard-images/a.png'),'image-bytes');
  const storage = b.normalizeStorage({ 'notch-home-note':'备份首页', 'notch-note-archive-v1':JSON.stringify(Array.from({length:250},(_,i)=>({id:`n${i}`,title:`笔记${i}`,content:'正文'}))), 'notch-recordings':JSON.stringify([{id:'r1',audioPath:'recordings/a.webm',transcript:'文本'}]), 'notch-clip-history':JSON.stringify([{id:'c1',type:'image',imagePath:'clipboard-images/a.png'}]) });
  return {root,storage,destination:path.join(root,'fixture.pome-backup.zip')};
}
test('unpaired ZIP preserves all 250 notes and real media, omits secrets and local settings', async t => {
  const f=fixture(t); await b.exportWorkspaceBackup({...f,appVersion:'0.11.0',storage:{...f.storage,secret:'must-not-export','notch-home-layout':'local-only'}});
  const result=await b.inspectWorkspaceBackup(f.destination);t.after(result.dispose);
  assert.equal(JSON.parse(result.storage['notch-note-archive-v1']).length,250);
  assert.equal(result.storage.secret,undefined);assert.equal(result.storage['notch-home-layout'],undefined);
  assert.equal(fs.readFileSync(path.join(result.stage,'media/recordings/a.webm'),'utf8'),'audio-bytes');
  assert.equal(result.manifest.files.length,3);
});
test('actual restore preserves settings and supports verified local snapshot rollback',async t=>{
  const f=fixture(t);await b.exportWorkspaceBackup({...f});const inspected=await b.inspectWorkspaceBackup(f.destination);t.after(inspected.dispose);
  fs.writeFileSync(path.join(f.root,'workspace.json'),JSON.stringify({version:1,localStorage:{'notch-home-note':'当前资料',preference:'keep'}}));
  fs.writeFileSync(path.join(f.root,'recordings/a.webm'),'current-audio');
  const current={...f.storage,'notch-home-note':'当前资料',preference:'keep'};
  const rollback=path.join(f.root,'rollback.zip');await b.exportWorkspaceBackup({...f,storage:current,destination:rollback});
  b.applyWorkspaceRestore({root:f.root,inspected,currentStorage:current});
  let data=JSON.parse(fs.readFileSync(path.join(f.root,'workspace.json'))).localStorage;
  assert.equal(data['notch-home-note'],'备份首页');assert.equal(data.preference,'keep');
  assert.equal(fs.readFileSync(path.join(f.root,'recordings/a.webm'),'utf8'),'audio-bytes');
  const previous=await b.inspectWorkspaceBackup(rollback);t.after(previous.dispose);
  b.applyWorkspaceRestore({root:f.root,inspected:previous,currentStorage:data});
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'workspace.json'))).localStorage['notch-home-note'],'当前资料');
  assert.equal(fs.readFileSync(path.join(f.root,'recordings/a.webm'),'utf8'),'current-audio');
});
test('failed rename restores original index and media',async t=>{
  const f=fixture(t);await b.exportWorkspaceBackup(f);const inspected=await b.inspectWorkspaceBackup(f.destination);t.after(inspected.dispose);
  fs.writeFileSync(path.join(f.root,'workspace.json'),'original-index');
  fs.writeFileSync(path.join(f.root,'recordings/a.webm'),'original-audio');
  assert.throws(()=>b.applyWorkspaceRestore({root:f.root,inspected,currentStorage:{},afterRename(index){if(index===1)throw new Error('ENOSPC');}}),/ENOSPC/);
  assert.equal(fs.readFileSync(path.join(f.root,'workspace.json'),'utf8'),'original-index');
  assert.equal(fs.readFileSync(path.join(f.root,'recordings/a.webm'),'utf8'),'original-audio');
  assert.equal(fs.existsSync(path.join(f.root,'.pome-restore')),false);
});
test('missing media and symlink cannot silently produce incomplete backup',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.root,'recordings/a.webm'));
  await assert.rejects(b.exportWorkspaceBackup(f),/缺失/);assert.equal(fs.existsSync(f.destination),false);
  fs.symlinkSync(path.join(f.root,'clipboard-images/a.png'),path.join(f.root,'recordings/a.webm'));
  await assert.rejects(b.exportWorkspaceBackup(f),/链接/);
});
test('checksum corruption and unsupported version are rejected before restore',async t=>{
  const f=fixture(t);await b.exportWorkspaceBackup(f);const inspected=await b.inspectWorkspaceBackup(f.destination);t.after(inspected.dispose);
  for(const variant of ['hash','version']) {
    const zip=new yazl.ZipFile();const manifest={...inspected.manifest,formatVersion:variant==='version'?2:1};
    const bytes=Buffer.from(JSON.stringify(manifest));zip.addBuffer(bytes,'manifest.json');zip.addBuffer(Buffer.from(variant==='hash'?'wrong':b.sha(bytes)),'manifest.sha256');
    for(const file of manifest.files)zip.addFile(path.join(inspected.stage,file.path),file.path);
    const target=path.join(f.root,`${variant}.zip`);const writing=pipeline(zip.outputStream,fs.createWriteStream(target));zip.end();await writing;
    await assert.rejects(b.inspectWorkspaceBackup(target),variant==='hash'?/校验失败/:/格式版本/);
  }
});
test('unsafe paths and malformed datasets are rejected',()=>{
  for(const value of ['../escape','/tmp/escape','C:/escape','a\\b','a/../b','a//b'])assert.throws(()=>b.safeRelative(value));
  assert.throws(()=>b.normalizeStorage({'notch-note-archive-v1':'[{"id":"a"},{"id":"a"}]'}),/重复/);
  assert.throws(()=>b.normalizeStorage({'notch-todo-data':'{"P0":[]}'}),/P0/);
});
