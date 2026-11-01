'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {plan,begin}=require('../app/optional-install.cjs');
const lookup=(name)=>name==='winget'?'C:\\Windows\\winget.exe':null;
test('Windows optional tool install monitors actual winget success and never shells out',async()=>{
 const calls=[];
 const r=await begin('gh',{platform:'win32',lookup,exists:()=>false,env:{LOCALAPPDATA:'C:\\Temp'},run:async(bin,args,opts)=>{calls.push({bin,args,opts});return {stdout:''}},spawn:()=>{throw Error('must not launch detached terminal')}});
 assert.equal(r.started,true);assert.equal(r.completed,true);
 assert.equal(calls.length,1);assert.equal(calls[0].bin,'C:\\Windows\\winget.exe');
 assert.ok(calls[0].args.includes('GitHub.cli'));
 assert.equal(calls[0].opts.windowsHide,true);
 assert.ok(calls[0].opts.timeout>1000);
});
test('Windows installer failure is reported and does not claim a successful install',async()=>{
 const r=await begin('node',{platform:'win32',lookup,exists:()=>false,env:{LOCALAPPDATA:'C:\\Temp'},run:async()=>{const e=Error('install failed');e.code=7;throw e;}});
 assert.equal(r.started,false);assert.equal(r.completed,false);assert.match(r.message,/could not be installed/);
});
test('Optional dependency plans cannot be used for arbitrary commands',()=>{
 assert.throws(()=>plan('shell',{platform:'win32'}),/Unknown/);
 const unavailable=plan('gh',{platform:'linux',lookup:()=>null,exists:()=>false,env:{PATH:''}});
 assert.equal(unavailable.available,false);
 const linux=plan('git',{platform:'linux',lookup:n=>n==='apt-get'?'/usr/bin/apt-get':null,exists:()=>false,env:{PATH:''}});
 assert.deepEqual(linux.args,['install','-y','git']);
});
