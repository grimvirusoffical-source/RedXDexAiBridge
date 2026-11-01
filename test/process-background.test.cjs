'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os');
const {ProcessManager}=require('../app/processes.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('long approved background process remains asynchronous and separately readable',async()=>{
 const manager=new ProcessManager({policy:()=>({maxProcesses:4,maxProcessesPerClient:2})});
 const a=manager.start({command:process.execPath,args:['-e',"setTimeout(()=>process.stdout.write('ASYNC_BACKGROUND_OK'),300)"],cwd:os.tmpdir(),clientId:'owner',timeoutMs:86400000});
 try{
  assert.equal(a.running,true);
  assert.throws(()=>manager.read(a.id,'other'),/does not belong/);
  let state;
  for(let i=0;i<50;i++){state=manager.read(a.id,'owner');if(!state.running)break;await pause(40);}
  assert.equal(state.running,false);
  assert.equal(state.exitCode,0);
  assert.match(state.output,/ASYNC_BACKGROUND_OK/);
  assert.equal(manager.list('other').length,0);
 }finally{manager.stopAll();}
});
test('background job timeout has a strict 24-hour upper bound',()=>{
 const manager=new ProcessManager();
 assert.throws(()=>manager.start({command:process.execPath,cwd:os.tmpdir(),timeoutMs:86400001}),/24 hours/);
 assert.throws(()=>manager.start({command:process.execPath,cwd:os.tmpdir(),timeoutMs:0}),/24 hours/);
});
