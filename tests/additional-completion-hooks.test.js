'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { createAiSourceHooks } = require('../aiSourceHooks');
const { copilotCompletion, lastAssistant } = require('../scripts/copilot-notify');
const { antigravityCompletion } = require('../scripts/antigravity-notify');
const C = require('./fixtures/copilot-stop.json'), A = require('./fixtures/antigravity-stop.json');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-new-completions-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.copilot'));fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  return { home, service: createAiSourceHooks({ homeDir: home, env: {}, runtimeCheck: () => true }),
    files: { copilot: path.join(home, '.copilot/hooks/pome-panel.json'), antigravity: path.join(home, '.gemini/config/hooks.json') } };
}
for (const source of ['copilot', 'antigravity']) {
  test(`${source}: preserve user hooks, repair stale runtime, dedupe connect and disconnect only owned entries`, async t => {
    const { service, files } = fixture(t), file = files[source]; fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = JSON.stringify(source === 'copilot' ? { version: 1, note: 'keep', hooks: { agentStop: [{ command: 'echo user' }], sessionEnd: [{ command: 'echo end' }] } }
      : { 'user-linter': { PostToolUse: [{ matcher: 'run_command', hooks: [{ command: 'echo lint' }] }] }, 'pome-panel': { note: 'keep', Stop: [{ command: 'echo user' }] } }, null, 4) + '\n';
    fs.writeFileSync(file, original);
    assert.equal((await service.status(source)).state, 'disconnected');
    let plan = await service.preview(source); assert.equal(fs.readFileSync(file, 'utf8'), original);
    let result = await service.apply(plan.token); assert.equal(result.ok, true, result.message);
    assert.equal(fs.readFileSync(result.backupPath, 'utf8'), original);
    assert.equal((await service.status(source)).state, 'connected');
    const connected = fs.readFileSync(file, 'utf8');
    plan = await service.preview(source); assert.equal(plan.unchanged, true); assert.equal((await service.apply(plan.token)).backupPath, null);
    fs.writeFileSync(file, connected.split(JSON.stringify(process.execPath).slice(1, -1)).join('/missing/old-runtime'));
    assert.equal((await service.status(source)).state, 'error');
    plan = await service.preview(source, 'repair'); assert.equal((await service.apply(plan.token)).ok, true);
    assert.equal((await service.status(source)).state, 'connected');
    const written = fs.readFileSync(file, 'utf8'); assert(written.includes('    "'));
    plan = await service.preview(source, 'disconnect'); assert.equal((await service.apply(plan.token)).ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), JSON.parse(original));
    assert.equal((await service.status(source)).state, 'disconnected');
  });
  test(`${source}: malformed configuration and changed preview cannot overwrite user data`, async t => {
    const { service, files } = fixture(t), file = files[source]; fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{invalid'); assert.equal((await service.status(source)).state, 'error'); await assert.rejects(service.preview(source));
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid'); fs.writeFileSync(file, '{}\n');
    const plan = await service.preview(source); fs.writeFileSync(file, '{"external":true}');
    assert.equal((await service.apply(plan.token)).error, 'preview_expired'); assert.equal(fs.readFileSync(file, 'utf8'), '{"external":true}');
  });
}
test('Copilot respects COPILOT_HOME and Windows uses exec/args without a shell', async t => {
  const {home}=fixture(t), custom=path.join(home,'Copilot custom');fs.mkdirSync(custom);
  const service=createAiSourceHooks({homeDir:home,env:{COPILOT_HOME:custom},platform:'win32',runtimeCheck:()=>true});
  assert.equal((await service.status('copilot')).filePath,path.join(custom,'hooks/pome-panel.json'));
  const plan=await service.preview('copilot');assert.equal((await service.apply(plan.token)).ok,true);
  const data=JSON.parse(fs.readFileSync(plan.filePath));
  for(const name of ['agentStop','errorOccurred']) {
    const item=data.hooks[name][0];assert.equal(item.exec,process.execPath);assert(item.args.includes('--pome-panel-hook=copilot'));
    assert.equal(item.command,undefined);assert.equal(item.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(item.env.POME_COMPLETION_EVENT,name);
  }
  const remove=await service.preview('copilot','disconnect');assert.equal((await service.apply(remove.token)).ok,true);assert.equal(fs.existsSync(plan.filePath),false);
});
test('Gemini alone does not imply Antigravity and a disabled Pome hook cannot report connected', async t => {
  const {home,service,files}=fixture(t);fs.rmSync(path.join(home,'.gemini/antigravity'),{recursive:true});
  assert.equal((await service.status('antigravity')).state,'undetected');
  fs.mkdirSync(path.join(home,'.gemini/antigravity-cli'));
  let plan=await service.preview('antigravity');await service.apply(plan.token);
  const data=JSON.parse(fs.readFileSync(files.antigravity));data['pome-panel'].enabled=false;fs.writeFileSync(files.antigravity,JSON.stringify(data));
  assert.equal((await service.status('antigravity')).state,'error');
  plan=await service.preview('antigravity','repair');await service.apply(plan.token);assert.equal((await service.status('antigravity')).state,'connected');
});
test('Copilot terminal events use current assistant identity, exclude recoverable/tool errors and never reuse an old summary', t => {
  const {home}=fixture(t), transcript=path.join(home,'events.jsonl');
  const write = rows => fs.writeFileSync(transcript,rows.map(JSON.stringify).join('\n'));
  write([{type:'assistant.message',id:'old',data:{content:'Old result'}},{type:'user.message',data:{content:'Next task'}},
    {type:'assistant.turn_start'}, {type:'assistant.message',id:'new',data:{messageId:'new-id',content:'New result',toolRequests:[]}}]);
  let p={...C,transcriptPath:transcript};const first=copilotCompletion(p,{event:'agentStop'});
  assert.equal(first.last_assistant_message,'New result');assert.equal(first.status,'completed');
  assert.equal(copilotCompletion(p,{event:'agentStop'}).event_id,first.event_id);
  write([{type:'assistant.message',id:'old',data:{content:'Old result'}},{type:'user.message',data:{content:'Next task'}}]);
  assert.equal(copilotCompletion({...p,timestamp:C.timestamp+1},{event:'agentStop'}).last_assistant_message,'');
  write([{type:'assistant.message',id:'second',data:{content:'Second result'}}]);
  assert.notEqual(copilotCompletion(p,{event:'agentStop'}).event_id,first.event_id);
  assert.equal(copilotCompletion({...p,hook_event_name:'SubagentStop'},{event:'agentStop'}),null);
  assert.equal(copilotCompletion({...p,stopReason:'user_exit'},{event:'agentStop'}),null);
  assert.equal(copilotCompletion(p,{event:'sessionEnd'}),null);
  const error={...p,error:{message:'Model failed',stack:'PRIVATE STACK'},errorContext:'model_call',recoverable:false};
  const failed=copilotCompletion(error,{event:'errorOccurred'});assert.equal(failed.status,'failed');assert.equal(failed.last_assistant_message,'Model failed');assert(!JSON.stringify(failed).includes('PRIVATE STACK'));
  assert.equal(copilotCompletion({...error,recoverable:true},{event:'errorOccurred'}),null);
  assert.equal(copilotCompletion({...error,errorContext:'tool_execution'},{event:'errorOccurred'}),null);
  assert.equal(copilotCompletion({...error,error:{message:'Authorization: Bearer PRIVATE'}},{event:'errorOccurred'}).last_assistant_message,'');
  assert.equal(lastAssistant('/missing/transcript'),null);
});
test('Antigravity requires full idle and an explicit outcome, and distinguishes executions and CLI windows', () => {
  const first=antigravityCompletion(A);assert.equal(first.status,'completed');assert.equal(first.last_assistant_message,'');assert.equal(first.window.app,'Antigravity');
  assert.equal(antigravityCompletion(A).event_id,first.event_id);
  assert.notEqual(antigravityCompletion({...A,executionNum:2}).event_id,first.event_id);
  for(const change of [{fullyIdle:false},{fullyIdle:undefined},{terminationReason:'cancelled'},{executionNum:undefined},{hook_event_name:'PostInvocation'}]) assert.equal(antigravityCompletion({...A,...change}),null);
  for(const terminationReason of ['error','max_steps_exceeded'])assert.equal(antigravityCompletion({...A,terminationReason,error:'Failed'}).status,'failed');
  assert.equal(antigravityCompletion({...A,transcriptPath:'C:\\Users\\test\\.gemini\\antigravity-cli\\brain\\c\\logs.jsonl'}).window.app,'Terminal');
  assert.equal(antigravityCompletion({...A,transcriptPath:'/home/test/.gemini/antigravity-ide/brain/c/transcript.jsonl'}).window.app,'Antigravity IDE');
});
test('Both adapters ignore remote and child records before stripping metadata', () => {
  for(const [adapt,sample] of [[p=>copilotCompletion(p,{event:'agentStop'}),C],[antigravityCompletion,A]]) {
    for(const change of [{agentId:'child'},{parentConversationId:'parent'},{subagentType:'explore'},{remote:true},{surface:'cloud'},{status:'cancelled'}]) assert.equal(adapt({...sample,...change}),null);
  }
});
test('Shared forwarder keeps decimal timestamps and Grok uses the same transport', () => {
  const F = require('../scripts/completion-forwarder');
  const { grokCompletion } = require('../scripts/grok-notify');
  assert.equal(F.timestamp('1710000000.75'), 1710000000);
  assert.equal(F.timestamp(1710000000.75), 1710000000);
  assert.equal(copilotCompletion({ ...C, timestamp: '1710000000.5', transcriptPath: '' }, { event: 'agentStop' }).completed_at, 1710000000);
  assert.equal(grokCompletion({ ...require('./fixtures/grok-stop.json'), promptId: undefined, timestamp: undefined }), null);
});
test('Installed Copilot exec and Antigravity shell commands deliver real payloads and marked tests to loopback', async t => {
  const {files,home}=fixture(t), seen=[],appDir=path.join(home,"Pome Panel's app");fs.mkdirSync(path.join(appDir,'scripts'),{recursive:true});
  for(const name of ['copilot-notify.js','antigravity-notify.js','completion-forwarder.js','pome-hook-runtime.ps1'])fs.copyFileSync(path.join(__dirname,'../scripts',name),path.join(appDir,'scripts',name));
  const service=createAiSourceHooks({homeDir:home,env:{},appDir,runtimeCheck:()=>true});
  const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{seen.push({url:req.url,payload:JSON.parse(body)});res.end('{}');});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  for(const source of ['copilot','antigravity']) {
    const plan=await service.preview(source);await service.apply(plan.token);await service.runTest(source,{token:`test-${source}`,port:server.address().port});
    const config=JSON.parse(fs.readFileSync(files[source]));const entry=source==='copilot'?config.hooks.agentStop[0]:config['pome-panel'].Stop[0];
    const payload=source==='copilot'?{...C,transcriptPath:path.join(home,'missing.jsonl')}:{...A,workspacePaths:[home]};
    await new Promise((resolve,reject)=>{
      const child=source==='copilot'?spawn(entry.exec,entry.args,{env:{...process.env,...entry.env,POME_NOTIFY_PORT:String(server.address().port)},stdio:['pipe','ignore','ignore']})
        :spawn(entry.command,{shell:true,env:{...process.env,POME_NOTIFY_PORT:String(server.address().port)},stdio:['pipe','ignore','ignore']});
      child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('hook failed')));child.stdin.end(JSON.stringify(payload));
    });
  }
  assert.deepEqual(seen.map(row=>row.url),['/notify/copilot','/notify/copilot','/notify/antigravity','/notify/antigravity']);
  assert(seen[0].payload._pome_test);assert.equal(seen[1].payload.status,'completed');assert(seen[2].payload._pome_test);assert.equal(seen[3].payload.status,'completed');
});

test('Forwarders exit silently for invalid/oversized input, receiver failure and aborted responses', async t => {
  const server=http.createServer((req,res)=>{req.resume();res.writeHead(200);res.write('{');res.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  t.after(()=>server.close());
  async function invoke(input) {
    const started=Date.now();let stdout='',stderr='';
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(__dirname,'../scripts/copilot-notify.js')],{env:{...process.env,POME_COMPLETION_EVENT:'agentStop',POME_NOTIFY_PORT:String(port)},stdio:['pipe','pipe','pipe']});
      child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.stdin.on('error',()=>{});
      child.on('error',reject);child.on('exit',resolve);child.stdin.end(input);
    });
    assert.equal(code,0);assert.equal(stdout,'');assert.equal(stderr,'');assert(Date.now()-started<5000);
  }
  await invoke('not JSON');await invoke('x'.repeat(1024*1024+1));await invoke(JSON.stringify({...C,transcriptPath:''}));
  await new Promise(resolve=>server.close(resolve));await invoke(JSON.stringify({...C,transcriptPath:''}));
});
