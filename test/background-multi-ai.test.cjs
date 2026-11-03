'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DesktopLease,assertExecution}=require('../app/execution.cjs');
const {ProcessManager}=require('../app/processes.cjs');
const core=require('../app/core.cjs');

test('background mode blocks direct focus tools while allowing independent non-focus work',()=>{
 for(const name of ['desktop_mouse','desktop_type','desktop_key','open_application']){
  assert.throws(()=>assertExecution(name,{backgroundOnly:true},{clientId:'a'}),/Background-only/);
  assert.throws(()=>assertExecution(name,{clientExecution:{a:'background'}},{clientId:'a'}),/Background-only/);
  assert.doesNotThrow(()=>assertExecution(name,{clientExecution:{a:'background'}},{clientId:'b'}));
 }
 for(const name of ['read_text_file','process_start','process_output','desktop_screenshot'])assert.doesNotThrow(()=>assertExecution(name,{backgroundOnly:true},{clientId:'a'}));
});

test('desktop sequences cannot steal another AI focus; leases expire or release only for their owner',async()=>{
 let now=0;const lease=new DesktopLease({now:()=>now,idleMs:30});
 assert.equal(await lease.run('A',async()=>1),1);
 assert.equal(lease.release('B').released,false);
 await assert.rejects(lease.run('B',async()=>2),/desktop is in use/);
 assert.equal(lease.status('A').ownedByYou,true);assert.equal(lease.status('B').ownedByYou,false);
 assert.equal(lease.release('A').released,true);
 assert.equal(await lease.run('B',async()=>2),2);
 now=31;assert.equal(await lease.run('A',async()=>3),3);
 let finish;const pending=lease.run('A',()=>new Promise(r=>{finish=r}));
 await assert.rejects(lease.run('A',async()=>4),/desktop is in use/);finish(5);await pending;
 lease.reset();assert.equal(lease.status('A').held,false);
});

test('process quotas are independently enforced and 0 removes app caps without sharing session access',async()=>{
 let limits={maxProcesses:3,maxProcessesPerClient:1};const manager=new ProcessManager({policy:()=>limits});
 const launch=id=>manager.start({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:os.tmpdir(),clientId:id});
 try{
  const a=launch('A');launch('B');
  assert.throws(()=>launch('A'),/This AI reached/);
  assert.throws(()=>manager.read(a.id,'B'),/does not belong/);
  limits={maxProcesses:0,maxProcessesPerClient:0};
  for(let i=0;i<18;i++)launch('AI-'+i);
  assert.equal([...manager.sessions.values()].filter(x=>x.running).length,20);
  assert.equal(manager.list('B').length,1);
 }finally{
  const closed=[...manager.sessions.values()].filter(s=>s.running).map(s=>new Promise(resolve=>s.child.once('close',resolve)));
  manager.stopAll();let deadline;
  // Windows starts forced tree termination after 1.5s; twenty taskkill children
  // can take longer than the old 2.5s polling budget on a busy test machine.
  try{await Promise.race([Promise.all(closed),new Promise(resolve=>{deadline=setTimeout(resolve,10000);})]);}finally{clearTimeout(deadline);}
 }
 assert.ok([...manager.sessions.values()].every(x=>!x.running));
});

test('background and per-client limits persist and invalid values cannot alter them',async()=>{
 const before=core.settings();try{
  const s=core.saveSettings({...before,backgroundOnly:true,startHidden:true,clientExecution:{a:'background'},maxProcesses:0,maxProcessesPerClient:2});
  assert.equal(s.maxProcesses,0);assert.equal(s.clientExecution.a,'background');
  await assert.rejects(core.perform('desktop_type',{text:'must not be typed'},{clientId:'a'}),/Background-only/);
  for(const bad of [-1,1.5,4097,'all'])assert.throws(()=>core.saveSettings({...s,maxProcesses:bad}),/Concurrency/);
  assert.throws(()=>core.saveSettings({...s,clientExecution:{a:'anything'}}),/execution mode/);
 }finally{core.saveSettings(before)}
});
