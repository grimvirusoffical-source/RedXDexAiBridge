'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {atomicRename}=require('../app/atomic-rename.cjs');

test('Windows antivirus sharing locks are retried without touching the destination',()=>{
 let attempts=0,waits=[];
 atomicRename('temp','settings.json',{platform:'win32',rename(from,to){attempts++;assert.equal(from,'temp');assert.equal(to,'settings.json');if(attempts<4){const e=Error('file locked');e.code=['EPERM','EACCES','EBUSY'][attempts-1];throw e;}},sleep:ms=>waits.push(ms)});
 assert.equal(attempts,4);assert.deepEqual(waits,[25,50,75]);
});
test('non-Windows and non-transient errors are never retried',()=>{
 for(const [platform,code]of [['linux','EPERM'],['darwin','EBUSY'],['win32','ENOENT']]){
  let calls=0,waits=0;const error=Object.assign(Error('failure'),{code});
  assert.throws(()=>atomicRename('a','b',{platform,rename(){calls++;throw error;},sleep(){waits++;}}),e=>e===error);
  assert.equal(calls,1);assert.equal(waits,0);
 }
});
test('persistent Windows lock returns the original error after a bounded interval',()=>{
 let calls=0;const error=Object.assign(Error('sharing violation'),{code:'EPERM'});
 assert.throws(()=>atomicRename('src','dest',{platform:'win32',maxRetries:3,rename(){calls++;throw error;},sleep(){}}),e=>e===error);
 assert.equal(calls,4);
});
test('actual replacement keeps only the new file and has no intermediate deletion',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-atomic-'));
 try{
  const dest=path.join(dir,'oauth.json'),temp=path.join(dir,'oauth.json.tmp');
  fs.writeFileSync(dest,'old');fs.writeFileSync(temp,'new');
  atomicRename(temp,dest);
  assert.equal(fs.readFileSync(dest,'utf8'),'new');assert.equal(fs.existsSync(temp),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
