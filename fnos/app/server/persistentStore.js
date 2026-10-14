'use strict';
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { randomUUID, createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { createMemoryStore } = require('./store');
const { createRecovery } = require('./recovery');
const { stateDiff, applyDiff, encode, decode } = require('./transactionLog');

// One process owns this store. Every acknowledged transaction has a durable,
// checksummed incremental file; unchanged recordings are never serialized again.
function createPersistentStore({ filePath, ...options }) {
 if(!filePath)throw new Error('store_path_required');
 const store=createMemoryStore(options),disk=options.fileSystem||fs;
 const journalDir=`${filePath}.transactions`;
 disk.mkdirSync(path.dirname(filePath),{recursive:true,mode:0o700});
 disk.mkdirSync(journalDir,{recursive:true,mode:0o700});
 let sequence=0,checkpointSequence=0;
 function write(file,bytes) {
  const temporary=`${file}.${process.pid}.${randomUUID()}.tmp`;let fd;
  try {fd=disk.openSync(temporary,'wx',0o600);disk.writeFileSync(fd,bytes);disk.fsyncSync(fd);disk.closeSync(fd);fd=undefined;if(hash(disk.readFileSync(temporary))!==hash(bytes))throw new Error('transaction_write_verification_failed');disk.renameSync(temporary,file);
   if(process.platform!=='win32'){const dir=disk.openSync(path.dirname(file),'r');try{disk.fsyncSync(dir);}finally{disk.closeSync(dir);}}
  }finally{if(fd!==undefined)disk.closeSync(fd);if(disk.existsSync(temporary))disk.unlinkSync(temporary);}
 }
 function readCommitted() {
  const saved=v8.deserialize(disk.readFileSync(filePath));
  let state,seq;
  if([2,3].includes(saved.version)&&saved.format==='pome-nas-transactions'){if(!Buffer.isBuffer(saved.stateBytes)||hash(saved.stateBytes)!==saved.sha256)throw new Error('checkpoint_checksum_mismatch');state=v8.deserialize(saved.stateBytes);seq=saved.sequence;}
  else if(saved.version===1){state=saved;seq=0;}
  else throw new Error('invalid_store_snapshot');
  if(!Number.isSafeInteger(seq)||seq<0)throw new Error('invalid_transaction_sequence');
  const checkpoint=seq;
  for(const name of disk.readdirSync(journalDir).filter(n=>/^\d{20}\.bin$/.test(n)).sort()){
   const number=Number(name.slice(0,20));if(number<=checkpoint)continue;
   const row=decode(disk.readFileSync(path.join(journalDir,name)));
   if(row.version!==2||row.sequence!==number||number!==seq+1)throw new Error('transaction_sequence_gap');
   applyDiff(state,row.patch);seq=number;
  }
  return {state,sequence:seq,checkpoint};
 }
 function checkpoint() {
  const stateBytes=v8.serialize(store.exportState());
  write(filePath,v8.serialize({version:3,format:'pome-nas-transactions',sequence,stateBytes,sha256:hash(stateBytes)}));
  checkpointSequence=sequence;
  for(const name of disk.readdirSync(journalDir))if(/^\d{20}\.bin$/.test(name)&&Number(name.slice(0,20))<=sequence)disk.unlinkSync(path.join(journalDir,name));
 }
 if(disk.existsSync(filePath)){
  const loaded=readCommitted();store.importState(loaded.state);sequence=loaded.sequence;checkpointSequence=loaded.checkpoint;
  // Upgrade the durable envelope; old binaries must refuse this format rather
  // than accidentally ignore the sidecar and start with stale business data.
  if(v8.deserialize(disk.readFileSync(filePath)).version!==3)checkpoint();
 }else checkpoint();
 function transaction(action) {
  const before=store.persistenceView();
  try {
   const result=action(),patch=stateDiff(before,store.persistenceView());
   if(patch){const next=sequence+1;write(path.join(journalDir,`${String(next).padStart(20,'0')}.bin`),encode({version:2,sequence:next,patch}));sequence=next;}
   // Retention and transaction compaction share one durable checkpoint.
   // Covered journal files are deleted only after checkpoint publication.
   if(sequence-checkpointSequence>=256){try{compact();}catch(error){options.onCompactionError?.(error);}}
   if(store.now()-lastRetentionCheck >= (options.maintenanceIntervalMs ?? 3600000)){try{compact();}catch(error){options.onCompactionError?.(error);}}
   return result;
  }catch(error){
   const loaded=readCommitted();store.importState(loaded.state);sequence=loaded.sequence;checkpointSequence=loaded.checkpoint;throw error;
  }
 }
 let lastRetentionCheck=store.now();
 function compact() {
  try { store.compactRetention(); checkpoint(); lastRetentionCheck=store.now(); return {ok:true}; }
  catch(error){const loaded=readCommitted();store.importState(loaded.state);sequence=loaded.sequence;checkpointSequence=loaded.checkpoint;throw error;}
 }
 const persistent={...store, compact, compactRetention:compact};

 for(const name of ['pull','issueToken','issueTokenRecord','revokeToken','revokeDevice','startPairing','claimPairing','getOrCreateAccountSyncKey','startMigration','commitMigration','applyPush'])persistent[name]=(...args)=>transaction(()=>store[name](...args));
 persistent.verifyToken=(raw,{touch=true}={})=>{
  const row=store.verifyToken(raw,{touch:false}),now=typeof options.now==='function'?options.now():Date.now();
  if(!row||!touch||now-row.lastUsedAt<60000)return row;
  return transaction(()=>store.verifyToken(raw));
 };
 const recovery=createRecovery(store);persistent.recovery={...recovery};
 for(const name of ['prepare','stage','commit','rollback'])persistent.recovery[name]=(...args)=>transaction(()=>recovery[name](...args));
 persistent.recovery.verify=(uid,operationId,deviceId)=>transaction(()=>{
  const saved=readCommitted().state;
  return recovery.verify(uid,operationId,deviceId,saved.byUid.get(String(uid))?.recoveries?.get(operationId));
 });
 return persistent;
}
module.exports={createPersistentStore};
