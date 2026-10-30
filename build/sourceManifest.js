'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REQUIRED=['main.js','main-services.js','platform.js','preload.js','renderer/index.html','renderer/app.js','renderer/workspace.js'];
function verifyPackagedSources(projectRoot,appRoot){
 const hashes={};
 function verify(relative){
  const source=path.join(projectRoot,relative),packed=path.join(appRoot,relative);
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())return;
  const expected=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if(!fs.existsSync(packed)||crypto.createHash('sha256').update(fs.readFileSync(packed)).digest('hex')!==expected)throw Error(`Packaged source mismatch: ${relative}`);
  hashes[relative]=expected;
 }
 for(const relative of REQUIRED)verify(relative);
 for(const relative of REQUIRED)if(!hashes[relative])throw Error(`Required product source missing: ${relative}`);
 function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  if(entry.name==='node_modules'||entry.name==='build-info.json')continue;
  const absolute=path.join(folder,entry.name),relative=path.relative(appRoot,absolute);
  if(entry.isDirectory())walk(absolute);else if(entry.isFile())verify(relative);
 }}
 walk(appRoot);return hashes;
}
module.exports={verifyPackagedSources};
