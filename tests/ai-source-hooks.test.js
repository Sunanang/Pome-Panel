'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {createAiSourceHooks,readConfig}=require('../aiSourceHooks');
const {createTaskInbox,completionEventId}=require('../taskInbox');
// This fixture already runs in the selected Node runtime. Launch tests below
// verify the installed commands; config tests need no extra runtime probes.
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'pome-hooks-test-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));for(const dir of ['.codex','.claude','.cursor'])fs.mkdirSync(path.join(home,dir));return {home,service:createAiSourceHooks({homeDir:home,runtimeCheck:()=>true}),files:{codex:path.join(home,'.codex/config.toml'),claude:path.join(home,'.claude/settings.json'),cursor:path.join(home,'.cursor/hooks.json')}};}
for(const source of ['codex','claude','cursor']){
 test(`${source}: isolated HOME connect, repeat connect, repair moved paths, disconnect`,async t=>{
  const {home,service,files}=fixture(t);
  const original=source==='codex'?'# keep this comment\nnotify = ["old-client", "turn-ended"] # user notify\n[model]\nname = "keep"\n':JSON.stringify(source==='claude'?{permissions:{allow:['Read']},hooks:{Stop:[{matcher:'',hooks:[{type:'command',command:'echo original'}]}]}}:{version:1,hooks:{stop:[{command:'echo original'}],afterFileEdit:[{command:'echo edit'}]},extra:'keep'},null,4)+'\n';
  fs.writeFileSync(files[source],original);
  const before=readConfig(files[source],source).value;
  assert.equal((await service.status(source)).state,'disconnected');
  let plan=await service.preview(source);assert.equal(fs.readFileSync(files[source],'utf8'),original,'preview cannot write');
  let result=await service.apply(plan.token);assert.equal(result.ok,true);assert.equal(fs.readFileSync(result.backupPath,'utf8'),original);assert.equal((await service.status(source)).state,'connected');
  const connected=fs.readFileSync(files[source],'utf8');plan=await service.preview(source);result=await service.apply(plan.token);assert.equal(result.ok,true);assert.equal(fs.readFileSync(files[source],'utf8'),connected,'repeat does not duplicate or rewrite');
  const moved=createAiSourceHooks({homeDir:home,runtimePath:'/missing/pome-node',runtimeCheck:()=>true});assert.equal((await moved.status(source)).state,'error');
  // A real stale Pome entry remains recognizable and can be rewritten safely.
  const stale=connected.split(JSON.stringify(process.execPath).slice(1,-1)).join('/old/Pome Panel');assert.notEqual(stale,connected);fs.writeFileSync(files[source],stale);
  assert.equal((await service.status(source)).state,'error');plan=await service.preview(source,'repair');assert.equal((await service.apply(plan.token)).ok,true);assert.equal((await service.status(source)).state,'connected');
  plan=await service.preview(source,'disconnect');assert.equal((await service.apply(plan.token)).ok,true);
  const after=readConfig(files[source],source).value;
  if(source==='codex'){assert.deepEqual(after,before);assert(fs.readFileSync(files[source],'utf8').includes('# user notify'));}
  else {assert.deepEqual(after,before);assert(fs.readFileSync(files[source],'utf8').includes('    "'));}
 });
 test(`${source}: malformed config refuses modification and creates no backup`,async t=>{
  const {service,files}=fixture(t);fs.writeFileSync(files[source],'not [ valid { config');assert.equal((await service.status(source)).state,'error');await assert.rejects(service.preview(source));assert.equal(fs.readFileSync(files[source],'utf8'),'not [ valid { config');assert.equal(fs.readdirSync(path.dirname(files[source])).length,1);
 });
 test(`${source}: expired preview cannot overwrite an external edit`,async t=>{
  const {service,files}=fixture(t);const plan=await service.preview(source);fs.writeFileSync(files[source],source==='codex'?'# external\na=1\n':'{"external":true}');assert.equal((await service.apply(plan.token)).error,'preview_expired');assert.equal(fs.readdirSync(path.dirname(files[source])).length,1);
 });
}
test('undetected directories, unavailable runtime, and missing script report explicit states',async t=>{
 const {home}=fixture(t);const empty=path.join(home,'empty');fs.mkdirSync(empty);assert((await createAiSourceHooks({homeDir:empty}).list()).every(s=>s.state==='undetected'));
 assert.equal((await createAiSourceHooks({homeDir:home,runtimeCheck:()=>false}).status('claude')).state,'error');
 assert.equal((await createAiSourceHooks({homeDir:home,appDir:empty}).status('cursor')).state,'error');
});
test('Codex without original notify removes only the Pome node on disconnect, including quoted keys',async t=>{
 const {service,files}=fixture(t);fs.writeFileSync(files.codex,'# initial\n[model]\nx=1\n');let plan=await service.preview('codex');await service.apply(plan.token);plan=await service.preview('codex','disconnect');await service.apply(plan.token);assert.deepEqual(readConfig(files.codex,'codex').value,{model:{x:1}});
 fs.writeFileSync(files.codex,'"notify" = ["echo", "prior"]\nx=1\n');plan=await service.preview('codex');await service.apply(plan.token);plan=await service.preview('codex','disconnect');await service.apply(plan.token);assert.deepEqual(readConfig(files.codex,'codex').value,{notify:['echo','prior'],x:1});
});
test('disconnect without a Pome entry never edits someone else’s config',async t=>{
 const {service,files}=fixture(t);fs.writeFileSync(files.codex,'notify = [ "my-command" ]\n');const p=await service.preview('codex','disconnect');await service.apply(p.token);assert.equal(fs.readFileSync(files.codex,'utf8'),'notify = [ "my-command" ]\n');
});
test('Bug A: identity-free events are received; payload differences and new completion times remain distinct',t=>{
 const {home}=fixture(t);let clock=1000;const inbox=createTaskInbox({filePath:path.join(home,'inbox.json'),now:()=>clock});
 const first=inbox.accept({source:'codex',title:'legacy event'});assert(first.ok);assert.equal(inbox.accept({source:'codex',title:'legacy event'}).duplicate,true);
 assert.notEqual(completionEventId({source:'codex',title:'A'},clock),completionEventId({source:'codex',title:'B'},clock));clock++;
 assert.equal(inbox.accept({source:'codex',title:'legacy event'}).duplicate,false);assert.equal(inbox.list().total,2);
 assert.equal(inbox.accept({source:'gpt',event_id:'new-gpt'}).error,'invalid_source');
});
test('legacy GPT history survives and new Cursor accepts stable conversation + generation identity',t=>{
 const {home}=fixture(t),filePath=path.join(home,'inbox.json');fs.writeFileSync(filePath,JSON.stringify({version:1,records:[{id:'old-gpt',source:'gpt',receivedAt:Date.now(),readAt:null,title:'old'}],dedupe:{}}));assert.equal(createTaskInbox({filePath}).list().items[0].source,'gpt');
 const {cursorCompletion}=require('../scripts/cursor-notify');const a=cursorCompletion({conversation_id:'c',generation_id:'g1',hook_event_name:'stop'}),b=cursorCompletion({conversation_id:'c',generation_id:'g2',hook_event_name:'stop'});assert.notEqual(a.event_id,b.event_id);assert.equal(a.event_id,cursorCompletion({conversation_id:'c',generation_id:'g1'}).event_id);assert.equal(cursorCompletion({hook_event_name:'subagentStop'}),null);
});
test('Bug B: Claude tool-only turn uses the newest assistant UUID rather than old text UUID',t=>{
 const {home}=fixture(t),file=path.join(home,'transcript.jsonl');const lines=[{type:'assistant',uuid:'previous',timestamp:'2026-10-13T00:00:00Z',message:{content:[{type:'text',text:'old answer'}]}},{type:'user',uuid:'new-turn',message:{content:'do work'}},{type:'assistant',uuid:'tool-only',timestamp:'2026-10-13T00:00:01Z',message:{content:[{type:'tool_use',name:'Bash'}]}}];fs.writeFileSync(file,lines.map(JSON.stringify).join('\n'));const completion=require('../scripts/claude-notify').lastAssistantMessage(file);assert.equal(completion.eventId,'tool-only');assert.equal(completion.text,'');
});
test('Codex forwards the exact prior notify command and raw payload',async t=>{
 const {home,service,files}=fixture(t),forward=path.join(home,'forward.js'),out=path.join(home,'forward.json');fs.writeFileSync(forward,'require("fs").writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),runAsNode:process.env.ELECTRON_RUN_AS_NODE||null}))');fs.writeFileSync(files.codex,`notify = ${JSON.stringify([process.execPath,forward,out,'turn-ended'])}\n`);
 const plan=await service.preview('codex');await service.apply(plan.token);const command=readConfig(files.codex,'codex').value.notify;const payload=JSON.stringify({event_id:'forward-test',title:'literal $(no-shell)'});
 await new Promise((resolve,reject)=>{const child=spawn(command[0],[...command.slice(1),payload],{stdio:'ignore'});child.on('error',reject);child.on('exit',resolve);});
 for(let i=0;i<100&&!fs.existsSync(out);i++)await new Promise(r=>setTimeout(r,10));assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')),{args:['turn-ended',payload],runAsNode:null});
});
test('all installed source scripts send marked tests to the isolated loopback listener',async t=>{
 const {service}=fixture(t),seen=[];const server=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{seen.push({url:req.url,payload:JSON.parse(b)});res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 for(const source of ['codex','claude','cursor']){const p=await service.preview(source);await service.apply(p.token);await service.runTest(source,{token:'test-'+source,port:server.address().port});}
 assert.deepEqual(seen.map(r=>r.url),['/notify/codex','/notify/claude','/notify/cursor']);assert(seen.every(r=>r.payload._pome_test===true && r.payload._pome_test_token));
});
test('Bug C: migration uses acknowledged base and full-resync/rebases once after expired push',async()=>{
 const {pushMigrationWorkspaceEntities}=require('../workspace-sync');const entities=[{entityId:'recording:r',collection:'recordings',payload:{id:'r',title:'recording'}}];let calls=0;const bases=[],full=[];
 const result=await pushMigrationWorkspaceEntities({entities,deviceId:'d',baseServerRev:7,pushMutations:async mutations=>{bases.push(mutations[0].baseServerRev);if(++calls===1)return {ok:false,error:'mutation_expired_resync_required'};return {ok:true,applied:mutations.map(m=>({clientMutationId:m.clientMutationId,status:'applied'}))};},pullPage:async args=>{full.push(args);return {ok:true,body:{changes:[],nextCursor:'42',hasMore:false,serverRev:42,fullSnapshot:true}};}});
 assert.equal(result.ok,true);assert.deepEqual(bases,[7,42]);assert(full.length>1&&full.every(args=>args.full===true));assert.equal(result.resynced,true);
});
test('Bug C: deferred recording reaches persistent NAS after checkpoint truncates its old base',async t=>{
 const {home}=fixture(t);let clock=Date.now();
 const store=require('../fnos/app/server/persistentStore').createPersistentStore({filePath:path.join(home,'nas.bin'),now:()=>clock});
 store.applyPush('u',[{entityId:'note:keep',collection:'notes',op:'upsert',clientMutationId:'seed',baseServerRev:0,payload:{id:'keep',content:'remote unchanged'}}],{deviceId:'d'});
 clock+=91*86400000;store.compact();assert.equal(store.bucket('u').logFloor,1);
 const entities=[{entityId:'recording:new',collection:'recordings',payload:{id:'new',title:'deferred'}}];
 const result=await require('../workspace-sync').pushMigrationWorkspaceEntities({entities,deviceId:'d',baseServerRev:0,
  pushMutations:async mutations=>{const body=store.applyPush('u',mutations,{deviceId:'d'});return body.applied.some(row=>row.status==='expired')?{ok:false,error:'mutation_expired_resync_required'}:{ok:true,...body};},
  pullPage:async args=>{const body=store.pull('u',{...args,deviceId:'d'});return {ok:!body.error,error:body.error,body};},
 });
 assert.equal(result.ok,true);assert.equal(result.rebasedRev,1);assert.equal(store.bucket('u').live.get('note:keep').payload.content,'remote unchanged');assert(store.bucket('u').live.has('recording:new'));
});
test('JSON node edits keep unrelated hooks, compact format, and matcher on repair; marker prefixes are not owned',async t=>{
 const {service,files}=fixture(t);
 const other={type:'command',command:'echo --pome-panel-hook=claude-other'};
 const original={hooks:{Stop:[{matcher:'keep-me',hooks:[other]}]},custom:{text:'untouched'}};
 fs.writeFileSync(files.claude,JSON.stringify(original));let p=await service.preview('claude');await service.apply(p.token);
 let value=JSON.parse(fs.readFileSync(files.claude,'utf8'));assert.deepEqual(value.hooks.Stop[0],original.hooks.Stop[0]);assert.equal(fs.readFileSync(files.claude,'utf8').includes('\n'),false);
 value.hooks.Stop[1].matcher='still-my-matcher';value.hooks.Stop[1].hooks[0].command=value.hooks.Stop[1].hooks[0].command.replace(process.execPath,'/previous/node');fs.writeFileSync(files.claude,JSON.stringify(value));
 p=await service.preview('claude','repair');await service.apply(p.token);value=JSON.parse(fs.readFileSync(files.claude,'utf8'));assert.equal(value.hooks.Stop[1].matcher,'still-my-matcher');assert.deepEqual(value.custom,original.custom);
 p=await service.preview('claude','disconnect');await service.apply(p.token);assert.deepEqual(JSON.parse(fs.readFileSync(files.claude,'utf8')),original);
});
test('time-expired confirmation refuses writing even if file is unchanged',async t=>{
 const {home,files}=fixture(t);let now=1000;const service=createAiSourceHooks({homeDir:home,now:()=>now,runtimeCheck:()=>true});const p=await service.preview('cursor');now+=300001;assert.equal((await service.apply(p.token)).error,'preview_expired');assert.equal(fs.existsSync(files.cursor),false);
});
test('installed Claude and Cursor shell commands run with spaces and apostrophes in application path',async t=>{
 const {home}=fixture(t),appDir=path.join(home,"Pome Panel's app");fs.mkdirSync(path.join(appDir,'scripts'),{recursive:true});for(const source of ['claude','cursor'])fs.copyFileSync(path.join(__dirname,'../scripts',source+'-notify.js'),path.join(appDir,'scripts',source+'-notify.js'));
 fs.copyFileSync(path.join(__dirname,'../scripts/pome-hook-runtime.ps1'),path.join(appDir,'scripts/pome-hook-runtime.ps1'));
 fs.copyFileSync(path.join(__dirname,'../scripts/claude-attention.js'),path.join(appDir,'scripts/claude-attention.js'));
 fs.copyFileSync(path.join(__dirname,'../aiEventPolicy.js'),path.join(appDir,'aiEventPolicy.js'));
 const service=createAiSourceHooks({homeDir:home,appDir,runtimeCheck:()=>true}),received=[];
 const server=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{received.push(JSON.parse(b));res.end('{}');});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 for(const source of ['claude','cursor']){
  const p=await service.preview(source);await service.apply(p.token);const file=path.join(home,source==='claude'?'.claude/settings.json':'.cursor/hooks.json'),value=JSON.parse(fs.readFileSync(file,'utf8'));
  const command=source==='claude'?value.hooks.Stop[0].hooks[0].command:value.hooks.stop[0].command;
  const cwd="C:\\工程\\Panel's path";
  await new Promise((resolve,reject)=>{const child=spawn(command,{shell:true,env:{...process.env,POME_NOTIFY_PORT:String(server.address().port)},stdio:['pipe','ignore','ignore']});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${source} command failed`)));child.stdin.end(JSON.stringify({_pome_test:true,_pome_test_token:source,conversation_id:'session',generation_id:source,cwd,status:'awaiting'}));});
  assert.equal(received.length,source==='claude'?1:2,`${source} must deliver its completion`);
  assert.equal(received.at(-1)._pome_test,true,`${source} must parse the forwarded JSON`);
  assert.equal(received.at(-1).cwd,cwd,`${source} must preserve UTF-8 input`);
  assert.equal(received.at(-1).status,'awaiting',`${source} must forward optional notification status`);
 }
 assert.equal(received.length,2);assert.equal(received[1].event_id,'session:cursor');
});
test('Windows configuration uses a data-only -File bridge, preserves original notify and restores it',async t=>{
 const {home,files}=fixture(t),service=createAiSourceHooks({homeDir:home,platform:'win32',runtimeCheck:()=>true});fs.writeFileSync(files.codex,'notify=["original.exe","turn-ended"]\n');
 for(const source of ['codex','claude','cursor']){const p=await service.preview(source);assert.equal((await service.apply(p.token)).ok,true);assert.equal((await service.status(source)).state,'connected');}
 const command=readConfig(files.codex,'codex').value.notify;assert(command.includes('-File'));assert(!command.includes('-Command'));assert(command.includes('pome-panel-hook=codex'));assert(command.some(value=>value.endsWith('pome-hook-runtime.ps1')));
 const p=await service.preview('codex','disconnect');await service.apply(p.token);assert.deepEqual(readConfig(files.codex,'codex').value.notify,['original.exe','turn-ended']);
});

test('Cursor keeps explicit alert status and rejects non-final hook events',()=>{
 const {cursorCompletion}=require('../scripts/cursor-notify');
 for(const status of ['completed','due','failed','awaiting'])assert.equal(cursorCompletion({status}).status,status);
 assert.equal(cursorCompletion({status:'running'}),null);
 assert.equal(cursorCompletion({hook_event_name:'beforeShellExecution',status:'awaiting'}),null);
 assert.equal(cursorCompletion({agent_id:'child',status:'completed'}),null);
});

test('Cursor native error maps to failed and aborted never becomes completed', () => {
 const {cursorCompletion}=require('../scripts/cursor-notify');
 assert.equal(cursorCompletion({status:'error'}).status,'failed');
 assert.equal(cursorCompletion({status:'aborted'}),null);
});
test('Cursor final response is correlated by conversation and generation with bounded private cache', t => {
 const {cursorCompletion}=require('../scripts/cursor-notify');
 const {home}=fixture(t), options={cacheDir:path.join(home,'response-cache'),now:()=>10000};
 const ids={conversation_id:'c',generation_id:'g'};
 assert.equal(cursorCompletion({...ids,hook_event_name:'afterAgentResponse',text:'真实完成摘要'},options),null);
 assert.equal(cursorCompletion({...ids,generation_id:'other'},options).last_assistant_message,'');
 assert.equal(cursorCompletion({...ids,status:'completed'},options).last_assistant_message,'真实完成摘要');
 assert.equal(cursorCompletion({...ids},options).last_assistant_message,'');
 cursorCompletion({...ids,hook_event_name:'afterAgentResponse',text:'旧摘要'},options);
 assert.equal(cursorCompletion(ids,{...options,now:()=>700001}).last_assistant_message,'');
});
test('Cursor bounded transcript fallback reads assistant text and ignores child agents', t => {
 const {cursorCompletion}=require('../scripts/cursor-notify'),{home}=fixture(t),file=path.join(home,'transcript.jsonl');
 fs.writeFileSync(file,[{role:'user',content:'问题'}, {role:'assistant',content:[{type:'text',text:'修复完成'}]}, {type:'assistant',isSidechain:true,message:{content:'子代理'}}].map(JSON.stringify).join('\n'));
 assert.equal(cursorCompletion({transcript_path:file}).last_assistant_message,'修复完成');
 assert.equal(cursorCompletion({transcript_path:path.join(home,'missing')}).last_assistant_message,'');
});
test('Cursor response hook installs/repairs/removes only Pome entries', async t => {
 const {service,files}=fixture(t),original={version:1,hooks:{stop:[{command:'user-stop'}],afterAgentResponse:[{command:'user-response'}]},extra:'keep'};
 fs.writeFileSync(files.cursor,JSON.stringify(original));
 let p=await service.preview('cursor');await service.apply(p.token);
 let data=JSON.parse(fs.readFileSync(files.cursor));assert.equal(data.hooks.afterAgentResponse.length,2);assert.equal(data.hooks.afterAgentResponse[0].command,'user-response');
 p=await service.preview('cursor','repair');await service.apply(p.token);data=JSON.parse(fs.readFileSync(files.cursor));assert.equal(data.hooks.afterAgentResponse.length,2);
 p=await service.preview('cursor','disconnect');await service.apply(p.token);assert.deepEqual(JSON.parse(fs.readFileSync(files.cursor)),original);
});
test('Cursor repairs a stale response hook and removes orphaned Pome response entries on disconnect', async t => {
 const {service,files}=fixture(t);let p=await service.preview('cursor');await service.apply(p.token);
 let data=JSON.parse(fs.readFileSync(files.cursor));data.hooks.afterAgentResponse[0].command=data.hooks.afterAgentResponse[0].command.replace(process.execPath,'/previous/node');
 fs.writeFileSync(files.cursor,JSON.stringify(data));assert.equal((await service.status('cursor')).state,'error');
 p=await service.preview('cursor','repair');await service.apply(p.token);assert.equal((await service.status('cursor')).state,'connected');
 data=JSON.parse(fs.readFileSync(files.cursor));delete data.hooks.stop;fs.writeFileSync(files.cursor,JSON.stringify(data));
 p=await service.preview('cursor','disconnect');await service.apply(p.token);assert.equal(JSON.parse(fs.readFileSync(files.cursor)).hooks.afterAgentResponse,undefined);
});
