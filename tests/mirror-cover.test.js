'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
function harness(){let root='/fixture',selected='image.png',invalid=false,fail=false;const disk=new Map(),writes=[],messages=[];
 const image={isEmpty:()=>invalid,getSize:()=>({width:100,height:100}),toDataURL:()=> 'data:image/png;base64,legacy'};
 const owner={isDestroyed:()=>false,webContents:{send:()=>messages.push('changed')}};
 const scope={MIRROR_IMAGE_FILE:'mirror-cover.webp',LEGACY_MIRROR_IMAGE_FILE:'mirror-cover.jpg',mirrorImageGeneration:0,mainWindow:owner,
  workspacePath:file=>root+'/'+file,fs:{existsSync:file=>disk.has(file),readFileSync:file=>disk.get(file)},nativeImage:{createFromPath:()=>image},Buffer,
  showOwnedOpenDialog:async()=>({canceled:!selected,filePaths:selected?[selected]:[]}),PomeI18n:{t:key=>key},dialog:{showMessageBox:async()=>messages.push('error')},
  writeAtomic:(file,bytes)=>{if(fail)throw Error('fixture_write');disk.set(file,bytes);writes.push(file);}};
 vm.createContext(scope);vm.runInContext(source.slice(source.indexOf('function mirrorImagePath()'),source.indexOf('function showMainPanelFromTray()')),scope);
 const encoded={bytes:Buffer.from('RIFF1234WEBPpayload'),dataUrl:'data:image/webp;base64,fixture'};
 scope.encodeMirrorCover=async()=>encoded;
 return{scope,disk,writes,messages,encoded,select:value=>selected=value,root:value=>root=value,invalid:value=>invalid=value,fail:value=>fail=value};
}
test('legacy JPEG covers stay readable and new covers use a real WebP path',async()=>{const h=harness();h.disk.set('/fixture/mirror-cover.jpg',Buffer.from('legacy'));assert.match(h.scope.mirrorImageDataUrl(),/^data:image\/png/);const result=await h.scope.chooseMirrorImage();assert.equal(result.ok,true);assert.deepEqual(h.writes,['/fixture/mirror-cover.webp']);assert.equal(h.disk.get('/fixture/mirror-cover.jpg').toString(),'legacy');assert.match(h.scope.mirrorImageDataUrl(),/^data:image\/webp/);});
test('cancelled, invalid or failed saves preserve the existing cover',async()=>{for(const kind of ['cancel','invalid','write']){const h=harness(),old=Buffer.from('old');h.disk.set('/fixture/mirror-cover.webp',old);if(kind==='cancel')h.select('');if(kind==='invalid')h.invalid(true);if(kind==='write')h.fail(true);const result=await h.scope.chooseMirrorImage();assert.equal(result.ok,kind==='cancel');assert.equal(h.disk.get('/fixture/mirror-cover.webp'),old);assert.deepEqual(h.writes,[]);}});
test('late encoding cannot write into a newly selected workspace',async()=>{const h=harness();let release;h.scope.encodeMirrorCover=()=>new Promise(resolve=>release=resolve);const pending=h.scope.chooseMirrorImage();await new Promise(resolve=>setImmediate(resolve));h.root('/different');release(h.encoded);const result=await pending;assert.equal(result.canceled,true);assert.deepEqual(h.writes,[]);assert.deepEqual(h.messages,[]);});
test('a newer cancelled selection invalidates an earlier pending encoding',async()=>{const h=harness();let release;h.scope.encodeMirrorCover=()=>new Promise(resolve=>release=resolve);const first=h.scope.chooseMirrorImage();await new Promise(resolve=>setImmediate(resolve));h.select('');await h.scope.chooseMirrorImage();release(h.encoded);assert.equal((await first).canceled,true);assert.deepEqual(h.writes,[]);});
