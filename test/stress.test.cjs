'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const {settings,saveSettings,perform}=require('../app/core.cjs');

test('file tools, permissions, path escape and limits under repeated operations',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-stress-'));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-outside-'));
 const previous=settings();
 try{
  saveSettings({...previous,directories:[base],permissions:{list:true,read:true,write:true,terminal:false,screenshot:false},maxReadBytes:65536,maxOutputBytes:65536});
  for(let i=0;i<150;i++){
   const file=path.join(base,`sample-${i}.txt`);
   assert.match((await perform('write_text_file',{path:file,content:`data-${i}`})).text,/Saved/);
   assert.equal((await perform('read_text_file',{path:file})).text,`data-${i}`);
  }
  assert.equal(JSON.parse((await perform('list_files',{path:base})).text).length,150);
  const link=path.join(base,'escape');fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(perform('write_text_file',{path:path.join(link,'evil.txt'),content:'no'}),/outside approved/);
  await assert.rejects(perform('read_text_file',{path:path.join(outside,'unknown')}));
  assert.equal(fs.existsSync(path.join(outside,'evil.txt')),false);
  await assert.rejects(perform('write_text_file',{path:path.join(base,'huge'),content:'x'.repeat(65537)}),/oversized/);
  await assert.rejects(perform('run_command',{cwd:base,command:'echo',args:['hey']}),/disabled/);
  assert.throws(()=>saveSettings({...settings(),maxReadBytes:1e12}),/Invalid limit/);
  assert.throws(()=>saveSettings({...settings(),directories:['relative']}),/absolute/);
 }finally{saveSettings(previous);fs.rmSync(base,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});

test('MCP rejects malformed JSON-RPC, reports denied tools correctly and handles burst',()=>{
 const child=cp.spawnSync(process.execPath,[path.join(__dirname,'../app/mcp.cjs')],{
  input:[JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}}),
   ...Array.from({length:100},(_,i)=>JSON.stringify({jsonrpc:'2.0',id:i+2,method:i%2?'tools/call':'tools/list',params:{name:'read_text_file',arguments:{path:'/nonexistent'}}})),
   JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})].join('\n')+'\n',
  encoding:'utf8',maxBuffer:3e6,timeout:8000});
 assert.equal(child.status,0,child.stderr);
 const lines=child.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(lines.length,101);
 assert.ok(lines.find(x=>x.id===1).result.serverInfo);
 assert.equal(lines.filter(x=>x.result?.isError).length,50);
 assert.equal(lines.filter(x=>x.result?.tools).length,50);
});
