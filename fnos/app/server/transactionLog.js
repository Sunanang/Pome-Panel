'use strict';
const crypto = require('node:crypto');
const v8 = require('node:v8');
const MAP_FIELDS = ['live','tombstones','migrations','mutationResults'];
const ROOT_MAPS = ['tokens','devices','pairingCodes'];
const sameRow = (a,b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object'
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]));
function mapDiff(before=new Map(),after=new Map(),same=sameRow) {
 const set=[...after].filter(([key,value])=>!before.has(key)||!same(before.get(key),value));
 const remove=[...before.keys()].filter(key=>!after.has(key));
 return set.length||remove.length ? {set,remove} : null;
}
function stateDiff(before,after) {
 const patch={root:{},accounts:[],removedAccounts:[...before.byUid.keys()].filter(uid=>!after.byUid.has(uid))};
 for(const field of ROOT_MAPS){const diff=mapDiff(before[field],after[field]);if(diff)patch.root[field]=diff;}
 for(const [uid,b] of after.byUid) {
  const old=before.byUid.get(uid)||{},fields={},maps={};
  for(const field of ['serverRev','accountSyncKey','logFloor','mutationFloor','lastRecoveryId'])if(b[field]!==old[field])fields[field]=b[field];
  for(const field of MAP_FIELDS) {
   const diff=mapDiff(old[field],b[field],field==='live'||field==='tombstones'?(x,y)=>x===y:sameRow);
   if(diff)maps[field]=diff;
  }
  const oldLog=old.changeLog||[],nextLog=b.changeLog||[];
  if(nextLog.length<oldLog.length||oldLog.some((entry,i)=>entry!==nextLog[i]))throw new Error('change_log_not_append_only');
  const append=nextLog.slice(oldLog.length);
  const recoveries={set:[],remove:[...(old.recoveries?.keys()||[])].filter(id=>!b.recoveries?.has(id))};
  for(const [id,r] of b.recoveries||[]) {
   const prev=old.recoveries?.get(id)||{},updated={};
   for(const key of Object.keys(r))if(key!=='chunks'&&r[key]!==prev[key])updated[key]=r[key];
   const chunks=mapDiff(prev.chunks,r.chunks,(a,b)=>a===b);
   if(Object.keys(updated).length||chunks)recoveries.set.push({id,fields:updated,chunks});
  }
  if(Object.keys(fields).length||Object.keys(maps).length||append.length||recoveries.set.length||recoveries.remove.length)patch.accounts.push({uid,fields,maps,append,recoveries});
 }
 return Object.keys(patch.root).length||patch.accounts.length||patch.removedAccounts.length?patch:null;
}
function applyDiff(state,patch) {
 function apply(map,diff){for(const key of diff.remove)map.delete(key);for(const [key,value] of diff.set)map.set(key,value);}
 for(const field of ROOT_MAPS)if(patch.root[field])apply(state[field],patch.root[field]);
 for(const uid of patch.removedAccounts)state.byUid.delete(uid);
 for(const row of patch.accounts) {
  let b=state.byUid.get(row.uid);
  if(!b){b={live:new Map(),tombstones:new Map(),migrations:new Map(),mutationResults:new Map(),changeLog:[],serverRev:0,accountSyncKey:null};state.byUid.set(row.uid,b);}
  Object.assign(b,row.fields);
  for(const field of MAP_FIELDS)if(row.maps[field]){b[field] ||= new Map();apply(b[field],row.maps[field]);}
  if(row.recoveries){b.recoveries ||= new Map();for(const id of row.recoveries.remove)b.recoveries.delete(id);for(const changed of row.recoveries.set){let r=b.recoveries.get(changed.id);if(!r){r={chunks:new Map()};b.recoveries.set(changed.id,r);}Object.assign(r,changed.fields);if(changed.chunks)apply(r.chunks,changed.chunks);}}
  b.changeLog.push(...row.append);
 }
 return state;
}
function encode(row) { const payload=v8.serialize(row);return Buffer.concat([Buffer.from('POMEJ2\0'),crypto.createHash('sha256').update(payload).digest(),payload]); }
function decode(bytes) {
 if(bytes.length<39||bytes.subarray(0,7).toString()!=='POMEJ2\0'||!crypto.timingSafeEqual(bytes.subarray(7,39),crypto.createHash('sha256').update(bytes.subarray(39)).digest()))throw new Error('transaction_checksum_mismatch');
 return v8.deserialize(bytes.subarray(39));
}
module.exports={stateDiff,applyDiff,encode,decode};
