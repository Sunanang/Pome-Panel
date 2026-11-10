'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REQUIRED=['main.js','main-services.js','meetingMode.js','platform.js','preload.js','renderer/index.html','renderer/app.js','renderer/workspace.js'];
// electron-builder rewrites package.json (drops scripts/devDependencies/build). Compare product identity only.
const PACKAGE_IDENTITY=['name','version','main','license'];
function verifyPackagedSources(projectRoot,appRoot){
 const hashes={};
 function verify(relative){
  // walk() 传进来的是 path.relative 的结果，Windows 上带反斜杠（renderer\index.html），
  // 会和 REQUIRED 里写的正斜杠形成两个不同的 key，同一个文件被记两次。
  // 统一成 POSIX 分隔符，让两边的 key 一致。
  relative=relative.split(path.sep).join('/');
  const source=path.join(projectRoot,relative),packed=path.join(appRoot,relative);
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())return;
  const expected=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if(!fs.existsSync(packed)||crypto.createHash('sha256').update(fs.readFileSync(packed)).digest('hex')!==expected)throw Error(`Packaged source mismatch: ${relative}`);
  hashes[relative]=expected;
 }
 function verifyPackageJson(){
  const sourcePath=path.join(projectRoot,'package.json'),packedPath=path.join(appRoot,'package.json');
  if(!fs.existsSync(sourcePath)||!fs.existsSync(packedPath))throw Error('Packaged source mismatch: package.json');
  const source=JSON.parse(fs.readFileSync(sourcePath,'utf8')),packed=JSON.parse(fs.readFileSync(packedPath,'utf8'));
  for(const key of PACKAGE_IDENTITY){
   if(source[key]!==packed[key])throw Error(`Packaged source mismatch: package.json.${key}`);
  }
  hashes['package.json']=crypto.createHash('sha256').update(fs.readFileSync(packedPath)).digest('hex');
 }
 for(const relative of REQUIRED)verify(relative);
 for(const relative of REQUIRED)if(!hashes[relative])throw Error(`Required product source missing: ${relative}`);
 if(fs.existsSync(path.join(appRoot,'package.json')))verifyPackageJson();
 function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  if(entry.name==='node_modules'||entry.name==='build-info.json'||entry.name==='package.json')continue;
  const absolute=path.join(folder,entry.name),relative=path.relative(appRoot,absolute);
  if(entry.isDirectory())walk(absolute);else if(entry.isFile())verify(relative);
 }}
 walk(appRoot);return hashes;
}
module.exports={verifyPackagedSources};
